# 2026-08-16 15:14 SmartReader 阅读器文档导航栏实施 Plan

| Field | Value |
| --- | --- |
| Document | `2026-08-16-15-14-reader-document-navigation-implementation.md` |
| Status | `Review` |
| Created | `2026-08-16 15:14 CST` |
| Updated | `2026-08-16 15:14 CST` |
| Owner | User |
| Repository | `SmartReader` |
| Scope | React 阅读器文档导航栏、文档会话打开/关闭、首页/阅读器/工具工作区切换、相关组件与应用测试 |
| Source Requirement | 2026-08-16 用户明确要求使用 `egon-coding-writing-plan` 将阅读器文档导航栏 Spec 转化为 Plan |
| Baseline Revision | `main` @ `94de3a9665a2ccb540d877609d48dda8d116c27c`；`origin/main` 同 revision；生成 Plan 前工作区仅有本轮未跟踪主 Spec |
| Implements Spec | [SmartReader 阅读器文档导航栏优化 Spec](../spec/2026-08-16-14-21-reader-document-navigation-bar.md) |
| Spec Status | `Review` |
| Spec Revision | `Updated 2026-08-16 15:14 CST`；设计内容基于 `main@94de3a9`，本次仅增加 Plan 关系元数据 |
| Effective Specs | [SmartReader 阅读器文档导航栏优化 Spec](../spec/2026-08-16-14-21-reader-document-navigation-bar.md)；[SmartReader PDF Reader Design](../../superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md)；[SmartReader Stabilization Design](../../superpowers/specs/2026-06-17-smartreader-stabilization-design.md) |
| Depends On Plans | `None` |
| Supersedes | `None` |
| Superseded By | `None` |
| Related Plans | `None` |

## 1. Summary

本 Plan 实现唯一主目标 [SmartReader 阅读器文档导航栏优化 Spec](../spec/2026-08-16-14-21-reader-document-navigation-bar.md)。实施范围限定为 React/TypeScript 前端：把现有 `ReaderTabs` 提升为 home/reader 共享导航栏，支持首页、任意标签关闭和打开新文件；复用现有 session、Blob URL、文件打开、快捷键和 debounce persistence；修复工具工作区关闭后的来源返回；移除 `ReaderToolbar` 中重复的文件打开和当前标签关闭入口。

实施分为 4 个顺序 Step，每个 Step 对应一个语义提交：

1. 先用纯 store characterization 和 focused hook RED test 建立按任意 `sessionId` 关闭的生命周期入口。
2. 再以组件/应用 RED tests 驱动共享导航栏、打开激活通知、home/reader 往返、布局与可访问性接线。
3. 独立修复工具工作区的 home/reader 返回来源。
4. 移除阅读工具栏重复入口，清理 props，并完成命令和全量前端回归。

完成证据将是 16 个目标文件的路径受限变更、每 Step 的 focused tests 与 typecheck、最终全量前端测试和 build、`git diff --check`，以及由用户执行的 Tauri 手工清单。本 Plan 不修改生产代码、不运行迁移、不启动应用，也不把未来验证描述为已经通过。

## 2. Target Spec and Effective Design

### 2.1 Primary target

- Path: [SmartReader 阅读器文档导航栏优化 Spec](../spec/2026-08-16-14-21-reader-document-navigation-bar.md)
- Status: `Review`
- Revision: `Updated 2026-08-16 15:14 CST`；设计 baseline 为 `main@94de3a9665a2ccb540d877609d48dda8d116c27c`
- Approval evidence: 用户在该 Spec 生成后明确要求“把 spec 转化成 plan”，因此授权生成一份待评审 Plan；用户尚未把主 Spec 或本 Plan 标记为 Accepted/Ready，所以本 Plan 保持 `Review`，不得据此自动开始实现。
- Original source requirement: 标签栏支持关闭文件、从栏内打开新文件，并提供从阅读器回到首页的路径。

### 2.2 Effective Spec set

| Role | Spec/link | Status/revision | Effective sections | Why included |
| --- | --- | --- | --- | --- |
| Primary | [SmartReader 阅读器文档导航栏优化 Spec](../spec/2026-08-16-14-21-reader-document-navigation-bar.md) | `Review`；Updated `2026-08-16 15:14 CST`；baseline `94de3a9` | 全文，尤其 §4、§7–§9、§12、§14–§16、§19–§20 | 唯一直接治理本次功能、接口、文件树、状态、测试和验收的文档 |
| Amended base | [SmartReader PDF Reader Design](../../superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md) | Legacy Approved；`2026-06-15`；文末 `Approval State` 记录用户批准 | §Product Layout、§Architecture / Frontend Modules、§Open File Flow、§Cache Design；其 viewer、persistence、history、annotations 等未被修订部分继续有效 | 主 Spec 的 `Amends` 明确局部修订标签条归属和关闭入口，同时保留多标签、重复路径聚焦、Blob URL 与 typed persistence 基线 |
| Normative dependency | [SmartReader Stabilization Design](../../superpowers/specs/2026-06-17-smartreader-stabilization-design.md) | Legacy design；`2026-06-17`；由主 Spec `Depends On` 明确纳入 | §Target Architecture / Frontend Boundary、§Data Flow / Open PDF、§Data Flow / Switch Tab、§Feature Completion Rules / Cache | 约束 hooks/component 边界、打开/切换调用链、session-scoped URL 和关闭资源释放 |

### 2.3 Superseded or excluded content

- 2026-06-15 Product Layout 中“top tab strip 仅属于 reader shell”在本功能范围内由主 Spec 修订为 home/reader 共享；其 PDF viewer、侧栏、持久化、历史和批注设计不变。
- 2026-06-17 UI Design 中“不引入 landing page”的历史表述不用于否定当前已实现首页；本 Plan 只采用主 Spec点名的 frontend boundary、open/switch flow 和 cache 章节。
- 主 Spec 的 `Related Specs`（2026-06-18 MVP Workbench、2026-07-01 Home Top Bar、2026-07-03 Home Completion）是兼容性上下文，不是本 Plan 的规范性依赖。它们要求保留的首页 `HomeTopBar`、首页打开入口和 home shell 已被主 Spec §3、§5、§12、§16 直接重述，因此不从这些相关文档引入额外需求 ID。
- `Supersedes` 为 `None`；没有 replacement 文档或有效设计冲突。

## 3. Effective Requirements and Acceptance

| Requirement | Source Spec section | Effective statement | Observable acceptance | Implementation impact |
| --- | --- | --- | --- | --- |
| `REQ-001` | [主 Spec](../spec/2026-08-16-14-21-reader-document-navigation-bar.md) §4、§7、§12 | home 与 reader 顶部渲染同一个文档导航栏 | 两个主工作区均有首页、标签区和打开入口；工具工作区无该栏 | `ReaderApp` 组合、`ReaderWorkspace` 去 tabs slot、CSS grid、App/component tests |
| `REQ-002` | 主 Spec §4、§7.3、§12.5 | 首页入口只切换工作区，不销毁 session | sessions、页码、缩放、历史与 Blob URL 保留 | `openHomeWorkspace`、App round-trip test |
| `REQ-003` | 主 Spec §4、§7.3、§9 | 首页点击标签或成功打开文档后进入 reader 并激活目标 | viewer source 与目标 session 一致 | `openReaderSession`、`onDocumentSessionActivated`、App tests |
| `REQ-004` | 主 Spec §4、§7.3、§9 | 每个标签按自己的 `sessionId` 独立关闭 | 活动/后台标签均可关闭，close 不先触发 select | `ReaderTabsProps`、`closeReaderSession`、component/hook tests |
| `REQ-005` | 主 Spec §4、§7.3–§7.5、§10.6 | 保持后台关闭、左邻居回退、最后关闭、URL revoke 和空会话保存规则 | viewer 不因后台关闭重绑；活动关闭同步 fallback；最后回 home | store/hook/App/persistence assertions |
| `REQ-006` | 主 Spec §4、§7.3、§9.1、§12.5 | 导航栏固定打开入口复用 native/browser fallback 和现有 open pipeline | unsupported/reject fallback；cancel no-op；成功或重复路径进入 reader | `ReaderTabs` file input、`useDocumentOpening` callback、App tests |
| `REQ-007` | 主 Spec §4、§7.2、§12.2 | `ReaderToolbar` 移除重复打开/浏览器选择/关闭当前标签入口 | 搜索、翻页、缩放、书签、批注、收藏和设置仍存在 | toolbar props/JSX/import cleanup、workspace props cleanup、tests |
| `REQ-008` | 主 Spec §4、§12.3–§12.5、§15.2 | 两端动作固定，中部标签横向滚动，长标题截断，活动标签可见 | 860px 附近和窄窗口不丢首页/打开入口 | `ReaderTabs` refs、`styles.css`、DOM/static/manual gates |
| `REQ-009` | 主 Spec §4、§12.6–§12.7 | sibling buttons、键盘聚焦、中文 accessible names 和关闭后焦点恢复 | 无 button 嵌套；active/final close 后焦点正确 | `ReaderTabs` DOM/ref/effect、Testing Library assertions |
| `REQ-010` | 主 Spec §4、§9.4、§13.1、§16.1 | `Meta+O`、`Meta+W`、next/previous tab 命令不变 | 命令仍调用既有 open/close/select action | 保留 `closeActiveTab` wrapper 和 `useReaderCommands` 接线；App regression |
| `REQ-011` | 主 Spec §4、§6、§11、§16 | 不改 persistence schema、Rust/Tauri command 或依赖 | manifest、`src-tauri`、migrations、transport types 无功能变更 | 路径清单和最终 diff gate；无 cargo/migration Step |
| `REQ-012` | 主 Spec §4、§7.1、§7.5、§9、§12.1 | 工具关闭返回打开它的 home/reader；reader 已不可用时回 home | home+A→settings→close 回 home；reader+A→settings→close 回 reader | `workspaceReturnTarget`、统一 `closeToolWorkspace`、App/Switch tests |

## 4. Implementation Strategy and Dependency Order

### 4.1 Ordered strategy

依赖方向按“纯状态规则 → hook 生命周期 → 共享展示与 app 编排 → 工具返回状态 → 冗余接口收敛”推进：

1. `closeDocumentSession` 已有正确的纯状态语义，先补 characterization，再用新 `useReaderNavigation.test.tsx` 固定 cache/viewer side effects，最后增加 `closeReaderSession(sessionId)` 并让 `closeActiveTab` 委托它。后续 UI 只消费一个关闭入口。
2. `ReaderTabs` 的新 props 和 DOM 先在组件测试中定义；应用级测试先定义 home round-trip、任意关闭、打开、duplicate 和 browser path；随后修改 open hook、workspace composition、`ReaderApp` 和 CSS，直到共享调用链整体 GREEN。组件接口变化与唯一消费者在同一 Step 完成，避免提交长期 type error。
3. 共享栏使“home 有活动文档”成为常态，因此工具返回来源必须独立测试和实现。`ReaderApp` 记录主工作区来源，`ReaderWorkspaceSwitch` 的 settings 与其他工具统一使用 `closeToolWorkspace`。
4. 最后移除 toolbar 重复入口和旧 props。此时共享栏已经稳定，旧 App tests 可以从 `Close active tab`/reader toolbar input 迁移到新标签 close 和唯一 navigation input，同时证明 `Meta+O`/`Meta+W` 保持兼容。

无 schema、generated contract、Rust、permissions、configuration 或 dependency publication 顺序。`DocumentSession`、`PersistedReaderSession`、`PersistenceApi`、Tauri commands 与 migrations 001–006 均保持原样。

### 4.2 Test-first strategy

| Behavior | RED test first | Expected RED reason | Minimum GREEN implementation | Refactor/wiring allowed afterward |
| --- | --- | --- | --- | --- |
| 按任意 session 关闭并区分 active/background viewer sync | `useReaderNavigation.test.tsx` | hook 尚未导出 `closeReaderSession`；编译/断言失败 | 在 `useReaderNavigation` 集中 revoke、store close 和 conditional sync | `closeActiveTab` 只做 active ID wrapper |
| 共享栏结构、首页/标签/close/open callbacks、fallback、focus | `ReaderTabs.test.tsx` | 当前 props/DOM 只有 tab select，没有 home、close、open、input、refs | 扩展 `ReaderTabsProps` 和 component-local refs/effects | 样式类与 app composition 接线 |
| home/reader 往返、任意关闭、新/重复/browser 打开 | `App.test.tsx` | 当前栏只在 reader 内；没有首页或标签 close；打开成功不会统一清理 home override | `onDocumentSessionActivated` + `ReaderApp` callbacks + shared render | 清理 `ReaderWorkspace` tabs slot 和旧 View props |
| 工具返回来源 | `App.test.tsx`、`ReaderWorkspaceSwitch.test.tsx` | 当前 close 只 `setWorkspaceOverride(null)`，home+A 会回 reader；settings 未统一 callback | `workspaceReturnTarget` + `closeToolWorkspace` | 把 settings onClose 与 command close 接入同一入口 |
| toolbar 重复入口移除与命令兼容 | `ReaderToolbar.test.tsx`、`App.test.tsx` | toolbar 仍渲染打开/input/X；旧选择器依赖这些入口 | 删除 toolbar props/JSX/imports，清理消费者 | 仅做相关 prop 和 fixture 清理，不重排其他 toolbar 功能 |

纯 `documentSessionStore` 的新增 case 是已实现规则的 characterization，预期在生产变更前已经 GREEN；真正缺失行为的 RED 证据由同 Step 的 focused hook test 提供。CSS 视觉无法由 jsdom 证明，DOM class/结构测试先行，最终由 static/build gate 和用户手工窗口检查补足。

### 4.3 Sequential and parallel boundaries

| Step | Depends on | May run in parallel with | Must not overlap with | Reason |
| --- | --- | --- | --- | --- |
| Step 1 | None | None | `src/documents/documentSessionStore.test.ts`、`src/reader/hooks/useReaderNavigation*` | 先发布 UI 所需的统一关闭动作和资源契约 |
| Step 2 | Step 1 | None | `ReaderTabs*`、`ReaderApp.tsx`、workspace composition/tests、`useDocumentOpening.ts`、`styles.css` | props、唯一消费者和 app grid 必须原子接线，且直接消费 Step 1 action |
| Step 3 | Step 2 | None | `ReaderApp.tsx`、`ReaderWorkspaceSwitch*`、`App.test.tsx` | 工具来源依赖 home override 和共享栏已存在；与 Step 2 有重叠写作用域 |
| Step 4 | Steps 2–3 | None | toolbar、workspace props/tests、`ReaderApp.tsx`、`App.test.tsx` | 只有共享入口和返回语义稳定后才能安全删除旧入口并迁移测试选择器 |

所有 Step 必须顺序执行；没有互不重叠且可安全并行的写作用域。实现期间如果多人协作，后续 Step 只能在前一 Step 提交和验证后开始。

### 4.4 Commit boundaries

每个 Step 产生一个路径受限语义提交，提交前只 stage 本 Step 文件并核对 `git diff --cached --name-only`：

1. `feat(reader): support closing any document session`
2. `feat(reader): add shared document navigation bar`
3. `fix(app): preserve tool workspace return target`
4. `refactor(reader): remove duplicate document controls`

Plan/Spec 文档属于本轮用户设计产物，不混入以上生产实现提交；执行时保留任何与本 Plan 无关的脏工作区文件。

## 5. Change File Tree

```text
src/
├── app/
│   ├── App.test.tsx                              MODIFY  Steps 2–4
│   ├── ReaderApp.tsx                             MODIFY  Steps 2–4
│   ├── ReaderWorkspaceSwitch.test.tsx            MODIFY  Steps 2–4
│   ├── ReaderWorkspaceSwitch.tsx                 MODIFY  Steps 2–4
│   ├── ReaderWorkspaceView.test.tsx              MODIFY  Steps 2, 4
│   ├── ReaderWorkspaceView.tsx                   MODIFY  Steps 2, 4
│   └── styles.css                                MODIFY  Step 2
├── documents/
│   └── documentSessionStore.test.ts              MODIFY  Step 1
└── reader/
    ├── ReaderTabs.test.tsx                       CREATE  Step 2
    ├── ReaderTabs.tsx                            MODIFY  Step 2
    ├── ReaderToolbar.test.tsx                    MODIFY  Step 4
    ├── ReaderToolbar.tsx                         MODIFY  Step 4
    ├── ReaderWorkspace.tsx                       MODIFY  Step 2
    └── hooks/
        ├── useDocumentOpening.ts                 MODIFY  Step 2
        ├── useReaderNavigation.test.tsx          CREATE  Step 1
        └── useReaderNavigation.ts                MODIFY  Step 1
```

| Operation | Path | Symbols | Responsibility | Step | Requirements |
| --- | --- | --- | --- | --- | --- |
| MODIFY | `src/documents/documentSessionStore.test.ts` | `documentSessionStore` close cases | 固定后台、最后和非法 ID 的纯状态规则 | Step 1 | `REQ-005` |
| CREATE | `src/reader/hooks/useReaderNavigation.test.tsx` | `useReaderNavigation` focused tests | 证明 revoke 和 conditional viewer sync | Step 1 | `REQ-004`、`REQ-005`、`REQ-010` |
| MODIFY | `src/reader/hooks/useReaderNavigation.ts` | `closeReaderSession`、`closeActiveTab` | 统一按 ID 关闭入口 | Step 1 | `REQ-004`、`REQ-005`、`REQ-010` |
| CREATE | `src/reader/ReaderTabs.test.tsx` | `ReaderTabs` component tests | 共享栏结构、回调、fallback、focus、scroll/a11y | Step 2 | `REQ-001` 至 `REQ-006`、`REQ-008`、`REQ-009` |
| MODIFY | `src/reader/ReaderTabs.tsx` | `ReaderTabsProps`、`ReaderTabs` | 首页/标签/close/open 的共享展示组件 | Step 2 | `REQ-001` 至 `REQ-006`、`REQ-008`、`REQ-009` |
| MODIFY | `src/reader/hooks/useDocumentOpening.ts` | `UseDocumentOpeningInput`、`openBytes` | 成功创建/聚焦 session 后通知应用进入 reader | Step 2 | `REQ-003`、`REQ-006` |
| MODIFY | `src/reader/ReaderWorkspace.tsx` | `ReaderWorkspaceProps`、`ReaderWorkspace` | 删除 reader 内部 `tabs` slot | Step 2 | `REQ-001`、`REQ-007` |
| MODIFY | `src/app/ReaderWorkspaceView.tsx` | `ReaderWorkspaceViewProps`、`ReaderWorkspaceView` | 移除本地 tabs 组合，后续移除 toolbar 文档生命周期 props | Steps 2, 4 | `REQ-001`、`REQ-007` |
| MODIFY | `src/app/ReaderWorkspaceView.test.tsx` | reader composition test | 断言 viewer/toolbar，且共享栏不归 reader view 所有 | Steps 2, 4 | `REQ-001`、`REQ-007` |
| MODIFY | `src/app/ReaderWorkspaceSwitch.tsx` | `ReaderWorkspaceSwitchProps`、`ReaderWorkspaceSwitch` | 清理上移 props，统一 tool close | Steps 2–4 | `REQ-001`、`REQ-007`、`REQ-012` |
| MODIFY | `src/app/ReaderWorkspaceSwitch.test.tsx` | `renderSwitch` fixtures/tests | 保持内部 props 编译并证明 settings close callback | Steps 2–4 | `REQ-001`、`REQ-007`、`REQ-012` |
| MODIFY | `src/app/ReaderApp.tsx` | `ReaderApp` state/callbacks/render | 共享栏组合、workspace 往返、open activation、tool return | Steps 2–4 | `REQ-001` 至 `REQ-007`、`REQ-010` 至 `REQ-012` |
| MODIFY | `src/app/App.test.tsx` | application integration tests | 覆盖 round-trip、任意 close、open、persistence、tool return 和 shortcuts | Steps 2–4 | `REQ-001` 至 `REQ-012` |
| MODIFY | `src/app/styles.css` | app-shell/reader-tabs/reader-workspace responsive selectors | 两端固定、中部滚动和 grid 行调整 | Step 2 | `REQ-001`、`REQ-008`、`REQ-009` |
| MODIFY | `src/reader/ReaderToolbar.test.tsx` | toolbar component tests | 证明重复入口消失、阅读动作保留 | Step 4 | `REQ-007`、`REQ-010` |
| MODIFY | `src/reader/ReaderToolbar.tsx` | `ReaderToolbarProps`、`ReaderToolbar` | 删除 open/input/close UI 和 imports | Step 4 | `REQ-007`、`REQ-010` |

没有 DELETE、RENAME、GENERATED、manifest、configuration、permission、database 或 migration 文件。

## 6. Prerequisites, Constraints, and Plan Clarifications

### 6.1 Repository and worktree baseline

- Applicable repository instructions: 本会话提供的 Main Agent Rules；仓库根目录扫描未发现磁盘 `AGENTS.md`。
- Branch/revision: `main@94de3a9665a2ccb540d877609d48dda8d116c27c`，与 `origin/main` 一致。
- Plan 生成前 dirty state: 仅 `?? docs/egon/spec/2026-08-16-14-21-reader-document-navigation-bar.md`，属于本轮用户要求的主 Spec；没有生产代码并发变更。
- Plan 交付后预期额外文档变更: 本 Plan 文件与主 Spec 的 `Related Plans`/`Updated` 元数据。执行实现时必须保留这些文档和未来出现的无关用户变更。
- 每个实现 Step 使用显式路径 stage；禁止 `git add .`，禁止 reset/checkout 用户文件，禁止把 docs、构建产物或不属于该 Step 的文件带入提交。
- `public/pdf.worker.min.js` 由 `postinstall` 生成；本功能不运行依赖安装、不修改或提交该 generated asset。

### 6.2 Build, test, and environment prerequisites

| Concern | Exact command/source | Required state | Validation boundary |
| --- | --- | --- | --- |
| Package scripts | `package.json` | 现有 Bun dependencies 已安装；不新增 package | 前端静态/测试/build |
| Focused Vitest | `bun run test <exact test paths>` | jsdom + `vitest.setup.ts`；Testing Library 16.3.2 | 组件/hook/app fake-boundary proof |
| TypeScript | `bun run typecheck` | strict `tsc -b` | 所有内部 props/consumer 编译一致性 |
| Frontend build | `bun run build` | `tsc -b && vite build` | 生产 bundle/static integration，不证明 Tauri runtime |
| Full frontend regression | `bun run test` | 全部 Vitest suites | 前端模块回归；fake bridge/persistence 边界 |
| Static diff | `git diff --check`、`git status --short` | 无 whitespace errors；只有计划内路径 | 变更范围/格式 |
| Desktop manual | 用户启动 Tauri | 实现和自动 gate 完成后 | 原生 dialog、真实 PDF、窗口尺寸和视觉焦点 |

不运行 `bun run dev`、`bun run tauri` 或浏览器。由于没有 `src-tauri`、Rust 或 SQLite 变更，不要求 cargo test 作为本功能完成 gate；若实际 diff 触及这些边界，立即停止并返回 Spec，而不是扩展 Plan。

### 6.3 Immutable constraints and approved decisions

- `src-tauri/src/migrations/001_init.sql` 至 `006_bookmark_management.sql` 全部不可修改；本功能不创建 `007`。
- `schema_migrations` 与 `save_reader_session_tx` 的 `BEGIN IMMEDIATE TRANSACTION` 维持现状。
- `DocumentSession`、`DocumentState`、`PersistedReaderSession`、`PersistenceApi` 和 Tauri command contracts 不变。
- `file.open`、`tab.close`、`tab.next`、`tab.previous` command IDs 与默认快捷键不变。
- `ReaderApp` 继续拥有 app/workspace/session orchestration；组件不访问 cache、persistence 或 Tauri。
- `PdfViewerBridge` 与 `@react-pdf-viewer` imports 不进入导航组件。
- 首页 `HomeTopBar` 和已有首页打开入口保留；共享栏只显示在 home/reader。
- 不引入 router、Context、event bus、state machine library、第三方依赖或新的持久化字段。
- 关闭没有确认弹窗；首页切换非破坏；duplicate `documentKey` 聚焦已有标签。

### 6.4 Plan Clarifications

| ID | Small implementation inference | Repository evidence | Why semantics are unchanged | Impact if wrong |
| --- | --- | --- | --- | --- |
| `PLAN-CLAR-001` | 新增 `src/reader/hooks/useReaderNavigation.test.tsx`，而不是把所有 cache/viewer side-effect 证明都压在 `App.test.tsx` | 主 Spec §14.1 允许当 hook 超过直接委托时增加 focused hook test；新逻辑需区分 active/background sync | 只增加测试文件，不改变产品、接口或架构；使用现有 `renderHook` 约定 | 若团队坚持不新增该 test，可把同一断言移入 `App.test.tsx`，生产设计不变，但 RED 定位更慢 |
| `PLAN-CLAR-002` | 将现有 `activeWorkspace = workspaceOverride ?? ...` 推导移动到 `ReaderApp` 中 `activeSession` 之后、tool open callbacks 之前 | 当前推导位于 render 尾部；`openSettingsWorkspace`/`openShortcutWorkspace` 定义更早，新增来源捕获需要读取主工作区 | 表达式和值域完全不变，只调整声明顺序以避免 TDZ 并形成稳定 callback dependency | 若源码在执行前重排，可保持当前位置并用同语义的小型纯函数计算来源 |

没有会改变业务行为、公共契约、数据、安全、迁移或 rollout 的 Plan 级新决策。

## 7. Ordered File-by-file Implementation Steps

> 每个 Step 都先落测试契约，再落最小生产实现，验证成功后形成一个语义提交。文件编号表示该 Step 内的严格处理顺序。

### Step 1 — 建立按任意文档会话关闭的资源生命周期入口

- Requirements: `REQ-004`, `REQ-005`, `REQ-010`
- Dependencies: `None`
- Observable outcome: `useReaderNavigation` 可按任意 `sessionId` 关闭；后台关闭只 revoke 目标 URL 且不重绑 viewer，活动关闭同步 store 选出的 fallback，`closeActiveTab` 继续服务 `tab.close` 命令。
- Ordered files:

#### File 1 — `MODIFY src/documents/documentSessionStore.test.ts`

- Purpose: 在 hook side effects 之前固定底层已有的关闭状态规则。
- Symbols: `describe('documentSessionStore')`；新增 `keeps the active session when closing a background session`、`clears the active session when closing the final session`、`ignores an unknown session id` cases。
- Why now: hook 的 conditional viewer sync 依赖 `closeDocumentSession` 对 active ID 的准确结果；这些是 characterization，不应通过修改 store 来“修”测试。
- Contract/signature changes: 无生产签名变化；断言 sessions 顺序、active ID、`sidebarOpen` 和非法 ID deep equality。
- Implementation pseudocode:

```ts
test background close:
  first = addDocumentSession(empty, A)
  second = addDocumentSession(first, B)       // B active
  next = closeDocumentSession(second, A.id)
  assert next.sessions == [B]
  assert next.activeSessionId == B.id

test final close:
  state = addDocumentSession(empty with sidebarOpen=true, A)
  next = closeDocumentSession(state, A.id)
  assert next.sessions == []
  assert next.activeSessionId == null
  assert next.sidebarOpen == true

test unknown close:
  next = closeDocumentSession(state, 'missing-session')
  assert next deeply equals state
```

- After this file: store tests明确证明 Spec fallback；它们应在生产变更前已经 GREEN，若失败则说明主 Spec baseline 已漂移并停止 Step。

#### File 2 — `CREATE src/reader/hooks/useReaderNavigation.test.tsx`

- Purpose: 先定义缺失的按 ID 关闭 action 及 cache/viewer side effects。
- Symbols: `useReaderNavigation` focused suite；`closeReaderSession` active/background/missing tests；`closeActiveTab` compatibility test。
- Why now: 这是 Step 的真正 RED contract；当前 hook 没有 `closeReaderSession` export，无法满足组件按标签 ID 关闭。
- Contract/signature changes: 期望 hook return 增加 `closeReaderSession(sessionId: string): void`，并保留 `closeActiveTab(): void`。
- Implementation pseudocode:

```ts
for each case arrange a fresh A/B DocumentState with B active
arrange setDocuments(updater) to apply updater to that case's mutable currentState
arrange blobUrlCache double:
  revokeForSession = spy
  getForSession(A.id) returns 'blob:a'
arrange setViewerSource spy and ViewerActions no-op double

background case:
  renderHook useReaderNavigation(inputs)
  act closeReaderSession(A.id)
  assert revokeForSession called with A.id
  assert currentState.activeSessionId remains B.id
  assert setViewerSource not called

active fallback case:
  render a fresh hook/state
  act closeReaderSession(B.id)
  assert revokeForSession called with B.id
  assert currentState.activeSessionId == A.id
  assert setViewerSource receives { sessionId: A.id, url: 'blob:a' }

missing case:
  render a fresh hook/state
  act closeReaderSession('missing-session')
  assert state deeply unchanged and viewer source not rebound

compatibility case:
  render a fresh hook with activeSession B
  act closeActiveTab()
  assert the same close path handles B; no second lifecycle branch
```

- After this file: focused suite fails only because `closeReaderSession` is absent/incorrect；fixtures use existing `renderHook` convention and do not require Tauri or viewer rendering。

#### File 3 — `MODIFY src/reader/hooks/useReaderNavigation.ts`

- Purpose: 实现一个统一的任意 session 关闭 facade，并保持现有快捷键 wrapper。
- Symbols: new `closeReaderSession` callback；rewritten `closeActiveTab`；hook return object。
- Why now: RED contract 已固定 active/background/missing 的资源和 viewer 语义。
- Contract/signature changes: hook return 增加 `closeReaderSession(sessionId: string): void`；其他 action signatures 不变。
- Implementation pseudocode:

```ts
const closeReaderSession = useCallback((sessionId: string) => {
  blobUrlCache.revokeForSession(sessionId)
  setDocuments(current => {
    next = closeDocumentSession(current, sessionId)
    if (next.activeSessionId !== current.activeSessionId) {
      syncViewerSource(next.activeSessionId)
    }
    return next
  })
}, [blobUrlCache, setDocuments, syncViewerSource])

const closeActiveTab = useCallback(() => {
  if (activeSession == null) return
  closeReaderSession(activeSession.id)
}, [activeSession, closeReaderSession])

return existingActions plus closeReaderSession and closeActiveTab
```

- After this file: focused hook suite GREEN；后台 close 不触发 `setViewerSource`，active/final close 使用现有 store fallback，command-facing wrapper 不变。

- Verification command: `bun run test src/documents/documentSessionStore.test.ts src/reader/hooks/useReaderNavigation.test.tsx && bun run typecheck && git diff --check`
- Expected result: 两个 focused suites 全部通过；TypeScript 无错误；没有 production path 超出 `useReaderNavigation.ts`；静态 diff 无 whitespace error。
- Completion criteria: `closeReaderSession` 的 active/background/missing cases 有自动证据，`closeActiveTab` 委托同一实现，`REQ-004/005/010` 的生命周期基础完成。
- Rollback: 仅回退本 Step 三个文件；store production 没有变化，回退不会影响数据或 schema。
- Commit: `feat(reader): support closing any document session`

### Step 2 — 接入 home/reader 共享文档导航栏与完整打开往返

- Requirements: `REQ-001`, `REQ-002`, `REQ-003`, `REQ-004`, `REQ-005`, `REQ-006`, `REQ-008`, `REQ-009`, `REQ-011`
- Dependencies: `Step 1`
- Observable outcome: home 与 reader 共享“首页 + 中间标签 + 打开新文件”栏；任意标签 close、home round-trip、native/browser fallback、duplicate focus、成功打开进入 reader、两端固定/中部滚动和关闭后焦点均接通；工具工作区暂不显示共享栏。
- Ordered files:

#### File 1 — `CREATE src/reader/ReaderTabs.test.tsx`

- Purpose: 用组件级 RED tests 定义新 `ReaderTabsProps`、DOM、事件、fallback、focus 和 scroll 契约。
- Symbols: `createSession` fixture；`renderTabs` helper；对应 `TEST-001` 至 `TEST-004`、`TEST-015` cases。
- Why now: 共享栏是所有 app wiring 的展示契约，必须先固定 sibling buttons 和 accessible names。
- Contract/signature changes: 期望 props 包含 `homeActive`、`canOpenNativePdf`、`onOpenHome`、`onOpenPdf`、`onBrowserFileChange`、`onCloseSession`，并保留 sessions/active/select。
- Implementation pseudocode:

```tsx
render homeActive=true with sessions A/B
assert header '文档导航栏'
assert button '首页' has aria-current='page'
assert tablist '已打开文档' contains two role=tab buttons
assert buttons '关闭文档 A.pdf' and '关闭文档 B.pdf'
assert button '打开新文件'
assert no button contains another button

click 首页 -> onOpenHome once
click tab B -> onSelectSession(B.id)
click close A -> onCloseSession(A.id) and onSelectSession(A.id) not called

native supported + resolved true -> onOpenPdf once, hidden input not clicked
native supported + resolved false -> no browser fallback
native supported + rejected -> hidden input click
native unsupported -> hidden input click and onOpenPdf not called

click active B close; rerender sessions=[A], active=A; expect A tab focused
click final A close; rerender sessions=[]; expect 首页 focused
rerender with active B; expect scrollIntoView nearest on B when API is available
```

- After this file: suite fails because current `ReaderTabs` only提供 selection tabs；failure is missing props/roles/buttons rather than fixture setup。

#### File 2 — `MODIFY src/app/ReaderWorkspaceView.test.tsx`

- Purpose: 先定义 tabs 不再由 reader view 渲染，同时保留 viewer 和 reader toolbar。
- Symbols: `renders the active reader workspace shell` fixture/assertions。
- Why now: 共享栏必须上移，不能留下 reader 内第二个 tab strip。
- Contract/signature changes: test fixture 移除 `documents`、`selectReaderSession`；本 Step 暂保留 toolbar 所需的 open/close/file props，Step 4 再删除。
- Implementation pseudocode:

```tsx
render ReaderWorkspaceView with activeSession and existing reader action callbacks
assert 'Viewer content' visible
assert region '阅读工具栏' visible
assert query tablist '已打开文档' is absent
```

- After this file: 当前 production props/DOM 使 test typecheck 或“tablist absent”断言 RED，准确暴露 tabs ownership 尚未上移。

#### File 3 — `MODIFY src/app/ReaderWorkspaceSwitch.test.tsx`

- Purpose: 先同步共享栏上移后的 switch contract fixture，避免测试继续假设 reader branch 拥有 tab selection。
- Symbols: `renderSwitch` props；reader branch test fixture（若已有则复用）；移除 `selectReaderSession` fixture entry。
- Why now: `ReaderWorkspaceSwitch` 是 `ReaderApp` 与 `ReaderWorkspaceView` 的唯一中间 consumer。
- Contract/signature changes: 期望 `ReaderWorkspaceSwitchProps` 不再有只供 reader tabs 的 `selectReaderSession`；`documents` 仍用于 settings count/home data。
- Implementation pseudocode:

```tsx
build renderSwitch props without selectReaderSession
render reader branch with activeSession/documents
assert Viewer content and 阅读工作区 render
assert shared 文档导航栏 is not owned by the switch fixture
```

- After this file: TypeScript contract RED until switch 删除旧 tab-select prop；home/tool fixtures仍保持原行为。

#### File 4 — `MODIFY src/app/App.test.tsx`

- Purpose: 在 production wiring 前定义共享导航完整用户流，并复用 fake bridge/persistence/URL spies。
- Symbols: 新增 `home round-trip preserves sessions and URL`、`closes background and final tabs`、`opens from navigation and focuses duplicate`、`opens browser PDF from navigation` cases；保留/调整既有 open/session assertions。
- Why now: 组件 tests 不能证明 `workspaceOverride`、viewer source、persistence 和 duplicate call chain。
- Contract/signature changes: 新查询使用 `文档导航栏`、`首页`、`打开新文件`、`关闭文档 {title}`、`从文档导航栏选择 PDF 文件`。
- Implementation pseudocode:

```tsx
round trip:
  native open A; await reader + tab A
  click navigation 首页
  assert HomeDashboard present and tab A still present
  assert revokeObjectURL not called
  click the existing 首页 sidebar recent-files entry
  assert the recent-files home page remains visible while tab A is retained
  click tab A
  assert 阅读工作区 and PDF blob:a

arbitrary close:
  native responses open A then B with distinct blob URLs
  close A via '关闭文档 A.pdf'
  assert B remains active/viewer and only blob:a revoked
  close B
  assert home visible
  await saveReaderSession last call activeDocumentKey=null, tabs=[]

new and duplicate open:
  open A; click 打开新文件 to open B; assert A/B and B selected
  click 打开新文件 with same desktop path A
  assert tab count remains 2 and A selected

browser fallback from home:
  bridge canOpenNativePdf=false
  click 打开新文件 -> navigation hidden input click
  change unique navigation input with browser File
  assert reader + browser tab active
  assert persistence.saveDocument not called
```

- After this file: tests RED because shared bar/home action/close/input/activation callback do not exist；既有 fake-boundary tests remain intact。

#### File 5 — `MODIFY src/reader/ReaderTabs.tsx`

- Purpose: 实现纯展示层共享文档导航栏，不访问 store/cache/persistence/Tauri。
- Symbols: exported/internal `ReaderTabsProps`；`ReaderTabs`；`homeButtonRef`、`fileInputRef`、tab ref map、pending focus ref、open/focus effects。
- Why now: component RED contract 已固定，Step 1 已提供真实 close callback。
- Contract/signature changes: 使用主 Spec §9.1 的完整 required props signature；原 `onSelectSession` 保留。
- Implementation pseudocode:

```tsx
type ReaderTabsProps = {
  sessions: DocumentSession[]
  activeSessionId: string | null
  homeActive: boolean
  canOpenNativePdf(): boolean
  onOpenHome(): void
  onOpenPdf(): boolean | void | Promise<boolean | void>
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>
  onSelectSession(sessionId: string): void
  onCloseSession(sessionId: string): void
}

openBrowserPicker = () => fileInputRef.current?.click()
handleOpenPdf:
  if not canOpenNativePdf(): openBrowserPicker; return
  try Promise.resolve(onOpenPdf()).catch(openBrowserPicker)
  catch synchronous error -> openBrowserPicker
  resolved false means cancel and does not fallback

handleClose(sessionId):
  pendingFocusSessionIdRef = sessionId
  onCloseSession(sessionId)

layout/effect after sessions or activeSessionId change:
  activeTabRef?.scrollIntoView({ block:'nearest', inline:'nearest' }) when supported
  if a close is pending:
    if sessions empty -> focus homeButton
    else focus ref for activeSessionId, falling back to first available tab
    clear pending marker

render header aria-label='文档导航栏':
  fixed 首页 button with aria-current when homeActive
  div role=tablist aria-label='已打开文档'
    for each session render div.reader-tab-shell
      button role=tab aria-selected={!homeActive && active} title full name/page
      sibling button aria-label=`关闭文档 ${title}`
  fixed button aria-label='打开新文件'
  hidden input aria-label='从文档导航栏选择 PDF 文件'
    accept='application/pdf,.pdf', tabIndex=-1, onChange=onBrowserFileChange
```

- After this file: `ReaderTabs` focused tests GREEN；component API 明确但 app consumers 尚需在本 Step 后续文件同步。

#### File 6 — `MODIFY src/reader/hooks/useDocumentOpening.ts`

- Purpose: 让所有成功 create/focus session 的打开来源统一通知应用清除 home/tool override。
- Symbols: `UseDocumentOpeningInput.onDocumentSessionActivated`；`openBytes` callback/dependency list。
- Why now: 共享栏可以从 home 打开，不能依靠某个按钮单独清理 workspace state。
- Contract/signature changes: input 增加 `onDocumentSessionActivated(documentKey: string): void`；return methods 和 Tauri contracts 不变。
- Implementation pseudocode:

```ts
openBytes(source, bytes, metadata):
  existing desktop recent-document write remains
  setDocuments(current => {
    next = addDocumentSession(current, source)
    documentKey = getDocumentKey(source)
    session = next.sessions.find(by documentKey)
    if session exists:
      pdfByteCache.set(documentKey, bytes)
      url = blobUrlCache.createForSession(session.id, bytes)
      setViewerSource({ sessionId: session.id, url, restore: existing page/zoom })
      loadDocumentDecorations(documentKey)
      onDocumentSessionActivated(documentKey)
    return next
  })
include callback in openBytes dependency list
```

- After this file: native、browser、drop、Open With、recent/record paths 仍汇入同一 `openBytes`；新 session 和 duplicate focus 都发出同一激活通知。

#### File 7 — `MODIFY src/reader/ReaderWorkspace.tsx`

- Purpose: 从 reader grid 删除已上移的 tabs slot。
- Symbols: `ReaderWorkspaceProps`、`ReaderWorkspace` destructuring/render。
- Why now: app 将拥有共享栏，reader 内部保留 slot 会形成重复首行和错误高度。
- Contract/signature changes: 删除 `tabs: ReactNode`；保留 toolbar/left/viewer/right/status slots。
- Implementation pseudocode:

```tsx
type ReaderWorkspaceProps = {
  sidebarOpen: boolean
  toolbar: ReactNode
  leftPanel: ReactNode
  viewer: ReactNode
  rightPanel: ReactNode
  statusBar: ReactNode
}

render reader-workspace:
  toolbar
  reader-body(leftPanel, viewer, rightPanel)
  statusBar
```

- After this file: reader workspace DOM 不再预留/渲染 tabs；CSS 行数将在 File 11 同步。

#### File 8 — `MODIFY src/app/ReaderWorkspaceView.tsx`

- Purpose: 删除 reader view 对 `ReaderTabs` 的 import/props/JSX，保留 viewer 与旧 toolbar（待 Step 4 收敛）。
- Symbols: `ReaderWorkspaceViewProps`、`ReaderWorkspaceView`、`ReaderWorkspace` call。
- Why now: `ReaderWorkspace` contract 已移除 slot；上层 app 将直接拥有 `ReaderTabs`。
- Contract/signature changes: 删除 `documents`、`selectReaderSession`；删除 `ReaderTabs` import 和 `tabs={...}`；暂保留 `closeActiveTab`、open/file props 给旧 toolbar。
- Implementation pseudocode:

```tsx
remove DocumentState import and documents prop
remove selectReaderSession prop
remove ReaderTabs import
render ReaderWorkspace with toolbar, leftPanel, viewer, rightPanel, statusBar only
leave all reading actions and toolbar document controls unchanged until Step 4
```

- After this file: `ReaderWorkspaceView` focused test 对“无本地 tablist、viewer/toolbar 可用”GREEN；阅读功能无重排。

#### File 9 — `MODIFY src/app/ReaderWorkspaceSwitch.tsx`

- Purpose: 同步 reader view 上移后的内部 props，不改变 home/settings/tool 分支。
- Symbols: `ReaderWorkspaceSwitchProps`、function destructuring、reader branch `<ReaderWorkspaceView>`。
- Why now: 它是 `ReaderWorkspaceView` 的唯一 consumer，必须在 `ReaderApp` 接线前清理旧 selection prop。
- Contract/signature changes: 删除 `selectReaderSession` prop/destructuring/forwarding；`documents` 继续用于 settings count 和 home；toolbar 的 close/open props等 Step 4。
- Implementation pseudocode:

```tsx
remove selectReaderSession(sessionId) from props and destructuring
in reader branch:
  stop passing documents to ReaderWorkspaceView
  stop passing selectReaderSession
preserve documents.sessions.length for SettingsWorkspace
preserve all home/tool/open/browser callbacks
```

- After this file: Switch 和 View props 一致；home/tool branches 及相关 tests 不变。

#### File 10 — `MODIFY src/app/ReaderApp.tsx`

- Purpose: 在唯一 app/session/workspace owner 中组合共享栏并连接 home/select/close/open activation。
- Symbols: `ReaderApp` import/render；`closeReaderSession` destructuring；`handleDocumentSessionActivated`、`openHomeWorkspace`、`openReaderSession` callbacks。
- Why now: component、open hook、workspace contracts 均已准备好，app 可以完成端到端接线。
- Contract/signature changes: `useDocumentOpening` input 提供 activation callback；`useReaderNavigation` return 消费 `closeReaderSession`；不改变 `ReaderAppProps`。
- Implementation pseudocode:

```tsx
import ReaderTabs

handleDocumentSessionActivated = useCallback((_documentKey: string) => {
  setWorkspaceOverride(null)
}, [])
pass it to useDocumentOpening

destructure closeReaderSession from useReaderNavigation

openHomeWorkspace = useCallback(() => setWorkspaceOverride('home'), [])

openHomeSidebarPage(page):
  setWorkspaceOverride('home')
  setHomeSidebarPage(page)

openReaderSession = useCallback((sessionId) => {
  if no documents.sessions contains sessionId: return
  selectReaderSession(sessionId)
  setWorkspaceOverride(null)
}, [documents.sessions, selectReaderSession])

inside main before ReaderWorkspaceSwitch:
  if activeWorkspace is home or reader:
    render ReaderTabs(
      sessions=documents.sessions,
      activeSessionId=documents.activeSessionId,
      homeActive=(activeWorkspace==='home'),
      canOpenNativePdf=bridge capability default true,
      onOpenHome=openHomeWorkspace,
      onOpenPdf=openPdf,
      onBrowserFileChange=handleBrowserFileChange,
      onSelectSession=openReaderSession,
      onCloseSession=closeReaderSession
    )

stop passing selectReaderSession into ReaderWorkspaceSwitch
keep closeActiveTab for useReaderCommands and temporary toolbar until Step 4
```

- After this file: home/reader 共享栏、非破坏首页切换、标签选择、任意 close、打开激活和 duplicate focus call chain 完整；settings/tool 分支不渲染该栏。

#### File 11 — `MODIFY src/app/styles.css`

- Purpose: 让 app shell 承担共享 38px 行，并实现固定两端/中间滚动、tab close visibility、focus 和窄窗口规则。
- Symbols: `.home-mode`、`.reader-mode`、`.reader-workspace`、`.reader-tabs`、`.reader-tab-list`、`.reader-tab-shell`、`.reader-home-button`、`.reader-new-file-button`、`.reader-tab-close`、`.tab`、`@media (max-width: 720px)`。
- Why now: DOM 和所有权已经稳定；按最终结构改 grid，不为临时 DOM 写样式。
- Contract/signature changes: 无 TypeScript；CSS class names 与 File 5 component tests/DOM 一致。
- Implementation pseudocode:

```css
.home-mode, .reader-mode:
  display grid
  rows 38px minmax(0, 1fr)
  min-width/min-height 0

.reader-workspace:
  rows 44px minmax(0, 1fr) 30px

.reader-tabs:
  display grid
  columns auto minmax(0, 1fr) auto
  height 38px
  overflow hidden

.reader-tab-list:
  display flex
  min-width 0
  overflow-x auto

.reader-tab-shell:
  position relative or inline-flex
  selection tab and close are siblings

.reader-tab-close:
  visually available for active, hover, focus-within
  retain focus-visible even when otherwise low opacity

.tab-title:
  min-width 0; overflow hidden; text-overflow ellipsis

at max-width 720px:
  hide only visible text/page hints as specified
  keep fixed action buttons and accessible names
  reader-workspace rows 80px minmax(0,1fr) 30px

ensure prefers-reduced-motion gets no new animation
```

- After this file: app/reader vertical rows match Spec；only tab list scrolls horizontally；home/open actions remain fixed；long title and focus selectors are statically reviewable。

- Verification command: `bun run test src/reader/ReaderTabs.test.tsx src/app/ReaderWorkspaceView.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx src/reader/hooks/useReaderNavigation.test.tsx src/documents/documentSessionStore.test.ts && bun run typecheck && git diff --check`
- Expected result: 新组件和应用流 tests GREEN；所有 props consumers typecheck；home/reader 只有一个共享导航栏；没有 `src-tauri`/manifest/migration diff。
- Completion criteria: `TEST-001` 至 `TEST-011`、`TEST-015` 的自动化部分具备证据；`REQ-001` 至 `REQ-006`、`REQ-008/009/011` 在代码路径和 tests 中完成；视觉尺寸留给最终手工 gate。
- Rollback: 整体回退本 Step 11 个文件，恢复 reader 内 tabs；不要只回退 CSS 或 `ReaderApp` 之一，否则 app grid 与 DOM 所有权会不一致。
- Commit: `feat(reader): add shared document navigation bar`

### Step 3 — 保留工具工作区的 home/reader 返回来源

- Requirements: `REQ-003`, `REQ-006`, `REQ-011`, `REQ-012`
- Dependencies: `Step 2`
- Observable outcome: 有活动文档时，从 home 打开 settings/tool 后关闭仍回 home；从 reader 打开后关闭回 reader；打开/选择文档成功清除旧返回目标；reader 来源失效时安全回 home。
- Ordered files:

#### File 1 — `MODIFY src/app/App.test.tsx`

- Purpose: 先用真实 app workspace state 定义两个来源返回 RED cases 和 reader-missing fallback。
- Symbols: 新增 `returns from settings to home when opened from home with sessions`、`returns from settings to reader when opened from reader` cases；扩展成功打开清除 tool state assertion。
- Why now: current `setWorkspaceOverride(null)` 在存在 active session 时总推导 reader，正是共享 home bar 暴露的缺口。
- Contract/signature changes: 用户可观察行为，不新增 public prop；使用现有 `关闭设置` button。
- Implementation pseudocode:

```tsx
home-origin:
  open PDF A -> reader
  click shared 首页 -> home while A tab remains
  click HomeTopBar 设置 -> settings
  assert shared 文档导航栏 absent in tool
  click 关闭设置
  assert HomeDashboard present, 首页 current, A tab retained

reader-origin:
  open PDF A -> reader
  click ReaderToolbar settings action
  click 关闭设置
  assert 阅读工作区 and A selected

reader source unavailable:
  enter settings from reader with only A active
  press Meta+W while settings is visible so existing tab.close closes A
  close tool
  assert home, never empty reader
```

- After this file: home-origin case RED because current close resolves to reader；reader case characterizes existing fallback；tests do not require URL/router。

#### File 2 — `MODIFY src/app/ReaderWorkspaceSwitch.test.tsx`

- Purpose: 固定 settings 与其他 tools 使用同一个 `closeToolWorkspace` callback，而不是直接写 override。
- Symbols: `renderSwitch` fixture；new `routes settings close through closeToolWorkspace` case。
- Why now: app-level return state只有在所有 tool close entries走统一 callback 时可靠。
- Contract/signature changes: 期望删除 `setWorkspaceOverride` prop；`closeToolWorkspace` 成为 SettingsWorkspace `onClose`。
- Implementation pseudocode:

```tsx
closeToolWorkspace = vi.fn()
renderSwitch(activeWorkspace='settings', closeToolWorkspace)
click button '关闭设置'
assert closeToolWorkspace called once

build fixture without setWorkspaceOverride
preserve import/compare/annotations/bookmarks existing close callback assertions
```

- After this file: 当前 settings inline callback 导致 RED；其他 workspace tests 不变。

#### File 3 — `MODIFY src/app/ReaderApp.tsx`

- Purpose: 在 app owner 中记录 tool 打开前的主工作区，并在 close/文档激活后消费清理。
- Symbols: `workspaceReturnTarget` state；提前的 `activeWorkspace` derivation；`recordToolReturnTarget`；`openSettingsWorkspace`、`openShortcutWorkspace`、`closeToolWorkspace`、`openHomeWorkspace`、`openReaderSession`、`handleDocumentSessionActivated`。
- Why now: RED tests 已证明来源问题，且 Step 2 已建立可显式停留的 home override。
- Contract/signature changes: 新增 UI-local `useState<'home' | 'reader' | null>`；无持久化/public type变化。
- Implementation pseudocode:

```ts
after activeSession derive:
  activeWorkspace = workspaceOverride ?? (activeSession ? 'reader' : 'home')
  state workspaceReturnTarget = null

recordToolReturnTarget():
  if activeWorkspace is 'home' or 'reader':
    setWorkspaceReturnTarget(activeWorkspace)

openSettingsWorkspace(section):
  recordToolReturnTarget()
  setSettingsInitialSection(section)
  setWorkspaceOverride('settings')

openShortcutWorkspace(tool):
  run existing annotations/bookmarks refresh
  recordToolReturnTarget()
  setWorkspaceOverride(tool)

closeToolWorkspace():
  if workspaceReturnTarget == 'home': setWorkspaceOverride('home')
  else setWorkspaceOverride(null)   // reader when active, home when missing
  setWorkspaceReturnTarget(null)

on openHomeWorkspace/openReaderSession/onDocumentSessionActivated success:
  set the Spec-defined override
  clear workspaceReturnTarget

useReaderCommands setPreferencesOpen(false):
  delegate closeToolWorkspace rather than raw setWorkspaceOverride(null)
```

- After this file: tool origin成为显式 UI-local state；home/reader 关闭语义稳定；成功文档激活不被陈旧 return target 覆盖。

#### File 4 — `MODIFY src/app/ReaderWorkspaceSwitch.tsx`

- Purpose: 将 settings close 接入统一 callback，并删除不再需要的 raw override prop。
- Symbols: `ReaderWorkspaceSwitchProps`、function destructuring、`SettingsWorkspace.onClose`。
- Why now: app callback 已能解析来源，switch 只应委托，不应知道返回规则。
- Contract/signature changes: 删除 `setWorkspaceOverride(workspace)` prop；`SettingsWorkspace` 使用 `onClose={closeToolWorkspace}`。
- Implementation pseudocode:

```tsx
remove setWorkspaceOverride from props and destructuring
render SettingsWorkspace:
  onClose = closeToolWorkspace
keep Import/Compare/Annotations/Bookmarks onClose = closeToolWorkspace
keep TagManager existing home-sidebar ownership unchanged
```

- After this file: 所有独立 tool workspace close 路径由 `ReaderApp` 单点决定；Switch 不直接改变 workspace state。

- Verification command: `bun run test src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx && bun run typecheck && git diff --check`
- Expected result: home-origin/reader-origin/settings callback tests GREEN；现有 tool/global-search tests 继续通过；TypeScript 无 obsolete prop。
- Completion criteria: `TEST-014` 完成，`REQ-012` 所有 acceptance paths有自动证据；shared bar仍只在 home/reader。
- Rollback: 同时回退本 Step 四个文件；仅回退 Switch 会破坏 props，单独回退 state 会恢复 home+A 错返 reader。
- Commit: `fix(app): preserve tool workspace return target`

### Step 4 — 移除工具栏重复文档入口并完成兼容回归

- Requirements: `REQ-001`, `REQ-005`, `REQ-006`, `REQ-007`, `REQ-009`, `REQ-010`, `REQ-011`
- Dependencies: `Steps 2–3`
- Observable outcome: `ReaderToolbar` 只保留阅读动作；旧 open/browser/close props 从 View/Switch 消失；应用测试只通过共享栏操作文档生命周期；`Meta+O`、`Meta+W`、next/previous tabs继续工作。
- Ordered files:

#### File 1 — `MODIFY src/reader/ReaderToolbar.test.tsx`

- Purpose: 先定义重复入口消失且核心阅读控制不丢失的 RED contract。
- Symbols: `renderToolbar` fixture；existing search tests；new `keeps reader actions without document lifecycle controls` case。
- Why now: 共享栏已能完全替代这些动作，才能安全要求 toolbar 不再渲染它们。
- Contract/signature changes: fixture 移除 `onOpenPdf`、`onBrowserFileChange`、`onCloseActiveTab`；断言相关按钮/input不存在。
- Implementation pseudocode:

```tsx
render ReaderToolbar with active session and reading callbacks only
assert query button text '打开' is absent
assert query input label '选择 PDF 文件' is absent
assert query button label 'Close active tab' is absent
assert Search text, Previous page, Next page, Zoom in/out,
       Add bookmark, 新建批注, 收藏当前文档, More options are present
retain all existing match count/no-match tests
```

- After this file: absence assertions RED against current toolbar；search tests继续说明非目标行为不变。

#### File 2 — `MODIFY src/app/ReaderWorkspaceView.test.tsx`

- Purpose: 同步 toolbar 收敛后的 reader view fixture，并证明 viewer/阅读工具仍存在。
- Symbols: `renders the active reader workspace shell` fixture/assertions。
- Why now: toolbar props contract先由 File 1 定义，View consumer随后必须停止转发文档生命周期动作。
- Contract/signature changes: fixture 移除 `closeActiveTab`、`handleBrowserFileChange`、`openPdfAndIgnoreResult`；保留 settings/reader actions。
- Implementation pseudocode:

```tsx
render ReaderWorkspaceView without document open/close/file callbacks
assert Viewer content
assert 阅读工具栏
assert Search text and More options
assert no local tablist and no toolbar document lifecycle controls
```

- After this file: current required props/DOM 使 contract RED，等待 production cleanup。

#### File 3 — `MODIFY src/app/ReaderWorkspaceSwitch.test.tsx`

- Purpose: 删除只为旧 reader toolbar 透传的 fixture callbacks，并保持所有 workspace branches 编译。
- Symbols: `renderSwitch` props；reader/settings/home tests。
- Why now: View contract 已收敛，Switch 不再需要这三项 reader-only props。
- Contract/signature changes: 删除 `closeActiveTab`、`openPdfAndIgnoreResult`；`handleBrowserFileChange` 仍保留，因为 HomeDashboard 使用它。
- Implementation pseudocode:

```tsx
remove closeActiveTab and openPdfAndIgnoreResult from fixture
retain openPdf for HomeDashboard and BookmarkManager
retain handleBrowserFileChange for HomeDashboard
render reader branch and assert viewer/toolbar
render home branch and assert existing 打开文件 still works
```

- After this file: fixture type RED until Switch props/forwarding删除；home open contract不会误删。

#### File 4 — `MODIFY src/app/App.test.tsx`

- Purpose: 把旧 toolbar 选择器迁移到共享栏，并补齐 shortcut compatibility acceptance。
- Symbols: 所有 `Close active tab` usages；reader-context `选择 PDF 文件` usages；new `keeps file and tab shortcuts on shared navigation` case。
- Why now: Step 2 保留旧 toolbar 仅用于平滑过渡；现在 tests必须不再依赖即将删除的 UI。
- Contract/signature changes: 使用 `关闭文档 {title}` 和 `从文档导航栏选择 PDF 文件`；首页 `选择 PDF 文件` label保持不变。
- Implementation pseudocode:

```tsx
for each existing close-flow test:
  replace toolbar 'Close active tab' query with close button for exact active title

for each browser file test:
  if home branch -> keep HomeDashboard label '选择 PDF 文件'
  if reader/shared navigation branch -> use '从文档导航栏选择 PDF 文件'

shortcut regression:
  open A
  press Meta+O -> assert openNativePdf called via same openPdf chain
  press Control+Tab / Shift+Control+Tab with A/B -> assert selected tab changes
  press Meta+W -> assert active document close button-equivalent result and URL revoke
  on home/no active press Meta+W -> assert no error/state change
```

- After this file: tests不再需要 toolbar open/X；在 production 删除前 main RED 由 toolbar absence contract 提供，command assertions应 characterization GREEN。

#### File 5 — `MODIFY src/reader/ReaderToolbar.tsx`

- Purpose: 删除文档生命周期 UI 和对应 props/imports，保留所有阅读动作布局。
- Symbols: `ReaderToolbarProps`、`ReaderToolbar` params、first toolbar group、push group、lucide/react imports。
- Why now: 新共享栏和测试已经覆盖所有替代入口及快捷键。
- Contract/signature changes: 删除 `onOpenPdf`、`onBrowserFileChange`、`onCloseActiveTab`；删除 `FolderOpen`、`FileDown`、`X` 和 `ChangeEventHandler` imports。
- Implementation pseudocode:

```tsx
remove props onOpenPdf, onBrowserFileChange, onCloseActiveTab
remove their destructuring
in first toolbar group keep only sidebar toggle
remove browser file label/input
in push group keep bookmark, note, favorite, settings
remove danger close button
leave search/page/history/zoom/fit callbacks and disabled rules unchanged
```

- After this file: `ReaderToolbar.test.tsx` GREEN；toolbar职责收敛且没有未使用 imports。

#### File 6 — `MODIFY src/app/ReaderWorkspaceView.tsx`

- Purpose: 清理已从 toolbar 删除的 props 与 forwarding，不触碰 viewer/sidebar business logic。
- Symbols: `ReaderWorkspaceViewProps`、destructuring、`<ReaderToolbar>` props。
- Why now: toolbar production contract已收敛，直接 consumer必须同步。
- Contract/signature changes: 删除 `closeActiveTab`、`handleBrowserFileChange`、`openPdfAndIgnoreResult`。
- Implementation pseudocode:

```tsx
remove three props from type and destructuring
stop passing onOpenPdf/onBrowserFileChange/onCloseActiveTab to ReaderToolbar
preserve openSettingsWorkspace and every reading callback
```

- After this file: View 与 Toolbar 编译一致；`ReaderWorkspaceView.test.tsx` GREEN。

#### File 7 — `MODIFY src/app/ReaderWorkspaceSwitch.tsx`

- Purpose: 删除只为旧 reader toolbar 透传的 props，同时保留 home 的 open/file handlers。
- Symbols: `ReaderWorkspaceSwitchProps`、destructuring、reader branch forwarding。
- Why now: View 不再消费这些 props；home/tool consumers仍需被逐项区分。
- Contract/signature changes: 删除 `closeActiveTab`、`openPdfAndIgnoreResult`；保留 `openPdf` 和 `handleBrowserFileChange`。
- Implementation pseudocode:

```tsx
remove closeActiveTab and openPdfAndIgnoreResult from props/destructuring
stop passing them to ReaderWorkspaceView
keep HomeDashboard onOpenPdf=openPdf
keep HomeDashboard onBrowserFileChange=handleBrowserFileChange
keep BookmarkManager onOpenPdf=openPdf
```

- After this file: Switch tests GREEN；不会误删首页或书签管理打开能力。

#### File 8 — `MODIFY src/app/ReaderApp.tsx`

- Purpose: 停止向 Switch 传递已删除的 props；保留 command/viewer 内部动作。
- Symbols: `<ReaderWorkspaceSwitch>` prop list；`closeActiveTab` 和 `openPdfAndIgnoreResult` 的剩余 consumers。
- Why now: Switch contract 已清理；app 仍必须保留这两个 callbacks 给 `useReaderCommands` 和 `ReaderViewerContent`。
- Contract/signature changes: 只删除 Switch props，不删除内部 callbacks 或 command IDs。
- Implementation pseudocode:

```tsx
remove closeActiveTab prop from ReaderWorkspaceSwitch call
remove openPdfAndIgnoreResult prop from ReaderWorkspaceSwitch call
retain closeActiveTab in useReaderCommands input for tab.close
retain openPdfAndIgnoreResult in useReaderCommands and ReaderViewerContent
retain closeReaderSession in shared ReaderTabs
```

- After this file: 全部内部 props consumers 编译一致；文档生命周期只有共享栏和命令入口，viewer empty/error open仍复用现有 callback。

- Verification command: `bun run test src/reader/ReaderToolbar.test.tsx src/reader/ReaderTabs.test.tsx src/app/ReaderWorkspaceView.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx src/reader/hooks/useReaderNavigation.test.tsx src/documents/documentSessionStore.test.ts && bun run typecheck && bun run build && git diff --check`
- Expected result: focused suites、typecheck、Vite production build 全部通过；toolbar无重复入口；快捷键/共享栏/持久化 tests GREEN；diff不含 manifest、`src-tauri` 或 migration。
- Completion criteria: `TEST-012/013` 和所有前置 tests 通过；`REQ-007/010` 完成且 `REQ-001–012` 没有因 props cleanup 回归。
- Rollback: 回退本 Step 八个文件可恢复旧 toolbar入口，但共享栏仍存在重复动作；如果需要完整产品 rollback，应按 Step 4→3→2→1 逆序回退四个语义提交。
- Commit: `refactor(reader): remove duplicate document controls`

## 8. Test, Validation, and Quality Gates

| Gate/order | Command or method | Scope | Expected result | Failure returns to | Requirements |
| --- | --- | --- | --- | --- | --- |
| Step 1 characterization | `bun run test src/documents/documentSessionStore.test.ts` | pure session store | 新后台/最后/非法 ID cases在生产变更前即通过 | Spec/baseline review；不得改 store 迁就测试 | `REQ-005` |
| RED Step 1 | `bun run test src/reader/hooks/useReaderNavigation.test.tsx` | hook contract | 因 `closeReaderSession` 缺失或 conditional sync不符合而失败 | Step 1 File 2 | `REQ-004/005/010` |
| GREEN Step 1 | `bun run test src/documents/documentSessionStore.test.ts src/reader/hooks/useReaderNavigation.test.tsx && bun run typecheck` | store/hook/type | focused suites 与 typecheck 通过 | Step 1 File 3 | `REQ-004/005/010` |
| RED Step 2 component | `bun run test src/reader/ReaderTabs.test.tsx` | shared bar component | 因 home/close/open/focus contract缺失而失败 | Step 2 Files 1/5 | `REQ-001–006/008/009` |
| RED Step 2 app | `bun run test src/app/ReaderWorkspaceView.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx` | ownership + app flows | 因 tabs仍在 reader、无 home/任意 close/activation而失败 | Step 2 Files 2–4 | `REQ-001–006/008/009` |
| GREEN Step 2 | Step 2 verification command | shared bar完整前端路径 | focused suites/typecheck/diff check通过 | Step 2 Files 5–11 | `REQ-001–006/008/009/011` |
| RED Step 3 | `bun run test src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx` | tool return | home+A关闭 settings错误返回 reader，settings未委托 callback | Step 3 Files 1–2 | `REQ-012` |
| GREEN Step 3 | Step 3 verification command | app workspace state | home/reader来源与 settings callback tests通过 | Step 3 Files 3–4 | `REQ-003/006/011/012` |
| RED Step 4 | `bun run test src/reader/ReaderToolbar.test.tsx` | toolbar component | 因旧 open/input/close仍存在而失败 | Step 4 File 1 | `REQ-007` |
| GREEN Step 4 | Step 4 verification command | toolbar + app + build | focused suites/typecheck/build/diff check通过 | Step 4 Files 5–8 | `REQ-001/005–007/009–011` |
| Full frontend regression | `bun run test` | 全部 Vitest suites | 零失败；既有 home/search/bookmark/annotation/settings/viewer fake-boundary flows不回归 | 对应 owning Step | All |
| Final static/type/build | `bun run typecheck && bun run build && git diff --check` | 全前端和 diff | exit code 0；无 TS/build/whitespace error | 对应 owning Step | All |
| Scope audit | `git status --short` 与 `git diff --name-only` | worktree | 仅 §5 清单、Spec/Plan文档及明确保留的用户文件；无 `src-tauri`/manifest/migration | 停止并审查越界文件 | `REQ-011` |
| Manual desktop | 用户启动 Tauri 后执行主 Spec §14.5 七项清单 | native dialog、真实 PDF、1180×780/860×560/更窄窗口、键盘焦点 | 首页/标签/X/+位置正确；3 tabs滚动；close fallback；native/browser/shortcuts可用 | Step 2 visual或Step 4 integration | `REQ-001–010/012` |

失败返回规则：

- Characterization failure 表示 repository drift，不允许通过重写已有 store语义绕过；先回主 Spec。
- Focused RED若因 fixture/env错误而非缺失行为失败，先修测试夹具，不进入生产修改。
- Typecheck failure必须在当前 Step 内清理所有 props consumers，不跨提交遗留。
- Full regression failure按首次引入该路径的 owning Step修复；不得删除无关 tests。
- Build通过不代表真实 Tauri dialog、PDF rendering或视觉布局已验证；这些只由用户手工 gate确认。

## 9. Migration, Compatibility, Rollout, and Rollback

### 9.1 Migration

N/A。主 Spec §11/§16 明确没有 table、column、index、query、transaction 或 migration变更；当前 migrations 001–006 保持不可变，不创建新版本。`DocumentSession`、`PersistedReaderSession` 和 SQLite session snapshot格式不变，因此没有 backfill、dual-read/write 或数据修复。

### 9.2 Compatibility

- Internal source: `ReaderTabsProps`、`ReaderWorkspaceProps`、`ReaderWorkspaceViewProps`、`ReaderWorkspaceSwitchProps` 在各自 Step 内同步唯一 consumers/tests，最终 typecheck证明一致。
- Commands: `file.open`、`tab.close`、`tab.next`、`tab.previous` IDs/default shortcuts不变；UI移位不修改 `CommandRegistry` 或 preferences schema。
- Runtime sources: native、browser、drop、Open With、recent、favorite、bookmark/global-search reopen继续汇入 existing open pipeline；activation callback只负责 workspace切换。
- Data: duplicate desktop path仍按 `documentKey`聚焦；browser File仍 runtime-only；recent/session persistence semantics不变。
- Viewer/cache: shared navigation不导入 viewer；首页切换不 revoke；指定 close只 revoke目标；app unmount clear不变。
- Home: `HomeTopBar`、QuickStart和已有首页 input保留；导航 input使用不同 accessible name避免歧义。
- Tool workspaces: visual shell不增加共享栏；只规范 close return target。

### 9.3 Rollout

单一桌面前端功能，不需要 feature flag、remote deploy或配置窗口。交付顺序固定为四个语义提交，随后执行 full frontend regression/static/build；用户再启动 Tauri做手工验证。Plan执行者不得自动启动项目。

### 9.4 Rollback

- 自动 gate失败且无法在当前 Step局部修复：只回退该 Step path-limited commit，前一 Step保持可验证。
- 完整功能回滚：按 Step 4→3→2→1逆序回退，确保 props、DOM、CSS和生命周期成套恢复。
- 视觉问题可在 Step 2 commit内修正 CSS，但不能只回退 app grid而保留共享 DOM。
- 生命周期问题必须同时检查 `ReaderTabs` callback、`useReaderNavigation`和`ReaderApp` wiring，禁止只恢复 toolbar X 作为掩盖。
- 没有 schema/data rollback；没有 migration checksum或forward-fix限制。

## 10. Requirement-to-Step Traceability Matrix

| Requirement | Effective Spec section | Steps | Files | Tests/gates | Completion evidence |
| --- | --- | --- | --- | --- | --- |
| `REQ-001` | 主 Spec §4、§7、§12 | Steps 2, 4 | `ReaderTabs*`、`ReaderApp`、Workspace/View/Switch、CSS | `TEST-001/007/012/015`；Step 2/4 + manual | home/reader单一共享栏，tool无栏 |
| `REQ-002` | 主 Spec §4、§7.3 | Step 2 | `ReaderTabs`、`ReaderApp`、`App.test` | `TEST-002/007` | 首页往返 sessions/URL不变 |
| `REQ-003` | 主 Spec §4、§7.3、§9 | Steps 2–3 | `useDocumentOpening`、`ReaderApp`、`App.test` | `TEST-002/007/011/014` | 标签/打开成功进入正确 reader |
| `REQ-004` | 主 Spec §4、§7.3、§9 | Steps 1–2 | navigation hook/test、`ReaderTabs*`、`App.test` | `TEST-001/002/008` | 任意 session close且不误 select |
| `REQ-005` | 主 Spec §4、§7.3–§7.5 | Steps 1, 2, 4 | store test、hook/test、`ReaderTabs`、`ReaderApp`、App test | `TEST-005/006/008/013` | fallback、URL、viewer、empty snapshot正确 |
| `REQ-006` | 主 Spec §4、§7.3、§9.1 | Steps 2–4 | `ReaderTabs*`、open hook、`ReaderApp`、App test | `TEST-003/009/010/011/013` | native/fallback/cancel/duplicate/browser路径 |
| `REQ-007` | 主 Spec §4、§7.2、§12.2 | Steps 2, 4 | Workspace/View/Switch、Toolbar/test、App | `TEST-012`；Step 4 gate | toolbar无重复入口且阅读动作保留 |
| `REQ-008` | 主 Spec §4、§12.3–§12.5 | Step 2 | `ReaderTabs*`、`styles.css`、App test | `TEST-009/015` + manual 3/6 | 两端固定、中部滚动、active可见 |
| `REQ-009` | 主 Spec §4、§12.6 | Steps 2, 4 | `ReaderTabs*`、CSS、Toolbar/View tests | `TEST-001–004/015` + manual 7 | sibling buttons、names、focus正确 |
| `REQ-010` | 主 Spec §4、§9.4、§13.1 | Steps 1, 4 | navigation hook/test、`ReaderApp`、Toolbar/View/Switch、App test | `TEST-013` + existing command suites | Meta+O/W和tab切换契约不变 |
| `REQ-011` | 主 Spec §4、§6、§11、§16 | Steps 2–4 | 全部计划内前端文件；scope audit | typecheck/build/diff/status | 无 manifest/src-tauri/migration/dependency改动 |
| `REQ-012` | 主 Spec §4、§7.1/§7.5、§9 | Step 3 | `ReaderApp`、Switch/test、App test | `TEST-014` | tool close回到来源或安全home |

## 11. Risks, Blockers, and User Decisions

| ID | Risk or decision | Impacted Steps/files | Evidence | Owner | Status/action |
| --- | --- | --- | --- | --- | --- |
| `GATE-001` | 主 Spec和Plan尚未被用户接受，不能自动执行 | 全部 Steps | 两份文档状态均为 `Review`；本次请求只要求转 Plan | User | Review gate；显式批准后才可执行 |
| `RISK-001` | 后台 close若无条件 sync viewer会重载活动 PDF | Step 1 hook | 主 Spec `RISK-001`；当前 hook active close总 sync | Implementer | Closed by Step 1 conditional ID comparison/test |
| `RISK-002` | home override在打开/duplicate focus后残留 | Step 2 open hook/App | 所有来源汇入 `openBytes` | Implementer | Closed by activation callback和App tests |
| `RISK-003` | home+A关闭 settings误回 reader | Step 3 App/Switch | 当前 `closeToolWorkspace`只清 null | Implementer | Closed by return target和TEST-014 |
| `RISK-004` | selection button内嵌close button导致无效DOM/冒泡 | Step 2 ReaderTabs | 当前整个tab是button | Implementer | Closed by sibling DOM/component tests |
| `RISK-005` | 两个 hidden inputs同名造成测试/辅助技术歧义 | Steps 2/4 | Home input label已是`选择 PDF 文件` | Implementer | Closed by unique navigation input label和context query migration |
| `RISK-006` | CSS/jsdom不能证明真实窄窗口布局 | Step 2 CSS、最终 gate | Vitest环境是jsdom；用户负责runtime | User/Implementer | Mitigated by DOM/static/build gates；用户手工验证 |
| `RISK-007` | 新 focused hook test超出原目标树 | Step 1 test | 主 Spec §14.1显式允许复杂时增加 | Implementer | Closed by `PLAN-CLAR-001`；仅测试范围 |
| `RISK-008` | 未来存在未保存编辑内容时无确认close可能不安全 | 本功能外 | 主 Spec `ASM-003`/`RISK-008`；当前为PDF reader | Product owner | Deferred outside scope；未来dirty-state Spec处理 |

不存在有效 Spec冲突、repository major drift、schema/security/permission decision或阻塞本 Review Plan生成的未决项。

## 12. Review and Acceptance

### 12.1 Original requirement fidelity

- “关闭文件”落入 Steps 1–2：按任意标签ID关闭、后台/活动/最后fallback、URL revoke和empty session save均有测试。
- “新打开一个文件，到这里”落入 Step 2：共享栏固定入口复用native/browser/openBytes，成功或duplicate均激活标签并进入reader。
- “回到首页”落入 Steps 2–3：首页非破坏、标签可回reader，tool关闭保留home/reader来源。
- Step 4只删除被共享栏替代的toolbar重复入口，不删除首页既有open或任何阅读动作。
- 未扩展到router、drag reorder、pin/group、recently closed、cloud/library/schema或新依赖。

### 12.2 Spec consistency

- 文件树与主 Spec §8一致；唯一新增 `useReaderNavigation.test.tsx`由主 Spec §14.1授权并记录为 `PLAN-CLAR-001`。
- `ReaderTabsProps`、`closeReaderSession`、activation callback和workspace return state完全按主 Spec §9。
- store/model/persistence/database/Rust/Tauri/commands均复用，不引入新层或公共contract。
- Strategy/Factory/Router/Event Bus/State classes未被引入；继续复用Command和facade-like hook边界。
- CSS、focus、fallback、failure semantics、compatibility和rollback与主 Spec §12、§15–§18一致。

### 12.3 Repository executability

- 16个文件路径、symbols和consumers已在`main@94de3a9`验证；两个CREATE test路径遵循现有Vitest/Testing Library布局。
- `package.json`确认`bun run test/typecheck/build`；README确认前端与文档验证边界。
- 文件顺序解决测试RED、internal props、唯一consumer、app composition和CSS依赖；每个Step结束typecheck，无长期broken commit。
- 所有Step顺序执行并采用路径受限stage/commit；当前仅有本轮docs变更，未来无关dirty worktree必须保留。
- 没有generated code、migration、configuration、permission、backend或cross-module publication遗漏。

### 12.4 Test and release completeness

- 每个缺失行为都有生产修改前的RED test；store已有行为用characterization明确区分。
- focused component/hook/app tests、全量Vitest、typecheck、build、diff/scope audit和用户desktop manual gate形成分层证据。
- 无数据库变更，所以migration/cargo gate有证据地N/A；如果实际实现越界则停止回Spec。
- 每个Step有完成标准、rollback和单一commit；完整rollback顺序明确。
- 本 Plan没有声称代码、browser、Tauri、SQLite或真实PDF运行已验证。

### 12.5 Final verdict

PASS — Ready for user review
