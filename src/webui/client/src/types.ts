export type AgentRunStatus = "active" | "sleep" | "stopped" | "failed";

export type TokenUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  updated_at: string | null;
};

export type TimestampedLine = {
  recorded_at: string;
  line: string;
};

export type AgentObserveSnapshot = {
  tree_label: string;
  display_path: string;
  status: AgentRunStatus;
  turn_id: string;
  last_activity: string;
  sleep_until: string | null;
  usage: TokenUsage;
  current_turn: {
    turn_id: string;
    turn_type: string;
    target_work_order_path: string | null;
    attempt: string;
    last_activity: string;
    summary: string;
    last_error: string | null;
    usage: TokenUsage;
    plan_lines: TimestampedLine[];
    plan_total: number;
    tool_lines: TimestampedLine[];
    tool_total: number;
    file_lines: TimestampedLine[];
    file_total: number;
    output_lines: TimestampedLine[];
    output_total: number;
  };
};

export type AgentRunState = {
  status: AgentRunStatus;
  started_at: string | null;
  ended_at: string | null;
  updated_at: string;
  latest_turn_id: string | null;
  latest_summary: string | null;
  sleep_until: string | null;
  last_error: string | null;
  usage: TokenUsage;
  active_turn: {
    turn_id: string;
    execution_dir: string;
    started_at: string;
    turn_type: string;
    target_work_order_path: string | null;
  } | null;
};

export type WorkOrderSnapshot = {
  relative_work_order_path: string;
  relative_completion_report_path: string | null;
  turn_id: string | null;
  created_at: string | null;
  summary: string | null;
  delegator: string | null;
  executor: string | null;
  status: "active" | "completed";
  check_status: "pending" | "passed" | "failed" | null;
  open_issue_count: number | null;
  content: string;
  completion_report: WorkOrderCompletionReportSnapshot | null;
  work_check: WorkOrderWorkCheckSnapshot | null;
  input_files: WorkOrderFileSnapshot[];
  output_files: WorkOrderFileSnapshot[];
};

export type WorkOrderCompletionReportSnapshot = {
  relative_path: string;
  turn_id: string | null;
  created_at: string | null;
  delegator: string | null;
  executor: string | null;
  check_status: "pending" | "passed" | "failed" | null;
  content: string;
};

export type WorkOrderWorkCheckSnapshot = {
  relative_path: string;
  open_issue_count: number | null;
  content: string;
};

export type WorkOrderFileSnapshot = {
  relative_path: string;
  size: number;
  updated_at: string;
};

export type HumanRequestSummary = {
  agent_path: string;
  relative_path: string;
  summary: string | null;
  status: "waiting" | "done" | "cancelled" | "unknown";
  turn_id: string | null;
  created_at: string | null;
  content: string;
};

export type FilePreview = {
  relative_path: string;
  content: string;
};

export type WebuiAgentSnapshot = {
  agent_path: string;
  name: string;
  position?: string;
  description: string;
  sort_index: number;
  state?: WebuiStateSnapshot;
  role_instruction: WebuiMarkdownFileSnapshot | null;
  memory: WebuiMemorySnapshot[];
  turns: WebuiTurnSnapshot[];
  work_orders: {
    inbox: WorkOrderSnapshot[];
    outbox: WorkOrderSnapshot[];
  };
  human_requests: HumanRequestSummary[];
};

export type WebuiMarkdownFileSnapshot = {
  relative_path: string;
  content: string;
  updated_at: string;
};

export type WebuiStateSnapshot = {
  relative_path: string;
  data: AgentRunState | null;
  raw: string | null;
};

export type WebuiMemorySnapshot = {
  relative_path: string;
  title: string;
  content: string;
  updated_at: string;
};

export type WebuiTurnEventSnapshot = {
  recorded_at: string;
  type: string;
  detail: string;
  raw: string;
};

export type WebuiTurnSnapshot = {
  turn_id: string;
  turn_type: string;
  target_work_order_path: string | null;
  attempt: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  last_activity: string | null;
  summary: string | null;
  state: LoopStateSnapshot | null;
  plan_path: string | null;
  plan: WebuiPlanSnapshot | null;
  log_path: string | null;
  log: WebuiLogSnapshot | null;
  usage: TokenUsage;
  events: WebuiTurnEventSnapshot[];
};

export type LoopStateSnapshot = {
  turn_id: string;
  updated_at: string;
  plan: string;
  log: string;
  delegated_work_orders: string[];
  human_requests: string[];
  is_memory_updated: boolean;
  summary: string;
  next_action: "continue" | "stop";
  sleep_duration: number;
};

export type WebuiPlanSnapshot = {
  relative_path: string;
  turn_id: string | null;
  created_at: string | null;
  items: WebuiPlanItemSnapshot[];
  error: string | null;
};

export type WebuiPlanItemSnapshot = {
  step: string;
  description: string;
  status: string;
  deviation: string | null;
};

export type WebuiLogSnapshot = {
  relative_path: string;
  turn_id: string | null;
  created_at: string | null;
  content: string;
  sections: WebuiMarkdownSectionSnapshot[];
  error: string | null;
};

export type WebuiMarkdownSectionSnapshot = {
  title: string;
  content: string;
};

export type WebuiSnapshot = {
  dashboard: {
    root_dir: string;
    rendered_at: string;
    daemon: null | {
      pid: number;
      root_dir: string;
      status: string;
      started_at: string;
      updated_at: string;
      active_since: string | null;
      stopped_at: string | null;
      accumulated_run_ms: number;
      elapsed_run_ms: number;
      command: string;
      args: string[];
    };
    agents: AgentObserveSnapshot[];
    usage: TokenUsage;
  };
  agents: WebuiAgentSnapshot[];
};

export type HumanRequestDetail = HumanRequestSummary & {
  content: string;
  created_at: string | null;
  turn_id: string | null;
};
