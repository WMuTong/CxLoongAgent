import type { ThreadEvent } from "@openai/codex-sdk";
import { create_agent_run_state_store } from "../runtime/run-state.js";
import type { TurnObserver, TurnObserverContext } from "./types.js";

export class UsageTurnObserver implements TurnObserver {
  constructor(readonly work_dir: string) {}

  codex_event(event: ThreadEvent, _context: TurnObserverContext): void {
    if (event.type !== "turn.completed") return;
    create_agent_run_state_store(this.work_dir).add_usage(event.usage);
  }
}

export function create_usage_turn_observer(work_dir: string): UsageTurnObserver {
  return new UsageTurnObserver(work_dir);
}
