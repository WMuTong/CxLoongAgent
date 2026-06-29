import type { CAC } from "cac";
import { observe_dashboard } from "../observe/index.js";

type ObserveOptions = {
  rootDir?: string;
  once?: boolean;
  interval?: number;
};

export function observe(options: ObserveOptions = {}): Promise<void> {
  return observe_dashboard({
    root_dir: options.rootDir ?? process.cwd(),
    once: options.once === true,
    interval_ms: options.interval,
  });
}

export function registerObserveCommand(cli: CAC) {
  cli
    .command("observe", "观察当前 loong 后台运行状态")
    .option("--root-dir", "工作目录")
    .option("--once", "只渲染一次当前状态后退出", { default: false })
    .option("--interval", "刷新间隔毫秒", { default: 1000 })
    .action(async (options: ObserveOptions) => {
      await observe(options);
    });
}
