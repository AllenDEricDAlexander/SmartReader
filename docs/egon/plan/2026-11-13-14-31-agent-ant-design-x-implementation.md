# AI 研究助手界面实施计划

| Field | Value |
| --- | --- |
| Document | `2026-11-13-14-31-agent-ant-design-x-implementation.md` |
| Status | `In Progress` |
| Created | 2026-11-13 14:31 Asia/Shanghai |
| Updated | 2026-11-13 14:31 Asia/Shanghai |
| Owner | SmartReader 项目维护者 |
| Repository | SmartReader |
| Scope | AI 研究助手 UI 与桌面验证 |
| Source Requirement | 用户确认界面方案并要求实现和 Tauri 验收 |
| Baseline Revision | `5c2a99a` |
| Implements Spec | [AI 研究助手界面方案](../spec/2026-11-13-14-24-agent-ant-design-x-ui.md) |
| Spec Status | `Accepted` |
| Spec Revision | 2026-11-13 14:24 Asia/Shanghai |
| Effective Specs | [AI 研究助手界面方案](../spec/2026-11-13-14-24-agent-ant-design-x-ui.md) |
| Depends On Plans | None |
| Supersedes | None |
| Superseded By | None |
| Related Plans | None |

## 1. Summary

实现已确认的 Ant Design X 界面并在隔离的 Tauri 实例验证三个主题与最小窗口。

## 2. Target Spec and Effective Design

[AI 研究助手界面方案](../spec/2026-11-13-14-24-agent-ant-design-x-ui.md) 是本次唯一适用设计。用户明确批准该方案并要求直接实现，本文记录执行路径。

## 3. Effective Requirements and Acceptance

保留方案的五项验收。重点为常驻输入、独立滚动、来源跳页、历史操作与恢复，以及三主题和最小窗口。

## 4. Implementation Strategy and Dependency Order

先完成聊天和输入并通过既有回归，再压缩历史操作和验证桌面。两步按顺序各自提交。

## 5. Change File Tree

- `src/ai/AiAssistant.test.tsx` · 步骤 1 · 输入、引用及独立滚动回归
- `src/ai/aiSessionPersistence.test.tsx` · 步骤 1、2 · 锁定和元数据保存时的滚动定位
- `src/app/ResearchApp.test.tsx` · 步骤 1 · 应用入口引用回归
- `vitest.setup.ts` · 步骤 1 · jsdom ResizeObserver 测试替身
- `package.json` · 步骤 1 · 接入声明与 React 18 兼容
- `bun.lock` · 步骤 1 · 锁定依赖
- `src/ai/AiAssistant.tsx` · 步骤 1、2 · 主工作区
- `src/app/ReaderApp.tsx` · 步骤 1 · 传入已生效主题并隔离入口依赖
- `src/ai/aiWorkspace.css` · 步骤 1、2 · 布局与局部组件样式
- `src/ai/AiConversationHistory.test.tsx` · 步骤 2 · 会话操作回归
- `src/ai/AiConversationHistory.tsx` · 步骤 2 · 历史列表与操作入口
- `src/ai/AiConversationGroups.tsx` · 步骤 2 · 分组管理

## 6. Prerequisites, Constraints, and Plan Clarifications

使用 React 18.3.1、Bun、Vite、Vitest 与 Tauri 2。工作树只有本轮设计文档。组件菜单与知识库的局部展示状态放在原有工作区。Tauri 验收使用新应用标识和合成数据。

## 7. Ordered File-by-file Implementation Steps

### Step 1 — 接入聊天组件并分离正文与输入区

- Requirements: REQ-001、REQ-002、REQ-004、REQ-005
- Dependencies: 无，基线 5c2a99a
- Observable outcome: 聊天正文滚动，底部常驻输入，文献面板和引用可展开。
- Ordered files: 按以下编号处理。

#### File 1 — `MODIFY src/ai/AiAssistant.test.tsx`

- Purpose: 输入、引用及独立滚动回归
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
将继续提问验证改为聚焦而不滚动，查询独立的对话区域。增加快捷问题只填草稿与 Enter 保留换行验证。先运行目标用例确认 RED。
```

- After this file: 输入、引用及独立滚动回归具备本步骤要求的改动。

#### File 2 — `MODIFY src/ai/aiSessionPersistence.test.tsx`

- Purpose: 锁定和元数据保存时的滚动定位
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
将滚动断言定位到独立对话区，并保留 section 节点复用断言。
```

- After this file: 锁定和元数据保存时的滚动定位具备本步骤要求的改动。

#### File 3 — `MODIFY src/app/ResearchApp.test.tsx`

- Purpose: 应用入口引用回归
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
点击来源区摘要后从原按钮打开 PDF，继续验证返回聊天后的草稿。
```

- After this file: 应用入口引用回归具备本步骤要求的改动。

#### File 4 — `MODIFY vitest.setup.ts`

- Purpose: 让 Ant Design X 组件在 jsdom 中可挂载。
- Symbols: ResizeObserver。
- Why now: 已安装组件的挂载测试需要该 Web API。
- Contract/signature changes: 仅测试环境。
- Implementation pseudocode:

```ts
if (!globalThis.ResizeObserver) stubGlobal('ResizeObserver', NoLayoutObserver)
```

- After this file: jsdom 测试与真实 WebView 布局验证分开。

#### File 5 — `MODIFY package.json`

- Purpose: 接入声明与 React 18 兼容
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
bun add --exact @ant-design/x@2.10.0 antd@6.7.0，安装后核对组件实际声明。
```

- After this file: 接入声明与 React 18 兼容具备本步骤要求的改动。

#### File 6 — `GENERATED bun.lock`

- Purpose: 锁定依赖
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
由 bun add 生成锁文件并检查是否含无关变动。
```

- After this file: 锁定依赖具备本步骤要求的改动。

#### File 7 — `MODIFY src/ai/AiAssistant.tsx`

- Purpose: 主工作区
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
XProvider(theme) 包裹子树；AiAssistantContent 保留 activeConversationId 挂载边界和 submit/cancel；Bubble 使用已有文本；Sender 受控且按原限制发送；使用 details 与 BookList 展开资料。
```

- After this file: 主工作区具备本步骤要求的改动。

#### File 8 — `MODIFY src/app/ReaderApp.tsx`

- Purpose: 传入已生效主题并隔离入口依赖
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
使用 React.lazy 加载 AiAssistant，Suspense 提供加载反馈，并传入 readerPreferences.theme。
```

- After this file: 传入已生效主题并隔离入口依赖具备本步骤要求的改动。

#### File 9 — `MODIFY src/ai/aiWorkspace.css`

- Purpose: 布局与局部组件样式
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
替换助手区域的滚动、版心和原始问答样式；维持设置页共享样式和历史布局。
```

- After this file: 布局与局部组件样式具备本步骤要求的改动。

- Verification command: bun run typecheck && bun run test src/ai/AiAssistant.test.tsx src/ai/aiSessionPersistence.test.tsx src/ai/knowledgeMembership.test.tsx src/app/ResearchApp.test.tsx --maxWorkers=2
- Expected result: 涉及的测试、类型检查及本步骤的构建或桌面检查通过。
- Completion criteria: 有可复核的验证结果及限定路径的提交。
- Rollback: 回退本步骤提交。
- Commit: `feat(ai): adopt Ant Design X for research chat`

### Step 2 — 紧凑化历史操作并验证桌面布局

- Requirements: REQ-003、REQ-004、REQ-005
- Dependencies: 第 1 步
- Observable outcome: 宽窗有侧栏，最小窗口按需打开历史，操作菜单和焦点可用。
- Ordered files: 按以下编号处理。

#### File 1 — `MODIFY src/ai/AiConversationHistory.test.tsx`

- Purpose: 会话操作回归
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
从 ⋯ 打开每行操作后继续验证重命名、置顶、分组、删除与权限。先运行焦点或菜单测试确认 RED。
```

- After this file: 会话操作回归具备本步骤要求的改动。

#### File 2 — `MODIFY src/ai/aiSessionPersistence.test.tsx`

- Purpose: 历史操作期间的阅读状态
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
通过行菜单触发现有元数据测试，保留对正文位置、推理展开和并发禁用的断言。
```

- After this file: 历史操作期间的阅读状态具备本步骤要求的改动。

#### File 3 — `MODIFY src/ai/AiConversationHistory.tsx`

- Purpose: 历史列表与操作入口
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
在每行渲染 ⋯ 开关。将既有 select 与操作按钮放入按需展开区。继续用现有 perform、movePinned、删除确认及焦点回退处理。
```

- After this file: 历史列表与操作入口具备本步骤要求的改动。

#### File 4 — `MODIFY src/ai/AiConversationGroups.tsx`

- Purpose: 分组管理
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
沿用原搜索、展开与排序操作，配合历史栏样式压缩重复视觉信息。需要时由 CSS 完成。
```

- After this file: 分组管理具备本步骤要求的改动。

#### File 5 — `MODIFY src/ai/AiAssistant.tsx`

- Purpose: 窄窗历史入口
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
宽度由工作区容器查询判断。用受控历史开合、关闭按钮、Escape 和焦点归还，保持历史及聊天节点在切换宽度时仍存在。
```

- After this file: 窄窗历史入口具备本步骤要求的改动。

#### File 6 — `MODIFY src/ai/aiWorkspace.css`

- Purpose: 响应式布局
- Symbols: 见下方伪代码。
- Why now: 为本步骤的后续接线或验证提供输入。
- Contract/signature changes: 局部界面或测试改动，沿用服务契约。
- Implementation pseudocode:

```text
宽屏 240px 历史栏。窄窗显示历史覆盖面板，正文和输入保持常驻。菜单与主题使用 --sr-*。
```

- After this file: 响应式布局具备本步骤要求的改动。

- Verification command: bun run typecheck && bun run test --maxWorkers=2 && bun run build，之后用隔离 Tauri QA 应用检查三主题与 860 × 560 窗口
- Expected result: 涉及的测试、类型检查及本步骤的构建或桌面检查通过。
- Completion criteria: 有可复核的验证结果及限定路径的提交。
- Rollback: 回退本步骤提交。
- Commit: `feat(ai): streamline conversation history and narrow layouts`

## 8. Test, Validation, and Quality Gates

先确认聚焦回归与会话菜单测试的预期 RED，再运行步骤验证。桌面验收记录实际窗口尺寸、主题和操作状态。

## 9. Migration, Compatibility, Rollout, and Rollback

N/A 数据库迁移。沿用原快照及服务，按步骤提交回退。

## 10. Requirement-to-Step Traceability Matrix

| Requirement | Step | Evidence |
| --- | --- | --- |
| REQ-001 | 1 | 独立正文滚动与 Sender |
| REQ-002 | 1 | 文献范围、引用展开和原文跳页 |
| REQ-003 | 2 | 行菜单、搜索、分组和排序 |
| REQ-004 | 1、2 | 取消、权限、历史和持久化回归 |
| REQ-005 | 1、2 | 主题、原生窗口和面板布局 |

## 11. Risks, Blockers, and User Decisions

Ant Design X 的构建体积和实际 WebView 布局需实测。当前没有待定的用户决策。

## 12. Review and Acceptance

执行完毕时将测试与原生运行结果对照设计验收条目。

**PASS — Ready for user review**
