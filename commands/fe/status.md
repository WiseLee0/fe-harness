---
name: fe:status
description: 查看任务状态概览
allowed-tools:
  - Read
  - Bash
---
<objective>
显示当前任务的状态概览，包括任务总数、各状态分布、每个任务的详细信息。
</objective>

<process>
1. 调用状态工具获取概览：
```bash
node ~/.claude/fe-harness/bin/fe-tools.cjs tasks status
```

2. 将返回的 JSON 格式化为可读的表格输出：

```
## Figma Implementation Status

| ID | 名称 | 类型 | 状态 | 重试次数 | 验证通过 |
|----|------|------|------|----------|----------|
| 1  | xxx  | 设计 | done | 0        | ✓        |
| 2  | yyy  | 逻辑 | pending | 0     | -        |
...

### 统计
- 总计: N 个任务
- ✅ 完成: N
- ⏳ 进行中: N
- 📋 待处理: N
- ❌ 失败: N
- ⏭️ 跳过: N
```

3. 如果没有 tasks.json，提示用户先运行 `/fe:plan`。
</process>
