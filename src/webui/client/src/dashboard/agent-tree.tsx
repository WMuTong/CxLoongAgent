import { ChevronRight } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { type NodeRendererProps, Tree } from "react-arborist";
import type { AgentObserveSnapshot, WebuiAgentSnapshot } from "../types";
import { format_agent_name_with_position, format_time } from "./format";
import { status_dot_class, status_label } from "./status";

type AgentTreeProps = {
  agents: WebuiAgentSnapshot[];
  observeAgents: AgentObserveSnapshot[];
  selectedAgentPath: string;
  onSelect: (agentPath: string) => void;
};

type AgentTreeData = {
  id: string;
  agent_path: string;
  name: string;
  position: string;
  label: string;
  status: string;
  last_activity: string;
  sleep_until: string | null;
  waiting_count: number;
  children?: AgentTreeData[];
};

export function AgentTree({ agents, observeAgents, selectedAgentPath, onSelect }: AgentTreeProps) {
  const data = use_stable_agent_tree_data(agents, observeAgents);
  const { ref, width, height } = use_tree_container_size();
  const handle_activate = useCallback(
    (node: { data: AgentTreeData }) => onSelect(node.data.agent_path),
    [onSelect],
  );

  return (
    <div ref={ref} className="agent-tree-shell">
      <Tree<AgentTreeData>
        className="agent-tree"
        data={data}
        disableDrag={true}
        disableDrop={true}
        disableEdit={true}
        disableMultiSelection={true}
        height={Math.max(height, 320)}
        indent={18}
        openByDefault={true}
        rowHeight={40}
        selection={selectedAgentPath}
        width={Math.max(width, 280)}
        onActivate={handle_activate}
      >
        {AgentTreeRow}
      </Tree>
    </div>
  );
}

function AgentTreeRow({ node, style }: NodeRendererProps<AgentTreeData>) {
  const agent = node.data;

  return (
    <div style={style}>
      <div
        className={`agent-row ${node.isSelected ? "agent-row-selected" : ""}`}
        title={`${agent.label}\n${build_status_tooltip(agent)}`}
      >
        {node.isInternal ? (
          <button
            aria-label={node.isOpen ? `收起 ${agent.label}` : `展开 ${agent.label}`}
            className="agent-expand-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              node.toggle();
            }}
          >
            <ChevronRight
              className={`h-4 w-4 transition-transform ${node.isOpen ? "rotate-90" : ""}`}
            />
          </button>
        ) : (
          <span className="agent-expand-placeholder" />
        )}
        <button
          className="agent-row-main"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            node.select();
            node.activate();
          }}
        >
          <span
            className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ${status_dot_class(agent.status)}`}
          />
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="min-w-0 truncate font-medium">
                {agent.name}
                {agent.position ? (
                  <span className="ml-0.5 text-xs font-normal text-muted-foreground">
                    ({agent.position})
                  </span>
                ) : null}
              </span>
              {agent.waiting_count > 0 ? (
                <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[11px] font-semibold text-white">
                  {agent.waiting_count}
                </span>
              ) : null}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

function use_stable_agent_tree_data(
  agents: WebuiAgentSnapshot[],
  observeAgents: AgentObserveSnapshot[],
): AgentTreeData[] {
  const current = useMemo(
    () => build_agent_tree_data(agents, observeAgents),
    [agents, observeAgents],
  );
  const previous = useRef<{ signature: string; data: AgentTreeData[] } | null>(null);

  if (previous.current?.signature === current.signature) return previous.current.data;
  previous.current = current;
  return current.data;
}

function build_agent_tree_data(
  agents: WebuiAgentSnapshot[],
  observeAgents: AgentObserveSnapshot[],
): { signature: string; data: AgentTreeData[] } {
  const nodes = new Map<string, AgentTreeData>();
  const roots: AgentTreeData[] = [];
  const observeByPath = new Map(observeAgents.map((observe) => [observe.display_path, observe]));
  const signature_parts: string[] = [];

  for (const agent of agents) {
    const observe = observeByPath.get(agent.agent_path) ?? observeByPath.get(agent.name);
    const position = agent.position?.trim() ?? "";
    const waiting_count = agent.human_requests.filter(
      (request) => request.status === "waiting",
    ).length;
    const node = {
      id: agent.agent_path,
      agent_path: agent.agent_path,
      name: agent.name,
      position,
      label: format_agent_name_with_position(agent),
      status: observe?.status ?? "stopped",
      last_activity: observe?.last_activity ?? "-",
      sleep_until: observe?.sleep_until ?? null,
      waiting_count,
    };
    nodes.set(agent.agent_path, node);
    signature_parts.push(
      [node.agent_path, node.name, node.position, node.status, String(node.waiting_count)].join(
        "\u001f",
      ),
    );
  }

  for (const agent of agents) {
    const node = nodes.get(agent.agent_path);
    if (!node) continue;
    const parentPath = get_parent_agent_path(agent.agent_path);
    const parent = parentPath ? nodes.get(parentPath) : null;
    if (parent) {
      parent.children = parent.children ?? [];
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return { signature: signature_parts.join("\u001e"), data: roots };
}

function get_parent_agent_path(agentPath: string): string | null {
  if (agentPath === ".") return null;
  const segments = agentPath.split("/");
  if (segments.length <= 2) return ".";
  return segments.slice(0, -2).join("/");
}

function build_status_tooltip(agent: AgentTreeData): string {
  const parts = [
    `状态：${status_label(agent.status)}`,
    `最近活动：${format_time(agent.last_activity)}`,
  ];
  if (agent.sleep_until) parts.push(`唤醒时间：${format_time(agent.sleep_until)}`);
  return parts.join("\n");
}

function use_tree_container_size(): {
  ref: React.RefObject<HTMLDivElement>;
  width: number;
  height: number;
} {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update_size = () => {
      setSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };
    update_size();

    const observer = new ResizeObserver(update_size);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, width: size.width, height: size.height };
}
