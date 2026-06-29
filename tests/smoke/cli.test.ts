import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { run_cli } from "../helpers/cli.js";
import { create_temp_dir, write_file } from "../helpers/workspace.js";

describe("CLI smoke", () => {
  test("loong init initializes a workspace from the actual CLI entry", () => {
    const work_dir = create_temp_dir("cli-init");

    const result = run_cli(["init"], { cwd: work_dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("loong 工作区初始化完成。");
    expect(fs.existsSync(path.join(work_dir, ".loong", "memory", "world-model.md"))).toBe(true);
    expect(fs.existsSync(path.join(work_dir, ".codex", "config.toml"))).toBe(true);
  }, 20000);

  test("loong init --org-file initializes an organization tree from the actual CLI entry", () => {
    const config_dir = create_temp_dir("cli-init-org-config");
    const org_file = path.join(config_dir, "organization.json");
    write_file(
      org_file,
      `${JSON.stringify({
        name: "程远",
        position: "在线课程事业部总经理",
        "folder-name": "online-course-business",
        description: "负责统筹 AI 在线课程业务。",
        children: [
          {
            name: "夏研",
            position: "市场研究经理",
            "folder-name": "market-research",
            description: "负责持续发现在线课程候选机会。",
            children: [],
          },
        ],
      })}\n`,
    );
    const work_dir = create_temp_dir("cli-init-org");

    const result = run_cli(["init", "--org-file", org_file], { cwd: work_dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("loong 工作区初始化完成。");
    expect(
      JSON.parse(
        fs.readFileSync(
          path.join(
            work_dir,
            "online-course-business",
            ".loong",
            "runtime",
            "config.json",
          ),
          "utf-8",
        ),
      ),
    ).toMatchObject({
      name: "程远",
      position: "在线课程事业部总经理",
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
    });
  });

  test("loong init returns a non-zero exit code in a non-empty directory", () => {
    const work_dir = create_temp_dir("cli-init-fail");
    write_file(path.join(work_dir, "occupied.txt"), "occupied");

    const result = run_cli(["init"], { cwd: work_dir });

    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain("初始化失败");
  });

  test("loong --help exposes the available commands", () => {
    const work_dir = create_temp_dir("cli-help");

    const result = run_cli(["--help"], { cwd: work_dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("clear");
    expect(result.stdout).not.toContain("daemon");
    expect(result.stdout).toContain("init");
    expect(result.stdout).toContain("在当前空目录初始化最小 loong 节点工作区");
    expect(result.stdout).toContain("observe");
    expect(result.stdout).toContain("run");
    expect(result.stdout).toContain("stop");
  });

  test("loong run --help shows run options", () => {
    const work_dir = create_temp_dir("cli-run-help");

    const result = run_cli(["run", "--help"], { cwd: work_dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("--daemon");
    expect(result.stdout).toContain("--once");
    expect(result.stdout).not.toContain("--no-observe");
    expect(result.stdout).toContain("--root-dir");
    expect(result.stdout).not.toContain("--foreground");
  });

  test("loong observe --once renders a dashboard snapshot", () => {
    const work_dir = create_temp_dir("cli-observe");
    run_cli(["init"], { cwd: work_dir });

    const result = run_cli(["observe", "--once"], { cwd: work_dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("loong observe");
    expect(result.stdout).toContain("未启动");
    expect(result.stdout).toContain("代理树");
  }, 10000);

  test("loong clear resets runtime output from the actual CLI entry", () => {
    const work_dir = create_temp_dir("cli-clear");
    run_cli(["init"], { cwd: work_dir });
    write_file(path.join(work_dir, ".loong", "runtime", "log.txt"), "runtime log\n");
    write_file(path.join(work_dir, ".loong", "work-logs", "000001-log.md"), "# log\n");
    write_file(path.join(work_dir, ".loong", "memory", "learned.md"), "# changed\n");

    const result = run_cli(["clear"], { cwd: work_dir });

    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain("loong 运行时输出已清理。");
    expect(fs.readFileSync(path.join(work_dir, ".loong", "runtime", "log.txt"), "utf-8")).toBe("");
    expect(fs.readdirSync(path.join(work_dir, ".loong", "work-logs"))).toEqual([]);
    expect(
      fs.readFileSync(path.join(work_dir, ".loong", "memory", "learned.md"), "utf-8"),
    ).toContain("# 经验沉淀");
  }, 10000);
});
