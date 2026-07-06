# SmartReader Recent Files Workspace Design

Date: 2026-07-06

## Purpose

SmartReader's home sidebar already exposes `最近文件`, and the home main content has a compact `最近文件` card with `查看全部（N）`. The target behavior is to make that destination a real recent-file management page instead of the current blank placeholder.

This design adds a focused recent-files workspace inside the existing home shell. It should reuse the current local recent-document data and current document-opening behavior, while adding full-list browsing, sorting, filtering, keyword search, and list/card display modes.

This scope is design-only until approved. It does not start the app automatically and does not use browser or computer-control verification.

## Requirements Covered

- `SR-RECENT-001`: Clicking the sidebar `最近文件` item should show a concrete recent-files page.
- `SR-RECENT-002`: Clicking the home card `查看全部（N）` should show the same recent-files page.
- `SR-RECENT-003`: The recent-files page should display all loaded recent documents, not only the home card's first five rows.
- `SR-RECENT-004`: The page should support keyword search over available local metadata.
- `SR-RECENT-005`: The page should support sorting.
- `SR-RECENT-006`: The page should support filtering.
- `SR-RECENT-007`: The page should support list and card display modes.
- `SR-RECENT-008`: The page should keep existing continue-reading behavior.
- `SR-RECENT-009`: The page should keep existing favorite toggle behavior.
- `SR-RECENT-010`: The page should keep current fallback behavior for unsupported locate/remove actions until those backing features exist.
- `SR-RECENT-011`: The page should provide clear empty states for no records and no filtered results.
- `SR-RECENT-012`: The page should stay consistent with the current home visual system and code style.

## Scope

In scope:

- A new recent-files workspace component rendered when `activeSidebarPage === 'recentFiles'`.
- Search, sort, filter, list view, and card view based on the existing `PersistedDocument` and favorite state.
- Reusing `onReopenRecentDocument`, `onToggleFavorite`, `onLocateFile`, and `onRemoveRecent` style callbacks.
- Focused tests for routing, rendering, derived list behavior, empty states, and action wiring.
- CSS additions that follow the existing home panel, table, button, chip, and responsive styles.

Out of scope:

- Real file-system reveal support if the current platform layer does not already expose it.
- Real deletion from persistent recent history if the current persistence API does not already expose it.
- New persistence schema, database migration, or Tauri command.
- New routing library or global state layer.
- Opening the app automatically for runtime testing.

## Existing Context

Relevant current files:

- `src/home/HomeDashboard.tsx` owns the home shell and receives `activeSidebarPage`.
- `src/home/HomeBlankPage.tsx` currently treats `recentFiles` as a blank placeholder page.
- `src/home/HomeRecentFiles.tsx` renders the compact home card and limits display to five documents.
- `src/home/HomeSidebar.tsx` already includes the `recentFiles` navigation item.
- `src/app/ReaderApp.tsx` owns sidebar page state and passes callbacks into `HomeDashboard`.
- `src/persistence/persistenceApi.ts` defines `PersistedDocument` fields used by home surfaces.
- `src/home/homeDisplayUtils.ts` already formats time, progress, and directory paths.

The new workspace should be a sibling to the compact home card rather than replacing it. The home card stays optimized for the dashboard summary; the workspace owns full-list management.

## Design Decision

Use a new `HomeRecentFilesWorkspace` component.

Why this fits:

- The dashboard card and the full management page have different density and controls.
- A separate component keeps `HomeRecentFiles` small and avoids mode-heavy conditional rendering.
- The existing home shell already routes sidebar pages by `activeSidebarPage`, so no new router is needed.
- The component can derive filtered/sorted data locally from props without changing persistence.

Rejected alternatives:

- Extending `HomeRecentFiles` with a `variant` prop was rejected because search, filters, sort controls, and card view would make the summary card harder to maintain.
- Adding a new app-level route was rejected because current home navigation is state-based and this feature does not require a URL/router boundary.
- Introducing Strategy or Factory patterns was rejected because sorting and filtering are small local derivations. Direct typed helpers and `useMemo` are clearer and match project style.

## UX Structure

The recent-files workspace should render inside the existing home content area.

Top area:

- Section eyebrow: `文档管理`.
- Title: `最近文件`.
- Description: `查看、筛选并继续阅读最近打开过的本地 PDF。`.
- Count summary: total recent files and current filtered result count.

Toolbar:

- Search input placeholder: `搜索文件名或路径...`.
- Sort select with options:
  - `最近打开优先` default.
  - `文件名 A-Z`.
  - `阅读进度高到低`.
  - `阅读进度低到高`.
- Progress filter with options:
  - `全部进度` default.
  - `未开始` for progress at 0 or missing.
  - `阅读中` for progress greater than 0 and less than 1.
  - `已读完` for progress at 1 or above.
- Favorite filter with options:
  - `全部文件` default.
  - `已收藏`.
  - `未收藏`.
- View toggle buttons:
  - `列表视图` default.
  - `卡片视图`.
- Clear filters button, visible or enabled when any filter/search differs from defaults.

List view:

- Columns: file name, path, last opened, reading progress, favorite state, action.
- Each row shows a PDF icon, display name, containing path, formatted opened time, percentage/progress bar, and actions.
- Primary action is `继续阅读`.
- Secondary menu mirrors existing recent-file card behavior: open, favorite toggle, locate file, remove from recent.

Card view:

- Responsive grid of document cards.
- Each card shows PDF icon, display name, path, last opened time, progress bar, current page summary when available, favorite toggle, and `继续阅读`.
- The card itself may be clickable only if it does not conflict with nested button semantics. Prefer explicit `继续阅读` as the reliable activation target.

Empty states:

- No recent documents: show `暂无最近文件` and guide users to `打开文件`.
- Search or filters produce no results: show `没有匹配的最近文件` and offer `清除筛选`.

## Data Flow

`ReaderApp` continues to provide `recentDocuments` and `favoriteDocuments` to `HomeDashboard`.

`HomeDashboard` derives `favoriteDocumentKeys` once, as it already does, and passes these into `HomeRecentFilesWorkspace`:

- `documents: PersistedDocument[]`
- `favoriteDocumentKeys: Set<string>`
- `onReopenDocument(document)`
- `onToggleFavorite(documentKey, favorite)`
- `onLocateFile(document)`
- `onRemoveRecent(document)`
- `onOpenPdf()` for the no-record empty state

The workspace owns UI-only state:

- `query`
- `sortMode`
- `progressFilter`
- `favoriteFilter`
- `viewMode`
- `openMenuKey` if the menu logic is kept local

Derived results should be calculated with `useMemo` from documents plus UI state. The original `documents` array must not be mutated.

## Filtering and Sorting Rules

Search matches:

- `displayName`
- `path` when available
- `documentKey` as a fallback

Progress buckets:

- `未开始`: missing progress or progress value less than or equal to 0.
- `阅读中`: progress greater than 0 and less than 1.
- `已读完`: progress greater than or equal to 1.

Sorting:

- `最近打开优先`: descending by available last-opened timestamp. Missing timestamps sort after known timestamps.
- `文件名 A-Z`: locale-aware comparison by `displayName`.
- `阅读进度高到低`: numeric progress descending; missing progress treated as 0.
- `阅读进度低到高`: numeric progress ascending; missing progress treated as 0.

Tie-breaker:

- Use `displayName` ascending for deterministic display.

## Error Handling and Fallbacks

Opening recent files:

- Delegate to `onReopenDocument` and preserve current error behavior owned by `ReaderApp`.
- The workspace should not invent a second error surface unless the callback throws synchronously. If a synchronous throw occurs, it can be ignored only if the existing parent already handles open failure notices. Prefer the same callback wrapping style used in existing home components.

Unsupported actions:

- `定位文件` keeps the current notice fallback until a platform reveal command is implemented.
- `从最近记录移除` keeps the current notice fallback until persistence removal is implemented.
- The UI can expose the actions because the current summary card already exposes them, but it must not claim that the operation succeeded.

Filtering:

- Invalid or empty search input simply produces normal no-result or full-result states.
- Clearing filters resets query, sort, progress filter, favorite filter, and view mode only if the chosen behavior is explicitly labelled. Recommended behavior: clear search/filters but leave view mode unchanged.

## Accessibility and Keyboard Behavior

- The workspace section should have a stable accessible heading.
- Search input needs a visible or accessible label.
- Sort/filter controls should be native `select` elements unless the project already has a custom accessible pattern.
- View toggle buttons should expose pressed state with `aria-pressed`.
- Menus should follow the existing `HomeRecentFiles` keyboard behavior: focus first menu item when opened, Escape closes and returns focus, arrow keys cycle items.
- Card and list actions should maintain button-sized click targets consistent with the current home UI.

## Responsive Behavior

- On wide screens, list view uses a table-like layout similar to the current recent-files table.
- On medium screens, toolbar controls wrap into multiple rows.
- On narrow screens, list view can degrade to the existing mobile stacked table style, and card view becomes a single-column grid.
- The workspace should not widen the home shell or break the right assist rail layout.

## Testing Plan

Target tests should be added or updated in `src/home/HomeDashboard.test.tsx` and, if the component grows enough, a dedicated `src/home/HomeRecentFilesWorkspace.test.tsx`.

Recommended focused coverage:

- `recentFiles` sidebar page renders the concrete workspace instead of `HomeBlankPage`.
- Home card `查看全部（N）` routes to the workspace through existing callback wiring.
- The workspace displays all provided recent documents.
- Search filters by display name and path.
- Progress filter handles no progress, in-progress, and completed documents.
- Favorite filter uses `favoriteDocumentKeys`.
- Sort modes produce deterministic order.
- List/card view toggle changes the visible layout without losing derived results.
- Continue reading calls `onReopenDocument` with the selected document.
- Favorite toggle calls `onToggleFavorite` with the expected next favorite state.
- Empty and no-result states render the correct copy.

Validation commands:

- `npm test -- HomeDashboard`
- `npm test -- HomeRecentFilesWorkspace` if a dedicated test file is added
- `npm run typecheck`

Do not start the project automatically. Runtime testing remains user-initiated.

## Implementation Notes for Later Plan

Likely files to touch during implementation:

- `src/home/HomeRecentFilesWorkspace.tsx`
- `src/home/HomeDashboard.tsx`
- `src/home/HomeBlankPage.tsx`
- `src/home/HomeDashboard.test.tsx`
- `src/home/HomeRecentFilesWorkspace.test.tsx` if separate tests are clearer
- `src/app/styles.css`

Keep the implementation narrow:

- Do not change persistence APIs unless remove-from-recent is explicitly promoted from placeholder to real feature.
- Do not change reader opening flow.
- Do not refactor unrelated home sections.
- Do not introduce new dependencies.
