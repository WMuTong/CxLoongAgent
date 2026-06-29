import fs from "node:fs";
import path from "node:path";
import {
  parse_completion_report,
  parse_work_check_report,
  parse_work_order,
  update_markdown_frontmatter,
} from "../storage/index.js";
import { is_non_empty_string, to_relative_posix_path } from "../utils/index.js";
import { sync_completed_inbox_reports_to_parent, sync_outbox_work_order_to_child } from "./sync.js";

export const WORK_ORDER_FILE_NAME = "work-order.md";
export const COMPLETION_REPORT_FILE_NAME = "completion-report.md";
export const WORK_CHECK_FILE_NAME = "work-check.md";
export const INPUT_DIR_NAME = "input";
export const OUTPUT_DIR_NAME = "output";

export type WorkOrderBox = "inbox" | "outbox";
export type CompletionCheckStatus = "pending" | "passed" | "failed";

export interface WorkOrderSnapshot {
  relative_work_order_path: string;
  relative_completion_report_path: string | null;
  turn_id: string | null;
  created_at: string | null;
  summary: string | null;
  delegator: string | null;
  executor: string | null;
  status: "active" | "completed";
  check_status: CompletionCheckStatus | null;
  open_issue_count: number | null;
  content: string;
  completion_report: WorkOrderCompletionReportSnapshot | null;
  work_check: WorkOrderWorkCheckSnapshot | null;
  input_files: WorkOrderFileSnapshot[];
  output_files: WorkOrderFileSnapshot[];
}

export interface WorkOrderCompletionReportSnapshot {
  relative_path: string;
  turn_id: string | null;
  created_at: string | null;
  delegator: string | null;
  executor: string | null;
  check_status: CompletionCheckStatus | null;
  content: string;
}

export interface WorkOrderWorkCheckSnapshot {
  relative_path: string;
  open_issue_count: number | null;
  content: string;
}

export interface WorkOrderFileSnapshot {
  relative_path: string;
  size: number;
  updated_at: string;
}

export function get_work_orders_dir(work_dir: string, type: WorkOrderBox): string {
  return path.join(work_dir, ".loong", "work-orders", type);
}

function list_active_work_order_paths(work_dir: string, type: WorkOrderBox): string[] {
  const order_dir = get_work_orders_dir(work_dir, type);
  if (!fs.existsSync(order_dir)) return [];
  const order_paths: string[] = [];
  for (const entry of fs.readdirSync(order_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const order_path = path.join(order_dir, entry.name);
    const work_order_path = path.join(order_path, WORK_ORDER_FILE_NAME);
    const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
    if (!fs.existsSync(work_order_path)) continue;
    if (!fs.existsSync(completion_report_path)) {
      order_paths.push(to_relative_posix_path(work_dir, work_order_path));
      continue;
    }
    if (read_completion_check_status(completion_report_path) !== "passed") {
      order_paths.push(to_relative_posix_path(work_dir, work_order_path));
    }
  }
  return order_paths;
}

function read_frontmatter_string(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return is_non_empty_string(value) ? value.trim() : null;
}

function read_frontmatter_number(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function normalize_check_status(value: unknown): CompletionCheckStatus | null {
  if (value === "pending" || value === "passed" || value === "failed") return value;
  return null;
}

function read_completion_check_status(
  completion_report_path: string,
): CompletionCheckStatus | null {
  if (!fs.existsSync(completion_report_path) || !fs.statSync(completion_report_path).isFile()) {
    return null;
  }
  const completion_report = parse_completion_report(completion_report_path);
  return normalize_check_status(completion_report.data.check_status);
}

function read_work_check_open_issue_count(order_path: string): number | null {
  const work_check_path = path.join(order_path, WORK_CHECK_FILE_NAME);
  if (!fs.existsSync(work_check_path) || !fs.statSync(work_check_path).isFile()) return null;
  const work_check = parse_work_check_report(work_check_path);
  return read_frontmatter_number(work_check.data.open_issue_count);
}

function has_invalid_work_check_report(order_path: string): boolean {
  const work_check_path = path.join(order_path, WORK_CHECK_FILE_NAME);
  if (!fs.existsSync(work_check_path) || !fs.statSync(work_check_path).isFile()) {
    return false;
  }
  return read_work_check_open_issue_count(order_path) === null;
}

function list_work_order_files(work_dir: string, dir_path: string): WorkOrderFileSnapshot[] {
  if (!fs.existsSync(dir_path) || !fs.statSync(dir_path).isDirectory()) return [];
  const files: WorkOrderFileSnapshot[] = [];
  collect_work_order_files(work_dir, dir_path, files);
  return files.sort((left, right) => left.relative_path.localeCompare(right.relative_path));
}

function collect_work_order_files(
  work_dir: string,
  dir_path: string,
  files: WorkOrderFileSnapshot[],
): void {
  for (const entry of fs.readdirSync(dir_path, { withFileTypes: true })) {
    const entry_path = path.join(dir_path, entry.name);
    if (entry.isDirectory()) {
      collect_work_order_files(work_dir, entry_path, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(entry_path);
    files.push({
      relative_path: to_relative_posix_path(work_dir, entry_path),
      size: stat.size,
      updated_at: stat.mtime.toISOString(),
    });
  }
}

function read_work_order_executor(work_order_path: string): string | null {
  if (!fs.existsSync(work_order_path)) return null;
  const work_order = parse_work_order(work_order_path);
  return read_frontmatter_string(work_order.data.executor);
}

function read_work_order_delegator(work_order_path: string): string | null {
  if (!fs.existsSync(work_order_path)) return null;
  const work_order = parse_work_order(work_order_path);
  return read_frontmatter_string(work_order.data.delegator);
}

function is_work_order_completed(work_order_path: string): boolean {
  const order_path = path.dirname(work_order_path);
  const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
  return read_completion_check_status(completion_report_path) === "passed";
}

function has_completion_report(order_path: string): boolean {
  const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
  return fs.existsSync(completion_report_path) && fs.statSync(completion_report_path).isFile();
}

function list_work_order_snapshots(work_dir: string, type: WorkOrderBox): WorkOrderSnapshot[] {
  const order_dir = get_work_orders_dir(work_dir, type);
  if (!fs.existsSync(order_dir)) return [];
  const snapshots: WorkOrderSnapshot[] = [];
  for (const entry of fs.readdirSync(order_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const order_path = path.join(order_dir, entry.name);
    const work_order_path = path.join(order_path, WORK_ORDER_FILE_NAME);
    if (!fs.existsSync(work_order_path) || !fs.statSync(work_order_path).isFile()) continue;
    const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
    const has_completion_report =
      fs.existsSync(completion_report_path) && fs.statSync(completion_report_path).isFile();
    const work_check_path = path.join(order_path, WORK_CHECK_FILE_NAME);
    const has_work_check = fs.existsSync(work_check_path) && fs.statSync(work_check_path).isFile();
    const work_order = parse_work_order(work_order_path);
    const completion_report = has_completion_report
      ? parse_completion_report(completion_report_path)
      : null;
    const work_check = has_work_check ? parse_work_check_report(work_check_path) : null;
    const check_status = completion_report
      ? normalize_check_status(completion_report.data.check_status)
      : null;
    const open_issue_count = work_check
      ? read_frontmatter_number(work_check.data.open_issue_count)
      : null;
    snapshots.push({
      relative_work_order_path: to_relative_posix_path(work_dir, work_order_path),
      relative_completion_report_path: has_completion_report
        ? to_relative_posix_path(work_dir, completion_report_path)
        : null,
      turn_id: read_frontmatter_string(work_order.data.turn_id),
      created_at: read_frontmatter_string(work_order.data.created_at),
      summary: read_frontmatter_string(work_order.data.summary),
      delegator: read_frontmatter_string(work_order.data.delegator),
      executor: read_frontmatter_string(work_order.data.executor),
      status: check_status === "passed" ? "completed" : "active",
      check_status,
      open_issue_count,
      content: work_order.content.trim(),
      completion_report: completion_report
        ? {
            relative_path: to_relative_posix_path(work_dir, completion_report_path),
            turn_id: read_frontmatter_string(completion_report.data.turn_id),
            created_at: read_frontmatter_string(completion_report.data.created_at),
            delegator: read_frontmatter_string(completion_report.data.delegator),
            executor: read_frontmatter_string(completion_report.data.executor),
            check_status,
            content: completion_report.content.trim(),
          }
        : null,
      work_check: work_check
        ? {
            relative_path: to_relative_posix_path(work_dir, work_check_path),
            open_issue_count,
            content: work_check.content.trim(),
          }
        : null,
      input_files: list_work_order_files(work_dir, path.join(order_path, INPUT_DIR_NAME)),
      output_files: list_work_order_files(work_dir, path.join(order_path, OUTPUT_DIR_NAME)),
    });
  }
  return snapshots;
}

function list_inbox_order_targets_by_check_status(
  work_dir: string,
  check_status: CompletionCheckStatus,
): string[] {
  const inbox_dir = get_work_orders_dir(work_dir, "inbox");
  if (!fs.existsSync(inbox_dir)) return [];
  const order_targets: string[] = [];
  for (const entry of fs.readdirSync(inbox_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const order_path = path.join(inbox_dir, entry.name);
    const work_order_path = path.join(order_path, WORK_ORDER_FILE_NAME);
    const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
    if (!fs.existsSync(work_order_path) || !fs.existsSync(completion_report_path)) continue;
    if (read_completion_check_status(completion_report_path) !== check_status) continue;
    order_targets.push(to_relative_posix_path(work_dir, order_path));
  }
  return order_targets.sort();
}

function list_inbox_order_targets_with_missing_check_status(work_dir: string): string[] {
  const inbox_dir = get_work_orders_dir(work_dir, "inbox");
  if (!fs.existsSync(inbox_dir)) return [];
  const order_targets: string[] = [];
  for (const entry of fs.readdirSync(inbox_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const order_path = path.join(inbox_dir, entry.name);
    const work_order_path = path.join(order_path, WORK_ORDER_FILE_NAME);
    const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
    if (!fs.existsSync(work_order_path) || !fs.existsSync(completion_report_path)) continue;
    if (read_completion_check_status(completion_report_path) !== null) continue;
    order_targets.push(to_relative_posix_path(work_dir, order_path));
  }
  return order_targets.sort();
}

function list_inbox_order_targets_with_invalid_work_check(work_dir: string): string[] {
  const inbox_dir = get_work_orders_dir(work_dir, "inbox");
  if (!fs.existsSync(inbox_dir)) return [];
  const order_targets: string[] = [];
  for (const entry of fs.readdirSync(inbox_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const order_path = path.join(inbox_dir, entry.name);
    const work_order_path = path.join(order_path, WORK_ORDER_FILE_NAME);
    const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
    if (!fs.existsSync(work_order_path) || !fs.existsSync(completion_report_path)) continue;
    if (!has_invalid_work_check_report(order_path)) continue;
    order_targets.push(to_relative_posix_path(work_dir, order_path));
  }
  return order_targets.sort();
}

function set_completion_report_check_status(
  work_dir: string,
  target_work_order_path: string,
  check_status: CompletionCheckStatus,
): void {
  const order_path = path.resolve(work_dir, target_work_order_path);
  const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
  if (!fs.existsSync(completion_report_path) || !fs.statSync(completion_report_path).isFile()) {
    return;
  }
  update_markdown_frontmatter(completion_report_path, { check_status });
}

function list_inbox_order_targets_without_completion_report(work_dir: string): string[] {
  const inbox_dir = get_work_orders_dir(work_dir, "inbox");
  if (!fs.existsSync(inbox_dir)) return [];
  const order_targets: string[] = [];
  for (const entry of fs.readdirSync(inbox_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const order_path = path.join(inbox_dir, entry.name);
    const work_order_path = path.join(order_path, WORK_ORDER_FILE_NAME);
    const completion_report_path = path.join(order_path, COMPLETION_REPORT_FILE_NAME);
    if (!fs.existsSync(work_order_path) || fs.existsSync(completion_report_path)) continue;
    order_targets.push(to_relative_posix_path(work_dir, order_path));
  }
  return order_targets.sort();
}

export class WorkOrderManager {
  constructor(readonly work_dir: string) {}

  #resolve_relative_path(relative_path: string): string {
    return path.resolve(this.work_dir, relative_path);
  }

  list_active_work_order_paths(type: WorkOrderBox): string[] {
    return list_active_work_order_paths(this.work_dir, type);
  }

  read_work_order_executor(relative_work_order_path: string): string | null {
    return read_work_order_executor(this.#resolve_relative_path(relative_work_order_path));
  }

  read_work_order_delegator(relative_work_order_path: string): string | null {
    return read_work_order_delegator(this.#resolve_relative_path(relative_work_order_path));
  }

  is_work_order_completed(relative_work_order_path: string): boolean {
    return is_work_order_completed(this.#resolve_relative_path(relative_work_order_path));
  }

  has_completion_report(target_work_order_path: string): boolean {
    return has_completion_report(this.#resolve_relative_path(target_work_order_path));
  }

  list_inbox_order_targets_by_check_status(check_status: CompletionCheckStatus): string[] {
    return list_inbox_order_targets_by_check_status(this.work_dir, check_status);
  }

  list_inbox_order_targets_with_missing_check_status(): string[] {
    return list_inbox_order_targets_with_missing_check_status(this.work_dir);
  }

  list_inbox_order_targets_with_invalid_work_check(): string[] {
    return list_inbox_order_targets_with_invalid_work_check(this.work_dir);
  }

  list_inbox_order_targets_without_completion_report(): string[] {
    return list_inbox_order_targets_without_completion_report(this.work_dir);
  }

  set_completion_report_check_status(
    target_work_order_path: string,
    check_status: CompletionCheckStatus,
  ): void {
    set_completion_report_check_status(this.work_dir, target_work_order_path, check_status);
  }

  read_work_check_open_issue_count(target_work_order_path: string): number | null {
    return read_work_check_open_issue_count(this.#resolve_relative_path(target_work_order_path));
  }

  list_work_order_snapshots(type: WorkOrderBox): WorkOrderSnapshot[] {
    return list_work_order_snapshots(this.work_dir, type);
  }

  sync_outbox_work_order_to_child(child_work_dir: string, relative_work_order_path: string) {
    sync_outbox_work_order_to_child(this.work_dir, child_work_dir, relative_work_order_path);
  }

  sync_completed_inbox_reports_to_parent() {
    sync_completed_inbox_reports_to_parent(this.work_dir);
  }
}
