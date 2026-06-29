import fs from "node:fs";
import path from "node:path";

export function find_webui_root(start_dir: string): string | null {
  let current = path.resolve(start_dir);
  let found: string | null = null;
  while (true) {
    if (is_loong_root_dir(current)) {
      found = current;
    }
    const parent = path.dirname(current);
    if (parent === current) return found;
    current = parent;
  }
}

export function is_loong_root_dir(dir: string): boolean {
  return has_loong_dir(dir) && !is_inside_agents_dir(dir);
}

function has_loong_dir(dir: string): boolean {
  const loong_dir = path.join(dir, ".loong");
  return fs.existsSync(loong_dir) && fs.statSync(loong_dir).isDirectory();
}

function is_inside_agents_dir(dir: string): boolean {
  return path
    .resolve(dir)
    .split(path.sep)
    .some((part) => part === "agents");
}
