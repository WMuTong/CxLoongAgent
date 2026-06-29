import { Box, Text } from "ink";
import React from "react";
import { clip_text, format_age, format_time_of_day, format_wall_clock_time } from "../format.js";
import {
  type AgentObserveSnapshot,
  MAX_ACTIVITY_LENGTH,
  MAX_FILES,
  MAX_OUTPUTS,
  MAX_PLAN_STEPS,
  MAX_TOOLS,
  type SectionItem,
  type TimestampedLine,
} from "./model.js";
import {
  InlineRow,
  SectionFrame,
  format_cached_input_ratio,
  format_token_count,
  get_agent_status_view,
  h,
} from "./view-common.js";

const DETAIL_TITLE_WIDTH = 16;
const DETAIL_TIME_WIDTH = 9;
const DETAIL_LABEL_WIDTH = 8;

export function AgentDetailsSection({
  agents,
}: {
  agents: AgentObserveSnapshot[];
}): React.ReactElement {
  return h(
    SectionFrame,
    { title: "3. 代理详情", borderColor: agents.length > 0 ? "cyan" : "gray" },
    React.Children.toArray([
      agents.length === 0
        ? h(
            Text,
            { key: "empty", color: "gray" },
            "当前没有正在运行的代理。出错和 sleep 状态请看上方代理树。",
          )
        : null,
      ...agents.map((agent) => h(AgentDetailCard, { key: `${agent.tree_label}:detail`, agent })),
    ]),
  );
}

function AgentDetailCard({ agent }: { agent: AgentObserveSnapshot }): React.ReactElement {
  const status = get_agent_status_view(agent.status);
  const turn = agent.current_turn;
  const sections = [
    {
      key: "tools",
      title: "工具",
      total: turn.tool_total,
      limit: MAX_TOOLS,
      items: to_detail_items(turn.tool_lines, { show_timestamp: true }),
      empty_placeholder: "暂无工具调用",
    },
    {
      key: "files",
      title: "文件",
      total: turn.file_total,
      limit: MAX_FILES,
      items: to_detail_items(turn.file_lines, { show_timestamp: true }),
      empty_placeholder: "暂无文件变更",
    },
    {
      key: "outputs",
      title: "输出",
      total: turn.output_total,
      limit: MAX_OUTPUTS,
      items: to_output_items(turn.output_lines),
      empty_placeholder: "暂无输出",
    },
    {
      key: "plan",
      title: "计划",
      total: turn.plan_total,
      limit: MAX_PLAN_STEPS,
      items: to_detail_items(turn.plan_lines),
      empty_placeholder: "暂无计划",
    },
  ];
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    React.Children.toArray([
      h(InlineRow, {
        key: "head",
        items: [
          h(Text, { key: "status", color: status.color, bold: true }, status.badge),
          h(Text, { key: "space" }, " "),
          h(Text, { key: "agent", bold: true }, `${agent.tree_label} `),
          h(Text, { key: "path", color: "gray" }, agent.display_path),
        ],
      }),
      h(Text, { key: "meta", color: "gray" }, format_agent_meta(agent)),
      h(Text, { key: "summary" }, turn.summary),
      turn.last_error
        ? h(
            Text,
            { key: "error", color: "red" },
            `错误 ${clip_text(turn.last_error, MAX_ACTIVITY_LENGTH)}`,
          )
        : null,
      ...sections.map((section) => h(DetailSubsection, section)),
    ]),
  );
}

function DetailSubsection({
  title,
  total,
  limit,
  items,
  empty_placeholder,
}: {
  title: string;
  total: number;
  limit: number;
  items: SectionItem[];
  empty_placeholder: string;
}): React.ReactElement {
  const suffix = total > limit ? ` 最近 ${limit}/${total}` : total > 0 ? ` ${total}` : "";
  const normalized_items =
    items.length > 0 ? items : [{ label: "-", text: empty_placeholder, color: "gray" }];
  return h(
    Box,
    { flexDirection: "column", marginTop: 1 },
    React.Children.toArray(
      normalized_items.map((item, index) =>
        h(DetailRow, {
          key: `${index}:${item.label}:${item.text}`,
          title: index === 0 ? `${title}${suffix}` : "",
          item,
        }),
      ),
    ),
  );
}

function DetailRow({ title, item }: { title: string; item: SectionItem }): React.ReactElement {
  return h(
    Box,
    { flexDirection: "row" },
    React.Children.toArray([
      h(
        Box,
        { key: "title", width: DETAIL_TITLE_WIDTH },
        title ? h(Text, { color: "blue", bold: true }, title) : h(Text, {}, ""),
      ),
      h(
        Box,
        { key: "time", width: DETAIL_TIME_WIDTH },
        h(Text, { color: "gray" }, item.recorded_at ? format_time_of_day(item.recorded_at) : ""),
      ),
      h(
        Box,
        {
          key: "label",
          width: item.label ? DETAIL_LABEL_WIDTH : 0,
          justifyContent: "flex-end",
          paddingRight: 1,
        },
        h(Text, { color: item.color ?? get_detail_label_color(item.label) }, item.label),
      ),
      h(Text, { key: "text", wrap: "truncate-end" }, clip_text(item.text, MAX_ACTIVITY_LENGTH)),
    ]),
  );
}

function format_agent_meta(agent: AgentObserveSnapshot): string {
  const turn = agent.current_turn;
  return [
    get_agent_status_view(agent.status).label,
    turn.turn_id !== "-" ? `轮次 ${turn.turn_id}` : null,
    `本轮 Token ${format_token_count(turn.usage.total_tokens)}`,
    `本轮缓存率 ${format_cached_input_ratio(turn.usage)}`,
    turn.attempt !== "-" ? `尝试 ${turn.attempt}` : null,
    turn.last_activity !== "-" ? `最近 ${format_age(turn.last_activity)}` : null,
    agent.sleep_until ? `唤醒 ${format_wall_clock_time(agent.sleep_until)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function to_detail_items(
  lines: TimestampedLine[],
  options: { show_timestamp?: boolean } = {},
): SectionItem[] {
  return lines.map((line) => ({
    ...split_detail_line(line.line),
    recorded_at: options.show_timestamp ? line.recorded_at : undefined,
  }));
}

function to_output_items(lines: TimestampedLine[]): SectionItem[] {
  return lines.map((line) => ({ label: "", text: line.line, recorded_at: line.recorded_at }));
}

function split_detail_line(line: string): SectionItem {
  const normalized = line.trim();
  const separator_index = normalized.indexOf(" ");
  if (separator_index < 0) return { label: "-", text: normalized, color: "gray" };
  return {
    label: normalized.slice(0, separator_index),
    text: normalized.slice(separator_index + 1).trim(),
  };
}

function get_detail_label_color(label: string): string {
  if (label === "完成") return "green";
  if (label === "失败") return "red";
  if (label === "运行中" || label === "进行中") return "cyan";
  if (label === "待办") return "yellow";
  return "gray";
}
