import type { CAC } from "cac";
import { find_webui_root, start_webui_server } from "../webui/server/index.js";

export async function webui(): Promise<void> {
  const root_dir = find_webui_root(process.cwd());
  if (!root_dir) {
    throw new Error("当前目录不属于 loong 根工作区，未找到符合条件的 .loong 根目录。");
  }
  const server = await start_webui_server(root_dir);
  console.log(`loong WebUI 已启动：${server.url}`);
  console.log(`根工作区：${root_dir}`);
  await new Promise<void>((resolve) => {
    let stopped = false;
    const stop = async () => {
      if (stopped) return;
      stopped = true;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await server.close().catch(() => {});
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export function registerWebuiCommand(cli: CAC) {
  cli.command("webui", "打开当前 loong 根工作区的 Web 管理界面").action(async () => {
    try {
      await webui();
    } catch (error) {
      console.error(`WebUI 启动失败: ${to_error_message(error)}`);
      process.exitCode = 1;
    }
  });
}

function to_error_message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
