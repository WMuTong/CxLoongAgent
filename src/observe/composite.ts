import type { ThreadEvent } from "@openai/codex-sdk";
import type { LoopState } from "../runtime/state.js";
import type { TurnObserver, TurnObserverContext } from "./types.js";

export class CompositeTurnObserver implements TurnObserver {
  readonly #observers: TurnObserver[];

  constructor(observers: Array<TurnObserver | null | undefined>) {
    this.#observers = observers.filter((observer): observer is TurnObserver => !!observer);
  }

  turn_started(context: TurnObserverContext): void {
    for (const observer of this.#observers) {
      observer.turn_started?.(context);
    }
  }

  codex_event(event: ThreadEvent, context: TurnObserverContext): void {
    for (const observer of this.#observers) {
      observer.codex_event?.(event, context);
    }
  }

  validation_failed(message: string, context: TurnObserverContext): void {
    for (const observer of this.#observers) {
      observer.validation_failed?.(message, context);
    }
  }

  state_ready(state: LoopState, context: TurnObserverContext): void {
    for (const observer of this.#observers) {
      observer.state_ready?.(state, context);
    }
  }

  turn_failed(error: unknown, context: TurnObserverContext): void {
    for (const observer of this.#observers) {
      observer.turn_failed?.(error, context);
    }
  }

  async turn_finished(context: TurnObserverContext): Promise<void> {
    for (const observer of this.#observers) {
      await observer.turn_finished?.(context);
    }
  }
}

export function combine_turn_observers(
  observers: Array<TurnObserver | null | undefined>,
): TurnObserver | null {
  const active_observers = observers.filter((observer): observer is TurnObserver => !!observer);
  if (active_observers.length === 0) return null;
  if (active_observers.length === 1) return active_observers[0];
  return new CompositeTurnObserver(active_observers);
}
