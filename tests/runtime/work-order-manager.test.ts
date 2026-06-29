import { describe, expect, test } from "vitest";
import { WorkOrderManager } from "../../src/work-order/work-order.js";
import {
  create_workspace,
  write_completion_report,
  write_outbox_work_order,
} from "../helpers/workspace.js";

describe("WorkOrderManager", () => {
  test("lists active and completed work orders with snapshots", () => {
    const work_dir = create_workspace("work-order-manager");
    const active_order = write_outbox_work_order(work_dir, {
      order_dir_name: "20260421T000000-order-1",
      executor: "worker",
      summary: "活动工作单",
    });
    write_outbox_work_order(work_dir, {
      order_dir_name: "20260421T000001-order-2",
      executor: "reviewer",
      summary: "已完成工作单",
    });
    write_completion_report(work_dir, {
      box: "outbox",
      order_dir_name: "20260421T000001-order-2",
      check_status: "passed",
    });
    const manager = new WorkOrderManager(work_dir);

    expect(manager.list_active_work_order_paths("outbox")).toEqual([active_order]);
    expect(manager.read_work_order_executor(active_order)).toBe("worker");
    expect(manager.is_work_order_completed(active_order)).toBe(false);
    expect(
      manager.is_work_order_completed(
        ".loong/work-orders/outbox/20260421T000001-order-2/work-order.md",
      ),
    ).toBe(true);
    expect(manager.list_work_order_snapshots("outbox")).toMatchObject([
      {
        relative_work_order_path: active_order,
        relative_completion_report_path: null,
        turn_id: "000001",
        summary: "活动工作单",
        delegator: expect.any(String),
        executor: "worker",
        status: "active",
        check_status: null,
        open_issue_count: null,
        completion_report: null,
        input_files: [],
        output_files: [],
      },
      {
        relative_work_order_path: ".loong/work-orders/outbox/20260421T000001-order-2/work-order.md",
        relative_completion_report_path:
          ".loong/work-orders/outbox/20260421T000001-order-2/completion-report.md",
        turn_id: "000001",
        summary: "已完成工作单",
        delegator: expect.any(String),
        executor: "reviewer",
        status: "completed",
        check_status: "passed",
        open_issue_count: null,
        completion_report: {
          relative_path: ".loong/work-orders/outbox/20260421T000001-order-2/completion-report.md",
          turn_id: "000001",
          check_status: "passed",
        },
        output_files: [
          {
            relative_path: ".loong/work-orders/outbox/20260421T000001-order-2/output/result.md",
            size: 9,
          },
        ],
      },
    ]);
  });

  test("returns null for missing work order metadata", () => {
    const work_dir = create_workspace("work-order-missing");
    const manager = new WorkOrderManager(work_dir);

    expect(
      manager.read_work_order_executor(".loong/work-orders/outbox/missing/work-order.md"),
    ).toBe(null);
    expect(manager.list_active_work_order_paths("outbox")).toEqual([]);
    expect(manager.list_work_order_snapshots("outbox")).toEqual([]);
  });
});
