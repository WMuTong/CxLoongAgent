import fs from "node:fs";
import path from "node:path";
import { append_jsonl } from "../storage/index.js";

export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export type RuntimeLogEntry = {
  recorded_at: string;
  level: RuntimeLogLevel;
  message: string;
};

export function get_runtime_dir_path(work_dir: string): string {
  return path.join(work_dir, ".loong", "runtime");
}

export function get_turn_results_dir_path(work_dir: string): string {
  return path.join(work_dir, ".loong", "turn-results");
}

export function get_turn_result_state_path(work_dir: string, turn_id: string): string {
  return path.join(get_turn_results_dir_path(work_dir), `${turn_id}-state.json`);
}

export function get_state_log_path(work_dir: string): string {
  return path.join(get_runtime_dir_path(work_dir), "state-log.jsonl");
}

export function get_run_state_path(work_dir: string): string {
  return path.join(get_runtime_dir_path(work_dir), "state.json");
}

export function get_turn_events_log_path(work_dir: string): string {
  return path.join(get_runtime_dir_path(work_dir), "turn-events.jsonl");
}

export function get_runtime_log_path(work_dir: string): string {
  return path.join(get_runtime_dir_path(work_dir), "log.txt");
}

export function ensure_runtime_log_files(work_dir: string): void {
  fs.mkdirSync(get_runtime_dir_path(work_dir), { recursive: true });
  for (const file_path of [
    get_run_state_path(work_dir),
    get_state_log_path(work_dir),
    get_turn_events_log_path(work_dir),
    get_runtime_log_path(work_dir),
  ]) {
    if (!fs.existsSync(file_path)) {
      fs.writeFileSync(file_path, file_path.endsWith("state.json") ? "{}\n" : "", "utf-8");
    }
  }
}

export class RuntimeLog {
  readonly #now: () => Date;

  constructor(
    readonly work_dir: string,
    options: { now?: () => Date } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    ensure_runtime_log_files(work_dir);
  }

  debug(message: string): void {
    this.#append("debug", message);
  }

  info(message: string): void {
    this.#append("info", message);
  }

  warn(message: string): void {
    this.#append("warn", message);
  }

  error(message: string): void {
    this.#append("error", message);
  }

  #append(level: RuntimeLogLevel, message: string): void {
    ensure_runtime_log_files(this.work_dir);
    const entry: RuntimeLogEntry = {
      recorded_at: this.#now().toISOString(),
      level,
      message,
    };
    fs.appendFileSync(
      get_runtime_log_path(this.work_dir),
      `[${entry.recorded_at}] ${entry.level.toUpperCase()} ${entry.message}\n`,
      "utf-8",
    );
  }
}

export function create_runtime_log(
  work_dir: string,
  options: { now?: () => Date } = {},
): RuntimeLog {
  return new RuntimeLog(work_dir, options);
}

export function append_turn_event<T extends object>(work_dir: string, event: T): void {
  ensure_runtime_log_files(work_dir);
  append_jsonl(get_turn_events_log_path(work_dir), event);
}
