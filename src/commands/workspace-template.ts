export function build_codex_config_template(): string {
  return `# Project Codex configuration for loong.
# Loong agents run with direct workspace access and no approval prompts by default.
sandbox_mode = "danger-full-access"
approval_policy = "never"
`;
}

export function build_world_model_template(): string {
  return `# 世界模型

## 当前仍然有效的环境事实
- 

## 当前可用的资源
- 

## 当前生效的外部约束
- 

## 重要对象及其关系
- 

## 尚未确定但会影响后续行动的问题
- 

## 最近发生变化且需要持续关注的事实
- 
`;
}

export function build_learned_template(): string {
  return `# 经验沉淀

## 已验证有效的做法
- 

## 已验证无效或低效的做法
- 

## 可复用的判断经验
- 

## 常见失败模式
- 

## 需要保留的策略修正
- 

## 适用条件与置信说明
- 
`;
}
