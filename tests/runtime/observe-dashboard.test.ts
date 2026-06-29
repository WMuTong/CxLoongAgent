import path from "node:path";
import { describe, expect, test } from "vitest";
import { render_dashboard } from "../../src/observe/dashboard/index.js";
import { collect_dashboard_snapshot } from "../../src/observe/dashboard/snapshot.js";
import { create_daemon_manager } from "../../src/runtime/daemon.js";
import { create_agent_run_state_store } from "../../src/runtime/run-state.js";
import {
  create_child_agent,
  create_workspace,
  write_file,
  write_turn_plan,
} from "../helpers/workspace.js";

function write_running_daemon(work_dir: string): void {
  const now = "2026-04-21T10:00:00.000Z";
  create_daemon_manager(work_dir).write_record({
    pid: process.pid,
    root_dir: work_dir,
    status: "running",
    started_at: now,
    updated_at: now,
    command: "node",
    args: [],
    active_since: now,
    stopped_at: null,
    accumulated_run_ms: 0,
  });
}

describe("observe dashboard", () => {
  test("does not treat run state updates as agent activity", () => {
    const work_dir = create_workspace("observe-dashboard-no-activity");
    create_agent_run_state_store(work_dir).write_initial();

    const dashboard = collect_dashboard_snapshot(work_dir);

    expect(dashboard.agents[0].last_activity).toBe("-");
  });

  test("orders sibling agents by sort_index in the observe tree", () => {
    const work_dir = create_workspace("observe-dashboard-sort-index");
    const first_dir = create_child_agent(work_dir, "first-agent");
    const second_dir = create_child_agent(work_dir, "second-agent");
    write_file(
      path.join(first_dir, ".loong", "runtime", "config.json"),
      `${JSON.stringify({
        name: "first",
        position: "first",
        description: "first",
        sort_index: 20,
      })}\n`,
    );
    write_file(
      path.join(second_dir, ".loong", "runtime", "config.json"),
      `${JSON.stringify({
        name: "second",
        position: "second",
        description: "second",
        sort_index: 10,
      })}\n`,
    );

    const dashboard = collect_dashboard_snapshot(work_dir);

    expect(dashboard.agents.map((agent) => agent.tree_label)).toEqual([
      expect.any(String),
      "├─second",
      "└─first",
    ]);
  });

  test("renders active turn details from the execution worktree", () => {
    const work_dir = create_workspace("observe-dashboard-active-worktree");
    write_running_daemon(work_dir);
    const child_dir = create_child_agent(work_dir, "live-child");
    const turn_id = "000001";
    const execution_dir = path.join(child_dir, ".worktree", "000001-live");
    const plan = write_turn_plan(execution_dir, turn_id);
    const recorded_at = "2026-04-21T10:11:12.000Z";
    create_agent_run_state_store(child_dir).mark_active(turn_id, execution_dir);
    write_file(
      path.join(execution_dir, ".loong", "runtime", "turn-events.jsonl"),
      [
        JSON.stringify({
          type: "turn.started",
          recorded_at,
          context: { turn_id, attempt: 1 },
        }),
        JSON.stringify({
          type: "codex.event",
          recorded_at,
          context: { turn_id, attempt: 1 },
          event: {
            type: "item.completed",
            item: {
              id: "tool-1",
              type: "mcp_tool_call",
              server: "runtime",
              tool: "live_tool",
              status: "completed",
            },
          },
        }),
        JSON.stringify({
          type: "codex.event",
          recorded_at,
          context: { turn_id, attempt: 1 },
          event: {
            type: "item.completed",
            item: {
              id: "output-1",
              type: "agent_message",
              text: "worktree 实时输出",
            },
          },
        }),
        JSON.stringify({
          type: "state.ready",
          recorded_at,
          context: { turn_id, attempt: 1 },
          state: {
            turn_id,
            updated_at: recorded_at,
            plan,
            log: ".loong/work-logs/000001-20260421T000000-log.md",
            delegated_work_orders: [],
            human_requests: [],
            is_memory_updated: true,
            summary: "worktree 实时 summary",
            next_action: "continue",
            sleep_duration: 0,
          },
        }),
      ].join("\n"),
    );

    const dashboard = render_dashboard(work_dir);

    expect(dashboard).toContain("runtime.live_tool");
    expect(dashboard).toContain("worktree 实时输出");
    expect(dashboard).toContain("执行测试步骤");
  });

  test("projects live agent states as stopped when the daemon is not running", () => {
    const work_dir = create_workspace("observe-dashboard-stopped-daemon");
    const child_dir = create_child_agent(work_dir, "child-agent");
    create_agent_run_state_store(work_dir).mark_sleep(null, 90);
    create_agent_run_state_store(child_dir).mark_active(
      "000001",
      path.join(child_dir, ".worktree", "000001-live"),
    );

    const dashboard = collect_dashboard_snapshot(work_dir);
    const root_agent = dashboard.agents.find((agent) => agent.display_path === ".");
    const child_agent = dashboard.agents.find(
      (agent) => agent.display_path === "agents/child-agent",
    );

    expect(root_agent).toMatchObject({ status: "stopped", sleep_until: null });
    expect(child_agent).toMatchObject({ status: "stopped", sleep_until: null });
  });

  test("renders sleep remaining time, aligned timestamped details, and compact tool/file lists", () => {
    const work_dir = create_workspace("observe-dashboard");
    write_running_daemon(work_dir);
    const child_dir = create_child_agent(work_dir, "child-agent");
    const turn_id = "000001";
    const plan = write_turn_plan(work_dir, turn_id);
    const recorded_at = "2026-04-21T10:11:12.000Z";
    write_file(
      path.join(work_dir, plan),
      `${JSON.stringify({
        turn_id,
        created_at: recorded_at,
        plans: [
          {
            step: 1,
            description:
              "执行一段很长很长的计划描述，用于触发布局裁剪而不是换行，避免后续计划行被挤乱并保持状态列稳定对齐，尾部不应出现",
            status: "completed",
          },
        ],
      })}\n`,
    );

    const root_state = create_agent_run_state_store(work_dir);
    root_state.mark_active(turn_id);
    root_state.add_usage({
      input_tokens: 1000,
      cached_input_tokens: 400,
      output_tokens: 500,
      reasoning_output_tokens: 0,
    });
    const child_state = create_agent_run_state_store(child_dir);
    child_state.mark_sleep(null, 90);
    child_state.add_usage({
      input_tokens: 2000,
      cached_input_tokens: 800,
      output_tokens: 500,
      reasoning_output_tokens: 0,
    });
    write_file(
      path.join(work_dir, ".loong", "runtime", "turn-events.jsonl"),
      [
        JSON.stringify({
          type: "state.ready",
          recorded_at,
          context: { turn_id, attempt: 1 },
          state: {
            turn_id,
            updated_at: recorded_at,
            plan,
            log: ".loong/work-logs/000001-20260421T000000-log.md",
            delegated_work_orders: [],
            human_requests: [],
            is_memory_updated: true,
            summary: "完成 observe 测试准备。",
            next_action: "continue",
            sleep_duration: 0,
          },
        }),
        ...[1, 2, 3, 4].map((index) =>
          JSON.stringify({
            type: "codex.event",
            recorded_at,
            context: { turn_id, attempt: 1 },
            event: {
              type: "item.completed",
              item: {
                id: `tool-${index}`,
                type: "mcp_tool_call",
                server: "runtime",
                tool: `tool_${index}`,
                status: "completed",
              },
            },
          }),
        ),
        ...[1, 2, 3, 4].map((index) =>
          JSON.stringify({
            type: "codex.event",
            recorded_at,
            context: { turn_id, attempt: 1 },
            event: {
              type: "item.completed",
              item: {
                id: `file-${index}`,
                type: "file_change",
                status: "completed",
                changes: [{ path: `src/file-${index}.ts`, kind: "update" }],
              },
            },
          }),
        ),
        JSON.stringify({
          type: "codex.event",
          recorded_at,
          context: { turn_id, attempt: 1 },
          event: {
            type: "item.completed",
            item: {
              id: "output-1",
              type: "agent_message",
              text: "输出内容",
            },
          },
        }),
        JSON.stringify({
          type: "codex.event",
          recorded_at,
          context: { turn_id, attempt: 1 },
          event: {
            type: "turn.completed",
            usage: {
              input_tokens: 1000,
              cached_input_tokens: 400,
              output_tokens: 500,
              reasoning_output_tokens: 0,
            },
          },
        }),
        JSON.stringify({
          type: "codex.event",
          recorded_at: "2026-04-21T10:12:12.000Z",
          context: { turn_id: "999999", attempt: 7 },
          event: {
            type: "item.completed",
            item: {
              id: "stale-output",
              type: "agent_message",
              text: "不应显示的轮次输出",
            },
          },
        }),
      ].join("\n"),
    );

    const dashboard = render_dashboard(work_dir);

    expect(dashboard).toContain("剩 00:");
    expect(dashboard).toContain("Token");
    expect(dashboard).toContain("4k");
    expect(dashboard).toContain("1.5k");
    expect(dashboard).toContain("2.5k");
    expect(dashboard).toContain("缓存率 40%");
    expect(dashboard).toContain("本轮 Token 1.5k");
    expect(dashboard).toContain("本轮缓存率 40%");
    expect(dashboard).toContain("尝试 1");
    expect(dashboard).not.toContain("尝试 7");
    expect(dashboard).not.toContain("不应显示的轮次输出");
    expect(dashboard).toContain("工具 最近 3/4");
    expect(dashboard).toContain("文件 最近 3/4");
    expect(dashboard).not.toContain("runtime.tool_1");
    expect(dashboard).toContain("runtime.tool_4");
    expect(dashboard).not.toContain("src/file-1.ts");
    expect(dashboard).toContain("src/file-4.ts");
    const output_detail_index = dashboard.indexOf("输出 1", dashboard.indexOf("文件 最近 3/4"));
    expect(dashboard.indexOf("工具 最近 3/4")).toBeLessThan(dashboard.indexOf("文件 最近 3/4"));
    expect(dashboard.indexOf("文件 最近 3/4")).toBeLessThan(output_detail_index);
    expect(output_detail_index).toBeLessThan(dashboard.indexOf("计划 1"));
    expect(dashboard).toMatch(/工具 最近 3\/4\s+\d{2}:\d{2}:\d{2}\s+完成\s+runtime\.tool_2/);
    expect(dashboard).toMatch(/文件 最近 3\/4\s+\d{2}:\d{2}:\d{2}\s+完成\s+更新 src\/file-2\.ts/);
    expect(dashboard).toMatch(/输出 1\s+\d{2}:\d{2}:\d{2}\s+输出内容/);
    expect(dashboard).toContain("计划 1");
    expect(dashboard).not.toContain("尾部不应出现");
    expect(dashboard).not.toContain("摘要");
  });
});
