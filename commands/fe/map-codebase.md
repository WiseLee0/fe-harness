---
name: fe:map-codebase
description: 分析前端代码库，使用并行映射代理生成 .fe/codebase/ 下的结构化文档
argument-hint: "[可选: 聚焦区域, 如 'components' 或 'routing']"
allowed-tools:
  - Read
  - Bash
  - Glob
  - Grep
  - Write
  - Agent
---

<objective>
使用并行 fe-codebase-mapper 代理分析现有前端代码库，生成结构化的前端代码库文档。

每个映射代理探索一个聚焦领域，并**直接写入文档**到 `.fe/codebase/`。编排器仅接收确认信息，保持上下文占用最小。

输出: .fe/codebase/ 目录，包含 7 个前端专属的结构化文档。
</objective>

<execution_context>
@~/.claude/fe-harness/workflows/map-codebase.md
</execution_context>

<context>
聚焦区域: $ARGUMENTS (可选 - 如果提供，告知代理聚焦特定子系统)

**如果已有配置则加载:**
检查 .fe/config.jsonc - 如果项目已初始化则加载上下文

**此命令可在以下时机运行:**
- /fe:plan 之前 (基于代码库理解生成更好的计划)
- 任何时候刷新代码库理解
</context>

<when_to_use>
**使用 map-codebase:**
- 已有前端项目，需要在规划前理解代码库
- 代码发生重大变更后刷新代码库映射
- 接手不熟悉的前端代码库
- 大型重构前理解当前状态
- 团队新成员快速了解项目

**跳过 map-codebase:**
- 全新项目，还没有代码
- 极简代码库 (<5 个文件)
</when_to_use>

<process>
严格按照 @~/.claude/fe-harness/workflows/map-codebase.md 中的编排流程执行。
</process>

<success_criteria>
- [ ] .fe/codebase/ 目录已创建
- [ ] 所有 7 个代码库文档由映射代理写入
- [ ] 文档遵循模板结构
- [ ] 并行代理无错误完成
- [ ] 用户知晓下一步操作
</success_criteria>
