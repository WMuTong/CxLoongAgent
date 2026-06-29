import { Box, Text } from "ink";
import React from "react";
import { format_wall_clock_time } from "../format.js";
import { AgentDetailsSection } from "./agent-details-section.js";
import { AgentTreeSection } from "./agent-tree-section.js";
import { type DashboardSnapshot, MAX_FOCUS_AGENTS } from "./model.js";
import { RuntimeStatusSection } from "./runtime-section.js";
import { collect_agent_stats, h } from "./view-common.js";

export function DashboardView({ snapshot }: { snapshot: DashboardSnapshot }): React.ReactElement {
  const stats = collect_agent_stats(snapshot.agents);
  const active_agents = snapshot.agents
    .filter((agent) => agent.status === "active")
    .slice(0, MAX_FOCUS_AGENTS);

  return h(
    Box,
    { flexDirection: "column", paddingX: 1 },
    React.Children.toArray([
      h(TopBar, { key: "top", snapshot }),
      h(RuntimeStatusSection, { key: "runtime", snapshot, stats }),
      h(AgentTreeSection, { key: "agents", agents: snapshot.agents }),
      h(AgentDetailsSection, { key: "details", agents: active_agents }),
      h(Footer, { key: "footer" }),
    ]),
  );
}

function TopBar({ snapshot }: { snapshot: DashboardSnapshot }): React.ReactElement {
  return h(
    Box,
    { flexDirection: "column", marginBottom: 1 },
    h(
      Box,
      { flexDirection: "row" },
      React.Children.toArray([
        h(Text, { key: "name", color: "cyan", bold: true }, "loong observe"),
        h(Text, { key: "space" }, "  "),
        h(
          Text,
          { key: "time", color: "gray" },
          `刷新 ${format_wall_clock_time(snapshot.rendered_at)}`,
        ),
      ]),
    ),
  );
}

function Footer(): React.ReactElement {
  return h(
    Box,
    { marginTop: 1 },
    h(
      Text,
      { color: "gray" },
      "Ctrl+C 退出观察界面，后台运行不受影响。事件记录在 .loong/runtime/turn-events.jsonl。",
    ),
  );
}
