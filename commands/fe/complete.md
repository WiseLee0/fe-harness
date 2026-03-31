---
name: fe:complete
description: 完成所有任务后生成摘要报告、归档运行时产物并清理环境
allowed-tools:
  - Read
  - Bash
  - Write
---
<objective>
在所有任务执行完毕后，汇总执行结果、生成完成报告、归档运行时产物并清理临时文件。

这是 fe-harness 工作流的最后一步：plan → execute → complete。
</objective>

<execution_context>
@~/.claude/fe-harness/workflows/complete.md
</execution_context>

<context>
$ARGUMENTS
</context>

<when_to_use>
- 当 `/fe:execute` 执行完毕后，使用此命令收尾
- 当想查看任务执行的最终摘要报告时
- 当需要归档本轮任务数据、为下一轮做准备时

不要在以下情况使用：
- 还有 pending 或 in_progress 的任务（会提示先完成执行）
- 还没有 tasks.json（会提示先运行 /fe:plan）
</when_to_use>

<process>
严格按照 @~/.claude/fe-harness/workflows/complete.md 中的流程执行。
</process>
