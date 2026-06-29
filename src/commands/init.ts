import fs from "node:fs";
import path from "node:path";
import type { CAC } from "cac";
import { create_git_turn_workspace } from "../runtime/git-worktree.js";
import { create_initial_run_state } from "../runtime/run-state.js";
import {
  ensure_dir,
  get_dir_basename,
  is_dir_empty,
  to_relative_posix_path,
  write_text_file,
} from "../utils/index.js";
import {
  build_codex_config_template,
  build_learned_template,
  build_world_model_template,
} from "./workspace-template.js";

type InitResult = {
  created_dirs: string[];
  created_files: string[];
};

type InitOptions = {
  org_file?: string;
};

type WorkspaceConfig = {
  name: string;
  position: string;
  description: string;
  sort_index: number;
};

type OrganizationNode = WorkspaceConfig & {
  "folder-name": string;
  children: OrganizationNode[];
};

type ManagedFile = {
  relative_path: string;
  content: string;
};

const COMMON_CHINESE_NAMES = [
  "周雅婷",
  "王涛",
  "欧阳昊天",
  "林思琪",
  "张琳",
  "诸葛浩然",
  "刘昊天",
  "西门雅楠",
  "赵依琳",
  "陈峰",
  "司马子涵",
  "徐欣怡",
  "胡铭轩",
  "上官思远",
  "李颖",
  "吴子墨",
  "孙皓宇",
  "慕容雨薇",
  "郑晨曦",
  "杨梓轩",
];

function pick_default_agent_name(position: string): string {
  let hash = 0;
  for (const char of position) {
    hash = (hash + char.charCodeAt(0)) % COMMON_CHINESE_NAMES.length;
  }
  return COMMON_CHINESE_NAMES[hash];
}

class WorkspaceInitializer {
  readonly #created_dirs = new Set<string>();
  readonly #created_files = new Set<string>();
  readonly #work_dir: string;
  readonly #position: string;
  readonly #agent_name: string;
  readonly #description: string;
  readonly #sort_index: number;

  constructor(work_dir: string, config?: WorkspaceConfig) {
    this.#work_dir = work_dir;
    this.#position = config?.position ?? get_dir_basename(this.#work_dir);
    this.#agent_name = config?.name ?? pick_default_agent_name(this.#position);
    this.#description = config?.description ?? "负责当前目录整体目标推进、监督与委派协调的节点";
    this.#sort_index = config?.sort_index ?? 0;
  }

  #ensure_directories() {
    const directories = [
      "agents",
      ".codex",
      ".codex/skills",
      ".codex/rules",
      ".loong",
      ".loong/runtime",
      ".loong/turn-results",
      ".loong/memory",
      ".loong/work-plans",
      ".loong/work-logs",
      ".loong/work-orders",
      ".loong/work-orders/inbox",
      ".loong/work-orders/outbox",
      ".loong/human-requests",
    ];
    for (const relative_dir of directories) {
      this.#ensure_dir(relative_dir);
    }
  }

  #ensure_files() {
    const files: ManagedFile[] = [
      {
        relative_path: "AGENTS.md",
        content: "",
      },
      {
        relative_path: ".codex/config.toml",
        content: build_codex_config_template(),
      },
      {
        relative_path: ".loong/runtime/config.json",
        content: `${JSON.stringify(
          {
            name: this.#agent_name,
            position: this.#position,
            description: this.#description,
            sort_index: this.#sort_index,
            never_stop: false,
          },
          null,
          2,
        )}\n`,
      },
      {
        relative_path: ".loong/runtime/state.json",
        content: `${JSON.stringify(create_initial_run_state(), null, 2)}\n`,
      },
      {
        relative_path: ".loong/runtime/state-log.jsonl",
        content: "",
      },
      {
        relative_path: ".loong/runtime/turn-events.jsonl",
        content: "",
      },
      {
        relative_path: ".loong/runtime/log.txt",
        content: "",
      },
      {
        relative_path: ".loong/memory/world-model.md",
        content: build_world_model_template(),
      },
      {
        relative_path: ".loong/memory/learned.md",
        content: build_learned_template(),
      },
      {
        relative_path: ".gitignore",
        content: "/agents/\n/.worktree/\n",
      },
    ];
    for (const file of files) {
      this.#ensure_file(file);
    }
  }

  run(): InitResult {
    this.#ensure_work_dir_is_initializable();
    this.#ensure_directories();
    this.#ensure_files();
    this.#ensure_git_repository();
    return {
      created_dirs: [...this.#created_dirs],
      created_files: [...this.#created_files],
    };
  }

  #ensure_work_dir_is_initializable() {
    if (is_dir_empty(this.#work_dir)) return;
    throw new Error("当前目录非空，不能执行 init。请在不存在或空目录中初始化。");
  }

  #ensure_dir(relative_dir: string) {
    if (!ensure_dir(this.#resolve_path(relative_dir))) return;
    this.#created_dirs.add(relative_dir);
  }

  #ensure_file(file: ManagedFile) {
    write_text_file(this.#resolve_path(file.relative_path), file.content);
    this.#created_files.add(file.relative_path);
  }

  #resolve_path(relative_path: string): string {
    return path.join(this.#work_dir, relative_path);
  }

  #ensure_git_repository() {
    const workspace = create_git_turn_workspace(this.#work_dir);
    workspace.ensure_ready();
    workspace.commit_current_changes("loong initial workspace");
  }
}

function is_plain_object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function read_required_string(source: Record<string, unknown>, key: string, path_label: string) {
  const value = source[key];
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  throw new Error(`组织文件 ${path_label} 缺少有效字段 "${key}"。`);
}

function read_optional_sort_index(
  source: Record<string, unknown>,
  path_label: string,
  default_sort_index: number,
): number {
  const value = source.sort_index;
  if (value === undefined) return default_sort_index;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  throw new Error(`组织文件 ${path_label} 的 "sort_index" 必须是有效数字。`);
}

function parse_organization_node(
  value: unknown,
  path_label = "root",
  default_sort_index = 0,
): OrganizationNode {
  if (!is_plain_object(value)) {
    throw new Error(`组织文件 ${path_label} 必须是对象。`);
  }
  const children_value = value.children;
  if (!Array.isArray(children_value)) {
    throw new Error(`组织文件 ${path_label} 缺少有效字段 "children"。`);
  }
  const node: OrganizationNode = {
    name: read_required_string(value, "name", path_label),
    position: read_required_string(value, "position", path_label),
    "folder-name": read_required_string(value, "folder-name", path_label),
    description: read_required_string(value, "description", path_label),
    sort_index: read_optional_sort_index(value, path_label, default_sort_index),
    children: children_value.map((child, index) =>
      parse_organization_node(child, `${path_label}.children[${index}]`, index),
    ),
  };
  assert_valid_folder_name(node["folder-name"], path_label);
  assert_unique_child_folder_names(node.children, path_label);
  return node;
}

function assert_valid_folder_name(folder_name: string, path_label: string) {
  if (
    folder_name === "." ||
    folder_name === ".." ||
    path.isAbsolute(folder_name) ||
    folder_name.includes("/") ||
    folder_name.includes("\\") ||
    folder_name !== path.basename(folder_name)
  ) {
    throw new Error(`组织文件 ${path_label} 的 "folder-name" 不是有效目录名：${folder_name}`);
  }
}

function assert_unique_child_folder_names(children: OrganizationNode[], path_label: string) {
  const seen = new Set<string>();
  for (const child of children) {
    const folder_name = child["folder-name"];
    if (seen.has(folder_name)) {
      throw new Error(`组织文件 ${path_label} 存在重复子节点目录名：${folder_name}`);
    }
    seen.add(folder_name);
  }
}

function load_organization(org_file: string): OrganizationNode {
  const org_file_path = path.resolve(org_file);
  let raw_text: string;
  try {
    raw_text = fs.readFileSync(org_file_path, "utf-8");
  } catch {
    throw new Error(`无法读取组织文件：${org_file}`);
  }
  try {
    return parse_organization_node(JSON.parse(raw_text));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`组织文件不是有效 JSON：${org_file}`);
    }
    throw error;
  }
}

class OrganizationInitializer {
  readonly #work_dir: string;
  readonly #root: OrganizationNode;
  readonly #created_dirs = new Set<string>();
  readonly #created_files = new Set<string>();

  constructor(work_dir: string, org_file: string) {
    this.#work_dir = path.resolve(work_dir);
    this.#root = load_organization(org_file);
  }

  run(): InitResult {
    this.#initialize_node(path.join(this.#work_dir, this.#root["folder-name"]), this.#root);
    return {
      created_dirs: [...this.#created_dirs],
      created_files: [...this.#created_files],
    };
  }

  #initialize_node(work_dir: string, node: OrganizationNode) {
    const result = new WorkspaceInitializer(work_dir, {
      name: node.name,
      position: node.position,
      description: node.description,
      sort_index: node.sort_index,
    }).run();
    this.#collect_result(work_dir, result);
    for (const child of node.children) {
      this.#initialize_node(path.join(work_dir, "agents", child["folder-name"]), child);
    }
  }

  #collect_result(work_dir: string, result: InitResult) {
    for (const relative_dir of result.created_dirs) {
      this.#created_dirs.add(this.#to_root_relative_path(work_dir, relative_dir));
    }
    for (const relative_file of result.created_files) {
      this.#created_files.add(this.#to_root_relative_path(work_dir, relative_file));
    }
  }

  #to_root_relative_path(work_dir: string, relative_path: string): string {
    return to_relative_posix_path(this.#work_dir, path.join(work_dir, relative_path));
  }
}

export function init(work_dir = process.cwd(), options: InitOptions = {}): InitResult {
  if (options.org_file) {
    const initializer = new OrganizationInitializer(work_dir, options.org_file);
    return initializer.run();
  }
  const initializer = new WorkspaceInitializer(work_dir);
  return initializer.run();
}

function print_init_result(result: InitResult) {
  const sections = [
    { title: "created dirs", items: result.created_dirs },
    { title: "created files", items: result.created_files },
  ].filter((section) => section.items.length > 0);

  console.log("loong 工作区初始化完成。");
  for (const section of sections) {
    console.log(`${section.title}:`);
    for (const item of section.items) {
      console.log(`- ${item}`);
    }
  }
}

function to_error_message(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function registerInitCommand(cli: CAC) {
  cli
    .command("init", "在当前空目录初始化最小 loong 节点工作区")
    .option("--org-file <file>", "按组织架构 JSON 在当前目录下创建根节点目录并递归初始化")
    .action((options: { orgFile?: string }) => {
      try {
        const result = init(process.cwd(), { org_file: options.orgFile });
        print_init_result(result);
      } catch (error) {
        console.error(`初始化失败: ${to_error_message(error)}`);
        process.exitCode = 1;
      }
    });
}
