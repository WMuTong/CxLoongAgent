import {
  Activity,
  CheckCircle2,
  Circle,
  FileText,
  FolderOpen,
  Hand,
  Inbox,
  ListChecks,
  Loader2,
  Maximize2,
  MessageSquareText,
  Minimize2,
  PlayCircle,
  ScrollText,
  Search,
  TerminalSquare,
  XCircle,
} from "lucide-react";
import { memo, useState } from "react";
import type React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  cancel_human_request,
  complete_human_request,
  fetch_file_preview,
  open_file_location,
} from "../api";
import { AnimatedCompactNumber, AnimatedPercent } from "../components";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from "../components/ui";
import type {
  HumanRequestSummary,
  TokenUsage,
  WebuiLogSnapshot,
  WebuiPlanSnapshot,
  WebuiStateSnapshot,
  WebuiTurnEventSnapshot,
  WebuiTurnSnapshot,
  WorkOrderSnapshot,
} from "../types";
import {
  clip_text,
  format_compact_number,
  format_datetime,
  format_time_remaining,
  to_error_message,
} from "./format";
import { StatusBadge } from "./status";
import { TurnReference, TurnTypeBadge, turn_type_label } from "./turn-type";

type DetailDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: WorkOrderSnapshot | null;
  agentPath: string;
  turnTypeById?: TurnTypeById;
};

type WorkOrderBoxKind = "inbox" | "outbox" | "mixed";
type WorkOrderRowAction = "select" | "view";
type TurnTypeById = Map<string, string>;

export function RunningStatePanel({
  currentTurnUsage,
  state,
}: {
  currentTurnUsage?: TokenUsage | null;
  state: WebuiStateSnapshot;
}) {
  const data = state.data;
  const activeTurn = data?.active_turn ?? null;
  const usage = currentTurnUsage ?? data?.usage;
  const activeTurnId = activeTurn?.turn_id ?? data?.latest_turn_id ?? "-";
  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <PanelTitle icon={<Activity className="h-4 w-4" />} title="运行概览" />
          </div>
          {activeTurn ? (
            <div className="shrink-0 text-xs text-muted-foreground">
              于 {format_datetime(activeTurn.started_at)} 开始
            </div>
          ) : data ? (
            <div className="shrink-0 text-xs text-muted-foreground">
              于 {format_datetime(data.updated_at)} 更新
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <EmptyBlock text="暂无运行中状态" compact />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <InfoTile
                label="当前轮次"
                value={
                  activeTurnId === "-" ? (
                    "-"
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <TurnTypeBadge type={activeTurn?.turn_type} />
                      <span className="min-w-0 truncate">
                        {turn_type_label(activeTurn?.turn_type)}
                        {activeTurnId}
                      </span>
                    </span>
                  )
                }
              />
              <InfoTile
                label="总 token"
                value={<AnimatedCompactNumber value={usage?.total_tokens} />}
              />
              <InfoTile
                label="输入 token / 缓存率"
                value={
                  <TokenCacheRate
                    cached_input_tokens={usage?.cached_input_tokens}
                    input_tokens={usage?.input_tokens}
                  />
                }
              />
              <InfoTile
                label="输出 token"
                value={<AnimatedCompactNumber value={usage?.output_tokens} />}
              />
            </div>
            {data.last_error ? (
              <TextSection title="最近错误" content={data.last_error} tone="error" />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function IdleStatePanel({
  lastActivity,
  latestTurn,
  state,
}: {
  lastActivity: string | null;
  latestTurn?: WebuiTurnSnapshot | null;
  state: WebuiStateSnapshot;
}) {
  const data = state.data;
  const latestTurnId = data?.latest_turn_id ?? latestTurn?.turn_id ?? "-";
  const latestTurnType = data?.active_turn?.turn_type ?? latestTurn?.turn_type;
  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <PanelTitle icon={<Activity className="h-4 w-4" />} title="运行概览" />
          </div>
          {data ? (
            <div className="shrink-0 text-xs text-muted-foreground">
              {format_update_text(lastActivity)}
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {!data ? (
          <EmptyBlock text="暂无全局运行状态" compact />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
              <InfoTile
                label="最新轮次"
                value={
                  latestTurnId === "-" ? (
                    "-"
                  ) : (
                    <span className="inline-flex min-w-0 items-center gap-1.5">
                      <TurnTypeBadge type={latestTurnType} />
                      <span className="min-w-0 truncate">
                        {turn_type_label(latestTurnType)}
                        {latestTurnId}
                      </span>
                    </span>
                  )
                }
              />
              <InfoTile label="下次唤醒" value={format_time_remaining(data.sleep_until)} />
              <InfoTile
                label="总 token"
                value={<AnimatedCompactNumber value={data.usage.total_tokens} />}
              />
              <InfoTile
                label="输入 token / 缓存率"
                value={
                  <TokenCacheRate
                    cached_input_tokens={data.usage.cached_input_tokens}
                    input_tokens={data.usage.input_tokens}
                  />
                }
              />
              <InfoTile
                label="输出 token"
                value={<AnimatedCompactNumber value={data.usage.output_tokens} />}
              />
            </div>
            {data.latest_summary ? (
              <TextSection title="最近摘要" content={data.latest_summary} />
            ) : null}
            {data.active_turn ? (
              <div className="rounded-md border bg-background p-3">
                <div className="text-sm font-medium">活跃轮次</div>
                <div className="mt-2 grid gap-2 text-sm text-muted-foreground">
                  <KeyValue
                    label="轮次"
                    value={
                      <TurnReference
                        turnId={data.active_turn.turn_id}
                        type={data.active_turn.turn_type}
                      />
                    }
                  />
                  <KeyValue label="开始" value={format_datetime(data.active_turn.started_at)} />
                  <KeyValue label="目录" value={data.active_turn.execution_dir} />
                </div>
              </div>
            ) : null}
            {data.last_error ? (
              <TextSection title="最近错误" content={data.last_error} tone="error" />
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function format_update_text(value: string | null | undefined): string {
  return `最近于 ${format_datetime(value)} 更新`;
}

export function PlanPanel({ plan }: { plan: WebuiPlanSnapshot | null }) {
  return (
    <Card>
      <CardHeader>
        <PanelTitle icon={<ListChecks className="h-4 w-4" />} title="计划" />
      </CardHeader>
      <CardContent>
        {!plan ? (
          <EmptyBlock text="暂无计划" compact />
        ) : plan.error ? (
          <EmptyBlock text={plan.error} compact />
        ) : plan.items.length === 0 ? (
          <EmptyBlock text="计划文件中没有步骤" compact />
        ) : (
          <div className="flex flex-col gap-1">
            {plan.items.map((item) => (
              <PlanChecklistItem item={item} key={`${item.step}:${item.description}`} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlanChecklistItem({ item }: { item: WebuiPlanSnapshot["items"][number] }) {
  const completed = item.status === "completed";
  const running = item.status === "in_progress";
  const Icon = running ? Loader2 : completed ? CheckCircle2 : Circle;
  return (
    <div className="flex items-start gap-2 py-0" aria-label={`${item.step}. ${item.description}`}>
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${
          running
            ? "animate-spin text-primary"
            : completed
              ? "text-emerald-600"
              : "text-muted-foreground"
        }`}
      />
      <div className="min-w-0">
        {running ? (
          <div className="min-w-0">
            <div className="text-sm font-medium leading-5">
              {item.step}. {item.description}
            </div>
            {item.deviation ? (
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                偏差：{item.deviation}
              </div>
            ) : null}
          </div>
        ) : (
          <>
            <div className="text-sm font-medium leading-5">
              {item.step}. {item.description}
            </div>
            {item.deviation ? (
              <div className="mt-0.5 text-xs leading-5 text-muted-foreground">
                偏差：{item.deviation}
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

export function EventListPanel({ events }: { events: WebuiTurnEventSnapshot[] }) {
  const eventViews = events
    .map((event, index) => ({ event, index, view: build_event_view(event) }))
    .sort((left, right) => {
      const timeCompare = compare_event_time(right.event.recorded_at, left.event.recorded_at);
      return timeCompare === 0 ? right.index - left.index : timeCompare;
    });
  const isTurnRunning =
    eventViews.length > 0 && !eventViews.some(({ event }) => is_terminal_event(event));

  return (
    <Card>
      <CardHeader>
        <PanelTitle icon={<CheckCircle2 className="h-4 w-4" />} title="事件列表" />
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyBlock text="暂无事件" compact />
        ) : (
          <div className="event-timeline-list">
            {eventViews.map(({ event, index, view }, viewIndex) => (
              <EventTimelineItem
                event={event}
                key={`${event.recorded_at}:${index}`}
                shimmer={isTurnRunning && viewIndex === 0}
                view={view}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function EventTimelineItem({
  event,
  shimmer,
  view,
}: {
  event: WebuiTurnEventSnapshot;
  shimmer: boolean;
  view: EventView;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const content = format_event_content(view);
  const eventTime = format_event_datetime(event.recorded_at);
  return (
    <div className="group/event grid grid-cols-[132px_16px_minmax(0,1fr)] gap-2">
      <div className="mt-[6px] flex h-5 items-center justify-end whitespace-nowrap text-right text-xs leading-tight text-muted-foreground">
        <span>{eventTime.full}</span>
      </div>
      <div className="relative mt-[6px] flex justify-center">
        <div className="absolute bottom-[-8px] top-5 w-px bg-border" />
        <div className="relative z-10 flex size-5 items-center justify-center bg-card text-primary">
          {view.icon}
        </div>
      </div>
      <div
        className={`rounded-md px-3 py-1.5 transition-colors group-hover/event:bg-muted/60 ${
          shimmer ? "event-shimmer" : ""
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            {view.title_icon ? view.title_icon : null}
            <span className="min-w-0 truncate">{view.title}</span>
          </div>
          <button
            aria-expanded={showRaw}
            className="shrink-0 cursor-pointer bg-transparent p-0 text-xs text-primary opacity-0 transition-opacity hover:underline focus-visible:opacity-100 group-hover/event:opacity-100"
            type="button"
            onClick={() => setShowRaw((value) => !value)}
          >
            {showRaw ? "隐藏原始事件" : "查看原始事件"}
          </button>
        </div>
        {content ? (
          <div className="mt-0.5 whitespace-pre-wrap text-sm leading-5 text-muted-foreground">
            {content}
          </div>
        ) : null}
        {showRaw ? (
          <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs leading-5 text-foreground">
            {event.raw}
          </pre>
        ) : null}
      </div>
    </div>
  );
}

function is_terminal_event(event: WebuiTurnEventSnapshot): boolean {
  return (
    event.type === "turn.finished" ||
    event.type === "turn.failed" ||
    event.type === "validation.failed"
  );
}

type EventView = {
  title: string;
  description: string;
  badge?: string;
  badge_variant?: "default" | "secondary" | "outline" | "destructive";
  icon: React.ReactNode;
  title_icon?: React.ReactNode;
  meta: { label: string; value: string | number }[];
};

function format_event_content(view: EventView): string {
  const description = view.description.trim();
  const meta = view.meta.map((item) => `${item.label}：${item.value}`).join("；");
  if (!description) return meta;
  if (!meta) return description;
  return `${description}\n${meta}`;
}

function format_event_datetime(value: string): { full: string } {
  return { full: format_datetime(value) };
}

function build_event_view(event: WebuiTurnEventSnapshot): EventView {
  const raw = parse_raw_event(event.raw);
  if (!is_record(raw)) return build_generic_event_view(event);

  const event_type = read_string(raw.type) ?? event.type;
  if (event_type === "turn.started") {
    const context = is_record(raw.context) ? raw.context : null;
    const turnType = read_string(context?.turn_type);
    return {
      title: "轮次开始",
      description: "",
      badge: "运行",
      badge_variant: "default",
      icon: <TurnTypeBadge type={turnType} />,
      meta: [
        { label: "类型", value: turn_type_label(turnType) },
        { label: "轮次", value: read_string(context?.turn_id) ?? "-" },
        { label: "尝试", value: read_number(context?.attempt)?.toString() ?? "-" },
      ],
    };
  }
  if (event_type === "turn.finished") {
    return {
      title: "轮次结束",
      description: read_string(raw.message) ?? "",
      badge: "完成",
      badge_variant: "secondary",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      meta: [],
    };
  }
  if (event_type === "turn.failed" || event_type === "validation.failed") {
    return {
      title: "轮次异常",
      description: read_string(raw.message) ?? read_string(raw.error) ?? event.detail,
      badge: "异常",
      badge_variant: "destructive",
      icon: <XCircle className="h-3.5 w-3.5" />,
      meta: [],
    };
  }
  if (event_type === "state.ready") {
    const state = is_record(raw.state) ? raw.state : null;
    return {
      title: "状态已写入",
      description:
        read_string(state?.summary) ?? read_string(raw.message) ?? "本轮状态文件已生成。",
      badge: "状态",
      badge_variant: "outline",
      icon: <ListChecks className="h-3.5 w-3.5" />,
      meta: [
        { label: "下一步", value: format_next_action(read_string(state?.next_action)) },
        { label: "休眠", value: format_sleep_duration(state?.sleep_duration) },
      ],
    };
  }
  if (event_type === "codex.event") return build_codex_event_view(event, raw);
  return build_generic_event_view(event);
}

function build_codex_event_view(
  event: WebuiTurnEventSnapshot,
  raw: Record<string, unknown>,
): EventView {
  const codex_event = is_record(raw.event) ? raw.event : null;
  const codex_type = read_string(codex_event?.type) ?? "codex.event";
  const item = is_record(codex_event?.item) ? codex_event.item : null;
  const item_type = read_string(item?.type);
  if (codex_type === "thread.started") {
    return {
      title: "会话已连接",
      description: "",
      badge: "会话",
      badge_variant: "outline",
      icon: <PlayCircle className="h-3.5 w-3.5" />,
      meta: [],
    };
  }
  if (codex_type === "turn.started") {
    return {
      title: "模型开始处理",
      description: "",
      badge: "模型",
      badge_variant: "default",
      icon: <PlayCircle className="h-3.5 w-3.5" />,
      meta: [],
    };
  }
  if (codex_type === "turn.completed") {
    const usage = is_record(codex_event?.usage) ? codex_event.usage : null;
    const input_tokens = read_number(usage?.input_tokens) ?? 0;
    const cached_input_tokens = read_number(usage?.cached_input_tokens) ?? 0;
    const output_tokens = read_number(usage?.output_tokens) ?? 0;
    return {
      title: "模型处理完成",
      description: "",
      badge: "完成",
      badge_variant: "secondary",
      icon: <CheckCircle2 className="h-3.5 w-3.5" />,
      meta: [
        { label: "输入 token", value: format_token_event_value(input_tokens) },
        { label: "缓存 token", value: format_token_event_value(cached_input_tokens) },
        { label: "输出 token", value: format_token_event_value(output_tokens) },
        { label: "总 token", value: format_token_event_value(input_tokens + output_tokens) },
      ],
    };
  }
  if (codex_type === "turn.failed" || codex_type === "error") {
    const error = is_record(codex_event?.error) ? codex_event.error : null;
    return {
      title: "模型运行异常",
      description: read_string(error?.message) ?? read_string(codex_event?.message) ?? event.detail,
      badge: "异常",
      badge_variant: "destructive",
      icon: <XCircle className="h-3.5 w-3.5" />,
      meta: [],
    };
  }
  if (item_type === "command_execution") {
    return build_command_event_view(codex_type, item, event.detail);
  }
  if (item_type === "mcp_tool_call") {
    return build_mcp_tool_event_view(codex_type, item);
  }
  if (item_type === "agent_message") {
    return {
      title: "模型回复",
      description: clip_text(read_string(item.text) ?? event.detail, 220) || "代理消息事件。",
      badge: "消息",
      badge_variant: "secondary",
      icon: <MessageSquareText className="h-3.5 w-3.5" />,
      meta: [],
    };
  }
  if (item_type === "reasoning") {
    return {
      title: codex_type === "item.completed" ? "推理摘要完成" : "正在整理推理",
      description: clip_text(read_string(item.text) ?? event.detail, 220) || "模型推理摘要事件。",
      badge: "推理",
      badge_variant: "outline",
      icon: <MessageSquareText className="h-3.5 w-3.5" />,
      meta: [{ label: "类型", value: humanize_event_type(codex_type) }],
    };
  }
  if (item_type === "file_change") {
    return build_file_change_event_view(codex_type, item);
  }
  if (item_type === "web_search") {
    return {
      title: codex_type === "item.completed" ? "网页搜索完成" : "正在网页搜索",
      description: read_string(item.query) ?? "执行网页搜索。",
      badge: "搜索",
      badge_variant: codex_type === "item.completed" ? "secondary" : "default",
      icon: <Search className="h-3.5 w-3.5" />,
      meta: [],
    };
  }
  if (item_type === "todo_list") {
    const items = Array.isArray(item.items) ? item.items : [];
    const completed = items.filter((todo) => is_record(todo) && todo.completed === true).length;
    return {
      title: codex_type === "item.completed" ? "计划列表完成" : "计划列表更新",
      description: `当前计划包含 ${items.length} 个步骤，已完成 ${completed} 个。`,
      badge: "计划",
      badge_variant: "outline",
      icon: <ListChecks className="h-3.5 w-3.5" />,
      meta: [
        { label: "步骤数", value: items.length },
        { label: "已完成", value: completed },
      ],
    };
  }
  if (item_type === "error") {
    return {
      title: "非致命错误",
      description: read_string(item.message) ?? event.detail,
      badge: "错误",
      badge_variant: "destructive",
      icon: <XCircle className="h-3.5 w-3.5" />,
      meta: [{ label: "类型", value: humanize_event_type(codex_type) }],
    };
  }
  return {
    title: humanize_event_type(codex_type),
    description: event.detail || "Codex 运行事件。",
    badge: "Codex",
    badge_variant: "outline",
    icon: <Circle className="h-3.5 w-3.5" />,
    meta: [],
  };
}

function build_command_event_view(
  codex_type: string,
  item: Record<string, unknown>,
  fallback: string,
): EventView {
  const status = read_string(item.status);
  const id = read_string(item.id);
  const is_finished = codex_type === "item.completed";
  const is_failed = status === "failed" || status === "cancelled";
  const titleIcon = is_failed ? (
    <XCircle className="h-3.5 w-3.5" />
  ) : is_finished ? (
    <CheckCircle2 className="h-3.5 w-3.5" />
  ) : (
    <PlayCircle className="h-3.5 w-3.5" />
  );
  return {
    title: `执行命令${id ? ` - [${id}]` : ""}`,
    description: "",
    badge: is_failed ? "失败" : is_finished ? "命令" : "执行中",
    badge_variant: is_failed ? "destructive" : is_finished ? "secondary" : "default",
    icon: is_failed ? (
      <XCircle className="h-3.5 w-3.5" />
    ) : (
      <TerminalSquare className="h-3.5 w-3.5" />
    ),
    title_icon: titleIcon,
    meta: [],
  };
}

function build_mcp_tool_event_view(codex_type: string, item: Record<string, unknown>): EventView {
  const status = read_string(item.status);
  const is_finished = codex_type === "item.completed";
  const is_failed = status === "failed";
  const error = is_record(item.error) ? read_string(item.error.message) : null;
  return {
    title: is_finished ? "工具调用完成" : "工具调用开始",
    description: error ?? "",
    badge: is_failed ? "失败" : is_finished ? "工具" : "调用中",
    badge_variant: is_failed ? "destructive" : is_finished ? "secondary" : "default",
    icon: is_failed ? (
      <XCircle className="h-3.5 w-3.5" />
    ) : (
      <TerminalSquare className="h-3.5 w-3.5" />
    ),
    meta: [
      { label: "服务", value: read_string(item.server) ?? "-" },
      { label: "工具", value: read_string(item.tool) ?? "-" },
      { label: "状态", value: humanize_command_status(status) },
      { label: "类型", value: humanize_event_type(codex_type) },
    ],
  };
}

function build_file_change_event_view(
  codex_type: string,
  item: Record<string, unknown>,
): EventView {
  const status = read_string(item.status);
  const changes = Array.isArray(item.changes) ? item.changes.filter(is_record) : [];
  const is_failed = status === "failed";
  const icon = is_failed ? (
    <XCircle className="h-3.5 w-3.5" />
  ) : (
    <CheckCircle2 className="h-3.5 w-3.5" />
  );
  return {
    title: "文件变更",
    description: format_file_change_counts(changes),
    badge: is_failed ? "失败" : "文件",
    badge_variant: is_failed ? "destructive" : "outline",
    icon: <FileText className="h-3.5 w-3.5" />,
    title_icon: icon,
    meta: [],
  };
}

function format_file_change_counts(changes: Record<string, unknown>[]): string {
  const add = count_file_changes(changes, "add");
  const remove = count_file_changes(changes, "delete");
  const update = count_file_changes(changes, "update");
  return [
    add > 0 ? `新增：${add}` : null,
    remove > 0 ? `删除：${remove}` : null,
    update > 0 ? `修改：${update}` : null,
  ]
    .filter((item): item is string => item !== null)
    .join("；");
}

function count_file_changes(changes: Record<string, unknown>[], kind: string): number {
  return changes.filter((change) => read_string(change.kind) === kind).length;
}

function build_generic_event_view(event: WebuiTurnEventSnapshot): EventView {
  return {
    title: humanize_event_type(event.type),
    description: event.detail || "",
    badge: "事件",
    badge_variant: "outline",
    icon: <Circle className="h-3.5 w-3.5" />,
    meta: [],
  };
}

function parse_raw_event(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function is_record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read_string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function read_number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function compare_event_time(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) return left.localeCompare(right);
  return leftTime - rightTime;
}

function format_sleep_duration(value: unknown): string {
  const duration = read_number(value);
  return duration === null ? "-" : `${duration} 秒`;
}

function TokenCacheRate({
  cached_input_tokens,
  input_tokens,
}: {
  cached_input_tokens: number;
  input_tokens: number;
}) {
  const cache_rate = input_tokens > 0 ? cached_input_tokens / input_tokens : 0;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <AnimatedCompactNumber value={input_tokens} />
      <span>/</span>
      <AnimatedPercent value={cache_rate} />
    </span>
  );
}

function format_token_event_value(value: number): string {
  return format_compact_number(value);
}

function format_next_action(value: string | null): string {
  if (value === "continue") return "继续运行";
  if (value === "stop") return "停止";
  return value ?? "-";
}

function humanize_command_status(status: string | null): string {
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  if (status === "in_progress") return "执行中";
  return status ?? "-";
}

function humanize_patch_kind(kind: string | null): string {
  if (kind === "add") return "新增";
  if (kind === "delete") return "删除";
  if (kind === "update") return "更新";
  return "变更";
}

function humanize_event_type(type: string): string {
  if (type === "thread.started") return "会话开始";
  if (type === "turn.started") return "轮次开始";
  if (type === "turn.completed") return "轮次完成";
  if (type === "turn.failed") return "轮次失败";
  if (type === "error") return "流错误";
  if (type === "item.started") return "执行项开始";
  if (type === "item.updated") return "执行项更新";
  if (type === "item.completed") return "执行项完成";
  if (type === "codex.event") return "Codex 事件";
  return type;
}

export function LogPanel({ log }: { log: WebuiLogSnapshot | null }) {
  return (
    <Card>
      <CardHeader>
        <PanelTitle icon={<ScrollText className="h-4 w-4" />} title="日志" />
      </CardHeader>
      <CardContent>
        {!log ? (
          <EmptyBlock text="暂无日志" compact />
        ) : log.error ? (
          <EmptyBlock text={log.error} compact />
        ) : log.content.trim() ? (
          <MarkdownContent content={log.content} emptyText="日志正文为空" />
        ) : (
          <EmptyBlock text="日志正文为空" compact />
        )}
      </CardContent>
    </Card>
  );
}

export function WorkOrderListPanel({
  box = "mixed",
  title,
  orders,
  onSelect,
  compact = false,
  description,
  headerAction,
  emptyText = "暂无工作单",
  selectedOrderPath,
  turnTypeById,
  variant = "card",
}: {
  box?: WorkOrderBoxKind;
  title: string;
  orders: WorkOrderSnapshot[];
  onSelect: (order: WorkOrderSnapshot) => void;
  compact?: boolean;
  description?: string | null;
  headerAction?: React.ReactNode;
  emptyText?: string;
  selectedOrderPath?: string | null;
  turnTypeById?: TurnTypeById;
  variant?: "card" | "sidebar";
}) {
  const sortedOrders = get_sorted_work_orders(orders);
  const panelDescription = description === undefined ? `${orders.length} 个工作单` : description;
  const rowAction: WorkOrderRowAction = variant === "sidebar" ? "select" : "view";
  const peerHeader = get_work_order_peer_header(box);
  if (variant === "sidebar") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
        <div className="border-b px-3 py-2">
          {headerAction ? (
            headerAction
          ) : (
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Inbox className="h-4 w-4" />
              {title}
            </div>
          )}
        </div>
        <ScrollArea className="turn-list-scroll min-h-0 flex-1">
          {orders.length === 0 ? (
            <div className="p-2">
              <EmptyBlock text={emptyText} compact />
            </div>
          ) : (
            <div className="turn-list p-2">
              {sortedOrders.map((order) => (
                <WorkOrderRowButton
                  action={rowAction}
                  box={box}
                  isSelected={order.relative_work_order_path === selectedOrderPath}
                  order={order}
                  key={order.relative_work_order_path}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  return (
    <Card className="flex h-full min-h-0 flex-col">
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          {title ? <PanelTitle icon={<Inbox className="h-4 w-4" />} title={title} /> : null}
          {headerAction}
        </div>
        {panelDescription ? <CardDescription>{panelDescription}</CardDescription> : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {orders.length === 0 ? (
          <EmptyBlock text={emptyText} className="flex-1" compact />
        ) : compact ? (
          <div className="flex flex-col gap-2">
            {sortedOrders.map((order) => (
              <WorkOrderRowButton
                action={rowAction}
                box={box}
                isSelected={order.relative_work_order_path === selectedOrderPath}
                order={order}
                key={order.relative_work_order_path}
                onSelect={onSelect}
              />
            ))}
          </div>
        ) : (
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                <TableHead>摘要</TableHead>
                <TableHead className="w-24">状态</TableHead>
                <TableHead className="w-28">{peerHeader}</TableHead>
                <TableHead className="w-32">轮次</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedOrders.map((order) => (
                <TableRow
                  className={`cursor-pointer ${
                    order.relative_work_order_path === selectedOrderPath ? "bg-secondary" : ""
                  }`}
                  key={order.relative_work_order_path}
                  onClick={() => onSelect(order)}
                >
                  <TableCell>
                    <div className="truncate font-medium">
                      {order.summary ?? order.relative_work_order_path}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {order.relative_work_order_path}
                    </div>
                  </TableCell>
                  <TableCell>
                    <WorkOrderStatusBadge status={order.status} />
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {get_work_order_peer_value(order, box)}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <TurnReference
                      turnId={order.turn_id ?? order.completion_report?.turn_id}
                      type={get_turn_type(
                        turnTypeById,
                        order.turn_id ?? order.completion_report?.turn_id,
                      )}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

export function WorkOrderDetailPanel({
  agentPath,
  order,
  turnTypeById,
}: {
  agentPath: string;
  order: WorkOrderSnapshot | null;
  turnTypeById?: TurnTypeById;
}) {
  if (!order) return <EmptyBlock text="请选择一个工作单" className="h-full" />;
  return (
    <Card className="flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs defaultValue="work-order" className="flex h-full min-h-0 flex-col">
        <CardHeader className="flex-row items-center gap-3">
          <TabsList>
            <TabsTrigger value="work-order">工作单</TabsTrigger>
            <TabsTrigger value="completion-report">完成报告</TabsTrigger>
            <TabsTrigger value="work-check">检查报告</TabsTrigger>
          </TabsList>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 p-0">
          <TabsContent value="work-order" className="mt-0 h-full min-h-0">
            <div className="flex h-full min-h-0 flex-col gap-4 px-4 pb-4">
              <div className="shrink-0">
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <InfoTile label="状态" value={<WorkOrderStatusBadge status={order.status} />} />
                  <InfoTile
                    label="轮次"
                    value={
                      <TurnReference
                        turnId={order.turn_id}
                        type={get_turn_type(turnTypeById, order.turn_id)}
                      />
                    }
                  />
                  <InfoTile label="发件人" value={order.delegator ?? "-"} />
                  <InfoTile label="发送时间" value={format_datetime(order.created_at)} />
                </div>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-4 pr-2">
                  <MarkdownContent content={order.content ?? ""} emptyText="正文为空" />
                  <WorkOrderFilesPanel
                    agentPath={agentPath}
                    title="附件"
                    files={order.input_files ?? []}
                  />
                </div>
              </ScrollArea>
            </div>
          </TabsContent>
          <TabsContent value="completion-report" className="mt-0 h-full min-h-0">
            <div className="flex h-full min-h-0 flex-col gap-4 px-4 pb-4">
              {order.completion_report ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <InfoTile
                      label="轮次"
                      value={
                        <TurnReference
                          turnId={order.completion_report.turn_id}
                          type={get_turn_type(turnTypeById, order.completion_report.turn_id)}
                        />
                      }
                    />
                    <InfoTile
                      label="创建时间"
                      value={format_datetime(order.completion_report.created_at)}
                    />
                    <InfoTile
                      label="状态"
                      value={
                        <WorkOrderCheckStatusBadge status={order.completion_report.check_status} />
                      }
                    />
                    <InfoTile label="汇报人" value={order.completion_report.executor ?? "-"} />
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-4 pr-2">
                      <MarkdownContent
                        content={order.completion_report.content ?? ""}
                        emptyText="暂无完成报告正文"
                      />
                      <WorkOrderFilesPanel
                        agentPath={agentPath}
                        title="附件"
                        files={order.output_files ?? []}
                      />
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <EmptyBlock text="暂无完成报告" />
              )}
            </div>
          </TabsContent>
          <TabsContent value="work-check" className="mt-0 h-full min-h-0">
            <div className="flex h-full min-h-0 flex-col gap-4 px-4 pb-4">
              {order.work_check ? (
                <>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <InfoTile
                      label="状态"
                      value={<WorkOrderCheckStatusBadge status={order.check_status} />}
                    />
                    <InfoTile
                      label="未关闭问题"
                      value={String(order.work_check.open_issue_count ?? "-")}
                    />
                  </div>
                  <ScrollArea className="min-h-0 flex-1">
                    <div className="space-y-4 pr-2">
                      <MarkdownContent
                        content={order.work_check.content ?? ""}
                        emptyText="暂无检查报告正文"
                      />
                    </div>
                  </ScrollArea>
                </>
              ) : (
                <EmptyBlock text="暂无检查报告" />
              )}
            </div>
          </TabsContent>
        </CardContent>
      </Tabs>
    </Card>
  );
}

export function WorkOrderDetailDialog({
  agentPath,
  open,
  onOpenChange,
  order,
  turnTypeById,
}: DetailDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(1040px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{order?.summary ?? "工作单详情"}</DialogTitle>
          <DialogDescription>{order?.relative_work_order_path}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[68vh] pr-2">
          <WorkOrderDetailPanel agentPath={agentPath} order={order} turnTypeById={turnTypeById} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function HumanRequestListPanel({
  title,
  requests,
  onSelect,
  emptyText = "暂无人类协助",
  showDescription = true,
  selectedRequestPath,
  variant = "card",
}: {
  title: string;
  requests: HumanRequestSummary[];
  onSelect: (request: HumanRequestSummary) => void;
  emptyText?: string;
  showDescription?: boolean;
  selectedRequestPath?: string | null;
  variant?: "card" | "sidebar";
}) {
  const sortedRequests = [...requests].sort((left, right) => {
    const timeCompare = compare_optional_time(right.created_at, left.created_at);
    if (timeCompare !== 0) return timeCompare;
    return left.relative_path.localeCompare(right.relative_path);
  });
  if (variant === "sidebar") {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
        <div className="border-b px-3 py-2">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Hand className="h-4 w-4" />
            {title}
          </div>
        </div>
        <ScrollArea className="turn-list-scroll min-h-0 flex-1">
          {sortedRequests.length === 0 ? (
            <div className="p-2">
              <EmptyBlock text={emptyText} compact />
            </div>
          ) : (
            <div className="turn-list flex flex-col gap-2 p-2">
              {sortedRequests.map((request) => (
                <HumanRequestRowButton
                  isSelected={request.relative_path === selectedRequestPath}
                  key={request.relative_path}
                  request={request}
                  onSelect={onSelect}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <PanelTitle icon={<Hand className="h-4 w-4" />} title={title} />
        {showDescription ? (
          <CardDescription>{requests.length} 个人类协助文件</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {sortedRequests.length === 0 ? (
          <EmptyBlock text={emptyText} compact />
        ) : (
          <div className="flex flex-col gap-2">
            {sortedRequests.map((request) => (
              <HumanRequestRowButton
                key={request.relative_path}
                request={request}
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HumanRequestRowButton({
  isSelected = false,
  request,
  onSelect,
}: {
  isSelected?: boolean;
  request: HumanRequestSummary;
  onSelect: (request: HumanRequestSummary) => void;
}) {
  return (
    <button
      className={`request-row relative ${isSelected ? "request-row-selected" : ""}`}
      type="button"
      onClick={() => onSelect(request)}
    >
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">
          {request.summary ?? request.relative_path}
        </span>
        <span className="mt-1 flex min-w-0 items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{format_datetime(request.created_at)} 创建</span>
          <StatusBadge status={request.status} className="px-1.5 text-[10px] leading-4" />
        </span>
      </span>
    </button>
  );
}

export function HumanRequestDetailPanel({
  request,
  onChanged,
  turnTypeById,
}: {
  request: HumanRequestSummary | null;
  onChanged?: () => void;
  turnTypeById?: TurnTypeById;
}) {
  const [action, setAction] = useState<"complete" | "cancel" | null>(null);
  if (!request) return <EmptyBlock text="请选择一个人类协助文件" className="h-full" />;
  const canProcess = request.status === "waiting" && onChanged;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Card>
        <CardHeader>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <PanelTitle icon={<Hand className="h-4 w-4" />} title="人类协助事项详情" />
            </div>
            <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span>轮次</span>
              <TurnReference
                turnId={request.turn_id}
                type={get_turn_type(turnTypeById, request.turn_id)}
              />
              <span>{format_datetime(request.created_at)} 创建</span>
            </div>
          </div>
          <CardDescription>{request.summary ?? "暂无摘要"}</CardDescription>
        </CardHeader>
        {canProcess ? (
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button type="button" onClick={() => setAction("complete")}>
                处理完成
              </Button>
              <Button type="button" variant="outline" onClick={() => setAction("cancel")}>
                取消
              </Button>
            </div>
          </CardContent>
        ) : null}
      </Card>
      <Card className="flex min-h-0 flex-1 flex-col">
        <CardContent className="min-h-0 flex-1 p-4">
          <MarkdownContent
            content={request.content ?? ""}
            emptyText="协助内容为空"
            withTopBorder={false}
          />
        </CardContent>
      </Card>
      <HumanRequestActionDialog
        action={action}
        request={request}
        onChanged={onChanged}
        onOpenChange={(open) => !open && setAction(null)}
      />
    </div>
  );
}

function compare_optional_time(left: string | null | undefined, right: string | null | undefined) {
  const leftTime = left ? Date.parse(left) : Number.NaN;
  const rightTime = right ? Date.parse(right) : Number.NaN;
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return 1;
  if (Number.isNaN(rightTime)) return -1;
  return leftTime - rightTime;
}

function HumanRequestActionDialog({
  action,
  request,
  onChanged,
  onOpenChange,
}: {
  action: "complete" | "cancel" | null;
  request: HumanRequestSummary;
  onChanged?: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [result, setResult] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const open = action !== null;
  const actionText = action === "complete" ? "处理完成" : "取消";

  const submit = async () => {
    if (!action || !onChanged) return;
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        agent_path: request.agent_path,
        request_path: request.relative_path,
        result,
      };
      if (action === "complete") await complete_human_request(payload);
      else await cancel_human_request(payload);
      setResult("");
      onOpenChange(false);
      onChanged();
    } catch (submit_error) {
      setError(to_error_message(submit_error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setResult("");
          setError(null);
        }
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="w-[min(560px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{actionText}人类协助</DialogTitle>
          <DialogDescription>{request.summary ?? request.relative_path}</DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert className="border-red-200 bg-red-50 text-red-900">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div>
          <div className="mb-2 text-sm font-medium">补充信息</div>
          <Textarea
            className="min-h-[160px]"
            value={result}
            placeholder={
              action === "complete"
                ? "填写处理结果，提交后请求会标记为 done。"
                : "填写取消原因，提交后请求会标记为 cancelled。"
            }
            onChange={(event) => setResult(event.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            返回
          </Button>
          <Button
            type="button"
            variant={action === "cancel" ? "destructive" : "default"}
            disabled={!result.trim() || submitting}
            onClick={submit}
          >
            {submitting ? "提交中" : actionText}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HumanRequestDetailDialog({
  open,
  onOpenChange,
  request,
  turnTypeById,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: HumanRequestSummary | null;
  turnTypeById?: TurnTypeById;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(1040px,calc(100vw-32px))]">
        <DialogHeader>
          <DialogTitle>{request?.summary ?? "人类协助事项详情"}</DialogTitle>
          <DialogDescription>{request?.relative_path}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[68vh] pr-2">
          <HumanRequestDetailPanel request={request} turnTypeById={turnTypeById} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export function TurnOverviewPanel({ turn }: { turn: WebuiTurnSnapshot }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <PanelTitle
              icon={<TurnTypeBadge type={turn.turn_type} />}
              title={`${turn_type_label(turn.turn_type)}${turn.turn_id}`}
            />
            <StatusBadge status={turn.status} />
          </div>
          <div className="shrink-0 text-xs text-muted-foreground">
            {format_datetime(turn.started_at)} ~ {format_datetime(turn.finished_at)}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <div className="text-sm leading-6 text-muted-foreground">
          {turn.summary ?? "暂无轮次摘要"}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile label="下一步" value={format_next_action(turn.state?.next_action ?? null)} />
          <InfoTile
            label="休眠时长"
            value={turn.state ? format_sleep_duration(turn.state.sleep_duration) : "-"}
          />
          <InfoTile
            label="输入 token / 缓存率"
            value={
              <TokenCacheRate
                cached_input_tokens={turn.usage.cached_input_tokens}
                input_tokens={turn.usage.input_tokens}
              />
            }
          />
          <InfoTile
            label="总 token"
            value={<AnimatedCompactNumber value={turn.usage.total_tokens} />}
          />
        </div>
      </CardContent>
    </Card>
  );
}

function WorkOrderRowButton({
  action,
  box,
  isSelected = false,
  order,
  onSelect,
}: {
  action: WorkOrderRowAction;
  box: WorkOrderBoxKind;
  isSelected?: boolean;
  order: WorkOrderSnapshot;
  onSelect: (order: WorkOrderSnapshot) => void;
}) {
  const content = (
    <span className="work-order-row-main min-w-0">
      <span className="work-order-row-title-line">
        <WorkOrderStatusBadge status={order.status} />
        <span className="work-order-row-title-text block min-w-0 truncate text-sm font-medium">
          {order.summary ?? order.relative_work_order_path}
        </span>
        {action === "view" ? (
          <Button
            className="work-order-view-button shrink-0"
            size="sm"
            type="button"
            variant="outline"
            onClick={() => onSelect(order)}
          >
            查看
          </Button>
        ) : null}
      </span>
      <span className="mt-1 flex min-w-0 items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="min-w-0 truncate">{get_work_order_peer_text(order, box)}</span>
        <span className="shrink-0">{format_datetime(order.created_at)}</span>
      </span>
    </span>
  );

  if (action === "select") {
    return (
      <button
        className={`request-row work-order-row ${isSelected ? "request-row-selected" : ""}`}
        type="button"
        onClick={() => onSelect(order)}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`request-row work-order-row ${isSelected ? "request-row-selected" : ""}`}>
      {content}
    </div>
  );
}

function MarkdownSectionPanel({ title, content }: { title: string; content: string }) {
  const sections = parse_markdown_sections(content);
  return (
    <Card>
      <CardHeader>
        <PanelTitle icon={<FileText className="h-4 w-4" />} title={title} />
      </CardHeader>
      <CardContent>
        {sections.length === 0 ? (
          <EmptyBlock text="正文为空" compact />
        ) : (
          <div className="flex flex-col gap-3">
            {sections.map((section) => (
              <TextSection key={section.title} title={section.title} content={section.content} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WorkOrderFilesPanel({
  agentPath,
  title,
  files,
}: {
  agentPath: string;
  title: string;
  files: WorkOrderSnapshot["input_files"];
}) {
  const [preview, setPreview] = useState<{
    displayPath: string;
    relativePath: string;
    content: string | null;
    loading: boolean;
    message: string | null;
  } | null>(null);
  const [isPreviewMaximized, setIsPreviewMaximized] = useState(false);

  async function open_preview(file: WorkOrderSnapshot["input_files"][number]) {
    const displayPath = get_work_order_file_display_path(file.relative_path);
    if (!is_markdown_file(file.relative_path)) {
      setPreview({
        displayPath,
        relativePath: file.relative_path,
        content: null,
        loading: false,
        message: "暂不支持预览",
      });
      return;
    }
    setPreview({
      displayPath,
      relativePath: file.relative_path,
      content: null,
      loading: true,
      message: null,
    });
    try {
      const result = await fetch_file_preview(agentPath, file.relative_path);
      setPreview({
        displayPath,
        relativePath: result.relative_path,
        content: result.content,
        loading: false,
        message: null,
      });
    } catch (error) {
      setPreview({
        displayPath,
        relativePath: file.relative_path,
        content: null,
        loading: false,
        message: to_error_message(error),
      });
    }
  }

  async function open_location(file: WorkOrderSnapshot["input_files"][number]) {
    try {
      await open_file_location({
        agent_path: agentPath,
        file_path: file.relative_path,
      });
    } catch (error) {
      setPreview({
        displayPath: get_work_order_file_display_path(file.relative_path),
        relativePath: file.relative_path,
        content: null,
        loading: false,
        message: to_error_message(error),
      });
    }
  }

  return (
    <section className="border-t pt-4">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <span className="text-primary">
            <Inbox className="h-4 w-4" />
          </span>
          <span className="truncate">
            {title}（{files.length}）
          </span>
        </h4>
      </div>
      {files.length === 0 ? (
        <EmptyBlock text="暂无附件" className="mt-3" compact />
      ) : (
        <div className="mt-3 rounded-md border bg-background">
          {files.map((file) => (
            <div
              className="group flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0"
              key={file.relative_path}
            >
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-sm font-medium text-primary underline-offset-4 hover:underline"
                title={get_work_order_file_display_path(file.relative_path)}
                onClick={() => void open_preview(file)}
              >
                {get_work_order_file_display_path(file.relative_path)}
              </button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                title="打开所在文件夹"
                aria-label="打开所在文件夹"
                onClick={() => void open_location(file)}
              >
                <FolderOpen className="h-4 w-4" />
              </Button>
              <div className="shrink-0 text-xs text-muted-foreground">
                {format_file_size(file.size)}
              </div>
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (open) return;
          setPreview(null);
          setIsPreviewMaximized(false);
        }}
      >
        <DialogContent
          className={
            isPreviewMaximized
              ? "grid h-[calc(100vh-32px)] !max-h-[calc(100vh-32px)] !w-[calc(100vw-32px)] grid-rows-[auto_minmax(0,1fr)]"
              : "w-[min(920px,calc(100vw-32px))]"
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-10 top-3 !h-6 !w-6 text-muted-foreground"
            title={isPreviewMaximized ? "还原显示" : "最大化显示"}
            aria-label={isPreviewMaximized ? "还原显示" : "最大化显示"}
            onClick={() => setIsPreviewMaximized((value) => !value)}
          >
            {isPreviewMaximized ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
          <DialogHeader className="pr-16">
            <DialogTitle>{preview?.displayPath ?? "附件预览"}</DialogTitle>
          </DialogHeader>
          <ScrollArea className={isPreviewMaximized ? "min-h-0 pr-2" : "max-h-[68vh] pr-2"}>
            {preview?.loading ? (
              <EmptyBlock text="正在加载预览" compact />
            ) : preview?.content !== null && preview?.content !== undefined ? (
              <MarkdownContent
                content={preview.content}
                emptyText="文件为空"
                withTopBorder={false}
              />
            ) : (
              <EmptyBlock text={preview?.message ?? "暂不支持预览"} compact />
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </section>
  );
}

type MarkdownContentProps = {
  content: string;
  emptyText: string;
  withTopBorder?: boolean;
};

export const MarkdownContent = memo(function MarkdownContent({
  content,
  emptyText,
  withTopBorder = true,
}: MarkdownContentProps) {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    return (
      <div className={withTopBorder ? "border-t pt-4" : ""}>
        <EmptyBlock text={emptyText} compact />
      </div>
    );
  }
  return (
    <section className={withTopBorder ? "border-t pt-4" : ""}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h3 className="text-base font-semibold">{children}</h3>,
          h2: ({ children }) => <h4 className="mt-5 text-sm font-semibold">{children}</h4>,
          h3: ({ children }) => <h5 className="mt-4 text-sm font-semibold">{children}</h5>,
          p: ({ children }) => (
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-sm leading-6 text-muted-foreground">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5 text-sm leading-6 text-muted-foreground">
              {children}
            </ol>
          ),
          li: ({ children }) => <li>{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          code: ({ children }) => (
            <code className="rounded bg-muted px-1 py-0.5 text-xs text-foreground">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="mt-3 overflow-x-auto rounded-md bg-muted p-3 text-xs leading-5 text-foreground">
              {children}
            </pre>
          ),
          table: ({ children }) => (
            <div className="mt-3 overflow-x-auto rounded-md border">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          ),
          tr: ({ children }) => <tr className="border-b last:border-b-0">{children}</tr>,
          th: ({ children }) => (
            <th className="bg-muted px-3 py-2 text-left font-semibold">{children}</th>
          ),
          td: ({ children }) => <td className="px-3 py-2 text-muted-foreground">{children}</td>,
        }}
      >
        {normalizedContent}
      </ReactMarkdown>
    </section>
  );
}, are_markdown_content_props_equal);

function are_markdown_content_props_equal(
  previous: MarkdownContentProps,
  next: MarkdownContentProps,
): boolean {
  return (
    previous.content.trim() === next.content.trim() &&
    previous.emptyText === next.emptyText &&
    (previous.withTopBorder ?? true) === (next.withTopBorder ?? true)
  );
}

function get_work_order_file_display_path(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  for (const marker of ["/input/", "/output/"]) {
    const index = normalizedPath.indexOf(marker);
    if (index >= 0) return normalizedPath.slice(index + marker.length);
  }
  for (const prefix of ["input/", "output/"]) {
    if (normalizedPath.startsWith(prefix)) return normalizedPath.slice(prefix.length);
  }
  return normalizedPath.split("/").pop() || path;
}

function is_markdown_file(path: string): boolean {
  return path.replaceAll("\\", "/").toLowerCase().endsWith(".md");
}

function TextSection({
  title,
  content,
  tone = "default",
}: {
  title: string;
  content: string;
  tone?: "default" | "error";
}) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3">
      <div className="flex items-center gap-1.5 text-sm font-semibold">
        {tone === "error" ? <XCircle className="size-4 shrink-0 text-red-600" /> : null}
        <span>{title}</span>
      </div>
      <p
        className={`mt-2 whitespace-pre-wrap break-words text-sm leading-6 ${
          tone === "error" ? "text-red-700" : "text-muted-foreground"
        }`}
      >
        {content.trim() || "空"}
      </p>
    </div>
  );
}

function KeyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-2">
      <span>{label}</span>
      <span className="truncate text-foreground">{value}</span>
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <CardTitle className="flex min-w-0 items-center gap-2">
      <span className="text-primary">{icon}</span>
      <span className="truncate">{title}</span>
    </CardTitle>
  );
}

function InfoTile({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-md border bg-background px-3 py-2">
      <div className="truncate text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function EmptyBlock({
  text,
  compact = false,
  className = "",
}: {
  text: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center rounded-md border border-dashed bg-muted/30 text-center text-sm text-muted-foreground ${
        compact ? "px-3 py-5" : "px-3 py-10"
      } ${className}`}
    >
      {text}
    </div>
  );
}

function WorkOrderStatusBadge({ status }: { status: WorkOrderSnapshot["status"] }) {
  if (status === "active") {
    return <Badge className="border-emerald-200 bg-emerald-50 text-emerald-700">进行中</Badge>;
  }
  return <Badge className="border-sky-200 bg-sky-50 text-sky-700">已完成</Badge>;
}

function WorkOrderCheckStatusBadge({ status }: { status: WorkOrderSnapshot["check_status"] }) {
  if (status === "passed") {
    return <Badge className="border-sky-200 bg-sky-50 text-sky-700">已通过</Badge>;
  }
  if (status === "failed") {
    return <Badge className="border-red-200 bg-red-50 text-red-700">未通过</Badge>;
  }
  if (status === "pending") {
    return <Badge className="border-amber-200 bg-amber-50 text-amber-700">待检查</Badge>;
  }
  return <span>-</span>;
}

function get_turn_type(turnTypeById: TurnTypeById | undefined, turnId: string | null | undefined) {
  if (!turnId) return null;
  return turnTypeById?.get(turnId) ?? null;
}

function get_work_order_peer_header(box: WorkOrderBoxKind): string {
  if (box === "inbox") return "发件人";
  if (box === "outbox") return "收件人";
  return "联系人";
}

function get_work_order_peer_value(order: WorkOrderSnapshot, box: WorkOrderBoxKind): string {
  if (box === "inbox") return order.delegator ?? "-";
  if (box === "outbox") return order.executor ?? "-";
  return `${order.delegator ?? "-"} / ${order.executor ?? "-"}`;
}

function get_work_order_peer_text(order: WorkOrderSnapshot, box: WorkOrderBoxKind): string {
  if (box === "inbox") return `发件人：${order.delegator ?? "未知"}`;
  if (box === "outbox") return `收件人：${order.executor ?? "未知"}`;
  return `发件人：${order.delegator ?? "未知"} · 收件人：${order.executor ?? "未知"}`;
}

function get_sorted_work_orders(orders: WorkOrderSnapshot[]): WorkOrderSnapshot[] {
  return [...orders].sort((left, right) => {
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    return left.relative_work_order_path.localeCompare(right.relative_work_order_path);
  });
}

function parse_markdown_sections(content: string): { title: string; content: string }[] {
  if (!content.trim()) return [];
  const sections: { title: string; content: string }[] = [];
  const lines = content.split(/\r?\n/);
  let current_title = "正文";
  let current_lines: string[] = [];
  for (const line of lines) {
    const heading = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      if (current_lines.join("\n").trim()) {
        sections.push({ title: current_title, content: current_lines.join("\n").trim() });
      }
      current_title = heading[2];
      current_lines = [];
      continue;
    }
    current_lines.push(line);
  }
  if (current_lines.join("\n").trim()) {
    sections.push({ title: current_title, content: current_lines.join("\n").trim() });
  }
  return sections.length > 0 ? sections : [{ title: "正文", content: content.trim() }];
}

function format_file_size(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
