import { find_agent_config } from "../agent/index.js";
import { HumanRequestManager } from "../human-request/index.js";
import { combine_turn_observers } from "../observe/composite.js";
import type { TurnObserver } from "../observe/types.js";
import { create_usage_turn_observer } from "../observe/usage.js";
import { append_jsonl } from "../storage/index.js";
import { sleep } from "../utils/index.js";
import { WorkOrderManager } from "../work-order/index.js";
import { type GitTurnWorkspace, create_git_turn_workspace } from "./git-worktree.js";
import { type RuntimeLog, create_runtime_log, get_state_log_path } from "./log.js";
import {
  type AgentRunStateStore,
  create_agent_run_state_store,
  read_agent_run_state,
} from "./run-state.js";
import type { LoopState } from "./state.js";
import { get_turn_id } from "./state.js";
import { type TurnRunContext, create_execution_turn_context } from "./turn-context.js";
import { TurnRunner, TurnValidationExhaustedError } from "./turn.js";

const TURN_ERROR_RETRY_DELAY_SECONDS = 30;
const SLEEP_POLL_INTERVAL_MS = 1000;

export type AgentRuntimeRunMode = "loop" | "once";

type AgentRuntimeDependencies = {
  work_order_factory: (work_dir: string) => WorkOrderManager;
  human_request_factory: (work_dir: string) => HumanRequestManager;
  turn_runner_factory: (
    work_dir: string,
    is_root: boolean,
    turn_context: TurnRunContext,
  ) => TurnExecutor;
  turn_observer_factory: (work_dir: string, is_root: boolean) => TurnObserver | null;
  turn_workspace_factory: (work_dir: string) => GitTurnWorkspace;
  sleep: (delay: number) => Promise<unknown>;
  child_runtime_factory: (agent_dir: string) => { run(): Promise<void> };
  start_child_agents: boolean;
  retry_delay_seconds: number;
  sleep_poll_interval_ms: number;
};

type TurnExecutor = {
  run(): Promise<LoopState>;
};

type TurnExecutionResult = {
  state: LoopState;
  wakeup_candidates: WakeupCandidates;
};

type WakeupCandidates = {
  work_orders: Set<string>;
  human_requests: Set<string>;
};

export class AgentRuntime {
  readonly #running_children = new Map<string, Promise<void>>();
  readonly #work_orders: WorkOrderManager;
  readonly #human_requests: HumanRequestManager;
  readonly #turn_runner_factory: (
    work_dir: string,
    is_root: boolean,
    turn_context: TurnRunContext,
  ) => TurnExecutor;
  readonly #turn_workspace: GitTurnWorkspace;
  readonly #sleep: (delay: number) => Promise<unknown>;
  readonly #child_runtime_factory: (agent_dir: string) => { run(): Promise<void> };
  readonly #start_child_agents: boolean;
  readonly #retry_delay_seconds: number;
  readonly #sleep_poll_interval_ms: number;
  readonly #log: RuntimeLog;
  readonly #run_state: AgentRunStateStore;

  constructor(
    readonly work_dir: string,
    readonly is_root = true,
    dependencies: Partial<AgentRuntimeDependencies> = {},
  ) {
    this.#log = create_runtime_log(work_dir);
    this.#run_state = create_agent_run_state_store(work_dir);
    const turn_observer_factory = dependencies.turn_observer_factory ?? (() => null);
    const usage_work_dir = work_dir;
    const turn_runner_factory =
      dependencies.turn_runner_factory ??
      ((dir: string, root: boolean, turn_context: TurnRunContext) =>
        new TurnRunner(dir, root, {
          observer: combine_turn_observers([
            turn_observer_factory(dir, root),
            create_usage_turn_observer(usage_work_dir),
          ]),
          turn_context,
        }));
    this.#turn_runner_factory = turn_runner_factory;
    this.#turn_workspace = (
      dependencies.turn_workspace_factory ?? ((dir: string) => create_git_turn_workspace(dir))
    )(work_dir);
    this.#work_orders = (
      dependencies.work_order_factory ?? ((dir: string) => new WorkOrderManager(dir))
    )(work_dir);
    this.#human_requests = (
      dependencies.human_request_factory ?? ((dir: string) => new HumanRequestManager(dir))
    )(work_dir);
    this.#sleep = dependencies.sleep ?? sleep;
    this.#start_child_agents = dependencies.start_child_agents ?? false;
    this.#retry_delay_seconds = dependencies.retry_delay_seconds ?? TURN_ERROR_RETRY_DELAY_SECONDS;
    this.#sleep_poll_interval_ms = dependencies.sleep_poll_interval_ms ?? SLEEP_POLL_INTERVAL_MS;
    this.#child_runtime_factory =
      dependencies.child_runtime_factory ??
      ((agent_dir: string) => new AgentRuntime(agent_dir, false, dependencies));
  }

  async run() {
    await this.#resume_sleep_if_needed();
    this.#run_state.mark_started();
    while (true) {
      try {
        const result = await this.#execute_turn();
        if (result.state.next_action === "stop") {
          this.#run_state.mark_stopped(result.state);
          this.#commit_runtime_checkpoint();
          return;
        }
        if (result.state.sleep_duration > 0) {
          this.#run_state.mark_sleep(result.state, result.state.sleep_duration);
          this.#commit_runtime_checkpoint();
          await this.#sleep_until_timeout_or_wakeup(
            result.state.sleep_duration,
            result.wakeup_candidates,
          );
        }
      } catch (error) {
        const message = this.#get_turn_error_message(error);
        this.#log.error(message);
        console.error(message);
        this.#run_state.mark_sleep(null, this.#retry_delay_seconds, this.#stringify_error(error));
        this.#commit_runtime_checkpoint();
        await this.#sleep(this.#retry_delay_seconds * 1000);
      }
    }
  }

  async run_once(): Promise<LoopState> {
    this.#run_state.mark_started();
    try {
      const result = await this.#execute_turn();
      this.#run_state.mark_stopped(result.state);
      this.#commit_runtime_checkpoint();
      return result.state;
    } catch (error) {
      this.#run_state.mark_failed(error, get_turn_id(this.work_dir));
      this.#commit_runtime_checkpoint();
      throw error;
    }
  }

  async run_with_mode(mode: AgentRuntimeRunMode): Promise<void> {
    if (mode === "once") {
      await this.run_once();
      return;
    }
    await this.run();
  }

  async #execute_turn(): Promise<TurnExecutionResult> {
    const turn_id = get_turn_id(this.work_dir);
    this.#work_orders.sync_completed_inbox_reports_to_parent();
    this.#sync_active_outbox_to_children();
    const turn_context = this.#resolve_next_turn_context();
    this.#run_state.mark_active(turn_id, null, turn_context);
    const wakeup_candidates = this.#collect_wakeup_candidates();
    const execution_dir = this.#turn_workspace.prepare(turn_id);
    this.#run_state.mark_active(turn_id, execution_dir, turn_context);
    let state: LoopState;
    try {
      state = await this.#turn_runner_factory(execution_dir, this.is_root, turn_context).run();
      append_jsonl(get_state_log_path(execution_dir), state);
      this.#turn_workspace.commit_and_merge(state);
    } catch (error) {
      throw error as unknown;
    }
    try {
      this.#turn_workspace.cleanup();
    } catch (error) {
      this.#log.warn(`清理轮次 worktree 失败: ${this.#stringify_error(error)}`);
    }
    this.#log.info(
      `运行轮次完成（turn_id=${state.turn_id}，next_action=${state.next_action}）: ${state.summary}`,
    );
    this.#work_orders.sync_completed_inbox_reports_to_parent();
    this.#sync_active_outbox_to_children();
    for (const relative_work_order_path of state.delegated_work_orders) {
      wakeup_candidates.work_orders.add(relative_work_order_path);
    }
    for (const relative_request_path of state.human_requests) {
      wakeup_candidates.human_requests.add(relative_request_path);
    }
    for (const relative_request_path of this.#human_requests.list_waiting_request_paths()) {
      wakeup_candidates.human_requests.add(relative_request_path);
    }
    return {
      state,
      wakeup_candidates,
    };
  }

  #get_turn_error_message(error: unknown): string {
    const turn_id =
      error instanceof TurnValidationExhaustedError ? error.turn_id : get_turn_id(this.work_dir);
    const retry_message = `将在 ${this.#retry_delay_seconds} 秒后重试`;
    if (error instanceof Error) {
      return `运行轮次失败（turn_id=${turn_id}，${retry_message}）: ${error.name}: ${error.message}`;
    }
    return `运行轮次失败（turn_id=${turn_id}，${retry_message}）: ${String(error)}`;
  }

  #sync_active_outbox_to_children() {
    const delegated_work_orders = this.#work_orders.list_active_work_order_paths("outbox");
    for (const relative_work_order_path of delegated_work_orders) {
      const executor = this.#work_orders.read_work_order_executor(relative_work_order_path);
      if (!executor) {
        this.#log.warn(`跳过同步委派工作单，缺少 executor：${relative_work_order_path}`);
        continue;
      }
      const agent_config = find_agent_config(this.work_dir, executor);
      if (!agent_config) {
        this.#log.warn(
          `跳过同步委派工作单，executor 未匹配任何子代理：${executor}，${relative_work_order_path}`,
        );
        continue;
      }
      this.#work_orders.sync_outbox_work_order_to_child(agent_config.dir, relative_work_order_path);
      if (this.#start_child_agents) {
        this.#start_child_agent(agent_config.dir);
      }
    }
  }

  #resolve_next_turn_context(): TurnRunContext {
    const invalid_check_target =
      this.#work_orders.list_inbox_order_targets_with_invalid_work_check()[0];
    if (invalid_check_target) {
      return { turn_type: "work_check", target_work_order_path: invalid_check_target };
    }
    const failed_target = this.#work_orders.list_inbox_order_targets_by_check_status("failed")[0];
    if (failed_target) {
      return { turn_type: "repair", target_work_order_path: failed_target };
    }
    const missing_check_target =
      this.#work_orders.list_inbox_order_targets_with_missing_check_status()[0];
    if (missing_check_target) {
      this.#work_orders.set_completion_report_check_status(missing_check_target, "pending");
      return { turn_type: "work_check", target_work_order_path: missing_check_target };
    }
    const pending_target = this.#work_orders.list_inbox_order_targets_by_check_status("pending")[0];
    if (pending_target) {
      return { turn_type: "work_check", target_work_order_path: pending_target };
    }
    const execution_target =
      this.#work_orders.list_inbox_order_targets_without_completion_report()[0];
    if (execution_target) {
      return create_execution_turn_context(execution_target);
    }
    return create_execution_turn_context();
  }

  async #resume_sleep_if_needed() {
    const state = read_agent_run_state(this.work_dir);
    if (state?.status !== "sleep" || !state.sleep_until) return;
    const remaining_ms = Date.parse(state.sleep_until) - Date.now();
    if (!Number.isFinite(remaining_ms) || remaining_ms <= 0) return;
    this.#sync_active_outbox_to_children();
    await this.#sleep_until_timeout_or_wakeup(
      remaining_ms / 1000,
      this.#collect_wakeup_candidates(),
    );
  }

  #collect_wakeup_candidates(): WakeupCandidates {
    return {
      work_orders: new Set(this.#work_orders.list_active_work_order_paths("outbox")),
      human_requests: new Set(this.#human_requests.list_waiting_request_paths()),
    };
  }

  async #sleep_until_timeout_or_wakeup(
    sleep_duration_seconds: number,
    wakeup_candidates: WakeupCandidates,
  ) {
    let remaining_ms = sleep_duration_seconds * 1000;
    while (remaining_ms > 0) {
      if (this.#is_wakeup_triggered(wakeup_candidates)) return;
      const wait_ms = Math.min(this.#sleep_poll_interval_ms, remaining_ms);
      await this.#sleep(wait_ms);
      remaining_ms -= wait_ms;
    }
  }

  #is_wakeup_triggered(wakeup_candidates: WakeupCandidates): boolean {
    for (const relative_work_order_path of wakeup_candidates.work_orders) {
      if (this.#work_orders.is_work_order_completed(relative_work_order_path)) {
        return true;
      }
    }
    for (const relative_request_path of wakeup_candidates.human_requests) {
      if (this.#human_requests.is_request_done(relative_request_path)) {
        return true;
      }
    }
    return false;
  }

  #start_child_agent(agent_dir: string) {
    if (this.#running_children.has(agent_dir)) return;
    const child_agent = this.#child_runtime_factory(agent_dir);
    const child_task = child_agent
      .run()
      .catch((error) => {
        const message = `子代理启动失败: ${agent_dir} ${this.#stringify_error(error)}`;
        this.#log.error(message);
        console.error(`子代理启动失败: ${agent_dir}`, error);
      })
      .finally(() => {
        this.#running_children.delete(agent_dir);
      });
    this.#running_children.set(agent_dir, child_task);
  }

  #stringify_error(error: unknown): string {
    if (error instanceof Error) return `${error.name}: ${error.message}`;
    return String(error);
  }

  #commit_runtime_checkpoint(): void {
    this.#turn_workspace.commit_current_changes("loong system checkpoint");
  }
}
