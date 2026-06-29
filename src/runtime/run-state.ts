import fs from "node:fs";
import path from "node:path";
import type { Usage } from "@openai/codex-sdk";
import { get_run_state_path } from "./log.js";
import type { LoopState } from "./state.js";
import type { TurnRunContext } from "./turn-context.js";

export type AgentRunStatus = "active" | "sleep" | "stopped" | "failed";

export type AgentTokenUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  updated_at: string | null;
};

export type AgentActiveTurn = {
  turn_id: string;
  execution_dir: string;
  started_at: string;
} & TurnRunContext;

export type AgentRunState = {
  status: AgentRunStatus;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
  latest_turn_id: string | null;
  latest_summary: string | null;
  sleep_until: string | null;
  last_error: string | null;
  usage: AgentTokenUsage;
  active_turn: AgentActiveTurn | null;
};

export function create_empty_token_usage(): AgentTokenUsage {
  return {
    input_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    total_tokens: 0,
    updated_at: null,
  };
}

export function create_initial_run_state(now = new Date()): AgentRunState {
  return {
    status: "stopped",
    started_at: null,
    ended_at: null,
    updated_at: now.toISOString(),
    latest_turn_id: null,
    latest_summary: null,
    sleep_until: null,
    last_error: null,
    usage: create_empty_token_usage(),
    active_turn: null,
  };
}

export function read_agent_run_state(work_dir: string): AgentRunState | null {
  const file_path = get_run_state_path(work_dir);
  if (!fs.existsSync(file_path)) return null;
  const text = fs.readFileSync(file_path, "utf-8").trim();
  if (!text || text === "{}") return null;
  try {
    const data = JSON.parse(text) as Partial<AgentRunState>;
    if (!is_agent_run_status(data.status) || typeof data.updated_at !== "string") return null;
    return {
      status: data.status,
      started_at: typeof data.started_at === "string" ? data.started_at : null,
      ended_at: typeof data.ended_at === "string" ? data.ended_at : null,
      updated_at: data.updated_at,
      latest_turn_id: typeof data.latest_turn_id === "string" ? data.latest_turn_id : null,
      latest_summary: typeof data.latest_summary === "string" ? data.latest_summary : null,
      sleep_until: typeof data.sleep_until === "string" ? data.sleep_until : null,
      last_error: typeof data.last_error === "string" ? data.last_error : null,
      usage: normalize_token_usage(data.usage),
      active_turn: normalize_active_turn(data.active_turn),
    };
  } catch {
    return null;
  }
}

export class AgentRunStateStore {
  constructor(readonly work_dir: string) {}

  write_initial(): void {
    this.#write(create_initial_run_state());
  }

  mark_started(): void {
    const now = new Date().toISOString();
    this.#write({
      ...this.#read_or_initial(now),
      status: "active",
      started_at: now,
      ended_at: null,
      updated_at: now,
      sleep_until: null,
      last_error: null,
      active_turn: null,
    });
  }

  mark_active(
    turn_id: string,
    execution_dir: string | null = null,
    turn_context: TurnRunContext | null = null,
  ): void {
    const now = new Date().toISOString();
    const current = this.#read_or_initial(now);
    this.#write({
      ...current,
      status: "active",
      ended_at: null,
      updated_at: now,
      latest_turn_id: turn_id,
      sleep_until: null,
      last_error: null,
      active_turn: execution_dir
        ? {
            turn_id,
            execution_dir,
            started_at:
              current.active_turn?.turn_id === turn_id ? current.active_turn.started_at : now,
            turn_type: turn_context?.turn_type ?? current.active_turn?.turn_type ?? "execution",
            target_work_order_path:
              turn_context?.target_work_order_path ??
              current.active_turn?.target_work_order_path ??
              null,
          }
        : current.active_turn?.turn_id === turn_id
          ? current.active_turn
          : null,
    });
  }

  mark_sleep(
    state: LoopState | null,
    sleep_duration_seconds: number,
    error: string | null = null,
  ): void {
    const now_date = new Date();
    const now = now_date.toISOString();
    const current = this.#read_or_initial(now);
    this.#write({
      ...current,
      status: "sleep",
      ended_at: null,
      updated_at: now,
      latest_turn_id: state?.turn_id ?? current.latest_turn_id,
      latest_summary: state?.summary ?? current.latest_summary,
      sleep_until: new Date(now_date.getTime() + sleep_duration_seconds * 1000).toISOString(),
      last_error: error,
      active_turn: null,
    });
  }

  mark_stopped(state: LoopState | null = null): void {
    const now = new Date().toISOString();
    const current = this.#read_or_initial(now);
    this.#write({
      ...current,
      status: "stopped",
      ended_at: now,
      updated_at: now,
      latest_turn_id: state?.turn_id ?? current.latest_turn_id,
      latest_summary: state?.summary ?? current.latest_summary,
      sleep_until: null,
      last_error: null,
      active_turn: null,
    });
  }

  mark_failed(error: unknown, turn_id: string | null = null): void {
    const now = new Date().toISOString();
    const current = this.#read_or_initial(now);
    this.#write({
      ...current,
      status: "failed",
      ended_at: now,
      updated_at: now,
      latest_turn_id: turn_id ?? current.latest_turn_id,
      sleep_until: null,
      last_error: stringify_error(error),
      active_turn: null,
    });
  }

  add_usage(usage: Usage): void {
    const now = new Date().toISOString();
    const current = this.#read_or_initial(now);
    const input_tokens = to_token_count(usage.input_tokens);
    const cached_input_tokens = to_token_count(usage.cached_input_tokens);
    const output_tokens = to_token_count(usage.output_tokens);
    const next_usage: AgentTokenUsage = {
      input_tokens: current.usage.input_tokens + input_tokens,
      cached_input_tokens: current.usage.cached_input_tokens + cached_input_tokens,
      output_tokens: current.usage.output_tokens + output_tokens,
      total_tokens: current.usage.total_tokens + input_tokens + output_tokens,
      updated_at: now,
    };
    this.#write({
      ...current,
      updated_at: now,
      usage: next_usage,
    });
  }

  #read_or_initial(now: string): AgentRunState {
    return (
      read_agent_run_state(this.work_dir) ?? {
        ...create_initial_run_state(new Date(now)),
        started_at: now,
      }
    );
  }

  #write(state: AgentRunState): void {
    const file_path = get_run_state_path(this.work_dir);
    fs.mkdirSync(path.dirname(file_path), { recursive: true });
    fs.writeFileSync(file_path, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
  }
}

export function create_agent_run_state_store(work_dir: string): AgentRunStateStore {
  return new AgentRunStateStore(work_dir);
}

export function resolve_effective_agent_run_status(
  status: AgentRunStatus,
  runtime_running: boolean,
): AgentRunStatus {
  if (!runtime_running && is_live_agent_run_status(status)) return "stopped";
  return status;
}

function is_live_agent_run_status(status: AgentRunStatus): boolean {
  return status === "active" || status === "sleep";
}

function is_agent_run_status(status: unknown): status is AgentRunStatus {
  return status === "active" || status === "sleep" || status === "stopped" || status === "failed";
}

function stringify_error(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

function normalize_token_usage(value: unknown): AgentTokenUsage {
  if (!value || typeof value !== "object") return create_empty_token_usage();
  const data = value as Partial<AgentTokenUsage>;
  const input_tokens = to_token_count(data.input_tokens);
  const cached_input_tokens = to_token_count(data.cached_input_tokens);
  const output_tokens = to_token_count(data.output_tokens);
  return {
    input_tokens,
    cached_input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    updated_at: typeof data.updated_at === "string" ? data.updated_at : null,
  };
}

function normalize_active_turn(value: unknown): AgentActiveTurn | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Partial<AgentActiveTurn>;
  if (
    typeof data.turn_id !== "string" ||
    data.turn_id.trim() === "" ||
    typeof data.execution_dir !== "string" ||
    data.execution_dir.trim() === "" ||
    typeof data.started_at !== "string"
  ) {
    return null;
  }
  return {
    turn_id: data.turn_id,
    execution_dir: data.execution_dir,
    started_at: data.started_at,
    turn_type:
      data.turn_type === "work_check" || data.turn_type === "repair" ? data.turn_type : "execution",
    target_work_order_path:
      typeof data.target_work_order_path === "string" ? data.target_work_order_path : null,
  };
}

function to_token_count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}
