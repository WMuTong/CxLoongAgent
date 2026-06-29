import { describe, expect, test, vi } from "vitest";
import { AgentRuntime } from "../../src/runtime/agent-runtime.js";
import { read_agent_run_state } from "../../src/runtime/run-state.js";
import { create_workspace } from "../helpers/workspace.js";

vi.mock("@openai/codex-sdk", () => ({
  Codex: class {
    startThread() {
      return {
        async runStreamed() {
          return { events: create_failed_turn_events() };
        },
      };
    }
  },
}));

async function* create_failed_turn_events() {
  yield { type: "turn.started" };
  yield {
    type: "item.completed",
    item: {
      id: "message-1",
      type: "agent_message",
      text: "not json",
    },
  };
  yield {
    type: "turn.completed",
    usage: {
      input_tokens: 11,
      cached_input_tokens: 3,
      output_tokens: 7,
      reasoning_output_tokens: 0,
    },
  };
}

describe("AgentRuntime usage tracking", () => {
  test("records completed Codex turn usage in the agent workspace when the turn fails later", async () => {
    const work_dir = create_workspace("agent-runtime-usage-failure");
    const runtime = new AgentRuntime(work_dir, true);

    await expect(runtime.run_once()).rejects.toThrow("最终状态文件不存在");

    expect(read_agent_run_state(work_dir)).toMatchObject({
      status: "failed",
      usage: {
        input_tokens: 33,
        cached_input_tokens: 9,
        output_tokens: 21,
        total_tokens: 54,
        updated_at: expect.any(String),
      },
    });
  });
});
