---
name: fe:execute
description: 两级编排执行所有待处理任务（顶层 wave 调度 → wave-runner 内部闭环）
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Grep
  - Glob
  - Agent
  - mcp__plugin_figma_figma__get_design_context
  - mcp__plugin_figma_figma__get_screenshot
---
<objective>
两级编排架构。顶层编排器按 Wave 串行调度，每个 Wave 委托给 fe-wave-runner 子代理在独立上下文窗口中完成：

1. 并行调用 fe-executor（isolation=worktree）实现
2. 合并 worktree + backpressure 检查
3. 并行调用 fe-verifier/fe-reviewer 验证
4. 串行修复循环（fe-fixer → 重新验证）
5. 通过后 git commit，失败后传播到下游 Wave

顶层编排器只做 wave 级调度，上下文消耗 O(waves)。
</objective>

<execution_context>
@~/.claude/fe-harness/workflows/execute.md
</execution_context>

<process>
严格按照 @~/.claude/fe-harness/workflows/execute.md 中的编排流程执行。

关键要求：
1. 使用 Agent 工具调用 fe-wave-runner（每个 wave 一次调用）
2. fe-wave-runner 内部自行调用 fe-executor/fe-verifier/fe-reviewer/fe-fixer
3. 不使用 isolation="worktree" 调用 wave-runner（它需要主仓库 git 访问）
4. 不使用 run_in_background 调用 wave-runner（wave 间必须串行）
5. 每个 wave 开始前从 tasks waves 刷新状态
6. 读取 wave-result JSON 获取结果

上下文管理：
- 不复述 Agent 结果
- 每个 wave 只输出一行摘要
- 所有实现/验证/修复细节在 wave-runner 内部完成
</process>
