import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { load_current_agent_name } from "../../src/agent/agent.js";
import { init } from "../../src/commands/init.js";
import { LoopStateValidator } from "../../src/runtime/state.js";
import { create_execution_turn_context } from "../../src/runtime/turn-context.js";
import {
  create_child_agent,
  create_valid_loop_state,
  create_workspace,
  write_completion_report,
  write_file,
  write_human_request,
  write_inbox_work_order,
  write_outbox_work_order,
} from "../helpers/workspace.js";

type ValidationSection = {
  target: string;
  messages: string[];
};

function parse_validation_error(error: string | null): ValidationSection[] {
  expect(error).not.toBeNull();
  const sections: ValidationSection[] = [];
  let current: ValidationSection | null = null;
  for (const line of (error ?? "").split(/\r?\n/)) {
    const section_match = line.match(/^## (.+) 存在如下问题$/);
    if (section_match?.[1]) {
      current = {
        target: section_match[1],
        messages: [],
      };
      sections.push(current);
      continue;
    }
    if (line.startsWith("- ") && current) {
      current.messages.push(line.slice(2));
    }
  }
  return sections;
}

function expect_validation_issue(
  error: string | null,
  target: string,
  patterns: Array<string | RegExp>,
): void {
  const section = parse_validation_error(error).find((item) => item.target === target);
  expect(section, `expected validation issue for ${target}`).toBeDefined();
  for (const pattern of patterns) {
    expect(
      section?.messages.some((message) =>
        typeof pattern === "string" ? message.includes(pattern) : pattern.test(message),
      ),
      `expected ${target} to include ${String(pattern)}`,
    ).toBe(true);
  }
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

function commit_workspace(work_dir: string): void {
  git(work_dir, ["add", "-A"]);
  git(work_dir, [
    "-c",
    "user.name=loong",
    "-c",
    "user.email=loong@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "test checkpoint",
  ]);
}

function create_planless_loop_state(work_dir: string) {
  const state = create_valid_loop_state(work_dir);
  fs.rmSync(path.join(work_dir, state.plan), { force: true });
  state.plan = "";
  return state;
}

describe("LoopStateValidator", () => {
  test("accepts a valid loop state", () => {
    const work_dir = create_workspace("state-valid");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    expect(validator.validate(state, "000001")).toBeNull();
  });

  test("accepts planless work check and repair loop states", () => {
    const target_work_order_path = ".loong/work-orders/inbox/20260421T000000-order-1";
    for (const turn_type of ["work_check", "repair"] as const) {
      const work_dir = create_workspace(`state-${turn_type}-planless`);
      write_inbox_work_order(work_dir);
      write_completion_report(work_dir, {
        box: "inbox",
        check_status: "pending",
      });
      commit_workspace(work_dir);
      const state = create_planless_loop_state(work_dir);
      if (turn_type === "work_check") {
        write_file(
          path.join(work_dir, ...target_work_order_path.split("/"), "work-check.md"),
          `---
open_issue_count: 0
---

# 工作检查报告

## 工作检查轮次 000001

本轮未发现未修复问题。
`,
        );
      }
      const validator = new LoopStateValidator(work_dir, false, {
        turn_type,
        target_work_order_path,
      });

      expect(validator.validate(state, "000001")).toBeNull();
    }
  });

  test("rejects plan files from work check and repair turns", () => {
    const target_work_order_path = ".loong/work-orders/inbox/20260421T000000-order-1";
    for (const turn_type of ["work_check", "repair"] as const) {
      const work_dir = create_workspace(`state-${turn_type}-with-plan`);
      write_inbox_work_order(work_dir);
      write_completion_report(work_dir, {
        box: "inbox",
        check_status: "pending",
      });
      commit_workspace(work_dir);
      const state = create_valid_loop_state(work_dir);
      if (turn_type === "work_check") {
        write_file(
          path.join(work_dir, ...target_work_order_path.split("/"), "work-check.md"),
          `---
open_issue_count: 0
---

# 工作检查报告

## 工作检查轮次 000001

本轮未发现未修复问题。
`,
        );
      }
      const validator = new LoopStateValidator(work_dir, false, {
        turn_type,
        target_work_order_path,
      });
      const error = validator.validate(state, "000001");

      expect_validation_issue(error, '字段 "plan"', [/空字符串/]);
      expect_validation_issue(error, ".loong/work-plans", [/不应创建工作计划文件/]);
    }
  });

  test("rejects duplicated delegated work orders", () => {
    const work_dir = create_workspace("state-duplicate");
    create_child_agent(work_dir);
    const delegated_work_order = write_outbox_work_order(work_dir);
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    state.delegated_work_orders = [delegated_work_order, delegated_work_order];

    expect_validation_issue(validator.validate(state, "000001"), delegated_work_order, [
      /delegated_work_orders/,
      /重复路径/,
    ]);
  });

  test("accepts YAML timestamp frontmatter dates", () => {
    const work_dir = create_workspace("state-yaml-timestamp");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    write_file(
      path.join(work_dir, state.log),
      `---
turn_id: "000001"
created_at: 2026-04-21T00:00:00.000Z
---

# 工作日志

## 本轮动作
执行了测试准备。

## 验证
日志时间可由 YAML 解析为 Date。

## 问题与风险
当前无额外风险。
`,
    );

    expect(validator.validate(state, "000001")).toBeNull();
  });

  test("rejects stop when active outbox work orders still exist", () => {
    const work_dir = create_workspace("state-active-outbox");
    const active_order = write_outbox_work_order(work_dir);
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    state.next_action = "stop";

    expect_validation_issue(validator.validate(state, "000001"), "当前返回结果", [
      /不能停止/,
      active_order,
    ]);
  });

  test("rejects stop for a root node configured to never stop", () => {
    const work_dir = create_workspace("state-root-never-stop");
    write_file(
      path.join(work_dir, ".loong", "runtime", "config.json"),
      `${JSON.stringify(
        {
          name: "root",
          description: "test root",
          never_stop: true,
        },
        null,
        2,
      )}\n`,
    );
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir, true);

    state.next_action = "stop";

    expect_validation_issue(validator.validate(state, "000001"), "当前返回结果", [
      /never_stop=true/,
      /不能返回 next_action="stop"/,
    ]);
  });

  test("rejects stop for a child node with unfinished inbox work orders", () => {
    const parent_dir = create_workspace("state-parent");
    const child_dir = path.join(parent_dir, "agents", "worker");
    init(child_dir);
    const inbox_order = write_inbox_work_order(child_dir);
    const state = create_valid_loop_state(child_dir);
    const validator = new LoopStateValidator(child_dir, false);

    state.next_action = "stop";

    expect_validation_issue(validator.validate(state, "000001"), "当前返回结果", [
      /completion-report\.md/,
      /不能停止/,
      inbox_order,
    ]);
  });

  test("rejects completion reports without output deliverables", () => {
    const work_dir = create_workspace("state-missing-output");
    write_inbox_work_order(work_dir);
    write_completion_report(work_dir, {
      box: "inbox",
      with_output: false,
    });
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    const report_path = ".loong/work-orders/inbox/20260421T000000-order-1/completion-report.md";

    expect_validation_issue(validator.validate(state, "000001"), report_path, [/output/, /交付物/]);
  });

  test("rejects plan and log paths outside the workspace", () => {
    const work_dir = create_workspace("state-paths");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    state.plan = "../outside-plan.json";
    state.log = "/absolute-log.md";

    const error = validator.validate(state, "000001");
    expect_validation_issue(error, '字段 "plan"', [/相对路径/, /\.\.\/outside-plan\.json/]);
    expect_validation_issue(error, '字段 "log"', [/相对路径/, /absolute-log\.md/]);
  });

  test("rejects invalid plan JSON and unfinished plan steps", () => {
    const work_dir = create_workspace("state-plan-invalid");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    write_file(path.join(work_dir, state.plan), "not json");

    expect_validation_issue(validator.validate(state, "000001"), state.plan, [/JSON/]);

    write_file(
      path.join(work_dir, state.plan),
      `${JSON.stringify(
        {
          turn_id: "000001",
          created_at: "2026-04-21T00:00:00.000Z",
          plans: [
            {
              description: "尚未完成的步骤",
              status: "pending",
            },
          ],
        },
        null,
        2,
      )}\n`,
    );

    expect_validation_issue(validator.validate(state, "000001"), state.plan, [
      /completed/,
      /cancelled/,
    ]);
  });

  test("rejects work logs missing required headings", () => {
    const work_dir = create_workspace("state-log-heading");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    write_file(
      path.join(work_dir, state.log),
      `---
turn_id: "000001"
created_at: "2026-04-21T00:00:00.000Z"
---

# 其它标题
`,
    );

    expect_validation_issue(validator.validate(state, "000001"), state.log, [
      "# 工作日志",
      "## 本轮动作",
      "## 验证",
      "## 问题与风险",
    ]);
  });

  test("rejects multiple plan or log files for the same turn", () => {
    const work_dir = create_workspace("state-duplicate-turn-files");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    write_file(
      path.join(work_dir, ".loong", "work-plans", "000001-20260421T000001-plan.json"),
      "{}\n",
    );
    write_file(
      path.join(work_dir, ".loong", "work-logs", "000001-20260421T000001-log.md"),
      "# duplicate\n",
    );

    const error = validator.validate(state, "000001");

    expect_validation_issue(error, ".loong/work-plans", [/只能有一个/, /000001/]);
    expect_validation_issue(error, ".loong/work-logs", [/只能有一个/, /000001/]);
  });

  test("rejects missing memory files", () => {
    const work_dir = create_workspace("state-memory-missing");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    fs.rmSync(path.join(work_dir, ".loong", "memory", "world-model.md"));

    expect_validation_issue(validator.validate(state, "000001"), ".loong/memory/world-model.md", [
      /记忆文件不存在/,
    ]);
  });

  test("rejects delegated work orders with invalid path or content", () => {
    const work_dir = create_workspace("state-delegated-invalid");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    const invalid_path = ".loong/work-orders/inbox/20260421T000000-order-1/work-order.md";
    write_inbox_work_order(work_dir);
    const invalid_order = write_outbox_work_order(work_dir, {
      order_dir_name: "20260421T000001-order-2",
      turn_id: "000000",
      delegator: "",
      executor: "",
      summary: "",
    });

    state.delegated_work_orders = [invalid_path, invalid_order];

    const error = validator.validate(state, "000001");
    expect_validation_issue(error, invalid_path, [/outbox/, /work-order\.md/]);
    expect_validation_issue(error, invalid_order, [/turn_id/, /summary/, /delegator/, /executor/]);
  });

  test("rejects delegated work orders with a mismatched delegator", () => {
    const work_dir = create_workspace("state-delegated-delegator");
    create_child_agent(work_dir);
    const delegated_work_order = write_outbox_work_order(work_dir, {
      delegator: "other-agent",
    });
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    state.delegated_work_orders = [delegated_work_order];

    expect_validation_issue(validator.validate(state, "000001"), delegated_work_order, [
      /delegator/,
      /当前代理 name/,
    ]);
  });

  test("accepts delegated work orders with the short attachment heading", () => {
    const work_dir = create_workspace("state-delegated-short-attachment-heading");
    create_child_agent(work_dir);
    const delegated_work_order = write_outbox_work_order(work_dir);
    const absolute_path = path.join(work_dir, delegated_work_order);
    write_file(absolute_path, fs.readFileSync(absolute_path, "utf-8"));
    const state = create_valid_loop_state(work_dir);
    state.delegated_work_orders = [delegated_work_order];
    const validator = new LoopStateValidator(work_dir);

    expect(validator.validate(state, "000001")).toBeNull();
  });

  test("rejects delegated work orders with unknown executor or invalid directory name", () => {
    const work_dir = create_workspace("state-delegated-executor");
    create_child_agent(work_dir);
    const unknown_executor_order = write_outbox_work_order(work_dir, {
      order_dir_name: "20260421T000000-order-1",
      executor: "missing-agent",
    });
    const invalid_dir_order = write_outbox_work_order(work_dir, {
      order_dir_name: "bad-order-name",
      executor: "child-agent",
    });
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    state.delegated_work_orders = [unknown_executor_order, invalid_dir_order];

    const error = validator.validate(state, "000001");
    expect_validation_issue(error, unknown_executor_order, [/executor/, /子代理/]);
    expect_validation_issue(error, invalid_dir_order, [/目录名/]);
  });

  test("rejects invalid human request paths and content", () => {
    const work_dir = create_workspace("state-human-request-invalid");
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    const invalid_path = ".loong/work-logs/000001-20260421T000000-request-1.md";
    write_file(path.join(work_dir, invalid_path), "# invalid\n");
    const invalid_request = write_human_request(work_dir, {
      file_name: "20260421T000000-request-1.md",
      turn_id: "000000",
      status: "done",
      summary: "",
    });

    state.human_requests = [invalid_path, invalid_request, invalid_request];

    const error = validator.validate(state, "000001");
    expect_validation_issue(error, invalid_path, [/human-requests/]);
    expect_validation_issue(error, invalid_request, [
      /文件名必须符合/,
      /turn_id/,
      /status/,
      /summary/,
      /重复路径/,
    ]);
  });

  test("rejects stop when waiting human requests still exist", () => {
    const work_dir = create_workspace("state-human-request-waiting");
    const request_path = write_human_request(work_dir);
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    state.next_action = "stop";

    expect_validation_issue(validator.validate(state, "000001"), "当前返回结果", [
      /不能停止/,
      request_path,
    ]);
  });

  test("rejects completion reports missing required headings", () => {
    const work_dir = create_workspace("state-completion-heading");
    write_inbox_work_order(work_dir);
    write_completion_report(work_dir, {
      box: "inbox",
    });
    const report_path = ".loong/work-orders/inbox/20260421T000000-order-1/completion-report.md";
    write_file(
      path.join(work_dir, report_path),
      `---
turn_id: "000001"
created_at: "2026-04-21T00:00:00.000Z"
---

# 其它标题
`,
    );
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);

    expect_validation_issue(validator.validate(state, "000001"), report_path, [
      "# 完成报告",
      "## 完成情况",
      "## 交付物",
      "## 验收项对照",
      "## 验证记录",
    ]);
  });

  test("rejects completion reports with missing or mismatched delegator", () => {
    const work_dir = create_workspace("state-completion-delegator");
    write_inbox_work_order(work_dir, {
      delegator: "parent-agent",
    });
    write_completion_report(work_dir, {
      box: "inbox",
      delegator: "other-agent",
    });
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    const report_path = ".loong/work-orders/inbox/20260421T000000-order-1/completion-report.md";

    expect_validation_issue(validator.validate(state, "000001"), report_path, [
      /delegator/,
      /work-order\.md/,
    ]);

    write_file(
      path.join(work_dir, report_path),
      `---
turn_id: "000001"
created_at: "2026-04-21T00:00:00.000Z"
---

# 完成报告

## 完成情况
工作已经完成。

## 交付物
- output/result.md：测试交付物

## 验收项对照
- 补充完成报告：已满足

## 验证记录
- 冒烟检查：通过
`,
    );

    const missing_frontmatter_error = validator.validate(state, "000001");
    expect_validation_issue(missing_frontmatter_error, report_path, [/非空的 delegator/]);
    expect_validation_issue(missing_frontmatter_error, report_path, [/非空的 executor/]);
  });

  test("rejects completion reports with mismatched executor", () => {
    const work_dir = create_workspace("state-completion-executor");
    write_inbox_work_order(work_dir, {
      executor: "other-agent",
    });
    write_completion_report(work_dir, {
      box: "inbox",
      executor: load_current_agent_name(work_dir) ?? "unknown",
    });
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(work_dir);
    const report_path = ".loong/work-orders/inbox/20260421T000000-order-1/completion-report.md";

    expect_validation_issue(validator.validate(state, "000001"), report_path, [
      /executor/,
      /work-order\.md/,
    ]);

    write_completion_report(work_dir, {
      box: "inbox",
      executor: "other-agent",
    });

    expect_validation_issue(validator.validate(state, "000001"), report_path, [
      /executor/,
      /当前代理 name/,
    ]);
  });

  test("rejects completion reports written outside the bound target work order", () => {
    const work_dir = create_workspace("state-target-completion-report");
    write_inbox_work_order(work_dir, {
      order_dir_name: "20260421T000000-order-1",
    });
    write_inbox_work_order(work_dir, {
      order_dir_name: "20260421T000001-order-2",
    });
    write_completion_report(work_dir, {
      box: "inbox",
      order_dir_name: "20260421T000001-order-2",
      check_status: "pending",
    });
    const state = create_valid_loop_state(work_dir);
    const validator = new LoopStateValidator(
      work_dir,
      false,
      create_execution_turn_context(".loong/work-orders/inbox/20260421T000000-order-1"),
    );

    expect_validation_issue(validator.validate(state, "000001"), "完成报告变更", [
      /只能变更/,
      /20260421T000000-order-1\/completion-report\.md/,
      /20260421T000001-order-2\/completion-report\.md/,
    ]);
  });

  test("rejects work check reports whose open issue count differs from unresolved issues", () => {
    const work_dir = create_workspace("state-work-check-count");
    write_inbox_work_order(work_dir);
    write_completion_report(work_dir, {
      box: "inbox",
      check_status: "pending",
    });
    commit_workspace(work_dir);
    const state = create_planless_loop_state(work_dir);
    const order_dir = path.join(
      work_dir,
      ".loong",
      "work-orders",
      "inbox",
      "20260421T000000-order-1",
    );
    write_file(
      path.join(order_dir, "work-check.md"),
      `---
open_issue_count: 0
---

# 工作检查报告

## 工作检查轮次 000001

### Q1 交付物缺失

- 问题详情：缺少必要交付物。
- 状态：未修复
- 修复轮次：-
- 修复情况：待补充。
`,
    );
    const validator = new LoopStateValidator(work_dir, false, {
      turn_type: "work_check",
      target_work_order_path: ".loong/work-orders/inbox/20260421T000000-order-1",
    });

    expect_validation_issue(
      validator.validate(state, "000001"),
      ".loong/work-orders/inbox/20260421T000000-order-1/work-check.md",
      [/open_issue_count/, /未修复或待复查问题数=1/],
    );
  });

  test("accepts pending-review work check issues as open issues", () => {
    const work_dir = create_workspace("state-work-check-pending-review");
    write_inbox_work_order(work_dir);
    write_completion_report(work_dir, {
      box: "inbox",
      check_status: "pending",
    });
    commit_workspace(work_dir);
    const state = create_planless_loop_state(work_dir);
    const order_dir = path.join(
      work_dir,
      ".loong",
      "work-orders",
      "inbox",
      "20260421T000000-order-1",
    );
    write_file(
      path.join(order_dir, "work-check.md"),
      `---
open_issue_count: 1
---

# 工作检查报告

## 工作检查轮次 000001

### Q1 交付物缺失

- 问题详情：缺少必要交付物。
- 状态：待复查
- 修复轮次：000002
- 修复情况：已补充交付物，等待复查。
`,
    );
    const validator = new LoopStateValidator(work_dir, false, {
      turn_type: "work_check",
      target_work_order_path: ".loong/work-orders/inbox/20260421T000000-order-1",
    });

    expect(validator.validate(state, "000001")).toBeNull();
  });
});
