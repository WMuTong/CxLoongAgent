import fs from "node:fs";
import path from "node:path";
import { Codex, type ThreadEvent, type Usage } from "@openai/codex-sdk";
import { jsonrepair } from "jsonrepair";
import { load_current_agent_never_stop } from "../agent/agent.js";
import type { TurnObserver } from "../observe/types.js";
import { get_system_prompt } from "../prompt/index.js";
import { sleep } from "../utils/index.js";
import { WorkOrderManager } from "../work-order/index.js";
import { get_turn_result_state_path, get_turn_results_dir_path } from "./log.js";
import { type LoopState, LoopStateValidator, get_turn_id } from "./state.js";
import { type TurnRunContext, create_execution_turn_context } from "./turn-context.js";

const MAX_VALIDATE_RETRIES = 3;
const SDK_ERROR_RETRY_DELAY_MS = 10_000;
const MAX_SDK_ERROR_RETRIES = 10;
const SDK_ERROR_RETRY_INPUT = "请继续完成剩下的工作";
const FINAL_STATE_FIELDS = [
  "plan",
  "log",
  "delegated_work_orders",
  "human_requests",
  "is_memory_updated",
  "summary",
  "next_action",
  "sleep_duration",
] as const;

export interface TurnThread {
  runStreamed(input: string): Promise<{
    events: AsyncGenerator<ThreadEvent>;
  }>;
}

export interface TurnThreadFactory {
  startThread(options: { workingDirectory: string; skipGitRepoCheck: boolean }): TurnThread;
}

type TurnRunnerDependencies = {
  codex_factory: () => TurnThreadFactory;
  now: () => Date;
  prompt_factory: (work_dir: string, is_root: boolean, turn_context: TurnRunContext) => string;
  observer: TurnObserver | null;
  sleep: (delay: number) => Promise<unknown>;
  turn_context: TurnRunContext;
};

export class TurnValidationExhaustedError extends Error {
  constructor(
    readonly turn_id: string,
    readonly attempts: number,
    readonly last_validation_error: string,
  ) {
    super(`当前轮次 ${turn_id} 在 ${attempts} 次校验修正后仍未通过：${last_validation_error}`);
    this.name = "TurnValidationExhaustedError";
  }
}

export class TurnRunner {
  readonly #validator: LoopStateValidator;
  readonly #codex_factory: () => TurnThreadFactory;
  readonly #now: () => Date;
  readonly #prompt_factory: (
    work_dir: string,
    is_root: boolean,
    turn_context: TurnRunContext,
  ) => string;
  readonly #observer: TurnObserver | null;
  readonly #sleep: (delay: number) => Promise<unknown>;
  readonly #turn_context: TurnRunContext;
  readonly #work_orders: WorkOrderManager;

  constructor(
    readonly work_dir: string,
    readonly is_root = true,
    dependencies: Partial<TurnRunnerDependencies> = {},
  ) {
    this.#turn_context = dependencies.turn_context ?? create_execution_turn_context();
    this.#validator = new LoopStateValidator(work_dir, is_root, this.#turn_context);
    this.#codex_factory = dependencies.codex_factory ?? (() => new Codex());
    this.#now = dependencies.now ?? (() => new Date());
    this.#prompt_factory = dependencies.prompt_factory ?? get_system_prompt;
    this.#observer = dependencies.observer ?? null;
    this.#sleep = dependencies.sleep ?? sleep;
    this.#work_orders = new WorkOrderManager(work_dir);
  }

  async run(): Promise<LoopState> {
    const codex = this.#codex_factory();
    const thread = codex.startThread({
      workingDirectory: this.work_dir,
      skipGitRepoCheck: true,
    });
    const turn_id = get_turn_id(this.work_dir);
    fs.mkdirSync(get_turn_results_dir_path(this.work_dir), { recursive: true });
    let input = this.#prompt_factory(this.work_dir, this.is_root, this.#turn_context);
    for (let attempt = 1; attempt <= MAX_VALIDATE_RETRIES; attempt += 1) {
      this.#observer?.turn_started?.({
        work_dir: this.work_dir,
        is_root: this.is_root,
        turn_id,
        attempt,
        ...this.#turn_context,
      });
      let turn: { usage: Usage | null };
      try {
        turn = await this.#run_streamed_turn(thread, input, turn_id, attempt);
      } catch (error) {
        await this.#observer?.turn_finished?.({
          work_dir: this.work_dir,
          is_root: this.is_root,
          turn_id,
          attempt,
          ...this.#turn_context,
        });
        throw error;
      }
      const state_result = this.#read_turn_state(turn_id);
      const state = state_result.state;
      let error = state_result.error;
      if (!error && state) {
        if (state.delegated_work_orders.length > 0 || state.human_requests.length > 0) {
          state.next_action = "continue";
        }
        this.#apply_turn_context_next_action(state);
        if (this.is_root && load_current_agent_never_stop(this.work_dir)) {
          state.next_action = "continue";
        }
        error = this.#validator.validate(state, turn_id);
      }
      if (error) {
        this.#observer?.validation_failed?.(error, {
          work_dir: this.work_dir,
          is_root: this.is_root,
          turn_id,
          attempt,
          ...this.#turn_context,
        });
        if (attempt === MAX_VALIDATE_RETRIES) {
          this.#observer?.turn_failed?.(error, {
            work_dir: this.work_dir,
            is_root: this.is_root,
            turn_id,
            attempt,
            ...this.#turn_context,
          });
          await this.#observer?.turn_finished?.({
            work_dir: this.work_dir,
            is_root: this.is_root,
            turn_id,
            attempt,
            ...this.#turn_context,
          });
          throw new TurnValidationExhaustedError(turn_id, attempt, error);
        }
        input = `你写入的最终状态文件不符合要求，请先修正问题后再重新写入最终状态文件。

最终状态文件路径：
.loong/turn-results/${turn_id}-state.json

修正规则：
- 优先修正本轮已经创建的计划、日志、工作单、完成报告、请求文件或最终状态文件。
- 不要为了修正格式问题再新建第二份本轮计划或工作日志。
- 如果本轮已经误建多份计划或日志，可以删除多余的本轮文件，只保留最终状态文件指向的完整文件；不要修改或删除前序轮次文件。
- 最终聊天消息可以简短说明已修正，不要把最终状态 JSON 当作聊天消息输出。

校验问题如下：
${error}`;
        continue;
      }
      if (!state) {
        throw new Error("最终状态文件解析后为空");
      }
      state.turn_id = turn_id;
      state.updated_at = this.#now().toISOString();
      this.#sync_check_status_after_validation();
      this.#observer?.state_ready?.(state, {
        work_dir: this.work_dir,
        is_root: this.is_root,
        turn_id,
        attempt,
        usage: turn.usage,
        ...this.#turn_context,
      });
      await this.#observer?.turn_finished?.({
        work_dir: this.work_dir,
        is_root: this.is_root,
        turn_id,
        attempt,
        usage: turn.usage,
        ...this.#turn_context,
      });
      fs.rmSync(get_turn_result_state_path(this.work_dir, turn_id), { force: true });
      return state;
    }
    throw new TurnValidationExhaustedError(turn_id, MAX_VALIDATE_RETRIES, "未知校验错误");
  }

  async #run_streamed_turn(
    thread: TurnThread,
    input: string,
    turn_id: string,
    attempt: number,
  ): Promise<{ usage: Usage | null }> {
    let sdk_retries = 0;
    let current_input = input;
    while (true) {
      try {
        return await this.#run_streamed_turn_once(thread, current_input, turn_id, attempt);
      } catch (error) {
        if (!(error instanceof TurnSdkError)) throw error;
        if (sdk_retries >= MAX_SDK_ERROR_RETRIES) {
          const message = `SDK 错误重试 ${MAX_SDK_ERROR_RETRIES} 次仍失败：${error.message}`;
          this.#observer?.turn_failed?.(message, {
            work_dir: this.work_dir,
            is_root: this.is_root,
            turn_id,
            attempt,
            ...this.#turn_context,
          });
          throw new Error(message);
        }
        sdk_retries += 1;
        current_input = SDK_ERROR_RETRY_INPUT;
        await this.#sleep(SDK_ERROR_RETRY_DELAY_MS);
      }
    }
  }

  async #run_streamed_turn_once(
    thread: TurnThread,
    input: string,
    turn_id: string,
    attempt: number,
  ): Promise<{ usage: Usage | null }> {
    let events: AsyncGenerator<ThreadEvent>;
    try {
      ({ events } = await thread.runStreamed(input));
    } catch (error) {
      throw new TurnSdkError(this.#stringify_error(error));
    }
    let usage: Usage | null = null;
    while (true) {
      let result: IteratorResult<ThreadEvent>;
      try {
        result = await events.next();
      } catch (error) {
        throw new TurnSdkError(this.#stringify_error(error));
      }
      if (result.done) break;
      const event = result.value;
      this.#observer?.codex_event?.(event, {
        work_dir: this.work_dir,
        is_root: this.is_root,
        turn_id,
        attempt,
        ...this.#turn_context,
      });
      if (event.type === "turn.completed") {
        usage = event.usage;
      } else if (event.type === "turn.failed") {
        throw new TurnSdkError(event.error.message);
      } else if (event.type === "error") {
        throw new TurnSdkError(event.message);
      }
    }
    return { usage };
  }

  #read_turn_state(turn_id: string): { state: LoopState | null; error: string | null } {
    const file_path = get_turn_result_state_path(this.work_dir, turn_id);
    const relative_path = path.posix.join(".loong", "turn-results", `${turn_id}-state.json`);
    if (!fs.existsSync(file_path)) {
      return {
        state: null,
        error: `最终状态文件不存在：${relative_path}`,
      };
    }
    let parsed: unknown;
    try {
      parsed = this.#parse_json_with_repair(fs.readFileSync(file_path, "utf-8"));
    } catch (error) {
      return {
        state: null,
        error: `最终状态文件不是可修复的 JSON：${this.#stringify_error(error)}`,
      };
    }
    return this.#normalize_turn_state(parsed);
  }

  #parse_json_with_repair(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return JSON.parse(jsonrepair(text));
    }
  }

  #normalize_turn_state(value: unknown): { state: LoopState | null; error: string | null } {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        state: null,
        error: "最终状态文件内容必须是 JSON 对象。",
      };
    }
    const data = value as Record<string, unknown>;
    const errors: string[] = [];
    const allowed_fields = new Set<string>(FINAL_STATE_FIELDS);
    for (const key of Object.keys(data)) {
      if (!allowed_fields.has(key)) {
        errors.push(`不能包含未定义字段 "${key}"。`);
      }
    }
    const required_fields = FINAL_STATE_FIELDS.filter(
      (field) => field !== "delegated_work_orders" && field !== "human_requests",
    );
    for (const field of required_fields) {
      if (!(field in data)) {
        errors.push(`缺少必需字段 "${field}"。`);
      }
    }
    if (typeof data.plan !== "string") errors.push('字段 "plan" 必须是字符串。');
    if (typeof data.log !== "string") errors.push('字段 "log" 必须是字符串。');
    if (typeof data.is_memory_updated !== "boolean") {
      errors.push('字段 "is_memory_updated" 必须是布尔值。');
    }
    if (typeof data.summary !== "string") errors.push('字段 "summary" 必须是字符串。');
    if (data.next_action !== "continue" && data.next_action !== "stop") {
      errors.push('字段 "next_action" 必须是 "continue" 或 "stop"。');
    }
    if (typeof data.sleep_duration !== "number" || !Number.isFinite(data.sleep_duration)) {
      errors.push('字段 "sleep_duration" 必须是有限数字。');
    }
    const delegated_work_orders = this.#normalize_string_array(
      data.delegated_work_orders,
      "delegated_work_orders",
      errors,
    );
    const human_requests = this.#normalize_string_array(
      data.human_requests,
      "human_requests",
      errors,
    );
    if (errors.length > 0) {
      return {
        state: null,
        error: `# 校验失败\n\n## 最终状态文件存在如下问题\n${errors.map((item) => `- ${item}`).join("\n")}`,
      };
    }
    return {
      state: {
        turn_id: "",
        updated_at: "",
        plan: data.plan as string,
        log: data.log as string,
        delegated_work_orders,
        human_requests,
        is_memory_updated: data.is_memory_updated as boolean,
        summary: data.summary as string,
        next_action: data.next_action as "continue" | "stop",
        sleep_duration: data.sleep_duration as number,
      },
      error: null,
    };
  }

  #normalize_string_array(value: unknown, field: string, errors: string[]): string[] {
    if (value === null || value === undefined) return [];
    if (!Array.isArray(value)) {
      errors.push(`字段 "${field}" 必须是字符串数组。`);
      return [];
    }
    const invalid_index = value.findIndex((item) => typeof item !== "string");
    if (invalid_index >= 0) {
      errors.push(`字段 "${field}" 的第 ${invalid_index + 1} 项必须是字符串。`);
      return [];
    }
    return value as string[];
  }

  #apply_turn_context_next_action(state: LoopState): void {
    if (this.#turn_context.turn_type === "execution" && this.#turn_context.target_work_order_path) {
      state.next_action = "continue";
      if (this.#work_orders.has_completion_report(this.#turn_context.target_work_order_path)) {
        state.sleep_duration = 0;
      }
      return;
    }
    if (this.#turn_context.turn_type === "repair") {
      state.next_action = "continue";
      state.sleep_duration = 0;
      return;
    }
    if (this.#turn_context.turn_type === "work_check") {
      const target = this.#turn_context.target_work_order_path;
      const open_issue_count = target
        ? this.#work_orders.read_work_check_open_issue_count(target)
        : null;
      state.next_action = open_issue_count === 0 ? "stop" : "continue";
      state.sleep_duration = 0;
    }
  }

  #sync_check_status_after_validation(): void {
    const target = this.#turn_context.target_work_order_path;
    if (!target) return;
    if (this.#turn_context.turn_type === "execution") {
      this.#work_orders.set_completion_report_check_status(target, "pending");
      return;
    }
    if (this.#turn_context.turn_type === "repair") {
      this.#work_orders.set_completion_report_check_status(target, "pending");
      return;
    }
    const open_issue_count = this.#work_orders.read_work_check_open_issue_count(target);
    if (open_issue_count === 0) {
      this.#work_orders.set_completion_report_check_status(target, "passed");
      return;
    }
    this.#work_orders.set_completion_report_check_status(target, "failed");
  }

  #stringify_error(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }
}

class TurnSdkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TurnSdkError";
  }
}
