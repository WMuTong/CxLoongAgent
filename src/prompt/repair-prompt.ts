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

function build_repair_next_action_prompt(): string {
  return `- 本轮是修复轮次，修复完成后必须进入后续工作检查轮次复查。
- "next_action" 固定填写 "continue"。
- "sleep_duration" 固定填写 0。`;
}

function build_repair_task_prompt(): string {
  return `# 本轮任务

## 任务说明

本轮是修复轮次。你只修复“本轮变量”中的 target_work_order_path 指向的目标工作单目录中 work-check.md 记录的未修复问题。

## 工作推进流程

1. 先只读查看目标工作单目录中的 work-order.md、completion-report.md、output/ 交付物和 work-check.md。
2. 根据 work-check.md 中的未修复问题清单，依次修改 completion-report.md 和 output/ 交付物，必要时补充或替换附件资料。
3. 将 work-check.md 中的未修复问题状态更新为“待复查”，**不能改为“已修复”**，记录修复轮次为 <turn_id>，补充修复情况。
4. 写入最终状态文件，修复完成后等待后续工作检查轮次重新检查，最终回复的消息需要一句话总结本轮的工作结果。

## 结束会话前的检查

1. 确保工作日志已落盘，并记录修复的问题编号。
2. 确保 work-check.md 中所有未修复的问题都已修复，且状态都已更新为“待复查”，修复轮次和修复情况均已记录。
3. 确保最终状态文件已写入 /.loong/turn-results/<turn_id>-state.json。`;
}

export function build_repair_system_prompt(
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
    build_repair_task_prompt(),
    build_runtime_context_section(
      turn_id,
      turn_context.turn_type,
      turn_context.target_work_order_path,
      build_repair_next_action_prompt(),
      get_work_state_prompt(work_dir),
    ),
  ];
  return `\n${sections.join("\n\n")}\n`;
}
