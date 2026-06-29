import path from "node:path";
import { describe, expect, test } from "vitest";
import { load_agent_config, load_current_agent_name } from "../../src/agent/agent.js";
import { init } from "../../src/commands/init.js";
import { get_system_prompt } from "../../src/prompt/prompt.js";
import { create_workspace, write_file } from "../helpers/workspace.js";

function extract_fenced_blocks(prompt: string): string[] {
  return [...prompt.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)].map((match) => match[1] ?? "");
}

function find_block(prompt: string, marker: string): string {
  const block = extract_fenced_blocks(prompt).find((item) => item.includes(marker));
  expect(block, `expected fenced block containing ${marker}`).toBeDefined();
  return block ?? "";
}

function extract_top_level_section(prompt: string, title: string): string {
  const lines = prompt.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `# ${title}`);
  expect(start, `expected top-level section ${title}`).toBeGreaterThanOrEqual(0);
  const content: string[] = [];
  let in_fence = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) in_fence = !in_fence;
    if (!in_fence && line.startsWith("# ")) break;
    content.push(line);
  }
  return content.join("\n").trim();
}

function extract_child_agent_list(
  prompt: string,
): Array<{ name: string; position: string; description: string }> {
  const match = prompt.match(/你可以向以下 \d+ 个子代理委派工作：\n(\[[^\n]+\])/);
  expect(match?.[1], "expected child agent list").toBeDefined();
  return JSON.parse(match?.[1] ?? "[]") as Array<{
    name: string;
    position: string;
    description: string;
  }>;
}

describe("prompt contract", () => {
  test("describes the runtime protocol through directories, templates, and final state schema", () => {
    const work_dir = create_workspace("prompt-contract");
    init(path.join(work_dir, "agents", "worker"));
    const current_agent_name = load_current_agent_name(work_dir) ?? "unknown";

    const prompt = get_system_prompt(work_dir);
    const work_order_template = find_block(
      prompt,
      'summary: "<一句话概述该工作单要解决什么问题、交付什么结果>"',
    );
    const upstream_section = extract_top_level_section(prompt, "如何完成上级委派");
    const final_state_section = extract_top_level_section(prompt, "最终状态文件要求");
    const task_section = extract_top_level_section(prompt, "本轮任务");

    for (const section of [
      "# 工作空间边界",
      "# 工作心智",
      "# 多轮工作原则",
      "# /.loong 目录说明",
      "# 本轮任务",
      "# 如何完成上级委派",
      "# 数据落盘细则",
      "# 最终状态文件要求",
    ]) {
      expect(prompt).toContain(section);
    }
    expect(prompt).not.toMatch(/^# 工作推进流程$/m);
    expect(prompt).not.toMatch(/^# 结束会话前的检查$/m);
    expect(task_section.trimStart().startsWith("## 任务说明")).toBe(true);
    expect(task_section).toContain("## 工作推进流程");
    expect(task_section).toContain("## 结束会话前的检查");

    for (const required_path of [
      "/.loong/runtime",
      "/.loong/turn-results",
      "/.loong/memory",
      "/.loong/work-plans",
      "/.loong/work-orders/outbox",
      "/.loong/human-requests",
      "/.loong/work-logs",
    ]) {
      expect(prompt).toContain(required_path);
    }

    expect(prompt).not.toContain("/.loong/.system-log.jsonl");
    expect(prompt).not.toContain("/.loong/.config.json");
    expect(prompt).toContain("/.loong/turn-results/<turn_id>-state.json");
    expect(prompt).toContain("/.loong/turn-results/000001-state.json");
    expect(prompt).toContain("最终聊天消息不承载状态 JSON");
    expect(prompt).toMatch(/<turn_id>-<yyyyMMddTHHmmss>-request-<num>\.md/);
    expect(prompt).toMatch(/<yyyyMMddTHHmmss>-order-<num>/);
    expect(prompt).toContain("input/ 文件夹");
    expect(prompt).toContain("output/ 文件夹");
    expect(prompt).toMatch(/真实身份.*法律\/财务主体资格/s);
    expect(prompt).toMatch(/业务提示词.*明确要求.*人类介入/s);
    expect(prompt).toMatch(/补充什么信息或确认什么事项/s);
    expect(prompt).toContain("任务边界，不是待填空步骤");
    expect(prompt).toContain("计划应来自专业工作路径");
    expect(prompt).toContain("不能替代业务工作本身");
    expect(prompt).toContain("多轮不是失败或拖延");
    expect(prompt).toContain("每轮聚焦一个清晰子问题");
    expect(prompt).toContain("压缩后续部分的探索深度");
    expect(prompt).toContain("只规划当前轮次的一个子问题");
    expect(prompt).toContain("记忆只写增量长期信息，不写上下文备份");
    expect(prompt).toMatch(/禁止写入 AGENTS\.md、.*工作单、系统提示词中已有的要求/);
    expect(prompt).toContain("如果没有符合写入条件的新信息，可以不修改记忆文件");

    expect(work_order_template).toMatch(/turn_id:\s*"<turn_id>"/);
    expect(work_order_template).toContain(`delegator: "${current_agent_name}"`);
    expect(work_order_template).toMatch(/executor:\s*"<被委派的子代理姓名/);
    expect(work_order_template).toMatch(/# 工作单/);
    expect(work_order_template).toMatch(/## 背景/);
    expect(work_order_template).toMatch(/## 目标/);
    expect(work_order_template).toMatch(/## 验收标准/);
    expect(work_order_template).toMatch(/## 附件信息/);

    expect(upstream_section).toBe("你当前是根节点，没有上级节点。");

    for (const field of [
      '"plan"',
      '"log"',
      '"delegated_work_orders"',
      '"human_requests"',
      '"is_memory_updated"',
      '"summary"',
      '"next_action"',
      '"sleep_duration"',
    ]) {
      expect(final_state_section).toContain(field);
    }
    expect(final_state_section).toContain("没有符合写入条件的新信息");
    expect(final_state_section).toContain("也可以填 true");
    const runtime_context_index = prompt.indexOf("# 本轮运行上下文");
    expect(runtime_context_index).toBeGreaterThan(0);
    expect(prompt).toContain("- 当前轮次 turn_id: 000001");
    expect(prompt.indexOf("你可以向以下 1 个子代理委派工作")).toBeLessThan(runtime_context_index);
  });

  test("lists available child agents and binds delegation template to the current agent", () => {
    const work_dir = create_workspace("prompt-child");
    const child_dir = path.join(work_dir, "agents", "worker");
    init(child_dir);

    const prompt = get_system_prompt(work_dir);
    const work_order_template = find_block(prompt, "# 工作单");
    const child_agents = extract_child_agent_list(prompt);

    expect(child_agents).toHaveLength(1);
    expect(child_agents[0]).toMatchObject({
      position: "worker",
      description: "负责当前目录整体目标推进、监督与委派协调的节点",
    });
    expect(child_agents[0]?.name).toMatch(/^[\u4e00-\u9fa5]{2,4}$/);
    expect(prompt).toContain("name 表示子代理姓名，position 表示岗位");
    expect(work_order_template).toContain(`delegator: "${load_current_agent_name(work_dir)}"`);
  });

  test("embeds parent agent information for child agents", () => {
    const work_dir = create_workspace("prompt-parent");
    const child_dir = path.join(work_dir, "agents", "worker");
    init(child_dir);

    const parent_config = load_agent_config(work_dir);
    expect(parent_config).not.toBeNull();
    if (!parent_config) throw new Error("missing parent config");
    const parent = parent_config;
    const prompt = get_system_prompt(child_dir, false);
    const upstream_section = extract_top_level_section(prompt, "如何完成上级委派");
    const completion_report_template = find_block(prompt, "# 完成报告");

    expect(upstream_section).toContain("## 上级节点");
    expect(upstream_section).toContain('"name"');
    expect(upstream_section).toContain(parent.name);
    expect(upstream_section).toContain(parent.position);
    expect(upstream_section).toContain(parent.description);
    expect(upstream_section).toContain("上级会在它的 outbox 对应工作单中看到");
    expect(completion_report_template).toMatch(/turn_id:\s*"<turn_id>"/);
    expect(completion_report_template).toMatch(/delegator:\s*"<上级委派者名称/);
    expect(completion_report_template).toContain(
      `executor: "${load_current_agent_name(child_dir)}"`,
    );
    expect(completion_report_template).toMatch(/# 完成报告/);
    expect(completion_report_template).toMatch(/## 完成情况/);
    expect(completion_report_template).toMatch(/## 交付物/);
    expect(completion_report_template).toMatch(/## 验收项对照/);
    expect(completion_report_template).toMatch(/## 验证记录/);
  });

  test("tells the agent when no child agents are available", () => {
    const work_dir = create_workspace("prompt-no-child");

    const prompt = get_system_prompt(work_dir);

    expect(prompt).toMatch(/没有可用的子代理/);
    expect(prompt).not.toMatch(/你可以向以下 \d+ 个子代理委派工作/);
  });

  test("describes sleep duration rules for runtime wakeups and business waits", () => {
    const work_dir = create_workspace("prompt-sleep-rules");

    const prompt = get_system_prompt(work_dir);
    const final_state_section = extract_top_level_section(prompt, "最终状态文件要求");

    expect(final_state_section).toContain("completion-report.md 出现后提前唤醒");
    expect(final_state_section).toContain("status 变为 done 后提前唤醒");
    expect(final_state_section).toContain("填写 3600");
    expect(final_state_section).toContain("运行时无法监听");
    expect(final_state_section).toContain("自行判断等待秒数");
    expect(final_state_section).not.toContain("例如 60");
  });

  test("tells a never-stop root node to continue instead of stopping", () => {
    const work_dir = create_workspace("prompt-root-never-stop");
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

    const prompt = get_system_prompt(work_dir, true);
    const runtime_context_section = extract_top_level_section(prompt, "本轮运行上下文");

    expect(runtime_context_section).toContain("never_stop=true");
    expect(runtime_context_section).toContain('不能填写 "stop"');
    expect(runtime_context_section).toContain('填写 "continue"');
  });

  test("keeps work check turns focused on checking the target work order", () => {
    const work_dir = create_workspace("prompt-work-check");
    init(path.join(work_dir, "agents", "worker"));

    const prompt = get_system_prompt(work_dir, true, {
      turn_type: "work_check",
      target_work_order_path: ".loong/work-orders/inbox/20260421T000000-order-1",
    });
    const task_section = extract_top_level_section(prompt, "本轮任务");
    const runtime_context_section = extract_top_level_section(prompt, "本轮运行上下文");

    expect(prompt).toContain("turn_type: work_check");
    expect(prompt).toContain("work-check.md");
    expect(prompt).toContain("## /.loong/memory 记忆区");
    expect(prompt).toContain('"delegated_work_orders"');
    expect(prompt).toContain('"plan" 固定填写空字符串 ""');
    expect(prompt).not.toContain("/.loong/work-plans");
    expect(prompt).not.toContain("## 工作计划");
    expect(prompt).not.toContain("本轮任务类型");
    expect(prompt.indexOf("# 本轮任务")).toBeLessThan(prompt.indexOf("# 本轮运行上下文"));
    expect(prompt).not.toMatch(/^# 工作推进流程$/m);
    expect(prompt).not.toMatch(/^# 结束会话前的检查$/m);
    expect(task_section.trimStart().startsWith("## 任务说明")).toBe(true);
    expect(task_section).toContain("## 工作推进流程");
    expect(task_section).toContain("每个工作检查轮次都必须追加一个新的二级标题");
    expect(task_section).toContain("如果本轮没有新增问题，也必须在本轮二级标题下写入一句备注");
    expect(task_section).toContain("先依次核对 work-check.md 中所有待复查问题是否已被修复");
    expect(task_section).toContain(
      "确保没有直接修改 completion-report.md、output/ 交付物或业务成果",
    );
    expect(task_section).not.toContain("创建本轮计划文件");
    expect(task_section).not.toContain("确保本轮计划");
    expect(task_section).not.toContain("target_work_order_path:");
    expect(runtime_context_section).toContain(
      "目标工作单 target_work_order_path: .loong/work-orders/inbox/20260421T000000-order-1",
    );
    expect(prompt).not.toContain("# 如何委派工作");
    expect(prompt).not.toContain("# 如何完成上级委派");
    expect(prompt).not.toContain("你可以向以下 1 个子代理委派工作");
    expect(prompt).not.toContain("/.loong/human-requests");
  });

  test("keeps repair turns focused on fixing unresolved work check issues", () => {
    const work_dir = create_workspace("prompt-repair");
    init(path.join(work_dir, "agents", "worker"));

    const prompt = get_system_prompt(work_dir, true, {
      turn_type: "repair",
      target_work_order_path: ".loong/work-orders/inbox/20260421T000000-order-1",
    });
    const task_section = extract_top_level_section(prompt, "本轮任务");

    expect(prompt).toContain("turn_type: repair");
    expect(prompt).toContain("## /.loong/memory 记忆区");
    expect(prompt).toContain(
      "只修复“本轮变量”中的 target_work_order_path 指向的目标工作单目录中 work-check.md 记录的未修复问题",
    );
    expect(prompt).toContain('"plan" 固定填写空字符串 ""');
    expect(prompt).not.toContain("/.loong/work-plans");
    expect(prompt).not.toContain("## 工作计划");
    expect(prompt).not.toContain("本轮任务类型");
    expect(prompt).not.toMatch(/^# 工作推进流程$/m);
    expect(prompt).not.toMatch(/^# 结束会话前的检查$/m);
    expect(task_section.trimStart().startsWith("## 任务说明")).toBe(true);
    expect(task_section).toContain("## 工作推进流程");
    expect(task_section).not.toContain("创建本轮计划文件");
    expect(task_section).not.toContain("确保本轮计划");
    expect(task_section).toContain("状态都已更新为“待复查”");
    expect(prompt).not.toContain("# 如何委派工作");
    expect(prompt).not.toContain("# 如何完成上级委派");
    expect(prompt).not.toContain("你可以向以下 1 个子代理委派工作");
    expect(prompt).not.toContain("/.loong/human-requests");
  });
});
