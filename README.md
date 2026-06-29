# CxLoongAgent

`loong` 是围绕 OpenAI Codex 的薄工作流层，用目录资产表达长期运行的代理组织树，并用 `.loong/` 保存运行状态、记忆、计划、日志、工作单和人工介入请求。

当前版本范围为 `v0.1.0`：

- `loong init`：在空目录中初始化一个最小节点工作空间
- `loong init --org-file <file>`：按组织架构 JSON 在当前目录下创建根节点目录并递归初始化节点工作区
- `loong run`：启动后台长期运行进程，并默认进入观察界面
- `loong observe`：只读观察当前工作区及子代理的运行状态
- `loong stop`：停止当前工作区的后台运行进程
- `loong run --once`：只执行一个运行轮次，便于测试和调试
- `loong clear`：递归清理当前节点及子代理的运行时输出，保留代理说明和配置

## 基本运作逻辑

`loong` 的核心模型是“递归节点 + 独立工作空间 + 工作单通信”。

每个节点都是一个独立的代理工作空间。根目录是根节点，`agents/` 下的直接子目录是该节点可委派的子节点。父节点与子节点不是共享同一个项目目录；运行时会分别以各自节点目录作为 Codex 的 `workingDirectory` 启动 Codex 线程。

因此，父子节点之间不能依赖直接读写彼此的业务文件来协作。父节点只能通过自己的 `.loong/work-orders/outbox/` 创建工作单并把附件放入 `input/` 文件夹；框架会把工作单和 `input/` 同步到子节点自己的 `.loong/work-orders/inbox/`。子节点完成后，在自己的 inbox 工作单目录中提交 `completion-report.md` 并把交付物放入 `output/` 文件夹；框架再把这些结果同步回父节点对应的 outbox 工作单目录。

`AGENTS.md` 用来描述当前节点可见的业务上下文和角色约束，不应该重复框架协议。工作计划、日志、记忆、工作单、人工介入、最终 JSON 返回等运行规则由 `loong` 注入到 Codex 提示词中；当前工作目录也由 Codex 的 `workingDirectory` 动态提供。

运行循环由 `AgentRuntime` 负责：

1. 同步子节点已完成的工作单结果到父节点。
2. 将当前节点 outbox 中仍活动的工作单同步到对应子节点。
3. 调用 Codex 执行一个轮次，并要求返回结构化运行状态。
4. 校验返回状态、计划、日志、记忆、工作单和人工介入请求。
5. 将当前运行快照写入 `.loong/runtime/state.json`，并将本轮状态追加写入 `.loong/runtime/state-log.jsonl`。
6. 如果新产生了委派工作单，启动对应子节点的运行循环。
7. 根据 `next_action` 和 `sleep_duration` 决定停止、继续或等待工作单/人工请求状态变化后唤醒。

默认的 `loong run` 会先确保后台 daemon 正在运行，再拉起 `loong observe`。观察界面只读取 `.loong/` 中已经落盘的事件、计划和状态；退出观察界面不会停止后台运行。如只想启动后台进程不进入观察界面，可使用 `loong run --no-observe`。

## 目录职责

初始化后的最小工作空间形态如下：

```text
project/
  AGENTS.md
  agents/
  .loong/
    runtime/
      config.json
      daemon.json
      daemon.log
      state.json
      state-log.jsonl
      turn-events.jsonl
      log.txt
    memory/
      world-model.md
      learned.md
    work-plans/
    work-logs/
    work-orders/
      inbox/
      outbox/
    human-requests/
  .codex/
    skills/
    rules/
    config.toml
```

目录含义：

- `AGENTS.md`：当前节点的业务上下文和角色约束。
- `agents/`：当前节点的直接子节点；目录树即组织树。
- `.loong/`：`loong` 的运行时数据，由框架协议管理。
- `.codex/`：Codex 原生能力配置，例如 skills、rules 和 config。

每个节点的 `.loong/runtime/config.json` 保存节点身份与运行选项，包含 `name`、`position`、`description`、`sort_index`、`never_stop` 等字段。`sort_index` 用于控制同一父节点下的子节点排序；普通读取旧配置时缺省为 `0`，通过 `loong init --org-file` 初始化且组织文件未显式填写时，根节点为 `0`，子节点使用其在同级 `children` 数组中的索引。排序时数值越小越靠前，数值相同时按子节点目录名排序。

## 命令

```bash
loong init
loong init --org-file ./organization.json
loong clear
loong run
loong run --no-observe
loong run --once
loong observe
loong observe --once
loong stop
```

开发时也可以直接使用源码入口：

```bash
pnpm start -- init
pnpm start -- init --org-file ./organization.json
pnpm start -- clear
pnpm start -- run
pnpm start -- run --once
pnpm start -- observe --once
```

## 开发

测试体系保持轻量，重点验证运行协议和文件契约：

- `tests/runtime/`：运行时契约测试，使用临时目录和 fake Codex 响应。
- `tests/smoke/`：真实 CLI 入口冒烟测试，以及可选 Codex canary。
- `tests/helpers/`：共享测试辅助工具。

常用命令：

```bash
pnpm test
pnpm test:smoke
pnpm typecheck
pnpm check
```

可选 Codex canary：

```powershell
$env:OPENAI_API_KEY="your-key"
$env:LOONG_ENABLE_CODEX_CANARY="1"
pnpm test:canary
```
