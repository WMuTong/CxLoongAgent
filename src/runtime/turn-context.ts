export type TurnType = "execution" | "work_check" | "repair";

export type TurnRunContext = {
  turn_type: TurnType;
  target_work_order_path: string | null;
};

export function create_execution_turn_context(
  target_work_order_path: string | null = null,
): TurnRunContext {
  return {
    turn_type: "execution",
    target_work_order_path,
  };
}
