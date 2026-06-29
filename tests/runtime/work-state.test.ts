import { describe, expect, test } from "vitest";
import { get_work_state_prompt } from "../../src/prompt/work-state.js";
import { get_state_log_path } from "../../src/runtime/state.js";
import { append_jsonl } from "../../src/storage/doc.js";
import {
  create_valid_loop_state,
  create_workspace,
  write_completion_report,
  write_human_request,
  write_inbox_work_order,
  write_outbox_work_order,
} from "../helpers/workspace.js";

function extract_section(prompt: string, title: string): string {
  const lines = prompt.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${title}`);
  expect(start, `expected section ${title}`).toBeGreaterThanOrEqual(0);
  const content: string[] = [];
  let in_fence = false;
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.startsWith("```")) {
      in_fence = !in_fence;
      content.push(line);
      continue;
    }
    if (!in_fence && /^##\s+/.test(line)) break;
    content.push(line);
  }
  return content.join("\n").trim();
}

describe("work state prompt", () => {
  test("builds the current work state from runtime files instead of hard-coded text fragments", () => {
    const work_dir = create_workspace("work-state-full");
    const inbox_path = write_inbox_work_order(work_dir);
    const outbox_path = write_outbox_work_order(work_dir, {
      executor: "worker",
      summary: "交付测试结果",
    });
    write_completion_report(work_dir, {
      box: "outbox",
      check_status: "passed",
    });
    const request_path = write_human_request(work_dir, {
      summary: "需要完成收款账号配置",
      status: "waiting",
    });
    const state = create_valid_loop_state(work_dir);
    append_jsonl(get_state_log_path(work_dir), state);

    const prompt = get_work_state_prompt(work_dir);
    const memory = extract_section(prompt, "记忆");
    const mainline = extract_section(prompt, "工作主线");
    const last_log = extract_section(prompt, "上一轮工作日志");
    const last_plan = extract_section(prompt, "上一轮计划完成情况");
    const outbox_index = extract_section(prompt, "工作委派索引");
    const human_requests = extract_section(prompt, "人工介入请求");

    expect(memory).toContain("/.loong/memory/world-model.md");
    expect(memory).toContain("/.loong/memory/learned.md");

    expect(mainline).toContain(inbox_path);
    expect(mainline).toContain("# 工作单");

    expect(last_log).toContain(state.log);
    expect(last_log).toContain("# 工作日志");

    expect(last_plan).toContain(state.plan);
    expect(last_plan).toContain('"turn_id": "000001"');

    expect(outbox_index).toContain(outbox_path);
    expect(outbox_index).toContain("- summary: 交付测试结果");
    expect(outbox_index).toContain("- executor: worker");
    expect(outbox_index).toContain("- status: completed");
    expect(outbox_index).toContain(
      ".loong/work-orders/outbox/20260421T000000-order-1/completion-report.md",
    );

    expect(human_requests).toContain(request_path);
    expect(human_requests).toContain("需要完成收款账号配置");
    expect(human_requests).toContain("status: waiting");
  });

  test("falls back to an empty memory marker when no runtime artifacts are available", () => {
    const work_dir = create_workspace("work-state-empty-memory");

    const prompt = get_work_state_prompt(`${work_dir}/missing-node`);

    expect(prompt).toContain("## 记忆\n空");
    expect(prompt).not.toContain("## 工作主线");
    expect(prompt).not.toContain("## 上一轮工作日志");
    expect(prompt).not.toContain("## 工作委派索引");
    expect(prompt).not.toContain("## 人工介入请求");
  });
});
