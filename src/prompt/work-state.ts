import path from "node:path";
import { HumanRequestManager } from "../human-request/index.js";
import { load_last_loop_state } from "../runtime/state.js";
import { read_text } from "../storage/index.js";
import { to_relative_posix_path } from "../utils/index.js";
import { WorkOrderManager } from "../work-order/index.js";

function resolve_work_path(work_dir: string, relative_path: string): string {
  return path.join(work_dir, relative_path.replace(/^[/\\]+/, ""));
}

function format_fenced_block(text: string, language: "markdown" | "json"): string {
  const normalized_text = text.endsWith("\n") ? text : `${text}\n`;
  return `\`\`\`${language}\n${normalized_text}\`\`\``;
}

function load_memory(work_dir: string, outline = "###"): string {
  const files = ["/.loong/memory/world-model.md", "/.loong/memory/learned.md"];
  const child_outline = `${outline}#`;
  let contents = files
    .map((file) => {
      const text = read_text(resolve_work_path(work_dir, file));
      if (!text) return null;
      return `${child_outline} ${file}\n${format_fenced_block(text, "markdown")}\n`;
    })
    .filter((text): text is string => !!text)
    .join("\n");
  if (!contents) contents = "空";
  return `${outline} 记忆\n${contents}\n\n`;
}

function load_active_work_orders(
  work_orders: WorkOrderManager,
  type: "inbox",
  title: string,
  outline = "##",
): string {
  const order_paths = work_orders.list_active_work_order_paths(type);
  const child_outline = `${outline}#`;
  const contents = order_paths
    .map((order_path) => {
      const text = read_text(resolve_work_path(work_orders.work_dir, order_path));
      if (!text) return null;
      const rel_path = to_relative_posix_path(
        work_orders.work_dir,
        resolve_work_path(work_orders.work_dir, order_path),
      );
      return `${child_outline} ${rel_path}\n${format_fenced_block(text, "markdown")}\n`;
    })
    .filter((text): text is string => !!text)
    .join("\n");
  if (!contents) return "";
  return `${outline} ${title}\n${contents}\n\n`;
}

function load_outbox_work_order_index(work_orders: WorkOrderManager, outline = "##"): string {
  const snapshots = work_orders.list_work_order_snapshots("outbox");
  if (snapshots.length === 0) return "";
  const child_outline = `${outline}#`;
  const contents = snapshots
    .map((snapshot) => {
      const lines = [
        `- summary: ${snapshot.summary ?? "无"}`,
        `- delegator: ${snapshot.delegator ?? "无"}`,
        `- executor: ${snapshot.executor ?? "无"}`,
        `- status: ${snapshot.status}`,
      ];
      if (snapshot.relative_completion_report_path) {
        lines.push(`- completion_report: ${snapshot.relative_completion_report_path}`);
      }
      return `${child_outline} ${snapshot.relative_work_order_path}\n${lines.join("\n")}\n`;
    })
    .join("\n");
  return `${outline} 工作委派索引\n${contents}\n\n`;
}

function load_human_request_index(work_dir: string, outline = "##"): string {
  const snapshots = new HumanRequestManager(work_dir).list_snapshots();
  if (snapshots.length === 0) return "";
  const contents = snapshots
    .map(
      (snapshot) =>
        `- path: ${snapshot.relative_path}; summary: ${snapshot.summary ?? "无"}; status: ${
          snapshot.status
        }`,
    )
    .join("\n");
  return `${outline} 人工介入请求\n${contents}\n\n`;
}

function load_last_work_log(work_dir: string, log_path: string, outline = "##"): string {
  let text = read_text(resolve_work_path(work_dir, log_path));
  text = text ? `${log_path}\n${format_fenced_block(text, "markdown")}\n` : "无";
  return `${outline} 上一轮工作日志\n${text}\n\n`;
}

function load_last_plan(work_dir: string, plan_path: string, outline = "##"): string {
  if (!plan_path) return `${outline} 上一轮计划完成情况\n无\n\n`;
  let text = read_text(resolve_work_path(work_dir, plan_path));
  text = text ? `${plan_path}\n${format_fenced_block(text, "json")}\n` : "无";
  return `${outline} 上一轮计划完成情况\n${text}\n\n`;
}

export function get_work_state_prompt(work_dir: string, outline = "##"): string {
  const work_orders = new WorkOrderManager(work_dir);
  let prompt = load_memory(work_dir, outline);
  prompt += load_active_work_orders(work_orders, "inbox", "工作主线", outline);
  const state = load_last_loop_state(work_dir);
  if (state) {
    prompt += load_last_work_log(work_dir, state.log, outline);
    prompt += load_last_plan(work_dir, state.plan, outline);
  }
  prompt += load_outbox_work_order_index(work_orders, outline);
  prompt += load_human_request_index(work_dir, outline);
  return prompt;
}
