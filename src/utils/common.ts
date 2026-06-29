import fs from "node:fs";
import path from "node:path";

export async function sleep(delay: number) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function is_non_empty_string(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

export function is_iso_datetime(value: unknown): boolean {
  if (value instanceof Date) return Number.isFinite(value.getTime());
  return is_non_empty_string(value) && Number.isFinite(Date.parse(value));
}

export function get_dir_basename(dir_path: string, fallback = "root"): string {
  const base_name = path.basename(dir_path).trim();
  return base_name.length > 0 ? base_name : fallback;
}

export function ensure_dir(dir_path: string): boolean {
  if (fs.existsSync(dir_path)) return false;
  fs.mkdirSync(dir_path, { recursive: true });
  return true;
}

export function is_dir_empty(dir_path: string): boolean {
  if (!fs.existsSync(dir_path)) return true;
  return fs.readdirSync(dir_path).length === 0;
}

export function write_text_file(file_path: string, content: string) {
  fs.writeFileSync(file_path, content, "utf-8");
}
