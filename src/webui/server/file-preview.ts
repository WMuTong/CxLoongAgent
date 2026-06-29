import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { load_agent_config } from "../../agent/index.js";
import { resolve_inside_work_dir } from "../../utils/index.js";

export type FilePreview = {
  relative_path: string;
  content: string;
};

export function read_file_preview(
  root_dir: string,
  agent_path: string,
  file_path: string,
): FilePreview {
  const resolved = resolve_work_order_attachment(root_dir, agent_path, file_path);
  if (path.posix.extname(resolved.normalized_path).toLowerCase() !== ".md") {
    throw new Error("暂不支持预览。");
  }
  return {
    relative_path: resolved.normalized_path,
    content: fs.readFileSync(resolved.absolute_path, "utf-8"),
  };
}

export function open_file_location(root_dir: string, agent_path: string, file_path: string): void {
  const resolved = resolve_work_order_attachment(root_dir, agent_path, file_path);
  const [command, args] =
    process.platform === "win32"
      ? ["explorer.exe", [`/select,${resolved.absolute_path}`]]
      : process.platform === "darwin"
        ? ["open", ["-R", resolved.absolute_path]]
        : ["xdg-open", [path.dirname(resolved.absolute_path)]];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  child.unref();
}

function resolve_work_order_attachment(root_dir: string, agent_path: string, file_path: string) {
  const agent_dir = resolve_agent_dir(root_dir, agent_path);
  const resolved = resolve_inside_work_dir(agent_dir, file_path);
  if (!resolved) throw new Error("file_path 必须是 agent 工作区内的相对路径。");
  if (!is_work_order_attachment_path(resolved.normalized_path)) {
    throw new Error("只支持访问工作单 input/output 附件。");
  }
  if (!fs.existsSync(resolved.absolute_path) || !fs.statSync(resolved.absolute_path).isFile()) {
    throw new Error("文件不存在。");
  }
  return resolved;
}

function resolve_agent_dir(root_dir: string, agent_path: string): string {
  const trimmed = agent_path.trim();
  const normalized = trimmed === "" || trimmed === "." ? "." : trimmed;
  const resolved = normalized === "." ? path.resolve(root_dir) : path.resolve(root_dir, normalized);
  const root = path.resolve(root_dir);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("agent_path 必须位于 WebUI 根目录内。");
  }
  if (!load_agent_config(resolved)) {
    throw new Error("agent_path 不是有效的 loong agent 工作区。");
  }
  return resolved;
}

function is_work_order_attachment_path(relative_path: string): boolean {
  const parts = relative_path.split("/");
  return (
    parts.length >= 6 &&
    parts[0] === ".loong" &&
    parts[1] === "work-orders" &&
    (parts[2] === "inbox" || parts[2] === "outbox") &&
    (parts[4] === "input" || parts[4] === "output")
  );
}
