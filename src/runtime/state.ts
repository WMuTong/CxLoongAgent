import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  load_agent_configs,
  load_current_agent_name,
  load_current_agent_never_stop,
} from "../agent/index.js";
import {
  has_markdown_heading,
  parse_completion_report,
  parse_human_request,
  parse_work_check_report,
  parse_work_log,
  parse_work_order,
  read_jsonl_last,
} from "../storage/index.js";
import {
  type ResolvedWorkPath,
  is_iso_datetime,
  is_non_empty_string,
  resolve_inside_work_dir,
  to_relative_posix_path,
} from "../utils/index.js";
import {
  COMPLETION_REPORT_FILE_NAME,
  OUTPUT_DIR_NAME,
  WORK_CHECK_FILE_NAME,
} from "../work-order/index.js";
import { get_state_log_path } from "./log.js";
import { type TurnRunContext, create_execution_turn_context } from "./turn-context.js";

export interface LoopState {
  turn_id: string;
  updated_at: string;
  plan: string;
  log: string;
  delegated_work_orders: string[];
  human_requests: string[];
  is_memory_updated: boolean;
  summary: string;
  next_action: "continue" | "stop";
  sleep_duration: number;
}

type ValidationErrorGroup = {
  target: string;
  messages: string[];
};

type ValidatedFile = {
  resolved: ResolvedWorkPath | null;
  target: string;
  messages: string[];
};

function has_file_in_dir(dir_path: string): boolean {
  if (!fs.existsSync(dir_path) || !fs.statSync(dir_path).isDirectory()) return false;
  for (const entry of fs.readdirSync(dir_path, { withFileTypes: true })) {
    const entry_path = path.join(dir_path, entry.name);
    if (entry.isFile()) return true;
    if (entry.isDirectory() && has_file_in_dir(entry_path)) return true;
  }
  return false;
}

function normalize_work_order_dir(relative_path: string): string {
  return relative_path
    .replaceAll("\\", "/")
    .replace(/\/work-order\.md$/, "")
    .replace(/\/+$/, "");
}

export { get_state_log_path };

export function load_last_loop_state(work_dir: string): LoopState | null {
  return read_jsonl_last<LoopState>(get_state_log_path(work_dir));
}

export function get_turn_id(work_dir: string): string {
  const state = load_last_loop_state(work_dir);
  const current_turn_id = state?.turn_id ? Number.parseInt(state.turn_id, 10) : Number.NaN;
  if (!Number.isInteger(current_turn_id) || current_turn_id < 0) return "000001";
  const num = (current_turn_id + 1).toString();
  return num.length < 6 ? num.padStart(6, "0") : num;
}

export class LoopStateValidator {
  constructor(
    readonly work_dir: string,
    readonly is_root = true,
    readonly turn_context: TurnRunContext = create_execution_turn_context(),
  ) {}

  validate(state: LoopState, turn_id: string): string | null {
    const error_groups: ValidationErrorGroup[] = [];
    const state_errors: string[] = [];
    if (!state.is_memory_updated) {
      state_errors.push('字段 "is_memory_updated" 不能为 false；结束本轮前必须完成记忆更新。');
    }
    if (!state.summary.trim()) {
      state_errors.push('字段 "summary" 不能为空。');
    }
    if (
      !Number.isFinite(state.sleep_duration) ||
      state.sleep_duration < 0 ||
      state.sleep_duration > 3600
    ) {
      state_errors.push('字段 "sleep_duration" 必须是 0 到 3600 之间的数字。');
    }
    this.#push_error_group(error_groups, "当前返回结果", state_errors);
    const plan = this.#validate_plan(state.plan);
    this.#push_error_group(error_groups, plan.target, plan.messages);
    const log = this.#validate_required_file({
      label: "log",
      relative_path: state.log,
      expected_dir: ".loong/work-logs",
      expected_suffix: "-log.md",
    });
    this.#push_error_group(error_groups, log.target, log.messages);
    if (plan.resolved) {
      this.#push_error_group(
        error_groups,
        plan.resolved.normalized_path,
        this.#check_plan_file(plan.resolved.absolute_path, turn_id),
      );
    }
    if (log.resolved) {
      this.#push_error_group(
        error_groups,
        log.resolved.normalized_path,
        this.#check_log_file(log.resolved.absolute_path, turn_id),
      );
    }
    this.#push_error_groups(error_groups, this.#check_single_turn_files(turn_id));
    this.#push_error_groups(error_groups, this.#check_memory_files());
    this.#push_error_groups(
      error_groups,
      this.#check_delegated_work_orders(state.delegated_work_orders, turn_id),
    );
    this.#push_error_groups(
      error_groups,
      this.#check_human_requests(state.human_requests, turn_id),
    );
    this.#push_error_groups(error_groups, this.#check_turn_target_contract(turn_id));
    this.#push_error_groups(error_groups, this.#check_work_check_report(turn_id));
    this.#push_error_groups(error_groups, this.#check_completion_reports(turn_id));
    if (state.next_action === "stop") {
      if (this.is_root && load_current_agent_never_stop(this.work_dir)) {
        this.#push_error_group(error_groups, "当前返回结果", [
          '当前根代理配置为 never_stop=true，不能返回 next_action="stop"；如果当前没有即时工作，应返回 next_action="continue" 并设置合理的 sleep_duration 作为后续巡检间隔。',
        ]);
      }
      const active_outbox_orders = this.#list_active_work_orders("outbox");
      if (active_outbox_orders.length > 0) {
        this.#push_error_group(error_groups, "当前返回结果", [
          `仍存在未完成的下级委派工作单，不能停止：${active_outbox_orders.join(", ")}`,
        ]);
      }
      if (!this.is_root) {
        const active_inbox_orders = this.#list_active_work_orders("inbox").filter(
          (order_path) => !this.#is_current_passed_work_check_target(order_path),
        );
        if (active_inbox_orders.length > 0) {
          this.#push_error_group(error_groups, "当前返回结果", [
            `仍存在未提交 completion-report.md 的上级工作单，不能停止：${active_inbox_orders.join(", ")}`,
          ]);
        }
      }
      const waiting_human_requests = this.#list_waiting_human_requests();
      if (waiting_human_requests.length > 0) {
        this.#push_error_group(error_groups, "当前返回结果", [
          `仍存在等待人类处理的人工介入请求，不能停止：${waiting_human_requests.join(", ")}`,
        ]);
      }
    }
    return this.#format_errors(error_groups);
  }

  #resolve_relative_path(relative_path: string): ResolvedWorkPath | null {
    return resolve_inside_work_dir(this.work_dir, relative_path);
  }

  #requires_plan(): boolean {
    return this.turn_context.turn_type === "execution";
  }

  #validate_plan(relative_path: string): ValidatedFile {
    if (this.#requires_plan()) {
      return this.#validate_required_file({
        label: "plan",
        relative_path,
        expected_dir: ".loong/work-plans",
        expected_suffix: "-plan.json",
      });
    }
    const errors: string[] = [];
    if (relative_path !== "") {
      errors.push(
        `${this.turn_context.turn_type} 轮次不创建工作计划，字段 "plan" 必须是空字符串。`,
      );
    }
    return { resolved: null, target: '字段 "plan"', messages: errors };
  }

  #validate_required_file({
    label,
    relative_path,
    expected_dir,
    expected_suffix,
  }: {
    label: string;
    relative_path: string;
    expected_dir: string;
    expected_suffix: string;
  }): ValidatedFile {
    const errors: string[] = [];
    const resolved = this.#resolve_relative_path(relative_path);
    if (!resolved) {
      errors.push(`字段 "${label}" 必须是 work_dir 下的相对路径，当前值为：${relative_path}`);
      return { resolved: null, target: `字段 "${label}"`, messages: errors };
    }
    if (path.posix.dirname(resolved.normalized_path) !== expected_dir) {
      errors.push(
        `字段 "${label}" 必须位于 ${expected_dir} 目录下，当前值为：${resolved.normalized_path}`,
      );
    }
    if (!resolved.normalized_path.endsWith(expected_suffix)) {
      errors.push(
        `字段 "${label}" 的文件名必须以 ${expected_suffix} 结尾，当前值为：${resolved.normalized_path}`,
      );
    }
    if (!fs.existsSync(resolved.absolute_path)) {
      errors.push(`字段 "${label}" 指向的文件不存在：${resolved.normalized_path}`);
      return { resolved: null, target: resolved.normalized_path, messages: errors };
    }
    if (!fs.statSync(resolved.absolute_path).isFile()) {
      errors.push(`字段 "${label}" 必须指向文件，当前值为：${resolved.normalized_path}`);
      return { resolved: null, target: resolved.normalized_path, messages: errors };
    }
    return { resolved, target: resolved.normalized_path, messages: errors };
  }

  #check_plan_file(plan_path: string, turn_id: string): string[] {
    const errors: string[] = [];
    let parsed_plan: unknown;
    try {
      parsed_plan = JSON.parse(fs.readFileSync(plan_path, "utf-8"));
    } catch {
      return [`计划文件不是合法 JSON：${to_relative_posix_path(this.work_dir, plan_path)}`];
    }
    if (!parsed_plan || typeof parsed_plan !== "object") {
      return ["计划文件内容必须是一个 JSON 对象。"];
    }
    const plan = parsed_plan as {
      turn_id?: unknown;
      created_at?: unknown;
      plans?: Array<{ description?: unknown; status?: unknown }>;
    };
    if (plan.turn_id !== turn_id) {
      errors.push(`计划文件中的 turn_id 必须等于当前轮次 ${turn_id}。`);
    }
    if (!is_iso_datetime(plan.created_at)) {
      errors.push("计划文件中的 created_at 必须是合法 ISO 8601 时间。");
    }
    if (!Array.isArray(plan.plans) || plan.plans.length === 0) {
      errors.push("计划文件中的 plans 必须是非空数组。");
      return errors;
    }
    if (plan.plans.some((item) => !is_non_empty_string(item.description))) {
      errors.push('计划文件中的每个步骤都必须包含非空的 "description"。');
    }
    if (plan.plans.some((item) => item.status !== "completed" && item.status !== "cancelled")) {
      errors.push('返回前计划中的所有步骤都必须是 "completed" 或 "cancelled"。');
    }
    return errors;
  }

  #check_log_file(log_path: string, turn_id: string): string[] {
    const errors: string[] = [];
    const log = parse_work_log(log_path);
    if (log.data.turn_id !== turn_id) {
      errors.push(`工作日志 frontmatter 中的 turn_id 必须等于当前轮次 ${turn_id}。`);
    }
    if (!is_iso_datetime(log.data.created_at)) {
      errors.push("工作日志 frontmatter 中的 created_at 必须是合法 ISO 8601 时间。");
    }
    if (!log.content.trim()) {
      errors.push("工作日志文件不能为空。");
    }
    if (!has_markdown_heading(log.content, "# 工作日志")) {
      errors.push('工作日志正文必须包含一级标题 "# 工作日志"。');
    }
    if (!has_markdown_heading(log.content, "## 本轮动作")) {
      errors.push('工作日志正文必须包含二级标题 "## 本轮动作"。');
    }
    if (!has_markdown_heading(log.content, "## 验证")) {
      errors.push('工作日志正文必须包含二级标题 "## 验证"。');
    }
    if (!has_markdown_heading(log.content, "## 问题与风险")) {
      errors.push('工作日志正文必须包含二级标题 "## 问题与风险"。');
    }
    return errors;
  }

  #check_single_turn_files(turn_id: string): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    const collect_files = (dir: string, pattern: RegExp): string[] => {
      if (!fs.existsSync(dir)) return [];
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && pattern.test(entry.name))
        .map((entry) => to_relative_posix_path(this.work_dir, path.join(dir, entry.name)))
        .sort((a, b) => a.localeCompare(b));
    };
    const plan_check = {
      label: "工作计划",
      dir: path.join(this.work_dir, ".loong", "work-plans"),
      pattern: new RegExp(`^${turn_id}-\\d{8}T\\d{6}-plan\\.json$`),
    };
    const plan_files = collect_files(plan_check.dir, plan_check.pattern);
    if (this.#requires_plan()) {
      if (plan_files.length > 1) {
        const target = to_relative_posix_path(this.work_dir, plan_check.dir);
        this.#push_error_group(error_groups, target, [
          `当前轮次 ${turn_id} 只能有一个${plan_check.label}文件，当前存在 ${plan_files.length} 个：${plan_files.join(", ")}`,
        ]);
      }
    } else if (plan_files.length > 0) {
      const target = to_relative_posix_path(this.work_dir, plan_check.dir);
      this.#push_error_group(error_groups, target, [
        `${this.turn_context.turn_type} 轮次不应创建工作计划文件，当前存在：${plan_files.join(", ")}`,
      ]);
    }
    const log_check = {
      label: "工作日志",
      dir: path.join(this.work_dir, ".loong", "work-logs"),
      pattern: new RegExp(`^${turn_id}-\\d{8}T\\d{6}-log\\.md$`),
    };
    const log_files = collect_files(log_check.dir, log_check.pattern);
    if (log_files.length > 1) {
      const target = to_relative_posix_path(this.work_dir, log_check.dir);
      this.#push_error_group(error_groups, target, [
        `当前轮次 ${turn_id} 只能有一个${log_check.label}文件，当前存在 ${log_files.length} 个：${log_files.join(", ")}`,
      ]);
    }
    return error_groups;
  }

  #check_memory_files(): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    const required_memory_files = [
      path.join(this.work_dir, ".loong", "memory", "world-model.md"),
      path.join(this.work_dir, ".loong", "memory", "learned.md"),
    ];
    for (const memory_file of required_memory_files) {
      if (!fs.existsSync(memory_file) || !fs.statSync(memory_file).isFile()) {
        const target = to_relative_posix_path(this.work_dir, memory_file);
        this.#push_error_group(error_groups, target, ["记忆文件不存在。"]);
      }
    }
    return error_groups;
  }

  #check_delegated_work_orders(
    delegated_work_orders: string[],
    turn_id: string,
  ): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    const seen = new Set<string>();
    for (const relative_path of delegated_work_orders) {
      const resolved = this.#resolve_relative_path(relative_path);
      if (!resolved) {
        this.#push_error_group(error_groups, `delegated_work_orders: ${relative_path}`, [
          "相对路径非法，必须位于当前工作目录下。",
        ]);
        continue;
      }
      if (
        path.posix.dirname(path.posix.dirname(resolved.normalized_path)) !==
        ".loong/work-orders/outbox"
      ) {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          "路径必须位于 .loong/work-orders/outbox/<目录>/work-order.md 下。",
        ]);
      }
      if (path.posix.basename(resolved.normalized_path) !== "work-order.md") {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          "路径必须直接指向 work-order.md。",
        ]);
      }
      const order_dir_name = path.posix.basename(path.posix.dirname(resolved.normalized_path));
      if (!/^\d{8}T\d{6}-order-\d+$/.test(order_dir_name)) {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          "工作单目录名必须符合 <yyyyMMddTHHmmss>-order-<num>。",
        ]);
      }
      if (!fs.existsSync(resolved.absolute_path) || !fs.statSync(resolved.absolute_path).isFile()) {
        this.#push_error_group(error_groups, resolved.normalized_path, ["工作单文件不存在。"]);
        continue;
      }
      this.#push_error_group(
        error_groups,
        resolved.normalized_path,
        this.#check_work_order_file(resolved.absolute_path, turn_id),
      );
      if (seen.has(resolved.normalized_path)) {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          "delegated_work_orders 中存在重复路径。",
        ]);
      }
      seen.add(resolved.normalized_path);
    }
    return error_groups;
  }

  #check_work_order_file(work_order_path: string, turn_id: string): string[] {
    const errors: string[] = [];
    const work_order = parse_work_order(work_order_path);
    const display_path = to_relative_posix_path(this.work_dir, work_order_path);
    const current_agent_name = load_current_agent_name(this.work_dir);
    if (work_order.data.turn_id !== turn_id) {
      errors.push(`工作单 frontmatter 中的 turn_id 必须等于当前轮次 ${turn_id}：${display_path}`);
    }
    if (!is_non_empty_string(work_order.data.summary)) {
      errors.push(`工作单 frontmatter 中必须提供非空的 summary：${display_path}`);
    }
    if (!is_non_empty_string(work_order.data.delegator)) {
      errors.push(`工作单 frontmatter 中必须提供非空的 delegator：${display_path}`);
    } else if (!current_agent_name) {
      errors.push(
        `无法从 .loong/runtime/config.json 读取当前代理 name，不能校验工作单 delegator：${display_path}`,
      );
    } else if (work_order.data.delegator.trim() !== current_agent_name) {
      errors.push(
        `工作单 frontmatter 中的 delegator 必须等于当前代理 name "${current_agent_name}"，当前值为 ${work_order.data.delegator.trim()}：${display_path}`,
      );
    }
    if (!is_non_empty_string(work_order.data.executor)) {
      errors.push(`工作单 frontmatter 中必须提供非空的 executor：${display_path}`);
    } else if (!this.#is_known_child_agent(work_order.data.executor.trim())) {
      const available_agents = this.#list_child_agent_names();
      const available = available_agents.length > 0 ? available_agents.join(", ") : "无";
      errors.push(
        `工作单 frontmatter 中的 executor 必须匹配当前可用子代理 name，当前值为 ${work_order.data.executor.trim()}，可用子代理：${available}：${display_path}`,
      );
    }
    if (!is_iso_datetime(work_order.data.created_at)) {
      errors.push(`工作单 frontmatter 中的 created_at 必须是合法 ISO 8601 时间：${display_path}`);
    }
    if (!has_markdown_heading(work_order.content, "# 工作单")) {
      errors.push(`工作单正文必须包含一级标题 "# 工作单"：${display_path}`);
    }
    if (!has_markdown_heading(work_order.content, "## 背景")) {
      errors.push(`工作单正文必须包含二级标题 "## 背景"：${display_path}`);
    }
    if (!has_markdown_heading(work_order.content, "## 目标")) {
      errors.push(`工作单正文必须包含二级标题 "## 目标"：${display_path}`);
    }
    if (!has_markdown_heading(work_order.content, "## 验收标准")) {
      errors.push(`工作单正文必须包含二级标题 "## 验收标准"：${display_path}`);
    }
    if (!has_markdown_heading(work_order.content, "## 附件信息")) {
      errors.push(`工作单正文必须包含二级标题 "## 附件信息""：${display_path}`);
    }
    return errors;
  }

  #is_known_child_agent(agent_name: string): boolean {
    return this.#list_child_agent_names().includes(agent_name);
  }

  #list_child_agent_names(): string[] {
    return load_agent_configs(this.work_dir)
      .map((agent) => agent.name)
      .sort((a, b) => a.localeCompare(b));
  }

  #check_human_requests(human_requests: string[], turn_id: string): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    const seen = new Set<string>();
    for (const relative_path of human_requests) {
      const resolved = this.#resolve_relative_path(relative_path);
      if (!resolved) {
        this.#push_error_group(error_groups, `human_requests: ${relative_path}`, [
          "相对路径非法，必须位于当前工作目录下。",
        ]);
        continue;
      }
      if (path.posix.dirname(resolved.normalized_path) !== ".loong/human-requests") {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          "路径必须位于 .loong/human-requests 目录下。",
        ]);
      }
      if (
        !new RegExp(`^${turn_id}-\\d{8}T\\d{6}-request-\\d+\\.md$`).test(
          path.posix.basename(resolved.normalized_path),
        )
      ) {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          `文件名必须符合 ${turn_id}-<yyyyMMddTHHmmss>-request-<num>.md。`,
        ]);
      }
      if (!fs.existsSync(resolved.absolute_path) || !fs.statSync(resolved.absolute_path).isFile()) {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          "人工介入请求文件不存在。",
        ]);
        continue;
      }
      this.#push_error_group(
        error_groups,
        resolved.normalized_path,
        this.#check_human_request_file(resolved.absolute_path, turn_id),
      );
      if (seen.has(resolved.normalized_path)) {
        this.#push_error_group(error_groups, resolved.normalized_path, [
          "human_requests 中存在重复路径。",
        ]);
      }
      seen.add(resolved.normalized_path);
    }
    return error_groups;
  }

  #check_human_request_file(request_path: string, turn_id: string): string[] {
    const errors: string[] = [];
    const request = parse_human_request(request_path);
    const display_path = to_relative_posix_path(this.work_dir, request_path);
    if (request.data.turn_id !== turn_id) {
      errors.push(
        `人工介入请求 frontmatter 中的 turn_id 必须等于当前轮次 ${turn_id}：${display_path}`,
      );
    }
    if (request.data.status !== "waiting") {
      errors.push(`本轮新增人工介入请求的 status 必须是 waiting：${display_path}`);
    }
    if (!is_non_empty_string(request.data.summary)) {
      errors.push(`人工介入请求 frontmatter 中必须提供非空的 summary：${display_path}`);
    }
    if (!is_iso_datetime(request.data.created_at)) {
      errors.push(
        `人工介入请求 frontmatter 中的 created_at 必须是合法 ISO 8601 时间：${display_path}`,
      );
    }
    if (!has_markdown_heading(request.content, "# 人工介入请求")) {
      errors.push(`人工介入请求正文必须包含一级标题 "# 人工介入请求"：${display_path}`);
    }
    if (!has_markdown_heading(request.content, "## 前因后果")) {
      errors.push(`人工介入请求正文必须包含二级标题 "## 前因后果"：${display_path}`);
    }
    if (!has_markdown_heading(request.content, "## 需要人类完成的位置")) {
      errors.push(`人工介入请求正文必须包含二级标题 "## 需要人类完成的位置"：${display_path}`);
    }
    if (!has_markdown_heading(request.content, "## 具体操作步骤")) {
      errors.push(`人工介入请求正文必须包含二级标题 "## 具体操作步骤"：${display_path}`);
    }
    if (!has_markdown_heading(request.content, "## 完成后如何标记")) {
      errors.push(`人工介入请求正文必须包含二级标题 "## 完成后如何标记"：${display_path}`);
    }
    if (!has_markdown_heading(request.content, "## 人类处理结果")) {
      errors.push(`人工介入请求正文必须包含二级标题 "## 人类处理结果"：${display_path}`);
    }
    return errors;
  }

  #check_completion_reports(turn_id: string): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    const inbox_dir = path.join(this.work_dir, ".loong", "work-orders", "inbox");
    if (!fs.existsSync(inbox_dir)) return error_groups;
    const current_agent_name = load_current_agent_name(this.work_dir);
    for (const entry of fs.readdirSync(inbox_dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const completion_report_path = path.join(inbox_dir, entry.name, "completion-report.md");
      if (!fs.existsSync(completion_report_path)) continue;
      const completion_report = parse_completion_report(completion_report_path);
      if (completion_report.data.turn_id !== turn_id) continue;
      const display_path = to_relative_posix_path(this.work_dir, completion_report_path);
      const work_order_path = path.join(inbox_dir, entry.name, "work-order.md");
      const work_order = fs.existsSync(work_order_path) ? parse_work_order(work_order_path) : null;
      if (!is_iso_datetime(completion_report.data.created_at)) {
        this.#push_error_group(error_groups, display_path, [
          "frontmatter 中的 created_at 必须是合法 ISO 8601 时间。",
        ]);
      }
      if (!is_non_empty_string(completion_report.data.delegator)) {
        this.#push_error_group(error_groups, display_path, [
          "frontmatter 中必须提供非空的 delegator。",
        ]);
      } else if (
        work_order &&
        is_non_empty_string(work_order.data.delegator) &&
        completion_report.data.delegator.trim() !== work_order.data.delegator.trim()
      ) {
        this.#push_error_group(error_groups, display_path, [
          `frontmatter 中的 delegator 必须与对应 work-order.md 的 delegator 一致，当前值为 ${completion_report.data.delegator.trim()}，工作单值为 ${work_order.data.delegator.trim()}。`,
        ]);
      }
      if (!is_non_empty_string(completion_report.data.executor)) {
        this.#push_error_group(error_groups, display_path, [
          "frontmatter 中必须提供非空的 executor。",
        ]);
      } else if (!current_agent_name) {
        this.#push_error_group(error_groups, display_path, [
          "无法从 .loong/runtime/config.json 读取当前代理 name，不能校验完成报告 executor。",
        ]);
      } else if (completion_report.data.executor.trim() !== current_agent_name) {
        this.#push_error_group(error_groups, display_path, [
          `frontmatter 中的 executor 必须等于当前代理 name "${current_agent_name}"，当前值为 ${completion_report.data.executor.trim()}。`,
        ]);
      } else if (
        work_order &&
        is_non_empty_string(work_order.data.executor) &&
        completion_report.data.executor.trim() !== work_order.data.executor.trim()
      ) {
        this.#push_error_group(error_groups, display_path, [
          `frontmatter 中的 executor 必须与对应 work-order.md 的 executor 一致，当前值为 ${completion_report.data.executor.trim()}，工作单值为 ${work_order.data.executor.trim()}。`,
        ]);
      }
      if (!has_markdown_heading(completion_report.content, "# 完成报告")) {
        this.#push_error_group(error_groups, display_path, ['正文必须包含一级标题 "# 完成报告"。']);
      }
      if (!has_markdown_heading(completion_report.content, "## 完成情况")) {
        this.#push_error_group(error_groups, display_path, [
          '正文必须包含二级标题 "## 完成情况"。',
        ]);
      }
      if (!has_markdown_heading(completion_report.content, "## 交付物")) {
        this.#push_error_group(error_groups, display_path, ['正文必须包含二级标题 "## 交付物"。']);
      }
      if (!has_markdown_heading(completion_report.content, "## 验收项对照")) {
        this.#push_error_group(error_groups, display_path, [
          '正文必须包含二级标题 "## 验收项对照"。',
        ]);
      }
      if (!has_markdown_heading(completion_report.content, "## 验证记录")) {
        this.#push_error_group(error_groups, display_path, [
          '正文必须包含二级标题 "## 验证记录"。',
        ]);
      }
      const output_dir = path.join(path.dirname(completion_report_path), OUTPUT_DIR_NAME);
      if (!has_file_in_dir(output_dir)) {
        this.#push_error_group(error_groups, display_path, [
          '工作单目录下的 "output" 文件夹中必须至少有一个交付物文件。',
        ]);
      }
    }
    return error_groups;
  }

  #check_turn_target_contract(_turn_id: string): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    const target_path = this.turn_context.target_work_order_path;
    if (this.turn_context.turn_type !== "execution" && !target_path) {
      this.#push_error_group(error_groups, "轮次目标", [
        `${this.turn_context.turn_type} 轮次必须绑定 target_work_order_path。`,
      ]);
      return error_groups;
    }
    if (target_path) {
      const target = this.#resolve_relative_path(target_path);
      if (!target || !target.normalized_path.startsWith(".loong/work-orders/inbox/")) {
        this.#push_error_group(error_groups, "轮次目标", [
          `target_work_order_path 必须是当前 work_dir 下的 inbox 工作单目录，当前值为：${target_path}`,
        ]);
        return error_groups;
      }
      const target_work_order_path = path.join(target.absolute_path, "work-order.md");
      if (!fs.existsSync(target_work_order_path) || !fs.statSync(target_work_order_path).isFile()) {
        this.#push_error_group(error_groups, target.normalized_path, [
          "target_work_order_path 指向的目录必须包含 work-order.md。",
        ]);
      }
    }
    this.#push_error_groups(error_groups, this.#check_changed_completion_report_targets());
    return error_groups;
  }

  #check_changed_completion_report_targets(): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    const target_path = this.turn_context.target_work_order_path;
    if (!target_path) return error_groups;
    const changed_result = this.#list_changed_completion_reports();
    if (changed_result.error) {
      this.#push_error_group(error_groups, "完成报告变更", [changed_result.error]);
      return error_groups;
    }
    if (this.turn_context.turn_type === "work_check" && changed_result.paths.length > 0) {
      this.#push_error_group(error_groups, "完成报告变更", [
        `工作检查轮次不能直接变更 completion-report.md；状态同步由框架完成。本轮变更：${changed_result.paths.join(", ")}`,
      ]);
      return error_groups;
    }
    const normalized_target = target_path.replaceAll("\\", "/").replace(/\/+$/, "");
    const expected_path = `${normalized_target}/${COMPLETION_REPORT_FILE_NAME}`;
    const invalid_paths = changed_result.paths.filter((item) => item !== expected_path);
    if (invalid_paths.length > 0) {
      this.#push_error_group(error_groups, "完成报告变更", [
        `绑定目标工作单的轮次只能变更 ${expected_path}，以下完成报告不属于目标工作单：${invalid_paths.join(", ")}`,
      ]);
    }
    return error_groups;
  }

  #list_changed_completion_reports(): { paths: string[]; error: string | null } {
    const paths = new Set<string>();
    const collect = (args: string[]) => {
      const result = spawnSync("git", args, {
        cwd: this.work_dir,
        encoding: "utf-8",
        windowsHide: true,
      });
      if (result.status !== 0) {
        return result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} 执行失败。`;
      }
      for (const file_path of result.stdout.split("\0")) {
        const normalized = file_path.trim().replaceAll("\\", "/");
        if (!normalized.endsWith(`/${COMPLETION_REPORT_FILE_NAME}`)) continue;
        paths.add(normalized);
      }
      return null;
    };
    const diff_error = collect([
      "diff",
      "--name-only",
      "-z",
      "HEAD",
      "--",
      ".loong/work-orders/inbox",
    ]);
    if (diff_error) return { paths: [], error: diff_error };
    const untracked_error = collect([
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".loong/work-orders/inbox",
    ]);
    if (untracked_error) return { paths: [], error: untracked_error };
    return { paths: [...paths].sort(), error: null };
  }

  #check_work_check_report(turn_id: string): ValidationErrorGroup[] {
    const error_groups: ValidationErrorGroup[] = [];
    if (this.turn_context.turn_type !== "work_check") return error_groups;
    const target_path = this.turn_context.target_work_order_path;
    if (!target_path) return error_groups;
    const target = this.#resolve_relative_path(target_path);
    if (!target) return error_groups;
    const work_check_path = path.join(target.absolute_path, WORK_CHECK_FILE_NAME);
    const display_path = to_relative_posix_path(this.work_dir, work_check_path);
    if (!fs.existsSync(work_check_path) || !fs.statSync(work_check_path).isFile()) {
      this.#push_error_group(error_groups, display_path, [
        `工作检查轮次必须在目标工作单目录生成 ${WORK_CHECK_FILE_NAME}。`,
      ]);
      return error_groups;
    }
    const work_check = parse_work_check_report(work_check_path);
    if (
      typeof work_check.data.open_issue_count !== "number" ||
      !Number.isFinite(work_check.data.open_issue_count) ||
      work_check.data.open_issue_count < 0
    ) {
      this.#push_error_group(error_groups, display_path, [
        "frontmatter 中的 open_issue_count 必须是大于等于 0 的合法数字。",
      ]);
    } else {
      this.#push_error_group(
        error_groups,
        display_path,
        this.#check_work_check_issues(work_check.content, work_check.data.open_issue_count),
      );
    }
    if (!has_markdown_heading(work_check.content, "# 工作检查报告")) {
      this.#push_error_group(error_groups, display_path, [
        '正文必须包含一级标题 "# 工作检查报告"。',
      ]);
    }
    if (!has_markdown_heading(work_check.content, `## 工作检查轮次 ${turn_id}`)) {
      this.#push_error_group(error_groups, display_path, [
        `正文必须包含二级标题 "## 工作检查轮次 ${turn_id}"。`,
      ]);
    }
    return error_groups;
  }

  #check_work_check_issues(content: string, open_issue_count: number): string[] {
    const errors: string[] = [];
    const unresolved_count = [...content.matchAll(/^\s*-\s*状态[:：]\s*(未修复|待复查)\s*$/gm)]
      .length;
    if (unresolved_count !== open_issue_count) {
      errors.push(
        `frontmatter 中的 open_issue_count 必须等于正文中状态为“未修复”或“待复查”的问题数量，当前 open_issue_count=${open_issue_count}，未修复或待复查问题数=${unresolved_count}。`,
      );
    }
    const issue_matches = [...content.matchAll(/^###\s+(.+)$/gm)];
    if (open_issue_count > 0 && issue_matches.length === 0) {
      errors.push("存在未修复或待复查问题时，正文必须用三级标题记录问题条目。");
    }
    const seen_issue_ids = new Set<string>();
    for (let index = 0; index < issue_matches.length; index += 1) {
      const match = issue_matches[index];
      if (match.index === undefined) continue;
      const title = (match[1] ?? "").trim();
      const next_match = issue_matches[index + 1];
      const section = content.slice(match.index, next_match?.index ?? content.length);
      const issue_id_match = title.match(/^(Q\d+)\s+\S/);
      if (!issue_id_match) {
        errors.push(`问题标题必须符合 "### Q<num> <问题名称>"：${title}`);
        continue;
      }
      const issue_id = issue_id_match[1] ?? "";
      if (seen_issue_ids.has(issue_id)) {
        errors.push(`问题编号不能重复：${issue_id}`);
      }
      seen_issue_ids.add(issue_id);
      const status_match = section.match(/^\s*-\s*状态[:：]\s*(未修复|待复查|已修复)\s*$/m);
      const repair_turn_match = section.match(/^\s*-\s*修复轮次[:：]\s*(.+?)\s*$/m);
      for (const label of ["问题详情", "状态", "修复轮次", "修复情况"]) {
        if (!new RegExp(`^\\s*-\\s*${label}[:：]`, "m").test(section)) {
          errors.push(`${issue_id} 必须包含“${label}”。`);
        }
      }
      if (!status_match) continue;
      const status = status_match[1];
      const repair_turn = repair_turn_match?.[1]?.trim() ?? "";
      if (status === "未修复" && repair_turn !== "-") {
        errors.push(`${issue_id} 状态为“未修复”时，修复轮次必须填写“-”。`);
      }
      if (status !== "未修复" && (!repair_turn || repair_turn === "-")) {
        errors.push(`${issue_id} 状态为“${status}”时，必须填写修复轮次。`);
      }
    }
    return errors;
  }

  #list_active_work_orders(type: "inbox" | "outbox"): string[] {
    const order_dir = path.join(this.work_dir, ".loong", "work-orders", type);
    if (!fs.existsSync(order_dir)) return [];
    const active_orders: string[] = [];
    for (const entry of fs.readdirSync(order_dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const work_order_path = path.join(order_dir, entry.name, "work-order.md");
      const completion_report_path = path.join(order_dir, entry.name, "completion-report.md");
      if (!fs.existsSync(work_order_path)) continue;
      if (!fs.existsSync(completion_report_path)) {
        active_orders.push(to_relative_posix_path(this.work_dir, work_order_path));
        continue;
      }
      const completion_report = parse_completion_report(completion_report_path);
      if (completion_report.data.check_status !== "passed") {
        active_orders.push(to_relative_posix_path(this.work_dir, work_order_path));
      }
    }
    return active_orders;
  }

  #is_current_passed_work_check_target(work_order_path: string): boolean {
    if (this.turn_context.turn_type !== "work_check") return false;
    if (!this.turn_context.target_work_order_path) return false;
    const target = this.#resolve_relative_path(this.turn_context.target_work_order_path);
    if (!target) return false;
    if (
      normalize_work_order_dir(work_order_path) !== normalize_work_order_dir(target.normalized_path)
    ) {
      return false;
    }
    const work_check_path = path.join(target.absolute_path, WORK_CHECK_FILE_NAME);
    if (!fs.existsSync(work_check_path) || !fs.statSync(work_check_path).isFile()) return false;
    const work_check = parse_work_check_report(work_check_path);
    return work_check.data.open_issue_count === 0;
  }

  #list_waiting_human_requests(): string[] {
    const requests_dir = path.join(this.work_dir, ".loong", "human-requests");
    if (!fs.existsSync(requests_dir)) return [];
    const waiting_requests: string[] = [];
    for (const entry of fs.readdirSync(requests_dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const request_path = path.join(requests_dir, entry.name);
      const request = parse_human_request(request_path);
      if (request.data.status === "waiting") {
        waiting_requests.push(to_relative_posix_path(this.work_dir, request_path));
      }
    }
    return waiting_requests;
  }

  #push_error_group(error_groups: ValidationErrorGroup[], target: string, messages: string[]) {
    if (messages.length === 0) return;
    const existing_group = error_groups.find((group) => group.target === target);
    if (existing_group) {
      existing_group.messages.push(...messages);
      return;
    }
    error_groups.push({
      target,
      messages: [...messages],
    });
  }

  #push_error_groups(error_groups: ValidationErrorGroup[], groups_to_add: ValidationErrorGroup[]) {
    for (const group of groups_to_add) {
      this.#push_error_group(error_groups, group.target, group.messages);
    }
  }

  #format_errors(error_groups: ValidationErrorGroup[]): string | null {
    if (error_groups.length === 0) return null;
    const sections = error_groups.map((group) => {
      const lines = group.messages.map((message) => `- ${message}`).join("\n");
      return `## ${group.target} 存在如下问题\n${lines}`;
    });
    return `# 校验失败\n\n${sections.join("\n\n")}`;
  }
}
