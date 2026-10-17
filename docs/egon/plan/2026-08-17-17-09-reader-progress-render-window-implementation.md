# SmartReader 阅读进度恢复与动态页面窗口实施 Plan

| Field | Value |
| --- | --- |
| Document | `2026-08-17-17-09-reader-progress-render-window-implementation.md` |
| Status | `Review` |
| Created | `2026-08-17 17:09 CST` |
| Updated | `2026-08-17 17:09 CST` |
| Owner | User |
| Repository | `SmartReader` |
| Scope | React Tab 会话激活位置恢复、Viewer 动态渲染范围及对应 hook/component/application tests |
| Source Requirement | 2026-08-17 用户要求 Tab 切回后继续上次阅读页，并将页面渲染窗口设为当前可见范围前后各 10 页、前进到第 8 页时继续向后覆盖；用户随后明确“确认”目标 Spec 并调用 `egon-coding-writing-plan` |
| Baseline Revision | `main` @ `84ac5c55e53124928332dddaf39f11e3ef6e26c0`；当前仅目标 Spec 为 untracked，生产/测试代码干净 |
| Implements Spec | [SmartReader Tab 阅读进度恢复与动态页面渲染窗口 Spec](../spec/2026-08-17-16-40-reader-progress-render-window.md) |
| Spec Status | `Review` |
| Spec Revision | `Updated 2026-08-17 16:40 CST`；baseline `84ac5c55e53124928332dddaf39f11e3ef6e26c0`；用户于 2026-08-17 本轮消息明确确认设计 |
| Effective Specs | [Primary Spec](../spec/2026-08-17-16-40-reader-progress-render-window.md)；[Reading Progress Refresh Design](../../superpowers/specs/2026-07-06-reading-progress-refresh-design.md)；[PDF Reader Design](../../superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md)；[Stabilization Design](../../superpowers/specs/2026-06-17-smartreader-stabilization-design.md) |
| Depends On Plans | `None` |
| Supersedes | `None` |
| Superseded By | `None` |
| Related Plans | [Reader Document Navigation Implementation](2026-08-16-15-14-reader-document-navigation-implementation.md) §Step 1、§Step 2、§Step 4（已实现的 Tab 选择/关闭/快捷键基础，不作为本 Plan 的执行前置） |

## 1. Summary

本 Plan 实施唯一目标 [SmartReader Tab 阅读进度恢复与动态页面渲染窗口 Spec](../spec/2026-08-17-16-40-reader-progress-render-window.md)，不重新设计需求。实现分为 2 个顺序 Step、2 个语义提交：

1. 以 focused hook RED tests 固定点击、快捷键和关闭回退的目标 `page/zoom`，再让 `useReaderNavigation` 从 next `DocumentState` 构造带 `restore` 的 `ViewerSource`，最后补应用级进度保持回归。
2. 先在纯函数和 bridge tests 中把默认动态窗口固定为 visible range 前后各 10 页，并证明第 8 页推进、多页 viewport 与文档边界，再只修改 `renderRange.ts` 的默认常量和说明。

完成证据是两个 Step 的 RED/GREEN 记录、focused Vitest、全量 `bun run test`、`bun run typecheck`、`bun run build` 和 `git diff --check`。不修改 `PdfViewerBridge` 生产接线、ViewerSource 类型、Rust、SQLite、migration、依赖或 UI；不启动项目，真实 Tauri/PDF 内存和视觉验证由用户执行。

## 2. Target Spec and Effective Design

### 2.1 Primary target

- Path: [`docs/egon/spec/2026-08-17-16-40-reader-progress-render-window.md`](../spec/2026-08-17-16-40-reader-progress-render-window.md)
- Status: 文件元数据为 `Review`；用户在 2026-08-17 本轮明确回复“确认”，构成本 Plan 的设计批准和编写授权。
- Revision: `Updated 2026-08-17 16:40 CST`；设计 baseline `main@84ac5c55e53124928332dddaf39f11e3ef6e26c0`。
- Approval evidence: 用户在收到 Spec 路径、核心设计与“第 8 页采用无状态滑动窗口”说明后，明确调用 `egon-coding-writing-plan` 并回复“确认”。
- Planning status rule: Plan 尚未经过用户评审，因此保持 `Review`，不标记 `Ready`。

### 2.2 Effective Spec set

| Role | Spec/link | Status/revision | Effective sections | Why included |
| --- | --- | --- | --- | --- |
| Primary | [Progress and render-window Spec](../spec/2026-08-17-16-40-reader-progress-render-window.md) | `Review`，2026-08-17 16:40 CST；本轮用户已确认 | 全文，重点 `§4`、`§7-9`、`§14-19` | 唯一实现目标和 `REQ-001..010` 来源 |
| Amended persistence baseline | [Reading Progress Refresh Design](../../superpowers/specs/2026-07-06-reading-progress-refresh-design.md) | 2026-07-06，legacy approved design | §Progress Rules、§Data Flow、§Error Handling、§Testing Plan；§Scope 中“不得改变页面渲染”仅按 Primary Spec 命名范围解除 | 保留内存即时更新、250ms 防抖和无 schema 变化 |
| Normative dependency | [PDF Reader Design](../../superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md) | 2026-06-15，§Approval State 明确已批准 | §Open File Flow、§Persistence Design、§Cache Design、§Navigation History、§Implementation Constraints | 固定 Viewer/应用边界、缓存层、页码历史和不启动规则 |
| Normative dependency | [Stabilization Design](../../superpowers/specs/2026-06-17-smartreader-stabilization-design.md) | 2026-06-17，当前架构已落地 | §Target Architecture / Viewer Boundary、§Data Flow / Switch Tab、§Session Restore、§Cache、§Testing Strategy | 固定 session/Blob URL 归属、bridge 隔离和验证责任 |

### 2.3 Superseded or excluded content

- [2026-08-16 文档导航栏 Spec](../spec/2026-08-16-14-21-reader-document-navigation-bar.md) 是 Primary Spec 的 amended predecessor。其 `§9.1`、`§9.2` 与 `§12` 中“选择目标 session 后只同步 URL”的局部激活语义，由 Primary Spec 完整替换为 `ViewerSource.restore(page, zoom)`；首页、关闭资源、焦点、快捷键等未命名行为保持当前实现，不形成新的本 Plan requirement namespace。
- Reading Progress Refresh Design §Scope 中“Changing how PDF pages are rendered or navigated”对本功能的 named render-window 范围不再适用；其进度计算、防抖、错误和无 migration 约束继续有效。
- Primary Spec 的 Related Specs 是非规范上下文，不扩大本 Plan 文件或行为范围。
- `PdfViewerBridge.tsx` 和 `viewerTypes.ts` 在 Primary Spec target tree 中标为“only if needed/comment only”；当前源码已完成 `restore -> initialPage/defaultScale` 和稳定 `setRenderRange` 接线，因此不纳入改动文件，详见 `PLAN-CLAR-002`。

## 3. Effective Requirements and Acceptance

| Requirement | Source Spec section | Effective statement | Observable acceptance | Implementation impact |
| --- | --- | --- | --- | --- |
| `REQ-001` | [Primary](../spec/2026-08-17-16-40-reader-progress-render-window.md) §4 | 选择已有 Tab 后按目标 `DocumentSession.page` 初始化 Viewer | A=42、B=7，从 B 选 A 得到 restore.page=42，bridge 转成 initialPage=41 | Step 1 hook source mapping/tests |
| `REQ-002` | Primary §4 | 激活同时恢复目标 session.zoom | A restore.zoom=1.5，不复用 B zoom | Step 1 fixture/source assertion |
| `REQ-003` | Primary §4 | 点击、next/previous、关闭回退使用同一位置同步规则 | 所有入口生成相同结构并保持最终/后台关闭语义 | Step 1 hook tests/implementation |
| `REQ-004` | Primary §4、§7.3 | 激活首个 load/progress 不得把有效页码重置为 1 | bridge 既有 restore test继续通过；App session snapshot 中 A.page 保持 4/42 | Step 1 focused + application regression |
| `REQ-005` | Primary §4、§9.2.3 | 默认渲染范围是 visible start-10 到 end+10 | input 20..20 输出 10..30 | Step 2 pure/bridge tests + constants |
| `REQ-006` | Primary §4、§5 ASM-001 | 从锚点前进 8 页时窗口已继续覆盖新位置后 10 页 | 20..20 → end30；28..28 → end38 | Step 2 sliding assertion |
| `REQ-007` | Primary §4、§9.2.3 | 首尾扩展安全，实际 item 由 Viewer clamp | helper 对 0/99 返回 -10..10/89..109；pinned Viewer clamp契约不变 | Step 2 boundary tests/bridge regression |
| `REQ-008` | Primary §4、§7.2 | 普通滚动和任意跳转都按最新 visible range 无状态重算 | 单页、多页和大跨度输入均只依赖本次 range | Step 2 pure function tests |
| `REQ-009` | Primary §4、§8、§16 | 不新增依赖、migration、Rust、页面缓存状态或无关重构 | 最终 diff 仅包含 6 个 TS/TSX 文件；manifests/`src-tauri` 不变 | 两 Step scope + final diff gate |
| `REQ-010` | Primary §4、§14 | 自动覆盖激活、±10、第8页、边界；真实视觉/内存手工验证 | focused/full/typecheck/build通过；Tauri manual 未被自动执行 | 两 Step + §8 gates |
| `SR-PROGRESS-007` | [Progress Design](../../superpowers/specs/2026-07-06-reading-progress-refresh-design.md) §Requirements Covered | 保持 session restore、reopen、favorites、bookmarks、annotations 和 Viewer 行为 | full App/Viewer tests无回归 | Step 1/2 regression + full gate |
| `SR-PROGRESS-008` | Progress Design §Requirements Covered | 遵循现有 style，不新增不必要架构 | 无新生产文件/class/state manager | 两 Step最小修改 |
| `PLAN-REQ-001` | [PDF Reader Design](../../superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md) §Implementation Constraints | 保持 `@react-pdf-viewer` 基础和小型 `PdfViewerBridge` 边界 | bridge 生产文件不改，只通过既有 callback 注入策略 | Step 2 |
| `PLAN-REQ-002` | PDF Reader Design §Cache Design、§Navigation History | byte cache、Blob URL cache、render window 和 progress/history 各自保持边界 | render range只改页面 virtual window；普通 progress不创建 hard history | Step 1/2 + full tests |
| `PLAN-REQ-003` | [Stabilization Design](../../superpowers/specs/2026-06-17-smartreader-stabilization-design.md) §Data Flow / Switch Tab | 激活 session 只能使用其自身 Blob URL，不能显示另一 Tab PDF | source 中 sessionId/url/page/zoom来自同一 target state；URL缺失为 null | Step 1 |

`PLAN-REQ-001..003` 只是 legacy dependency statements 的 trace aliases，不新增需求。

## 4. Implementation Strategy and Dependency Order

### 4.1 Ordered strategy

先修复会话激活，再扩大页面渲染窗口：

1. Step 1 不触及 Viewer 第三方逻辑，只使当前 navigation callbacks 把 next state 的 target session page/zoom 交给已存在的 restore contract。focused hook tests 能在真实缺口上 RED，生产修改后 GREEN；App regression再证明 shared navigation、Tab page hint 与 session persistence不被破坏。
2. Step 2 在完全独立的 viewer files 中先重写/增加纯函数与 bridge callback tests。两类测试都因当前默认 `pagesBehind=1/pagesAhead=2` RED，然后只把默认常量改成 10/10；`PdfViewerBridge.tsx` 已调用 `createRenderRange()`，无需接线改动。
3. 两个 Step 完成后按 focused → typecheck → full test → build → diff 的顺序收口。无 generated code、contract publication、数据库、backend/frontend兼容窗口或部署顺序。

### 4.2 Test-first strategy

| Behavior | RED test first | Expected RED reason | Minimum GREEN | Post-GREEN regression |
| --- | --- | --- | --- | --- |
| 点击已有 Tab 恢复 page/zoom | `useReaderNavigation.test.tsx` selected-session test | 当前 source 只有 `sessionId/url`，缺 `restore` | `syncViewerSource(nextState)` 查 target session并附带 page/zoom | App A/B round-trip保留 page hint和 persisted tab page |
| next/previous 与关闭回退 | 同 hook file 的 relative/close assertions | 当前三入口都丢 restore；close fallback现有期望只有 URL | 三入口都把 next DocumentState交给统一 sync helper | existing close/background/final tests继续通过 |
| visible ±10 和第8页滑动 | `renderRange.test.ts` default/shift/multi/boundary tests | 当前默认只 -1/+2 | 默认常量改成 10/10，函数公式不变 | explicit 0/5 custom option仍通过 |
| bridge 使用新策略 | `PdfViewerBridge.test.tsx` 读取 mock Viewer `setRenderRange` | callback返回旧 1/2结果 | bridge生产接线不改；默认 helper变更后自动GREEN | existing initialPage/defaultScale/load tests继续通过 |

### 4.3 Sequential and parallel boundaries

| Step | Depends on | May run in parallel with | Must not overlap with | Reason |
| --- | --- | --- | --- | --- |
| Step 1 | None | None in execution | `src/reader/hooks/useReaderNavigation*.ts*`、`src/app/App.test.tsx` | 需要一个完整 RED/GREEN 与独立 commit；同时保护 shared App test |
| Step 2 | Step 1 committed | None in execution | `src/viewer/renderRange*.ts`、`src/viewer/PdfViewerBridge.test.tsx` | 写作用域虽与 Step 1 不重叠，但执行技能要求逐 Step 验证/提交；顺序能把失败归属保持清晰 |

不分派并行实现；若未来人工并行，两个 Step 的生产写作用域不重叠，但 `bun run typecheck/test` 和最终集成必须在两 commit 合并后重跑。

### 4.4 Commit boundaries

- Step 1：一个 path-limited commit，包含 hook RED tests、最小 production fix 和 App regression。Commit：`fix(reader): restore active tab reading position`。
- Step 2：一个 path-limited commit，包含 range/bridge RED tests 和默认策略修改。Commit：`perf(viewer): expand dynamic page render window`。
- 每个 Step 只用显式 `git add <listed paths>`；不得 stage 当前 untracked Spec/Plan、其他 docs 或无关文件。
- 不 squash 两个语义提交，不在一个 Step 中吸收后续性能调优。

## 5. Change File Tree

```text
src/
├── app/
│   └── App.test.tsx                              MODIFY  Step 1
├── reader/
│   └── hooks/
│       ├── useReaderNavigation.test.tsx          MODIFY  Step 1
│       └── useReaderNavigation.ts                MODIFY  Step 1
└── viewer/
    ├── PdfViewerBridge.test.tsx                  MODIFY  Step 2
    ├── renderRange.test.ts                       MODIFY  Step 2
    └── renderRange.ts                            MODIFY  Step 2

NO CHANGE:
src/viewer/PdfViewerBridge.tsx
src/viewer/viewerTypes.ts
src-tauri/**
package.json
bun.lock
```

| Operation | Path | Symbols | Responsibility | Step | Requirements |
| --- | --- | --- | --- | --- | --- |
| MODIFY | `src/reader/hooks/useReaderNavigation.test.tsx` | `createNavigationFixture`、hook test cases | RED contracts for selected/relative/fallback restore and missing source | Step 1 | `REQ-001..004`、`REQ-010`、`PLAN-REQ-003` |
| MODIFY | `src/reader/hooks/useReaderNavigation.ts` | `syncViewerSource`、`selectReaderSession`、`selectNextReaderSession`、`selectPreviousReaderSession`、`closeReaderSession` | target next state → matching URL + restore | Step 1 | `REQ-001..004`、`REQ-009`、`PLAN-REQ-002/003` |
| MODIFY | `src/app/App.test.tsx` | shared navigation/session persistence regression | A/B往返后 page hint与 persisted page保持 | Step 1 | `REQ-001`、`REQ-003/004`、`SR-PROGRESS-007` |
| MODIFY | `src/viewer/renderRange.test.ts` | `createRenderRange` tests | RED contracts for ±10/eighth-page/multi-page/boundary/custom | Step 2 | `REQ-005..010`、`PLAN-REQ-002` |
| MODIFY | `src/viewer/PdfViewerBridge.test.tsx` | mock Viewer `setRenderRange` assertion | prove bridge consumer receives new default strategy without production rewiring | Step 2 | `REQ-005`、`REQ-007/008/010`、`PLAN-REQ-001` |
| MODIFY | `src/viewer/renderRange.ts` | `defaultPagesBehind`、`defaultPagesAhead`、comments | minimum GREEN 10/10 stateless range | Step 2 | `REQ-005..009`、`SR-PROGRESS-008` |

每个 affected file 只在表中出现一次；没有 Create/Delete/Rename/Generated file。

## 6. Prerequisites, Constraints, and Plan Clarifications

### 6.1 Repository and worktree baseline

- Repository root：`/Users/mario/SelfProject/SmartReader`。
- Branch/commit：`main@84ac5c55e53124928332dddaf39f11e3ef6e26c0`。
- 当前 dirty state：只有 `docs/egon/spec/2026-08-17-16-40-reader-progress-render-window.md` 为 untracked；Plan 写入后还会有本 Plan 和 Spec 的 Related Plans metadata diff。
- 实施前必须重新运行 `git status --short`。若出现其他并发修改，保护并绕开；任何与 6 个目标 TS/TSX 文件重叠的未知修改都必须先审计，不能覆盖。
- 每 Step 使用 path-limited staging；禁止 `git add .`。文档不进入代码 Step commit，除非用户另行授权文档提交。
- 根目录没有磁盘 `AGENTS.md`；本会话提供的 Main Agent Rules 适用：最小变更、测试优先、每任务一 commit、不自动启动。

### 6.2 Build, test, and environment prerequisites

| Concern | Exact command/source | Required state | Validation boundary |
| --- | --- | --- | --- |
| Package/runtime | `package.json`；Bun dependencies已安装 | `node_modules` 含 pinned Viewer 3.12.0 | local frontend only |
| Focused tests | `bun run test <explicit test files>` | Vitest 4.1.9/jsdom/Testing Library | mock/pure/component，不证明真实 Viewer/Tauri |
| Typecheck | `bun run typecheck` | `tsc -b` exit 0 | TypeScript static |
| Full frontend tests | `bun run test` | 全部 test files exit 0 | mocked frontend/integration |
| Build | `bun run build` | `tsc -b && vite build` exit 0 | production bundle；不启动 |
| Static diff | `git diff --check` | 无 whitespace error | tracked diff only；untracked docs需单独校验 |
| Plan/Spec docs | skill validators | strict PASS | 文档结构/links/traceability |
| Runtime/manual | 用户执行 `bun run tauri` 后按 §8.3 | 本 Plan 不执行 | native PDF、visual、memory、keyboard |

不得使用 Jest `--runInBand`；Vitest 命令沿用仓库 `bun run test <files>`。

### 6.3 Immutable constraints and approved decisions

- 用户已确认无状态动态窗口解释：以最新 visible range 计算 -10/+10；前进 8 页时窗口同步滑动，不建立批次队列。
- `DocumentSession.page/zoom` 是 runtime source of truth；不得在激活时从 SQLite 重读旧值。
- source 的 `sessionId/url/restore` 必须来自同一目标 session；URL缺失返回 null，不借用其他 session。
- `ViewerSource` 类型、ReaderTabs props、navigation hook public action names、command IDs 保持不变。
- 不调用 `jumpToPage` 模拟恢复；继续使用 Viewer `initialPage/defaultScale`。
- 页面范围保持 stateless pure function；不引入 PageCacheManager、LRU page objects、timer、queue或新 React state。
- 不修改既有 migrations，不创建 migration，不改 Rust/SQLite/permissions/config/dependencies。
- 不新增生产日志/metrics/UI copy。
- 不启动应用；真实手工验证由用户完成。

### 6.4 Plan Clarifications

| ID | Small implementation inference | Repository evidence | Why semantics are unchanged | Impact if wrong |
| --- | --- | --- | --- | --- |
| `PLAN-CLAR-001` | implementation-local `syncViewerSource` 参数从 `sessionId` 改为 next `DocumentState`，内部再找 active session | 当前所有调用点都在同一 hook，且已经先算 `next`；Primary INTERNAL-001明确输入 nextState | public hook return contract不变，只避免旧闭包和URL/position拼错 | 若实现者改为两个参数，必须仍证明两者来自同一 next state |
| `PLAN-CLAR-002` | 不修改 `PdfViewerBridge.tsx` 与 `viewerTypes.ts` | bridge 已 `useMemo(() => createRenderRange(), [])` 并传 `setRenderRange`；类型已有 `restore.page/zoom`；Primary §8明确这些文件 only-if-needed/comment-only | 默认 helper变化会自动到达 Viewer，且 hook只复用既有类型 | 若执行前源码漂移导致接线缺失，必须回到 Spec/Plan，不得临时扩 scope |
| `PLAN-CLAR-003` | App test只验证 shared navigation/page snapshot/persistence不回退；精确 ViewerSource restore shape由 hook RED test拥有 | injected `PdfRendererProps` 不接收 restore；bridge已有 initialPage/load tests | 测试分层与现有 seam一致，不新增 test-only production prop | 若 App 层必须直接观察 restore，需要先设计合法 seam，不能扩展 renderer contract只为测试 |
| `PLAN-CLAR-004` | `renderRange.ts` 保持 helper 可返回越界值，由 pinned Viewer clamp，不在 helper中使用 numPages裁剪 | 当前注释、tests和 dependency core.js均采用 Viewer clamp | 与 Primary INTERNAL-003完全一致；避免双重边界算法 | 若 Viewer依赖升级改变 clamp，dependency upgrade必须另行评审 |

## 7. Ordered File-by-file Implementation Steps

> 每个 Step 独立验证并形成一个语义 commit；严格按文件顺序执行。

### Step 1 — 让所有 Tab 激活入口恢复目标会话页码与缩放

- Requirements: `REQ-001`、`REQ-002`、`REQ-003`、`REQ-004`、`REQ-009`、`REQ-010`、`SR-PROGRESS-007`、`SR-PROGRESS-008`、`PLAN-REQ-002`、`PLAN-REQ-003`
- Dependencies: `None`
- Observable outcome: 点击 Tab、Control+Tab relative selection 和关闭活动 Tab 回退都生成目标 session 自身的 `{ sessionId, url, restore: { page, zoom } }`；后台关闭不重绑、最后关闭清空、URL缺失不串文档；应用级 session page不因往返回到 1。
- Ordered files:

#### File 1 — `MODIFY src/reader/hooks/useReaderNavigation.test.tsx`

- Purpose: 在生产修改前用 focused hook tests 固定目标 source/restore 和所有导航分支。
- Symbols: `createNavigationFixture`、`describe('useReaderNavigation ...')`、selected/relative/active-close/missing-URL test cases。
- Why now: 这是 Step 1 的 RED contract；当前实现只输出 `sessionId/url`，会因缺少 `restore` 精确失败。
- Contract/signature changes: 测试 fixture 让 A/B 分别持有 page/zoom/history；不改 production public type。现有 active-close expected source增加 restore。
- Implementation pseudocode:

```tsx
function createNavigationFixture() {
  const base = add A then B
  const sessions = [
    clone A with page=42, zoom=1.5, history.currentPage=42,
    clone B with page=7, zoom=0.9, history.currentPage=7,
  ]
  const state = { ...base, sessions, activeSessionId: B.id }
  keep currentState inside fake setDocuments
  map A.id -> blob:a and B.id -> blob:b
  return fixture whose activeSession is cloned B
}

it('restores the selected session page and zoom') {
  render useReaderNavigation(fixture)
  call selectReaderSession(A.id)
  assert current active ID is A.id
  assert setViewerSource last call equals
    { sessionId: A.id, url: 'blob:a', restore: { page: 42, zoom: 1.5 } }
}

it('restores each target while cycling sessions') {
  call selectNextReaderSession from B -> A
  assert A restore 42/1.5
  call selectPreviousReaderSession from A -> B
  assert B restore 7/0.9
}

update active-close fallback assertion:
  source equals A URL plus restore 42/1.5

it('clears source when target session has no Blob URL') {
  make getForSession(A.id) return null
  select A
  assert setViewerSource(null)
  assert A page/zoom remain unchanged
}

preserve existing assertions:
  background close does not sync
  final close syncs null
  unknown close is no-op
  closeActiveTab delegates current active session
```

- After this file: Focused test file compiles；新 selected/relative/fallback assertions因 current source缺 restore而 RED，existing background/final/unknown invariants仍可执行；失败不是 fixture/import错误。

#### File 2 — `MODIFY src/reader/hooks/useReaderNavigation.ts`

- Purpose: 用 next `DocumentState` 的 active session 构建唯一、匹配的 ViewerSource。
- Symbols: `syncViewerSource`、`selectReaderSession`、`selectNextReaderSession`、`selectPreviousReaderSession`、`closeReaderSession`。
- Why now: File 1 已固定 RED behavior；这是满足它的最小 production change。
- Contract/signature changes: 仅 implementation-local `syncViewerSource` 从 `(sessionId: string | null)` 改为接收 `DocumentState`；hook 对外返回方法及参数不变。
- Implementation pseudocode:

```ts
const syncViewerSource = useCallback((state: DocumentState) => {
  const target = state.sessions.find(
    (session) => session.id === state.activeSessionId,
  )

  if (!target) {
    setViewerSource(null)
    return
  }

  const url = blobUrlCache.getForSession(target.id)
  setViewerSource(
    url
      ? {
          sessionId: target.id,
          url,
          restore: { page: target.page, zoom: target.zoom },
        }
      : null,
  )
}, [blobUrlCache, setViewerSource])

selectReaderSession(sessionId):
  setDocuments(current => {
    const next = selectSession(current, sessionId)
    if (next !== current) syncViewerSource(next)
    return next
  })

selectNextReaderSession/selectPreviousReaderSession:
  compute next with existing store helper
  if state changed, syncViewerSource(next)
  return next

closeReaderSession(sessionId):
  revoke only target session URL
  compute next with closeDocumentSession
  if activeSessionId changed, syncViewerSource(next)
  return next

do not:
  call jumpToPage
  read persistence
  mutate target.page/zoom
  synchronize after background/unknown close
```

- After this file: File 1 的 restore assertions GREEN；所有 source字段来自同一 target session；现有 hook public API、close cleanup、history与persistence边界不变。

#### File 3 — `MODIFY src/app/App.test.tsx`

- Purpose: 在真实 ReaderApp shared-navigation wiring 上锁定 A/B往返不把 A 的 runtime/persisted page回退为 1。
- Symbols: `App` integration test near existing `keeps the PDF source in sync when switching tabs with shortcuts` and progress tests。
- Why now: minimum hook behavior已 GREEN；此文件验证消费者和现有 persistence effect，没有引入新 production seam。
- Contract/signature changes: 无 production contract。复用 `TestPdfRenderer` 对 `blob:progress-sync` 上报 page4/total10 的现有能力、sequential native open fixture、`saveReaderSession` spy。
- Implementation pseudocode:

```tsx
it('keeps a tab reading page after switching away and back') {
  mock URL.createObjectURL:
    first -> 'blob:progress-sync'
    second -> 'blob:tab-b'
  create persistence with saveReaderSession spy
  mock openNativePdf:
    first desktop A progress-a.pdf
    second desktop B progress-b.pdf
  render App with testViewerRenderer

  click home open; wait A tab and its title/page hint becomes 4/10
  click shared navigation open; wait B active
  click A tab

  assert A aria-selected='true'
  assert A title still contains 4/10 rather than 1/10
  wait for saveReaderSession last relevant snapshot
  assert tabs contains A documentKey with page=4
  assert activeDocumentKey is A
  assert no expectation relies on custom renderer seeing ViewerSource.restore
}
```

- After this file: Step 1 有 focused内部契约和应用级持久化回归；App test不重复 bridge initialPage责任，existing shared navigation tests保持。

- Verification command: `bun run test src/reader/hooks/useReaderNavigation.test.tsx src/app/App.test.tsx && bun run typecheck && git diff --check`
- Expected result: 两个指定 Vitest files全部通过，`tsc -b` exit 0，diff无 whitespace错误；RED阶段记录的缺 restore failures已由 File 2 消除。
- Completion criteria: `REQ-001..004` 的 selected/relative/fallback/missing-source branches均有断言；App session snapshot不回退；只有 3 个 Step 1 文件变化；无 Viewer/Rust/schema/manifest diff。
- Rollback: 只回退 Step 1 commit的 3 个路径即可恢复旧行为；无数据/schema rollback。不得只回退 production而保留新 expected assertions，或只回退 tests掩盖回归。
- Commit: `fix(reader): restore active tab reading position`

### Step 2 — 将 Viewer 动态渲染窗口扩展为可见范围前后各十页

- Requirements: `REQ-005`、`REQ-006`、`REQ-007`、`REQ-008`、`REQ-009`、`REQ-010`、`SR-PROGRESS-007`、`SR-PROGRESS-008`、`PLAN-REQ-001`、`PLAN-REQ-002`
- Dependencies: `Step 1 committed and focused GREEN`
- Observable outcome: `createRenderRange()` 对最新 visible range始终返回 start-10/end+10；从20前进到28时end从30滑到38；多页viewport与首尾越界契约明确；bridge继续把同一策略传给 pinned Viewer，显式 custom options不变。
- Ordered files:

#### File 1 — `MODIFY src/viewer/renderRange.test.ts`

- Purpose: 在改默认常量前定义对称10页、8页推进、多页viewport、边界与显式override的纯函数RED contracts。
- Symbols: `describe('createRenderRange')` 中全部现有默认策略 tests及新增 sliding test。
- Why now: 当前 default 1/2 会对新期望稳定 RED；纯函数提供最快、最精确的 off-by-one证据。
- Contract/signature changes: 不改 production签名；将旧“ahead-biased且小于library default”的已废弃行为断言替换为已确认10/10要求，保留 explicit option兼容。
- Implementation pseudocode:

```ts
it('keeps ten pages behind and ahead of one visible page') {
  const range = createRenderRange()({ startPage: 20, endPage: 20, numPages: 100 })
  expect(range).toEqual({ startPage: 10, endPage: 30 })
}

it('slides forward by the eighth page without a separate batch state') {
  const renderRange = createRenderRange()
  expect(renderRange(anchor 20..20)).toEqual(10..30)
  expect(renderRange(advanced 28..28)).toEqual(18..38)
}

it('extends both sides of a multi-page visible range') {
  expect(default range for 20..21).toEqual(10..31)
}

it('leaves document-edge clamping to the viewer') {
  expect(default range for 0..0 of 100).toEqual(-10..10)
  expect(default range for 99..99 of 100).toEqual(89..109)
}

it('honours an explicit window') {
  expect(createRenderRange({ pagesBehind: 0, pagesAhead: 5 })(4..4))
    .toEqual(4..9)
}
```

- After this file: 默认/滑动/多页/边界 tests因 production仍为 -1/+2而 RED；explicit0/5 test保持GREEN，证明失败只来自默认策略差异。

#### File 2 — `MODIFY src/viewer/PdfViewerBridge.test.tsx`

- Purpose: 在 production helper变更前证明真实 bridge已将默认 callback交给 Core Viewer，并让 callback行为成为 consumer-level RED contract。
- Symbols: `pdfViewerCoreMock.lastViewerProps`、新增 `uses the ten-page dynamic render window` test；既有 restore tests保持。
- Why now: File 1证明算法；此文件证明 `PdfViewerBridge -> Viewer.setRenderRange` 接线，无需修改 bridge生产文件。
- Contract/signature changes: 无 production change；测试局部将 `lastViewerProps.setRenderRange` cast成与 `VisiblePagesRange` 相同的函数shape。
- Implementation pseudocode:

```tsx
it('passes the ten-page dynamic render window to the real viewer') {
  render PdfViewerBridge with source session-a/blob:book
  const setRenderRange =
    pdfViewerCoreMock.lastViewerProps?.setRenderRange as function
  expect(setRenderRange).toBeTypeOf('function')
  expect(setRenderRange({ startPage: 20, endPage: 20, numPages: 100 }))
    .toEqual({ startPage: 10, endPage: 30 })
}

keep existing tests:
  restore page42 -> initialPage41
  restore zoom1.5 -> defaultScale1.5
  onDocumentLoad reports restored page
```

- After this file: bridge test因当前 callback返回19..22而 RED；它没有要求新增 props/state或改 mock Viewer实现。

#### File 3 — `MODIFY src/viewer/renderRange.ts`

- Purpose: 以最小改动把默认 stateless strategy从1/2改成10/10，并修正代码说明。
- Symbols: `defaultPagesBehind`、`defaultPagesAhead`、默认窗口注释；`createRenderRange` 公式保持。
- Why now: Files 1-2 已同时固定算法与consumer RED，生产只需更新默认策略。
- Contract/signature changes: `RenderRangeOptions`、`VisiblePagesRange`、factory/callback signatures不变；explicit options继续覆盖默认值。
- Implementation pseudocode:

```ts
const defaultPagesBehind = 10
const defaultPagesAhead = 10

document in comments:
  this is Viewer render overscan, not byte/disk cache
  callback is stateless and follows the latest visible range
  actual bounds are clamped by @react-pdf-viewer
  resident PDF.js internal caches are not a strict 21-page memory guarantee

createRenderRange(options = defaults):
  return range => ({
    startPage: range.startPage - pagesBehind,
    endPage: range.endPage + pagesAhead,
  })

do not:
  use numPages to duplicate Viewer clamping
  add anchor/ref/timer/queue/LRU
  modify PdfViewerBridge production wiring
```

- After this file: Files 1-2 GREEN；default callback满足 ±10/第8页滑动/多页/越界契约；custom0/5保持；bridge、types和third-party依赖不变。

- Verification command: `bun run test src/viewer/renderRange.test.ts src/viewer/PdfViewerBridge.test.tsx && bun run typecheck && git diff --check`
- Expected result: 两个指定 Vitest files全部通过，`tsc -b` exit 0，diff无 whitespace错误；RED阶段的1/2实际值已变为10/10。
- Completion criteria: `REQ-005..008` 每项有纯函数或bridge断言；`REQ-009` 通过只有3个Step2文件变化证明；没有 stateful cache、bridge production、manifest、Rust或migration diff。
- Rollback: 只回退 Step 2 commit的 3 个路径；无数据回滚。回退会恢复旧1/2窗口但不影响Step1进度修复。
- Commit: `perf(viewer): expand dynamic page render window`

## 8. Test, Validation, and Quality Gates

### 8.1 Automated gates

| Gate/order | Command or method | Scope | Expected result | Failure returns to | Requirements |
| --- | --- | --- | --- | --- | --- |
| Baseline review | `git status --short` + path/symbol inspection | worktree/6目标文件 | 只看到已知docs变更；无未知重叠修改 | 停止并审计 §6.1 | `REQ-009` |
| Step 1 RED | `bun run test src/reader/hooks/useReaderNavigation.test.tsx` | hook source contract | 新 selected/relative/fallback tests只因缺 `restore` 失败；existing invariants无fixture错误 | Step 1 File 1 | `REQ-001..004` |
| Step 1 GREEN | `bun run test src/reader/hooks/useReaderNavigation.test.tsx src/app/App.test.tsx` | hook + app | 两 files全部通过 | Step 1 File 2/3 | `REQ-001..004`、`SR-PROGRESS-007` |
| Step 1 static | `bun run typecheck && git diff --check` | TS/worktree | exit 0/no whitespace error | Step 1 owning file | `REQ-009/010` |
| Step 1 commit audit | `git diff --cached --name-only` | staged paths | 仅3个Step1 paths；不含docs/src-tauri/manifests | restage path-limited | `REQ-009` |
| Step 2 RED | `bun run test src/viewer/renderRange.test.ts src/viewer/PdfViewerBridge.test.tsx` | range + bridge | default/shift/multi/boundary/bridge assertions因旧1/2失败；custom0/5仍通过 | Step 2 File 1/2 | `REQ-005..008` |
| Step 2 GREEN | 同 Step 2 RED command | range + bridge | 两 files全部通过 | Step 2 File 3 | `REQ-005..008` |
| Step 2 static | `bun run typecheck && git diff --check` | TS/worktree | exit 0/no whitespace error | Step 2 owning file | `REQ-009/010` |
| Step 2 commit audit | `git diff --cached --name-only` | staged paths | 仅3个Step2 paths | restage path-limited | `REQ-009` |
| Full frontend regression | `bun run test` | all Vitest files | all tests pass；无新的 unhandled rejection | owning Step by first failing suite | 全部 |
| Production build gate | `bun run typecheck && bun run build` | TS + Vite | both exit 0；既有 pdfjs eval/bundle warning可记录但不得新增error | owning Step | `REQ-009/010` |
| Final diff gate | `git diff --check && git status --short` | repository | 无 whitespace error；代码 commits clean；仅明确保留的docs state可见 | owning Step/path audit | `REQ-009` |
| Spec conformance audit | 对照 Primary `§19` 与本 Plan `§10` | requirements/files/tests | 每项有commit与实际evidence；未验证runtime明确标注 | 不得标完成，回到Step | 全部 |

`cargo test`、migration validation、Tauri permissions/config checks为 N/A，因为本 Plan 明确不改 `src-tauri`/SQLite；若实际 diff触及这些边界，实施必须停止并回到 Spec/Plan，而不是临时追加命令后继续。

### 8.2 RED/GREEN evidence recording

每 Step commit前在实施记录中保留：

- RED command、exit code、失败 test names和“实际旧值 vs 期望新值”；
- GREEN 同 command、exit code和通过文件数/测试数；
- typecheck/build/full test exit code；
- staged path list与 commit hash。

丢失命令句柄或只有部分输出不算通过；重新运行 focused command并取得明确 exit code。

### 8.3 Manual/runtime gate owned by the user

实现完成后由用户启动 Tauri；代理不自动启动：

1. 打开 A，读到第 42 页并设置非默认 zoom；打开 B，读到第 7 页；点击顶部 A Tab，确认首屏直接在 42 页且 zoom一致，没有先闪第一页。
2. 用 Control+Tab 切换 A/B，分别保持42/7；关闭当前 B后回退 A仍在42。
3. 关闭/重启应用，确认 desktop-path session仍从持久化页恢复；这是现有持久化回归，不要求新数据迁移。
4. 使用100+页、图片较多PDF，从任一中间页连续滚动至少12页；在第8页附近无明显等待断层，窗口继续加载后续页。
5. 从中间跳到首页、末页、搜索结果、书签或批注页，确认目标附近页面可继续滚动且无非法页错误。
6. 观察开发工具/系统内存趋势与page DOM数量：不能声称PDF.js严格只缓存21页，但virtual page DOM不应随总页数无限增长。
7. 若 ±10 在代表性PDF上造成明显内存/卡顿问题，记录文档页复杂度、zoom和设备情况，返回设计决策；不要静默改成其他窗口。

## 9. Migration, Compatibility, Rollout, and Rollback

### 9.1 Migration and data

N/A。Primary `§11`/`§16` 明确：现有 `documents/sessions/session_tabs` 已有 page/zoom/progress，不新增字段、index、table、migration或backfill；历史 migration不可修改。页面render window不持久化，也不写 `cache_entries`。

### 9.2 Compatibility

- Source：`useReaderNavigation` public actions、`ViewerSource`、`RenderRangeOptions` signatures不变。
- Behavior：新 session仍从page1；启动restore/reopen/retry继续用既有 restore；Tab runtime activation补齐同一语义。
- Commands/UI：ReaderTabs DOM、Meta+O/Meta+W/Control+Tab IDs和focus/accessibility不变。
- Data：runtime page继续即时更新；desktop document/session snapshot继续250ms debounce和现有Rust transaction。
- Dependency：`@react-pdf-viewer/core 3.12.0`、PDF.js和lockfile不变。
- Error：missing URL仍为null；load error/timeout仍走现有error state；不新增日志/提示。

### 9.3 Rollout

两个前端 commits按Step顺序进入同一版本，无 feature flag/dual-read/deployment order。自动 gates通过后交给用户执行 §8.3；未完成 manual gate时只能声明静态/自动化完成，不能声明真实桌面性能已验证。

### 9.4 Rollback and forward-fix

- 可独立回退Step2保留Step1：恢复旧1/2窗口，不影响正确Tab进度。
- 回退Step1会恢复Tab第一页缺口；无data repair，因为字段/schema未变。
- 若只发生tests/build回归，回到所属Step最小修复；不得跨Step做无关重构。
- 若真实±10内存不可接受，forward-fix需要新的明确设计决定（调常量、可配置或自适应），不属于本 Plan。

## 10. Requirement-to-Step Traceability Matrix

| Requirement | Effective Spec section | Steps | Files | Tests/gates | Completion evidence |
| --- | --- | --- | --- | --- | --- |
| `REQ-001` | Primary §4/§7.3 | Step 1 | navigation test/prod、App test | Step1 RED/GREEN、manual1 | target restore.page + bridge existing initialPage |
| `REQ-002` | Primary §4/§9.2.2 | Step 1 | navigation test/prod | selected/relative assertions、manual1 | target restore.zoom |
| `REQ-003` | Primary §4/§7.3 | Step 1 | navigation test/prod、App test | selected/relative/close/missing tests、manual2 | all activation paths same helper |
| `REQ-004` | Primary §4/§7.3/§11 | Step 1 | navigation test/prod、App test | bridge existing restore tests、session snapshot assertion | no activation-caused page1 |
| `REQ-005` | Primary §4/§9.2.3 | Step 2 | range test/prod、bridge test | 20..20 → 10..30 | default10/10 |
| `REQ-006` | Primary §4/§5 ASM-001 | Step 2 | range test/prod | 20→28 sliding test、manual4 | end30→38 |
| `REQ-007` | Primary §4/§9.2.3 | Step 2 | range/bridge tests、prod | boundary test、pinned source、manual5 | helper edge + Viewer clamp |
| `REQ-008` | Primary §4/§7.2 | Step 2 | range test/prod | multi-page/sliding/custom、manual4/5 | stateless latest range |
| `REQ-009` | Primary §4/§8/§16 | Step 1、2 | all 6 only | staged-path/final diff gates | no dependency/Rust/schema/state-manager |
| `REQ-010` | Primary §4/§14 | Step 1、2 | all tests | focused/typecheck/full/build/manual checklist | recorded exits + manual boundary |
| `SR-PROGRESS-007` | Progress Design §Requirements | Step 1、2 | App/bridge regression | full test/build/manual3 | existing viewer/reopen features preserved |
| `SR-PROGRESS-008` | Progress Design §Requirements | Step 1、2 | all 6 | file tree/diff audit | current style, no new architecture |
| `PLAN-REQ-001` | PDF Reader §Implementation Constraints | Step 2 | bridge test、range files | bridge consumer/full build | small bridge, same viewer foundation |
| `PLAN-REQ-002` | PDF Reader §Cache/History | Step 1、2 | navigation/range files | hook/range/full tests | cache/history boundaries unchanged |
| `PLAN-REQ-003` | Stabilization §Switch Tab | Step 1 | navigation test/prod | matching URL/restore + missingURL test | no cross-session source |

## 11. Risks, Blockers, and User Decisions

| ID | Risk or decision | Impacted Steps/files | Evidence | Owner | Status/action |
| --- | --- | --- | --- | --- | --- |
| `RISK-001` | ±10比当前1/2持有更多virtual pages，图片密集/高zoom PDF可能增加内存 | Step2 range | Primary RISK-001；当前无runtime profile | User/runtime | Mitigated by bounded window and mandatory manual gate；不阻塞编码 |
| `RISK-002` | `setRenderRange` 不严格清除PDF.js内部font/image/page caches | Step2/manual | pinned core仅限制virtualItems | User/runtime | Boundary documented；不得宣称严格21页内存 |
| `RISK-003` | 快速Tab切换可能暴露旧Viewer异步事件时序 | Step1/navigation/bridge | progress携带sessionId；真实Viewer未自动运行 | User/runtime | Focused ownership tests + manual rapid switching |
| `RISK-004` | App injected renderer不能直接观察 restore | Step1 App test | `PdfRendererProps` 只有fileUrl/callbacks | Main agent | Closed by test-layer ownership：hook断shape，bridge断conversion，App断state |
| `RISK-005` | 目标 Spec metadata仍为Review，虽然用户已明确确认 | Plan status | user message + Plan skill只允许回填Related Plans metadata | User | Closed for planning authorization；Plan保持Review等待自身批准 |
| `RISK-006` | 当前Spec/Plan docs为untracked，宽泛staging可能混入代码commit | Both steps | `git status --short` baseline | Implementer | Path-limited staging and staged-name audit required |
| `RISK-007` | beforeunload只flush session、document flush可能落后 | Step1 compatibility | Primary RISK-004 | Separate future work | Deferred outside scope；本 Plan不扩大 |

不存在未解决的重大业务、接口、schema、架构或迁移 blocker。用户已确认无状态第8页滑动解释。

## 12. Review and Acceptance

### 12.1 Original requirement fidelity

- Tab 点击恢复上次进度由 Step 1 selected/relative/close source tests、minimum production fix与App regression完整覆盖。
- 当前页前后各10页由 Step 2 default/multi-page tests覆盖。
- 第8页继续加载由20→28无状态滑动断言覆盖，没有改成批次队列。
- 没有把“缓存”扩展为磁盘/字节/page LRU，也没有新增UI/依赖/数据库工作。

### 12.2 Spec consistency

- 文件树从 Primary §8可选范围收敛为6个确需修改的files；`PdfViewerBridge.tsx`/`viewerTypes.ts` 省略有当前源码与Primary only-if-needed措辞支持。
- INTERNAL-001由next state mapping实现；INTERNAL-002复用现有type/bridge；INTERNAL-003只改默认常量。
- 进度、transaction、migration、错误、cache layers、manual boundary与Primary一致。
- `PLAN-CLAR-001..004` 均是局部可逆实施/测试责任，不新增外部行为。

### 12.3 Repository executability

- 6个路径和全部symbols在 `main@84ac5c5` 存在并已重新核对。
- 文件顺序满足 test-first：每个 behavior先focused RED，后minimum production，再consumer regression/verification。
- 两Step写作用域不重叠，commit边界明确；所有命令来自 `package.json`/README。
- untracked docs和未来并发修改通过path-limited staging保护。

### 12.4 Test and release completeness

- Step级 RED/GREEN、typecheck、diff和staged audit齐全。
- 最终有全Vitest、typecheck、Vite build、Spec conformance和用户manual checklist。
- Rust/migration/config/permission gates证据化N/A；若实现越界必须停止而不是扩大。
- Plan未执行代码、测试、build、数据库或runtime；当前验证仅是仓库静态取证与Plan/Spec文档校验。

### 12.5 Final verdict

PASS — Ready for user review
