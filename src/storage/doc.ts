import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

export interface MarkdownDocument<T extends object> {
  data: T;
  content: string;
}

export interface WorkOrder {
  turn_id?: unknown;
  summary?: unknown;
  delegator?: unknown;
  executor?: unknown;
  created_at?: unknown;
}

export interface CompletionReport {
  turn_id?: unknown;
  delegator?: unknown;
  executor?: unknown;
  created_at?: unknown;
  check_status?: unknown;
}

export interface WorkCheckReport {
  open_issue_count?: unknown;
}

export interface WorkLog {
  turn_id?: unknown;
  created_at?: unknown;
}

export interface HumanRequest {
  turn_id?: unknown;
  created_at?: unknown;
  status?: unknown;
  summary?: unknown;
}

export function parse_work_order(file_path: string): MarkdownDocument<WorkOrder> {
  return parse_markdown_document<WorkOrder>(file_path);
}

export function parse_completion_report(file_path: string): MarkdownDocument<CompletionReport> {
  return parse_markdown_document<CompletionReport>(file_path);
}

export function parse_work_check_report(file_path: string): MarkdownDocument<WorkCheckReport> {
  return parse_markdown_document<WorkCheckReport>(file_path);
}

export function parse_work_log(file_path: string): MarkdownDocument<WorkLog> {
  return parse_markdown_document<WorkLog>(file_path);
}

export function parse_human_request(file_path: string): MarkdownDocument<HumanRequest> {
  return parse_markdown_document<HumanRequest>(file_path);
}

export function has_markdown_heading(content: string, heading: string): boolean {
  const escaped_heading = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped_heading}\\s*$`, "m").test(content);
}

function parse_markdown_document<T extends object>(file_path: string): MarkdownDocument<T> {
  const text = fs.readFileSync(file_path, { encoding: "utf-8" });
  const parsed = matter(text);
  return {
    data: parsed.data as T,
    content: parsed.content,
  };
}

export function append_jsonl<T>(file_path: string, data: T) {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  const jsonl = JSON.stringify(data);
  fs.appendFileSync(file_path, `${jsonl}\n`, "utf-8");
}

export function read_jsonl<T>(file_path: string): T[] {
  if (!fs.existsSync(file_path)) {
    return [];
  }
  const content = fs.readFileSync(file_path, { encoding: "utf-8" });
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  return lines.map((line) => JSON.parse(line) as T);
}

export function read_jsonl_last<T>(file_path: string): T | null {
  if (!fs.existsSync(file_path)) {
    return null;
  }
  const content = fs.readFileSync(file_path, { encoding: "utf-8" });
  const lines = content.split("\n").filter((line) => line.trim() !== "");
  return lines.length > 0 ? (JSON.parse(lines[lines.length - 1]) as T) : null;
}

export function read_text(file_path: string): string | null {
  if (!fs.existsSync(file_path)) return null;
  return fs.readFileSync(file_path, { encoding: "utf-8" });
}

export function update_markdown_frontmatter(
  file_path: string,
  patch: Record<string, unknown>,
): void {
  const parsed = matter(fs.readFileSync(file_path, "utf-8"));
  const data = { ...parsed.data, ...patch };
  fs.writeFileSync(file_path, matter.stringify(parsed.content, data), "utf-8");
}
