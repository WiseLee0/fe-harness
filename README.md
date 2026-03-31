# fe-harness

Figma design-to-code harness for Claude Code. 通过子代理驱动的实现、视觉验证和迭代修复，将 Figma 设计稿转化为生产代码。

## 安装
```bash
npx fe-harness              # 全局安装到 ~/.claude/
npx fe-harness local        # 本地安装到 ./.claude/
npx fe-harness init         # 在当前目录初始化项目配置
```
安装脚本会将命令、代理和运行时文件复制到目标项目的 `.claude/` 目录下。

## 卸载

```bash
npx fe-harness uninstall          # 卸载全局安装
npx fe-harness uninstall local    # 卸载本地安装
```

## 功能

- **设计稿到代码**：从 Figma 设计稿自动生成前端代码
- **视觉验证**：对比 Figma 设计稿与实际实现的视觉差异
- **迭代修复**：根据验证报告自动修复代码问题
- **代码库映射**：分析项目结构，生成结构化文档

## 使用

安装后，在 Claude Code 中使用 `/fe` 命令：

| 命令 | 说明 |
|------|------|
| `/fe:execute` | 执行 Figma 设计稿或逻辑功能的代码实现 |
| `/fe:plan` | 规划实现方案 |
| `/fe:map-codebase` | 探索并映射代码库结构 |
| `/fe:status` | 查看当前状态 |
| `/fe:complete` | 完成任务 |
| `/fe:help` | 查看帮助信息 |

## 子代理

| 代理 | 职责 |
|------|------|
| `fe-executor` | 执行 Figma 设计或纯逻辑功能的代码实现 |
| `fe-verifier` | 视觉 QA 审查，对比 Figma 与实际实现 |
| `fe-fixer` | 根据验证报告修复代码问题 |
| `fe-reviewer` | 代码质量审查 |
| `fe-codebase-mapper` | 探索代码库并生成结构化分析文档 |
| `fe-design-scanner` | 扫描 Figma 设计稿 |
| `fe-project-scanner` | 扫描项目结构 |
| `fe-wave-runner` | 批量任务执行 |
| `fe-fix-loop` | 修复循环 |

## 环境要求

- Node.js >= 18.0.0
- Claude Code CLI
- Figma MCP（用于设计稿获取）

## 许可证

MIT
