import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { create_file_turn_observer } from "../../src/observe/file.js";
import { create_usage_turn_observer } from "../../src/observe/usage.js";
import { get_turn_events_log_path, get_turn_result_state_path } from "../../src/runtime/log.js";
import { read_agent_run_state } from "../../src/runtime/run-state.js";
import type { LoopState } from "../../src/runtime/state.js";
import { TurnRunner, TurnValidationExhaustedError } from "../../src/runtime/turn.js";
import {
  create_child_agent,
  create_valid_loop_state,
  create_workspace,
  write_completion_report,
  write_human_request,
  write_inbox_work_order,
  write_outbox_work_order,
  write_work_check_report,
} from "../helpers/workspace.js";

type TurnResultInput = Partial<LoopState> | Record<string, unknown> | string | null;

function to_turn_result_state(state: Partial<LoopState> | Record<string, unknown>) {
  const { turn_id: _turn_id, updated_at: _updated_at, ...result } = state;
  return result;
}

function write_turn_result_state(work_dir: string, value: TurnResultInput) {
  const file_path = get_turn_result_state_path(work_dir, "000001");
  fs.mkdirSync(path.dirname(file_path), { recursive: true });
  if (value === null) {
    fs.rmSync(file_path, { force: true });
    return;
  }
  const text = typeof value === "string" ? value : JSON.stringify(to_turn_result_state(value));
  fs.writeFileSync(file_path, `${text}\n`, "utf-8");
}

function git(work_dir: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: work_dir,
    encoding: "utf-8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim());
  }
  return result.stdout.trim();
}

function commit_workspace(work_dir: string): void {
  git(work_dir, ["add", "-A"]);
  git(work_dir, [
    "-c",
    "user.name=loong",
    "-c",
    "user.email=loong@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "test checkpoint",
  ]);
}

function create_planless_loop_state(work_dir: string) {
  const state = create_valid_loop_state(work_dir);
  fs.rmSync(path.join(work_dir, state.plan), { force: true });
  state.plan = "";
  return state;
}

async function* create_completed_turn_events(response: string, message_id = "message") {
  yield { type: "turn.started" } as const;
  yield {
    type: "item.completed",
    item: {
      id: message_id,
      type: "agent_message",
      text: response,
    },
  } as const;
  yield {
    type: "turn.completed",
    usage: {
      input_tokens: 1,
      cached_input_tokens: 0,
      output_tokens: 1,
      reasoning_output_tokens: 0,
    },
  } as const;
}

async function* create_sdk_error_events(message: string) {
  yield { type: "turn.started" } as const;
  yield { type: "error", message } as const;
}

function create_codex_factory(
  work_dir: string,
  turn_results: TurnResultInput[],
  responses: string[] = [],
) {
  let call_count = 0;
  return {
    get_call_count() {
      return call_count;
    },
    factory() {
      return {
        startThread() {
          return {
            async runStreamed(_input: string) {
              const result = turn_results[Math.min(call_count, turn_results.length - 1)];
              write_turn_result_state(work_dir, result);
              const response =
                responses[Math.min(call_count, responses.length - 1)] ?? "最终状态文件已写入。";
              call_count += 1;
              return {
                events: create_completed_turn_events(response, `message-${call_count}`),
              };
            },
          };
        },
      };
    },
  };
}

describe("TurnRunner", () => {
  test("retries after validation failure and stamps metadata on success", async () => {
    const work_dir = create_workspace("turn-retry");
    const invalid_state = create_valid_loop_state(work_dir);
    invalid_state.is_memory_updated = false;
    const valid_state = create_valid_loop_state(work_dir);
    const codex = create_codex_factory(work_dir, [invalid_state, valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(codex.get_call_count()).toBe(2);
    expect(result.turn_id).toBe("000001");
    expect(result.updated_at).toBe("2026-04-21T08:00:00.000Z");
    expect(fs.existsSync(get_turn_result_state_path(work_dir, "000001"))).toBe(false);
  });

  test("uses the turn result file when the final agent message is not JSON", async () => {
    const work_dir = create_workspace("turn-result-file");
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [valid_state], ["状态文件已写入。"]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(result.next_action).toBe("stop");
  });

  test("retries SDK stream errors before completing the turn", async () => {
    const work_dir = create_workspace("turn-sdk-error-retry");
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.next_action = "stop";
    const sleeps: number[] = [];
    const inputs: string[] = [];
    let call_count = 0;
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: () => ({
        startThread() {
          return {
            async runStreamed(input: string) {
              inputs.push(input);
              call_count += 1;
              if (call_count === 1) {
                return { events: create_sdk_error_events("stream disconnected") };
              }
              write_turn_result_state(work_dir, valid_state);
              return {
                events: create_completed_turn_events(
                  "最终状态文件已写入。",
                  `message-${call_count}`,
                ),
              };
            },
          };
        },
      }),
      prompt_factory: () => "原始输入",
      now: () => new Date("2026-04-21T08:00:00.000Z"),
      sleep: async (delay) => {
        sleeps.push(delay);
      },
    });

    const result = await runner.run();

    expect(result.next_action).toBe("stop");
    expect(call_count).toBe(2);
    expect(inputs[0]).toBe("原始输入");
    expect(inputs[1]).toBeDefined();
    expect(inputs[1]).not.toBe("原始输入");
    expect(sleeps).toEqual([10_000]);
  });

  test("throws to the outer runtime after exhausting SDK error retries", async () => {
    const work_dir = create_workspace("turn-sdk-error-exhausted");
    const sleeps: number[] = [];
    const inputs: string[] = [];
    let call_count = 0;
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: () => ({
        startThread() {
          return {
            async runStreamed(input: string) {
              inputs.push(input);
              call_count += 1;
              return { events: create_sdk_error_events("stream disconnected") };
            },
          };
        },
      }),
      prompt_factory: () => "原始输入",
      sleep: async (delay) => {
        sleeps.push(delay);
      },
    });

    await expect(runner.run()).rejects.toThrow("SDK 错误重试 10 次仍失败");

    expect(call_count).toBe(11);
    const retry_inputs = inputs.slice(1);
    expect(inputs[0]).toBe("原始输入");
    expect(retry_inputs).toHaveLength(10);
    expect(retry_inputs.every((input) => input !== "原始输入")).toBe(true);
    expect(new Set(retry_inputs).size).toBe(1);
    expect(sleeps).toEqual(Array.from({ length: 10 }, () => 10_000));
  });

  test("repairs non-strict JSON in the turn result file before validation", async () => {
    const work_dir = create_workspace("turn-result-repair");
    const valid_state = to_turn_result_state(create_valid_loop_state(work_dir));
    const repaired_text = `\`\`\`json
{
  plan: '${valid_state.plan}',
  log: '${valid_state.log}',
  delegated_work_orders: [],
  human_requests: [],
  is_memory_updated: true,
  summary: '本轮完成了测试准备。',
  next_action: 'stop',
  sleep_duration: 0,
}
\`\`\``;
    const codex = create_codex_factory(work_dir, [repaired_text]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(result.next_action).toBe("stop");
  });

  test("retries when the turn result file is missing or cannot be repaired", async () => {
    const work_dir = create_workspace("turn-result-missing");
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [null, "not json", valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(codex.get_call_count()).toBe(3);
    expect(result.next_action).toBe("stop");
  });

  test("retries when the turn result file has the wrong structure", async () => {
    const work_dir = create_workspace("turn-result-structure");
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [{ plan: 123 }, valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(codex.get_call_count()).toBe(2);
    expect(result.next_action).toBe("stop");
  });

  test("forces next_action to continue when the turn delegates work", async () => {
    const work_dir = create_workspace("turn-delegate");
    create_child_agent(work_dir);
    const delegated_work_order = write_outbox_work_order(work_dir);
    write_completion_report(work_dir, {
      box: "outbox",
    });
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.delegated_work_orders = [delegated_work_order];
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(result.next_action).toBe("continue");
  });

  test("forces next_action to continue when the turn creates a human request", async () => {
    const work_dir = create_workspace("turn-human-request");
    const human_request = write_human_request(work_dir);
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.human_requests = [human_request];
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(result.next_action).toBe("continue");
  });

  test("keeps bound execution turn sleep unless target report is ready", async () => {
    const waiting_dir = create_workspace("turn-bound-execution-waiting");
    const waiting_target = write_inbox_work_order(waiting_dir).replace(/\/work-order\.md$/, "");
    const waiting_state = create_valid_loop_state(waiting_dir);
    waiting_state.next_action = "stop";
    waiting_state.sleep_duration = 3600;
    const waiting_runner = new TurnRunner(waiting_dir, false, {
      codex_factory: create_codex_factory(waiting_dir, [waiting_state]).factory,
      turn_context: { turn_type: "execution", target_work_order_path: waiting_target },
    });

    const waiting_result = await waiting_runner.run();

    expect(waiting_result.next_action).toBe("continue");
    expect(waiting_result.sleep_duration).toBe(3600);

    const ready_dir = create_workspace("turn-bound-execution-ready");
    const ready_target = write_inbox_work_order(ready_dir).replace(/\/work-order\.md$/, "");
    write_completion_report(ready_dir);
    const ready_state = create_valid_loop_state(ready_dir);
    ready_state.sleep_duration = 3600;
    const ready_runner = new TurnRunner(ready_dir, false, {
      codex_factory: create_codex_factory(ready_dir, [ready_state]).factory,
      turn_context: { turn_type: "execution", target_work_order_path: ready_target },
    });

    const ready_result = await ready_runner.run();

    expect(ready_result.next_action).toBe("continue");
    expect(ready_result.sleep_duration).toBe(0);
  });

  test("overrides next_action for work check and repair turns", async () => {
    const passed_dir = create_workspace("turn-work-check-passed");
    const passed_target = write_inbox_work_order(passed_dir).replace(/\/work-order\.md$/, "");
    write_completion_report(passed_dir, { check_status: "pending" });
    write_work_check_report(passed_dir, { open_issue_count: 0 });
    commit_workspace(passed_dir);
    const passed_state = create_planless_loop_state(passed_dir);
    passed_state.next_action = "continue";
    passed_state.sleep_duration = 3600;
    const passed_runner = new TurnRunner(passed_dir, false, {
      codex_factory: create_codex_factory(passed_dir, [passed_state]).factory,
      turn_context: { turn_type: "work_check", target_work_order_path: passed_target },
    });

    const passed_result = await passed_runner.run();

    expect(passed_result.next_action).toBe("stop");
    expect(passed_result.sleep_duration).toBe(0);

    const failed_dir = create_workspace("turn-work-check-failed");
    const failed_target = write_inbox_work_order(failed_dir).replace(/\/work-order\.md$/, "");
    write_completion_report(failed_dir, { check_status: "pending" });
    write_work_check_report(failed_dir, { open_issue_count: 1 });
    commit_workspace(failed_dir);
    const failed_state = create_planless_loop_state(failed_dir);
    failed_state.next_action = "stop";
    failed_state.sleep_duration = 3600;
    const failed_runner = new TurnRunner(failed_dir, false, {
      codex_factory: create_codex_factory(failed_dir, [failed_state]).factory,
      turn_context: { turn_type: "work_check", target_work_order_path: failed_target },
    });

    const failed_result = await failed_runner.run();

    expect(failed_result.next_action).toBe("continue");
    expect(failed_result.sleep_duration).toBe(0);

    const repair_dir = create_workspace("turn-repair-continue");
    const repair_target = write_inbox_work_order(repair_dir).replace(/\/work-order\.md$/, "");
    write_completion_report(repair_dir, { check_status: "failed" });
    write_work_check_report(repair_dir, { open_issue_count: 1 });
    commit_workspace(repair_dir);
    const repair_state = create_planless_loop_state(repair_dir);
    repair_state.next_action = "stop";
    repair_state.sleep_duration = 3600;
    const repair_runner = new TurnRunner(repair_dir, false, {
      codex_factory: create_codex_factory(repair_dir, [repair_state]).factory,
      turn_context: { turn_type: "repair", target_work_order_path: repair_target },
    });

    const repair_result = await repair_runner.run();

    expect(repair_result.next_action).toBe("continue");
    expect(repair_result.sleep_duration).toBe(0);
  });

  test("normalizes missing nullable work lists to empty arrays", async () => {
    const work_dir = create_workspace("turn-null-work-lists");
    const valid_state = create_valid_loop_state(work_dir) as unknown as Record<string, unknown>;
    valid_state.delegated_work_orders = null;
    valid_state.human_requests = undefined;
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    const result = await runner.run();

    expect(result.delegated_work_orders).toEqual([]);
    expect(result.human_requests).toEqual([]);
    expect(result.next_action).toBe("stop");
  });

  test("publishes streamed turn events to the observer", async () => {
    const work_dir = create_workspace("turn-observer");
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [valid_state]);
    const events: string[] = [];
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
      observer: {
        turn_started(context) {
          events.push(`started:${context.turn_id}:${context.attempt}`);
        },
        codex_event(event) {
          events.push(`event:${event.type}`);
        },
        state_ready(state) {
          events.push(`state:${state.next_action}`);
        },
        turn_finished() {
          events.push("finished");
        },
      },
    });

    await runner.run();

    expect(events).toEqual([
      "started:000001:1",
      "event:turn.started",
      "event:item.completed",
      "event:turn.completed",
      "state:stop",
      "finished",
    ]);
  });

  test("file observer appends turn events to the runtime event log", async () => {
    const work_dir = create_workspace("turn-file-observer");
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
      observer: create_file_turn_observer(work_dir),
    });

    await runner.run();

    const events = fs
      .readFileSync(get_turn_events_log_path(work_dir), "utf-8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as { type: string; event?: { type: string } });
    expect(events.map((event) => event.type)).toEqual([
      "turn.started",
      "codex.event",
      "codex.event",
      "codex.event",
      "state.ready",
      "turn.finished",
    ]);
    expect(events[1].event?.type).toBe("turn.started");
  });

  test("throws after exhausting validation retries", async () => {
    const work_dir = create_workspace("turn-fail");
    const invalid_state = create_valid_loop_state(work_dir);
    invalid_state.summary = " ";
    const codex = create_codex_factory(work_dir, [invalid_state, invalid_state, invalid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    await expect(runner.run()).rejects.toBeInstanceOf(TurnValidationExhaustedError);
    expect(codex.get_call_count()).toBe(3);
  });

  test("usage observer accumulates completed codex turns including validation retries", async () => {
    const work_dir = create_workspace("turn-usage");
    const invalid_state = create_valid_loop_state(work_dir);
    invalid_state.summary = " ";
    const valid_state = create_valid_loop_state(work_dir);
    valid_state.next_action = "stop";
    const codex = create_codex_factory(work_dir, [invalid_state, valid_state]);
    const runner = new TurnRunner(work_dir, true, {
      codex_factory: codex.factory,
      observer: create_usage_turn_observer(work_dir),
    });

    await runner.run();

    expect(read_agent_run_state(work_dir)?.usage).toMatchObject({
      input_tokens: 2,
      cached_input_tokens: 0,
      output_tokens: 2,
      total_tokens: 4,
      updated_at: expect.any(String),
    });
  });
});
