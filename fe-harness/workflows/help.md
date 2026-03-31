# 帮助文档

## fe-harness 命令参考

### 可用命令

| 命令 | 说明 |
|------|------|
| `/fe:plan` | 解析功能列表和 Figma URL，创建优化的任务列表 |
| `/fe:execute` | 执行所有待处理任务（实现 → 验证 → 修复循环） |
| `/fe:complete` | 生成完成报告、归档运行时产物并清理环境 |
| `/fe:status` | 查看任务状态概览 |
| `/fe:help` | 显示此帮助信息 |

### 快速开始

```
1. npx fe-harness              ← 安装并生成 .fe/config.jsonc
2. 编辑 .fe/config.jsonc        ← 配置开发服务器等参数
3. 输入功能列表后执行 /fe:plan   ← 创建任务
4. /fe:execute                 ← 自动执行所有任务
5. /fe:complete                ← 生成报告并归档
```

### 输入格式

```
功能1: 用户头像组件, figma设计稿: https://figma.com/design/xxx?node-id=1-2
功能2: 登录页面, figma设计稿: https://figma.com/design/xxx?node-id=3-4
功能3: 用户登录 API 对接
功能4: 全局状态管理
```

- 有 `figma设计稿:` URL 的 → 设计任务（视觉验证）
- 无 URL 的 → 逻辑任务（代码审查）

### 执行流程

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│  fe-executor │────→│ fe-verifier  │────→│  fe-fixer   │
│  实现代码    │     │ 或 fe-reviewer│     │  修复问题   │
└─────────────┘     └──────┬───────┘     └──────┬──────┘
                           │                     │
                           │  未通过              │
                           │←────────────────────┘
                           │  
                           │  通过 ✓
                           ▼
                    ┌──────────────┐
                    │  git commit  │
                    └──────────────┘
```

每个任务最多重试 maxRetries 次（默认 5 次）。

### 配置说明

| 配置项 | 默认值 | 说明 |
|--------|--------|------|
| maxRetries | 5 | 每个任务的最大重试次数 |
| devServerCommand | "" | 开发服务器启动命令（自动分配随机端口） |
| verifyThreshold | 80 | 视觉验证通过阈值 (%) |
| reviewThreshold | 80 | 代码审查通过阈值 (%) |
| dimensionThreshold | 6 | 单维度最低分 (0-10) |
| scoreDropTolerance | 3 | 修复后允许的最大分数下降 |
| backpressureCommand | "" | 硬性校验命令 |
| maxParallelBrowsers | 3 | 同时运行的最大浏览器实例数（防止系统资源耗尽） |

### fe-tools CLI

状态管理工具，在 Bash 中直接调用：

```bash
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks status    # 状态概览
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks next      # 下一个任务
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks reset 1   # 重置任务
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks reset-all-failed  # 重置所有失败任务
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks summary           # 完成摘要
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks archive           # 归档并清理
node ~/.claude/fe-harness/bin/fe-tools.cjs config get      # 查看配置
```

### 安装方式

```bash
npx fe-harness          # 全局安装到 ~/.claude/
npx fe-harness --local  # 本地安装到 ./.claude/
```
