import path from "node:path";

export type ResolvedWorkPath = { normalized_path: string; absolute_path: string };

export function to_posix_path(file_path: string): string {
  return file_path.split(path.sep).join("/");
}

export function to_relative_posix_path(from_dir: string, target_path: string): string {
  return to_posix_path(path.relative(from_dir, target_path));
}

export function resolve_inside_work_dir(
  work_dir: string,
  relative_path: string,
): ResolvedWorkPath | null {
  const trimmed_path = relative_path.trim();
  if (!trimmed_path || path.isAbsolute(trimmed_path)) return null;
  const absolute_path = path.resolve(work_dir, trimmed_path);
  const normalized_path = path.relative(path.resolve(work_dir), absolute_path);
  if (!normalized_path || normalized_path.startsWith("..") || path.isAbsolute(normalized_path)) {
    return null;
  }
  return { normalized_path: to_posix_path(normalized_path), absolute_path };
}
