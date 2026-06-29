import { spawn } from "node:child_process";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { create_daemon_manager } from "../../runtime/index.js";
import {
  cancel_human_request,
  complete_human_request,
  read_human_request_detail,
} from "./human-request.js";
import { open_file_location, read_file_preview } from "./file-preview.js";
import { collect_webui_snapshot } from "./snapshot.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 4347;

export type WebuiServer = {
  close(): Promise<void>;
  port: number;
  url: string;
};

export async function start_webui_server(root_dir: string): Promise<WebuiServer> {
  const root = path.resolve(root_dir);
  const server = http.createServer((request, response) => {
    handle_request(root, request, response).catch((error) => {
      send_json(response, 500, { error: to_error_message(error) });
    });
  });
  const port = await listen_on_available_port(server, DEFAULT_PORT);
  const url = `http://${HOST}:${port}`;
  if (process.env.LOONG_WEBUI_SKIP_OPEN !== "1") {
    open_browser(url);
  }
  return {
    port,
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle_request(
  root_dir: string,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${HOST}`);
  if (url.pathname === "/api/snapshot" && request.method === "GET") {
    send_json(response, 200, collect_webui_snapshot(root_dir));
    return;
  }
  if (url.pathname === "/api/human-request" && request.method === "GET") {
    const agent_path = url.searchParams.get("agent_path") ?? "";
    const request_path = url.searchParams.get("request_path") ?? "";
    send_json(response, 200, read_human_request_detail(root_dir, agent_path, request_path));
    return;
  }
  if (url.pathname === "/api/file-preview" && request.method === "GET") {
    const agent_path = url.searchParams.get("agent_path") ?? "";
    const file_path = url.searchParams.get("file_path") ?? "";
    send_json(response, 200, read_file_preview(root_dir, agent_path, file_path));
    return;
  }
  if (url.pathname === "/api/file-location/open" && request.method === "POST") {
    const body = await read_json_body(request);
    open_file_location(
      root_dir,
      read_body_string(body, "agent_path"),
      read_body_string(body, "file_path"),
    );
    send_json(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/human-request/complete" && request.method === "POST") {
    const body = await read_json_body(request);
    complete_human_request(root_dir, {
      agent_path: read_body_string(body, "agent_path"),
      request_path: read_body_string(body, "request_path"),
      result: read_body_string(body, "result"),
    });
    send_json(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/human-request/cancel" && request.method === "POST") {
    const body = await read_json_body(request);
    cancel_human_request(root_dir, {
      agent_path: read_body_string(body, "agent_path"),
      request_path: read_body_string(body, "request_path"),
      result: read_body_string(body, "result"),
    });
    send_json(response, 200, { ok: true });
    return;
  }
  if (url.pathname === "/api/team/start" && request.method === "POST") {
    const result = create_daemon_manager(root_dir).start();
    send_json(response, 200, { ok: true, started: result.started });
    return;
  }
  if (url.pathname === "/api/team/stop" && request.method === "POST") {
    const stopped = create_daemon_manager(root_dir).stop();
    send_json(response, 200, { ok: true, stopped });
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    send_json(response, 404, { error: "API 不存在。" });
    return;
  }
  serve_static(response, url.pathname);
}

function listen_on_available_port(server: http.Server, start_port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const try_listen = (port: number) => {
      const on_error = (error: NodeJS.ErrnoException) => {
        server.off("listening", on_listening);
        if (error.code === "EADDRINUSE" || error.code === "EACCES") {
          try_listen(port + 1);
          return;
        }
        reject(error);
      };
      const on_listening = () => {
        server.off("error", on_error);
        resolve(port);
      };
      server.once("error", on_error);
      server.once("listening", on_listening);
      server.listen(port, HOST);
    };
    try_listen(start_port);
  });
}

function serve_static(response: ServerResponse, request_path: string): void {
  const client_dir = resolve_client_dir();
  if (!client_dir) {
    send_html(response, 500, "WebUI 前端资源不存在，请先运行 pnpm build。");
    return;
  }
  const safe_path = request_path === "/" ? "/index.html" : request_path;
  const target_path = path.resolve(client_dir, `.${safe_path}`);
  const relative = path.relative(client_dir, target_path);
  const file_path =
    relative.startsWith("..") || path.isAbsolute(relative) || !fs.existsSync(target_path)
      ? path.join(client_dir, "index.html")
      : target_path;
  if (!fs.existsSync(file_path) || !fs.statSync(file_path).isFile()) {
    send_html(response, 404, "WebUI 资源不存在。");
    return;
  }
  response.writeHead(200, { "content-type": content_type(file_path) });
  fs.createReadStream(file_path).pipe(response);
}

function resolve_client_dir(): string | null {
  const current_dir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "dist", "webui", "client"),
    path.resolve(current_dir, "..", "..", "..", "dist", "webui", "client"),
    path.resolve(current_dir, "..", "client"),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, "index.html"))) ?? null;
}

function content_type(file_path: string): string {
  const extension = path.extname(file_path);
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function send_json(response: ServerResponse, status: number, data: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(data)}\n`);
}

function send_html(response: ServerResponse, status: number, text: string): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(text);
}

async function read_json_body(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const text = Buffer.concat(chunks).toString("utf-8");
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请求体必须是 JSON 对象。");
  }
  return parsed as Record<string, unknown>;
}

function read_body_string(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`缺少字段：${key}`);
  return value;
}

function open_browser(url: string): void {
  const command =
    process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  child.unref();
}

function to_error_message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
