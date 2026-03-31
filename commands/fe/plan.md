---
name: fe:plan
description: 解析功能列表和 Figma URL，智能分析后创建优化的任务列表
allowed-tools:
  - Read
  - Write
  - Bash
  - Grep
  - Glob
  - AskUserQuestion
  - mcp__plugin_figma_figma__get_screenshot
  - mcp__plugin_figma_figma__get_design_context
---
<objective>
解析用户提供的功能列表和 Figma 设计稿 URL，通过智能分析创建优化的任务计划。

输入格式示例：
```
功能1: 用户头像组件, figma设计稿: https://figma.com/design/xxx?node-id=1-2
功能2: 登录页面, figma设计稿: https://figma.com/design/xxx?node-id=3-4
功能3: 用户登录 API 对接
```
</objective>

<execution_context>
@~/.claude/fe-harness/workflows/plan.md
</execution_context>

<context>
$ARGUMENTS
</context>

<process>
按照 @~/.claude/fe-harness/workflows/plan.md 中的流程端到端执行任务规划。
使用 $ARGUMENTS 中的功能列表作为输入。
</process>
