import { type TurnRunContext, create_execution_turn_context } from "../runtime/turn-context.js";
import { build_execution_system_prompt } from "./execution-prompt.js";
import { build_repair_system_prompt } from "./repair-prompt.js";
import { build_work_check_system_prompt } from "./work-check-prompt.js";

export function get_system_prompt(
  work_dir: string,
  is_root = true,
  turn_context: TurnRunContext = create_execution_turn_context(),
): string {
  if (turn_context.turn_type === "work_check") {
    return build_work_check_system_prompt(work_dir, is_root, turn_context);
  }
  if (turn_context.turn_type === "repair") {
    return build_repair_system_prompt(work_dir, is_root, turn_context);
  }
  return build_execution_system_prompt(work_dir, is_root, turn_context);
}
