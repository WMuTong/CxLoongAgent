import {
  type AgentConfig,
  load_agent_configs,
  load_current_agent_name,
  load_current_agent_never_stop,
  load_parent_agent_config,
} from "../agent/index.js";
import { get_turn_id } from "../runtime/state.js";
import type { TurnRunContext } from "../runtime/turn-context.js";
import {
  build_data_persistence_section,
  build_final_state_section,
  build_human_requests_dir_section,
  build_loong_intro_section,
  build_memory_dir_section,
  build_multi_turn_section,
  build_runtime_context_section,
  build_runtime_dir_section,
  build_turn_results_dir_section,
  build_work_logs_dir_section,
  build_work_mindset_section,
  build_work_orders_dir_section,
  build_work_plans_dir_section,
  build_workspace_boundary_section,
} from "./common-sections.js";
import { get_work_state_prompt } from "./work-state.js";

function build_sub_agent_prompt(work_dir: string, current_agent_name: string): string {
  const agent_configs = load_agent_configs(work_dir);
  if (agent_configs.length === 0) {
    return "你当前没有可用的子代理可以委派工作。";
  }
  const json = JSON.stringify(
    agent_configs.map((item) => {
      return {
        name: item.name,
        position: item.position,
        description: item.description,
      };
    }),
  );
  return `
## 子代理
子代理位于 /agents 目录下，每个子目录代表一个子代理，/agents 目录是只读的，你不能修改里面的任何内容。
子代理配置中的 name 表示子代理姓名，position 表示岗位；委派工作单 executor 必须填写子代理 name。

你可以向以下 ${agent_configs.length} 个子代理委派工作：
${json}

## 委派原则
1. 该事项天然属于某个子代理的职责范围时，优先委派给子代理执行。
2. 委派前必须先判断任务之间是否存在前置依赖；如果一项任务需要依赖另一项任务的产出，应先委派并跟进前置任务，拿到可用交付物后再委派后续任务。
3. 只有当多个任务彼此独立、输入资料已经充分且不会互相等待结果时，才可以同时给多个子代理委派工作。
4. 该事项不属于任何一个子代理的职责范围时，优先自己执行，而不是强行委派给某个子代理。

## 工作单信息边界
- 工作单只应包含执行者完成该任务所必需的最小信息：任务背景、目标、输入资料、约束、交付物要求和验收标准。
- 不要把你当前看到的完整工作状态、长期计划、无关目录细节、内部判断过程或其他子代理不需要知道的信息塞进工作单。
- 附件也应遵循最小必要原则；只提供该任务真正需要读取的 input/ 文件夹中的文件，并说明使用方式。
- 如果某项任务需要另一个子代理的产出作为输入，应等待该产出形成后再委派，不要用未经收敛的假设替代正式输入。

## 委派方式
1. 在 /.loong/work-orders/outbox 中创建工作单目录，需要符合工作单目录命名规则。 
2. 在该子目录中创建 work-order.md 文件，固定标题必须逐字一致，格式如下：
\`\`\`markdown
---
turn_id: "<turn_id>"
summary: "<一句话概述该工作单要解决什么问题、交付什么结果>"
delegator: "${current_agent_name}"
executor: "<被委派的子代理姓名，必须与子代理 name 一致>"
created_at: "<yyyy-MM-ddTHH:mm:ssZ>"
check_status: "pending"
---

# 工作单

## 背景
<只写执行者完成该任务必须知道的背景，不要透传无关项目状态或内部判断过程>

## 目标
<工作单的具体目标>

## 验收标准
- <工作单的验收标准，必须具体、可执行、可验证>

## 附件信息
- <附件文件名>：<附件说明>（没有附件则填无）
\`\`\`
3. 如果需要给子代理提供一些额外的文件作为附件，可以将这些文件放在工作单目录下，并在工作单的附件信息中说明这些附件是什么，以及子代理需要如何使用这些附件。
附件必须放在工作单目录下的 input/ 文件夹中，input/ 中的所有文件都会同步给子代理；附件信息中应使用 input/<文件名> 或 input/<子目录>/<文件名> 说明。
4. 当工作单被派发后，对应子代理会在自己的 /.loong/work-orders/inbox/<工作单目录名>/ 目录中看到同名工作单及其附件，你只需要在自己的 outbox 工作单目录中按要求写好内容即可。

## 委派说明
- 当你委派了一项工作给子代理后，子代理会在另外一个进程开展工作，同时可能需要多个轮次才能完成，因此你无需在本轮等待子代理完成后再继续推进工作，你可以优先选择开展其他工作或休息一段时间。
- 子代理完成工作后，你会在自己的 outbox 对应工作单目录下看到 completion-report.md 文件及交付物。
- 如果委派结果需要改动当前代理工作区中的文件，应要求子代理在 output/ 文件夹中提交交付物、补丁或可应用的文件包，由你在后续轮次审查并应用；不要要求子代理直接修改它看不到或不归它维护的上级工作区文件。
- 当前状态中的工作委派信息只提供索引，不会自动展开 work-order.md 或 completion-report.md 的全文；当你需要跟进某项委派时，应主动打开对应 outbox 目录查看 work-order.md、completion-report.md 以及 output/ 交付物。
`;
}

function build_parent_agent_prompt(
  parent_config: AgentConfig | null,
  is_root: boolean,
  current_agent_name: string,
): string {
  if (is_root) {
    return "你当前是根节点，没有上级节点。";
  }

  const parent_section = (() => {
    if (parent_config) {
      const json = JSON.stringify({
        name: parent_config.name,
        position: parent_config.position,
        description: parent_config.description,
      });
      return `## 上级节点
你的上级节点信息如下：
${json}

完成上级委派时，应将工作结果提交到自己的 inbox 工作单目录；上级会在它的 outbox 对应工作单中看到你的 completion-report.md 与 output/ 交付物。`;
    }
    return `## 上级节点
未能从当前路径识别上级节点；如收到上级委派，以对应 work-order.md frontmatter 中的 delegator 为准。`;
  })();

  return `${parent_section}

当你完成了一个上级委派的工作单后，必须在对应的 /.loong/work-orders/inbox/<工作单目录名> 下创建一个 completion-report.md 文件，内容格式如下：
\`\`\`markdown
---
turn_id: "<turn_id>"
delegator: "<上级委派者名称，必须与对应 work-order.md frontmatter 中的 delegator 一致>"
executor: "${current_agent_name}"
created_at: "<yyyy-MM-ddTHH:mm:ssZ>"
---

# 完成报告

## 完成情况
<明确说明该工作单已全部完成，并概述最终完成结果>

## 交付物
- <交付物文件名>：<用途说明>

## 验收项对照
- <验收标准 1>：<已满足，给出对应证据或说明>
- <验收标准 2>：<已满足，给出对应证据或说明>

## 验证记录
- <执行的检查项>：<检查结果>
\`\`\`

要求：
- 完成报告必须真实反映工作单的完成情况，不允许为了满足验收标准而在报告中进行虚假描述。
- completion-report.md frontmatter 中的 delegator 表示该工作单的委派者名称，必须从对应 work-order.md 的 delegator 字段复制。
- completion-report.md frontmatter 中的 executor 表示完成该工作单的执行者名称，必须填写你自己的代理名称。
- completion-report.md frontmatter 中的 check_status 固定填写 "pending"；最终是否通过工作检查由框架更新。
- 只有在工作单已经全部完成且验收标准已满足后，才可以创建 completion-report.md；未完成时不得提交完成报告。
- 交付物必须以文件形式提供，且需要放在工作单目录下的 output/ 文件夹中；output/ 中的所有文件都会同步给上级。
- 你只需要在自己的 inbox 工作单目录中写入完成报告和 output/ 交付物，你的上级会在对应工作单中看到这些内容。`;
}

function build_current_parent_agent_prompt(
  work_dir: string,
  is_root: boolean,
  current_agent_name: string,
): string {
  return build_parent_agent_prompt(load_parent_agent_config(work_dir), is_root, current_agent_name);
}

function build_execution_next_action_prompt(
  is_root: boolean,
  never_stop: boolean,
  target_work_order_path: string | null,
): string {
  if (target_work_order_path) {
    return `- 本轮绑定目标工作单，完成后需要进入工作检查流程。
- "next_action" 固定填写 "continue"。
- 如果本轮已在目标工作单目录提交 completion-report.md，"sleep_duration" 填写 0，以便立即进入工作检查。
- 如果本轮尚未提交 completion-report.md，只是在等待下级交付、人类协助或后续跟进，需设置合理的 "sleep_duration" 作为后续巡检间隔`;
  }
  if (is_root && never_stop) {
    return `- "next_action" 只能填写 "continue"：
  - 你是配置为 never_stop=true 的根节点，不能填写 "stop"。
  - 当当前阶段目标已经完成且没有即时工作时，需设置合理的 "sleep_duration" 作为后续巡检间隔。`;
  }
  return `- "next_action" 只能填写 "continue" 或 "stop"：
  - 当仍有工作需要后续轮次继续推进，或者仍需等待委派结果后继续跟进时，填写 "continue"。
  - 当当前目标已经完成，且你判断无需继续运行后续轮次时，填写 "stop"。`;
}

function build_execution_task_prompt(turn_context: TurnRunContext): string {
  const task_description = turn_context.target_work_order_path
    ? "本轮是绑定目标工作单的执行轮次。你需要处理“本轮变量”中的 target_work_order_path 指向的上级委派的工作单，不要处理其它无关的工作单。"
    : "本轮是无目标普通执行轮次，无需处理任何工作单，你可以推进当前节点自身工作、跟进子代理结果、整理状态或在无即时工作时休息。";

  return `# 本轮任务

## 任务说明

${task_description}

## 工作推进流程

1. 仔细理解你当前的工作环境及当前状态。允许在创建计划前进行最小只读探查，例如查看当前目录、AGENTS.md、/.loong 固定目录和已有状态；计划前不得写入文件、委派工作或执行会改变状态的操作。
2. 明确本轮的工作目标、专业工作路径。
3. 明确是否需要拆成多个轮次推进工作，并给出充分的理由。
4. 制定本轮工作计划并写入至 /.loong/work-plans 目录。
5. 按照计划推进工作，并将计划执行的情况更新至本轮的计划文件。
6. 计划执行完毕后，数据落盘，包括：
   - 新增本轮的工作日志，保存至 /.loong/work-logs 目录 
   - 根据本轮的最新执行情况更新 /.loong/memory 中的记忆文件
7. 将本轮最终状态写入 /.loong/turn-results/<turn_id>-state.json。
8. 最终回复的消息需要一句话总结本轮的工作结果，并说明下一步行动计划。

## 结束会话前的检查

在你认为已经完成了本轮的工作，并准备返回结果之前，请务必按以下顺序进行检查：
1. 确保本轮中计划的所有步骤都已完成或已取消
2. 确保工作日志已落盘，并已按记忆写入规则处理记忆
3. 如果有委派工作给子代理，确保对应的工作单目录下已创建 work-order.md 文件，并且内容符合要求
4. 如果本轮新增人工介入请求，确保请求文件位于 /.loong/human-requests，文件名包含当前 turn_id，且已写清前因后果、操作位置和具体步骤
5. 如果已完成上级委派的工作，确保对应的工作单目录下已创建 completion-report.md 文件及交付物，并且内容符合要求
6. 确保最终状态文件已写入 /.loong/turn-results/<turn_id>-state.json`;
}

export function build_execution_system_prompt(
  work_dir: string,
  is_root: boolean,
  turn_context: TurnRunContext,
): string {
  const current_agent_name = load_current_agent_name(work_dir) ?? "unknown";
  const assign_prompt = build_sub_agent_prompt(work_dir, current_agent_name);
  const parent_prompt = build_current_parent_agent_prompt(work_dir, is_root, current_agent_name);
  const turn_id = get_turn_id(work_dir);
  const sections = [
    build_workspace_boundary_section(),
    build_work_mindset_section(),
    build_multi_turn_section(),
    build_loong_intro_section(),
    build_runtime_dir_section(),
    build_turn_results_dir_section(),
    build_memory_dir_section(),
    build_work_plans_dir_section(),
    build_work_orders_dir_section(),
    build_human_requests_dir_section(),
    build_work_logs_dir_section(),
    `# 如何委派工作\n${assign_prompt}`,
    `# 如何完成上级委派\n${parent_prompt}`,
    build_data_persistence_section(),
    build_final_state_section(),
    build_execution_task_prompt(turn_context),
    build_runtime_context_section(
      turn_id,
      turn_context.turn_type,
      turn_context.target_work_order_path,
      build_execution_next_action_prompt(
        is_root,
        load_current_agent_never_stop(work_dir),
        turn_context.target_work_order_path,
      ),
      get_work_state_prompt(work_dir),
    ),
  ];
  return `\n${sections.join("\n\n")}\n`;
}
