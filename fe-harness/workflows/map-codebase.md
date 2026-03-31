<purpose>
编排并行前端代码库映射代理，分析代码库并在 .fe/codebase/ 中生成结构化文档。

每个代理拥有独立上下文，探索特定聚焦领域，并**直接写入文档**。编排器仅接收确认 + 行数，然后输出总结。

输出: .fe/codebase/ 目录，包含 7 个前端专属结构化文档。
</purpose>

<philosophy>
**为什么使用专属映射代理:**
- 每个领域独立上下文 (无 token 污染)
- 代理直接写入文档 (不回传上下文给编排器)
- 编排器仅总结创建了什么 (最小上下文占用)
- 更快执行 (代理同时运行)

**前端垂直化:**
不同于通用代码库映射，前端映射聚焦于:
- 组件架构与设计系统
- 样式方案与设计 token
- 状态管理与数据获取模式
- 路由与页面组织
- 前端性能指标 (LCP, CLS, INP, 包体积)

**文档质量优于简洁:**
包含足够的细节作为参考。优先提供实际的代码模式示例。

**始终包含文件路径:**
文档是 Claude 规划/执行时的参考材料。始终使用反引号格式化实际文件路径: `src/components/Button.tsx`。
</philosophy>

<process>

<step name="check_existing">
检查 .fe/codebase/ 是否已存在:

```bash
ls -la .fe/codebase/ 2>/dev/null
```

**如果目录存在且有文件:**

```
.fe/codebase/ 已存在，包含以下文档:
[列出找到的文件]

下一步?
1. 刷新 - 删除现有映射，重新分析
2. 更新 - 保留现有，仅更新特定文档
3. 跳过 - 使用现有代码库映射
```

等待用户响应。

如果 "刷新": 删除 .fe/codebase/，继续到 create_structure
如果 "更新": 询问更新哪些文档，继续到 spawn_agents (过滤)
如果 "跳过": 退出流程

**如果不存在:**
继续到 create_structure。
</step>

<step name="create_structure">
创建 .fe/codebase/ 目录:

```bash
mkdir -p .fe/codebase
```

**预期输出文件:**
- STACK.md (来自 tech 映射器) — 前端技术栈
- COMPONENTS.md (来自 ui 映射器) — 组件架构与设计系统
- STYLING.md (来自 ui 映射器) — 样式方案与设计 token
- STATE.md (来自 tech 映射器) — 状态管理与数据获取
- STRUCTURE.md (来自 structure 映射器) — 目录结构与路由
- CONVENTIONS.md (来自 structure 映射器) — 前端编码惯例
- CONCERNS.md (来自 concerns 映射器) — 前端问题与技术债

继续到 spawn_agents。
</step>

<step name="spawn_agents">
生成 4 个并行 fe-codebase-mapper 代理。

使用 Agent 工具，`subagent_type="general-purpose"`，`run_in_background=true` 并行执行。

**代理 1: 技术聚焦 (Tech Focus)**

```
Agent(
  run_in_background=true,
  subagent_type="general-purpose",
  model="haiku",
  description="映射前端技术栈",
  prompt="你是前端代码库映射代理。

聚焦: tech

分析此前端代码库的技术栈和状态管理模式。

写入以下文档到 .fe/codebase/:
- STACK.md — 前端框架、构建工具、TypeScript 配置、包管理器、关键依赖
- STATE.md — 状态管理方案、数据获取模式、表单管理、URL 状态

**探索方法:**
1. 读取 package.json 分析依赖
2. 查找框架配置文件 (next.config.*, vite.config.*, nuxt.config.*, angular.json 等)
3. 查找 TypeScript 配置 (tsconfig.json)
4. 搜索状态管理库的使用 (redux, zustand, jotai, pinia, vuex, @tanstack/react-query, swr 等)
5. 分析数据获取模式 (fetch, axios, graphql 等)

使用 @~/.claude/agents/fe-codebase-mapper.md 中的模板。
深入探索。直接使用 Write 工具写入文档。仅返回确认信息。"
)
```

**代理 2: UI 聚焦 (UI Focus)**

```
Agent(
  run_in_background=true,
  subagent_type="general-purpose",
  model="haiku",
  description="映射前端组件与样式",
  prompt="你是前端代码库映射代理。

聚焦: ui

分析此前端代码库的组件架构和样式方案。

写入以下文档到 .fe/codebase/:
- COMPONENTS.md — 组件库/设计系统、组件模式、Props 惯例、复合组件、图标系统
- STYLING.md — CSS 方案、设计 token、主题系统、响应式策略、暗色模式、动画

**探索方法:**
1. 查找组件目录 (src/components/, src/ui/, components/, app/components/ 等)
2. 分析组件模式 (函数组件、HOC、render props、compound components)
3. 查找 UI 库依赖 (antd, @mui, shadcn, @radix-ui, element-plus, arco-design 等)
4. 分析 CSS 方案 (Tailwind, CSS Modules, styled-components, Sass, Less, UnoCSS 等)
5. 查找设计 token 或主题配置

使用 @~/.claude/agents/fe-codebase-mapper.md 中的模板。
深入探索。直接使用 Write 工具写入文档。仅返回确认信息。"
)
```

**代理 3: 结构聚焦 (Structure Focus)**

```
Agent(
  run_in_background=true,
  subagent_type="general-purpose",
  model="haiku",
  description="映射前端结构与惯例",
  prompt="你是前端代码库映射代理。

聚焦: structure

分析此前端代码库的目录结构和编码惯例。

写入以下文档到 .fe/codebase/:
- STRUCTURE.md — 目录布局、路由方案、页面组织、功能模块结构、新代码放置指南
- CONVENTIONS.md — 命名模式、组件命名、Hooks 模式、TypeScript 模式、导入组织、代码风格

**探索方法:**
1. 分析目录结构 (find . -type d 排除 node_modules)
2. 查找路由配置 (pages/, app/, router/, routes/ 等)
3. 分析文件命名模式
4. 查找 lint/format 配置 (.eslintrc*, .prettierrc*, biome.json 等)
5. 读取示例文件分析编码惯例
6. 查找自定义 hooks 的模式

使用 @~/.claude/agents/fe-codebase-mapper.md 中的模板。
深入探索。直接使用 Write 工具写入文档。仅返回确认信息。"
)
```

**代理 4: 问题聚焦 (Concerns Focus)**

```
Agent(
  run_in_background=true,
  subagent_type="general-purpose",
  model="haiku",
  description="映射前端问题与技术债",
  prompt="你是前端代码库映射代理。

聚焦: concerns

分析此前端代码库的技术债、性能问题和潜在风险。

写入以下文档到 .fe/codebase/:
- CONCERNS.md — 性能问题(包体积/渲染/Core Web Vitals)、可访问性差距、技术债、浏览器兼容、测试覆盖缺口

**探索方法:**
1. 搜索 TODO/FIXME/HACK 注释
2. 查找大型文件 (>500行的组件可能需要拆分)
3. 分析包体积 (检查大型依赖如 moment.js, lodash 全量导入)
4. 检查可访问性 (搜索 aria-*, role, alt 属性的使用情况)
5. 查找性能反模式 (内联函数创建、缺少 memo/useMemo、大型列表无虚拟化)
6. 检查测试覆盖 (查找测试文件分布)
7. 检查 any 类型使用、ts-ignore 等 TypeScript 问题

使用 @~/.claude/agents/fe-codebase-mapper.md 中的模板。
深入探索。直接使用 Write 工具写入文档。仅返回确认信息。"
)
```

继续到 collect_confirmations。
</step>

<step name="collect_confirmations">
等待所有 4 个代理完成。

Agent 工具会在后台代理完成时自动通知。收集所有 4 个代理的确认。

**预期确认格式:**
```
## 映射完成

**聚焦:** {focus}
**已写入文档:**
- `.fe/codebase/{DOC1}.md` ({N} 行)
- `.fe/codebase/{DOC2}.md` ({N} 行)

已就绪。
```

**你收到的:** 仅文件路径和行数，不是文档内容。

如果任何代理失败，记录失败并继续处理成功的文档。

继续到 verify_output。
</step>

<step name="verify_output">
验证所有文档是否成功创建:

```bash
ls -la .fe/codebase/
wc -l .fe/codebase/*.md
```

**验证清单:**
- 所有 7 个文档存在
- 没有空文档 (每个应有 >20 行)

如果有文档缺失或为空，记录哪些代理可能失败了。

继续到 scan_for_secrets。
</step>

<step name="scan_for_secrets">
**关键安全检查:** 扫描输出文件中是否意外泄露了密钥。

```bash
grep -E '(sk-[a-zA-Z0-9]{20,}|sk_live_[a-zA-Z0-9]+|sk_test_[a-zA-Z0-9]+|ghp_[a-zA-Z0-9]{36}|gho_[a-zA-Z0-9]{36}|glpat-[a-zA-Z0-9_-]+|AKIA[A-Z0-9]{16}|xox[baprs]-[a-zA-Z0-9-]+|-----BEGIN.*PRIVATE KEY|eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.)' .fe/codebase/*.md 2>/dev/null && SECRETS_FOUND=true || SECRETS_FOUND=false
```

**如果 SECRETS_FOUND=true:**
警告用户并等待确认后再继续。

**如果 SECRETS_FOUND=false:**
继续到 commit_codebase_map。
</step>

<step name="commit_codebase_map">
提交代码库映射文档:

```bash
git add .fe/codebase/*.md
git commit -m "docs: 映射前端代码库结构"
```

如果提交失败 (如没有 git 仓库或 pre-commit hook 失败)，记录错误但不阻塞流程，继续到 offer_next。

继续到 offer_next。
</step>

<step name="offer_next">
展示完成总结和下一步操作。

```bash
wc -l .fe/codebase/*.md
```

**输出格式:**

```
前端代码库映射完成。

已创建 .fe/codebase/:
- STACK.md ([N] 行) - 前端技术栈与依赖
- COMPONENTS.md ([N] 行) - 组件架构与设计系统
- STYLING.md ([N] 行) - 样式方案与设计 token
- STATE.md ([N] 行) - 状态管理与数据获取
- STRUCTURE.md ([N] 行) - 目录结构与路由
- CONVENTIONS.md ([N] 行) - 前端编码惯例
- CONCERNS.md ([N] 行) - 问题与技术债


---

## 下一步

**开始规划** — 基于代码库理解创建任务计划

`/fe:plan`

---

**其他操作:**
- 重新映射: `/fe:map-codebase`
- 查看特定文档: `cat .fe/codebase/STACK.md`
- 在继续前编辑任何文档

---
```

结束流程。
</step>

</process>

<success_criteria>
- .fe/codebase/ 目录已创建
- 4 个并行 fe-codebase-mapper 代理使用 run_in_background=true 生成
- 所有 7 个代码库文档存在
- 没有空文档 (每个应有 >20 行)
- 清晰的完成总结包含行数
- 用户获得明确的下一步操作指引
</success_criteria>
