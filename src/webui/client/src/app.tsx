import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetch_snapshot, start_team_run, stop_team_run } from "./api";
import { DashboardShell } from "./dashboard";
import { to_error_message } from "./dashboard/format";
import type { WebuiSnapshot } from "./types";

const REFRESH_INTERVAL_MS = 2000;

export function App() {
  const [snapshot, setSnapshot] = useState<WebuiSnapshot | null>(null);
  const [selectedAgentPath, setSelectedAgentPath] = useState(".");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [teamActionPending, setTeamActionPending] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await fetch_snapshot();
      setSnapshot(next);
      setError(null);
    } catch (load_error) {
      setError(to_error_message(load_error));
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleTeamRun = useCallback(async () => {
    if (!snapshot) return;
    setTeamActionPending(true);
    try {
      if (snapshot.dashboard.daemon?.status === "running") {
        await stop_team_run();
      } else {
        await start_team_run();
      }
      await load();
    } catch (team_error) {
      setError(to_error_message(team_error));
    } finally {
      setTeamActionPending(false);
    }
  }, [load, snapshot]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!snapshot) return;
    if (snapshot.agents.some((agent) => agent.agent_path === selectedAgentPath)) return;
    setSelectedAgentPath(snapshot.agents[0]?.agent_path ?? ".");
  }, [snapshot, selectedAgentPath]);

  const selectedAgent = useMemo(
    () => snapshot?.agents.find((agent) => agent.agent_path === selectedAgentPath),
    [snapshot, selectedAgentPath],
  );

  if (!snapshot && loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-3 text-sm text-muted-foreground shadow-sm">
          <RefreshCw className="h-4 w-4 animate-spin text-primary" />
          正在读取 loong 运行状态
        </div>
      </main>
    );
  }

  return (
    <DashboardShell
      error={error}
      selectedAgent={selectedAgent}
      selectedAgentPath={selectedAgentPath}
      snapshot={snapshot}
      teamActionPending={teamActionPending}
      onRefresh={() => void load()}
      onSelectAgent={setSelectedAgentPath}
      onToggleTeamRun={() => void toggleTeamRun()}
    />
  );
}
