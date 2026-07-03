# SmartReader Home Main Content Design

Date: 2026-07-03

## Purpose

SmartReader's home main content should match the supplied desktop prototype more closely. The current page starts with a generic dashboard title, a button stack, a large drag area, one recent-session row, and a `重点文档` section. This design replaces that main content with the prototype's welcome banner, three-card quick start, session restore list, recent-files table, and favorite-files cards.

This is a style-first home-main-content change. Existing working actions should keep using their current flows. Entries whose backing feature is not implemented yet should route to the existing blank page or show a small local modal so users get feedback without pretending the feature is complete.

This scope does not start the app automatically and does not use browser or computer-control verification.

## Requirements Covered

- `SR-HOME-DIFF-019`: Add the welcome banner at the top of the home main content.
- `SR-HOME-DIFF-020`: Show the SmartReader book icon in a light-blue icon container.
- `SR-HOME-DIFF-021`: Show the exact welcome copy: `欢迎使用 SmartReader `, `本地优先 · 隐私安全 · 高效阅读`, and `所有文件和数据仅存储在您的设备上，完全掌控您的知识。`.
- `SR-HOME-DIFF-022`: Show a right-side local-safe-reading illustration using document, shield, and decorative elements.
- `SR-HOME-DIFF-023`: Make the welcome banner align horizontally with the main cards below.
- `SR-HOME-DIFF-024`: Replace the current quick-start button stack and large drop zone with the prototype three-card quick-start layout.
- `SR-HOME-DIFF-025`: First quick-start card opens local PDF files.
- `SR-HOME-DIFF-026`: Second quick-start card supports drag highlight and PDF drop.
- `SR-HOME-DIFF-027`: Third quick-start card represents folder selection and routes to the current fallback destination until folder import exists.
- `SR-HOME-DIFF-028`: Remove the separate large dashed drag area from the home page.
- `SR-HOME-DIFF-029`: Normalize quick-start card height, border radius, border, icon size, typography, and hover state.
- `SR-HOME-DIFF-030`: Rename and restructure the current recent-reading block as `恢复上次会话`.
- `SR-HOME-DIFF-031`: Add `清除记录` in the session-restore panel header, guarded by confirmation and fallback behavior.
- `SR-HOME-DIFF-032`: Show up to three session-restore records.
- `SR-HOME-DIFF-033`: Show a red PDF icon for each session row.
- `SR-HOME-DIFF-034`: Show file name and file path for each session row.
- `SR-HOME-DIFF-035`: Show last reading page information from local progress data.
- `SR-HOME-DIFF-036`: Show last reading time using available local metadata.
- `SR-HOME-DIFF-037`: Add a `继续阅读` button for each session row.
- `SR-HOME-DIFF-038`: Make the whole session row clickable, with the explicit button using the same reopen action.
- `SR-HOME-DIFF-039`: Add an independent `最近文件` module below session restore.
- `SR-HOME-DIFF-040`: Add `查看全部（数量）` for recent files.
- `SR-HOME-DIFF-041`: Use a table layout with `文件名`, `路径`, `上次打开`, `阅读进度`, and `操作`.
- `SR-HOME-DIFF-042`: Show a red PDF icon and file name in the file-name column.
- `SR-HOME-DIFF-043`: Show the containing path, truncated with the full value available as a title.
- `SR-HOME-DIFF-044`: Show last-opened date and time.
- `SR-HOME-DIFF-045`: Show reading percentage and a blue progress bar.
- `SR-HOME-DIFF-046`: Add a more menu with at least open, favorite toggle, locate file, and remove-from-recent actions.
- `SR-HOME-DIFF-047`: Limit home recent files to five rows by default.
- `SR-HOME-DIFF-048`: Rename `重点文档` to `收藏文件`.
- `SR-HOME-DIFF-049`: Add `查看全部（数量）` for favorites.
- `SR-HOME-DIFF-050`: Use a horizontal three-card favorite layout.
- `SR-HOME-DIFF-051`: Show a red PDF icon in favorite cards.
- `SR-HOME-DIFF-052`: Show favorite file name and path.
- `SR-HOME-DIFF-053`: Show current page information in each favorite card.
- `SR-HOME-DIFF-054`: Show a date in each favorite card when local metadata is available.
- `SR-HOME-DIFF-055`: Show an active yellow star button that can cancel favorite status.
- `SR-HOME-DIFF-056`: Keep a prototype-consistent empty state under the `收藏文件` title.

## Scope

In scope:

- Home main content layout and styling.
- New welcome banner component.
- Updating `HomeQuickStart` to a three-card layout.
- Updating session restore visuals and limiting display to three rows.
- Adding a recent-files table component limited to five rows.
- Updating favorite files to a three-card horizontal layout.
- Reusing existing local PDF open, browser picker fallback, recent reopen, favorite toggle, and sidebar blank-page routing.
- Adding a small local modal or inline feedback for actions that do not yet have real feature support.
- Focused tests for rendered structure and existing action wiring.

Out of scope:

- Implementing folder batch import.
- Implementing full recent-file management pages.
- Implementing persistent clear-history, locate-file, or remove-recent commands if no current API exists.
- Changing SQLite schema or adding Flyway-style migrations.
- Reworking the home top bar or left sidebar already covered by earlier specs.
- Changing reader rendering, PDF parsing, bookmarks, annotations, cache behavior, or desktop Open With behavior.
- Adding new dependencies or image assets.

## Current Code Boundary

The affected frontend boundary is:

- `src/home/HomeDashboard.tsx`
  - Owns the home content composition, shared hidden file input, sidebar blank-page routing props, and home-level callbacks.
- `src/home/HomeQuickStart.tsx`
  - Currently renders the quick-start heading, two active buttons, one disabled folder button, and a separate large drop area.
- `src/home/HomeRecentSessions.tsx`
  - Currently renders `最近阅读 / 继续上次会话` from `recentDocuments`.
- `src/home/HomeFavorites.tsx`
  - Currently renders `收藏 / 重点文档`.
- `src/home/HomeBlankPage.tsx`
  - Already provides blank pages for `recentFiles`, `favoriteFiles`, `sessionRestore`, `myDocuments`, `folders`, and `notes`.
- `src/home/HomeSidebar.tsx`
  - Already routes blank-page navigation items from the left sidebar.
- `src/library/recentFiles.ts`
  - Already maps persisted documents into recent-file display records.
- `src/persistence/persistenceApi.ts`
  - Provides `PersistedDocument` fields available to home modules.
- `src/favorites/favoriteModels.ts`
  - Provides `FavoriteDocument` fields available to favorites.
- `src/app/ReaderApp.tsx`
  - Owns `recentDocuments`, `favoriteDocuments`, `sessionRestoreCount`, PDF opening, recent reopening, favorite toggling, settings routing, and blank-page routing.
- `src/app/styles.css`
  - Owns the existing app-wide and home-page styles.

The design should stay inside these boundaries unless implementation discovers a directly related type or test helper that must be adjusted.

## Product Behavior

### Overall Home Main Layout

For the `home` sidebar page, the main content becomes a stacked primary column:

1. Welcome banner.
2. Quick-start module.
3. Restore-last-session module.
4. Recent-files module.
5. Favorite-files module.

The existing right-side `HomeStatusPanel` may remain present for now. It should not force the main cards to narrower widths than the prototype at common desktop sizes. If the current two-column layout causes the primary content to feel compressed, the implementation should adjust the grid width or spacing locally without redesigning the status panel content.

For non-home blank sidebar pages, the existing blank-page behavior remains.

### Welcome Banner

Add a new presentational component, for example `HomeWelcomeBanner`.

It renders as a full-width home card aligned with the modules below:

- Left icon block:
  - light-blue rounded container;
  - book icon using existing `lucide-react` iconography;
  - icon color consistent with `--sr-primary`.
- Text block:
  - title: `欢迎使用 SmartReader `;
  - subtitle: `本地优先 · 隐私安全 · 高效阅读`;
  - description: `所有文件和数据仅存储在您的设备上，完全掌控您的知识。`.
- Right illustration:
  - built from CSS boxes and `lucide-react` icons rather than a new image dependency;
  - includes a document panel, a security shield, and small decorative marks;
  - hidden or simplified on narrow widths if needed to avoid overlap.

The banner uses the existing neutral white card style, 8px radius, subtle border, and spacing consistent with surrounding home panels.

### Quick Start

`HomeQuickStart` changes from a title plus buttons plus separate large drop zone into one home panel with three equal cards:

1. `打开本地 PDF`
   - folder icon;
   - description: `浏览并打开本地 PDF 文件`;
   - click calls the existing native-open flow through `onOpenPdf`.

2. `拖拽到这里`
   - cloud upload icon;
   - description: `将 PDF 文件拖拽到此处打开`;
   - supports `dragover`, `dragleave`, and `drop` visual state on this card;
   - on PDF drop, calls the existing `handleDrop` flow from `useDocumentOpening` through a `HomeDashboard` callback.

3. `选择文件夹`
   - folder-plus icon;
   - description: `打开文件夹并批量导入 PDF`;
   - click routes to the existing `folders` blank page, because folder scanning is not implemented in this style-first iteration.

The large standalone dashed drop zone is removed. The middle card may use a dashed border to preserve the prototype's drop affordance without taking over the whole module.

All three cards share height, radius, border, icon container size, title font size, description font size, hover state, and focus state.

### Restore Last Session

`HomeRecentSessions` becomes the `恢复上次会话` module:

- Header:
  - title: `恢复上次会话`;
  - subtitle: `继续您上次阅读的内容`;
  - right action: `清除记录`.
- Rows:
  - show at most three entries from local recent/session-capable data;
  - each row has a red PDF icon, file name, directory path, progress text, last-opened time, and `继续阅读`;
  - both row click and button click call `onReopenDocument(document)`;
  - clicking the explicit button should stop propagation or otherwise avoid double-calling the reopen action.

Progress text should use available `PersistedDocument` fields:

- if `pageCount` exists and is greater than zero, render `上次阅读到 第 X / Y 页`;
- otherwise render `上次阅读到 第 X 页`.

Last-read time should use existing local metadata:

- prefer a persisted last-opened field if introduced by current code before implementation;
- otherwise use `modifiedAt` as the best available timestamp and label it with a compact date formatter;
- if no timestamp exists, show a muted fallback such as `时间未知`.

`清除记录` behavior:

- show a confirmation before acting;
- if no real clear-history API exists, close the confirmation and show a lightweight modal explaining that record clearing will be implemented with the full history-management page;
- do not fake a successful deletion in component state unless the data source actually changes.

### Recent Files

Add a new component, for example `HomeRecentFiles`.

It renders below session restore:

- Header:
  - title: `最近文件`;
  - right action: `查看全部（N）`;
  - click calls `onOpenRecentFiles`, which already routes to the `recentFiles` blank page.
- Table columns:
  - `文件名`;
  - `路径`;
  - `上次打开`;
  - `阅读进度`;
  - `操作`.
- Default row count:
  - show at most five documents.

Row details:

- `文件名` shows a red PDF icon and truncated file name.
- `路径` shows the containing directory when possible, truncated and available in `title`.
- `上次打开` uses a `YYYY/MM/DD HH:mm` formatter when a timestamp exists.
- `阅读进度` shows rounded percentage and a blue progress bar.
- `操作` shows a vertical three-dot menu.

More-menu behavior:

- `打开`: calls `onReopenDocument(document)`.
- `收藏` or `取消收藏`: calls `onToggleFavorite(document.documentKey, nextFavorite)`, using `favoriteDocuments` to decide current state.
- `定位文件`: if no locate-file command exists, show a local "功能待补充" fallback modal.
- `从最近记录移除`: if no remove-recent command exists, show a local "功能待补充" fallback modal.

The menu can be implemented as a small inline popover controlled by React state. It should close when another row menu opens. It should not require a new dependency.

### Favorite Files

`HomeFavorites` becomes the `收藏文件` module:

- Header:
  - title: `收藏文件`;
  - right action: `查看全部（N）`;
  - click calls `onOpenFavoriteFiles`, which already routes to the `favoriteFiles` blank page.
- Cards:
  - show up to three favorite documents;
  - horizontal grid on desktop;
  - each card shows a red PDF icon, file name, path, page label, date label, and active yellow star;
  - star click calls `onToggleFavorite(document.documentKey, false)`.

Because `FavoriteDocument` currently has no created/favorited timestamp, the date label should use available metadata only if the component receives it. If no date is available, use a neutral fallback that does not invent a date, such as `日期未知`.

The empty state remains, but it must be under the `收藏文件` title and should use prototype-consistent styling and copy, for example `暂无收藏文件` and `收藏文件后会显示在这里。`.

## Data Mapping

### PersistedDocument

Use the existing fields:

- `documentKey`: stable key for click actions and favorite toggling.
- `path`: full file path or `null`.
- `displayName`: file name.
- `fileSize`: currently not central to the prototype modules, but may remain available.
- `modifiedAt`: best available timestamp for last-opened style display if no better field exists.
- `pageCount`: page total.
- `lastPage`: current or last page.
- `progress`: number from `0` to `1`.
- `missing`: used to keep missing-file rows visible but visually muted or disabled where appropriate.

### FavoriteDocument

Use the existing fields:

- `documentKey`;
- `displayName`;
- `path`;
- `lastPage`;
- `progress`.

The design does not require changing this type for the style-first pass. A future full favorites page can add favorite timestamps if needed.

### Path Formatting

For file paths:

- file name uses `displayName`;
- directory path is derived from `path` by removing the last path segment when possible;
- if `path` is `null`, show `本地浏览器文件`;
- long paths use CSS truncation and `title` for the full path.

### Date Formatting

Use local helper functions in the relevant home module or a small shared home utility if duplication grows:

- session row time: compact relative-friendly output such as `今天 10:32`, `昨天 18:47`, or `YYYY/MM/DD HH:mm`;
- recent-files table: `YYYY/MM/DD HH:mm`;
- favorite cards: `YYYY/MM/DD` when a date exists.

Keep the formatter deterministic enough for tests by testing known ISO inputs or by testing fallback text where exact current date would be unstable.

## Interaction Fallbacks

For style-first actions without implemented support, use one of these two fallback patterns:

1. Route to an existing blank page when there is already a matching page id:
   - `查看全部（最近文件）` -> `recentFiles`;
   - `查看全部（收藏文件）` -> `favoriteFiles`;
   - `选择文件夹` -> `folders`.

2. Show a small local modal when the action is command-like and no current route exists:
   - `清除记录` after confirmation if no clear API exists;
   - `定位文件`;
   - `从最近记录移除`.

The fallback modal should be brief, local, and dismissible. It should not introduce a global notification system.

## Architecture

### Components

Add or update focused components:

- `src/home/HomeWelcomeBanner.tsx`
  - Presentational banner only.
- `src/home/HomeQuickStart.tsx`
  - Three quick-start cards and local drop-card highlight state.
- `src/home/HomeRecentSessions.tsx`
  - Session restore card list, clear action trigger, row click behavior.
- `src/home/HomeRecentFiles.tsx`
  - Recent-files table, menu state, action routing.
- `src/home/HomeFavorites.tsx`
  - Favorite-files card layout and empty state.
- `src/home/HomeDashboard.tsx`
  - Composes the modules and owns fallback modal state if shared across modules.

If the fallback modal is used by more than one module, keep it as a small local component under `src/home`, for example `HomeActionNotice.tsx`.

### State Ownership

`ReaderApp` remains the owner of application data and real navigation:

- recent documents;
- favorite documents;
- PDF open flow;
- recent reopen flow;
- favorite toggle flow;
- sidebar page routing;
- workspace routing.

Home content components stay presentational and callback-driven. They should not query persistence directly.

### Styling

Use existing CSS custom properties:

- `--sr-surface`;
- `--sr-surface-muted`;
- `--sr-border`;
- `--sr-text`;
- `--sr-text-muted`;
- `--sr-primary`;
- `--sr-danger`;
- `--sr-warning`;
- `--sr-radius`.

Keep card radii at 8px through `--sr-radius`. Do not introduce large decorative rounded cards, gradient orbs, or new one-off palette systems. Use restrained white surfaces, neutral borders, blue accents, red PDF icons, and yellow favorite stars.

The layout must avoid text overlap and should truncate long file names and paths. Fixed-format items such as cards, rows, icon buttons, progress bars, and menus should use stable dimensions so hover states and long text do not shift the page.

## Design Pattern Decision

No formal design pattern is needed for this iteration.

The problem is mostly presentational composition with existing callbacks. Strategy, Factory, Command, or Domain Service patterns would add abstractions without isolating real business-rule variation. The correct boundary is simple React components with typed props and small local helpers for formatting. This keeps the implementation consistent with the current SmartReader home code.

If a future implementation adds real recent-file commands such as locate, clear, and remove, those command behaviors can be centralized then. This style-first pass should not pre-build a command framework for features that are explicitly deferred.

## Error Handling

- Native PDF open failures keep the current browser-file-picker fallback.
- Dropping a non-PDF on the quick-start drop card should ignore the file or show a brief local unsupported-file message; it should not navigate away.
- Missing recent documents remain visible but should not claim they can be opened if the existing reopen flow cannot open them.
- Fallback modal actions must not mutate local state as if a command succeeded.
- Any menu or modal should be keyboard dismissible with an explicit close button or existing accessible button behavior.

## Testing

Targeted frontend tests should cover:

- Welcome banner renders the required text and icon/illustration landmarks.
- Quick start renders exactly three entry cards.
- `打开本地 PDF` calls the existing open callback.
- The browser picker fallback remains owned by `HomeDashboard`.
- The drop card has a drag-highlight state and forwards dropped PDF files through the existing drop/open path where practical.
- `选择文件夹` routes to `folders` blank page or opens the fallback notice.
- Restore-last-session renders at most three rows.
- Session rows and `继续阅读` call reopen once.
- `清除记录` requires confirmation and does not fake deletion when no API exists.
- Recent files renders at most five table rows and correct headers.
- Recent files `查看全部（N）` calls the existing recent-files navigation callback.
- Recent-files menu opens and routes implemented actions while fallback actions show the notice.
- Favorite files renders at most three cards under the `收藏文件` title.
- Favorite star calls `onToggleFavorite(documentKey, false)`.
- Favorite empty state no longer uses `重点文档` wording.

Recommended validation for the later implementation:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/home/HomeQuickStart.test.tsx
bun run typecheck
git diff --check
```

If CSS-only changes are significant, visual inspection should be done by the user in the running desktop app because this workflow explicitly avoids opening a browser or computer-control session.

## Acceptance Criteria

- The home main content visually follows the prototype structure: welcome banner, quick start, restore last session, recent files, favorite files.
- Existing working flows still work: open PDF, reopen recent document, toggle favorite, navigate to blank pages, and open existing workspaces.
- Unimplemented actions provide explicit fallback feedback or route to the matching blank page.
- No new dependency is added.
- No existing database migration is modified.
- The implementation remains scoped to home main content and related tests/styles.
