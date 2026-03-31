# 模型分配策略

## 分配原则

| 模型 | 适用场景 | 特点 |
|------|---------|------|
| **opus** | 需要精确推理和创造性判断的任务 | 最强推理能力，成本最高 |
| **sonnet** | 执行类、验证类任务 | 平衡性能与成本 |
| **haiku** | 纯读取、探索、结构化输出 | 最快最便宜 |

## Agent 模型映射表

| Agent 角色 | 模型 | 理由 |
|---|---|---|
| `fe-executor` | **opus** | 代码实现是核心环节，复杂组件需要深度架构推理 |
| `fe-verifier` | **opus** | 多步流程（浏览器操作+样式提取+数值比对+结构化报告），需要精确遵循复杂指令 |
| `fe-reviewer` | sonnet | 结构化代码审查与评分，中等复杂度 |
| `fe-fixer` (visual) | **opus** | 视觉修复需要精确判断 CSS/布局细节以匹配 Figma 设计稿 |
| `fe-fixer` (logic) | sonnet | 跟随审查报告的明确指引修复代码问题 |
| `fe-fixer` (backpressure) | sonnet | 跟随构建/lint 错误信息修复，模式明确 |
| `fe-design-scanner` | haiku | 纯 API 调用获取 Figma 截图，数据提取 |
| `fe-project-scanner` | haiku | 文件探索与结构化输出，无复杂推理 |
| `fe-codebase-mapper` (x4) | haiku | 纯代码库探索与文档生成，无复杂推理 |

## 使用方式

在 Agent 调用中通过 `model` 参数指定：

```python
# opus — 需要精确推理
Agent(subagent_type="fe-fixer", model="opus", prompt="...")

# sonnet — 执行与验证
Agent(subagent_type="fe-executor", model="sonnet", prompt="...")

# haiku — 探索与扫描
Agent(subagent_type="general-purpose", model="haiku", prompt="...")
```

## 调优建议

- 如果 `fe-executor` 在复杂组件实现上质量不足，可升级为 opus
- 如果 `fe-fixer` (visual) 的修复效果已经很好，可降级为 sonnet 节省成本
- `fe-verifier` 已升级为 opus：verifier 需要执行 5 步复杂流程（Figma API + 浏览器操作 + JS eval + 数值比对 + 结构化报告），sonnet 容易跳过浏览器步骤或生成主观评分报告。如果成本过高，可降级为 sonnet 但需接受报告质量可能下降
