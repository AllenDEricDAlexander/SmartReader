# SmartReader Home Sidebar Design

Date: 2026-07-02

## Purpose

SmartReader's home page sidebar should match the supplied prototype more closely. The current sidebar only exposes `首页`, `标签管理`, and `设置`; this design expands it into the prototype's grouped left navigation and adds the local cache card at the bottom of the sidebar.

This scope is intentionally limited to the home left sidebar. It does not redesign the home content area, top bar, reader workspace, settings layout, or any unrelated feature surface.

## Requirements Covered

- `SR-HOME-DIFF-007`: Replace the simplified sidebar navigation with the prototype's complete grouped navigation.
- `SR-HOME-DIFF-008`: Add the `导航` group with `首页`, `最近文件`, `收藏文件`, and `会话恢复`.
- `SR-HOME-DIFF-009`: Show local count badges for `最近文件`, `收藏文件`, and `会话恢复`.
- `SR-HOME-DIFF-010`: Add the `知识库` group with `我的文献`, `文件夹`, `标签管理`, and `笔记管理`.
- `SR-HOME-DIFF-011`: Add the `工具` group with `全文搜索`, `批注管理`, `书签管理`, and `对比阅读`.
- `SR-HOME-DIFF-012`: Match the prototype selected state: full-row light blue background, blue icon, and blue text.
- `SR-HOME-DIFF-013`: Add linear icons for the sidebar navigation items using the existing `lucide-react` dependency.
- `SR-HOME-DIFF-014`: Add the local cache card at the bottom of the sidebar.
- `SR-HOME-DIFF-015`: Show cache used capacity and total capacity.
- `SR-HOME-DIFF-016`: Show a blue cache usage progress bar.
- `SR-HOME-DIFF-017`: Show the local cached file count.
- `SR-HOME-DIFF-018`: Add a `管理缓存` action that opens cache management.

## Scope

In scope:

- Home sidebar component extraction and grouped navigation rendering.
- Visual styling for grouped labels, full-row selected state, icons, count badges, and the bottom cache card.
- Reusing existing local workspaces where a navigation item already has an implemented destination.
- Adding a local persistence statistic for cache usage so the cache card is backed by local data.
- Adding focused tests for sidebar structure, statistics, cache card rendering, and actionable navigation items.

Out of scope:

- Redesigning the home main area or right-side cards.
- Changing the top bar.
- Building full pages for `最近文件`, `收藏文件`, `会话恢复`, `我的文献`, `文件夹`, or `笔记管理`.
- Implementing disk cache cleanup behavior.
- Implementing a new persistent PDF cache writer.
- Adding cloud sync, AI, RAG, or document library features.

## Current Code Boundary

The affected frontend boundary is:

- `src/home/HomeDashboard.tsx`, which currently renders the sidebar inline.
- `src/app/ReaderApp.tsx`, which owns recent documents, favorite documents, workspace switching, session restore, and persistence access.
- `src/settings/SettingsWorkspace.tsx`, which currently defaults to the shortcuts settings section.
- `src/settings/CacheSettings.tsx`, which already presents cache-related settings content.
- `src/persistence/persistenceApi.ts`, which provides typed calls into the Tauri persistence layer.
- `src/app/appTypes.ts`, which defines supported workspace states.
- `src/app/styles.css`, which contains the home sidebar styles.

The affected Tauri boundary is:

- `src-tauri/src/db.rs`, which already has the `cache_entries` table schema available through migration `002_reader_core_completion`.
- `src-tauri/src/lib.rs`, which registers Tauri commands.

No existing migration file should be modified. This design does not require a schema change because `cache_entries` already contains the fields needed for usage statistics.

## Product Behavior

### Sidebar Structure

The sidebar keeps the SmartReader brand lockup at the top, then renders three grouped sections:

1. `导航`
   - `首页`
   - `最近文件`
   - `收藏文件`
   - `会话恢复`

2. `知识库`
   - `我的文献`
   - `文件夹`
   - `标签管理`
   - `笔记管理`

3. `工具`
   - `全文搜索`
   - `批注管理`
   - `书签管理`
   - `对比阅读`

The sidebar bottom renders a `本地缓存` card.

### Navigation Item Visuals

Every item uses one row with:

- a left linear icon;
- a text label;
- an optional right-aligned count badge.

The selected item is `首页` on the home dashboard. Its active state uses:

- full-row light blue background;
- subtle blue border;
- blue icon;
- blue label;
- stronger text weight.

Inactive items remain transparent with neutral text and icon color. Hover states may use a very light blue background consistent with the existing project palette.

The icon mapping uses `lucide-react`, which is already in the project:

- `首页`: house icon.
- `最近文件`: clock icon.
- `收藏文件`: star icon.
- `会话恢复`: history or rotate-back icon.
- `我的文献`: file-text or library-style icon.
- `文件夹`: folder icon.
- `标签管理`: tag icon.
- `笔记管理`: notebook or note icon.
- `全文搜索`: search icon.
- `批注管理`: edit or pencil icon.
- `书签管理`: bookmark icon.
- `对比阅读`: split-view icon.

### Counts

Counts are local and read from current application state or local persistence:

- `最近文件`: `recentDocuments.length`.
- `收藏文件`: `favoriteDocuments.length`.
- `会话恢复`: number of restorable tabs in `loadReaderSession()`.

If session restore count loading fails, the sidebar should show `0` rather than blocking the home page.

### Click Behavior

Existing implemented destinations should be wired:

- `首页`: keeps the user on the home dashboard.
- `标签管理`: opens the existing tag manager workspace.
- `全文搜索`: opens the existing global search panel.
- `批注管理`: opens the existing annotation manager workspace.
- `书签管理`: opens the existing bookmark manager workspace.
- `对比阅读`: opens the existing compare workspace.
- `管理缓存`: opens the settings workspace directly on its cache section.

Navigation items without a current implemented workspace should remain low-risk:

- `最近文件`
- `收藏文件`
- `会话恢复`
- `我的文献`
- `文件夹`
- `笔记管理`

For this iteration, clicking those items does not create interim pages or change the active workspace. They render as complete prototype navigation rows, but they do not claim a destination that does not exist yet. Tests should cover the items' presence and the wired actions that already have valid destinations.

### Local Cache Card

The cache card appears pinned to the lower part of the sidebar. It shows:

- title: `本地缓存`;
- right-side capacity text such as `1.24 GB / 5 GB`;
- a blue progress bar equal to `usedBytes / totalBytes`, clamped to `0%..100%`;
- text: `已缓存 N 个文件`;
- a `管理缓存` button.

The total capacity should be `5 GB` for this design, matching the prototype. The used capacity and file count come from local cache statistics.

If cache statistics fail to load, the card should fall back to:

- `0 B / 5 GB`;
- `0%` progress;
- `已缓存 0 个文件`.

The failure should not prevent the home dashboard from rendering.

## Architecture

### Components

Add a focused home sidebar component:

- `src/home/HomeSidebar.tsx`
  - Owns grouped navigation rendering and the cache card.
  - Receives counts, cache stats, and action callbacks through props.
  - Does not query persistence directly.
  - Does not own workspace switching.

`HomeDashboard` keeps the hidden file input and main home layout, but delegates the sidebar markup to `HomeSidebar`.

### Types

Add frontend cache stats types to the persistence boundary:

```ts
export type CacheStats = {
  usedBytes: number;
  totalBytes: number;
  fileCount: number;
};
```

Extend `PersistenceApi` with:

```ts
loadCacheStats(): Promise<CacheStats>;
```

The API name should follow the final local naming convention if the surrounding code suggests a better verb, but it should stay narrow and read-only.

### ReaderApp State

`ReaderApp` owns:

- `sessionRestoreCount`;
- `cacheStats`.

On startup, it should:

- load recent documents through the existing session restore flow;
- load favorite documents through the existing effect;
- load session restore count from `persistence.loadReaderSession()`;
- load cache stats from `persistence.loadCacheStats()`.

It then passes:

- recent count;
- favorite count;
- session restore count;
- cache stats;
- navigation callbacks;
- cache management callback;

to `HomeDashboard`, which passes them to `HomeSidebar`.

If startup already calls `loadReaderSession()` for restore behavior, the implementation should avoid unnecessary duplicated state updates where practical, but correctness and clarity matter more than collapsing calls into a complex shared loader.

### Cache Statistics

Add a read-only Tauri command backed by the existing `cache_entries` table:

- `usedBytes`: `COALESCE(SUM(file_size), 0)`.
- `fileCount`: `COUNT(*)`.
- `totalBytes`: `5 * 1024 * 1024 * 1024`.

This command does not change schema and does not write to disk. It reports the current persisted cache index. If stale cache rows exist, cleanup is outside this task.

### Settings Cache Entry

`管理缓存` should open settings directly on the cache section. Add a minimal optional initial section prop to `SettingsWorkspace`, for example:

```ts
initialSection?: SettingsSection;
```

`ReaderApp` can keep a small `settingsInitialSection` state. Normal settings entry opens the default section; cache management sets this state to `cache` before opening settings.

This is a narrow adjustment to support a real cache management entry without redesigning the settings workspace.

## Data Flow

Home render flow:

1. `ReaderApp` loads local document, favorite, restore-session, and cache-stat state.
2. `ReaderApp` passes statistics and callbacks into `HomeDashboard`.
3. `HomeDashboard` delegates sidebar rendering to `HomeSidebar`.
4. `HomeSidebar` displays groups, badges, active state, and cache usage.
5. Clicks on implemented entries call `ReaderApp` callbacks and route to existing local workspaces.

Cache management flow:

1. User clicks `管理缓存`.
2. `HomeSidebar` calls `onOpenCacheSettings`.
3. `ReaderApp` sets settings initial section to `cache` and opens the settings workspace.
4. `SettingsWorkspace` initializes to the cache section.

## Error Handling

- Recent documents already follow the existing load behavior.
- Favorite document load failure keeps the current fallback behavior and should result in count `0`.
- Session restore count load failure results in count `0`.
- Cache stats load failure results in zero usage stats.
- Navigation callbacks for existing workspaces should not throw synchronously; if persistence-backed manager data fails to load, the existing manager workspace error handling should display the error.

## Testing

Frontend targeted tests:

- `HomeDashboard` or `HomeSidebar` renders all three groups and all required entries.
- `最近文件`, `收藏文件`, and `会话恢复` render their count badges.
- `首页` renders with the active class and full-row active semantics.
- `全文搜索`, `标签管理`, `批注管理`, `书签管理`, `对比阅读`, and `管理缓存` call the expected callbacks.
- The cache card formats bytes, clamps progress, and shows file count.
- `ReaderApp` opens settings on the cache section when `管理缓存` is clicked.

Persistence/API tests:

- TypeScript persistence API invokes the new command name.
- Rust database test verifies cache stats from an empty database.
- Rust database test verifies `usedBytes` and `fileCount` after inserting cache entries.

Validation commands should stay targeted first:

- `bun run test -- HomeDashboard HomeSidebar App persistenceApi`
- `bun run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml cache`

The exact test filters may be adjusted to match Vitest and Cargo filter behavior.

## Design Pattern Consideration

No formal design pattern is needed for this task.

The navigation model is stable grouped data plus callback mapping. A Strategy, Factory, or Command abstraction would add layers without reducing meaningful complexity. A direct configuration array inside `HomeSidebar` or near it is clearer and consistent with the current project style.

The only boundary extraction is component extraction: `HomeSidebar` separates sidebar presentation from the broader `HomeDashboard` layout. That improves readability while keeping the flow direct and easy to test.
