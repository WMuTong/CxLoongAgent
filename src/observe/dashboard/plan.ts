import fs from "node:fs";
import path from "node:path";
import type { FileChangeItem, TodoListItem } from "@openai/codex-sdk";
import type { LoopState } from "../../runtime/index.js";
import { resolve_inside_work_dir } from "../../utils/index.js";
import { get_relative_display_path } from "../format.js";
import {
  MAX_PLAN_STEPS,
  type PlanStepView,
  type PlanView,
  type TimestampedLine,
  type TurnEventSnapshot,
} from "./model.js";

export function resolve_plan_lines(
  work_dir: string,
  turn_id: string,
  last_state: LoopState | null,
  events: TurnEventSnapshot[],
): { lines: TimestampedLine[]; total: number } {
  if (turn_id !== "-") {
    const live_plan = load_live_plan_lines(work_dir, turn_id, events);
    if (live_plan) return live_plan;
  }

  if (!last_state?.plan || last_state.turn_id !== turn_id) return { lines: [], total: 0 };
  const plan = load_plan_view(work_dir, last_state.plan);
  return format_plan_view_lines(
    plan,
    resolve_plan_recorded_at(work_dir, last_state.plan, last_state.updated_at),
  );
}

function load_live_plan_lines(
  work_dir: string,
  turn_id: string,
  events: TurnEventSnapshot[],
): { lines: TimestampedLine[]; total: number } | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.context?.turn_id !== turn_id) continue;
    if (event.type === "state.ready" && event.state?.plan) {
      const plan = load_plan_view(work_dir, event.state.plan);
      const formatted = format_plan_view_lines(
        plan,
        event.recorded_at ??
          resolve_plan_recorded_at(work_dir, event.state.plan, event.state.updated_at),
      );
      if (formatted.total > 0) return formatted;
    }
    if (event.type !== "codex.event" || !event.event) continue;
    if (
      event.event.type !== "item.started" &&
      event.event.type !== "item.updated" &&
      event.event.type !== "item.completed"
    ) {
      continue;
    }

    const item = event.event.item;
    if (item.type === "file_change") {
      const plan = load_plan_view_from_file_change(work_dir, turn_id, item as FileChangeItem);
      const formatted = format_plan_view_lines(plan, event.recorded_at ?? "");
      if (formatted.total > 0) return formatted;
      continue;
    }

    if (item.type === "todo_list")
      return format_todo_lines(item as TodoListItem, event.recorded_at ?? "");
  }

  return null;
}

function format_plan_view_lines(
  plan: PlanView | null,
  recorded_at: string,
): { lines: TimestampedLine[]; total: number } {
  if (!plan) return { lines: [], total: 0 };
  return {
    total: plan.steps.length,
    lines: plan.steps.slice(0, MAX_PLAN_STEPS).map((step) => {
      const deviation = step.deviation ? ` · ${step.deviation}` : "";
      return {
        recorded_at,
        line: `${format_plan_status(step.status)} ${step.step}. ${step.description}${deviation}`,
      };
    }),
  };
}

function format_todo_lines(
  item: TodoListItem,
  recorded_at: string,
): { lines: TimestampedLine[]; total: number } {
  return {
    total: item.items.length,
    lines: item.items.slice(0, MAX_PLAN_STEPS).map((todo, index) => ({
      recorded_at,
      line: `${format_plan_status(todo.completed ? "completed" : "pending")} ${index + 1}. ${
        todo.text
      }`,
    })),
  };
}

function load_plan_view(work_dir: string, relative_path: string): PlanView | null {
  const resolved = resolve_inside_work_dir(work_dir, relative_path);
  if (!resolved) return null;
  const absolute_path = resolved.absolute_path;
  if (!fs.existsSync(absolute_path) || !fs.statSync(absolute_path).isFile()) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(absolute_path, "utf-8")) as {
      plans?: Array<{
        step?: unknown;
        description?: unknown;
        status?: unknown;
        deviation?: unknown;
      }>;
    };
    if (!Array.isArray(parsed.plans)) return null;
    const steps = parsed.plans
      .map((item, index): PlanStepView | null => {
        if (typeof item.description !== "string" || item.description.trim() === "") return null;
        return {
          step:
            typeof item.step === "number" || typeof item.step === "string"
              ? String(item.step)
              : String(index + 1),
          description: item.description.trim(),
          status: typeof item.status === "string" ? item.status : "pending",
          deviation:
            typeof item.deviation === "string" && item.deviation.trim()
              ? item.deviation.trim()
              : null,
        };
      })
      .filter((item): item is PlanStepView => item !== null);
    return steps.length > 0 ? { steps } : null;
  } catch {
    return null;
  }
}

function load_plan_view_from_file_change(
  work_dir: string,
  turn_id: string,
  item: FileChangeItem,
): PlanView | null {
  for (let index = item.changes.length - 1; index >= 0; index -= 1) {
    const change = item.changes[index];
    const relative_path = get_relative_display_path(change.path, work_dir);
    if (!is_turn_plan_path(relative_path, turn_id)) continue;
    const plan = load_plan_view(work_dir, relative_path);
    if (plan) return plan;
  }
  return null;
}

function resolve_plan_recorded_at(
  work_dir: string,
  relative_path: string,
  fallback: string,
): string {
  if (fallback.trim()) return fallback;
  const resolved = resolve_inside_work_dir(work_dir, relative_path);
  if (!resolved || !fs.existsSync(resolved.absolute_path)) return "";
  if (!fs.statSync(resolved.absolute_path).isFile()) return "";
  return (
    read_plan_created_at(resolved.absolute_path) ??
    fs.statSync(resolved.absolute_path).mtime.toISOString()
  );
}

function read_plan_created_at(file_path: string): string | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(file_path, "utf-8")) as { created_at?: unknown };
    return typeof parsed.created_at === "string" && parsed.created_at.trim()
      ? parsed.created_at
      : null;
  } catch {
    return null;
  }
}

function format_plan_status(status: string): string {
  if (status === "completed") return "完成";
  if (status === "cancelled") return "取消";
  if (status === "in-progress" || status === "in_progress") return "进行中";
  if (status === "pending") return "待办";
  return status;
}

function is_turn_plan_path(relative_path: string, turn_id: string): boolean {
  return (
    path.posix.dirname(relative_path) === ".loong/work-plans" &&
    new RegExp(`^${escape_regexp(turn_id)}-\\d{8}T\\d{6}-plan\\.json$`).test(
      path.posix.basename(relative_path),
    )
  );
}

function escape_regexp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
