import fs from "node:fs";
import path from "node:path";
import { parse_completion_report } from "../storage/index.js";
import {
  COMPLETION_REPORT_FILE_NAME,
  INPUT_DIR_NAME,
  OUTPUT_DIR_NAME,
  WORK_ORDER_FILE_NAME,
  get_work_orders_dir,
} from "./work-order.js";

function copy_files(source_dir: string, target_dir: string, file_names: string[]) {
  if (file_names.length === 0) return;
  fs.mkdirSync(target_dir, { recursive: true });
  for (const file_name of file_names) {
    const source_path = path.join(source_dir, file_name);
    if (!fs.existsSync(source_path) || !fs.statSync(source_path).isFile()) continue;
    fs.copyFileSync(source_path, path.join(target_dir, file_name));
  }
}

function copy_dir(source_dir: string, target_dir: string) {
  if (!fs.existsSync(source_dir) || !fs.statSync(source_dir).isDirectory()) return;
  fs.cpSync(source_dir, target_dir, { recursive: true, force: true });
}

function resolve_parent_work_dir(work_dir: string): string | null {
  const agents_dir = path.dirname(work_dir);
  if (path.basename(agents_dir) !== "agents") return null;
  return path.dirname(agents_dir);
}

export function sync_outbox_work_order_to_child(
  parent_work_dir: string,
  child_work_dir: string,
  relative_work_order_path: string,
) {
  const source_work_order_path = path.resolve(parent_work_dir, relative_work_order_path);
  if (
    path.basename(source_work_order_path) !== WORK_ORDER_FILE_NAME ||
    !fs.existsSync(source_work_order_path)
  ) {
    return;
  }
  const source_order_dir = path.dirname(source_work_order_path);
  const target_order_dir = path.join(
    get_work_orders_dir(child_work_dir, "inbox"),
    path.basename(source_order_dir),
  );
  copy_files(source_order_dir, target_order_dir, [WORK_ORDER_FILE_NAME]);
  copy_dir(
    path.join(source_order_dir, INPUT_DIR_NAME),
    path.join(target_order_dir, INPUT_DIR_NAME),
  );
}

export function sync_completed_inbox_reports_to_parent(work_dir: string) {
  const parent_work_dir = resolve_parent_work_dir(work_dir);
  if (!parent_work_dir) return;
  const inbox_dir = get_work_orders_dir(work_dir, "inbox");
  if (!fs.existsSync(inbox_dir)) return;
  for (const entry of fs.readdirSync(inbox_dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const source_order_dir = path.join(inbox_dir, entry.name);
    const completion_report_path = path.join(source_order_dir, COMPLETION_REPORT_FILE_NAME);
    if (!fs.existsSync(completion_report_path)) continue;
    const completion_report = parse_completion_report(completion_report_path);
    if (completion_report.data.check_status !== "passed") continue;
    const target_order_dir = path.join(get_work_orders_dir(parent_work_dir, "outbox"), entry.name);
    const target_work_order_path = path.join(target_order_dir, WORK_ORDER_FILE_NAME);
    if (!fs.existsSync(target_work_order_path) || !fs.statSync(target_work_order_path).isFile()) {
      continue;
    }
    copy_files(source_order_dir, target_order_dir, [COMPLETION_REPORT_FILE_NAME]);
    copy_dir(
      path.join(source_order_dir, OUTPUT_DIR_NAME),
      path.join(target_order_dir, OUTPUT_DIR_NAME),
    );
  }
}
