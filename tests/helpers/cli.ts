import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TSX_ENTRY = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const MAIN_ENTRY = path.join(REPO_ROOT, "src", "main.ts");

export type CliResult = {
  exit_code: number | null;
  stdout: string;
  stderr: string;
};

export function run_cli(
  args: string[],
  {
    cwd,
    timeout_ms = 30000,
  }: {
    cwd: string;
    timeout_ms?: number;
  },
): CliResult {
  const result = spawnSync(process.execPath, [TSX_ENTRY, MAIN_ENTRY, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: timeout_ms,
  });
  if (result.error) {
    throw result.error;
  }
  return {
    exit_code: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}
