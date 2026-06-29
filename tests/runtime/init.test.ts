import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { init } from "../../src/commands/init.js";
import { create_temp_dir, write_file } from "../helpers/workspace.js";

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

describe("init", () => {
  test("initializes a minimal workspace in an empty directory", () => {
    const work_dir = create_temp_dir("init-success");

    const result = init(work_dir);

    expect(result.created_dirs).toEqual(
      expect.arrayContaining([
        "agents",
        ".codex",
        ".loong",
        ".loong/runtime",
        ".loong/turn-results",
        ".loong/memory",
        ".loong/human-requests",
        ".loong/work-orders/outbox",
      ]),
    );
    expect(result.created_files).toEqual(
      expect.arrayContaining([
        "AGENTS.md",
        ".codex/config.toml",
        ".loong/runtime/config.json",
        ".loong/runtime/state.json",
        ".loong/runtime/state-log.jsonl",
        ".loong/runtime/turn-events.jsonl",
        ".loong/runtime/log.txt",
        ".loong/memory/world-model.md",
        ".loong/memory/learned.md",
      ]),
    );
    expect(fs.existsSync(path.join(work_dir, ".loong", ".system-log.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(work_dir, ".loong", ".config.json"))).toBe(false);
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
      JSON.parse(fs.readFileSync(path.join(work_dir, ".loong", "runtime", "config.json"), "utf-8")),
    ).toMatchObject({
      position: path.basename(work_dir),
      sort_index: 0,
      never_stop: false,
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(work_dir, ".loong", "runtime", "config.json"), "utf-8"))
        .name,
    ).toMatch(/^[\u4e00-\u9fa5]{2,4}$/);
    expect(read_codex_config(work_dir)).toMatchObject({
      sandbox_mode: "danger-full-access",
      approval_policy: "never",
    });
    expect(fs.readFileSync(path.join(work_dir, ".gitignore"), "utf-8")).toBe(
      "/agents/\n/.worktree/\n",
    );
    expect(fs.existsSync(path.join(work_dir, ".git"))).toBe(true);
    expect(git(work_dir, ["log", "--format=%s", "--max-count=1"])).toBe("loong initial workspace");
    expect(git(work_dir, ["status", "--short"])).toBe("");
  });

  test("rejects initialization in a non-empty directory", () => {
    const work_dir = create_temp_dir("init-fail");
    write_file(path.join(work_dir, "existing.txt"), "occupied");

    expect(() => init(work_dir)).toThrow(
      "当前目录非空，不能执行 init。请在不存在或空目录中初始化。",
    );
  });

  test("initializes an organization tree from an org file", () => {
    const config_dir = create_temp_dir("init-org-config");
    const org_file = path.join(config_dir, "organization.json");
    write_file(
      org_file,
      `${JSON.stringify(
        {
          name: "程远",
          position: "在线课程事业部总经理",
          "folder-name": "online-course-business",
          description: "负责统筹 AI 在线课程业务。",
          sort_index: 10,
          children: [
            {
              name: "夏研",
              position: "市场研究经理",
              "folder-name": "market-research",
              description: "负责持续发现在线课程候选机会。",
              sort_index: 20,
              children: [
                {
                  name: "罗寻",
                  position: "市场调研专员",
                  "folder-name": "opportunity-discovery",
                  description: "负责发散发现在线课程候选机会。",
                  children: [],
                },
              ],
            },
            {
              name: "沈长风",
              position: "增长运营经理",
              "folder-name": "growth-operations",
              description: "负责已发布课程的获客运营。",
              children: [],
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const work_dir = create_temp_dir("init-org-success");

    const result = init(work_dir, { org_file });

    expect(result.created_files).toEqual(
      expect.arrayContaining([
        "online-course-business/.loong/runtime/config.json",
        "online-course-business/agents/market-research/.loong/runtime/config.json",
        "online-course-business/agents/market-research/agents/opportunity-discovery/.loong/runtime/config.json",
        "online-course-business/agents/growth-operations/.loong/runtime/config.json",
      ]),
    );
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(work_dir, "online-course-business", ".loong", "runtime", "config.json"),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "程远",
      position: "在线课程事业部总经理",
      description: "负责统筹 AI 在线课程业务。",
      sort_index: 10,
      never_stop: false,
    });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(
            work_dir,
            "online-course-business",
            "agents",
            "market-research",
            ".loong",
            "runtime",
            "config.json",
          ),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "夏研",
      position: "市场研究经理",
      description: "负责持续发现在线课程候选机会。",
      sort_index: 20,
    });
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(
            work_dir,
            "online-course-business",
            "agents",
            "market-research",
            "agents",
            "opportunity-discovery",
            ".loong",
            "runtime",
            "config.json",
          ),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "罗寻",
      position: "市场调研专员",
      sort_index: 0,
    });
    expect(
      fs.existsSync(
        path.join(work_dir, "online-course-business", "agents", "growth-operations", ".loong"),
      ),
    ).toBe(true);
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(
            work_dir,
            "online-course-business",
            "agents",
            "growth-operations",
            ".loong",
            "runtime",
            "config.json",
          ),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "沈长风",
      sort_index: 1,
    });
    expect(
      git(path.join(work_dir, "online-course-business"), ["log", "--format=%s", "--max-count=1"]),
    ).toBe("loong initial workspace");
    expect(git(path.join(work_dir, "online-course-business"), ["status", "--short"])).toBe("");
    expect(
      git(path.join(work_dir, "online-course-business", "agents", "market-research"), [
        "log",
        "--format=%s",
        "--max-count=1",
      ]),
    ).toBe("loong initial workspace");
  });

  test("rejects org files with unsafe folder names", () => {
    const config_dir = create_temp_dir("init-org-invalid-config");
    const org_file = path.join(config_dir, "organization.json");
    write_file(
      org_file,
      `${JSON.stringify({
        name: "程远",
        position: "负责人",
        "folder-name": "root",
        description: "负责统筹。",
        children: [
          {
            name: "夏研",
            position: "市场研究经理",
            "folder-name": "../market",
            description: "负责市场研究。",
            children: [],
          },
        ],
      })}\n`,
    );
    const work_dir = create_temp_dir("init-org-invalid");

    expect(() => init(work_dir, { org_file })).toThrow(
      '组织文件 root.children[0] 的 "folder-name" 不是有效目录名：../market',
    );
  });
});
