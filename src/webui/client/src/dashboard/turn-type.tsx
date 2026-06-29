import { Shield, Workflow, Wrench } from "lucide-react";

export type TurnType = "execution" | "work_check" | "repair";

export function normalize_turn_type(value: string | null | undefined): TurnType {
  if (value === "work_check" || value === "repair") return value;
  return "execution";
}

export function turn_type_label(value: string | null | undefined): string {
  const type = normalize_turn_type(value);
  if (type === "work_check") return "检查轮次";
  if (type === "repair") return "修复轮次";
  return "执行轮次";
}

export function TurnTypeIcon({
  className = "h-3.5 w-3.5",
  type,
}: {
  className?: string;
  type: string | null | undefined;
}) {
  const normalized = normalize_turn_type(type);
  const Icon = normalized === "work_check" ? Shield : normalized === "repair" ? Wrench : Workflow;
  return <Icon className={className} />;
}

export function TurnTypeBadge({
  selected = false,
  type,
}: {
  compact?: boolean;
  selected?: boolean;
  type: string | null | undefined;
}) {
  const label = turn_type_label(type);
  const className = selected ? "text-primary-foreground" : "text-primary";
  return (
    <span
      aria-label={label}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center ${className}`}
      title={label}
    >
      <TurnTypeIcon className="h-4 w-4" type={type} />
    </span>
  );
}

export function TurnReference({
  selected = false,
  turnId,
  type,
}: {
  selected?: boolean;
  turnId: string | null | undefined;
  type?: string | null;
}) {
  if (!turnId) return <span>-</span>;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <TurnTypeBadge compact selected={selected} type={type} />
      <span className="min-w-0 truncate">{turnId}</span>
    </span>
  );
}
