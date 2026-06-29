import { Activity, CircleGauge, Clock3, Pause, Play, Route, Zap } from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { AnimatedCompactNumber, AnimatedNumber, AnimatedPercent } from "../components";
import { Button } from "../components/ui";
import type { WebuiSnapshot } from "../types";
import { format_duration_ms } from "./format";
import { collect_agent_stats, status_label, status_tone_class } from "./status";

type TopStatusBarProps = {
  snapshot: WebuiSnapshot | null;
  waitingCount: number;
  teamActionPending: boolean;
  onToggleTeamRun: () => void;
};

export function TopStatusBar({
  snapshot,
  waitingCount,
  teamActionPending,
  onToggleTeamRun,
}: TopStatusBarProps) {
  const stats = collect_agent_stats(snapshot?.dashboard.agents ?? []);
  const daemon_status = snapshot?.dashboard.daemon?.status ?? "stopped";
  const usage = snapshot?.dashboard.usage;
  const daemon = snapshot?.dashboard.daemon ?? null;
  const daemon_running = daemon?.status === "running";
  const [now, setNow] = useState(() => Date.now());
  const cacheRate =
    usage && usage.input_tokens > 0 ? usage.cached_input_tokens / usage.input_tokens : 0;
  const elapsed_run_ms = useMemo(() => calculate_daemon_run_duration(daemon, now), [daemon, now]);

  useEffect(() => {
    if (!daemon_running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [daemon_running]);

  return (
    <header className="border-b bg-card/95 px-3 py-1.5 shadow-sm">
      <div className="top-status-row">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary text-xs font-semibold text-primary-foreground shadow-sm">
            L
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold">loong WebUI</h1>
          </div>
        </div>
        <div className="status-strip">
          <HeaderMetric
            icon={<Activity className="h-4 w-4" />}
            label="运行状态"
            tone={daemon_status}
            value={status_label(daemon_status)}
            valueClassName={daemon_running ? "text-emerald-700" : "text-red-700"}
          />
          <TokenMetric
            icon={<Zap className="h-4 w-4" />}
            total={usage?.total_tokens}
            input={usage?.input_tokens}
            output={usage?.output_tokens}
            cacheRate={cacheRate}
          />
          <HeaderMetric
            icon={<CircleGauge className="h-4 w-4" />}
            label="Agent"
            tone={stats.failed > 0 ? "failed" : "stopped"}
            value={
              <AgentCountMetric active={stats.active} failed={stats.failed} sleep={stats.sleep} />
            }
          />
          <HeaderMetric
            icon={<Route className="h-4 w-4" />}
            label="待处理"
            tone={waitingCount > 0 ? "waiting" : "stopped"}
            value={<AnimatedNumber value={waitingCount} />}
            valueClassName={waitingCount > 0 ? "text-orange-600" : undefined}
          />
        </div>
        <div className="top-status-spacer min-w-0 flex-1" aria-hidden="true" />
        <div className="top-status-actions flex shrink-0 items-center justify-end gap-3">
          <Button
            className="team-run-button"
            disabled={!snapshot || teamActionPending}
            onClick={onToggleTeamRun}
            size="sm"
            title={daemon_running ? "停止后台运行" : "启动后台运行"}
            variant={daemon_running ? "destructive" : "default"}
          >
            {daemon_running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            <span>{daemon_running ? "停止" : "启动"}</span>
          </Button>
          <span
            className="daemon-run-duration inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
            title="后台累计运行时间"
          >
            <Clock3 className="h-3.5 w-3.5" />
            <span>{snapshot ? format_duration_ms(elapsed_run_ms) : "-"}</span>
          </span>
        </div>
      </div>
    </header>
  );
}

function calculate_daemon_run_duration(
  daemon: WebuiSnapshot["dashboard"]["daemon"] | null,
  now: number,
): number {
  if (!daemon) return 0;
  if (daemon.status !== "running" || !daemon.active_since) {
    return daemon.elapsed_run_ms;
  }
  const active_since = Date.parse(daemon.active_since);
  if (!Number.isFinite(active_since)) return daemon.elapsed_run_ms;
  return daemon.accumulated_run_ms + Math.max(0, now - active_since);
}

function TokenMetric({
  icon,
  total,
  input,
  output,
  cacheRate,
}: {
  icon: React.ReactNode;
  total: number | null | undefined;
  input: number | null | undefined;
  output: number | null | undefined;
  cacheRate: number;
}) {
  return (
    <div className="header-metric token-metric">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="text-muted-foreground">{icon}</span>
        <span className="truncate">token</span>
      </div>
      <strong className="whitespace-nowrap text-sm">
        总 <AnimatedCompactNumber value={total} />
      </strong>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        入 <AnimatedCompactNumber value={input} />
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        出 <AnimatedCompactNumber value={output} />
      </span>
      <span className="whitespace-nowrap text-xs text-muted-foreground">
        缓存率 <AnimatedPercent value={cacheRate} />
      </span>
    </div>
  );
}

function AgentCountMetric({
  active,
  sleep,
  failed,
}: {
  active: number;
  sleep: number;
  failed: number;
}) {
  return (
    <span className="agent-count-metric">
      <AnimatedNumber value={active} />
      <span>运行 /</span>
      <AnimatedNumber value={sleep} />
      <span>休眠 /</span>
      <AnimatedNumber value={failed} />
      <span>异常</span>
    </span>
  );
}

function HeaderMetric({
  icon,
  label,
  value,
  tone = "stopped",
  valueClassName,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone?: string;
  valueClassName?: string;
}) {
  return (
    <div className="header-metric">
      <span className="text-muted-foreground">{icon}</span>
      <span className="truncate text-xs text-muted-foreground">{label}</span>
      <strong className={`truncate text-sm ${valueClassName ?? status_tone_class(tone)}`}>
        {value}
      </strong>
    </div>
  );
}
