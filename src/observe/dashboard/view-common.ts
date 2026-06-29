import { Box, Text } from "ink";
import React from "react";
import { clip_text } from "../format.js";
import type { AgentObserveSnapshot } from "./model.js";

export const h = React.createElement;

export type AgentStats = {
  total: number;
  active: number;
  sleeping: number;
  failed: number;
  stopped: number;
};

export function SectionFrame({
  title,
  borderColor,
  children,
}: {
  title: string;
  borderColor: string;
  children?: React.ReactNode;
}): React.ReactElement {
  return h(
    Box,
    { flexDirection: "column", borderStyle: "single", borderColor, paddingX: 1, marginBottom: 1 },
    React.Children.toArray([
      h(Text, { key: "title", color: "white", bold: true }, title),
      children,
    ]),
  );
}

export function InlineRow({ items }: { items: React.ReactNode[] }): React.ReactElement {
  return h(Box, { flexDirection: "row" }, React.Children.toArray(items));
}

export function LabelCell({ label }: { label: string }): React.ReactElement {
  return h(Box, { width: 8 }, h(Text, { color: "gray" }, label));
}

export function TableCell({
  width,
  text,
  color,
  bold,
}: {
  width: number;
  text: string;
  color?: string;
  bold?: boolean;
}): React.ReactElement {
  return h(Box, { width }, h(Text, { color, bold }, clip_text(text, width - 1)));
}

export function collect_agent_stats(agents: AgentObserveSnapshot[]): AgentStats {
  return agents.reduce(
    (stats, agent) => {
      stats.total += 1;
      if (agent.status === "active") stats.active += 1;
      else if (agent.status === "sleep") stats.sleeping += 1;
      else if (agent.status === "failed") stats.failed += 1;
      else stats.stopped += 1;
      return stats;
    },
    { total: 0, active: 0, sleeping: 0, failed: 0, stopped: 0 },
  );
}

export function get_agent_status_view(status: string): {
  badge: string;
  label: string;
  color: string;
} {
  if (status === "active") return { badge: "[运行]", label: "运行中", color: "cyan" };
  if (status === "sleep") return { badge: "[等待]", label: "等待", color: "yellow" };
  if (status === "failed") return { badge: "[失败]", label: "失败", color: "red" };
  if (status === "stopped") return { badge: "[停止]", label: "停止", color: "gray" };
  return { badge: "[停止]", label: "停止", color: "gray" };
}

export function format_token_count(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${trim_token_decimal(value / 1000)}k`;
  return `${trim_token_decimal(value / 1_000_000)}m`;
}

export function format_cached_input_ratio(usage: {
  input_tokens: number;
  cached_input_tokens: number;
}): string {
  if (usage.input_tokens <= 0) return "-";
  const ratio = (usage.cached_input_tokens / usage.input_tokens) * 100;
  if (ratio < 10) return `${ratio.toFixed(1).replace(/\.0$/, "")}%`;
  return `${Math.round(ratio)}%`;
}

function trim_token_decimal(value: number): string {
  return value >= 100 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}
