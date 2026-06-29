import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { get_runtime_dir_path } from "./log.js";

export type DaemonStatus = "running" | "stopped" | "failed";

export type DaemonRecord = {
  pid: number;
  root_dir: string;
  status: DaemonStatus;
  started_at: string;
  updated_at: string;
  command: string;
  args: string[];
  active_since: string | null;
  stopped_at: string | null;
  accumulated_run_ms: number;
};

export type DaemonSnapshot = DaemonRecord & {
  elapsed_run_ms: number;
};

export type StartDaemonResult = {
  started: boolean;
  record: DaemonRecord;
};

export type StartDaemonOptions = {
  once?: boolean;
};

export function get_daemon_record_path(work_dir: string): string {
  return path.join(get_runtime_dir_path(work_dir), "daemon.json");
}

export function get_daemon_log_path(work_dir: string): string {
  return path.join(get_runtime_dir_path(work_dir), "daemon.log");
}

export class DaemonManager {
  constructor(readonly work_dir: string) {}

  read_record(): DaemonRecord | null {
    const record_path = get_daemon_record_path(this.work_dir);
    if (!fs.existsSync(record_path)) return null;
    try {
      return normalize_daemon_record(JSON.parse(fs.readFileSync(record_path, "utf-8")));
    } catch {
      return null;
    }
  }

  read_snapshot(now = new Date()): DaemonSnapshot | null {
    const record = this.read_record();
    if (!record) return null;
    return {
      ...record,
      elapsed_run_ms: calculate_elapsed_run_ms(record, now),
    };
  }

  is_running(): boolean {
    return is_daemon_effectively_running(this.read_record());
  }

  start(options: StartDaemonOptions = {}): StartDaemonResult {
    const existing = this.read_record();
    if (existing && existing.status === "running" && is_process_running(existing.pid)) {
      return { started: false, record: existing };
    }
    fs.mkdirSync(get_runtime_dir_path(this.work_dir), { recursive: true });
    const invocation = build_daemon_invocation(this.work_dir, options);
    const log_path = get_daemon_log_path(this.work_dir);
    const process_info = start_daemon_process(invocation, this.work_dir, log_path);
    const now = new Date();
    const timestamp = now.toISOString();
    const record: DaemonRecord = {
      pid: process_info.pid,
      root_dir: this.work_dir,
      status: "running",
      started_at: timestamp,
      updated_at: timestamp,
      command: invocation.command,
      args: invocation.args,
      active_since: timestamp,
      stopped_at: null,
      accumulated_run_ms: existing?.accumulated_run_ms ?? 0,
    };
    this.write_record(record);
    return { started: true, record };
  }

  mark_current_process_running(): DaemonRecord {
    const previous = this.read_record();
    const now = new Date();
    const timestamp = now.toISOString();
    const started_at =
      previous?.status === "running" && is_valid_timestamp(previous.started_at)
        ? previous.started_at
        : timestamp;
    const active_since =
      previous?.status === "running" && is_valid_timestamp(previous.active_since)
        ? previous.active_since
        : started_at;
    const record: DaemonRecord = {
      pid: process.pid,
      root_dir: this.work_dir,
      status: "running",
      started_at,
      updated_at: timestamp,
      command: process.execPath,
      args: process.argv.slice(1),
      active_since,
      stopped_at: null,
      accumulated_run_ms: previous?.accumulated_run_ms ?? 0,
    };
    this.write_record(record);
    return record;
  }

  mark_stopped(status: DaemonStatus = "stopped"): void {
    const previous = this.read_record();
    if (!previous) return;
    const now = new Date();
    const timestamp = now.toISOString();
    this.write_record({
      ...previous,
      status,
      updated_at: timestamp,
      active_since: null,
      stopped_at: timestamp,
      accumulated_run_ms: calculate_elapsed_run_ms(previous, now),
    });
  }

  stop(): boolean {
    const record = this.read_record();
    if (!record || !is_process_running(record.pid)) {
      if (record) {
        this.mark_stopped();
      }
      return false;
    }
    try {
      process.kill(record.pid);
    } catch {
      this.mark_stopped();
      return false;
    }
    this.mark_stopped();
    return true;
  }

  write_record(record: DaemonRecord): void {
    fs.mkdirSync(get_runtime_dir_path(this.work_dir), { recursive: true });
    fs.writeFileSync(get_daemon_record_path(this.work_dir), `${JSON.stringify(record, null, 2)}\n`);
  }
}

function start_daemon_process(
  invocation: { command: string; args: string[] },
  work_dir: string,
  log_path: string,
): { pid: number } {
  if (process.platform === "win32") {
    return start_windows_hidden_process(invocation, work_dir);
  }

  const out = fs.openSync(log_path, "a");
  const err = fs.openSync(log_path, "a");
  const child = spawn(invocation.command, invocation.args, {
    cwd: work_dir,
    detached: true,
    env: {
      ...process.env,
      LOONG_DAEMON: "1",
    },
    stdio: ["ignore", out, err],
    windowsHide: true,
  });
  child.unref();
  fs.closeSync(out);
  fs.closeSync(err);
  return { pid: child.pid ?? 0 };
}

function start_windows_hidden_process(
  invocation: { command: string; args: string[] },
  work_dir: string,
): { pid: number } {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$env:LOONG_DAEMON = '1'",
    `$process = Start-Process -FilePath ${quote_powershell_string(invocation.command)} -ArgumentList ${quote_powershell_string(format_windows_arguments(invocation.args))} -WorkingDirectory ${quote_powershell_string(work_dir)} -WindowStyle Hidden -PassThru`,
    "[Console]::Out.Write($process.Id)",
  ].join("\n");
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      encoding: "utf-8",
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "无法启动隐藏后台进程。");
  }
  const pid = Number.parseInt(result.stdout.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`无法读取隐藏后台进程 pid：${result.stdout.trim()}`);
  }
  return { pid };
}

function quote_powershell_string(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function format_windows_arguments(values: string[]): string {
  return values.map(quote_windows_argument).join(" ");
}

function quote_windows_argument(value: string): string {
  if (value.length === 0) return '""';
  if (!/[\s"]/.test(value)) return value;
  let quoted = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === "\\") {
      backslashes += 1;
    } else if (character === '"') {
      quoted += `${"\\".repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
    } else {
      quoted += `${"\\".repeat(backslashes)}${character}`;
      backslashes = 0;
    }
  }
  return `${quoted}${"\\".repeat(backslashes * 2)}"`;
}

export function create_daemon_manager(work_dir: string): DaemonManager {
  return new DaemonManager(path.resolve(work_dir));
}

export function is_process_running(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function is_daemon_effectively_running(record: DaemonRecord | null): boolean {
  return !!record && record.status === "running" && is_process_running(record.pid);
}

function is_valid_timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function calculate_elapsed_run_ms(record: DaemonRecord, now: Date): number {
  if (record.status !== "running" || !record.active_since) {
    return record.accumulated_run_ms;
  }
  const active_since_ms = Date.parse(record.active_since);
  if (!Number.isFinite(active_since_ms)) return record.accumulated_run_ms;
  return record.accumulated_run_ms + Math.max(0, now.getTime() - active_since_ms);
}

function normalize_daemon_record(value: unknown): DaemonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Partial<DaemonRecord>;
  if (
    typeof data.pid !== "number" ||
    typeof data.root_dir !== "string" ||
    !is_daemon_status(data.status) ||
    typeof data.command !== "string" ||
    !Array.isArray(data.args)
  ) {
    return null;
  }
  const now = new Date().toISOString();
  const started_at = is_valid_timestamp(data.started_at) ? data.started_at : now;
  const updated_at = is_valid_timestamp(data.updated_at) ? data.updated_at : started_at;
  const active_since =
    data.status === "running"
      ? is_valid_timestamp(data.active_since)
        ? data.active_since
        : started_at
      : null;
  return {
    pid: data.pid,
    root_dir: data.root_dir,
    status: data.status,
    started_at,
    updated_at,
    command: data.command,
    args: data.args.map(String),
    active_since,
    stopped_at: is_valid_timestamp(data.stopped_at) ? data.stopped_at : null,
    accumulated_run_ms: normalize_duration_ms(data.accumulated_run_ms),
  };
}

function is_daemon_status(value: unknown): value is DaemonStatus {
  return value === "running" || value === "stopped" || value === "failed";
}

function normalize_duration_ms(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function build_daemon_invocation(
  root_dir: string,
  options: StartDaemonOptions,
): { command: string; args: string[] } {
  const entry = process.argv[1] ?? "";
  const run_args = ["run", "--daemon", "--root-dir", root_dir];
  if (options.once === true) run_args.push("--once");
  if (entry.endsWith(".ts")) {
    return {
      command: process.execPath,
      args: [resolve_tsx_entry(), entry, ...run_args],
    };
  }
  return {
    command: process.execPath,
    args: [...process.execArgv, entry, ...run_args],
  };
}

function resolve_tsx_entry(): string {
  const current_file = fileURLToPath(import.meta.url);
  const repo_root = path.resolve(path.dirname(current_file), "..", "..");
  return path.join(repo_root, "node_modules", "tsx", "dist", "cli.mjs");
}
