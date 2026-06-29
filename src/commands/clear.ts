import fs from "node:fs";
import path from "node:path";
import type { CAC } from "cac";
import { create_initial_run_state } from "../runtime/run-state.js";
import { ensure_dir, to_relative_posix_path, write_text_file } from "../utils/index.js";
import { build_learned_template, build_world_model_template } from "./workspace-template.js";

type ClearOptions = {
  rootDir?: string;
};

export type ClearResult = {
  cleaned_workspaces: string[];
};

const EMPTY_RUNTIME_FILES = ["state-log.jsonl", "turn-events.jsonl", "log.txt"];
const MANAGED_EMPTY_DIRS = [
  "turn-results",
  "human-requests",
  "work-plans",
  "work-logs",
  path.join("work-orders", "inbox"),
  path.join("work-orders", "outbox"),
];
const MEMORY_FILES = {
  "world-model.md": build_world_model_template(),
  "learned.md": build_learned_template(),
};

class WorkspaceCleaner {
  readonly #work_dir: string;

  constructor(work_dir: string) {
    this.#work_dir = path.resolve(work_dir);
  }

  run(): ClearResult {
    this.#ensure_workspace_exists(this.#work_dir);
    const workspaces = this.#collect_workspaces();
    for (const workspace of workspaces) {
      this.#reset_workspace(workspace);
    }
    return {
      cleaned_workspaces: workspaces.map((workspace) => this.#display_workspace(workspace)),
    };
  }

  #collect_workspaces(): string[] {
    const workspaces: string[] = [this.#work_dir];
    this.#collect_child_workspaces(path.join(this.#work_dir, "agents"), workspaces);
    return workspaces;
  }

  #collect_child_workspaces(agents_dir: string, workspaces: string[]) {
    if (!this.#is_directory(agents_dir)) return;
    const entries = fs
      .readdirSync(agents_dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const candidate = path.join(agents_dir, entry.name);
      if (this.#has_loong_dir(candidate)) {
        workspaces.push(candidate);
        this.#collect_child_workspaces(path.join(candidate, "agents"), workspaces);
      }
    }
  }

  #reset_workspace(workspace: string) {
    const loong_dir = path.join(workspace, ".loong");
    this.#ensure_workspace_exists(workspace);
    this.#ensure_managed_dirs(loong_dir);
    this.#clear_managed_dirs(loong_dir, workspace);
    this.#reset_runtime(loong_dir, workspace);
    this.#reset_memory(loong_dir, workspace);
  }

  #ensure_managed_dirs(loong_dir: string) {
    for (const relative_dir of ["runtime", "memory", "work-orders", ...MANAGED_EMPTY_DIRS]) {
      ensure_dir(path.join(loong_dir, relative_dir));
    }
  }

  #clear_managed_dirs(loong_dir: string, workspace: string) {
    for (const relative_dir of MANAGED_EMPTY_DIRS) {
      const target_dir = path.join(loong_dir, relative_dir);
      this.#clear_dir_contents(workspace, target_dir);
    }
  }

  #reset_runtime(loong_dir: string, workspace: string) {
    const runtime_dir = path.join(loong_dir, "runtime");
    this.#remove_entries_except(workspace, runtime_dir, new Set(["config.json"]));
    write_text_file(
      path.join(runtime_dir, "state.json"),
      `${JSON.stringify(create_initial_run_state(), null, 2)}\n`,
    );
    for (const file_name of EMPTY_RUNTIME_FILES) {
      write_text_file(path.join(runtime_dir, file_name), "");
    }
  }

  #reset_memory(loong_dir: string, workspace: string) {
    const memory_dir = path.join(loong_dir, "memory");
    this.#remove_entries_except(workspace, memory_dir, new Set(Object.keys(MEMORY_FILES)));
    for (const [file_name, content] of Object.entries(MEMORY_FILES)) {
      write_text_file(path.join(memory_dir, file_name), content);
    }
  }

  #clear_dir_contents(workspace: string, target_dir: string) {
    this.#assert_inside_loong(workspace, target_dir);
    for (const entry of fs.readdirSync(target_dir)) {
      const entry_path = path.join(target_dir, entry);
      this.#assert_inside_loong(workspace, entry_path);
      fs.rmSync(entry_path, { recursive: true, force: true });
    }
  }

  #remove_entries_except(workspace: string, target_dir: string, keep_file_names: Set<string>) {
    this.#assert_inside_loong(workspace, target_dir);
    for (const entry of fs.readdirSync(target_dir)) {
      if (keep_file_names.has(entry)) continue;
      const entry_path = path.join(target_dir, entry);
      this.#assert_inside_loong(workspace, entry_path);
      fs.rmSync(entry_path, { recursive: true, force: true });
    }
  }

  #ensure_workspace_exists(workspace: string) {
    if (this.#has_loong_dir(workspace)) return;
    throw new Error("当前目录不是 loong 工作区，缺少 .loong 目录。");
  }

  #has_loong_dir(workspace: string): boolean {
    return this.#is_directory(path.join(workspace, ".loong"));
  }

  #is_directory(target_path: string): boolean {
    return fs.existsSync(target_path) && fs.statSync(target_path).isDirectory();
  }

  #assert_inside_loong(workspace: string, target_path: string) {
    const loong_dir = path.resolve(workspace, ".loong");
    const resolved_target = path.resolve(target_path);
    const relative_path = path.relative(loong_dir, resolved_target);
    if (
      relative_path === "" ||
      (!relative_path.startsWith("..") && !path.isAbsolute(relative_path))
    ) {
      return;
    }
    throw new Error(`拒绝清理 .loong 之外的路径：${target_path}`);
  }

  #display_workspace(workspace: string): string {
    const relative_path = to_relative_posix_path(this.#work_dir, workspace);
    return relative_path === "" ? "." : relative_path;
  }
}

export function clear(work_dir = process.cwd()): ClearResult {
  const cleaner = new WorkspaceCleaner(work_dir);
  return cleaner.run();
}

function print_clear_result(result: ClearResult) {
  console.log("loong 运行时输出已清理。");
  console.log("cleaned workspaces:");
  for (const workspace of result.cleaned_workspaces) {
    console.log(`- ${workspace}`);
  }
}

function to_error_message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerClearCommand(cli: CAC) {
  cli
    .command("clear", "清理当前节点及子代理的运行时输出")
    .option("--root-dir", "工作目录")
    .action((options: ClearOptions) => {
      try {
        const result = clear(options.rootDir ?? process.cwd());
        print_clear_result(result);
      } catch (error) {
        console.error(`清理失败: ${to_error_message(error)}`);
        process.exitCode = 1;
      }
    });
}
