import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { create_daemon_manager, get_daemon_record_path } from "../../src/runtime/daemon.js";
import { create_agent_run_state_store, read_agent_run_state } from "../../src/runtime/run-state.js";
import { collect_webui_snapshot } from "../../src/webui/server/snapshot.js";
import { create_child_agent, create_workspace } from "../helpers/workspace.js";

describe("daemon manager", () => {
  test("marks stale daemon records as stopped", () => {
    const work_dir = create_workspace("daemon-stale");
    const manager = create_daemon_manager(work_dir);
    manager.write_record({
      pid: 999999,
      root_dir: work_dir,
      status: "running",
      started_at: "2026-04-22T08:00:00.000Z",
      updated_at: "2026-04-22T08:00:00.000Z",
      command: "node",
      args: [],
      active_since: "2026-04-22T08:00:00.000Z",
      stopped_at: null,
      accumulated_run_ms: 0,
    });

    const stopped = manager.stop();
    const record = JSON.parse(fs.readFileSync(get_daemon_record_path(work_dir), "utf-8")) as {
      status: string;
    };

    expect(stopped).toBe(false);
    expect(record.status).toBe("stopped");
  });

  test("stopping the daemon clears live agent run states", () => {
    const work_dir = create_workspace("daemon-stop-agent-states");
    const child_dir = create_child_agent(work_dir, "child-agent");
    const nested_child_dir = create_child_agent(child_dir, "nested-agent");
    create_agent_run_state_store(work_dir).mark_sleep(null, 3600);
    create_agent_run_state_store(child_dir).mark_active(
      "000001",
      path.join(child_dir, ".worktree", "000001-live"),
    );
    create_agent_run_state_store(nested_child_dir).mark_failed(new Error("boom"));
    const manager = create_daemon_manager(work_dir);
    manager.write_record({
      pid: 999999,
      root_dir: work_dir,
      status: "running",
      started_at: "2026-04-22T08:00:00.000Z",
      updated_at: "2026-04-22T08:00:00.000Z",
      command: "node",
      args: [],
      active_since: "2026-04-22T08:00:00.000Z",
      stopped_at: null,
      accumulated_run_ms: 0,
    });

    manager.stop();

    expect(read_agent_run_state(work_dir)).toMatchObject({
      status: "stopped",
      sleep_until: null,
      active_turn: null,
    });
    expect(read_agent_run_state(child_dir)).toMatchObject({
      status: "stopped",
      sleep_until: null,
      active_turn: null,
    });
    expect(read_agent_run_state(nested_child_dir)?.status).toBe("failed");
  });

  test("accumulates daemon run time when the daemon stops", () => {
    const work_dir = create_workspace("daemon-runtime-stop");
    const active_since = new Date(Date.now() - 2_000).toISOString();
    const manager = create_daemon_manager(work_dir);
    manager.write_record({
      pid: process.pid,
      root_dir: work_dir,
      status: "running",
      started_at: active_since,
      updated_at: active_since,
      command: "node",
      args: [],
      active_since,
      stopped_at: null,
      accumulated_run_ms: 1_000,
    });

    manager.mark_stopped();

    const record = manager.read_snapshot();
    expect(record?.status).toBe("stopped");
    expect(record?.active_since).toBeNull();
    expect(record?.stopped_at).toEqual(expect.any(String));
    expect(record?.accumulated_run_ms).toBeGreaterThanOrEqual(2_500);
    expect(record?.elapsed_run_ms).toBe(record?.accumulated_run_ms);
  });

  test("webui snapshot exposes daemon elapsed run time", () => {
    const work_dir = create_workspace("daemon-webui-snapshot");
    const active_since = new Date(Date.now() - 5_000).toISOString();
    create_daemon_manager(work_dir).write_record({
      pid: process.pid,
      root_dir: work_dir,
      status: "running",
      started_at: active_since,
      updated_at: active_since,
      command: "node",
      args: [],
      active_since,
      stopped_at: null,
      accumulated_run_ms: 2_000,
    });

    const snapshot = collect_webui_snapshot(work_dir);

    expect(snapshot.dashboard.daemon?.status).toBe("running");
    expect(snapshot.dashboard.daemon?.elapsed_run_ms).toBeGreaterThanOrEqual(6_000);
  });
});
