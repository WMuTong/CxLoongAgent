import fs from "node:fs";
import path from "node:path";
import { load_agent_config, load_agent_configs } from "../../agent/index.js";
import { create_daemon_manager, is_daemon_effectively_running } from "../../runtime/daemon.js";
import {
  type LoopState,
  get_state_log_path,
  get_turn_events_log_path,
} from "../../runtime/index.js";
import type { AgentRunState, AgentRunStatus } from "../../runtime/run-state.js";
import {
  type AgentTokenUsage,
  create_empty_token_usage,
  read_agent_run_state,
  resolve_effective_agent_run_status,
} from "../../runtime/run-state.js";
import { read_jsonl, read_jsonl_last } from "../../storage/index.js";
import { clip_text, format_agent_path } from "../format.js";
import { collect_recent_activity } from "./activity.js";
import {
  type ActivitySnapshot,
  type AgentObserveSnapshot,
  type AgentTurnDetailSnapshot,
  type AgentWorkspace,
  type DashboardSnapshot,
  MAX_SUMMARY_LENGTH,
  type TurnEventSnapshot,
} from "./model.js";
import { resolve_plan_lines } from "./plan.js";

export function collect_dashboard_snapshot(root_dir: string): DashboardSnapshot {
  return new DashboardSnapshotCollector(root_dir).collect();
}

export class DashboardSnapshotCollector {
  constructor(readonly root_dir: string) {}

  collect(): DashboardSnapshot {
    const rendered_at = new Date();
    const daemon = create_daemon_manager(this.root_dir).read_snapshot(rendered_at);
    const runtime_running = is_daemon_effectively_running(daemon);
    const agents = this.#collect_agent_snapshots(runtime_running);
    return {
      root_dir: this.root_dir,
      rendered_at: rendered_at.toISOString(),
      daemon,
      agents,
      usage: sum_agent_usage(agents.map((agent) => agent.usage)),
    };
  }

  #collect_agent_snapshots(runtime_running: boolean): AgentObserveSnapshot[] {
    return collect_agent_workspaces(this.root_dir).map((agent) =>
      new AgentObserveSnapshotBuilder(this.root_dir, agent, runtime_running).build(),
    );
  }
}

function collect_agent_workspaces(root_dir: string): AgentWorkspace[] {
  const root_config = load_agent_config(root_dir);
  const root_name = root_config?.name?.trim() || path.basename(root_dir);
  const result: AgentWorkspace[] = [{ tree_label: root_name, work_dir: root_dir }];
  collect_child_agent_dirs(root_dir, [], result);
  return result;
}

function collect_child_agent_dirs(
  work_dir: string,
  ancestor_last_flags: boolean[],
  result: AgentWorkspace[],
): void {
  const agent_configs = load_agent_configs(work_dir);
  agent_configs.forEach((config, index) => {
    const is_last = index === agent_configs.length - 1;
    const child_dir = config.dir;
    const name = config.name.trim() || path.basename(child_dir);
    result.push({
      tree_label: `${format_tree_prefix(ancestor_last_flags, is_last)}${name}`,
      work_dir: child_dir,
    });
    collect_child_agent_dirs(child_dir, [...ancestor_last_flags, is_last], result);
  });
}

class AgentObserveSnapshotBuilder {
  constructor(
    readonly root_dir: string,
    readonly agent: AgentWorkspace,
    readonly runtime_running: boolean,
  ) {}

  build(): AgentObserveSnapshot {
    const run_state = read_agent_run_state(this.agent.work_dir);
    const detail_work_dir = resolve_detail_work_dir(this.agent.work_dir, run_state);
    const last_state = read_jsonl_last<LoopState>(get_state_log_path(detail_work_dir));
    const events = read_turn_events(detail_work_dir);
    const last_event = events.length > 0 ? events[events.length - 1] : null;
    const turn_id = resolve_agent_turn_id(run_state, last_event, last_state);
    const current_turn = build_turn_detail(detail_work_dir, turn_id, last_state, events);
    const status = resolve_effective_agent_run_status(
      get_agent_status(run_state, last_event, last_state),
      this.runtime_running,
    );
    return {
      tree_label: this.agent.tree_label,
      display_path: format_agent_path(this.root_dir, this.agent.work_dir),
      status,
      turn_id,
      last_activity: format_latest_activity(last_event),
      sleep_until: status === "sleep" ? (run_state?.sleep_until ?? null) : null,
      usage: run_state?.usage ?? create_empty_token_usage(),
      current_turn,
    };
  }
}

function resolve_detail_work_dir(work_dir: string, run_state: AgentRunState | null): string {
  if (run_state?.status !== "active") return work_dir;
  const active_turn = run_state.active_turn;
  if (!active_turn?.execution_dir) return work_dir;
  if (!fs.existsSync(active_turn.execution_dir)) return work_dir;
  if (!fs.statSync(active_turn.execution_dir).isDirectory()) return work_dir;
  return active_turn.execution_dir;
}

function resolve_agent_turn_id(
  run_state: AgentRunState | null,
  last_event: TurnEventSnapshot | null,
  last_state: LoopState | null,
): string {
  return run_state?.latest_turn_id ?? last_event?.context?.turn_id ?? last_state?.turn_id ?? "-";
}

function build_turn_detail(
  work_dir: string,
  turn_id: string,
  last_state: LoopState | null,
  events: TurnEventSnapshot[],
): AgentTurnDetailSnapshot {
  const activity = collect_recent_activity(work_dir, events, turn_id);
  const plan_lines = resolve_plan_lines(work_dir, turn_id, last_state, events);
  return {
    turn_id,
    turn_type: resolve_turn_type(events, turn_id),
    target_work_order_path: resolve_turn_target_work_order_path(events, turn_id),
    attempt: resolve_turn_attempt(events, turn_id),
    last_activity: resolve_turn_last_activity(events, turn_id),
    summary: clip_text(
      resolve_current_turn_summary(turn_id, last_state, activity, events),
      MAX_SUMMARY_LENGTH,
    ),
    last_error: resolve_turn_error(events, turn_id),
    usage: collect_turn_usage(events, turn_id),
    plan_lines: plan_lines.lines,
    plan_total: plan_lines.total,
    tool_lines: activity.tool_lines,
    tool_total: activity.tool_total,
    file_lines: activity.file_lines,
    file_total: activity.file_total,
    output_lines: activity.output_lines,
    output_total: activity.output_total,
  };
}

function resolve_turn_type(events: TurnEventSnapshot[], turn_id: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.context?.turn_id !== turn_id) continue;
    if (typeof event.context.turn_type === "string") return event.context.turn_type;
  }
  return "execution";
}

function resolve_turn_target_work_order_path(
  events: TurnEventSnapshot[],
  turn_id: string,
): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.context?.turn_id !== turn_id) continue;
    if (typeof event.context.target_work_order_path === "string") {
      return event.context.target_work_order_path;
    }
  }
  return null;
}

function read_turn_events(work_dir: string): TurnEventSnapshot[] {
  return read_jsonl<TurnEventSnapshot>(get_turn_events_log_path(work_dir));
}

function get_agent_status(
  run_state: AgentRunState | null,
  event: TurnEventSnapshot | null,
  state: LoopState | null,
): AgentRunStatus {
  if (run_state) return run_state.status;
  if (!event) return "stopped";
  if (event.type === "turn.failed") return "failed";
  if (event.type === "validation.failed") return "failed";
  if (event.type === "state.ready" || event.type === "turn.finished") return "stopped";
  return "active";
}

function format_latest_activity(event: TurnEventSnapshot | null): string {
  return event?.recorded_at ?? "-";
}

function resolve_current_turn_summary(
  turn_id: string,
  last_state: LoopState | null,
  activity: ActivitySnapshot,
  events: TurnEventSnapshot[],
): string {
  if (activity.latest_output_summary) return activity.latest_output_summary;
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.context?.turn_id !== turn_id) continue;
    if (event.type === "state.ready" && event.state?.summary?.trim()) {
      return event.state.summary;
    }
  }
  if (last_state?.turn_id === turn_id && last_state.summary.trim()) return last_state.summary;
  return "当前轮次暂无 summary";
}

function format_tree_prefix(ancestor_last_flags: boolean[], is_last: boolean): string {
  const prefix = ancestor_last_flags.map((last) => (last ? "   " : "│  ")).join("");
  return `${prefix}${is_last ? "└─" : "├─"}`;
}

function sum_agent_usage(usages: AgentTokenUsage[]): AgentTokenUsage {
  const total = create_empty_token_usage();
  for (const usage of usages) {
    total.input_tokens += usage.input_tokens;
    total.cached_input_tokens += usage.cached_input_tokens;
    total.output_tokens += usage.output_tokens;
    total.total_tokens += usage.total_tokens;
    if (usage.updated_at && (!total.updated_at || usage.updated_at > total.updated_at)) {
      total.updated_at = usage.updated_at;
    }
  }
  return total;
}

function resolve_turn_attempt(events: TurnEventSnapshot[], turn_id: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.context?.turn_id !== turn_id) continue;
    if (typeof event.context.attempt === "number") return String(event.context.attempt);
  }
  return "-";
}

function resolve_turn_last_activity(events: TurnEventSnapshot[], turn_id: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.context?.turn_id !== turn_id) continue;
    if (event.recorded_at) return event.recorded_at;
  }
  return "-";
}

function resolve_turn_error(events: TurnEventSnapshot[], turn_id: string): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.context?.turn_id !== turn_id) continue;
    if (event.type === "turn.failed" && typeof event.error === "string") return event.error;
    if (event.type === "validation.failed" && typeof event.message === "string") {
      return event.message;
    }
    if (
      event.type === "codex.event" &&
      event.event?.type === "turn.failed" &&
      event.event.error?.message
    ) {
      return event.event.error.message;
    }
  }
  return null;
}

function collect_turn_usage(events: TurnEventSnapshot[], turn_id: string): AgentTokenUsage {
  const usage = create_empty_token_usage();
  for (const event of events) {
    if (event.context?.turn_id !== turn_id) continue;
    if (event.type !== "codex.event" || event.event?.type !== "turn.completed") continue;
    const input_tokens = to_token_count(event.event.usage.input_tokens);
    const cached_input_tokens = to_token_count(event.event.usage.cached_input_tokens);
    const output_tokens = to_token_count(event.event.usage.output_tokens);
    usage.input_tokens += input_tokens;
    usage.cached_input_tokens += cached_input_tokens;
    usage.output_tokens += output_tokens;
    usage.total_tokens += input_tokens + output_tokens;
    if (event.recorded_at && (!usage.updated_at || event.recorded_at > usage.updated_at)) {
      usage.updated_at = event.recorded_at;
    }
  }
  return usage;
}

function to_token_count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
