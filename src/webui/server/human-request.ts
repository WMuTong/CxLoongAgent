import fs from "node:fs";
import path from "node:path";
import { load_agent_config } from "../../agent/index.js";
import { parse_human_request } from "../../storage/index.js";
import { resolve_inside_work_dir } from "../../utils/index.js";
import type { HumanRequestDetail } from "./types.js";

export type CompleteHumanRequestInput = {
  agent_path: string;
  request_path: string;
  result: string;
};

export type UpdateHumanRequestStatusInput = CompleteHumanRequestInput & {
  status: "done" | "cancelled";
};

export function read_human_request_detail(
  root_dir: string,
  agent_path: string,
  request_path: string,
): HumanRequestDetail {
  const agent_dir = resolve_agent_dir(root_dir, agent_path);
  const resolved = resolve_human_request_path(agent_dir, request_path);
  const parsed = parse_human_request(resolved.absolute_path);
  return {
    agent_path: normalize_agent_path(root_dir, agent_dir),
    relative_path: resolved.normalized_path,
    summary: typeof parsed.data.summary === "string" ? parsed.data.summary.trim() || null : null,
    status:
      parsed.data.status === "waiting" ||
      parsed.data.status === "done" ||
      parsed.data.status === "cancelled"
        ? parsed.data.status
        : "unknown",
    turn_id: typeof parsed.data.turn_id === "string" ? parsed.data.turn_id : null,
    created_at: typeof parsed.data.created_at === "string" ? parsed.data.created_at : null,
    content: parsed.content.trim(),
  };
}

export function complete_human_request(root_dir: string, input: CompleteHumanRequestInput): void {
  update_human_request_status(root_dir, { ...input, status: "done" });
}

export function cancel_human_request(root_dir: string, input: CompleteHumanRequestInput): void {
  update_human_request_status(root_dir, { ...input, status: "cancelled" });
}

function update_human_request_status(root_dir: string, input: UpdateHumanRequestStatusInput): void {
  const result = input.result.trim();
  if (!result) throw new Error("人类处理结果不能为空。");
  const agent_dir = resolve_agent_dir(root_dir, input.agent_path);
  const resolved = resolve_human_request_path(agent_dir, input.request_path);
  const parsed = parse_human_request(resolved.absolute_path);
  if (parsed.data.status !== "waiting") {
    throw new Error("只能处理 status 为 waiting 的人工介入请求。");
  }
  const text = fs.readFileSync(resolved.absolute_path, "utf-8");
  const with_status = replace_waiting_status(text, input.status);
  const with_result = replace_human_result_section(with_status, result);
  fs.writeFileSync(resolved.absolute_path, with_result, "utf-8");
}

function resolve_agent_dir(root_dir: string, agent_path: string): string {
  const trimmed = agent_path.trim();
  const normalized = trimmed === "" || trimmed === "." ? "." : trimmed;
  const resolved = normalized === "." ? path.resolve(root_dir) : path.resolve(root_dir, normalized);
  const root = path.resolve(root_dir);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("agent_path 必须位于 WebUI 根目录内。");
  }
  if (!load_agent_config(resolved)) {
    throw new Error("agent_path 不是有效的 loong agent 工作区。");
  }
  return resolved;
}

function resolve_human_request_path(agent_dir: string, request_path: string) {
  const resolved = resolve_inside_work_dir(agent_dir, request_path);
  if (!resolved) throw new Error("request_path 必须是 agent 工作区内的相对路径。");
  const expected_dir = path.posix.join(".loong", "human-requests");
  if (path.posix.dirname(resolved.normalized_path) !== expected_dir) {
    throw new Error("request_path 必须位于 .loong/human-requests 下。");
  }
  if (!fs.existsSync(resolved.absolute_path) || !fs.statSync(resolved.absolute_path).isFile()) {
    throw new Error("人工介入请求文件不存在。");
  }
  return resolved;
}

function normalize_agent_path(root_dir: string, agent_dir: string): string {
  const relative = path.relative(path.resolve(root_dir), path.resolve(agent_dir));
  return relative ? relative.split(path.sep).join("/") : ".";
}

function replace_waiting_status(text: string, status: "done" | "cancelled"): string {
  if (!text.startsWith("---\n")) throw new Error("人工介入请求缺少 frontmatter。");
  const end = text.indexOf("\n---", 4);
  if (end < 0) throw new Error("人工介入请求 frontmatter 不完整。");
  const frontmatter = text.slice(0, end + 4);
  const replaced = frontmatter.replace(/^status:\s*["']?waiting["']?\s*$/m, `status: "${status}"`);
  if (replaced === frontmatter) {
    throw new Error("人工介入请求 frontmatter 中未找到 status: waiting。");
  }
  return `${replaced}${text.slice(end + 4)}`;
}

function replace_human_result_section(text: string, result: string): string {
  const heading = /^## 人类处理结果\s*$/m;
  const match = heading.exec(text);
  if (!match || match.index === undefined) {
    throw new Error('人工介入请求缺少 "## 人类处理结果" 段落。');
  }
  const start = match.index;
  const content_start = start + match[0].length;
  const rest = text.slice(content_start);
  const next_heading_match = /^## .+$/m.exec(rest);
  const end =
    next_heading_match?.index === undefined
      ? text.length
      : content_start + next_heading_match.index;
  const normalized_result = result.endsWith("\n") ? result : `${result}\n`;
  return `${text.slice(0, start)}## 人类处理结果\n${normalized_result}${text.slice(end)}`;
}
