# 多类型轮次与完成报告工作检查闭环

本文记录 loong 框架内置多类型轮次的设计共识。后续讨论形成新的明确结论后，应继续更新本文。

## 已达成共识

- 多类型轮次应作为 loong 框架内置逻辑实现，不只依赖提示词约束。
- `TurnRunner` 需要加入轮次类型，用于区分：
  - `execution`：执行轮次
  - `work_check`：工作检查轮次
  - `repair`：修复轮次
- 轮次元数据字段固定为：
  - `turn_type`：轮次类型。
  - `target_work_order_path`：目标工作单路径，没有目标时为 `null`。
- 轮次元数据需要写入轮次运行上下文、轮次快照和轮次事件，保证 WebUI、日志和恢复逻辑可观察。
- `work_check` 和 `repair` 轮次必须绑定目标工作单路径。
- `execution` 轮次只有在承担上级工作单时才绑定目标工作单路径。
- 根节点或没有上级工作单的普通 `execution` 轮次不需要目标工作单路径。
- 绑定目标工作单的 `execution` 轮次，只允许在目标工作单目录提交 `completion-report.md`。
- 绑定目标工作单的 `execution` 轮次中，如果本轮变更了非目标 inbox 工作单目录下的 `completion-report.md`，轮次校验应失败。
- 结束校验应基于当前 worktree 相对主工作区的变更集（如 Git diff/status）识别本轮新增、修改或删除的 `completion-report.md`。
- 任意非 `target_work_order_path` 目录下的 `completion-report.md` 变更都必须导致校验失败。
- 非目标完成报告问题必须在本轮校验阶段被预防，不依赖后续扫描补救。
- 轮次校验失败时，该轮次不能正常结束，也不能 merge 到 agent 主工作区。
- 无目标的普通 `execution` 轮次不处理上级工作单；即使发现多个上级工作单，也应全部忽略。
- 需要处理上级工作单时，由调度层选择最早的未完成 inbox 工作单，并绑定给 `execution` 轮次。
- 未完成 inbox 工作单定义为：没有 `completion-report.md`，或已有完成报告但 `check_status` 不是 `passed`。
- 目标工作单路径写入轮次运行上下文、轮次快照和轮次事件，保证调度、恢复和排障可追踪。
- 目标工作单路径使用相对于 agent 工作区的路径，例如 `.loong/work-orders/inbox/<order-dir>`。
- 目标工作单路径不写入最终状态 JSON，避免要求 agent 在最终状态里重复维护运行时调度信息。
- 所有轮次共享稳定的运行边界与最终状态协议，并根据 `turn_type` 注入不同的能力块。
- 通用提示词 section 只能单点维护，不能在多个轮次提示词中复制同一段规则。
- 每种轮次应有独立的提示词组装函数，组装函数只选择需要的通用 section 和本轮专用 section。
- 为保持提示词缓存效率，提示词前部应尽量保持稳定；本轮变量、轮次类型和当前状态放在后部。
- 本轮专用任务说明使用一级标题 `# 本轮任务`，并放在 `# 本轮运行上下文` 之前。
- `# 本轮任务` 下的第一节统一使用二级标题 `## 任务说明`。
- `# 工作推进流程` 和 `# 结束会话前的检查` 不作为公共顶层 section；它们应作为各轮次 `# 本轮任务` 下的二级标题，由每种轮次分别定义。
- `target_work_order_path` 只作为 `# 本轮运行上下文` 中的本轮变量注入，不在各轮次 `# 本轮任务` 中作为变量重复声明。
- `execution` 轮次保留完整工作提示词，包括工作心智、多轮原则、委派、完成上级委派、人工介入、记忆和交付规则。
- `work_check` 轮次只提供检查目标工作单所需的信息，不提供委派、完成上级委派、人工介入等执行轮次能力说明。
- `repair` 轮次只提供修复目标工作单未解决问题所需的信息，不提供委派、完成上级委派等执行轮次能力说明。
- `execution` 轮次需要先创建并维护本轮工作计划。
- `work_check` 和 `repair` 轮次不创建工作计划；它们的推进过程由轮次类型和目标工作单直接决定。
- `work_check` 和 `repair` 轮次的最终状态 JSON 中，`plan` 固定为空字符串。
- 运行时应阻止 `work_check` 和 `repair` 轮次创建本轮计划文件。
- 只要子节点提交 `completion-report.md`，就触发工作检查轮次。
- 不需要提交完成报告的工作，不进入工作检查闭环。
- 如果当前 agent 没有上级工作单，执行轮次可以在不提交完成报告的情况下停止。
- 如果当前 agent 正在承担上级工作单，执行轮次不应在未提交完成报告时停止。
- 如果承担上级工作单的执行轮次返回 `next_action: stop`，但没有提交 `completion-report.md`，框架应将其归一为 `continue`。
- 工作检查主要针对完成报告及其附件资料。
- 完成报告需要增加 `check_status` 字段，记录该报告当前是否通过工作检查。
- `check_status` 的取值为：
  - `pending`：未检查
  - `passed`：已通过
  - `failed`：未通过
- 完成报告模板中默认要求填写 `check_status: pending`。
- 执行轮次提交完成报告时，框架忽略 agent 写入的 `check_status` 值，并自动归一为 `pending`。
- `check_status` 由框架根据 `work-check.md` 的 `open_issue_count` 自动更新。
- 检查结果不直接写入完成报告正文。
- 工作检查报告应作为独立文件生成在完成报告所在的工作单目录中。
- 工作检查报告文件名固定为 `work-check.md`。
- 每个工作单目录只保留一份 `work-check.md`，不为每次工作检查创建多个报告文件。
- `work-check.md` 需要累计记录所有工作检查轮次发现的问题以及后续修复情况。
- `work-check.md` 使用 YAML frontmatter + Markdown 正文。
- YAML frontmatter 用于记录运行时可读取的结构化检查状态。
- YAML frontmatter 需要包含 `open_issue_count`，表示当前仍未解决的问题数量。
- `open_issue_count` 统计所有历史未解决问题总数，不只统计最新工作检查轮次的问题。
- `open_issue_count` 是框架判断是否需要进入修复轮次的直接依据。
- 当 `open_issue_count` 为 `0` 时，认为检查通过；大于 `0` 时，认为检查不通过。
- 框架根据 `open_issue_count` 同步完成报告中的 `check_status`，避免 agent 手工维护两处状态。
- Markdown 正文用于记录问题详情、修复情况和本轮工作检查说明。
- `work-check.md` 默认对应同一工作单目录下的 `completion-report.md`，不额外记录完成报告路径字段。
- `work-check.md` 的 frontmatter 不记录当前或最近一次工作检查轮次 ID。
- `work-check.md` 正文应以工作检查轮次作为章节组织历史记录。
- `work-check.md` 正文中的问题应作为三级标题，标题格式为 `### Q<num> <问题名称>`。
- `work-check.md` 正文中的问题条目至少包含：状态、修复轮次、问题详情、修复情况。
- 问题状态取值固定为 `未修复` 或 `已修复` 或 `待复查`。
- `open_issue_count` 等于全文中状态为 `未修复` 或 `待复查` 的问题数量。
- 状态为 `待复查` 或 `已修复` 的问题必须填写修复轮次；状态为 `未修复` 时修复轮次填写 `-`。
- `work-check.md` 中的问题应使用稳定编号，如 `Q1`、`Q2`，便于后续修复轮次和工作检查轮次引用。
- 检查不通过时，框架自动启动同一个 agent 的修复轮次，并将工作检查报告作为修复输入。
- 修复轮次完成后，仍需再次进入工作检查轮次，直到通过。
- 修复轮次复用并修改同一个 `completion-report.md` 和附件资料，不创建新的完成报告版本。
- 同一工作单目录中的 `completion-report.md` 和附件资料始终代表当前最新交付版本。
- 修复轮次完成后，框架将 `completion-report.md` 的 `check_status` 重新归一为 `pending`，表示当前版本等待重新检查。
- `completion-report.md` 存在但 `check_status` 不是 `passed` 时，工作单不应被视为完成。
- 只有检查通过并将 `check_status` 更新为 `passed` 后，工作单才算完成。
- 检查通过后，框架将工作单视为完成，并允许 agent 停止。
- 如果 agent 配置了 `never_stop`，检查通过后仍不停止，而是继续进入普通执行轮次。
- 对父节点视角，检查未通过或修复中的工作单仍显示为进行中，不额外拆分为检查中、修复中或待重新检查状态。
- daemon 停止后重启时，如果发现 `check_status: pending` 的完成报告，应自动补跑工作检查轮次。
- daemon 停止后重启时，如果发现 `check_status: failed` 的完成报告，应自动启动修复轮次。
- 如果存在 `completion-report.md` 但缺少 `check_status` 字段，框架应自动补为 `pending` 并触发工作检查。
- 如果存在 `work-check.md` 但缺少 `open_issue_count` 字段，框架应视为工作检查报告无效并重新运行工作检查轮次。
- 如果 `work-check.md` 中的 `open_issue_count` 不是合法数字，框架应视为工作检查报告无效并重新运行工作检查轮次。
- 工作检查轮次自身运行失败时，按现有 SDK/运行失败重试机制处理，同一工作检查轮次重试。
- 修复轮次自身运行失败时，按现有 SDK/运行失败重试机制处理，同一修复轮次重试。
- 每轮完成后，应先将 worktree 结果合并回 agent 主工作区，再进行下一轮调度。
- 调度层只扫描已合并后的 agent 主工作区，不直接扫描未合并的 worktree。
- 如果同一个 agent 同时存在多个待处理完成报告，调度顺序为：先对无效 `work-check.md` 重新运行工作检查，再修复 `check_status: failed`，再检查 `check_status: pending`，同状态内按工作单时间顺序处理。
- 调度层选择下一轮时应遵守本文的调度优先级。
- 同一个 agent 同一时间只允许运行一个轮次，不并发运行多个执行、工作检查或修复轮次。

## 运作闭环

```text
执行轮次
  ↓ 提交 completion-report.md，check_status = pending
工作检查轮次
  ↓ 通过：写入工作检查报告，更新 check_status = passed，工作单完成
  ↓ 不通过：写入工作检查报告，更新 check_status = failed，自动启动修复轮次
修复轮次
  ↓ 根据工作检查报告修复完成报告和附件资料，重新进入工作检查轮次
```

- 执行轮次提交完成报告后，不直接视为最终通过。
- 工作检查轮次是完成报告进入父节点视角前的框架级检查。
- 每次工作检查轮次运行时，应先检查 `work-check.md` 中上一批问题是否已修复，再继续检查是否存在新的问题。
- 修复轮次不能绕过工作检查；修复后必须再次进入工作检查轮次。
- 默认不设置连续不通过次数上限；只要检查不通过，就持续进入修复轮次并再次进入工作检查轮次，直到通过。

## 调度优先级

调度层选择下一轮时，按以下顺序处理：

1. 先处理存在无效 `work-check.md` 的完成报告，启动 `work_check` 轮次。
2. 再处理 `check_status: failed` 的完成报告，启动 `repair` 轮次。
3. 再处理 `check_status: pending` 或缺少 `check_status` 的有效完成报告，启动 `work_check` 轮次。
4. 再选择最早的无完成报告未完成 inbox 工作单，启动绑定目标的 `execution` 轮次。
5. 如果没有上级工作单，再启动无目标普通 `execution` 轮次。

## `check_status` 同步时机

| 触发点 | 框架动作 |
| --- | --- |
| `execution` 轮次校验通过，并在目标工作单目录提交完成报告 | 将 `completion-report.md` 的 `check_status` 归一为 `pending` |
| `work_check` 轮次校验通过，且 `open_issue_count = 0` | 将 `completion-report.md` 的 `check_status` 更新为 `passed` |
| `work_check` 轮次校验通过，且 `open_issue_count > 0` | 将 `completion-report.md` 的 `check_status` 更新为 `failed` |
| `repair` 轮次校验通过 | 将 `completion-report.md` 的 `check_status` 重新归一为 `pending` |

## 职责边界

- 执行轮次负责完成父节点委派的工作，并提交完成报告与附件资料。
- 工作检查轮次负责独立检查完成报告和附件资料，判断是否满足工作单要求。
- 工作检查轮次负责维护 `work-check.md`，记录历史问题、修复状态和本轮新增问题。
- 工作检查轮次不直接修复主要交付物；不通过时产出工作检查报告。
- 修复轮次负责根据工作检查报告修复交付物，并重新提交可检查的成果。
- 修复轮次不需要额外设计专门的输入打包机制；沿用当前框架，让 agent 自行探索工作区后开展修复。
- 所有类型轮次都沿用普通轮次最终状态 JSON：`/.loong/turn-results/<turn_id>-state.json`。
- 工作检查轮次不引入单独的专用状态 JSON；运行协议只通过轮次类型区分。

## `work-check.md` 模板

```markdown
---
open_issue_count: 1
---

# 工作检查报告

## 工作检查轮次 000003

### Q1 课程封面口径与完成报告描述不一致

- 问题详情：`cover.md` 使用“职场表达”，完成报告写“向上沟通”。
- 状态：已修复
- 修复轮次：000004
- 修复情况：已统一为“向上沟通”。

### Q2 第 3 集脚本和第 4 集脚本存在大段重复

- 问题详情：`episode-03.md` 与 `episode-04.md` 的开场段落高度一致。
- 状态：未修复
- 修复轮次：-
- 修复情况：仍需重写第 4 集开场段落。

## 工作检查轮次 000005

### Q3 完成报告声称已提交音频制作说明，但附件中缺少对应文件

- 问题详情：`completion-report.md` 写明“已提交音频制作说明”，但附件目录中未发现音频制作说明文件。
- 状态：未修复
- 修复轮次：-
- 修复情况：待补充音频制作说明。
```
