import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { clear } from "../../src/commands/clear.js";
import {
  build_learned_template,
  build_world_model_template,
} from "../../src/commands/workspace-template.js";
import {
  create_child_agent,
  create_temp_dir,
  create_workspace,
  write_file,
  write_human_request,
  write_inbox_work_order,
  write_outbox_work_order,
  write_turn_log,
  write_turn_plan,
} from "../helpers/workspace.js";

function read_codex_config(work_dir: string): Record<string, string> {
  return fs
    .readFileSync(path.join(work_dir, ".codex", "config.toml"), "utf-8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .reduce<Record<string, string>>((config, line) => {
      const [raw_key, raw_value] = line.split("=", 2);
      if (!raw_key || raw_value === undefined) return config;
      config[raw_key.trim()] = raw_value.trim().replace(/^"|"$/g, "");
      return config;
    }, {});
}

describe("clear", () => {
  test("resets runtime output for the current workspace and child agents", () => {
    const work_dir = create_workspace("clear-recursive");
    const child_dir = create_child_agent(work_dir, "engineering-team");
    const nested_child_dir = create_child_agent(child_dir, "backend-team");

    const root_agents_doc = seed_agent_files(work_dir);
    const child_agents_doc = seed_agent_files(child_dir);
    const nested_agents_doc = seed_agent_files(nested_child_dir);
    const root_config = read_config(work_dir);
    const child_config = read_config(child_dir);
    const nested_config = read_config(nested_child_dir);

    seed_runtime_output(work_dir);
    seed_runtime_output(child_dir);
    seed_runtime_output(nested_child_dir);

    const result = clear(work_dir);

    expect(result.cleaned_workspaces).toEqual([
      ".",
      "agents/engineering-team",
      "agents/engineering-team/agents/backend-team",
    ]);
    expect_workspace_reset(work_dir, root_config, root_agents_doc);
    expect_workspace_reset(child_dir, child_config, child_agents_doc);
    expect_workspace_reset(nested_child_dir, nested_config, nested_agents_doc);
  });

  test("rejects a directory that is not a loong workspace", () => {
    const work_dir = create_temp_dir("clear-invalid");

    expect(() => clear(work_dir)).toThrow("当前目录不是 loong 工作区，缺少 .loong 目录。");
  });
});

function seed_runtime_output(work_dir: string) {
  write_turn_plan(work_dir);
  write_turn_log(work_dir);
  write_outbox_work_order(work_dir);
  write_inbox_work_order(work_dir);
  write_human_request(work_dir);
  write_file(path.join(work_dir, ".loong", "work-orders", "inbox", "order", "input", "a.md"), "a");
  write_file(path.join(work_dir, ".loong", "runtime", "state-log.jsonl"), '{"state":true}\n');
  write_file(
    path.join(work_dir, ".loong", "runtime", "state.json"),
    '{"status":"active","started_at":"2026-04-22T08:00:00.000Z"}\n',
  );
  write_file(path.join(work_dir, ".loong", "runtime", "turn-events.jsonl"), '{"event":true}\n');
  write_file(path.join(work_dir, ".loong", "runtime", "log.txt"), "runtime log\n");
  write_file(path.join(work_dir, ".loong", "runtime", "transient.json"), "{}\n");
  write_file(path.join(work_dir, ".loong", "turn-results", "000001-state.json"), "{}\n");
  write_file(path.join(work_dir, ".loong", "memory", "world-model.md"), "# changed\n");
  write_file(path.join(work_dir, ".loong", "memory", "learned.md"), "# changed\n");
  write_file(path.join(work_dir, ".loong", "memory", "extra.md"), "# extra\n");
}

function seed_agent_files(work_dir: string): string {
  const content = `# ${path.basename(work_dir)}\n`;
  write_file(path.join(work_dir, "AGENTS.md"), content);
  return content;
}

function read_config(work_dir: string): string {
  return fs.readFileSync(path.join(work_dir, ".loong", "runtime", "config.json"), "utf-8");
}

function expect_workspace_reset(work_dir: string, config: string, agents_doc: string) {
  expect(read_config(work_dir)).toBe(config);
  expect(fs.readFileSync(path.join(work_dir, "AGENTS.md"), "utf-8")).toBe(agents_doc);
  expect(read_codex_config(work_dir)).toMatchObject({
    sandbox_mode: "danger-full-access",
    approval_policy: "never",
  });
  expect_empty_dir(path.join(work_dir, ".loong", "human-requests"));
  expect_empty_dir(path.join(work_dir, ".loong", "turn-results"));
  expect_empty_dir(path.join(work_dir, ".loong", "work-plans"));
  expect_empty_dir(path.join(work_dir, ".loong", "work-logs"));
  expect_empty_dir(path.join(work_dir, ".loong", "work-orders", "inbox"));
  expect_empty_dir(path.join(work_dir, ".loong", "work-orders", "outbox"));
  expect(fs.readdirSync(path.join(work_dir, ".loong", "runtime")).sort()).toEqual([
    "config.json",
    "log.txt",
    "state-log.jsonl",
    "state.json",
    "turn-events.jsonl",
  ]);
  expect(
    JSON.parse(fs.readFileSync(path.join(work_dir, ".loong", "runtime", "state.json"), "utf-8")),
  ).toMatchObject({
    status: "stopped",
    started_at: null,
    ended_at: null,
    latest_turn_id: null,
    latest_summary: null,
  });
  expect(
    fs.readFileSync(path.join(work_dir, ".loong", "runtime", "state-log.jsonl"), "utf-8"),
  ).toBe("");
  expect(
    fs.readFileSync(path.join(work_dir, ".loong", "runtime", "turn-events.jsonl"), "utf-8"),
  ).toBe("");
  expect(fs.readFileSync(path.join(work_dir, ".loong", "runtime", "log.txt"), "utf-8")).toBe("");
  expect(fs.readdirSync(path.join(work_dir, ".loong", "memory")).sort()).toEqual([
    "learned.md",
    "world-model.md",
  ]);
  expect(fs.readFileSync(path.join(work_dir, ".loong", "memory", "world-model.md"), "utf-8")).toBe(
    build_world_model_template(),
  );
  expect(fs.readFileSync(path.join(work_dir, ".loong", "memory", "learned.md"), "utf-8")).toBe(
    build_learned_template(),
  );
}

function expect_empty_dir(dir_path: string) {
  expect(fs.readdirSync(dir_path)).toEqual([]);
}
