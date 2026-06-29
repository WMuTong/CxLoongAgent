import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll } from "vitest";
import { load_agent_configs, load_current_agent_name } from "../../src/agent/agent.js";
import { init } from "../../src/commands/init.js";
import type { LoopState } from "../../src/runtime/state.js";
import { parse_work_order } from "../../src/storage/doc.js";

const FIXED_TIMESTAMP = "2026-04-21T00:00:00.000Z";
const temp_dirs = new Set<string>();

afterAll(() => {
  for (const temp_dir of [...temp_dirs].reverse()) {
    fs.rmSync(temp_dir, { recursive: true, force: true });
  }
  temp_dirs.clear();
});

export function create_temp_dir(name: string): string {
  const temp_dir = fs.mkdtempSync(path.join(os.tmpdir(), `cx-loong-agent-${name}-`));
  temp_dirs.add(temp_dir);
  return temp_dir;
}

export function create_workspace(name: string): string {
  const work_dir = create_temp_dir(name);
  init(work_dir);
  return work_dir;
}

export function create_child_agent(work_dir: string, name = "child-agent"): string {
  const child_dir = path.join(work_dir, "agents", name);
  init(child_dir);
  return child_dir;
}

export function write_file(file_path: string, content: string) {
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  fs.writeFileSync(file_path, content, "utf-8");
}

export function write_turn_plan(work_dir: string, turn_id = "000001"): string {
  const relative_path = `.loong/work-plans/${turn_id}-20260421T000000-plan.json`;
  const absolute_path = path.join(work_dir, relative_path);
  write_file(
    absolute_path,
    `${JSON.stringify(
      {
        turn_id,
        created_at: FIXED_TIMESTAMP,
        plans: [
          {
            step: 1,
            description: "执行测试步骤",
            status: "completed",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return relative_path;
}

export function write_turn_log(work_dir: string, turn_id = "000001"): string {
  const relative_path = `.loong/work-logs/${turn_id}-20260421T000000-log.md`;
  const absolute_path = path.join(work_dir, relative_path);
  write_file(
    absolute_path,
    `---
turn_id: "${turn_id}"
created_at: "${FIXED_TIMESTAMP}"
---

# 工作日志

## 本轮动作
执行了测试准备。

## 委派的工作单
- 无

## 完成的工作单
- 无

## 验证
测试日志格式有效。

## 问题与风险
当前无额外风险。
`,
  );
  return relative_path;
}

export function write_outbox_work_order(
  work_dir: string,
  {
    order_dir_name = "20260421T000000-order-1",
    turn_id = "000001",
    delegator,
    executor,
    summary = "执行子任务",
  }: {
    order_dir_name?: string;
    turn_id?: string;
    delegator?: string;
    executor?: string;
    summary?: string;
  } = {},
): string {
  const relative_path = `.loong/work-orders/outbox/${order_dir_name}/work-order.md`;
  const absolute_path = path.join(work_dir, relative_path);
  const effective_delegator =
    delegator ?? load_current_agent_name(work_dir) ?? path.basename(work_dir);
  const effective_executor = executor ?? load_agent_configs(work_dir)[0]?.name ?? "child-agent";
  write_file(
    absolute_path,
    `---
turn_id: "${turn_id}"
summary: "${summary}"
delegator: "${effective_delegator}"
executor: "${effective_executor}"
created_at: "${FIXED_TIMESTAMP}"
---

# 工作单

## 背景
需要子代理处理一项工作。

## 目标
完成指定交付。

## 验收标准
- 交付结果可验证

## 附件信息
- 无
`,
  );
  return relative_path;
}

export function write_inbox_work_order(
  work_dir: string,
  {
    order_dir_name = "20260421T000000-order-1",
    turn_id = "000001",
    delegator = "parent-agent",
    executor,
  }: {
    order_dir_name?: string;
    turn_id?: string;
    delegator?: string;
    executor?: string;
  } = {},
): string {
  const relative_path = `.loong/work-orders/inbox/${order_dir_name}/work-order.md`;
  const absolute_path = path.join(work_dir, relative_path);
  const effective_executor =
    executor ?? load_current_agent_name(work_dir) ?? path.basename(work_dir);
  write_file(
    absolute_path,
    `---
turn_id: "${turn_id}"
summary: 上级委派事项
delegator: "${delegator}"
executor: "${effective_executor}"
created_at: "${FIXED_TIMESTAMP}"
---

# 工作单

## 背景
来自上级的工作单。

## 目标
完成既定任务。

## 验收标准
- 补充完成报告

## 附件信息（没有附件则填无）
- 无
`,
  );
  return relative_path;
}

export function write_completion_report(
  work_dir: string,
  {
    box = "inbox",
    order_dir_name = "20260421T000000-order-1",
    turn_id = "000001",
    delegator,
    executor,
    with_output = true,
    check_status,
  }: {
    box?: "inbox" | "outbox";
    order_dir_name?: string;
    turn_id?: string;
    delegator?: string;
    executor?: string;
    with_output?: boolean;
    check_status?: "pending" | "passed" | "failed";
  } = {},
) {
  const order_dir = path.join(work_dir, ".loong", "work-orders", box, order_dir_name);
  const work_order_path = path.join(order_dir, "work-order.md");
  let effective_delegator = delegator ?? "parent-agent";
  let effective_executor = executor ?? load_current_agent_name(work_dir) ?? path.basename(work_dir);
  if (!delegator && fs.existsSync(work_order_path)) {
    const work_order = parse_work_order(work_order_path);
    if (typeof work_order.data.delegator === "string" && work_order.data.delegator.trim()) {
      effective_delegator = work_order.data.delegator.trim();
    }
  }
  if (!executor && fs.existsSync(work_order_path)) {
    const work_order = parse_work_order(work_order_path);
    if (typeof work_order.data.executor === "string" && work_order.data.executor.trim()) {
      effective_executor = work_order.data.executor.trim();
    }
  }
  write_file(
    path.join(order_dir, "completion-report.md"),
    `---
turn_id: "${turn_id}"
delegator: "${effective_delegator}"
executor: "${effective_executor}"
created_at: "${FIXED_TIMESTAMP}"
${check_status ? `check_status: "${check_status}"\n` : ""}---

# 完成报告

## 完成情况
工作已经完成。

## 交付物
- output/result.md：测试交付物

## 验收项对照
- 交付结果可验证：已满足

## 验证记录
- 冒烟检查：通过
`,
  );
  if (with_output) {
    write_file(path.join(order_dir, "output", "result.md"), "# output\n");
  }
}

export function write_work_check_report(
  work_dir: string,
  {
    order_dir_name = "20260421T000000-order-1",
    open_issue_count = 0,
    turn_id = "000001",
  }: {
    order_dir_name?: string;
    open_issue_count?: number;
    turn_id?: string;
  } = {},
) {
  const order_dir = path.join(work_dir, ".loong", "work-orders", "inbox", order_dir_name);
  const issues =
    open_issue_count > 0
      ? `### Q1 测试问题

- 问题详情：测试问题。
- 状态：未修复
- 修复轮次：-
- 修复情况：待修复。
`
      : "无未修复问题。\n";
  write_file(
    path.join(order_dir, "work-check.md"),
    `---
open_issue_count: ${open_issue_count}
---

# 工作检查报告

## 工作检查轮次 ${turn_id}

${issues}`,
  );
}

export function write_human_request(
  work_dir: string,
  {
    file_name = "000001-20260421T000000-request-1.md",
    turn_id = "000001",
    status = "waiting",
    summary = "需要完成实名认证",
  }: {
    file_name?: string;
    turn_id?: string;
    status?: "waiting" | "done" | "cancelled" | "unknown";
    summary?: string;
  } = {},
): string {
  const relative_path = `.loong/human-requests/${file_name}`;
  write_file(
    path.join(work_dir, relative_path),
    `---
turn_id: "${turn_id}"
created_at: "${FIXED_TIMESTAMP}"
status: "${status}"
summary: "${summary}"
---

# 人工介入请求

## 前因后果
测试流程需要人类完成现实身份动作。

## 需要人类完成的位置
- 服务/平台/系统：测试平台
- 入口/页面/链接：设置 > 认证
- 账号/主体：测试主体

## 具体操作步骤
1. 打开测试平台。
2. 进入认证页面。
3. 完成认证。

## 完成后如何标记
请将 status 从 waiting 改为 done。

## 人类处理结果
等待处理。
`,
  );
  return relative_path;
}

export function create_valid_loop_state(work_dir: string, turn_id = "000001"): LoopState {
  return {
    turn_id,
    updated_at: "",
    plan: write_turn_plan(work_dir, turn_id),
    log: write_turn_log(work_dir, turn_id),
    delegated_work_orders: [],
    human_requests: [],
    is_memory_updated: true,
    summary: "本轮完成了测试准备。",
    next_action: "continue",
    sleep_duration: 0,
  };
}
