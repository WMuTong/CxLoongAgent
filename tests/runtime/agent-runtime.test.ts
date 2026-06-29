import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { load_current_agent_name } from "../../src/agent/agent.js";
import { init } from "../../src/commands/init.js";
import type { HumanRequestManager } from "../../src/human-request/index.js";
import { AgentRuntime } from "../../src/runtime/agent-runtime.js";
import type { GitTurnWorkspace } from "../../src/runtime/git-worktree.js";
import {
  get_run_state_path,
  get_runtime_log_path,
  get_state_log_path,
} from "../../src/runtime/log.js";
import { create_agent_run_state_store } from "../../src/runtime/run-state.js";
import type { WorkOrderManager } from "../../src/work-order/work-order.js";
import {
  create_child_agent,
  create_valid_loop_state,
  create_workspace,
} from "../helpers/workspace.js";

function create_fake_work_orders(overrides: Partial<WorkOrderManager> = {}): WorkOrderManager {
  return {
    list_active_work_order_paths() {
      return [];
    },
    read_work_order_executor() {
      return null;
    },
    is_work_order_completed() {
      return false;
    },
    list_work_order_snapshots() {
      return [];
    },
    list_inbox_order_targets_by_check_status() {
      return [];
    },
    list_inbox_order_targets_with_missing_check_status() {
      return [];
    },
    list_inbox_order_targets_with_invalid_work_check() {
      return [];
    },
    list_inbox_order_targets_without_completion_report() {
      return [];
    },
    set_completion_report_check_status() {},
    read_work_check_open_issue_count() {
      return null;
    },
    sync_outbox_work_order_to_child() {},
    sync_completed_inbox_reports_to_parent() {},
    ...overrides,
  } as unknown as WorkOrderManager;
}

function create_fake_human_requests(
  overrides: Partial<HumanRequestManager> = {},
): HumanRequestManager {
  return {
    list_snapshots() {
      return [];
    },
    list_waiting_request_paths() {
      return [];
    },
    is_request_done() {
      return false;
    },
    ...overrides,
  } as unknown as HumanRequestManager;
}

function create_fake_turn_workspace(work_dir: string): GitTurnWorkspace {
  return {
    worktree_dir: work_dir,
    prepare() {
      return work_dir;
    },
    commit_and_merge() {},
    cleanup() {},
    ensure_ready() {},
    commit_current_changes() {},
  } as unknown as GitTurnWorkspace;
}

function git(work_dir: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: work_dir,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim());
  }
  return result.stdout.trim();
}

describe("AgentRuntime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("run_once executes one turn and appends the loop state to the runtime state log", async () => {
    const work_dir = create_workspace("agent-runtime-once");
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: () => ({
        async run() {
          return state;
        },
      }),
      sleep: async () => {
        throw new Error("run_once should not sleep");
      },
    });

    const result = await runtime.run_once();

    expect(result).toBe(state);
    const lines = fs
      .readFileSync(get_state_log_path(work_dir), "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual(state);
    expect(JSON.parse(fs.readFileSync(get_run_state_path(work_dir), "utf-8"))).toMatchObject({
      status: "stopped",
      started_at: expect.any(String),
      ended_at: expect.any(String),
      latest_turn_id: "000001",
      latest_summary: "本轮完成了测试准备。",
      sleep_until: null,
      last_error: null,
    });
    expect(fs.existsSync(path.join(work_dir, ".loong", ".system-log.jsonl"))).toBe(false);
  });

  test("run retries after a turn failure and then continues", async () => {
    const work_dir = create_workspace("agent-runtime-retry");
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    const sleeps: number[] = [];
    const sleep_states: string[] = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    let run_count = 0;
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: () => ({
        async run() {
          run_count += 1;
          if (run_count === 1) throw new Error("boom");
          return state;
        },
      }),
      retry_delay_seconds: 2,
      sleep: async (delay) => {
        sleeps.push(delay);
        sleep_states.push(
          JSON.parse(fs.readFileSync(get_run_state_path(work_dir), "utf-8")).status,
        );
      },
    });

    await runtime.run();

    expect(run_count).toBe(2);
    expect(sleeps).toEqual([2000]);
    expect(sleep_states).toEqual(["sleep"]);
    expect(fs.readFileSync(get_runtime_log_path(work_dir), "utf-8")).toContain("运行轮次失败");
  });

  test("run wakes early when a watched work order is completed during sleep", async () => {
    const work_dir = create_workspace("agent-runtime-wakeup");
    const continue_state = create_valid_loop_state(work_dir);
    continue_state.next_action = "continue";
    continue_state.sleep_duration = 1;
    continue_state.delegated_work_orders = [".loong/work-orders/outbox/order/work-order.md"];
    const stop_state = create_valid_loop_state(work_dir);
    stop_state.next_action = "stop";
    let run_count = 0;
    let completion_checks = 0;
    const sleeps: number[] = [];
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () =>
        create_fake_work_orders({
          is_work_order_completed() {
            completion_checks += 1;
            return completion_checks > 1;
          },
        }),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: () => ({
        async run() {
          run_count += 1;
          return run_count === 1 ? continue_state : stop_state;
        },
      }),
      sleep_poll_interval_ms: 10,
      sleep: async (delay) => {
        sleeps.push(delay);
      },
    });

    await runtime.run();

    expect(run_count).toBe(2);
    expect(sleeps).toEqual([10]);
    expect(completion_checks).toBe(2);
  });

  test("run wakes early when a watched human request is completed during sleep", async () => {
    const work_dir = create_workspace("agent-runtime-human-wakeup");
    const continue_state = create_valid_loop_state(work_dir);
    continue_state.next_action = "continue";
    continue_state.sleep_duration = 1;
    continue_state.human_requests = [".loong/human-requests/000001-20260421T000000-request-1.md"];
    const stop_state = create_valid_loop_state(work_dir, "000002");
    stop_state.next_action = "stop";
    let run_count = 0;
    let completion_checks = 0;
    const sleeps: number[] = [];
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      human_request_factory: () =>
        create_fake_human_requests({
          is_request_done() {
            completion_checks += 1;
            return completion_checks > 1;
          },
        }),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: () => ({
        async run() {
          run_count += 1;
          return run_count === 1 ? continue_state : stop_state;
        },
      }),
      sleep_poll_interval_ms: 10,
      sleep: async (delay) => {
        sleeps.push(delay);
      },
    });

    await runtime.run();

    expect(run_count).toBe(2);
    expect(sleeps).toEqual([10]);
    expect(completion_checks).toBe(2);
  });

  test("run resumes an unexpired sleep before starting the next turn", async () => {
    const work_dir = create_workspace("agent-runtime-resume-sleep");
    create_agent_run_state_store(work_dir).mark_sleep(null, 1);
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    const sleeps: number[] = [];
    let run_count = 0;
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: () => ({
        async run() {
          expect(sleeps.length).toBeGreaterThan(0);
          run_count += 1;
          return state;
        },
      }),
      sleep: async (delay) => {
        sleeps.push(delay);
      },
    });

    await runtime.run();

    expect(run_count).toBe(1);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  test("run starts delegated child agents before resuming parent sleep", async () => {
    const work_dir = create_workspace("agent-runtime-resume-sleep-child");
    const child_dir = path.join(work_dir, "agents", "worker");
    init(child_dir);
    const child_name = load_current_agent_name(child_dir) ?? "worker";
    create_agent_run_state_store(work_dir).mark_sleep(null, 1);
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    let child_starts = 0;
    const sleeps: number[] = [];
    const runtime = new AgentRuntime(work_dir, true, {
      start_child_agents: true,
      work_order_factory: () =>
        create_fake_work_orders({
          list_active_work_order_paths() {
            return [".loong/work-orders/outbox/20260421T000000-order-1/work-order.md"];
          },
          read_work_order_executor() {
            return child_name;
          },
        }),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: () => ({
        async run() {
          return state;
        },
      }),
      child_runtime_factory: () => ({
        async run() {
          child_starts += 1;
          await new Promise(() => {});
        },
      }),
      sleep: async (delay) => {
        expect(child_starts).toBe(1);
        sleeps.push(delay);
      },
    });

    await runtime.run();

    expect(child_starts).toBe(1);
    expect(sleeps.length).toBeGreaterThan(0);
  });

  test("run_once syncs a matching child work order without starting the child runtime", async () => {
    const work_dir = create_workspace("agent-runtime-child");
    const child_dir = path.join(work_dir, "agents", "worker");
    init(child_dir);
    const child_name = load_current_agent_name(child_dir) ?? "worker";
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    let child_starts = 0;
    let child_syncs = 0;
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () =>
        create_fake_work_orders({
          list_active_work_order_paths() {
            return [".loong/work-orders/outbox/20260421T000000-order-1/work-order.md"];
          },
          read_work_order_executor() {
            return child_name;
          },
          sync_outbox_work_order_to_child() {
            child_syncs += 1;
          },
        }),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: () => ({
        async run() {
          return state;
        },
      }),
      child_runtime_factory: () => ({
        async run() {
          child_starts += 1;
          await new Promise(() => {});
        },
      }),
    });

    await runtime.run_once();

    expect(child_syncs).toBe(2);
    expect(child_starts).toBe(0);
  });

  test("run_once schedules an invalid work check report before repair", async () => {
    const work_dir = create_workspace("agent-runtime-turn-context");
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    let received_context: unknown = null;
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () =>
        create_fake_work_orders({
          list_inbox_order_targets_with_invalid_work_check() {
            return [".loong/work-orders/inbox/20260421T000000-order-1"];
          },
          list_inbox_order_targets_by_check_status(check_status: "pending" | "passed" | "failed") {
            return check_status === "failed"
              ? [".loong/work-orders/inbox/20260421T000001-order-2"]
              : [];
          },
        }),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: (_dir, _root, turn_context) => ({
        async run() {
          received_context = turn_context;
          return state;
        },
      }),
    });

    await runtime.run_once();

    expect(received_context).toEqual({
      turn_type: "work_check",
      target_work_order_path: ".loong/work-orders/inbox/20260421T000000-order-1",
    });
  });

  test("run_once schedules a bound execution turn for the earliest inbox order without a report", async () => {
    const work_dir = create_workspace("agent-runtime-execution-context");
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    let received_context: unknown = null;
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () =>
        create_fake_work_orders({
          list_inbox_order_targets_without_completion_report() {
            return [".loong/work-orders/inbox/20260421T000000-order-1"];
          },
        }),
      turn_workspace_factory: () => create_fake_turn_workspace(work_dir),
      turn_runner_factory: (_dir, _root, turn_context) => ({
        async run() {
          received_context = turn_context;
          return state;
        },
      }),
    });

    await runtime.run_once();

    expect(received_context).toEqual({
      turn_type: "execution",
      target_work_order_path: ".loong/work-orders/inbox/20260421T000000-order-1",
    });
  });

  test("run_once executes the turn inside a disposable git worktree", async () => {
    const work_dir = create_workspace("agent-runtime-worktree");
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    let execution_dir = "";
    let active_turn_state: unknown = null;
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_runner_factory: (dir) => ({
        async run() {
          execution_dir = dir;
          active_turn_state = JSON.parse(
            fs.readFileSync(get_run_state_path(work_dir), "utf-8"),
          ).active_turn;
          fs.writeFileSync(path.join(dir, "worktree-output.txt"), "generated\n", "utf-8");
          return state;
        },
      }),
    });

    await runtime.run_once();

    expect(path.basename(path.dirname(execution_dir))).toBe(".worktree");
    expect(path.basename(execution_dir)).toMatch(/^000001-/);
    expect(active_turn_state).toMatchObject({
      turn_id: "000001",
      execution_dir,
      started_at: expect.any(String),
    });
    expect(JSON.parse(fs.readFileSync(get_run_state_path(work_dir), "utf-8")).active_turn).toBe(
      null,
    );
    expect(fs.existsSync(path.join(work_dir, "worktree-output.txt"))).toBe(true);
    expect(fs.readdirSync(path.join(work_dir, ".worktree"))).toHaveLength(0);
  });

  test("system checkpoint commits do not overwrite the workspace git identity", async () => {
    const work_dir = create_workspace("agent-runtime-git-identity");
    git(work_dir, ["config", "user.name", "custom-user"]);
    git(work_dir, ["config", "user.email", "custom@example.invalid"]);
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_runner_factory: () => ({
        async run() {
          return state;
        },
      }),
    });

    await runtime.run_once();

    expect(git(work_dir, ["config", "user.name"])).toBe("custom-user");
    expect(git(work_dir, ["config", "user.email"])).toBe("custom@example.invalid");
    expect(git(work_dir, ["log", "--format=%s", "--max-count=2"])).toContain(
      "loong system checkpoint",
    );
  });

  test("run_once keeps the failed turn worktree for inspection", async () => {
    const work_dir = create_workspace("agent-runtime-worktree-fail");
    let execution_dir = "";
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_runner_factory: (dir) => ({
        async run() {
          execution_dir = dir;
          fs.writeFileSync(path.join(dir, "half-turn.txt"), "discard me\n", "utf-8");
          throw new Error("boom");
        },
      }),
    });

    await expect(runtime.run_once()).rejects.toThrow("boom");

    expect(fs.existsSync(path.join(work_dir, "half-turn.txt"))).toBe(false);
    expect(path.basename(path.dirname(execution_dir))).toBe(".worktree");
    expect(fs.existsSync(path.join(execution_dir, "half-turn.txt"))).toBe(true);
  });

  test("run_once treats cleanup failure as a warning after a successful turn", async () => {
    const work_dir = create_workspace("agent-runtime-cleanup-warning");
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    const cleanup_error = new Error("cleanup failed");
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_workspace_factory: () =>
        ({
          ...create_fake_turn_workspace(work_dir),
          cleanup() {
            throw cleanup_error;
          },
        }) as unknown as GitTurnWorkspace,
      turn_runner_factory: () => ({
        async run() {
          return state;
        },
      }),
    });

    await expect(runtime.run_once()).resolves.toBe(state);

    expect(JSON.parse(fs.readFileSync(get_run_state_path(work_dir), "utf-8"))).toMatchObject({
      status: "stopped",
      last_error: null,
    });
    expect(fs.readFileSync(get_runtime_log_path(work_dir), "utf-8")).toContain(
      "清理轮次 worktree 失败: Error: cleanup failed",
    );
  });

  test("worktree exposes child agents through the agents mount", async () => {
    const work_dir = create_workspace("agent-runtime-worktree-agents");
    create_child_agent(work_dir);
    const state = create_valid_loop_state(work_dir);
    state.next_action = "stop";
    let saw_child_config = false;
    const runtime = new AgentRuntime(work_dir, true, {
      work_order_factory: () => create_fake_work_orders(),
      turn_runner_factory: (dir) => ({
        async run() {
          saw_child_config = fs.existsSync(
            path.join(dir, "agents", "child-agent", ".loong", "runtime", "config.json"),
          );
          return state;
        },
      }),
    });

    await runtime.run_once();

    expect(saw_child_config).toBe(true);
  });
});
