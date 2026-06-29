import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { LoopState } from "./state.js";

const WORKTREE_DIR_NAME = ".worktree";
const REQUIRED_GITIGNORE_LINES = ["/agents/", "/.worktree/"];

export class GitWorktreeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitWorktreeError";
  }
}

export class GitTurnWorkspace {
  readonly worktree_root_dir: string;
  worktree_dir: string;
  #worktree_sequence = 0;

  constructor(readonly work_dir: string) {
    this.worktree_root_dir = path.join(work_dir, WORKTREE_DIR_NAME);
    this.worktree_dir = this.worktree_root_dir;
  }

  prepare(turn_id: string): string {
    this.ensure_ready();
    this.commit_current_changes("loong system checkpoint");
    this.worktree_dir = this.#create_turn_worktree_dir(turn_id);
    fs.mkdirSync(this.worktree_root_dir, { recursive: true });
    this.#git(["worktree", "add", "--detach", this.worktree_dir, "HEAD"]);
    this.#mount_agents();
    this.#ensure_runtime_dirs(this.worktree_dir);
    return this.worktree_dir;
  }

  commit_and_merge(state: LoopState): void {
    const commit_message = `loong turn ${state.turn_id}: ${state.summary}`;
    this.#git(["add", "-A"], this.worktree_dir);
    this.#git_with_identity(["commit", "-m", commit_message], this.worktree_dir);
    const commit = this.#git(["rev-parse", "HEAD"], this.worktree_dir).trim();
    this.#git(["merge", "--ff-only", commit]);
  }

  cleanup(): void {
    this.#remove_agents_mount();
    if (fs.existsSync(this.worktree_dir)) {
      const resolved = path.resolve(this.worktree_dir);
      const expected_root = path.resolve(this.worktree_root_dir);
      const relative = path.relative(expected_root, resolved);
      if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new GitWorktreeError(`拒绝清理非预期 worktree 路径：${resolved}`);
      }
      const result = this.#try_git(["worktree", "remove", "--force", this.worktree_dir]);
      if (result.status !== 0) {
        fs.rmSync(this.worktree_dir, { recursive: true, force: true });
      }
    }
    this.#try_git(["worktree", "prune"]);
  }

  ensure_ready(): void {
    if (!fs.existsSync(path.join(this.work_dir, ".git"))) {
      this.#git(["init", "--quiet"]);
    }
    this.#ensure_gitignore();
    this.#ensure_top_level();
  }

  commit_current_changes(message: string): void {
    this.#git(["add", "-A"]);
    if (!this.#has_staged_changes()) return;
    this.#git_with_identity(["commit", "-m", message]);
  }

  #ensure_top_level(): void {
    const top_level = path.resolve(this.#git(["rev-parse", "--show-toplevel"]).trim());
    if (top_level !== path.resolve(this.work_dir)) {
      throw new GitWorktreeError(
        `当前代理 Git 根目录必须等于工作目录：${this.work_dir}，实际为：${top_level}`,
      );
    }
  }

  #ensure_gitignore(): void {
    const gitignore_path = path.join(this.work_dir, ".gitignore");
    const current = fs.existsSync(gitignore_path)
      ? fs.readFileSync(gitignore_path, "utf-8")
      : "";
    const lines = current.split(/\r?\n/).filter((line) => line.length > 0);
    let changed = false;
    for (const required of REQUIRED_GITIGNORE_LINES) {
      if (lines.includes(required)) continue;
      lines.push(required);
      changed = true;
    }
    if (!changed && current.endsWith("\n")) return;
    fs.writeFileSync(gitignore_path, `${lines.join("\n")}\n`, "utf-8");
  }

  #has_staged_changes(): boolean {
    const result = this.#try_git(["diff", "--cached", "--quiet"]);
    return result.status === 1;
  }

  #create_turn_worktree_dir(turn_id: string): string {
    const safe_turn_id = turn_id.replace(/[^a-zA-Z0-9.-]/g, "-");
    while (true) {
      this.#worktree_sequence += 1;
      const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
      const dir = path.join(
        this.worktree_root_dir,
        `${safe_turn_id}-${timestamp}-${process.pid}-${this.#worktree_sequence}`,
      );
      if (!fs.existsSync(dir)) return dir;
    }
  }

  #mount_agents(): void {
    const agents_dir = path.join(this.work_dir, "agents");
    const mount_path = path.join(this.worktree_dir, "agents");
    if (!fs.existsSync(agents_dir)) return;
    if (fs.existsSync(mount_path)) fs.rmSync(mount_path, { recursive: true, force: true });
    fs.symlinkSync(agents_dir, mount_path, process.platform === "win32" ? "junction" : "dir");
  }

  #remove_agents_mount(): void {
    const mount_path = path.join(this.worktree_dir, "agents");
    if (!fs.existsSync(mount_path)) return;
    fs.rmSync(mount_path, { recursive: true, force: true });
  }

  #ensure_runtime_dirs(work_dir: string): void {
    for (const relative_dir of [
      ".loong/work-plans",
      ".loong/work-logs",
      ".loong/work-orders/inbox",
      ".loong/work-orders/outbox",
      ".loong/human-requests",
    ]) {
      fs.mkdirSync(path.join(work_dir, relative_dir), { recursive: true });
    }
  }

  #git(args: string[], cwd = this.work_dir): string {
    const result = this.#try_git(args, cwd);
    if (result.status !== 0) {
      throw new GitWorktreeError(
        `git ${args.join(" ")} 执行失败：${result.stderr.trim() || result.stdout.trim()}`,
      );
    }
    return result.stdout;
  }

  #git_with_identity(args: string[], cwd = this.work_dir): string {
    return this.#git(
      [
        "-c",
        "user.name=loong",
        "-c",
        "user.email=loong@example.invalid",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      cwd,
    );
  }

  #try_git(args: string[], cwd = this.work_dir): { status: number; stdout: string; stderr: string } {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf-8",
      windowsHide: true,
    });
    return {
      status: result.status ?? 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? result.error?.message ?? "",
    };
  }
}

export function create_git_turn_workspace(work_dir: string): GitTurnWorkspace {
  return new GitTurnWorkspace(path.resolve(work_dir));
}
