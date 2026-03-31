# 执行编排工作流

## 概述
两级编排架构：顶层编排器串行调度 wave，每个 wave 委托 `fe-wave-runner` 子代理在独立上下文中完成。

**架构：**
```
顶层编排器 (本文件)
  └─ per wave → Agent(fe-wave-runner)      ← 独立上下文
       ├─ Agent(fe-executor) ×N (worktree 隔离, 并行)
       ├─ 合并 worktree + backpressure 检查
       ├─ Agent(fe-verifier/reviewer) ×N (并行)
       ├─ 修复循环
       └─ git commit + 写 wave-result
```

**核心原则：**
- 编排器只调度，不执行实现/验证/修复
- 每个 wave 在独立上下文中闭环完成
- 状态持久化到 tasks.json，支持断点续跑

## 前置检查

```bash
INIT=$(node ~/.claude/fe-harness/bin/fe-tools.cjs init execute)
```

- `error` → 输出错误，终止
- 成功 → 提取 config 和任务统计

```bash
CONFIG=$(node ~/.claude/fe-harness/bin/fe-tools.cjs config get)
```

提取关键配置：`devServerCommand`, `maxRetries`, `verifyThreshold`, `reviewThreshold`, `dimensionThreshold`, `scoreDropTolerance`, `backpressureCommand`, `maxParallelBrowsers`

## 获取 Wave 执行计划

```bash
WAVES=$(node ~/.claude/fe-harness/bin/fe-tools.cjs tasks waves)
```

提取：`waves`（按 wave 分组）、`waveOrder`（执行顺序）、`taskCount`

> `circularWarning` 不为 null 时**必须**输出警告。

输出计划概览：
```
Wave 执行计划: {waveOrder.length} 个 wave, {taskCount} 个任务
Wave 1: {n} 个任务 | Wave 2: {n} 个任务 | ...
```

## 自动解决文件冲突

检查同 wave 内是否有任务修改相同文件，自动添加依赖关系将冲突任务分到不同 wave：

```bash
RESOLVE=$(node ~/.claude/fe-harness/bin/fe-tools.cjs tasks resolve-conflicts)
```

- `resolved > 0` → 输出提示：`⚠️ 检测到 {resolved} 个文件冲突，已自动添加依赖关系。重新计算 wave 分组。`，然后重新获取 wave 计划：
  ```bash
  WAVES=$(node ~/.claude/fe-harness/bin/fe-tools.cjs tasks waves)
  ```
  重新输出计划概览。
- `resolved = 0` 或 `ok: true` 且无冲突 → 静默继续

## 启动开发服务器

> 仅设计任务需要开发服务器。全部为逻辑任务时跳过本节。

**前置校验：** 有设计任务但 `devServerCommand` 未配置时：
- 输出：`ERROR: 存在设计任务但 devServerCommand 未配置，请编辑 .fe/config.jsonc 填写。`
- 终止执行

```bash
# 分配随机端口（存在微小竞态窗口，若端口冲突可重试）
DEV_PORT=$(node -e "const s=require('net').createServer();s.listen(0,()=>{console.log(s.address().port);s.close()})")
DEV_SERVER_URL="http://localhost:$DEV_PORT"

# 启动开发服务器（后台运行）
PORT=$DEV_PORT ${devServerCommand} &
DEV_SERVER_PID=$!

# 等待服务器启动（最多 30 秒）
SERVER_READY=false
for i in $(seq 1 30); do
  if curl -s $DEV_SERVER_URL > /dev/null 2>&1; then
    SERVER_READY=true
    break
  fi
  sleep 1
done

if [ "$SERVER_READY" = "false" ]; then
  echo "ERROR: Dev server failed to start within 30 seconds on port $DEV_PORT"
  # 终止编排循环
fi
```

**后续 `${devServerUrl}` 均使用 `$DEV_SERVER_URL`。**

## 主执行循环

逐 wave 串行执行：

### 1. 刷新状态

```bash
WAVES=$(node ~/.claude/fe-harness/bin/fe-tools.cjs tasks waves)
```

> `circularWarning` 不为 null 时**必须**输出。

### 2. 跳过检查

当前 wave 所有任务 status 为 `done` → 输出 `Wave {N}: 已完成，跳过` 并继续下一个。

### 3. 读取 wave 任务

从 `tasks.json` 读取当前 wave 的完整任务对象：

```bash
WAVE_TASKS=$(node -e "
  const tasks = JSON.parse(require('fs').readFileSync('.fe-runtime/tasks.json','utf8'));
  const waveTaskIds = [${wave_task_ids}];
  const waveTasks = tasks.filter(t => waveTaskIds.includes(t.id));
  console.log(JSON.stringify(waveTasks));
")
```

### 4. 委托给 fe-wave-runner

```
Agent(
  subagent_type="fe-wave-runner",
  model="opus",
  description="执行 Wave ${N}: ${taskNames}",
  prompt="""
<wave_context>
waveNumber: ${N}
totalWaves: ${totalWaves}
devServerUrl: ${DEV_SERVER_URL}
devServerCommand: ${devServerCommand}
backpressureCommand: ${backpressureCommand}
maxRetries: ${maxRetries}
verifyThreshold: ${verifyThreshold}
reviewThreshold: ${reviewThreshold}
dimensionThreshold: ${dimensionThreshold}
scoreDropTolerance: ${scoreDropTolerance}
maxParallelBrowsers: ${maxParallelBrowsers}
feToolsPath: ~/.claude/fe-harness/bin/fe-tools.cjs
browserPath: ~/.claude/fe-harness/bin/browser.cjs
</wave_context>

<wave_tasks>
${WAVE_TASKS}
</wave_tasks>
""")
```

**注意：**
- **禁用** `isolation="worktree"` — wave-runner 需要主仓库 git 访问
- **禁用** `run_in_background` — wave 间必须串行
- wave-runner 内部自行调度 fe-executor（带 worktree）、fe-verifier、fe-reviewer、fe-fixer

### 5. 读取 wave 结果

```bash
cat .fe-runtime/context/wave-result-${N}.json
```

输出摘要：`--- Wave {N} 完成: {passed} 通过, {failed} 失败 ---`

### 6. 下一个 Wave

回到步骤 1。

## 断点续跑

重新执行时自动恢复：
- 已完成的任务（status 为 `done`）和 wave 自动跳过
- 从首个含 pending 任务的 wave 继续
- 失败任务（status 为 `failed`）不会重试，保留失败状态

**残留状态清理：**
- `fe-checkpoint-*` 标签：来自中断的修复循环，重新执行前会被新的检查点覆盖（`git tag -f`），无需手动清理
- `fe-wave-*-baseline` 标签：来自中断的 wave，新 wave 执行时会覆盖同名标签
- `.fe-runtime/context/` 下的中间文件：每个 wave 验证前会通过 `init context` 清理

**如需完全重置：**
```bash
# 重置所有任务状态为 pending（慎用）
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks reset
# 清理所有检查点标签
git tag -l 'fe-checkpoint-*' | xargs git tag -d 2>/dev/null || true
git tag -l 'fe-wave-*-baseline' | xargs git tag -d 2>/dev/null || true
```

## 完成

所有 wave 处理完毕后：

```bash
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks status
```

输出摘要：
```
--- 执行完成 ---
完成: {done}/{total} | 失败: {failed} | 跳过: {skipped}
```

```bash
# 停止开发服务器
kill $DEV_SERVER_PID 2>/dev/null || true

# 清理残留浏览器实例
node ~/.claude/fe-harness/bin/browser.cjs cleanup
```

## 上下文管理

1. **不复述 Agent 结果** — 返回摘要已在上下文中
2. **每 wave 一行摘要** — 不逐任务展开
3. **状态从磁盘读** — 每轮循环通过 `tasks waves` 刷新
4. **实现/验证/修复均在 wave-runner 内** — 编排器不介入细节
