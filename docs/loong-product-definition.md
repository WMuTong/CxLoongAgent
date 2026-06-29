## Intent
构建一个围绕 `OpenAI Codex CLI` 的增强与编排框架，产品定位类似 `oh-my-codex` 这样的 workflow layer，但主入口是 `loong init` 与 `loong run`。`Codex CLI` 是执行内核，`loong` 是面向目录资产、组织树编排、长期守护运行、巡检纠偏和人工接管的薄工作流层。

## Desired Outcome
交付一个可通过 npm 全局安装的 CLI 产品。用户安装后：
- 使用 `loong init` 在当前业务目录生成一套通用骨架
- 在该目录中定义 `AGENTS.md`、`agents/` 组织树，以及 `.codex/` 下的 Codex 原生能力
- 使用 `loong run` 启动默认后台守护式长期运行流程

`loong` 的职责是提供通用能力和运行时外壳，而不是承载业务内容。跟业务上下文强相关的内容由使用者自行规划；`loong` 主要提供：
- `state`
- `logs`
- `runtime`
- `memory`
- `psmux` 观测

这些通用运行时数据统一放入 `.loong/` 目录。

## In Scope
- 一个全局可安装的 `loong` CLI
- `loong init` 初始化通用骨架
- `loong run` 启动默认后台守护式运行
- 基于目录资产驱动业务推进
- 围绕 Codex CLI 的团队/agent 编排能力
- 核心团队常驻、临时团队按需拉起的混合组织模型
- supervisor 主动派工、主动巡检、主动纠偏
- 团队内部自循环推进任务
- 多 Agent 并行运行能力
- 通过 `psmux` 提供可选观测视图
- 现实主体动作的人类介入能力
- 长期运行中的恢复、继续执行与策略滚动调整
- 目录树即组织树，用户通过目录层级定义循环结构和嵌套深度
- 节点结构同构，差异主要体现在节点目录内容
- 父节点只负责监督和协调；叶子节点负责持续执行
- 不值得建成子节点的短任务由节点直接调用 `skill`
- 概念模型收敛为 `节点/agent + skill` 两类，不再保留独立 `worker lane`
- Codex 原生能力优先复用，loong 只补 Codex 不原生支持的组织化能力

## Out Of Scope / Non-goals
- 不从零构建独立的 Agent runtime 来替代 Codex CLI
- 不把主要业务逻辑固化在 `loong` npm 包内部
- 不提供与具体业务深度绑定的内置业务模板
- 不要求用户只通过几个配置文件就完整描述业务
- 不采用“下层持续向上汇报、上层逐条批复”的控制模型
- 第一版不以强治理、强审批、强 SOP 为核心卖点
- Agent 自我修改内核并重构自身框架的能力暂不纳入第一版硬目标
- 不保留独立的 `worker lane` 中间概念
- 不强制节点本地上下文入口文件；业务上下文由使用者自行规划

## Decision Boundaries
- 可由系统自主决定:
  - 默认后台守护式运行节奏
  - 并行 agent 的组织和执行
  - 基于目录资产定义的 prompts、skills、tools、agents 的装配与执行
  - 核心团队内部的持续推进与任务拆解
  - supervisor 在授权范围内的周期巡检和状态变化触发巡检
  - 预算范围内的公开发布、回复、上架、发版本等动作
  - 预算范围内的小额采购，如 API、工具、广告、服务
  - 覆盖、修改、下线由系统自身产出的内容或版本
- 必须人工介入:
  - 注册账号
  - 实名认证
  - 税务相关完善
  - 收付款账号等依赖现实主体资格、身份或责任承担的动作

## Constraints
- 产品定位必须围绕 Codex CLI，而不是重写 Codex
- 默认运行形态是后台守护式流程，不要求用户持续盯着终端
- 如果在控制台展示运行过程，需要通过 `psmux` 承载并行 agent 视图
- 项目根目录就是根 supervisor 节点
- 目录层级本身直接表达组织/循环的嵌套关系
- 所有节点共享统一骨架，差异主要来自节点内部文件内容
- 父节点可调用的子节点直接等于 `agents/` 下的直接子目录；先不引入额外启用注册层
- 组织模型采用混合制：
  - 少数核心团队常驻
  - 部分团队按阶段临时拉起
- 对核心团队，应保持稳定的团队身份、成员、职责和连续上下文
- 监督模型不是汇报链，而是：
  - 上层派工
  - 下层自治推进
  - 上层主动巡检和及时纠偏
- 巡检采用混合触发：
  - 固定周期巡检
  - 状态变化触发巡检
- Codex 已原生支持的能力沿用 Codex 目录结构；不支持的能力由 loong 自定义目录补充
- `skills` 归 `Codex-native`，放在 `.codex/skills/`
- 跟业务上下文强相关的内容由使用者自行规划，不强制 loong 提供固定上下文文件
- `loong` 提供的通用运行时数据统一放在 `.loong/`
- 当前仓库为 greenfield，尚无现成实现

## Operating Model
系统整体是一个嵌套循环结构，而不是单层任务循环。

### 顶层
- `supervisor` 长期存在
- `supervisor` 不细管每个具体任务，而负责：
  - 设定和分配工作
  - 维护 mission 总方向
  - 主动检查团队进度
  - 发现偏航并纠偏

### 中层
- 被委派的是“节点/团队”，不是一次性细任务
- 节点可以是：
  - 核心常驻团队，如软件开发团队
  - 按阶段临时拉起的团队
- 团队内部有自己的持续推进循环
- 节点/团队结构同构，父子节点构成递归组织树
- 叶子节点代表一个值得长期存在的循环执行结构

### 底层
- 团队内部再驱动具体的 Codex 会话和 agent 协作
- 这些执行单元可以是具体的会话、批次、子代理、并行 worker
- 如果某项工作不值得升格为子节点，则由当前节点直接调用对应 `skill`

### 控制关系
- 不是 `下层主动汇报 -> 上层等待处理`
- 而是 `上层派工 -> 下层自治 -> 上层主动巡检 -> 纠偏`
- 父节点只负责监督和协调；叶子节点负责持续执行

## Workflow Interpretation Through Scenarios

### 场景 1：持续运营社交帐号，以引流变现为目标
- supervisor 设定总目标与阶段重点，例如涨粉、导流、转化
- 可存在内容运营团队、互动团队、增长团队等
- 团队内部持续推进内容生产、互动、热点响应、转化优化
- supervisor 定期和在状态变化时查看：
  - 粉丝增长
  - 内容表现
  - 导流效果
  - 是否偏离变现目标

### 场景 2：开发并长期运营一款 APP，以最大化软件收入为目标
- supervisor 刚启动时如果发现 APP 尚不存在，不是自己直接拆成一串细任务
- supervisor 会委派给一个稳定的软件开发团队去负责“把 APP 做出来并推进到可运营状态”
- 软件开发团队持续推进产品规划、实现、评审、上架准备等
- 后续进入运营期后，可能再由增长团队、运营团队等共同长期推进
- supervisor 周期性和在关键状态变化时检查：
  - 进度
  - 偏航
  - 是否需要切换阶段重点
  - 是否需要人工介入

## Init Skeleton Direction
当前收敛出的最小骨架方向为：

```text
project/
  AGENTS.md
  agents/
    <child-agent>/
      AGENTS.md
      agents/
  .codex/
    agents/
    skills/
    rules/
    config.toml
  .loong/
    runtime/
    state/
    logs/
    memory/
    psmux/
```

说明：
- 根目录即根 supervisor 节点
- `agents/` 表达组织树
- `.codex/` 承载 Codex 原生能力
- `.loong/` 承载 loong 的通用运行时能力
- 先不额外强制节点本地上下文文件

## Testable Acceptance Criteria
- 用户通过 npm 安装后能获得 `loong` 命令
- `loong init` 能在当前目录生成一套通用骨架与模板资产
- 用户修改目录中的 `AGENTS.md`、`agents/`、`.codex/` 相关定义后，`loong run` 能读取并驱动运行
- `loong run` 默认以后台守护模式运行，而不是强制进入前台交互会话
- 系统支持并行 agent 执行，并可通过 `psmux` 可视化观察
- 系统支持核心团队常驻并保留稳定身份、成员、职责和上下文
- 系统支持部分团队按阶段临时拉起并在完成后解散
- 团队可在授权范围内自行持续推进工作，而 supervisor 以主动巡检和纠偏方式监督
- supervisor 既支持固定周期巡检，也支持状态变化触发巡检
- 当流程触发现实主体动作时，系统能显式暂停并请求人工介入
- 项目更换业务场景时，主要通过调整目录资产完成，而不是修改 `loong` 内核
- 树上的节点代表长期组织单元；不值得建节点的短任务由 `skill` 执行
- 不需要另行维护一套独立结构文件来描述组织树
- `skills` 位于 `.codex/skills/`，而不是单独的 loong 组织树目录
- `state/logs/runtime/memory` 等通用运行时数据位于 `.loong/`

## Assumptions Exposed And Resolutions
- Assumption: 项目是自建长期运行 Agent runtime
  - Resolution: 否。项目被重新定义为 Codex CLI 的增强与编排层
- Assumption: 框架需要提供大量业务内置内容
  - Resolution: 否。`loong` 只提供通用骨架，业务内容由项目目录资产定义
- Assumption: 运行模型应是 supervisor 细粒度派发任务
  - Resolution: 否。更符合需求的是 supervisor 委派团队，上层主动巡检和纠偏
- Assumption: 下层需要频繁向上汇报
  - Resolution: 否。监督模式采用上层主动 pull 式检查，而不是下层 push 式汇报
- Assumption: 核心团队可被频繁重建
  - Resolution: 否。核心团队应保持稳定身份、成员、职责与连续上下文
- Assumption: 组织/循环嵌套关系应由独立定义文件维护
  - Resolution: 否。目录层级本身应直接表达组织树与嵌套深度
- Assumption: supervisor 与 team 节点应使用不同模板
  - Resolution: 否。节点结构应统一，只是内容和职责不同
- Assumption: `worker lane` 需要作为独立概念保留
  - Resolution: 否。若无持续身份与记忆，则视为 `skill`；若有持续身份、上下文和职责，则应视为 `节点/agent`
- Assumption: 技能应作为 loong 自己的节点目录能力定义
  - Resolution: 否。`skills` 应复用 Codex 原生 `.codex/skills/`
- Assumption: 节点本地上下文入口文件必须固定
  - Resolution: 否。业务上下文由使用者自行规划；loong 只提供通用运行时能力

## Pressure-pass Findings
- 被回压的核心假设: “`loong run` 可以被建模成细粒度任务编排器”
- 回压结果: 用户通过“APP 还没生产出来”的场景明确否定该模型，要求用团队委派和长期自治推进来建模；随后又将目录树收敛为组织控制面，并将概念简化为 `节点/agent + skill`
- 设计含义: 后续架构重点必须放在：
  - 团队定义
  - 团队身份与记忆
  - supervisor 巡检和纠偏机制
  - 团队内部自循环
  - 节点树解释执行
  - skill 调用边界
  - Codex-native 与 loong-native 目录边界
  而不是单纯的 lane/exec 调度

## Technical Context Findings
- 仓库当前无业务代码，只有 `.git` 与 `.omx`
- 参考产品 `oh-my-codex` 的 README 明确将自己定位为 `workflow layer for OpenAI Codex CLI`
- 用户设定的产品入口为 `loong init` / `loong run`
- 运行形态已明确为后台守护式，并带 `psmux` 观测需求
- 官方 Codex 文档当前明确有 `AGENTS.md`、`Skills`、`Subagents`、`Rules`、`Hooks`、`MCP`、`Config`、`Non-interactive mode` 等能力，可直接复用

## Residual Risks
- 如果后续实现把团队抽象得过轻，会重新滑回“任务调度器”路线
- 如果团队身份与上下文持久化边界不清，核心团队的连续性会丢失
- 如果巡检机制设计得太弱，supervisor 无法有效纠偏
- 如果巡检机制设计得太重，又会退化成频繁人工微管控
- `psmux` 作为观测层会约束进程/会话组织方式，需尽早纳入设计
- 如果 Codex-native 与 loong-native 的边界切得不好，会导致目录重复或责任混乱
