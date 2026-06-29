import type { CAC } from "cac";
import { combine_turn_observers, create_file_turn_observer } from "../observe/index.js";
import { AgentRuntime, create_daemon_manager } from "../runtime/index.js";

type RunOptions = {
  rootDir?: string;
  daemon?: boolean;
  once?: boolean;
};

export function run_once(options: RunOptions) {
  const rootDir = options.rootDir ?? process.cwd();
  const runtime = new AgentRuntime(rootDir, true, {
    start_child_agents: false,
    turn_observer_factory: (work_dir) => {
      const file_observer = create_file_turn_observer(work_dir);
      return combine_turn_observers([file_observer]);
    },
  });
  return runtime.run_once();
}

export async function run_daemon(options: RunOptions = {}): Promise<void> {
  const rootDir = options.rootDir ?? process.cwd();
  const manager = create_daemon_manager(rootDir);
  manager.mark_current_process_running();
  const stop = () => {
    manager.mark_stopped();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const runtime = new AgentRuntime(rootDir, true, {
      start_child_agents: options.once !== true,
      turn_observer_factory: (work_dir) =>
        combine_turn_observers([create_file_turn_observer(work_dir)]),
    });
    if (options.once === true) {
      await runtime.run_once();
    } else {
      await runtime.run();
    }
    manager.mark_stopped();
  } catch (error) {
    manager.mark_stopped("failed");
    throw error;
  }
}

export async function run(options: RunOptions) {
  if (options.daemon === true) {
    await run_daemon(options);
    return;
  }
  const rootDir = options.rootDir ?? process.cwd();
  const manager = create_daemon_manager(rootDir);
  const result = manager.start({ once: options.once === true });
  console.log(
    result.started
      ? `loong 后台运行已启动，pid=${result.record.pid}。`
      : `loong 后台运行已存在，pid=${result.record.pid}。`,
  );
  console.log(`查看运行详情：loong observe${options.rootDir ? ` --root-dir ${rootDir}` : ""}`);
}

export function registerRunCommand(cli: CAC) {
  cli
    .command("run", "启动任务")
    .option("--root-dir", "工作目录")
    .option("--daemon", "内部运行模式：承载后台运行循环", { default: false })
    .option("--once", "启动一次性后台轮次", { default: false })
    .action(async (options: RunOptions) => {
      await run(options);
    });
}
