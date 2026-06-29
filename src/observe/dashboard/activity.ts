import { clip_text, count_non_empty_lines, format_display_path } from "../format.js";
import {
  type ActivitySnapshot,
  MAX_FILES,
  MAX_OUTPUTS,
  MAX_TOOLS,
  type TimestampedLine,
  type TurnEventSnapshot,
} from "./model.js";

export function collect_recent_activity(
  work_dir: string,
  events: TurnEventSnapshot[],
  turn_id: string,
): ActivitySnapshot {
  const tools = new Map<string, TimestampedLine>();
  const files = new Map<string, TimestampedLine>();
  const outputs = new Map<string, TimestampedLine>();

  for (const event of events) {
    if (event.context?.turn_id !== turn_id) continue;
    if (event.type !== "codex.event" || !event.event) continue;
    if (
      event.event.type !== "item.started" &&
      event.event.type !== "item.updated" &&
      event.event.type !== "item.completed"
    ) {
      continue;
    }

    const recorded_at = event.recorded_at ?? "";
    const item = event.event.item;
    if (item.type === "command_execution") {
      upsert_timestamped_line(tools, item.id, {
        recorded_at,
        line: format_command_tool_line(item),
      });
      continue;
    }
    if (item.type === "mcp_tool_call") {
      upsert_timestamped_line(tools, item.id, {
        recorded_at,
        line: format_mcp_tool_line(item),
      });
      continue;
    }
    if (item.type === "web_search") {
      upsert_timestamped_line(tools, item.id, {
        recorded_at,
        line: `完成 网络搜索 · ${clip_text(item.query, 80)}`,
      });
      continue;
    }
    if (item.type === "file_change") {
      item.changes.forEach((change, index) => {
        upsert_timestamped_line(files, `${item.id}:${index}`, {
          recorded_at,
          line: format_file_change_line(item.status, change.path, change.kind, work_dir),
        });
      });
      continue;
    }
    if (item.type !== "reasoning" && item.type !== "agent_message") continue;
    const text =
      item.type === "agent_message"
        ? (extract_structured_state_summary(item.text) ?? item.text)
        : item.text;
    const normalized = clip_text(text, 160);
    if (!normalized) continue;
    upsert_timestamped_line(outputs, item.id, { recorded_at, line: normalized });
  }

  const output_lines = [...outputs.values()].slice(-MAX_OUTPUTS);
  return {
    tool_lines: [...tools.values()].slice(-MAX_TOOLS),
    tool_total: tools.size,
    file_lines: [...files.values()].slice(-MAX_FILES),
    file_total: files.size,
    output_lines,
    output_total: outputs.size,
    latest_output_summary:
      output_lines.length > 0 ? (output_lines[output_lines.length - 1]?.line ?? null) : null,
  };
}

function format_command_tool_line(item: {
  command: string;
  status: string;
  aggregated_output: string;
  exit_code?: number | null;
}): string {
  const detail = summarize_command_detail(item.aggregated_output, item.exit_code);
  return `${format_item_status(item.status)} ${summarize_command_label(item.command)}${detail}`;
}

function format_mcp_tool_line(item: {
  server: string;
  tool: string;
  status: string;
  error?: { message?: string } | null;
}): string {
  const detail = item.error?.message ? ` · ${clip_text(item.error.message, 120)}` : "";
  return `${format_item_status(item.status)} ${item.server}.${item.tool}${detail}`;
}

function format_file_change_line(
  status: string,
  file_path: string,
  kind: "add" | "delete" | "update",
  work_dir: string,
): string {
  return `${format_item_status(status)} ${format_file_change_kind(kind)} ${format_display_path(
    file_path,
    work_dir,
  )}`;
}

function format_file_change_kind(kind: "add" | "delete" | "update"): string {
  if (kind === "add") return "新增";
  if (kind === "delete") return "删除";
  return "更新";
}

function summarize_command_detail(output: string, exit_code?: number | null): string {
  const parts = [];
  if (typeof exit_code === "number") parts.push(`退出码 ${exit_code}`);
  const output_lines = count_non_empty_lines(output);
  if (output_lines > 0) parts.push(`${output_lines} 行`);
  return parts.length > 0 ? ` · ${parts.join(" · ")}` : "";
}

function summarize_command_label(command: string): string {
  const normalized = command.toLowerCase();
  if (/\b(pnpm|npm|yarn|vitest)\b/.test(normalized) && /\b(test|vitest)\b/.test(normalized)) {
    return "运行测试";
  }
  if (/\btsc\b/.test(normalized) || normalized.includes("typecheck")) return "类型检查";
  if (/\bbiome\b/.test(normalized) || normalized.includes("eslint")) return "检查代码";
  if (/\brg\b/.test(normalized) || normalized.includes("select-string")) return "搜索文件";
  if (normalized.includes("get-content") || /\b(cat|type)\b/.test(normalized)) return "读取文件";
  if (
    normalized.includes("get-childitem") ||
    /\b(ls|dir)\b/.test(normalized) ||
    normalized.includes("test-path")
  ) {
    return "检查文件";
  }
  if (/\bgit\b/.test(normalized)) return "查看 git 状态";
  if (normalized.includes("apply_patch")) return "应用补丁";
  return "执行本地命令";
}

function extract_structured_state_summary(text: string): string | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const is_state =
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.summary === "string" &&
      typeof parsed.next_action === "string" &&
      typeof parsed.plan === "string" &&
      typeof parsed.log === "string";
    if (!is_state) return null;
    const summary = parsed.summary;
    return typeof summary === "string" ? summary.trim() || null : null;
  } catch {
    return null;
  }
}

function format_item_status(status: string): string {
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  if (status === "in_progress") return "运行中";
  return status;
}

function upsert_timestamped_line(
  map: Map<string, TimestampedLine>,
  key: string,
  line: TimestampedLine,
): void {
  if (map.has(key)) map.delete(key);
  map.set(key, line);
}
