import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { init } from "../../src/commands/init.js";
import {
  sync_completed_inbox_reports_to_parent,
  sync_outbox_work_order_to_child,
} from "../../src/work-order/sync.js";
import {
  create_workspace,
  write_completion_report,
  write_file,
  write_outbox_work_order,
} from "../helpers/workspace.js";

describe("work-order sync", () => {
  test("copies work-order and input directory from parent outbox to child inbox", () => {
    const parent_dir = create_workspace("sync-parent");
    const child_dir = path.join(parent_dir, "agents", "worker");
    fs.mkdirSync(child_dir, { recursive: true });
    init(child_dir);
    const relative_work_order_path = write_outbox_work_order(parent_dir, {
      executor: "worker",
    });
    const parent_order_dir = path.join(
      parent_dir,
      ".loong",
      "work-orders",
      "outbox",
      "20260421T000000-order-1",
    );
    write_file(path.join(parent_order_dir, "input", "context.txt"), "context");
    write_file(path.join(parent_order_dir, "input", "nested", "details.txt"), "details");
    write_file(path.join(parent_order_dir, "input-old.txt"), "should-not-copy");
    write_file(path.join(parent_order_dir, "note.txt"), "should-not-copy");

    sync_outbox_work_order_to_child(parent_dir, child_dir, relative_work_order_path);

    const child_order_dir = path.join(
      child_dir,
      ".loong",
      "work-orders",
      "inbox",
      "20260421T000000-order-1",
    );
    expect(fs.existsSync(path.join(child_order_dir, "work-order.md"))).toBe(true);
    expect(fs.existsSync(path.join(child_order_dir, "input", "context.txt"))).toBe(true);
    expect(fs.existsSync(path.join(child_order_dir, "input", "nested", "details.txt"))).toBe(true);
    expect(fs.existsSync(path.join(child_order_dir, "input-old.txt"))).toBe(false);
    expect(fs.existsSync(path.join(child_order_dir, "note.txt"))).toBe(false);
  });

  test("copies completion report and output directory from child inbox to parent outbox", () => {
    const parent_dir = create_workspace("sync-parent-report");
    const child_dir = path.join(parent_dir, "agents", "worker");
    fs.mkdirSync(child_dir, { recursive: true });
    init(child_dir);
    write_outbox_work_order(parent_dir, {
      executor: "worker",
    });
    const child_order_dir = path.join(
      child_dir,
      ".loong",
      "work-orders",
      "inbox",
      "20260421T000000-order-1",
    );
    write_file(path.join(child_order_dir, "work-order.md"), "# placeholder\n");
    write_completion_report(child_dir, {
      check_status: "passed",
    });
    write_file(path.join(child_order_dir, "output", "nested", "details.md"), "details");
    write_file(path.join(child_order_dir, "output-old.md"), "should-not-copy");
    write_file(path.join(child_order_dir, "notes.txt"), "should-not-copy");

    sync_completed_inbox_reports_to_parent(child_dir);

    const parent_order_dir = path.join(
      parent_dir,
      ".loong",
      "work-orders",
      "outbox",
      "20260421T000000-order-1",
    );
    expect(fs.existsSync(path.join(parent_order_dir, "completion-report.md"))).toBe(true);
    expect(fs.existsSync(path.join(parent_order_dir, "output", "result.md"))).toBe(true);
    expect(fs.existsSync(path.join(parent_order_dir, "output", "nested", "details.md"))).toBe(true);
    expect(fs.existsSync(path.join(parent_order_dir, "output-old.md"))).toBe(false);
    expect(fs.existsSync(path.join(parent_order_dir, "notes.txt"))).toBe(false);
  });
});
