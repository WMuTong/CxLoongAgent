import type { FilePreview, HumanRequestDetail, WebuiSnapshot } from "./types";

async function request_json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = (await response.json()) as T | { error?: string };
  if (!response.ok) {
    throw new Error("error" in data && data.error ? data.error : "请求失败。");
  }
  return data as T;
}

export function fetch_snapshot(): Promise<WebuiSnapshot> {
  return request_json<WebuiSnapshot>("/api/snapshot");
}

export function fetch_human_request(
  agent_path: string,
  request_path: string,
): Promise<HumanRequestDetail> {
  const params = new URLSearchParams({
    agent_path,
    request_path,
  });
  return request_json<HumanRequestDetail>(`/api/human-request?${params}`);
}

export function fetch_file_preview(agent_path: string, file_path: string): Promise<FilePreview> {
  const params = new URLSearchParams({
    agent_path,
    file_path,
  });
  return request_json<FilePreview>(`/api/file-preview?${params}`);
}

export function open_file_location(payload: {
  agent_path: string;
  file_path: string;
}): Promise<{ ok: true }> {
  return request_json<{ ok: true }>("/api/file-location/open", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function complete_human_request(payload: {
  agent_path: string;
  request_path: string;
  result: string;
}): Promise<{ ok: true }> {
  return request_json<{ ok: true }>("/api/human-request/complete", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function cancel_human_request(payload: {
  agent_path: string;
  request_path: string;
  result: string;
}): Promise<{ ok: true }> {
  return request_json<{ ok: true }>("/api/human-request/cancel", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
}

export function start_team_run(): Promise<{ ok: true; started: boolean }> {
  return request_json<{ ok: true; started: boolean }>("/api/team/start", {
    method: "POST",
  });
}

export function stop_team_run(): Promise<{ ok: true; stopped: boolean }> {
  return request_json<{ ok: true; stopped: boolean }>("/api/team/stop", {
    method: "POST",
  });
}
