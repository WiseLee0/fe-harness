# 任务规划工作流

## 概述
解析用户输入的功能列表和 Figma URL，通过设计分析、多轮讨论和智能优化创建精准的任务列表。

## 流程

### Step 1: 检查状态

检查 `.fe-runtime/tasks.json` 是否存在：
- 不存在 → 进入初始化阶段
- 已存在：
  - 用户提供了新功能列表 → 询问：重新初始化（覆盖）还是合并追加
  - 用户没有提供新功能列表 → 显示当前状态概览（调用 `/fe:status`）

### Step 2: 解析用户输入

**期望的输入格式：**
```
功能1: 用户头像组件, figma设计稿: https://figma.com/design/xxx?node-id=1-2
功能2: 登录页面, figma设计稿: https://figma.com/design/xxx?node-id=3-4
功能3: 用户登录 API 对接
功能4: 全局状态管理
```

解析每条功能，提取：
- `name`: 功能名称
- `figmaUrl`: Figma URL（可能没有）
- `figmaFileKey`: 从 URL 提取
- `figmaNodeId`: 从 URL 提取（将 `-` 转为 `:`）

有 Figma URL 的 → 设计任务（视觉验证）
无 Figma URL 的 → 逻辑任务（代码审查）

### Step 3: 智能分析和优化

#### 3a+3b. 并行分析（设计截图 + 项目扫描）

3a（获取设计截图）和 3b（扫描现有项目）之间没有数据依赖，**必须使用 Agent 工具并行执行**。

在一条消息中同时发起两个 Agent 调用，等待两者都完成后再继续：

**Agent 1: 设计截图分析**

```
Agent(
  subagent_type="general-purpose",
  model="haiku",
  description="获取 Figma 设计截图",
  prompt="使用 @fe-harness/agents/fe-design-scanner.md 中的流程。

设计任务列表:
${DESIGN_TASKS_JSON}"
)
```

**Agent 2: 项目扫描**

```
Agent(
  subagent_type="general-purpose",
  model="haiku",
  description="扫描现有项目结构",
  prompt="使用 @fe-harness/agents/fe-project-scanner.md 中的流程。"
)
```

两个 Agent 都完成后，读取 `.fe-runtime/context/design-analysis.json` 和 `.fe-runtime/context/project-scan.json`，作为后续步骤的输入。

#### 3c. 灰色地带讨论

基于设计截图分析（design-analysis.json）和项目上下文（project-scan.json），识别设计稿中未明确表达的实现决策点。

**识别维度：**
- **交互行为**: 点击、悬停、动画、过渡效果等设计稿无法表达的行为
- **响应式策略**: 不同屏幕尺寸下的布局变化、折叠/隐藏规则
- **边界情况**: 空状态、加载状态、错误状态、超长文本、极端数据
- **业务逻辑**: 表单验证规则、权限控制、数据流向
- **组件复用**: 是否拆为公共组件、组件 API 设计倾向

**执行方式：**
1. 逐个任务审视设计截图，列出不确定的灰色地带
2. 将所有灰色地带合并去重，按优先级排序
3. 用 `AskUserQuestion` 逐个或分组提问（每个问题提供 2-4 个选项 + 推荐项）
4. 如果用户回复"跳过"或"都行"，使用推荐默认值
5. 将所有决策记录到内存中，传递给下一步优化（最终写入各任务的 `techNotes` 字段）

**控制节奏：**
- 聚焦于真正影响实现方向的决策，避免问琐碎细节（如颜色、字号等设计稿已明确的内容）
- 每轮可利用 `AskUserQuestion` 的多问题能力（最多 4 个问题/轮）批量提问
- 讨论持续到所有重要灰色地带都有明确决策为止，不设硬性轮次上限
- 如果用户回复"够了"或"剩下的你决定"，立即结束讨论，未决项使用推荐默认值

#### 3c+. 反问确认

灰色地带讨论结束后，主动反问用户是否还有补充：

```
AskUserQuestion(
  question: "在我开始生成最终任务列表之前，你还有什么需要和我讨论的吗？",
  header: "补充讨论",
  options: [
    { label: "没有，继续", description: "所有需要讨论的内容已经覆盖，直接进入任务优化阶段" }
  ]
)
```

- 用户选择「没有，继续」→ 直接进入 3d
- 用户选择「Other」并输入补充内容 → 针对补充内容继续讨论，讨论完毕后再次反问，直到用户选择「没有，继续」

#### 3d. AI 驱动优化（6 个维度）

基于用户输入、设计截图、项目上下文，以及**灰色地带讨论中的决策结果**，进行智能优化：

1. **名称优化**: 使名称更精确、可操作
2. **描述充实**: 为每个任务生成三个维度的描述：
   - `description`: 功能描述（做什么）
   - `acceptanceCriteria`: 验收条件数组（怎么算做好了，verifier/reviewer 的判定标准）
   - `techNotes`: 实现提示（怎么做：复用哪些现有组件、灰色地带讨论决策、技术方案等）
3. **粒度拆分**: 过大的任务拆分为更小的子任务
4. **粒度合并**: 过于琐碎的相关任务合并
5. **缺口识别**: 发现遗漏的任务（例如需要但未列出的公共组件、API 对接等）
6. **路由推断**: 根据项目路由方案（project-scan.json）和功能描述，为每个任务推断 `route`（dev server 中的可访问路径）
7. **文件所有权声明**: 为每个任务声明 `filesModified`（预计修改的文件路径列表）

**文件所有权规则（用于并行执行冲突检测）：**
- 每个任务必须声明 `filesModified` 字段，列出预计创建或修改的文件
- 同一 Wave 内的任务，`filesModified` 不允许有交集（否则并行 worktree 合并会冲突）
- 如果检测到同 wave 内文件冲突，有两种处理方式：
  1. 将冲突任务加入 `dependsOn`，使其分到不同 wave（串行执行）
  2. 将冲突任务合并为一个任务
- 文件路径粒度：使用文件级，不使用目录级（如 `src/components/Avatar.tsx` 而非 `src/components/`）
- 公共文件（如 `src/App.tsx`, `src/router.ts`, `package.json`）：多个任务可能都需要修改的公共文件，应通过 `dependsOn` 确保这些任务分到不同 wave

#### 3e. 展示优化后的任务列表
以表格形式展示优化后的任务列表，自动继续（不需要用户确认）。

### Step 4: 确认配置完整

读取 `.fe/config.jsonc`，**仅当存在设计任务时**检查 `devServerCommand` 是否已填写。
- 有设计任务（含 figmaUrl 的任务）且未配置 → 提示用户先编辑 `.fe/config.jsonc` 配置开发服务器启动命令
- 全部都是逻辑任务 → 跳过此检查，不需要开发服务器

### Step 5: 创建任务文件

写入 `.fe-runtime/tasks.json`，每个任务的 schema：
```json
{
  "id": 1,
  "name": "功能名称",
  "description": "功能描述（做什么）",
  "acceptanceCriteria": ["验收条件1", "验收条件2"],
  "techNotes": "实现提示（复用哪些组件、灰色地带决策、技术方案等）",
  "route": "/page-path",
  "figmaUrl": "https://...",
  "figmaFileKey": "xxx",
  "figmaNodeId": "1:2",
  "dependsOn": [],
  "filesModified": ["src/components/Avatar.tsx", "src/components/Avatar.css"],
  "status": "pending",
  "verifyPassed": false,
  "retryCount": 0,
  "bestScore": 0,
  "bestScoresJSON": null,
  "lastError": "",
  "completedAt": ""
}
```

**`route` 字段说明：**
- 填写该功能实现后在 dev server 中可访问的页面路径（如 `"/login"`, `"/settings/profile"`）
- 如果是全局组件/工具函数（不对应特定页面），填 `"/"`
- executor 自检、verifier 验证、fixer 自检都依赖此字段导航到正确页面

依赖关系和文件所有权规则：
- `dependsOn` 通过分析任务间的逻辑关系自动生成
- `filesModified` 通过分析设计稿和项目结构推断
- 同一 wave 内任务的 `filesModified` 不允许交集

### Step 5b: Wave 分组与冲突检测

任务写入后，调用 fe-tools 验证 wave 分组：

```bash
WAVES=$(node ~/.claude/fe-harness/bin/fe-tools.cjs tasks waves)
```

**Wave 分组基于 `dependsOn` 自动计算（拓扑排序）：**
- Wave 1: 无依赖的任务（可并行执行）
- Wave 2: 仅依赖 Wave 1 的任务（可并行执行）
- Wave N: 依赖 Wave N-1 的任务

**文件冲突检测：**

```bash
CONFLICTS=$(node ~/.claude/fe-harness/bin/fe-tools.cjs tasks check-conflicts)
```

如果检测到同 wave 内文件冲突：
1. 输出冲突详情：哪些任务、哪些文件有冲突
2. 自动将冲突任务添加 `dependsOn` 关系，使其分到不同 wave
3. 重新计算 wave 分组

**展示格式：**
```
## Wave 执行计划

| Wave | 任务 | 类型 | 并行 |
|------|------|------|------|
| 1 | #1 用户头像组件, #2 登录表单 | design, design | ✓ |
| 2 | #3 API 对接 | logic | - |

文件所有权:
- #1: src/components/Avatar.tsx, src/components/Avatar.css
- #2: src/components/LoginForm.tsx, src/components/LoginForm.css
- #3: src/api/auth.ts, src/components/LoginForm.tsx (→ 依赖 #2)
```

如果所有任务都在同一个 wave（无依赖关系且无文件冲突），提示用户："所有任务无依赖关系，将在 Wave 1 中并行执行。"

### Step 6: 完成

输出规划完成信息和 wave 执行计划，提示用户先清除上下文再开始执行。

提示信息应包含：
- 任务总数和 wave 数
- 每个 wave 的任务数和并行执行能力
- 预期的执行流程："Wave 1 (3个任务并行) → Wave 2 (2个任务并行) → ..."
- 提示用户：「规划已完成并写入 `.fe/` 目录。建议先执行 `/clear` 清除上下文，再使用 `/fe:execute` 开始执行，以获得更充裕的上下文空间。」
