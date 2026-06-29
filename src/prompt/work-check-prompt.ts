import { get_turn_id } from "../runtime/state.js";
import type { TurnRunContext } from "../runtime/turn-context.js";
import {
  build_final_state_section,
  build_loong_intro_section,
  build_memory_dir_section,
  build_planless_data_persistence_section,
  build_runtime_context_section,
  build_runtime_dir_section,
  build_turn_results_dir_section,
  build_work_logs_dir_section,
  build_work_orders_dir_section,
  build_workspace_boundary_section,
} from "./common-sections.js";
import { get_work_state_prompt } from "./work-state.js";

function build_work_check_next_action_prompt(): string {
  return `- 本轮是工作检查轮次，"next_action" 由框架根据 work-check.md 的 open_issue_count 自动设置：
  - open_issue_count 为 0 时，框架会设置为 "stop"。
  - open_issue_count 大于 0 时，框架会设置为 "continue"。
- 你在最终状态文件中固定填写 "next_action": "continue" 和 "sleep_duration": 0。`;
}

function build_work_check_task_prompt(): string {
  return `# 本轮任务

## 任务说明

本轮是工作检查轮次。你只检查“本轮变量”中的 target_work_order_path 指向的目标工作单目录中的 completion-report.md、output/ 交付物和已有 work-check.md。

要求：
- 必须在目标工作单目录维护 work-check.md，如果不存在，则需要你创建，该文件的模板如下：

\`\`\`markdown
---
open_issue_count: 1
---

# 工作检查报告

## 工作检查轮次 000001

### Q1 问题名称

- 问题详情：需要定位到具体文件的具体位置，说明具体问题情况
- 状态：已修复/未修复/待复查
- 修复轮次：未修复时填 -，待复查或已修复时填写修复轮次
- 修复情况：一句话总结修复情况，未修复时填 -
- 备注：补充说明

## 工作检查轮次 000003

### Q2 问题名称
...
\`\`\`

- 每个工作检查轮次都必须追加一个新的二级标题 "## 工作检查轮次 <turn_id>"。
- 当前轮次新增的问题需要放到本轮二级标题下，问题编号需要递增，且保持唯一。
- 如果本轮没有新增问题，也必须在本轮二级标题下写入一句备注。
- 不要修改历史轮次的问题编号、问题名称、问题详情、修复轮次和修复情况，只能根据复检情况修改问题状态和备注。

## 工作检查方法

你的职责不是确认执行轮次“做过了”，而是尝试证明这份交付物不能被上级验收、不能被后续环节直接使用。只有按以下基准找不到反例时，才视为通过。

高质量交付必须同时满足：
- 命中真实目标：解决 work-order.md 背后的真实问题，而不是只回应表面条目。
- 工作充分：能看出经过必要探索、比较、判断、验证或打磨，不是第一个可行答案或模板化填空。
- 证据支撑：completion-report.md 的关键主张都有 output/、正文内容或可检查依据支撑。
- 取舍清楚：能区分重点、边界、风险、排除项和不确定性，不把未确认内容包装成已完成。
- 可直接使用：交付物完整、可打开、可理解，上级或下一环节无需重新猜意图、补材料、重整理或重验证。
- 类型达标：文章、报告、方案、代码、设计、数据等成果，应达到该类型交付物应有的专业水准，而不只是“存在对应文件”。

检查时必须主动寻找不可交付证据：目标偏离、证据不足、探索不足、判断草率、内容空泛、结构混乱、口径矛盾、附件缺失、不可复用、不可执行、不可验证，或明显填空式完成。发现任一会影响验收、使用、继续推进或最终交付的问题，都必须记录。

无法确认达到上述基准时，按问题记录；不要默认通过。不要记录纯表达偏好、无关优化建议或不影响验收与使用的问题。

## 工作推进流程

1. 先只读查看目标工作单目录中的 work-order.md、completion-report.md、output/ 交付物和已有 work-check.md。
2. 先依次核对 work-check.md 中所有待复查问题是否已被修复，如果已修复则更新对应问题状态为“已修复”，否则重置为“未修复”，并在备注中补充说明。
3. 再依次检查 completion-report.md 与 output/ 中的所有交付物是否满足 work-order.md 的目标和验收标准，记录新增问题。
4. 只维护 work-check.md，不修改 completion-report.md、output/ 交付物或业务成果。
5. 写入本轮工作日志和最终状态文件，最终回复的消息需要一句话总结本轮的工作结果。

## 结束会话前的检查

1. 确保工作日志已落盘。
2. 确保目标工作单目录下已生成或更新 work-check.md。
3. 确保 work-check.md frontmatter 中的 open_issue_count 等于正文中状态为“未修复”或“待复查”的问题数量。
4. 确保没有直接修改 completion-report.md、output/ 交付物或业务成果。
5. 确保最终状态文件已写入 /.loong/turn-results/<turn_id>-state.json。`;
}

export function build_work_check_system_prompt(
  work_dir: string,
  _is_root: boolean,
  turn_context: TurnRunContext,
): string {
  const turn_id = get_turn_id(work_dir);
  const sections = [
    build_workspace_boundary_section(),
    build_loong_intro_section(),
    build_runtime_dir_section(),
    build_turn_results_dir_section(),
    build_memory_dir_section(),
    build_work_orders_dir_section(),
    build_work_logs_dir_section(),
    build_planless_data_persistence_section(),
    build_final_state_section('- "plan" 固定填写空字符串 ""，表示本轮不创建工作计划。'),
    build_work_check_task_prompt(),
    build_runtime_context_section(
      turn_id,
      turn_context.turn_type,
      turn_context.target_work_order_path,
      build_work_check_next_action_prompt(),
      get_work_state_prompt(work_dir),
    ),
  ];
  return `\n${sections.join("\n\n")}\n`;
}
