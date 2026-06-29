import { Box } from "ink";
import React from "react";
import { format_compact_age } from "../format.js";
import type { AgentObserveSnapshot } from "./model.js";
import {
  SectionFrame,
  TableCell,
  format_token_count,
  get_agent_status_view,
  h,
} from "./view-common.js";

const TREE_NAME_WIDTH = 26;
const TREE_STATUS_WIDTH = 8;
const TREE_SCHEDULE_WIDTH = 14;
const TREE_ACTIVITY_WIDTH = 10;
const TREE_TURN_WIDTH = 8;
const TREE_USAGE_WIDTH = 12;
const TREE_PATH_WIDTH = 18;

export function AgentTreeSection({
  agents,
}: {
  agents: AgentObserveSnapshot[];
}): React.ReactElement {
  return h(
    SectionFrame,
    { title: "2. 代理树", borderColor: "blue" },
    React.Children.toArray([
      h(AgentTreeHeader, { key: "header" }),
      ...agents.map((agent) =>
        h(AgentTreeRow, { key: `${agent.tree_label}:${agent.display_path}`, agent }),
      ),
    ]),
  );
}

function AgentTreeRow({ agent }: { agent: AgentObserveSnapshot }): React.ReactElement {
  const status = get_agent_status_view(agent.status);
  const activity = agent.last_activity !== "-" ? format_compact_age(agent.last_activity) : "-";
  return h(
    Box,
    { flexDirection: "row" },
    React.Children.toArray([
      h(TableCell, {
        key: "tree",
        width: TREE_NAME_WIDTH,
        text: agent.tree_label,
        bold: agent.status === "active",
      }),
      h(TableCell, {
        key: "status",
        width: TREE_STATUS_WIDTH,
        text: status.badge,
        color: status.color,
        bold: true,
      }),
      h(TableCell, {
        key: "schedule",
        width: TREE_SCHEDULE_WIDTH,
        text: format_agent_schedule(agent),
        color: get_agent_schedule_color(agent),
      }),
      h(TableCell, { key: "activity", width: TREE_ACTIVITY_WIDTH, text: activity, color: "gray" }),
      h(TableCell, { key: "turn", width: TREE_TURN_WIDTH, text: agent.turn_id, color: "gray" }),
      h(TableCell, {
        key: "usage",
        width: TREE_USAGE_WIDTH,
        text: format_token_count(agent.usage.total_tokens),
        color: agent.usage.total_tokens > 0 ? "cyan" : "gray",
      }),
      h(TableCell, {
        key: "path",
        width: TREE_PATH_WIDTH,
        text: agent.display_path,
        color: "gray",
      }),
    ]),
  );
}

function AgentTreeHeader(): React.ReactElement {
  return h(
    Box,
    { flexDirection: "row" },
    React.Children.toArray([
      h(TableCell, { key: "tree", width: TREE_NAME_WIDTH, text: "代理", color: "gray" }),
      h(TableCell, { key: "status", width: TREE_STATUS_WIDTH, text: "状态", color: "gray" }),
      h(TableCell, { key: "schedule", width: TREE_SCHEDULE_WIDTH, text: "下一轮", color: "gray" }),
      h(TableCell, {
        key: "activity",
        width: TREE_ACTIVITY_WIDTH,
        text: "最近活动",
        color: "gray",
      }),
      h(TableCell, { key: "turn", width: TREE_TURN_WIDTH, text: "轮次", color: "gray" }),
      h(TableCell, { key: "usage", width: TREE_USAGE_WIDTH, text: "Token", color: "gray" }),
      h(TableCell, { key: "path", width: TREE_PATH_WIDTH, text: "路径", color: "gray" }),
    ]),
  );
}

function format_agent_schedule(agent: AgentObserveSnapshot): string {
  if (agent.status === "active") return "运行中";
  if (agent.status === "sleep")
    return agent.sleep_until ? format_sleep_remaining(agent.sleep_until) : "等待下一轮";
  if (agent.status === "failed") return "等待处理";
  if (agent.status === "stopped") return "已停止";
  return "已停止";
}

function get_agent_schedule_color(agent: AgentObserveSnapshot): string {
  if (agent.status === "active") return "cyan";
  if (agent.status === "sleep") return "yellow";
  if (agent.status === "failed") return "red";
  return "gray";
}

function format_sleep_remaining(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "等待下一轮";
  const remaining_seconds = Math.max(0, Math.ceil((date.getTime() - Date.now()) / 1000));
  if (remaining_seconds === 0) return "即将唤醒";
  const hours = Math.floor(remaining_seconds / 3600);
  const minutes = Math.floor((remaining_seconds % 3600) / 60);
  const seconds = remaining_seconds % 60;
  return `剩 ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}
