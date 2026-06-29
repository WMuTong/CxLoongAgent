export function format_time(value: string | null | undefined): string {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

export function format_datetime(value: string | null | undefined): string {
  if (!value || value === "-") return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getFullYear();
  const month = pad_datetime_part(date.getMonth() + 1);
  const day = pad_datetime_part(date.getDate());
  const hour = pad_datetime_part(date.getHours());
  const minute = pad_datetime_part(date.getMinutes());
  const second = pad_datetime_part(date.getSeconds());
  return `${year}/${month}/${day} ${hour}:${minute}:${second}`;
}

export function format_number(value: number | null | undefined): string {
  return new Intl.NumberFormat().format(value ?? 0);
}

export function format_compact_number(value: number | null | undefined): string {
  const normalized = value ?? 0;
  if (Math.abs(normalized) >= 1_000_000) {
    return `${trim_decimal(normalized / 1_000_000)}M`;
  }
  if (Math.abs(normalized) >= 1_000) {
    return `${trim_decimal(normalized / 1_000)}K`;
  }
  return new Intl.NumberFormat().format(normalized);
}

export function format_percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "0%";
  return `${trim_decimal(value * 100)}%`;
}

export function format_duration_ms(value: number | null | undefined): string {
  const total_seconds = Math.max(0, Math.floor((value ?? 0) / 1000));
  const hours = Math.floor(total_seconds / 3600);
  const minutes = Math.floor((total_seconds % 3600) / 60);
  const seconds = total_seconds % 60;
  if (hours > 0) {
    return `${hours}:${pad_datetime_part(minutes)}:${pad_datetime_part(seconds)}`;
  }
  return `${minutes}:${pad_datetime_part(seconds)}`;
}

export function format_time_remaining(value: string | null | undefined): string {
  if (!value || value === "-") return "-";
  const target_time = Date.parse(value);
  if (!Number.isFinite(target_time)) return value;
  const remaining_ms = target_time - Date.now();
  if (remaining_ms <= 0) return "已到期";
  return `剩 ${format_duration_ms(remaining_ms)}`;
}

export function clip_text(value: string | null | undefined, max_length = 140): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max_length) return normalized;
  return `${normalized.slice(0, max_length - 1)}…`;
}

export function format_agent_path(agent_path: string): string {
  return agent_path === "." ? "根工作区" : agent_path;
}

export function format_agent_name_with_position(agent: {
  name: string;
  position?: string | null;
}): string {
  const name = agent.name.trim();
  const position = agent.position?.trim();
  if (!position) return name;
  return `${name}(${position})`;
}

export function to_error_message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function trim_decimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function pad_datetime_part(value: number): string {
  return String(value).padStart(2, "0");
}
