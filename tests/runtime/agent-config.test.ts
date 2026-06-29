import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  find_agent_config,
  load_agent_config,
  load_agent_configs,
  load_current_agent_name,
  load_current_agent_never_stop,
  load_parent_agent_config,
} from "../../src/agent/agent.js";
import { init } from "../../src/commands/init.js";
import { create_child_agent, create_workspace, write_file } from "../helpers/workspace.js";

describe("agent config", () => {
  test("loads and finds child agent configs", () => {
    const work_dir = create_workspace("agent-config");
    const child_dir = path.join(work_dir, "agents", "worker");
    init(child_dir);
    const child_config = load_agent_config(child_dir);

    expect(child_config).toMatchObject({
      position: "worker",
      description: "负责当前目录整体目标推进、监督与委派协调的节点",
      sort_index: 0,
      never_stop: false,
      dir: child_dir,
    });
    expect(child_config?.name).toMatch(/^[\u4e00-\u9fa5]{2,4}$/);
    expect(load_agent_configs(work_dir)).toHaveLength(1);
    expect(find_agent_config(work_dir, child_config?.name ?? "")).toMatchObject({
      name: child_config?.name,
      position: "worker",
      sort_index: 0,
      dir: child_dir,
    });
    expect(load_current_agent_name(child_dir)).toBe(child_config?.name);
    expect(load_current_agent_never_stop(child_dir)).toBe(false);
  });

  test("defaults optional config fields when they are missing", () => {
    const work_dir = create_workspace("agent-config-never-stop-default");
    write_file(
      path.join(work_dir, ".loong", "runtime", "config.json"),
      `${JSON.stringify(
        {
          name: "root",
          description: "test root",
        },
        null,
        2,
      )}\n`,
    );

    expect(load_agent_config(work_dir)).toMatchObject({
      name: "root",
      position: path.basename(work_dir),
      sort_index: 0,
      never_stop: false,
    });
    expect(load_current_agent_never_stop(work_dir)).toBe(false);
  });

  test("loads parent agent config from child and turn worktree paths", () => {
    const work_dir = create_workspace("agent-config-parent");
    const child_dir = create_child_agent(work_dir, "worker");
    const execution_dir = path.join(child_dir, ".worktree", "000001-test");
    write_file(path.join(execution_dir, ".gitkeep"), "");

    const parent_config = load_agent_config(work_dir);

    expect(load_parent_agent_config(work_dir)).toBeNull();
    expect(load_parent_agent_config(child_dir)).toMatchObject({
      name: parent_config?.name,
      position: parent_config?.position,
      description: parent_config?.description,
    });
    expect(load_parent_agent_config(execution_dir)).toMatchObject({
      name: parent_config?.name,
      position: parent_config?.position,
      description: parent_config?.description,
    });
  });

  test("ignores missing and invalid configs", () => {
    const work_dir = create_workspace("agent-config-invalid");
    const missing_config_dir = path.join(work_dir, "agents", "missing-config");
    const invalid_config_dir = path.join(work_dir, "agents", "invalid-config");
    write_file(path.join(missing_config_dir, "AGENTS.md"), "");
    write_file(path.join(invalid_config_dir, ".loong", "runtime", "config.json"), "{ invalid json");

    expect(load_agent_config(missing_config_dir)).toBeNull();
    expect(load_agent_config(invalid_config_dir)).toBeNull();
    expect(load_current_agent_name(missing_config_dir)).toBeNull();
    expect(load_agent_configs(work_dir)).toEqual([]);
    expect(find_agent_config(work_dir, "missing")).toBeNull();
  });

  test("sorts child agent configs by sort_index within the same level", () => {
    const work_dir = create_workspace("agent-config-sort-index");
    const early_dir = path.join(work_dir, "agents", "early");
    const middle_dir = path.join(work_dir, "agents", "middle");
    const late_dir = path.join(work_dir, "agents", "late");
    init(early_dir);
    init(middle_dir);
    init(late_dir);
    write_file(
      path.join(early_dir, ".loong", "runtime", "config.json"),
      `${JSON.stringify({
        name: "early",
        position: "early",
        description: "early",
        sort_index: -10,
      })}\n`,
    );
    write_file(
      path.join(middle_dir, ".loong", "runtime", "config.json"),
      `${JSON.stringify({
        name: "middle",
        position: "middle",
        description: "middle",
      })}\n`,
    );
    write_file(
      path.join(late_dir, ".loong", "runtime", "config.json"),
      `${JSON.stringify({
        name: "late",
        position: "late",
        description: "late",
        sort_index: 10,
      })}\n`,
    );

    expect(load_agent_configs(work_dir).map((config) => config.name)).toEqual([
      "early",
      "middle",
      "late",
    ]);
  });
});
