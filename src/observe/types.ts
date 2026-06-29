import type { ThreadEvent, Usage } from "@openai/codex-sdk";
import type { LoopState } from "../runtime/state.js";
import type { TurnRunContext } from "../runtime/turn-context.js";

export type TurnObserverContext = {
  work_dir: string;
  is_root: boolean;
  turn_id: string;
  attempt: number;
  usage?: Usage | null;
} & TurnRunContext;

export interface TurnObserver {
  turn_started?(context: TurnObserverContext): void;
  codex_event?(event: ThreadEvent, context: TurnObserverContext): void;
  validation_failed?(message: string, context: TurnObserverContext): void;
  state_ready?(state: LoopState, context: TurnObserverContext): void;
  turn_failed?(error: unknown, context: TurnObserverContext): void;
  turn_finished?(context: TurnObserverContext): void | Promise<void>;
}
