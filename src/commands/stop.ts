import type { CAC } from "cac";
import { create_daemon_manager } from "../runtime/index.js";

type StopOptions = {
  rootDir?: string;
};

export function stop(options: StopOptions = {}): boolean {
  const rootDir = options.rootDir ?? process.cwd();
  return create_daemon_manager(rootDir).stop();
}

export function registerStopCommand(cli: CAC) {
  cli
    .command("stop", "停止当前工作区的 loong 后台运行进程")
    .option("--root-dir", "工作目录")
    .action((options: StopOptions) => {
      const stopped = stop(options);
      console.log(stopped ? "loong 后台运行已停止。" : "未检测到正在运行的 loong 后台进程。");
    });
}
