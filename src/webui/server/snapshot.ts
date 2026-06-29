import fs from "node:fs";
import path from "node:path";
import { load_agent_config, load_agent_configs } from "../../agent/index.js";
import { HumanRequestManager } from "../../human-request/index.js";
import { collect_dashboard_snapshot } from "../../observe/dashboard/snapshot.js";
import { type LoopState, get_turn_events_log_path } from "../../runtime/index.js";
import { get_run_state_path, get_state_log_path } from "../../runtime/log.js";
import {
  type AgentRunState,
  create_empty_token_usage,
  read_agent_run_state,
} from "../../runtime/run-state.js";
import { parse_human_request, parse_work_log, read_jsonl } from "../../storage/index.js";
import { resolve_inside_work_dir, to_relative_posix_path } from "../../utils/index.js";
import { WorkOrderManager } from "../../work-order/index.js";
import type {
  WebuiAgentSnapshot,
  WebuiLogSnapshot,
  WebuiMarkdownFileSnapshot,
  WebuiMemorySnapshot,
  WebuiPlanSnapshot,
  WebuiSnapshot,
  WebuiStateSnapshot,
  WebuiTurnEventSnapshot,
  WebuiTurnSnapshot,
} from "./types.js";

const MAX_WEBUI_TURNS = 50;

type AgentWorkspace = {
  agent_path: string;
  name: string;
  position: string;
  description: string;
  sort_index: number;
  work_dir: string;
};

export function collect_webui_snapshot(root_dir: string): WebuiSnapshot {
  const root = path.resolve(root_dir);
  return {
    dashboard: collect_dashboard_snapshot(root),
    agents: collect_agent_workspaces(root).map((workspace) =>
      build_agent_snapshot(root, workspace),
    ),
  };
}

function build_agent_snapshot(root_dir: string, workspace: AgentWorkspace): WebuiAgentSnapshot {
  const run_state = read_agent_run_state(workspace.work_dir);
  const detail_work_dir = resolve_detail_work_dir(workspace.work_dir, run_state);
  const work_orders = new WorkOrderManager(detail_work_dir);
  const human_requests = collect_human_request_summaries(root_dir, workspace);
  return {
    agent_path: workspace.agent_path,
    name: workspace.name,
    position: workspace.position,
    description: workspace.description,
    sort_index: workspace.sort_index,
    state: collect_state_snapshot(workspace.work_dir),
    role_instruction: collect_role_instruction_snapshot(root_dir, workspace.work_dir),
    memory: collect_memory_snapshots(root_dir, workspace.work_dir),
    turns: collect_turn_snapshots(workspace.work_dir, detail_work_dir),
    work_orders: {
      inbox: work_orders.list_work_order_snapshots("inbox"),
      outbox: work_orders.list_work_order_snapshots("outbox"),
    },
    human_requests,
  };
}

function resolve_detail_work_dir(work_dir: string, run_state: AgentRunState | null): string {
  if (run_state?.status !== "active") return work_dir;
  const execution_dir = run_state.active_turn?.execution_dir;
  if (!execution_dir || !fs.existsSync(execution_dir)) return work_dir;
  return fs.statSync(execution_dir).isDirectory() ? execution_dir : work_dir;
}

function collect_state_snapshot(work_dir: string): WebuiStateSnapshot {
  const file_path = get_run_state_path(work_dir);
  return {
    relative_path: to_relative_posix_path(work_dir, file_path),
    data: read_agent_run_state(work_dir),
    raw: fs.existsSync(file_path) ? fs.readFileSync(file_path, "utf-8").trim() : null,
  };
}

function collect_human_request_summaries(_root_dir: string, workspace: AgentWorkspace) {
  return new HumanRequestManager(workspace.work_dir).list_snapshots().map((request) => {
    const resolved = resolve_inside_work_dir(workspace.work_dir, request.relative_path);
    const parsed = resolved ? parse_human_request(resolved.absolute_path) : null;
    return {
      agent_path: workspace.agent_path,
      relative_path: request.relative_path,
      summary: request.summary,
      status: request.status,
      turn_id: read_frontmatter_string(parsed?.data.turn_id),
      created_at: read_frontmatter_string(parsed?.data.created_at),
      content: parsed?.content.trim() ?? "",
    };
  });
}

function collect_role_instruction_snapshot(
  root_dir: string,
  work_dir: string,
): WebuiMarkdownFileSnapshot | null {
  const file_path = find_agents_doc_path(work_dir);
  if (!file_path) return null;
  const stat = fs.statSync(file_path);
  return {
    relative_path: to_relative_posix_path(root_dir, file_path),
    content: fs.readFileSync(file_path, "utf-8"),
    updated_at: stat.mtime.toISOString(),
  };
}

function find_agents_doc_path(work_dir: string): string | null {
  if (!fs.existsSync(work_dir) || !fs.statSync(work_dir).isDirectory()) return null;
  const entry = fs
    .readdirSync(work_dir, { withFileTypes: true })
    .find((candidate) => candidate.isFile() && candidate.name.toLowerCase() === "agents.md");
  return entry ? path.join(work_dir, entry.name) : null;
}

function collect_memory_snapshots(root_dir: string, work_dir: string): WebuiMemorySnapshot[] {
  const memory_dir = path.join(work_dir, ".loong", "memory");
  if (!fs.existsSync(memory_dir) || !fs.statSync(memory_dir).isDirectory()) return [];
  return fs
    .readdirSync(memory_dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => {
      const file_path = path.join(memory_dir, entry.name);
      const stat = fs.statSync(file_path);
      return {
        relative_path: to_relative_posix_path(root_dir, file_path),
        title: entry.name.replace(/\.md$/i, ""),
        content: fs.readFileSync(file_path, "utf-8"),
        updated_at: stat.mtime.toISOString(),
      };
    });
}

function collect_turn_snapshots(work_dir: string, detail_work_dir: string): WebuiTurnSnapshot[] {
  const events = read_jsonl<TurnEventRecord>(get_turn_events_log_path(detail_work_dir));
  const state_log = read_jsonl<LoopState>(get_state_log_path(work_dir));
  const grouped = new Map<string, TurnEventRecord[]>();
  for (const event of events) {
    const turn_id = normalize_turn_id(event.context?.turn_id);
    if (!turn_id) continue;
    const existing = grouped.get(turn_id) ?? [];
    existing.push(event);
    grouped.set(turn_id, existing);
  }
  return [...grouped.entries()]
    .map(([turn_id, turn_events]) =>
      build_turn_snapshot(turn_id, turn_events, state_log, detail_work_dir),
    )
    .sort((left, right) => compare_nullable_time(right.last_activity, left.last_activity))
    .slice(0, MAX_WEBUI_TURNS);
}

function build_turn_snapshot(
  turn_id: string,
  events: TurnEventRecord[],
  state_log: LoopState[],
  work_dir: string,
): WebuiTurnSnapshot {
  const usage = create_empty_token_usage();
  let attempt = "-";
  let started_at: string | null = null;
  let finished_at: string | null = null;
  let last_activity: string | null = null;
  let status = "running";
  let summary: string | null = null;
  let plan_path: string | null = null;
  let log_path: string | null = null;
  let loop_state: LoopState | null = find_loop_state(state_log, turn_id);

  for (const event of events) {
    if (typeof event.context?.attempt === "number") attempt = String(event.context.attempt);
    if (event.recorded_at) last_activity = event.recorded_at;
    if (event.type === "turn.started") started_at = event.recorded_at ?? started_at;
    if (event.type === "turn.finished") {
      status = "completed";
      finished_at = event.recorded_at ?? finished_at;
    }
    if (event.type === "turn.failed" || event.type === "validation.failed") {
      status = "failed";
      finished_at = event.recorded_at ?? finished_at;
    }
    const state = event.state;
    if (state) {
      loop_state = normalize_loop_state(state) ?? loop_state;
      summary = normalize_string(state.summary) ?? summary;
      plan_path = normalize_string(state.plan) ?? plan_path;
      log_path = normalize_string(state.log) ?? log_path;
    }
    const codex_usage = read_codex_usage(event);
    if (codex_usage) {
      usage.input_tokens += codex_usage.input_tokens;
      usage.cached_input_tokens += codex_usage.cached_input_tokens;
      usage.output_tokens += codex_usage.output_tokens;
      usage.total_tokens += codex_usage.input_tokens + codex_usage.output_tokens;
      usage.updated_at = event.recorded_at ?? usage.updated_at;
    }
    summary = read_agent_message_summary(event) ?? summary;
  }

  summary = normalize_string(loop_state?.summary) ?? summary;
  plan_path =
    normalize_string(loop_state?.plan) ?? plan_path ?? find_turn_plan_path(work_dir, turn_id);
  log_path = normalize_string(loop_state?.log) ?? log_path;

  return {
    turn_id,
    turn_type: resolve_turn_type(events),
    target_work_order_path: resolve_turn_target_work_order_path(events),
    attempt,
    status,
    started_at,
    finished_at,
    last_activity,
    summary,
    state: loop_state,
    plan_path,
    plan: plan_path ? read_plan_snapshot(work_dir, plan_path) : null,
    log_path,
    log: log_path ? read_log_snapshot(work_dir, log_path) : null,
    usage,
    events: events.map(format_turn_event),
  };
}

function resolve_turn_type(events: TurnEventRecord[]): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (typeof event.context?.turn_type === "string") return event.context.turn_type;
  }
  return "execution";
}

function resolve_turn_target_work_order_path(events: TurnEventRecord[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (typeof event.context?.target_work_order_path === "string") {
      return event.context.target_work_order_path;
    }
  }
  return null;
}

function find_loop_state(states: LoopState[], turn_id: string): LoopState | null {
  for (let index = states.length - 1; index >= 0; index -= 1) {
    if (states[index].turn_id === turn_id) return states[index];
  }
  return null;
}

function find_turn_plan_path(work_dir: string, turn_id: string): string | null {
  if (!turn_id || turn_id === "-") return null;
  const plans_dir = path.join(work_dir, ".loong", "work-plans");
  if (!fs.existsSync(plans_dir) || !fs.statSync(plans_dir).isDirectory()) return null;
  const pattern = new RegExp(`^${escape_regexp(turn_id)}-\\d{8}T\\d{6}-plan\\.json$`);
  const candidates = fs
    .readdirSync(plans_dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && pattern.test(entry.name))
    .map((entry) => path.join(plans_dir, entry.name))
    .sort((left, right) => right.localeCompare(left));
  return candidates[0] ? to_relative_posix_path(work_dir, candidates[0]) : null;
}

function normalize_loop_state(state: Partial<LoopState>): LoopState | null {
  if (
    typeof state.turn_id !== "string" ||
    typeof state.updated_at !== "string" ||
    typeof state.plan !== "string" ||
    typeof state.log !== "string" ||
    !Array.isArray(state.delegated_work_orders) ||
    !Array.isArray(state.human_requests) ||
    typeof state.is_memory_updated !== "boolean" ||
    typeof state.summary !== "string" ||
    (state.next_action !== "continue" && state.next_action !== "stop") ||
    typeof state.sleep_duration !== "number"
  ) {
    return null;
  }
  return state as LoopState;
}

function read_plan_snapshot(work_dir: string, relative_path: string): WebuiPlanSnapshot {
  const resolved = resolve_inside_work_dir(work_dir, relative_path);
  if (!resolved || !fs.existsSync(resolved.absolute_path)) {
    return {
      relative_path,
      turn_id: null,
      created_at: null,
      items: [],
      error: "计划文件不存在或路径非法。",
    };
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved.absolute_path, "utf-8")) as {
      turn_id?: unknown;
      created_at?: unknown;
      plans?: unknown;
    };
    const plans = Array.isArray(parsed.plans) ? parsed.plans : [];
    return {
      relative_path: resolved.normalized_path,
      turn_id: read_frontmatter_string(parsed.turn_id),
      created_at: read_frontmatter_string(parsed.created_at),
      items: plans.map((item, index) => normalize_plan_item(item, index)),
      error: Array.isArray(parsed.plans) ? null : "计划文件缺少 plans 数组。",
    };
  } catch {
    return {
      relative_path: resolved.normalized_path,
      turn_id: null,
      created_at: null,
      items: [],
      error: "计划文件不是合法 JSON。",
    };
  }
}

function normalize_plan_item(item: unknown, index: number) {
  if (!is_record(item)) {
    return {
      step: String(index + 1),
      description: String(item ?? ""),
      status: "unknown",
      deviation: null,
    };
  }
  return {
    step: read_frontmatter_string(item.step) ?? String(index + 1),
    description: read_frontmatter_string(item.description) ?? "未描述",
    status: read_frontmatter_string(item.status) ?? "unknown",
    deviation: read_frontmatter_string(item.deviation),
  };
}

function read_log_snapshot(work_dir: string, relative_path: string): WebuiLogSnapshot {
  const resolved = resolve_inside_work_dir(work_dir, relative_path);
  if (!resolved || !fs.existsSync(resolved.absolute_path)) {
    return {
      relative_path,
      turn_id: null,
      created_at: null,
      content: "",
      sections: [],
      error: "日志文件不存在或路径非法。",
    };
  }
  try {
    const parsed = parse_work_log(resolved.absolute_path);
    const content = parsed.content.trim();
    return {
      relative_path: resolved.normalized_path,
      turn_id: read_frontmatter_string(parsed.data.turn_id),
      created_at: read_frontmatter_string(parsed.data.created_at),
      content,
      sections: parse_markdown_sections(content),
      error: null,
    };
  } catch {
    return {
      relative_path: resolved.normalized_path,
      turn_id: null,
      created_at: null,
      content: "",
      sections: [],
      error: "日志文件无法解析。",
    };
  }
}

function parse_markdown_sections(content: string): { title: string; content: string }[] {
  if (!content.trim()) return [];
  const sections: { title: string; content: string }[] = [];
  const lines = content.split(/\r?\n/);
  let current_title = "正文";
  let current_lines: string[] = [];
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current_lines.join("\n").trim()) {
        sections.push({ title: current_title, content: current_lines.join("\n").trim() });
      }
      current_title = heading[2];
      current_lines = [];
      continue;
    }
    current_lines.push(line);
  }
  if (current_lines.join("\n").trim()) {
    sections.push({ title: current_title, content: current_lines.join("\n").trim() });
  }
  return sections.length > 0 ? sections : [{ title: "正文", content: content.trim() }];
}

function format_turn_event(event: TurnEventRecord): WebuiTurnEventSnapshot {
  return {
    recorded_at: event.recorded_at ?? "",
    type: event.type,
    detail: summarize_turn_event(event),
    raw: JSON.stringify(event, null, 2),
  };
}

function summarize_turn_event(event: TurnEventRecord): string {
  if (event.type !== "codex.event") {
    return normalize_string(event.message) ?? normalize_string(event.error) ?? event.type;
  }
  const codex_event = event.event;
  if (!is_record(codex_event)) return "codex.event";
  const codex_type = normalize_string(codex_event.type) ?? "codex.event";
  const item = codex_event.item;
  if (!is_record(item)) return codex_type;
  const item_type = normalize_string(item.type);
  if (item_type === "command_execution") {
    const command = normalize_string(item.command) ?? "";
    const status = normalize_string(item.status) ?? "";
    return `${codex_type} · ${status} · ${command}`;
  }
  if (item_type === "agent_message") {
    return `${codex_type} · ${clip_inline(normalize_string(item.text) ?? "", 180)}`;
  }
  if (item_type === "file_change") return `${codex_type} · file_change`;
  return item_type ? `${codex_type} · ${item_type}` : codex_type;
}

function read_codex_usage(event: TurnEventRecord): {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
} | null {
  if (event.type !== "codex.event" || !is_record(event.event)) return null;
  if (event.event.type !== "turn.completed" || !is_record(event.event.usage)) return null;
  return {
    input_tokens: to_token_count(event.event.usage.input_tokens),
    cached_input_tokens: to_token_count(event.event.usage.cached_input_tokens),
    output_tokens: to_token_count(event.event.usage.output_tokens),
  };
}

function read_agent_message_summary(event: TurnEventRecord): string | null {
  if (event.type !== "codex.event" || !is_record(event.event)) return null;
  const item = event.event.item;
  if (!is_record(item) || item.type !== "agent_message" || typeof item.text !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(item.text) as Partial<LoopState>;
    return normalize_string(parsed.summary);
  } catch {
    return null;
  }
}

function collect_agent_workspaces(root_dir: string): AgentWorkspace[] {
  const result: AgentWorkspace[] = [build_workspace(root_dir, root_dir)];
  collect_child_workspaces(root_dir, root_dir, result);
  return result;
}

function collect_child_workspaces(
  root_dir: string,
  work_dir: string,
  result: AgentWorkspace[],
): void {
  for (const config of load_agent_configs(work_dir)) {
    const child_dir = config.dir;
    result.push(build_workspace(root_dir, child_dir));
    collect_child_workspaces(root_dir, child_dir, result);
  }
}

function build_workspace(root_dir: string, work_dir: string): AgentWorkspace {
  const config = load_agent_config(work_dir);
  const agent_path = to_relative_posix_path(root_dir, work_dir) || ".";
  return {
    agent_path,
    name: config?.name?.trim() || path.basename(work_dir),
    position: config?.position?.trim() || path.basename(work_dir),
    description: config?.description?.trim() || "",
    sort_index: config?.sort_index ?? 0,
    work_dir,
  };
}

type TurnEventRecord = {
  type: string;
  recorded_at?: string;
  context?: {
    turn_id?: unknown;
    attempt?: unknown;
    turn_type?: unknown;
    target_work_order_path?: unknown;
  };
  state?: Partial<LoopState>;
  event?: unknown;
  message?: unknown;
  error?: unknown;
};

function normalize_turn_id(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalize_string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function read_frontmatter_string(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return normalize_string(value);
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function to_token_count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function compare_nullable_time(left: string | null, right: string | null): number {
  return (Date.parse(left ?? "") || 0) - (Date.parse(right ?? "") || 0);
}

function clip_inline(value: string, max_length: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max_length) return normalized;
  return `${normalized.slice(0, max_length - 1)}…`;
}

function escape_regexp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
