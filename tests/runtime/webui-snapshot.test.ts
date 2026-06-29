import path from "node:path";
import { describe, expect, test } from "vitest";
import { collect_webui_snapshot } from "../../src/webui/server/snapshot.js";
import { create_agent_run_state_store } from "../../src/runtime/run-state.js";
import {
  create_child_agent,
  create_workspace,
  write_file,
  write_inbox_work_order,
  write_turn_plan,
} from "../helpers/workspace.js";

describe("webui snapshot", () => {
  test("exposes each agent directory AGENTS.md as role instructions", () => {
    const work_dir = create_workspace("webui-snapshot-role-instruction");
    const child_dir = create_child_agent(work_dir, "child-agent");
    write_file(path.join(work_dir, "AGENTS.md"), "# Root Role\n\nRoot instructions.");
    write_file(path.join(child_dir, "AGENTS.md"), "# Child Role\n\nChild instructions.");

    const snapshot = collect_webui_snapshot(work_dir);
    const root_agent = snapshot.agents.find((agent) => agent.agent_path === ".");
    const child_agent = snapshot.agents.find((agent) => agent.agent_path === "agents/child-agent");

    expect(root_agent?.role_instruction?.relative_path).toBe("AGENTS.md");
    expect(root_agent?.role_instruction?.content).toContain("Root instructions.");
    expect(root_agent?.position).toBe(path.basename(work_dir));
    expect(root_agent?.sort_index).toBe(0);
    expect(child_agent?.role_instruction?.relative_path).toBe("agents/child-agent/AGENTS.md");
    expect(child_agent?.role_instruction?.content).toContain("Child instructions.");
    expect(child_agent?.position).toBe("child-agent");
    expect(child_agent?.sort_index).toBe(0);
  });

  test("orders sibling agents by sort_index", () => {
    const work_dir = create_workspace("webui-snapshot-sort-index");
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

    const snapshot = collect_webui_snapshot(work_dir);

    expect(snapshot.agents.map((agent) => agent.agent_path)).toEqual([
      ".",
      "agents/second-agent",
      "agents/first-agent",
    ]);
  });

  test("reads active turn artifacts from the execution worktree", () => {
    const work_dir = create_workspace("webui-snapshot-active-worktree");
    const turn_id = "000001";
    const execution_dir = path.join(work_dir, ".worktree", "000001-live");
    write_turn_plan(execution_dir, turn_id);
    write_inbox_work_order(execution_dir, { turn_id });
    create_agent_run_state_store(work_dir).mark_active(turn_id, execution_dir);
    write_file(
      path.join(execution_dir, ".loong", "runtime", "turn-events.jsonl"),
      `${JSON.stringify({
        type: "turn.started",
        recorded_at: "2026-04-21T10:11:12.000Z",
        context: { turn_id, attempt: 1 },
      })}\n`,
    );

    const snapshot = collect_webui_snapshot(work_dir);
    const root_agent = snapshot.agents.find((agent) => agent.agent_path === ".");

    expect(root_agent?.turns[0]?.plan?.items[0]?.description).toBe("执行测试步骤");
    expect(root_agent?.work_orders.inbox).toHaveLength(1);
    expect(root_agent?.work_orders.inbox[0]?.turn_id).toBe(turn_id);
  });
});
