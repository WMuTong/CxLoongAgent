import fs from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { TurnRunner } from "../../src/runtime/turn.js";
import { create_workspace } from "../helpers/workspace.js";

const CANARY_ENABLED =
  process.env.LOONG_ENABLE_CODEX_CANARY === "1" &&
  typeof process.env.OPENAI_API_KEY === "string" &&
  process.env.OPENAI_API_KEY.trim() !== "";

const maybe_test = CANARY_ENABLED ? test : test.skip;

function build_canary_prompt(): string {
  return `
你正在执行一个运行时 canary，请严格完成以下动作：

1. 覆盖文件 /.loong/memory/world-model.md，写入以下内容：
\`\`\`markdown
# 世界模型

## 当前仍然有效的环境事实
- canary 工作区可写

## 当前可用的资源
- Codex 线程可执行一轮操作

## 当前生效的外部约束
- 本轮只允许写入测试要求的文件

## 重要对象及其关系
- 当前目录是根节点

## 尚未确定但会影响后续行动的问题
- 无

## 最近发生变化且需要持续关注的事实
- 已进入 canary 验证
\`\`\`

2. 覆盖文件 /.loong/memory/learned.md，写入以下内容：
\`\`\`markdown
# 经验沉淀

## 已验证有效的做法
- 可以在单轮内同时完成落盘和最终状态文件写入

## 已验证无效或低效的做法
- 无

## 可复用的判断经验
- canary 提示词应提供精确文件路径

## 常见失败模式
- 忘记写工作日志或计划文件

## 需要保留的策略修正
- 输出前先核对文件是否存在

## 适用条件与置信说明
- 仅适用于当前测试工作区
\`\`\`

3. 创建文件 /.loong/work-plans/000001-20260421T000000-plan.json，内容必须是：
\`\`\`json
{
  "turn_id": "000001",
  "created_at": "2026-04-21T00:00:00.000Z",
  "plans": [
    {
      "step": 1,
      "description": "按 canary 要求写入测试文件",
      "status": "completed"
    }
  ]
}
\`\`\`

4. 创建文件 /.loong/work-logs/000001-20260421T000000-log.md，内容必须是：
\`\`\`markdown
---
turn_id: "000001"
created_at: "2026-04-21T00:00:00.000Z"
---

# 工作日志

## 本轮动作
按 canary 要求写入计划、日志与记忆文件。

## 委派的工作单
- 无

## 完成的工作单
- 无

## 验证
检查所需文件已生成。

## 问题与风险
当前未发现额外风险。
\`\`\`

5. 不要创建任何 work-order 或 completion-report。

6. 创建文件 /.loong/turn-results/000001-state.json，内容必须是：
\`\`\`json
{
  "plan": ".loong/work-plans/000001-20260421T000000-plan.json",
  "log": ".loong/work-logs/000001-20260421T000000-log.md",
  "delegated_work_orders": [],
  "human_requests": [],
  "is_memory_updated": true,
  "summary": "完成了 canary 所需的最小落盘验证。",
  "next_action": "stop",
  "sleep_duration": 0
}
\`\`\`

7. 完成后只输出一句简短说明，不要在聊天消息中输出 JSON。
`;
}

maybe_test(
  "TurnRunner can complete one real Codex-backed canary turn",
  async () => {
    const work_dir = create_workspace("turn-runner-canary");
    const runner = new TurnRunner(work_dir, true, {
      prompt_factory: build_canary_prompt,
    });

    const result = await runner.run();

    expect(result.turn_id).toBe("000001");
    expect(result.next_action).toBe("stop");
    expect(result.plan).toBe(".loong/work-plans/000001-20260421T000000-plan.json");
    expect(result.log).toBe(".loong/work-logs/000001-20260421T000000-log.md");
    expect(result.delegated_work_orders).toEqual([]);
    expect(result.human_requests).toEqual([]);
    expect(fs.existsSync(path.join(work_dir, result.plan))).toBe(true);
    expect(fs.existsSync(path.join(work_dir, result.log))).toBe(true);
    expect(
      fs.readFileSync(path.join(work_dir, ".loong", "memory", "world-model.md"), "utf-8"),
    ).toContain("canary 工作区可写");
  },
  180000,
);
