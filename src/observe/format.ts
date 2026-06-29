import path from "node:path";
import { to_posix_path } from "../utils/index.js";

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function parse_date(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function format_time(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function get_age(
  value: string,
): { date: Date; seconds: number; minutes: number; hours: number } | null {
  const date = parse_date(value);
  if (!date) return null;
  const seconds = Math.max(0, Math.floor((Date.now() - date.getTime()) / 1000));
  return { date, seconds, minutes: Math.floor(seconds / 60), hours: Math.floor(seconds / 3600) };
}

export function format_wall_clock_time(value: string): string {
  const date = parse_date(value);
  if (!date) return value;
  return `${date.getFullYear().toString().padStart(4, "0")}-${pad2(date.getMonth() + 1)}-${pad2(
    date.getDate(),
  )} ${format_time(date)}`;
}

export function format_time_of_day(value: string): string {
  const date = parse_date(value);
  return date ? format_time(date) : "";
}

export function format_age(value: string): string {
  const age = get_age(value);
  if (!age) return value || "-";
  if (age.seconds < 5) return "刚刚";
  if (age.seconds < 60) return `${age.seconds}秒前`;
  if (age.minutes < 60) return `${age.minutes}分钟前`;
  return age.hours < 24 ? `${age.hours}小时前` : format_wall_clock_time(value);
}

export function format_compact_age(value: string): string {
  const age = get_age(value);
  if (!age) return value || "-";
  if (age.seconds < 5) return "刚刚";
  if (age.seconds < 60) return `${age.seconds}秒前`;
  if (age.minutes < 60) return `${age.minutes}分钟前`;
  if (age.hours < 48) return `${age.hours}小时前`;
  const days = Math.floor(age.hours / 24);
  return days < 30 ? `${days}天前` : `${pad2(age.date.getMonth() + 1)}-${pad2(age.date.getDate())}`;
}

export function clip_text(text: string, max_length: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= max_length ? normalized : `${normalized.slice(0, max_length - 3)}...`;
}

export function format_agent_path(root_dir: string, work_dir: string): string {
  const relative = path.relative(root_dir, work_dir);
  return relative ? to_posix_path(relative) : ".";
}

function format_absolute_display_path(file_path: string, work_dir: string): string {
  const relative = path.relative(work_dir, file_path);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return file_path;
  return to_posix_path(relative);
}

export function format_display_path(file_path: string, work_dir: string): string {
  return path.isAbsolute(file_path) ? format_absolute_display_path(file_path, work_dir) : file_path;
}

export function get_relative_display_path(file_path: string, work_dir: string): string {
  if (path.isAbsolute(file_path)) return format_absolute_display_path(file_path, work_dir);
  return to_posix_path(file_path);
}

export function count_non_empty_lines(text: string): number {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  return lines.filter((line) => line.trim() !== "").length;
}
