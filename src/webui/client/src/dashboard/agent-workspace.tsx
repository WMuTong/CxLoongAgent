import { Bot, Brain, FileText, Route } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge, ScrollArea, Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui";
import type {
  AgentObserveSnapshot,
  HumanRequestSummary,
  WebuiAgentSnapshot,
  WebuiStateSnapshot,
  WebuiTurnSnapshot,
  WorkOrderSnapshot,
} from "../types";
import {
  EventListPanel,
  HumanRequestDetailDialog,
  HumanRequestDetailPanel,
  HumanRequestListPanel,
  IdleStatePanel,
  LogPanel,
  MarkdownContent,
  PlanPanel,
  RunningStatePanel,
  TurnOverviewPanel,
  WorkOrderDetailDialog,
  WorkOrderDetailPanel,
  WorkOrderListPanel,
} from "./agent-detail-panels";
import { format_agent_name_with_position, format_datetime, format_duration_ms } from "./format";
import { StatusBadge } from "./status";
import { TurnTypeBadge, normalize_turn_type, turn_type_label } from "./turn-type";

type AgentWorkspaceProps = {
  agent: WebuiAgentSnapshot;
  observeAgent?: AgentObserveSnapshot;
  onChanged: () => void;
};

export function AgentWorkspace({ agent, observeAgent, onChanged }: AgentWorkspaceProps) {
  const latestTurn = agent.turns[0];
  const state = get_agent_state(agent, observeAgent);
  const turnTypeById = useMemo(
    () => build_turn_type_map(agent.turns, observeAgent),
    [agent.turns, observeAgent],
  );
  const waitingRequests = agent.human_requests.filter((request) => request.status === "waiting");
  const position = agent.position?.trim();
  const agentLabel = format_agent_name_with_position(agent);
  const [dialogOrder, setDialogOrder] = useState<WorkOrderSnapshot | null>(null);
  const [dialogRequest, setDialogRequest] = useState<HumanRequestSummary | null>(null);

  return (
    <section className="workspace-shell">
      <div className="workspace-header">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            <h2 className="truncate text-lg font-semibold" title={agentLabel}>
              {agent.name}
              {position ? (
                <span className="ml-1 text-sm font-normal text-muted-foreground">({position})</span>
              ) : null}
            </h2>
            <StatusBadge status={observeAgent?.status ?? state.data?.status ?? "stopped"} />
          </div>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={agent.description}>
            {agent.description || "暂无描述"}
          </p>
        </div>
      </div>

      <Tabs defaultValue="overview" className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3 lg:px-5">
        <TabsList className="w-fit shrink-0">
          <TabsTrigger value="overview">概况</TabsTrigger>
          <TabsTrigger value="human" className="relative">
            协助事项
            {waitingRequests.length > 0 ? <RedDot className="right-1 top-1" /> : null}
          </TabsTrigger>
          <TabsTrigger value="work-orders">工作单</TabsTrigger>
          <TabsTrigger value="turns">运行记录</TabsTrigger>
          <TabsTrigger value="memory">记忆</TabsTrigger>
          <TabsTrigger value="role-instruction">岗位说明</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="min-h-0 flex-1">
          <OverviewTab
            agent={agent}
            latestTurn={latestTurn}
            lastActivity={observeAgent?.last_activity ?? null}
            currentTurnUsage={
              observeAgent?.status === "active" ? observeAgent.current_turn.usage : null
            }
            state={state}
            isRunning={is_agent_running(state, observeAgent)}
            onOpenOrder={setDialogOrder}
            turnTypeById={turnTypeById}
          />
        </TabsContent>
        <TabsContent value="human" className="min-h-0 flex-1 overflow-hidden">
          <HumanRequestsTab agent={agent} onChanged={onChanged} turnTypeById={turnTypeById} />
        </TabsContent>
        <TabsContent value="work-orders" className="min-h-0 flex-1 overflow-hidden">
          <WorkOrdersTab agent={agent} turnTypeById={turnTypeById} />
        </TabsContent>
        <TabsContent value="turns" className="min-h-0 flex-1 overflow-hidden">
          <TurnRecordsTab
            agent={agent}
            onOpenOrder={setDialogOrder}
            onOpenRequest={setDialogRequest}
            turnTypeById={turnTypeById}
          />
        </TabsContent>
        <TabsContent value="memory" className="min-h-0 flex-1">
          <MemoryPanel agent={agent} />
        </TabsContent>
        <TabsContent value="role-instruction" className="min-h-0 flex-1">
          <RoleInstructionPanel agent={agent} />
        </TabsContent>
      </Tabs>

      <WorkOrderDetailDialog
        agentPath={agent.agent_path}
        order={dialogOrder}
        open={dialogOrder !== null}
        turnTypeById={turnTypeById}
        onOpenChange={(open) => !open && setDialogOrder(null)}
      />
      <HumanRequestDetailDialog
        request={dialogRequest}
        open={dialogRequest !== null}
        turnTypeById={turnTypeById}
        onOpenChange={(open) => !open && setDialogRequest(null)}
      />
    </section>
  );
}

function RedDot({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={`absolute h-2 w-2 rounded-full bg-red-600 ring-2 ring-background ${className}`}
    />
  );
}

function OverviewTab({
  agent,
  currentTurnUsage,
  latestTurn,
  lastActivity,
  state,
  isRunning,
  onOpenOrder,
  turnTypeById,
}: {
  agent: WebuiAgentSnapshot;
  currentTurnUsage?: AgentObserveSnapshot["current_turn"]["usage"] | null;
  latestTurn?: WebuiTurnSnapshot;
  lastActivity: string | null;
  state: WebuiStateSnapshot;
  isRunning: boolean;
  onOpenOrder: (order: WorkOrderSnapshot) => void;
  turnTypeById: Map<string, string>;
}) {
  const currentTurnId = state.data?.active_turn?.turn_id ?? latestTurn?.turn_id ?? "";
  const currentInboxOrders = get_current_inbox_orders(agent, currentTurnId);

  return (
    <ScrollArea className="h-full pr-2">
      <div className="grid gap-3 pb-2">
        {isRunning ? (
          <RunningStatePanel currentTurnUsage={currentTurnUsage} state={state} />
        ) : (
          <IdleStatePanel
            latestTurn={latestTurn ?? null}
            lastActivity={lastActivity}
            state={state}
          />
        )}
        {isRunning ? (
          <>
            <PlanPanel plan={latestTurn?.plan ?? null} />
            {currentInboxOrders.length > 0 ? (
              <WorkOrderListPanel
                box="inbox"
                title={`收件箱（${currentInboxOrders.length}）`}
                orders={currentInboxOrders}
                compact
                description={null}
                onSelect={onOpenOrder}
                turnTypeById={turnTypeById}
              />
            ) : null}
            <EventListPanel events={latestTurn?.events ?? []} />
          </>
        ) : null}
      </div>
    </ScrollArea>
  );
}

function WorkOrdersTab({
  agent,
  turnTypeById,
}: {
  agent: WebuiAgentSnapshot;
  turnTypeById: Map<string, string>;
}) {
  const [box, setBox] = useState<"inbox" | "outbox">("inbox");
  const orders = box === "inbox" ? agent.work_orders.inbox : agent.work_orders.outbox;
  const [selectedOrderPath, setSelectedOrderPath] = useState(
    orders[0]?.relative_work_order_path ?? "",
  );

  useEffect(() => {
    if (orders.some((order) => order.relative_work_order_path === selectedOrderPath)) return;
    setSelectedOrderPath(orders[0]?.relative_work_order_path ?? "");
  }, [orders, selectedOrderPath]);

  const selectedOrder =
    orders.find((order) => order.relative_work_order_path === selectedOrderPath) ?? null;

  return (
    <Tabs
      value={box}
      onValueChange={(value) => setBox(value as "inbox" | "outbox")}
      className="h-full min-h-0 flex-1"
    >
      <div className="turn-grid">
        <div className="h-full min-h-0">
          <WorkOrderListPanel
            box={box}
            title=""
            orders={orders}
            compact
            description={null}
            headerAction={
              <TabsList>
                <TabsTrigger value="inbox" className="gap-1">
                  收件箱（{agent.work_orders.inbox.length}）
                </TabsTrigger>
                <TabsTrigger value="outbox" className="gap-1">
                  发件箱（{agent.work_orders.outbox.length}）
                </TabsTrigger>
              </TabsList>
            }
            selectedOrderPath={selectedOrderPath}
            turnTypeById={turnTypeById}
            variant="sidebar"
            onSelect={(order) => setSelectedOrderPath(order.relative_work_order_path)}
          />
        </div>
        <div className="h-full min-h-0 pr-2">
          <WorkOrderDetailPanel
            agentPath={agent.agent_path}
            order={selectedOrder}
            turnTypeById={turnTypeById}
          />
        </div>
      </div>
    </Tabs>
  );
}

function TurnRecordsTab({
  agent,
  onOpenOrder,
  onOpenRequest,
  turnTypeById,
}: {
  agent: WebuiAgentSnapshot;
  onOpenOrder: (order: WorkOrderSnapshot) => void;
  onOpenRequest: (request: HumanRequestSummary) => void;
  turnTypeById: Map<string, string>;
}) {
  const visibleTurns = useMemo(
    () => agent.turns.filter((turn) => turn.status !== "running"),
    [agent.turns],
  );
  const [selectedTurnId, setSelectedTurnId] = useState(visibleTurns[0]?.turn_id ?? "");

  useEffect(() => {
    if (visibleTurns.some((turn) => turn.turn_id === selectedTurnId)) return;
    setSelectedTurnId(visibleTurns[0]?.turn_id ?? "");
  }, [selectedTurnId, visibleTurns]);

  const selectedTurn =
    visibleTurns.find((turn) => turn.turn_id === selectedTurnId) ?? visibleTurns[0];
  const turnOrders = selectedTurn ? get_turn_outbox_orders(agent, selectedTurn.turn_id) : [];
  const turnRequests = selectedTurn ? get_turn_human_requests(agent, selectedTurn.turn_id) : [];
  const targetOrder = selectedTurn
    ? get_turn_target_inbox_order(agent, selectedTurn.target_work_order_path)
    : null;

  if (!selectedTurn) return <EmptyBlock text="暂无轮次记录" />;
  const showExecutionPanels = normalize_turn_type(selectedTurn.turn_type) === "execution";

  return (
    <div className="turn-grid">
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Route className="h-4 w-4" />
            轮次记录（{visibleTurns.length}）
          </div>
        </div>
        <ScrollArea className="turn-list-scroll min-h-0 flex-1">
          <div className="turn-list p-2">
            {visibleTurns.map((turn) => {
              const duration = format_turn_duration(turn);
              return (
                <button
                  key={turn.turn_id}
                  className={`turn-row ${selectedTurn.turn_id === turn.turn_id ? "turn-row-selected" : ""}`}
                  type="button"
                  onClick={() => setSelectedTurnId(turn.turn_id)}
                >
                  <span className="flex min-w-0 items-center justify-between gap-3 leading-5">
                    <span className="flex min-w-0 items-center gap-2 leading-5">
                      <TurnTypeBadge
                        compact
                        selected={selectedTurn.turn_id === turn.turn_id}
                        type={turn.turn_type}
                      />
                      <span className="truncate font-medium leading-5">
                        {turn_type_label(turn.turn_type)}
                        {turn.turn_id}
                      </span>
                    </span>
                    <span className="turn-row-meta">
                      <span>{format_datetime(turn.finished_at)}</span>
                    </span>
                  </span>
                  <span
                    className="turn-row-summary"
                    title={turn.summary ?? format_datetime(turn.last_activity)}
                  >
                    <span className="turn-row-summary-text">
                      {turn.summary ?? format_datetime(turn.last_activity)}
                    </span>
                    {duration ? <span className="turn-row-duration">耗时 {duration}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>
      <ScrollArea className="h-full min-h-0 pr-2">
        <div className="grid gap-3 pb-2">
          <TurnOverviewPanel turn={selectedTurn} />
          {showExecutionPanels ? (
            <>
              <HumanRequestListPanel
                title="人类协助事项"
                requests={turnRequests}
                emptyText="当前轮次未发起任何人类协助请求"
                showDescription={false}
                onSelect={onOpenRequest}
              />
            </>
          ) : null}
          {targetOrder ? (
            <WorkOrderListPanel
              box="inbox"
              title="处理的工作单（1）"
              orders={[targetOrder]}
              compact
              description={null}
              onSelect={onOpenOrder}
              turnTypeById={turnTypeById}
            />
          ) : null}
          {showExecutionPanels ? (
            <>
              <WorkOrderListPanel
                box="outbox"
                title={`委派的工作单（${turnOrders.length}）`}
                orders={turnOrders}
                compact
                description={null}
                emptyText="当前轮次未委派任何工作单"
                onSelect={onOpenOrder}
                turnTypeById={turnTypeById}
              />
              <PlanPanel plan={selectedTurn.plan} />
            </>
          ) : null}
          <LogPanel log={selectedTurn.log} />
          <EventListPanel events={selectedTurn.events} />
        </div>
      </ScrollArea>
    </div>
  );
}

function format_turn_duration(turn: WebuiTurnSnapshot): string | null {
  if (turn.status !== "completed" || !turn.started_at || !turn.finished_at) return null;
  const started = Date.parse(turn.started_at);
  const finished = Date.parse(turn.finished_at);
  if (!Number.isFinite(started) || !Number.isFinite(finished) || finished < started) return null;
  return format_duration_ms(finished - started);
}

function HumanRequestsTab({
  agent,
  onChanged,
  turnTypeById,
}: {
  agent: WebuiAgentSnapshot;
  onChanged: () => void;
  turnTypeById: Map<string, string>;
}) {
  const [selectedPath, setSelectedPath] = useState(agent.human_requests[0]?.relative_path ?? "");

  useEffect(() => {
    if (agent.human_requests.some((request) => request.relative_path === selectedPath)) return;
    setSelectedPath(agent.human_requests[0]?.relative_path ?? "");
  }, [agent.human_requests, selectedPath]);

  const selectedRequest =
    agent.human_requests.find((request) => request.relative_path === selectedPath) ?? null;

  return (
    <div className="turn-grid">
      <div className="h-full min-h-0">
        <HumanRequestListPanel
          title={`协助事项（${agent.human_requests.length}）`}
          requests={agent.human_requests}
          selectedRequestPath={selectedPath}
          showDescription={false}
          variant="sidebar"
          onSelect={(request) => setSelectedPath(request.relative_path)}
        />
      </div>
      <ScrollArea className="h-full min-h-0 pr-2">
        <HumanRequestDetailPanel
          request={selectedRequest}
          turnTypeById={turnTypeById}
          onChanged={onChanged}
        />
      </ScrollArea>
    </div>
  );
}

function MemoryPanel({ agent }: { agent: WebuiAgentSnapshot }) {
  return (
    <ScrollArea className="h-full pr-2">
      <div className="grid gap-3 pb-2">
        {agent.memory.length === 0 ? (
          <EmptyBlock text="暂无记忆" />
        ) : (
          agent.memory.map((memory) => (
            <section key={memory.relative_path} className="panel">
              <div className="flex items-center justify-between gap-3">
                <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <span className="text-primary">
                    <Brain className="h-4 w-4" />
                  </span>
                  <span className="truncate">{format_memory_title(memory.title)}</span>
                </h3>
                <span className="shrink-0 text-xs text-muted-foreground">
                  最近于 {format_datetime(memory.updated_at)} 更新
                </span>
              </div>
              <div className="mt-2">
                <MarkdownContent content={memory.content} emptyText="空文件" />
              </div>
            </section>
          ))
        )}
      </div>
    </ScrollArea>
  );
}

function RoleInstructionPanel({ agent }: { agent: WebuiAgentSnapshot }) {
  const instruction = agent.role_instruction;
  return (
    <ScrollArea className="h-full pr-2">
      <div className="grid gap-3 pb-2">
        <section className="panel">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
              <span className="text-primary">
                <FileText className="h-4 w-4" />
              </span>
              <span className="truncate">岗位说明</span>
            </h3>
            {instruction ? (
              <span className="shrink-0 text-xs text-muted-foreground">
                最近于 {format_datetime(instruction.updated_at)} 更新
              </span>
            ) : null}
          </div>
          <div className="mt-2">
            <MarkdownContent content={instruction?.content ?? ""} emptyText="暂无岗位说明" />
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}

function get_current_inbox_orders(
  agent: WebuiAgentSnapshot,
  currentTurnId: string,
): WorkOrderSnapshot[] {
  const byTurn = get_turn_inbox_orders(agent, currentTurnId);
  if (byTurn.length > 0) return byTurn;
  return agent.work_orders.inbox.filter((order) => order.status === "active");
}

function get_turn_inbox_orders(agent: WebuiAgentSnapshot, turnId: string): WorkOrderSnapshot[] {
  if (!turnId) return [];
  return agent.work_orders.inbox.filter((order) => order.completion_report?.turn_id === turnId);
}

function get_turn_outbox_orders(agent: WebuiAgentSnapshot, turnId: string): WorkOrderSnapshot[] {
  if (!turnId) return [];
  return agent.work_orders.outbox.filter((order) => order.turn_id === turnId);
}

function get_turn_target_inbox_order(
  agent: WebuiAgentSnapshot,
  targetWorkOrderPath: string | null,
): WorkOrderSnapshot | null {
  if (!targetWorkOrderPath) return null;
  const targetDir = normalize_work_order_dir_path(targetWorkOrderPath);
  return (
    agent.work_orders.inbox.find(
      (order) => normalize_work_order_dir_path(order.relative_work_order_path) === targetDir,
    ) ?? null
  );
}

function normalize_work_order_dir_path(path: string): string {
  return path
    .replaceAll("\\", "/")
    .replace(/\/work-order\.md$/, "")
    .replace(/\/+$/, "");
}

function get_turn_human_requests(agent: WebuiAgentSnapshot, turnId: string): HumanRequestSummary[] {
  if (!turnId) return [];
  return agent.human_requests.filter((request) => request.turn_id === turnId);
}

function is_agent_running(
  state: WebuiStateSnapshot,
  observeAgent: AgentObserveSnapshot | undefined,
): boolean {
  return (observeAgent?.status ?? state.data?.status) === "active";
}

function get_agent_state(
  agent: WebuiAgentSnapshot,
  observeAgent: AgentObserveSnapshot | undefined,
): WebuiStateSnapshot {
  if (observeAgent) {
    const rawState = agent.state?.data;
    const useCurrentTurn = observeAgent.status === "active";
    const summary =
      (useCurrentTurn ? normalize_progress_summary(observeAgent.current_turn.summary) : null) ??
      rawState?.latest_summary ??
      null;
    return {
      relative_path: agent.state?.relative_path ?? ".loong/runtime/state.json",
      data: {
        status: observeAgent.status,
        started_at: rawState?.started_at ?? null,
        ended_at: rawState?.ended_at ?? null,
        updated_at:
          observeAgent.last_activity === "-"
            ? (rawState?.updated_at ?? "-")
            : observeAgent.last_activity,
        latest_turn_id:
          observeAgent.turn_id === "-" ? (rawState?.latest_turn_id ?? null) : observeAgent.turn_id,
        latest_summary: summary,
        sleep_until: observeAgent.status === "sleep" ? observeAgent.sleep_until : null,
        last_error:
          (useCurrentTurn ? observeAgent.current_turn.last_error : null) ??
          rawState?.last_error ??
          null,
        usage: observeAgent.usage,
        active_turn: useCurrentTurn
          ? {
              turn_id: observeAgent.turn_id,
              execution_dir: "-",
              started_at: observeAgent.current_turn.last_activity,
              turn_type: normalize_turn_type(observeAgent.current_turn.turn_type),
              target_work_order_path: observeAgent.current_turn.target_work_order_path,
            }
          : null,
      },
      raw: agent.state?.raw ?? null,
    };
  }
  return (
    agent.state ?? {
      relative_path: ".loong/runtime/state.json",
      data: null,
      raw: null,
    }
  );
}

function build_turn_type_map(
  turns: WebuiTurnSnapshot[],
  observeAgent: AgentObserveSnapshot | undefined,
): Map<string, string> {
  const byId = new Map<string, string>();
  for (const turn of turns) {
    byId.set(turn.turn_id, normalize_turn_type(turn.turn_type));
  }
  if (observeAgent && observeAgent.turn_id !== "-") {
    byId.set(observeAgent.turn_id, normalize_turn_type(observeAgent.current_turn.turn_type));
  }
  return byId;
}

function normalize_progress_summary(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  if (normalized.includes("暂无 summary")) return null;
  if (normalized === "暂无运行摘要") return null;
  return normalized;
}

function format_memory_title(title: string): string {
  if (title === "learned") return "已沉淀经验";
  if (title === "world-model") return "节点背景认知";
  return title;
}

function EmptyBlock({ text, compact = false }: { text: string; compact?: boolean }) {
  return (
    <div
      className={`rounded-md border border-dashed bg-muted/30 text-center text-sm text-muted-foreground ${
        compact ? "px-3 py-5" : "px-3 py-10"
      }`}
    >
      {text}
    </div>
  );
}
