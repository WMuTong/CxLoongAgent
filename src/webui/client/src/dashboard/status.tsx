import { Badge } from "../components/ui";
import type { AgentObserveSnapshot, WebuiAgentSnapshot } from "../types";

export function StatusBadge({ status, className = "" }: { status: string; className?: string }) {
  const label = status_label(status);
  if (status === "active" || status === "running") {
    return (
      <Badge className={`border-emerald-200 bg-emerald-50 text-emerald-700 ${className}`}>
        {label}
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge className={className} variant="destructive">
        {label}
      </Badge>
    );
  }
  if (status === "waiting") {
    return (
      <Badge className={`border-orange-500 bg-orange-500 text-white ${className}`}>{label}</Badge>
    );
  }
  if (status === "sleep") {
    return (
      <Badge className={`border-amber-200 bg-amber-50 text-amber-700 ${className}`}>{label}</Badge>
    );
  }
  if (status === "completed") {
    return <Badge className={`border-sky-200 bg-sky-50 text-sky-700 ${className}`}>{label}</Badge>;
  }
  return (
    <Badge className={className} variant="secondary">
      {label}
    </Badge>
  );
}

export function find_observe_agent(
  observeAgents: AgentObserveSnapshot[],
  agent?: WebuiAgentSnapshot,
): AgentObserveSnapshot | undefined {
  if (!agent) return undefined;
  return observeAgents.find(
    (item) => item.display_path === agent.agent_path || item.display_path === agent.name,
  );
}

export function collect_agent_stats(agents: AgentObserveSnapshot[]) {
  return agents.reduce(
    (stats, agent) => {
      if (agent.status === "active") stats.active += 1;
      else if (agent.status === "sleep") stats.sleep += 1;
      else if (agent.status === "failed") stats.failed += 1;
      else stats.stopped += 1;
      return stats;
    },
    { active: 0, sleep: 0, failed: 0, stopped: 0 },
  );
}

export function status_label(status: string): string {
  if (status === "active") return "运行中";
  if (status === "running") return "运行中";
  if (status === "sleep") return "休眠等待";
  if (status === "failed") return "失败待处理";
  if (status === "stopped") return "已停止";
  if (status === "waiting") return "待处理";
  if (status === "completed") return "已完成";
  if (status === "done") return "已处理";
  if (status === "cancelled") return "已取消";
  if (status === "unknown") return "未知";
  return status;
}

export function status_dot_class(status: string): string {
  if (status === "active" || status === "running") return "bg-emerald-500 ring-emerald-100";
  if (status === "sleep") return "bg-amber-500 ring-amber-100";
  if (status === "failed" || status === "waiting") return "bg-red-500 ring-red-100";
  if (status === "stopped") return "bg-slate-400 ring-slate-100";
  if (status === "completed") return "bg-sky-500 ring-sky-100";
  return "bg-slate-300 ring-slate-100";
}

export function status_tone_class(tone: string): string {
  if (tone === "running" || tone === "active") return "text-emerald-700";
  if (tone === "failed") return "text-red-700";
  if (tone === "waiting") return "text-orange-600";
  if (tone === "sleep") return "text-amber-700";
  return "text-foreground";
}
