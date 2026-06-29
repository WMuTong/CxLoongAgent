import { ListTree } from "lucide-react";
import { ScrollArea } from "../components/ui";
import type { AgentObserveSnapshot, WebuiAgentSnapshot } from "../types";
import { AgentTree } from "./agent-tree";

type AgentSidebarProps = {
  agents: WebuiAgentSnapshot[];
  observeAgents: AgentObserveSnapshot[];
  selectedAgentPath: string;
  onSelect: (agentPath: string) => void;
};

export function AgentSidebar({
  agents,
  observeAgents,
  selectedAgentPath,
  onSelect,
}: AgentSidebarProps) {
  return (
    <aside className="sidebar-shell">
      <div className="border-b px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ListTree className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold">团队（{agents.length}名成员）</h2>
          </div>
        </div>
      </div>
      <ScrollArea className="agent-sidebar-scroll min-h-0 flex-1">
        <div className="flex h-full min-h-[320px] flex-col p-2">
          {agents.length === 0 ? (
            <div className="rounded-md border border-dashed bg-muted/40 px-3 py-8 text-center text-sm text-muted-foreground">
              暂无 Agent 工作区
            </div>
          ) : (
            <AgentTree
              agents={agents}
              observeAgents={observeAgents}
              selectedAgentPath={selectedAgentPath}
              onSelect={onSelect}
            />
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
