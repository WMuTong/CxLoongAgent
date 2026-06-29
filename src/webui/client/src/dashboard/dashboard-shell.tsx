import { AlertCircle } from "lucide-react";
import { Alert, AlertDescription } from "../components/ui";
import type { WebuiAgentSnapshot, WebuiSnapshot } from "../types";
import { AgentSidebar } from "./agent-sidebar";
import { AgentWorkspace } from "./agent-workspace";
import { find_observe_agent } from "./status";
import { TopStatusBar } from "./top-status-bar";

type DashboardShellProps = {
  error: string | null;
  selectedAgent?: WebuiAgentSnapshot;
  selectedAgentPath: string;
  snapshot: WebuiSnapshot | null;
  teamActionPending: boolean;
  onRefresh: () => void;
  onSelectAgent: (agentPath: string) => void;
  onToggleTeamRun: () => void;
};

export function DashboardShell({
  error,
  selectedAgent,
  selectedAgentPath,
  snapshot,
  teamActionPending,
  onRefresh,
  onSelectAgent,
  onToggleTeamRun,
}: DashboardShellProps) {
  const agents = snapshot?.agents ?? [];
  const observeAgents = snapshot?.dashboard.agents ?? [];
  const selectedObserveAgent = find_observe_agent(observeAgents, selectedAgent);
  const waitingRequests = agents.flatMap((agent) =>
    agent.human_requests.filter((request) => request.status === "waiting"),
  );

  return (
    <main className="dashboard-page min-h-screen bg-background text-foreground">
      <div className="flex min-h-screen flex-col lg:h-screen lg:min-h-0">
        <TopStatusBar
          snapshot={snapshot}
          teamActionPending={teamActionPending}
          waitingCount={waitingRequests.length}
          onToggleTeamRun={onToggleTeamRun}
        />
        {error ? (
          <div className="px-5 pt-4">
            <Alert className="border-red-200 bg-red-50 text-red-900">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </div>
        ) : null}
        <div className="dashboard-grid min-h-0 flex-1">
          <AgentSidebar
            agents={agents}
            observeAgents={observeAgents}
            selectedAgentPath={selectedAgentPath}
            onSelect={onSelectAgent}
          />
          {snapshot && selectedAgent ? (
            <AgentWorkspace
              agent={selectedAgent}
              observeAgent={selectedObserveAgent}
              onChanged={onRefresh}
            />
          ) : (
            <section className="grid min-h-[420px] place-items-center rounded-lg border bg-card text-sm text-muted-foreground shadow-sm">
              暂无可显示的 Agent 工作区
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
