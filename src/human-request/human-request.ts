import fs from "node:fs";
import path from "node:path";
import { parse_human_request } from "../storage/index.js";
import { is_non_empty_string, to_relative_posix_path } from "../utils/index.js";

export type HumanRequestStatus = "waiting" | "done" | "cancelled" | "unknown";

export interface HumanRequestSnapshot {
  relative_path: string;
  summary: string | null;
  status: HumanRequestStatus;
}

export function get_human_requests_dir(work_dir: string): string {
  return path.join(work_dir, ".loong", "human-requests");
}

function normalize_status(status: unknown): HumanRequestStatus {
  if (status === "waiting" || status === "done" || status === "cancelled") return status;
  return "unknown";
}

function read_human_request_snapshot(work_dir: string, request_path: string): HumanRequestSnapshot {
  const request = parse_human_request(request_path);
  return {
    relative_path: to_relative_posix_path(work_dir, request_path),
    summary: is_non_empty_string(request.data.summary) ? request.data.summary.trim() : null,
    status: normalize_status(request.data.status),
  };
}

function list_human_request_snapshots(work_dir: string): HumanRequestSnapshot[] {
  const requests_dir = get_human_requests_dir(work_dir);
  if (!fs.existsSync(requests_dir)) return [];
  const snapshots: HumanRequestSnapshot[] = [];
  for (const entry of fs.readdirSync(requests_dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    snapshots.push(read_human_request_snapshot(work_dir, path.join(requests_dir, entry.name)));
  }
  return snapshots.sort((a, b) => a.relative_path.localeCompare(b.relative_path));
}

function is_human_request_done(work_dir: string, relative_path: string): boolean {
  const request_path = path.resolve(work_dir, relative_path);
  if (!fs.existsSync(request_path) || !fs.statSync(request_path).isFile()) return false;
  return read_human_request_snapshot(work_dir, request_path).status === "done";
}

export class HumanRequestManager {
  constructor(readonly work_dir: string) {}

  list_snapshots(): HumanRequestSnapshot[] {
    return list_human_request_snapshots(this.work_dir);
  }

  list_waiting_request_paths(): string[] {
    return this.list_snapshots()
      .filter((snapshot) => snapshot.status === "waiting")
      .map((snapshot) => snapshot.relative_path);
  }

  is_request_done(relative_path: string): boolean {
    return is_human_request_done(this.work_dir, relative_path);
  }
}
