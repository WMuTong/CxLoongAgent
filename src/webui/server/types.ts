import type { HumanRequestStatus } from "../../human-request/index.js";
import type { DashboardSnapshot } from "../../observe/dashboard/model.js";
import type { AgentRunState } from "../../runtime/run-state.js";
import type { LoopState } from "../../runtime/state.js";
import type { WorkOrderSnapshot } from "../../work-order/index.js";

export type WebuiAgentSnapshot = {
  agent_path: string;
  name: string;
  position: string;
  description: string;
  sort_index: number;
  state: WebuiStateSnapshot;
  role_instruction: WebuiMarkdownFileSnapshot | null;
  memory: WebuiMemorySnapshot[];
  turns: WebuiTurnSnapshot[];
  work_orders: {
    inbox: WorkOrderSnapshot[];
    outbox: WorkOrderSnapshot[];
  };
  human_requests: WebuiHumanRequestSummary[];
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
  state: LoopState | null;
  plan_path: string | null;
  plan: WebuiPlanSnapshot | null;
  log_path: string | null;
  log: WebuiLogSnapshot | null;
  usage: {
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    updated_at: string | null;
  };
  events: WebuiTurnEventSnapshot[];
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

export type WebuiHumanRequestSummary = {
  agent_path: string;
  relative_path: string;
  summary: string | null;
  status: HumanRequestStatus;
  turn_id: string | null;
  created_at: string | null;
  content: string;
};

export type WebuiSnapshot = {
  dashboard: DashboardSnapshot;
  agents: WebuiAgentSnapshot[];
};

export type HumanRequestDetail = WebuiHumanRequestSummary & {
  content: string;
  created_at: string | null;
  turn_id: string | null;
};
