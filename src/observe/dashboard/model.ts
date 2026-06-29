import type { ThreadEvent } from "@openai/codex-sdk";
import type { DaemonSnapshot } from "../../runtime/daemon.js";
import type { LoopState } from "../../runtime/index.js";
import type { AgentTokenUsage } from "../../runtime/run-state.js";
import type { TurnRunContext } from "../../runtime/turn-context.js";

export const DEFAULT_REFRESH_INTERVAL_MS = 1000;
export const MAX_SUMMARY_LENGTH = 96;
export const MAX_PLAN_STEPS = 5;
export const MAX_TOOLS = 3;
export const MAX_FILES = 3;
export const MAX_OUTPUTS = 5;
export const MAX_FOCUS_AGENTS = 4;
export const MAX_PATH_LENGTH = 90;
export const MAX_ACTIVITY_LENGTH = 120;

export type TimestampedLine = {
  recorded_at: string;
  line: string;
};

export type PlanStepView = {
  step: string;
  description: string;
  status: string;
  deviation: string | null;
};

export type PlanView = {
  steps: PlanStepView[];
};

export type AgentObserveSnapshot = {
  tree_label: string;
  display_path: string;
  status: string;
  turn_id: string;
  last_activity: string;
  sleep_until: string | null;
  usage: AgentTokenUsage;
  current_turn: AgentTurnDetailSnapshot;
};

export type AgentTurnDetailSnapshot = {
  turn_id: string;
  turn_type: string;
  target_work_order_path: string | null;
  attempt: string;
  last_activity: string;
  summary: string;
  last_error: string | null;
  usage: AgentTokenUsage;
  plan_lines: TimestampedLine[];
  plan_total: number;
  tool_lines: TimestampedLine[];
  tool_total: number;
  file_lines: TimestampedLine[];
  file_total: number;
  output_lines: TimestampedLine[];
  output_total: number;
};

export type AgentWorkspace = {
  tree_label: string;
  work_dir: string;
};

export type TurnEventSnapshot = {
  type: string;
  recorded_at?: string;
  context?: {
    turn_id?: string;
    attempt?: number;
  } & Partial<TurnRunContext>;
  state?: LoopState;
  event?: ThreadEvent;
  message?: string;
  error?: string;
};

export type ActivitySnapshot = {
  tool_lines: TimestampedLine[];
  tool_total: number;
  file_lines: TimestampedLine[];
  file_total: number;
  output_lines: TimestampedLine[];
  output_total: number;
  latest_output_summary: string | null;
};

export type DashboardSnapshot = {
  root_dir: string;
  rendered_at: string;
  daemon: DaemonSnapshot | null;
  agents: AgentObserveSnapshot[];
  usage: AgentTokenUsage;
};

export type SectionItem = {
  label: string;
  text: string;
  color?: string;
  recorded_at?: string;
};
