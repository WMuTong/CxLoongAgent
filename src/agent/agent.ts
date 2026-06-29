import fs from "node:fs";
import path from "node:path";

export interface AgentConfig {
  name: string;
  position: string;
  description: string;
  sort_index: number;
  never_stop: boolean;
  dir: string;
}

export function get_agent_config_path(agent_dir: string): string {
  return path.join(agent_dir, ".loong", "runtime", "config.json");
}

export function load_agent_config(agent_dir: string): AgentConfig | null {
  const config_path = get_agent_config_path(agent_dir);
  if (!fs.existsSync(config_path)) {
    return null;
  }
  try {
    const text = fs.readFileSync(config_path, { encoding: "utf-8" });
    const config: AgentConfig = JSON.parse(text);
    config.position =
      typeof config.position === "string" ? config.position : path.basename(agent_dir);
    config.sort_index = normalize_sort_index(config.sort_index);
    config.never_stop = config.never_stop === true;
    config.dir = agent_dir;
    return config;
  } catch {
    return null;
  }
}

export function load_current_agent_name(work_dir: string): string | null {
  const config = load_agent_config(work_dir);
  if (!config || typeof config.name !== "string") return null;
  const name = config.name.trim();
  return name.length > 0 ? name : null;
}

export function load_current_agent_never_stop(work_dir: string): boolean {
  return load_agent_config(work_dir)?.never_stop === true;
}

export function load_parent_agent_config(work_dir: string): AgentConfig | null {
  const agent_dir = resolve_agent_source_dir(work_dir);
  const agents_dir = path.dirname(agent_dir);
  if (path.basename(agents_dir) !== "agents") return null;
  return load_agent_config(path.dirname(agents_dir));
}

export function load_agent_configs(work_dir: string): AgentConfig[] {
  const agents_dir = path.join(work_dir, "agents");
  if (!fs.existsSync(agents_dir)) {
    return [];
  }
  const sub_dirs = fs.readdirSync(agents_dir, { withFileTypes: false, encoding: "utf-8" });
  const configs: AgentConfig[] = [];
  for (const sub_dir of sub_dirs) {
    const config = load_agent_config(path.join(agents_dir, sub_dir));
    if (config) configs.push(config);
  }
  return configs.sort(compare_agent_config_order);
}

export function find_agent_config(work_dir: string, agent_name: string): AgentConfig | null {
  return load_agent_configs(work_dir).find((config) => config.name === agent_name) ?? null;
}

function normalize_sort_index(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function resolve_agent_source_dir(work_dir: string): string {
  const resolved = path.resolve(work_dir);
  const parent = path.dirname(resolved);
  if (path.basename(parent) === ".worktree") {
    return path.dirname(parent);
  }
  return resolved;
}

function compare_agent_config_order(left: AgentConfig, right: AgentConfig): number {
  const by_sort_index = left.sort_index - right.sort_index;
  if (by_sort_index !== 0) return by_sort_index;
  return path.basename(left.dir).localeCompare(path.basename(right.dir));
}
