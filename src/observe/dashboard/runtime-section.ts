import { Text } from "ink";
import React from "react";
import { is_daemon_effectively_running } from "../../runtime/daemon.js";
import { clip_text, format_wall_clock_time } from "../format.js";
import { type DashboardSnapshot, MAX_PATH_LENGTH } from "./model.js";
import {
  type AgentStats,
  InlineRow,
  LabelCell,
  SectionFrame,
  format_cached_input_ratio,
  format_token_count,
  h,
} from "./view-common.js";

export function RuntimeStatusSection({
  snapshot,
  stats,
}: {
  snapshot: DashboardSnapshot;
  stats: AgentStats;
}): React.ReactElement {
  const daemon = get_daemon_view(snapshot.daemon);
  return h(
    SectionFrame,
    { title: "1. 运行状态", borderColor: daemon.color },
    React.Children.toArray([
      h(InlineRow, {
        key: "daemon",
        items: [
          h(LabelCell, { key: "label", label: "后台" }),
          h(Text, { key: "state", color: daemon.color, bold: true }, daemon.label),
          h(Text, { key: "pid", color: "gray" }, `  pid ${daemon.pid}`),
          h(Text, { key: "time", color: "gray" }, `  ${daemon.timing}`),
        ],
      }),
      h(InlineRow, {
        key: "agents",
        items: [
          h(LabelCell, { key: "label", label: "代理" }),
          h(Text, { key: "total", color: "gray" }, `总数 ${stats.total}`),
          h(
            Text,
            { key: "active", color: stats.active > 0 ? "cyan" : "gray" },
            `  运行 ${stats.active}`,
          ),
          h(
            Text,
            { key: "sleep", color: stats.sleeping > 0 ? "yellow" : "gray" },
            `  sleep ${stats.sleeping}`,
          ),
          h(
            Text,
            { key: "failed", color: stats.failed > 0 ? "red" : "gray" },
            `  出错 ${stats.failed}`,
          ),
          h(Text, { key: "stopped", color: "gray" }, `  停止 ${stats.stopped}`),
        ],
      }),
      h(InlineRow, {
        key: "usage",
        items: [
          h(LabelCell, { key: "label", label: "Token" }),
          h(
            Text,
            { key: "total", color: "cyan", bold: true },
            format_token_count(snapshot.usage.total_tokens),
          ),
          h(
            Text,
            { key: "input", color: "gray" },
            `  输入 ${format_token_count(snapshot.usage.input_tokens)}`,
          ),
          h(
            Text,
            { key: "cached", color: "gray" },
            `  缓存 ${format_token_count(snapshot.usage.cached_input_tokens)}`,
          ),
          h(
            Text,
            { key: "cache-ratio", color: "gray" },
            `  缓存率 ${format_cached_input_ratio(snapshot.usage)}`,
          ),
          h(
            Text,
            { key: "output", color: "gray" },
            `  输出 ${format_token_count(snapshot.usage.output_tokens)}`,
          ),
        ],
      }),
      h(InlineRow, {
        key: "workspace",
        items: [
          h(LabelCell, { key: "label", label: "工作区" }),
          h(Text, { key: "value", color: "gray" }, clip_text(snapshot.root_dir, MAX_PATH_LENGTH)),
        ],
      }),
    ]),
  );
}

function get_daemon_view(record: DashboardSnapshot["daemon"]): {
  label: string;
  pid: string;
  timing: string;
  color: string;
} {
  if (!record) return { label: "未启动", pid: "-", timing: "无后台记录", color: "yellow" };
  if (is_daemon_effectively_running(record)) {
    return {
      label: "运行中",
      pid: String(record.pid || "-"),
      timing: `启动于 ${format_wall_clock_time(record.started_at)}`,
      color: "green",
    };
  }
  if (record.status === "running") {
    return {
      label: "已失联",
      pid: String(record.pid || "-"),
      timing: `失联于 ${format_wall_clock_time(record.updated_at)}`,
      color: "red",
    };
  }
  return {
    label: "已停止",
    pid: String(record.pid || "-"),
    timing: `停止于 ${format_wall_clock_time(record.updated_at)}`,
    color: "gray",
  };
}
