# 完成工作流

## 概述

在所有任务执行完毕后，生成完成报告、归档运行时产物、清理临时文件。

---

## 流程

### 第一步：获取完成摘要

```bash
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks summary
```

解析返回的 JSON，检查 `isAllFinished` 字段：

- **`isAllFinished: true`** → 所有任务已完成（done/failed/skipped），继续下一步
- **`isAllFinished: false`** → 还有未完成的任务，输出提示并终止：
  ```
  ⚠️ 还有 N 个任务未完成（pending: X, in_progress: Y）。
  请先运行 /fe:execute 完成剩余任务，或手动处理后再运行 /fe:complete。
  ```

### 第二步：输出完成报告

将摘要数据格式化为可读报告：

```markdown
## ✅ fe-harness 执行完成

### 任务统计

| 指标 | 值 |
|------|-----|
| 总任务数 | {total} |
| ✅ 完成 | {done} |
| ❌ 失败 | {failed} |
| ⏭️ 跳过 | {skipped} |
| 🔄 总重试次数 | {totalRetries} |
| ⏱️ 总耗时 | {duration.totalFormatted} |
| 🕐 开始时间 | {duration.startedAt} |
| 🕐 结束时间 | {duration.completedAt} |

### 任务类型

| 类型 | 完成 / 总计 |
|------|-------------|
| 🎨 设计任务 | {designTasks.done} / {designTasks.total} |
| ⚙️ 逻辑任务 | {logicTasks.done} / {logicTasks.total} |

### 任务详情

| ID | 名称 | 类型 | 状态 | 重试 | 实现耗时 | 总耗时 |
|----|------|------|------|------|----------|--------|
| {id} | {name} | {type} | {status} | {retryCount} | {executorDuration} | {duration} |
...

> **实现耗时** = executor 独立实现阶段的耗时（startedAt → executorFinishedAt）
> **总耗时** = 含合并、验证、修复的端到端耗时（startedAt → completedAt）
> 同 wave 内多个任务的实现耗时重叠说明并行执行生效。
```

### 第三步：输出警告（如有）

如果 `hasWarnings: true`，在报告后追加：

```markdown
### ⚠️ 未解决的问题

| ID | 名称 | 状态 | 错误信息 |
|----|------|------|----------|
| {id} | {name} | {status} | {error} |
...

> 这些任务未成功完成。可以使用 `node ~/.claude/fe-harness/bin/fe-tools.cjs tasks reset-all-failed` 重置后重新执行。
```

### 第四步：输出 Token 消耗

在报告末尾追加当前会话的 token 消耗信息。通过以下 bash 命令获取：

```bash
claude --print-session-usage 2>/dev/null || echo '{"error":"unavailable"}'
```

如果命令不可用或报错，直接输出提示：

```markdown
### 💰 Token 消耗

> 当前会话的 token 消耗请通过 `/cost` 命令查看。
```

如果命令返回了有效数据，格式化输出：

```markdown
### 💰 Token 消耗

| 指标 | 值 |
|------|-----|
| 输入 tokens | {input_tokens} |
| 输出 tokens | {output_tokens} |
| 总 tokens | {total_tokens} |
| 估算费用 | ${cost} |
```

### 第五步：归档运行时产物

```bash
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks archive
```

这会：
1. 将 `tasks.json` 和 `context/` 下的所有文件复制到 `.fe-runtime/history/{timestamp}/`
2. 删除原始 `tasks.json`
3. 清空 `context/` 目录

输出归档结果：
```
📦 已归档到 {archiveDir}
```

### 第六步：提示后续操作

```markdown
### 后续操作

- 查看归档数据：`ls .fe-runtime/history/`
- 开始新一轮任务：准备功能列表后运行 `/fe:plan`
- 如需重新执行失败任务：从归档恢复 tasks.json 后运行 `/fe:execute`
```

---

## 参数支持

- `--no-archive`：只生成报告，不归档和清理（通过 `$ARGUMENTS` 传入）
- `--force`：即使有未完成任务也强制完成（跳过第一步检查）

如果 `$ARGUMENTS` 包含 `--no-archive`，跳过第四步。
如果 `$ARGUMENTS` 包含 `--force`，跳过第一步的未完成检查。
