import fs from "node:fs";
import { describe, expect, test } from "vitest";
import { create_runtime_log, get_runtime_log_path } from "../../src/runtime/log.js";
import { create_workspace } from "../helpers/workspace.js";

describe("runtime log", () => {
  test("writes system log entries through level methods", () => {
    const work_dir = create_workspace("runtime-log");
    const log = create_runtime_log(work_dir, {
      now: () => new Date("2026-04-21T08:00:00.000Z"),
    });

    log.info("started");
    log.warn("slow");
    log.error("failed");
    log.debug("detail");

    expect(fs.readFileSync(get_runtime_log_path(work_dir), "utf-8")).toBe(
      [
        "[2026-04-21T08:00:00.000Z] INFO started",
        "[2026-04-21T08:00:00.000Z] WARN slow",
        "[2026-04-21T08:00:00.000Z] ERROR failed",
        "[2026-04-21T08:00:00.000Z] DEBUG detail",
        "",
      ].join("\n"),
    );
  });
});
