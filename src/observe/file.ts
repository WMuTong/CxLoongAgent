import type { ThreadEvent } from "@openai/codex-sdk";
import { append_turn_event } from "../runtime/log.js";
import type { LoopState } from "../runtime/state.js";
import type { TurnObserver, TurnObserverContext } from "./types.js";

type FileTurnEvent =
  | {
      type: "turn.started";
      recorded_at: string;
      context: TurnObserverContext;
    }
  | {
      type: "codex.event";
      recorded_at: string;
      context: TurnObserverContext;
      event: ThreadEvent;
    }
  | {
      type: "validation.failed";
      recorded_at: string;
      context: TurnObserverContext;
      message: string;
    }
  | {
      type: "state.ready";
      recorded_at: string;
      context: TurnObserverContext;
      state: LoopState;
    }
  | {
      type: "turn.failed";
      recorded_at: string;
      context: TurnObserverContext;
      error: string;
    }
  | {
      type: "turn.finished";
      recorded_at: string;
      context: TurnObserverContext;
    };

export class FileTurnObserver implements TurnObserver {
  constructor(readonly work_dir: string) {}

  turn_started(context: TurnObserverContext): void {
    this.#append({
      type: "turn.started",
      recorded_at: this.#now(),
      context,
    });
  }

  codex_event(event: ThreadEvent, context: TurnObserverContext): void {
    this.#append({
      type: "codex.event",
      recorded_at: this.#now(),
      context,
      event,
    });
  }

  validation_failed(message: string, context: TurnObserverContext): void {
    this.#append({
      type: "validation.failed",
      recorded_at: this.#now(),
      context,
      message,
    });
  }

  state_ready(state: LoopState, context: TurnObserverContext): void {
    this.#append({
      type: "state.ready",
      recorded_at: this.#now(),
      context,
      state,
    });
  }

  turn_failed(error: unknown, context: TurnObserverContext): void {
    this.#append({
      type: "turn.failed",
      recorded_at: this.#now(),
      context,
      error: stringify_error(error),
    });
  }

  turn_finished(context: TurnObserverContext): void {
    this.#append({
      type: "turn.finished",
      recorded_at: this.#now(),
      context,
    });
  }

  #append(event: FileTurnEvent): void {
    append_turn_event(this.work_dir, event);
  }

  #now(): string {
    return new Date().toISOString();
  }
}

export function create_file_turn_observer(work_dir: string): FileTurnObserver {
  return new FileTurnObserver(work_dir);
}

function stringify_error(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}
