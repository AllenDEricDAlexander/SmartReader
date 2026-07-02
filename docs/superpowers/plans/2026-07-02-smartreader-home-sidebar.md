# SmartReader Home Sidebar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the simplified home sidebar with the prototype-style grouped navigation and local cache card, backed by local counts and cache statistics.

**Architecture:** Keep `ReaderApp` as the owner of persistence, workspace state, and navigation callbacks. Extract a presentational `HomeSidebar` and let `HomeDashboard` render either the existing home dashboard content or a blank home-sidebar page for entries whose internal page behavior is not specified. Add a narrow read-only cache statistics command on the existing SQLite cache table.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Tauri v2, Rust, SQLite via `rusqlite`, lucide-react icons, existing SmartReader workspace routing.

---

## Latest User Override

The approved spec said unspecified sidebar entries should not navigate. The latest instruction changes that behavior:

- Do not write implementation code in this plan. Use tasks and pseudocode only.
- For sidebar entries without clear internal routing details, render them as buttons and route them to a blank page.
- Do not start the project automatically.
- Do not open a browser or use computer control.

This plan follows the latest instruction over the earlier spec wording.

## Scope Check

This is one cohesive feature slice: the home left sidebar, its local counts, the local cache card, and the minimal routing needed by the sidebar buttons. It does not redesign the home main dashboard, top bar, reader workspace, tag manager, annotation manager, bookmark manager, compare-reading internals, or settings internals beyond opening settings directly on the cache section.

## File Structure

Create:

- `src/home/HomeSidebar.tsx` - presentational grouped sidebar and local cache card.
- `src/home/HomeSidebar.test.tsx` - focused sidebar rendering and callback tests.
- `src/home/HomeBlankPage.tsx` - blank content surface for sidebar entries without specified page details.
- `src/settings/SettingsWorkspace.test.tsx` - focused settings initial-section tests.

Modify:

- `src/home/HomeDashboard.tsx` - replace inline sidebar with `HomeSidebar`, accept sidebar stats/actions, and render blank pages for unspecified entries.
- `src/home/HomeDashboard.test.tsx` - verify blank-page routing and retained home open-file behavior.
- `src/app/ReaderApp.tsx` - load session count and cache stats, own home-sidebar page state, pass callbacks, and open cache settings.
- `src/app/App.test.tsx` - add integration tests for sidebar counts, blank-page routing, cache settings entry, and cache stats fallback.
- `src/settings/SettingsWorkspace.tsx` - accept an optional initial settings section and reset it when opened through cache management.
- `src/settings/CacheSettings.tsx` - keep existing settings content; no cleanup behavior is added.
- `src/persistence/persistenceApi.ts` - add typed cache stats API and Tauri invoke wrapper.
- `src/persistence/persistenceApi.test.ts` - verify cache stats invoke name.
- `src-tauri/src/db.rs` - add cache stats type, query function, Tauri command, and Rust tests.
- `src-tauri/src/lib.rs` - register the new cache stats command.
- `src/app/styles.css` - style grouped sidebar rows, full-row active state, badges, cache card, progress bar, and blank home-sidebar content.

Do not create or modify Flyway-style migration files. The existing `cache_entries` table already has `file_size`, so this feature only needs a read-only query.

## Shared Pseudocode Contracts

Use these names consistently across tasks unless implementation discovers an existing local naming pattern that is clearly better.

```pseudocode
type CacheStats:
  usedBytes: number
  totalBytes: number
  fileCount: number

constant DEFAULT_CACHE_TOTAL_BYTES = 5 GB in bytes

type HomeSidebarPage:
  "home"
  "recentFiles"
  "favoriteFiles"
  "sessionRestore"
  "myDocuments"
  "folders"
  "notes"

type HomeSidebarCounts:
  recentFiles: number
  favoriteFiles: number
  restorableSessions: number

type HomeSidebarActions:
  openHome()
  openRecentFilesBlankPage()
  openFavoriteFilesBlankPage()
  openSessionRestoreBlankPage()
  openMyDocumentsBlankPage()
  openFoldersBlankPage()
  openTags()
  openNotesBlankPage()
  openGlobalSearch()
  openAnnotations()
  openBookmarks()
  openCompare()
  openCacheSettings()
```

Blank page routing pseudocode:

```pseudocode
when unspecified sidebar button is clicked:
  set homeSidebarPage to matching HomeSidebarPage
  clear workspace override if needed so home dashboard shell remains visible
  render HomeBlankPage in the home main content region
```

Cache stats fallback pseudocode:

```pseudocode
when cache stats load succeeds:
  store returned stats

when cache stats load fails:
  store usedBytes = 0, totalBytes = DEFAULT_CACHE_TOTAL_BYTES, fileCount = 0
```

## Pre-Flight

- [ ] **Step 1: Confirm worktree state**

Run:

```bash
git status --short
```

Expected: no output, or only files from this plan if execution has already started. If unrelated user changes appear, inspect them and do not overwrite them.

- [ ] **Step 2: Read the sidebar design and latest override**

Run:

```bash
sed -n '1,380p' docs/superpowers/specs/2026-07-02-smartreader-home-sidebar-design.md
```

Expected: the design covers `SR-HOME-DIFF-007` through `SR-HOME-DIFF-018`. Apply the latest user override from this plan for unspecified entries: buttons route to blank pages.

- [ ] **Step 3: Inspect current implementation boundaries**

Run:

```bash
sed -n '1,180p' src/home/HomeDashboard.tsx
sed -n '1,180p' src/settings/SettingsWorkspace.tsx
sed -n '1,180p' src/persistence/persistenceApi.ts
rg -n "cache_entries|load_reader_session|list_recent_documents" src-tauri/src/db.rs src-tauri/src/lib.rs
```

Expected: sidebar markup is inline in `HomeDashboard`; settings defaults to shortcuts; persistence has no cache stats API; Rust has a `cache_entries` table but no cache stats command.

---

### Task 1: Add Local Cache Statistics Persistence

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/persistence/persistenceApi.test.ts`

- [ ] **Step 1: Write failing TypeScript API test**

Add a test in `src/persistence/persistenceApi.test.ts` that:

```pseudocode
create mocked invoke returning cache stats
create persistence API with mocked invoke
call api.loadCacheStats()
expect returned value equals mocked stats
expect invoke called with "load_cache_stats"
```

- [ ] **Step 2: Run the TypeScript test to verify it fails**

Run:

```bash
bun run test -- src/persistence/persistenceApi.test.ts
```

Expected: FAIL because `loadCacheStats` is not defined on the API.

- [ ] **Step 3: Write failing Rust database tests**

Add two Rust tests in the existing `#[cfg(test)]` module in `src-tauri/src/db.rs`:

```pseudocode
test load_cache_stats_returns_empty_totals:
  open in-memory migrated database
  call load_cache_stats_tx
  expect usedBytes = 0
  expect totalBytes = DEFAULT_CACHE_TOTAL_BYTES
  expect fileCount = 0

test load_cache_stats_sums_cache_entries:
  open in-memory migrated database
  insert two rows into cache_entries with file_size 100 and 250
  call load_cache_stats_tx
  expect usedBytes = 350
  expect totalBytes = DEFAULT_CACHE_TOTAL_BYTES
  expect fileCount = 2
```

- [ ] **Step 4: Run the Rust tests to verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml cache_stats
```

Expected: FAIL because the cache stats type and query function do not exist yet.

- [ ] **Step 5: Implement the minimal persistence API**

In `src/persistence/persistenceApi.ts`, make these changes:

```pseudocode
define CacheStats type:
  usedBytes number
  totalBytes number
  fileCount number

extend PersistenceApi:
  loadCacheStats returns Promise<CacheStats>

extend createPersistenceApi return object:
  loadCacheStats invokes "load_cache_stats" with no args
```

- [ ] **Step 6: Implement the minimal Rust cache stats query**

In `src-tauri/src/db.rs`, make these changes:

```pseudocode
define DEFAULT_CACHE_TOTAL_BYTES as 5 GB in bytes

define CacheStats struct:
  used_bytes i64 serialized as usedBytes
  total_bytes i64 serialized as totalBytes
  file_count i64 serialized as fileCount

define tauri command load_cache_stats:
  lock database connection
  call load_cache_stats_tx

define load_cache_stats_tx:
  query cache_entries for COALESCE(SUM(file_size), 0) and COUNT(*)
  return CacheStats with queried used bytes, DEFAULT_CACHE_TOTAL_BYTES, file count
```

In `src-tauri/src/lib.rs`, register the command:

```pseudocode
add db::load_cache_stats to generate_handler list
```

- [ ] **Step 7: Run targeted cache stats tests**

Run:

```bash
bun run test -- src/persistence/persistenceApi.test.ts
cargo test --manifest-path src-tauri/Cargo.toml cache_stats
```

Expected: PASS for both commands.

- [ ] **Step 8: Commit Task 1**

Run:

```bash
git status --short
git add src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: add local cache stats"
```

Expected: commit succeeds and includes only Task 1 files.

---

### Task 2: Allow Settings To Open Directly On Cache Section

**Files:**
- Create: `src/settings/SettingsWorkspace.test.tsx`
- Modify: `src/settings/SettingsWorkspace.tsx`

- [ ] **Step 1: Write failing settings initial-section tests**

Create `src/settings/SettingsWorkspace.test.tsx` with tests that:

```pseudocode
render SettingsWorkspace without initialSection
expect shortcuts section content is visible

render SettingsWorkspace with initialSection = "cache"
expect cache section content is visible
expect shortcuts section content is not the active section
```

Use existing test helpers from `src/test/renderApp.tsx`. Provide a minimal command registry and reader preferences object matching current test patterns.

- [ ] **Step 2: Run the settings test to verify it fails**

Run:

```bash
bun run test -- src/settings/SettingsWorkspace.test.tsx
```

Expected: FAIL because `initialSection` is not a supported prop.

- [ ] **Step 3: Implement the initial-section state behavior**

Modify `src/settings/SettingsWorkspace.tsx`:

```pseudocode
export SettingsSection type if needed by ReaderApp

extend props with optional initialSection

initialize activeSection from initialSection when provided, otherwise shortcuts

when initialSection changes while settings is mounted:
  update activeSection to the new initialSection
```

Do not change `CacheSettings` behavior in this task.

- [ ] **Step 4: Run targeted settings tests**

Run:

```bash
bun run test -- src/settings/SettingsWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git status --short
git add src/settings/SettingsWorkspace.tsx src/settings/SettingsWorkspace.test.tsx
git commit -m "feat: support cache settings entry"
```

Expected: commit succeeds and includes only Task 2 files.

---

### Task 3: Build Presentational HomeSidebar And Cache Card

**Files:**
- Create: `src/home/HomeSidebar.tsx`
- Create: `src/home/HomeSidebar.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing sidebar structure tests**

Create `src/home/HomeSidebar.test.tsx` with tests that:

```pseudocode
render HomeSidebar with activePage = "home"
expect group labels: 导航, 知识库, 工具
expect nav items:
  首页, 最近文件, 收藏文件, 会话恢复
  我的文献, 文件夹, 标签管理, 笔记管理
  全文搜索, 批注管理, 书签管理, 对比阅读
expect 首页 row has active class or active aria state
expect 最近文件 count equals provided recent count
expect 收藏文件 count equals provided favorite count
expect 会话恢复 count equals provided restore count
```

- [ ] **Step 2: Write failing sidebar action tests**

Add tests in `src/home/HomeSidebar.test.tsx` that:

```pseudocode
render HomeSidebar with mocked actions
click 最近文件 and expect openRecentFilesBlankPage called
click 收藏文件 and expect openFavoriteFilesBlankPage called
click 会话恢复 and expect openSessionRestoreBlankPage called
click 我的文献 and expect openMyDocumentsBlankPage called
click 文件夹 and expect openFoldersBlankPage called
click 笔记管理 and expect openNotesBlankPage called
click 标签管理 and expect openTags called
click 全文搜索 and expect openGlobalSearch called
click 批注管理 and expect openAnnotations called
click 书签管理 and expect openBookmarks called
click 对比阅读 and expect openCompare called
click 管理缓存 and expect openCacheSettings called
```

- [ ] **Step 3: Write failing cache card tests**

Add cache card tests in `src/home/HomeSidebar.test.tsx` that:

```pseudocode
render HomeSidebar with cacheStats usedBytes = 1.24 GB, totalBytes = 5 GB, fileCount = 128
expect 本地缓存 title
expect capacity text reads "1.24 GB / 5 GB"
expect progress bar has accessible value near 25 percent
expect text reads "已缓存 128 个文件"

render HomeSidebar with usedBytes greater than totalBytes
expect progress value is clamped to 100
```

- [ ] **Step 4: Run sidebar tests to verify they fail**

Run:

```bash
bun run test -- src/home/HomeSidebar.test.tsx
```

Expected: FAIL because `HomeSidebar` does not exist.

- [ ] **Step 5: Implement HomeSidebar with grouped config pseudocode**

Create `src/home/HomeSidebar.tsx`:

```pseudocode
import required lucide icons

define props:
  activePage
  counts
  cacheStats
  actions

define navGroups:
  导航 rows with icon, label, count key, action, active page
  知识库 rows with icon, label, action, active page where applicable
  工具 rows with icon, label, action

render:
  brand lockup
  nav with aria-label 主导航
  for each group:
    group label
    button row per item
    left icon
    label
    optional count
  cache card at bottom
```

Cache card formatting pseudocode:

```pseudocode
format bytes:
  if value is 0, show 0 B
  if value is at least 1 GB, show up to 2 decimals and trim trailing zeros
  otherwise show MB with up to 1 decimal

progress percent:
  if totalBytes <= 0, percent = 0
  else percent = usedBytes / totalBytes * 100
  clamp between 0 and 100
```

- [ ] **Step 6: Add sidebar CSS**

Modify `src/app/styles.css`:

```pseudocode
home-sidebar:
  display grid with brand, scrollable nav, bottom cache card
  preserve existing sidebar width and border

home-nav:
  grouped vertical layout

home-nav-section-label:
  small muted text, prototype spacing

home-nav-item:
  full-width row
  grid columns icon, label, count
  transparent default state

home-nav-item active:
  full-row light blue background
  subtle blue border
  blue icon and text
  stronger text weight

home-cache-card:
  bottom card with title row, capacity, progress, file count, manage button

responsive rules:
  hide labels/counts/cache card in narrow sidebar state if existing breakpoint requires compact sidebar
  keep mobile sidebar hidden at existing mobile breakpoint
```

- [ ] **Step 7: Run sidebar tests**

Run:

```bash
bun run test -- src/home/HomeSidebar.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git status --short
git add src/home/HomeSidebar.tsx src/home/HomeSidebar.test.tsx src/app/styles.css
git commit -m "feat: add home sidebar navigation"
```

Expected: commit succeeds and includes only Task 3 files.

---

### Task 4: Add Blank Home-Sidebar Pages To HomeDashboard

**Files:**
- Create: `src/home/HomeBlankPage.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`

- [ ] **Step 1: Write failing HomeDashboard sidebar integration tests**

Extend `src/home/HomeDashboard.test.tsx` with tests that:

```pseudocode
render HomeDashboard with activeSidebarPage = "home"
expect existing 快速开始 content is visible
expect HomeSidebar items are visible

render HomeDashboard with activeSidebarPage = "recentFiles"
expect 快速开始 content is not visible
expect a blank page region for 最近文件 is visible
expect sidebar remains visible

click 最近文件
expect onOpenRecentFilesBlankPage callback called
```

Keep the existing home open-file tests intact.

- [ ] **Step 2: Run HomeDashboard tests to verify failure**

Run:

```bash
bun run test -- src/home/HomeDashboard.test.tsx
```

Expected: FAIL because new props and blank page component do not exist yet.

- [ ] **Step 3: Create HomeBlankPage pseudocode**

Create `src/home/HomeBlankPage.tsx`:

```pseudocode
props:
  title

render:
  section with aria-label "{title}空白页"
  no feature instructions
  minimal page title only if needed for accessible and testable blank routing
```

- [ ] **Step 4: Modify HomeDashboard props and rendering**

Modify `src/home/HomeDashboard.tsx`:

```pseudocode
add props:
  activeSidebarPage
  sidebarCounts
  cacheStats
  sidebar action callbacks

replace inline sidebar markup with HomeSidebar

if activeSidebarPage is "home":
  render existing home header and home content unchanged

if activeSidebarPage is one of blank pages:
  render existing home header with matching title or neutral header
  render HomeBlankPage in main content region
```

Do not change top bar behavior, file input behavior, quick-start behavior, recent-session cards, or favorite cards beyond moving sidebar rendering out.

- [ ] **Step 5: Run HomeDashboard tests**

Run:

```bash
bun run test -- src/home/HomeDashboard.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git status --short
git add src/home/HomeBlankPage.tsx src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx
git commit -m "feat: route home sidebar blank pages"
```

Expected: commit succeeds and includes only Task 4 files.

---

### Task 5: Wire Sidebar State, Counts, Cache Stats, And Existing Destinations In ReaderApp

**Files:**
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Update test persistence factory pseudocode**

In `src/app/App.test.tsx`, update the local `createEmptyPersistence` test helper:

```pseudocode
add loadCacheStats mock returning:
  usedBytes 0
  totalBytes 5 GB
  fileCount 0
```

This keeps existing tests compiling after Task 1 extends `PersistenceApi`.

- [ ] **Step 2: Write failing ReaderApp sidebar data test**

Add an integration test in `src/app/App.test.tsx`:

```pseudocode
mock listRecentDocuments returns two documents
mock listFavoriteDocuments returns one document
mock loadReaderSession returns session with three tabs
mock loadCacheStats returns usedBytes 1.24 GB, totalBytes 5 GB, fileCount 128

render App

expect 最近文件 count 2
expect 收藏文件 count 1
expect 会话恢复 count 3
expect 本地缓存 capacity text
expect 已缓存 128 个文件
```

- [ ] **Step 3: Write failing blank-page routing test**

Add an integration test in `src/app/App.test.tsx`:

```pseudocode
render App with empty persistence
click 最近文件 in sidebar
expect 最近文件 blank page region is visible
expect main home quick-start content is not visible

click 首页
expect home quick-start content is visible again
```

- [ ] **Step 4: Write failing cache settings entry test**

Add an integration test in `src/app/App.test.tsx`:

```pseudocode
render App
click 管理缓存
expect 设置工作区 is visible
expect cache settings section is active
expect cache content from CacheSettings is visible
```

- [ ] **Step 5: Write failing cache stats fallback test**

Add an integration test in `src/app/App.test.tsx`:

```pseudocode
mock loadCacheStats rejects
render App
expect local cache card eventually shows 0 B / 5 GB
expect 已缓存 0 个文件
```

- [ ] **Step 6: Run targeted App tests to verify failure**

Run:

```bash
bun run test -- src/app/App.test.tsx
```

Expected: FAIL because `ReaderApp` does not yet provide sidebar stats, blank routing, or cache settings entry.

- [ ] **Step 7: Implement ReaderApp state and effects**

Modify `src/app/ReaderApp.tsx`:

```pseudocode
add homeSidebarPage state defaulting to "home"
add sessionRestoreCount state defaulting to 0
add cacheStats state defaulting to zero usage and 5 GB total
add settingsInitialSection state defaulting to undefined

on app startup:
  load favorites as currently done
  load tags as currently done
  load cache stats
    on success set cacheStats
    on failure set zero fallback
  load reader session for count
    on success set tabs length or 0
    on failure set 0

when user opens actual workspaces:
  keep existing workspaceOverride behavior

when user clicks blank sidebar page:
  set workspaceOverride to null
  set homeSidebarPage to requested blank page

when user clicks 首页:
  set workspaceOverride to null
  set homeSidebarPage to "home"

when user clicks 管理缓存:
  set settingsInitialSection to "cache"
  set workspaceOverride to "settings"

when user clicks normal settings outside cache:
  clear settingsInitialSection
  set workspaceOverride to "settings"
```

- [ ] **Step 8: Pass sidebar props into HomeDashboard**

Modify the `HomeDashboard` render call in `src/app/ReaderApp.tsx`:

```pseudocode
pass activeSidebarPage
pass counts:
  recentFiles from recentDocuments length
  favoriteFiles from favoriteDocuments length
  restorableSessions from sessionRestoreCount
pass cacheStats
pass blank page callbacks
pass existing callbacks:
  tags, global search, annotations, bookmarks, compare, cache settings
```

Modify the `SettingsWorkspace` render call:

```pseudocode
pass initialSection = settingsInitialSection
```

- [ ] **Step 9: Run targeted App tests**

Run:

```bash
bun run test -- src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 10: Commit Task 5**

Run:

```bash
git status --short
git add src/app/ReaderApp.tsx src/app/App.test.tsx
git commit -m "feat: wire home sidebar state"
```

Expected: commit succeeds and includes only Task 5 files.

---

### Task 6: Final Styling Pass And Focused Verification

**Files:**
- Modify if needed: `src/app/styles.css`
- Modify if needed: `src/home/HomeSidebar.tsx`
- Modify if needed: `src/home/HomeDashboard.tsx`

- [ ] **Step 1: Review sidebar CSS against prototype constraints**

Inspect `src/app/styles.css` and confirm:

```pseudocode
sidebar uses same width as current layout or prototype-compatible width
active row is full-width, light blue, and includes icon plus text highlight
count badges align right
cache card is pinned toward bottom of sidebar
cache card progress bar is blue
compact breakpoint does not create overlapping text
mobile breakpoint keeps existing sidebar-hidden behavior
```

- [ ] **Step 2: Make only necessary CSS adjustments**

If tests pass but CSS needs polishing, adjust only sidebar-related selectors:

```pseudocode
allowed selectors:
  home-sidebar
  home-nav
  home-nav-section
  home-nav-item
  home-cache-card
  home-blank-page
  related existing responsive sidebar selectors

do not alter:
  reader workspace
  top bar shortcuts
  global search panel
  unrelated settings/workspace styling
```

- [ ] **Step 3: Run focused frontend tests**

Run:

```bash
bun run test -- src/home/HomeSidebar.test.tsx src/home/HomeDashboard.test.tsx src/settings/SettingsWorkspace.test.tsx src/app/App.test.tsx src/persistence/persistenceApi.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run focused Rust tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml cache_stats
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6 only if files changed**

If Step 2 changed files, run:

```bash
git status --short
git add src/app/styles.css src/home/HomeSidebar.tsx src/home/HomeDashboard.tsx
git commit -m "style: polish home sidebar"
```

Expected: commit succeeds and includes only Task 6 styling files.

If Step 2 did not change files, do not create an empty commit.

---

## Final Verification

- [ ] **Step 1: Run all targeted verification**

Run:

```bash
bun run test -- src/home/HomeSidebar.test.tsx src/home/HomeDashboard.test.tsx src/settings/SettingsWorkspace.test.tsx src/app/App.test.tsx src/persistence/persistenceApi.test.ts
bun run typecheck
cargo test --manifest-path src-tauri/Cargo.toml cache_stats
```

Expected: all commands PASS.

- [ ] **Step 2: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: no uncommitted files if each task was committed. If there are uncommitted files, inspect them and commit only files belonging to the completed task.

- [ ] **Step 3: Completion checklist**

Confirm:

```pseudocode
SR-HOME-DIFF-007 through SR-HOME-DIFF-013 covered by HomeSidebar
SR-HOME-DIFF-014 through SR-HOME-DIFF-018 covered by cache card and cache settings entry
recent, favorite, restore counts come from local state or persistence
cache capacity and file count come from local cache stats command
unspecified entries are buttons and route to blank pages
existing explicit entries route to existing workspaces or global search
no existing migration file was modified
no browser or computer-control verification was used
project was not started automatically
```

## Self-Review Notes

- Spec coverage: all sidebar structure, count, selected-state, icon, cache-card, and cache-management requirements are mapped to Tasks 1 through 6.
- Latest override coverage: blank routing for unspecified entries is mapped to Tasks 4 and 5.
- Type consistency: plan uses `CacheStats`, `HomeSidebarPage`, and `SettingsSection` consistently.
- Scope control: plan does not add real pages for unspecified entries, cache cleanup, new migrations, new dependencies, or project startup.
