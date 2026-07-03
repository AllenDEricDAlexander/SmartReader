# SmartReader Home Completion Design

Date: 2026-07-03

## Purpose

SmartReader's home page should finish the remaining prototype gap in one coherent pass. The current implementation already has the home top bar, left navigation, welcome banner, quick start, session restore, recent files, and favorites, but the right information rail is still temporary, the bottom status bar is missing, and some interactions and responsive rules are not yet explicit.

This design completes `SR-HOME-DIFF-057` through `SR-HOME-DIFF-113` by turning the home page into a local-first desktop PDF reader shell: fixed top bar, left navigation, scrollable main content, fixed-width assist rail, and fixed bottom status bar. The work should reuse existing reader, settings, cache, search, bookmark, annotation, import, and workspace flows instead of duplicating those systems inside the home page.

## Confirmed Direction

The selected approach is "complete the prototype home page once, but reuse or downgrade duplicated deep features." The home page should look and behave like the prototype entry point, while system-level or already-owned functions stay in their existing feature areas.

Rejected alternatives:

- Build every linked feature fully from the home page. This would pull in file association setup, background task orchestration, recursive folder import, and standalone help pages, which is broader than a home completion pass.
- Make only a visual mock. This would reduce screenshot differences quickly but leave dead or misleading controls.

## Requirements Covered

- `SR-HOME-DIFF-057` to `SR-HOME-DIFF-063`: replace the temporary right-side workbench card with a prototype `快速上手` card.
- `SR-HOME-DIFF-064` to `SR-HOME-DIFF-069`: add the `桌面集成` card and route supported actions.
- `SR-HOME-DIFF-070` to `SR-HOME-DIFF-074`: add the SmartReader version information card.
- `SR-HOME-DIFF-075` to `SR-HOME-DIFF-076`: remove the current `工作台状态` and `阅读流程` temporary cards from the home page.
- `SR-HOME-DIFF-077` to `SR-HOME-DIFF-081`: add the fixed bottom status bar.
- `SR-HOME-DIFF-082` to `SR-HOME-DIFF-087`: finalize the desktop three-area home layout and remove remaining dashboard-style heading behavior.
- `SR-HOME-DIFF-088` to `SR-HOME-DIFF-094`: align visual style, density, icons, buttons, tables, and empty-state handling with the prototype.
- `SR-HOME-DIFF-095` to `SR-HOME-DIFF-102`: use local counts, progress, timestamps, cache stats, and version information.
- `SR-HOME-DIFF-103` to `SR-HOME-DIFF-109`: normalize home entry interactions and route consistency.
- `SR-HOME-DIFF-110` to `SR-HOME-DIFF-113`: define responsive behavior for wide, medium, and narrow windows.

## Scope

In scope:

- Replace `HomeStatusPanel` with a right-side home assist rail.
- Add a bottom home status bar.
- Adjust the home shell grid so top and bottom bars remain fixed while the main home body scrolls correctly.
- Preserve the current main content order: welcome banner, quick start, session restore, recent files, favorites.
- Reuse existing data: recent documents, favorites, restorable session count, cache stats, bookmark and annotation workspaces, global search, settings sections, and reader-opening callbacks.
- Add lightweight app metadata and home task status props when useful.
- Add focused tests for new right rail, status bar, routing callbacks, removed temporary cards, responsive-safe markup, and key home interactions.

Out of scope:

- Creating a new help center.
- Implementing a new background task system.
- Implementing a new recursive folder import flow from the home page.
- Implementing a complete system-level "set SmartReader as default PDF app" flow.
- Creating full list-management pages for recent files, favorites, or session restore if those pages are still blank.
- Changing reader PDF rendering, annotation persistence, bookmark persistence, or cache storage schemas.
- Adding migrations or modifying existing migration files.
- Adding new dependencies or starting the app automatically.
- Browser or computer-control verification.

## Current Code Boundary

The affected frontend boundary is:

- `src/home/HomeDashboard.tsx`
  - Home composition, hidden file input bridge, home notices, and top/sidebar/main/right-rail/status-bar callbacks.
- `src/home/HomeStatusPanel.tsx`
  - Temporary right rail to replace or rename.
- `src/home/HomeTopBar.tsx`
  - Existing top action routing to keep consistent with sidebar and right rail actions.
- `src/home/HomeSidebar.tsx`
  - Existing grouped navigation, counts, and cache summary.
- `src/home/HomeQuickStart.tsx`
  - Existing open/drop/folder entry behavior and drag feedback.
- `src/home/HomeRecentSessions.tsx`
  - Session restore list and clear-record entry.
- `src/home/HomeRecentFiles.tsx`
  - Recent file table, progress, and action menu.
- `src/home/HomeFavorites.tsx`
  - Favorite cards and empty state.
- `src/home/HomeActionNotice.tsx`
  - Reusable modal notice and confirmation surface.
- `src/app/ReaderApp.tsx`
  - Data owner for documents, favorites, cache stats, workspace routing, settings sections, and open/reopen flows.
- `src/app/styles.css`
  - Home layout, responsive, and visual styling.
- `src/persistence/persistenceApi.ts`
  - Existing cache stats, recent documents, favorites, bookmarks, annotations, and session APIs.
- `src-tauri/tauri.conf.json` and `package.json`
  - Current app version sources.

The design should stay inside these boundaries unless implementation finds a directly related type, test fixture, or helper that must be adjusted.

## Product Decisions and Downgrades

The home page should not duplicate feature ownership. These items are intentionally reused or downgraded:

- `更多技巧 >` opens shortcut settings or the same shortcut overview destination. It does not create a standalone help center.
- `快捷键总览` opens the existing shortcut settings section.
- `设置关联` uses a future bridge only if one exists. Without that capability, it shows a clear unsupported-environment notice and may route the user to desktop integration settings.
- `管理缓存` opens the existing cache settings section.
- `选择文件夹` routes to the folder/import destination. It does not implement recursive folder scanning in this pass.
- `查看全部` routes to the existing side navigation pages or placeholders.
- Home zoom is a home view indicator/control only. PDF document zoom remains owned by the reader workspace status bar and viewer controller.
- Task status starts with lightweight `idle/opening/importing/caching/error` states. No new background task queue is introduced.

## Current Gap Audit

The current implementation already completed earlier home work, so this spec focuses on what remains unfinished or ambiguous:

| Area | Current state | Required final state |
|---|---|---|
| Right rail | `HomeStatusPanel` renders `工作台状态` and `阅读流程`. | Replace with `快速上手`, `桌面集成`, and version card. |
| Bottom bar | No home bottom status bar. | Add a fixed `HomeStatusBar` with local mode, view scale, zoom entry, and task status. |
| Shell grid | `home-dashboard-shell` has top bar plus body only. `home-content` owns primary + right rail. | Shell has top bar, body, and bottom bar. Body owns sidebar + scroll area. Scroll behavior is explicit. |
| Right rail responsiveness | At `max-width: 1280px`, `.home-content` drops to one column and `.home-status` becomes a two-column row. | Wide screens must keep three areas visible. Medium screens may move assist rail below main content. |
| Quick tips | Existing right rail tips are generic reading-flow hints. | Four prototype quick tips with shortcut capsules and click behaviors. |
| Desktop integration | Sidebar has cache card; no right-side desktop integration card. | Add Open With, file association, and local cache entries. |
| Version display | No version card. | Add app metadata card with update-check fallback. |
| Non-PDF drop | `handleDrop` ignores non-PDF files silently. | Home drop path should show `仅支持 PDF 文件`. |
| Clear records | `HomeDashboard` currently confirms, then shows "功能待补充". | Keep this honest fallback unless a real session-clear API is added in scope. |
| Favorites click | Favorite cards can cancel favorite status but do not open documents. | Favorite cards should open documents when a matching recent/desktop path exists; otherwise show a notice. |
| Responsive recent files | Recent files are table-only with horizontal overflow. | Narrow windows should show a card-list representation with the same fields. |

## Requirement Matrix

### Right Assist Rail

| Requirement | Design decision | Data / callback | Acceptance |
|---|---|---|---|
| `SR-HOME-DIFF-057` | Replace `工作台状态` with `快速上手`. | `HomeAssistPanel` renders `HomeQuickTipsCard`. | `工作台状态` is absent; `快速上手` is visible. |
| `SR-HOME-DIFF-058` | Add `更多技巧 >` to the quick tips card header. | `onOpenShortcutSettings`. | Clicking opens shortcut settings or shows the same shortcut overview destination. |
| `SR-HOME-DIFF-059` | Add search quick tip. | `onOpenGlobalSearch`. | Row contains title, description, `⌘K`, and opens global search. |
| `SR-HOME-DIFF-060` | Add bookmark quick tip. | `onOpenBookmarks` or notice callback. | Row contains title, description, `⌘D`, and gives a real route or guide. |
| `SR-HOME-DIFF-061` | Add annotation quick tip. | `onOpenAnnotations` or notice callback. | Row contains title, description, `⌘E`, and gives a real route or guide. |
| `SR-HOME-DIFF-062` | Add shortcut overview quick tip. | `onOpenShortcutSettings`. | Row contains title, description, `⌘/`, and opens shortcut settings. |
| `SR-HOME-DIFF-063` | Standardize quick tip row structure. | Config array in `HomeQuickTipsCard`. | Every row has icon tile, text block, and shortcut capsule. |
| `SR-HOME-DIFF-064` | Add desktop integration card. | `HomeDesktopIntegrationCard`. | Card appears below quick tips. |
| `SR-HOME-DIFF-065` | Show Open With support. | Static row. | Row text matches prototype copy. |
| `SR-HOME-DIFF-066` | Show file association state/action. | `onSetupFileAssociation`. | `设置关联` button exists. |
| `SR-HOME-DIFF-067` | Trigger association flow if available. | Optional bridge callback or fallback notice. | No dead click; unsupported environment explains limitation. |
| `SR-HOME-DIFF-068` | Show local cache entry. | `onOpenCacheManagement`. | `管理缓存` button exists. |
| `SR-HOME-DIFF-069` | Manage cache routes to cache management. | `openSettingsWorkspace('cache')`. | Clicking opens cache settings section. |
| `SR-HOME-DIFF-070` | Add version card. | `HomeVersionCard`. | Version card visible at rail bottom. |
| `SR-HOME-DIFF-071` | Show icon and app name. | Static app identity. | Icon and `SmartReader` visible. |
| `SR-HOME-DIFF-072` | Show version/build. | `appVersion` prop with fallback. | Text never renders blank. |
| `SR-HOME-DIFF-073` | Show positioning copy. | Static copy. | Copy matches prototype. |
| `SR-HOME-DIFF-074` | Add update check entry. | `onCheckUpdates`. | Clicking shows real result or not-yet-connected notice. |
| `SR-HOME-DIFF-075` | Remove workbench status card. | Replace `HomeStatusPanel`. | Old heading absent in tests. |
| `SR-HOME-DIFF-076` | Remove reading-flow card. | Replace `HomeStatusPanel`. | Old heading absent in tests. |

### Layout, Visual, Data, and Interaction

| Requirement | Design decision | Acceptance |
|---|---|---|
| `SR-HOME-DIFF-077` | Add `HomeStatusBar` as the bottom shell row. | Bottom status bar exists on home workspace. |
| `SR-HOME-DIFF-078` | Left status group shows local mode and local storage copy. | Green dot, `本地模式`, `所有数据保存在本地`, info icon are visible. |
| `SR-HOME-DIFF-079` | Right status group shows view scale. | Default `125%` or supplied view scale is visible. |
| `SR-HOME-DIFF-080` | Add zoom/view-control icon entry. | Icon button exists and has an accessible label. |
| `SR-HOME-DIFF-081` | Add task status. | `无任务运行中` renders for idle. |
| `SR-HOME-DIFF-082` | Finalize top + left + main + right + bottom shell. | Wide screen CSS keeps all areas. |
| `SR-HOME-DIFF-083` | Keep sidebar wide enough for grouped nav and cache. | Sidebar width is stable and not narrower than the current 232px. |
| `SR-HOME-DIFF-084` | Main content scrolls vertically. | Top/bottom bars do not scroll away. |
| `SR-HOME-DIFF-085` | Right rail fixed width on wide screens. | Assist rail width around 320px and not compressed by table content. |
| `SR-HOME-DIFF-086` | Unify card spacing. | Home cards use one spacing scale, generally 16px. |
| `SR-HOME-DIFF-087` | Keep old standalone dashboard title removed. | `阅读仪表盘` remains absent. |
| `SR-HOME-DIFF-088` | Reduce admin-panel feel. | Lighter chrome, card density, desktop-app status bar. |
| `SR-HOME-DIFF-089` | Normalize card radius, border, shadow. | Cards share 8px radius and light border. |
| `SR-HOME-DIFF-090` | Normalize icon style. | Lucide linear icons, blue primary, red PDF, yellow star. |
| `SR-HOME-DIFF-091` | Normalize text hierarchy. | Titles, descriptions, paths, and shortcuts use distinct styles. |
| `SR-HOME-DIFF-092` | Normalize button styles. | Primary, secondary, text-link, and icon buttons remain consistent. |
| `SR-HOME-DIFF-093` | Tighten table/list density. | Recent/session rows are compact without breaking click targets. |
| `SR-HOME-DIFF-094` | Keep module structure for empty state. | Favorites empty state keeps heading and `查看全部（0）`. |
| `SR-HOME-DIFF-095` | Use recent count. | Sidebar and `查看全部（N）` use `recentDocuments.length`. |
| `SR-HOME-DIFF-096` | Use favorite count. | Sidebar and `查看全部（N）` use `favoriteDocuments.length`. |
| `SR-HOME-DIFF-097` | Use session restore count. | Sidebar uses loaded restorable tab count. |
| `SR-HOME-DIFF-098` | Show progress fields. | Session/recent/favorite surfaces show page or percent. |
| `SR-HOME-DIFF-099` | Show last opened time. | Recent/session use available timestamp fallback. |
| `SR-HOME-DIFF-100` | Show favorite state. | Recent menu labels `收藏` or `取消收藏`; favorite card star active. |
| `SR-HOME-DIFF-101` | Use cache stats. | Sidebar and cache entry route to same stats/settings owner. |
| `SR-HOME-DIFF-102` | Use app version. | Version card receives metadata or fallback. |
| `SR-HOME-DIFF-103` | Unify PDF open entries. | Top, quick start, sessions, recent, and favorites use open/reopen callbacks. |
| `SR-HOME-DIFF-104` | Improve drop behavior. | PDF drop opens; non-PDF drop shows unsupported notice. |
| `SR-HOME-DIFF-105` | Folder selection routes to import/folder owner. | No fake batch import; route is explicit. |
| `SR-HOME-DIFF-106` | Clear records has confirmation. | Confirmation appears; no data is faked. |
| `SR-HOME-DIFF-107` | `查看全部` routes. | Recent and favorites route to their sidebar pages. |
| `SR-HOME-DIFF-108` | Shortcut entries work. | Search opens search; document-scoped shortcuts guide when no document is open. |
| `SR-HOME-DIFF-109` | Top and sidebar route consistency. | Shared callbacks in `ReaderApp`. |
| `SR-HOME-DIFF-110` | Wide screen keeps three-area layout. | No 1280px collapse of right rail. |
| `SR-HOME-DIFF-111` | Medium width can move/collapse rail. | Main remains readable. |
| `SR-HOME-DIFF-112` | Narrow table degrades to cards. | Same row fields still visible. |
| `SR-HOME-DIFF-113` | Search box adapts. | Search input does not overlap shortcut icons. |

## Product Behavior

### Home Shell

The home shell should have three vertical regions:

1. `HomeTopBar`, already implemented.
2. Home body with left sidebar and home content.
3. `HomeStatusBar`, newly added.

The body should contain the left navigation and a content shell. On wide screens, the content shell contains:

- the scrollable main content column;
- a fixed-width assist rail on the right.

Top and bottom bars stay fixed. The main content column scrolls vertically. The right assist rail keeps a stable width and may scroll internally if its cards exceed available height.

Target DOM shape:

```text
home-dashboard-shell
  home-top-bar
  home-dashboard
    home-sidebar
    home-main
      home-content
        home-primary
          home-welcome-banner
          home-quick-start
          home-session-restore
          home-recent-files
          home-favorites-panel
        home-assist
          home-quick-tips-card
          home-desktop-integration-card
          home-version-card
  home-status-bar
```

For non-home blank pages, `home-main` should render the blank content without the assist rail unless a future page explicitly needs it:

```text
home-main
  home-content.home-blank-content
    home-blank-page
```

This keeps placeholder/list pages from inheriting a right rail that belongs only to the home dashboard.

Layout CSS intent:

| Selector | Layout responsibility |
|---|---|
| `.home-dashboard-shell` | `grid-template-rows: auto minmax(0, 1fr) auto`. |
| `.home-dashboard` | `grid-template-columns: sidebarWidth minmax(0, 1fr)`. |
| `.home-main` | Owns scrollable page surface, no extra dashboard title row. |
| `.home-content` | Wide: `grid-template-columns: minmax(0, 1fr) 320px`; medium: single column. |
| `.home-primary` | Scroll content stack with consistent gap. |
| `.home-assist` | Right rail card stack, stable width on wide screens. |
| `.home-status-bar` | Fixed bottom shell row with left/right flex groups. |

### Right Assist Rail

Replace the temporary `工作台状态` and `阅读流程` cards with a new assist rail, for example `HomeAssistPanel`.

The rail contains three cards in order:

1. `快速上手`
2. `桌面集成`
3. SmartReader version information

The assist rail is present on the home page. For blank sidebar pages, it should not force unrelated page content into a compressed layout.

### Quick Tips Card

The `快速上手` card has a title row with `快速上手` on the left and `更多技巧 >` on the right.

It renders four rows with the same structure: light-blue icon tile, title, description, and gray shortcut capsule.

Rows:

| Title | Description | Shortcut | Action |
|---|---|---|---|
| `搜索文件与内容` | `使用顶部搜索框快速查找文件、书签、批注与全文内容。` | `⌘K` | Open global search. |
| `书签管理` | `使用书签标记重要页面，支持层级与标签分类。` | `⌘D` | If a reader document is active, use bookmark flow; from home, show an "open a PDF first" notice or route to bookmark manager. |
| `批注与高亮` | `在阅读中添加批注、高亮与划线，支持导出。` | `⌘E` | If a reader document is active, use annotation flow; from home, show an "open a PDF first" notice or route to annotation manager. |
| `快捷键总览` | `查看所有快捷键，提升阅读与管理效率。` | `⌘/` | Open shortcut settings. |

The prototype text should be used exactly where listed above.

Click handling should use buttons for actionable rows, not inert cards. If the row itself is clickable, its accessible name should include the title and shortcut. The shortcut capsule remains visual and should not receive independent focus.

### Desktop Integration Card

The `桌面集成` card has three rows:

1. `支持 "Open With"`
   - Description: `在 Finder 中右键使用 SmartReader 打开 PDF。`
   - Informational only.

2. `文件关联`
   - Description: `将 PDF 文件默认关联到 SmartReader。`
   - Button: `设置关联`.
   - If a desktop association bridge exists, call it. If not, show `当前环境不支持自动设置文件关联，请在系统设置中关联 PDF。`.

3. `本地缓存`
   - Description: `智能缓存常用文件，加速打开与搜索体验。`
   - Button: `管理缓存`.
   - Opens settings with the cache section selected.

The card should not introduce new native commands unless a real supported bridge already exists in the project.

The `设置关联` fallback is intentionally a notice, not a disabled button, because the prototype shows an available action. The user should learn why SmartReader cannot automate the OS-level association in the current environment.

### Version Card

The version card shows:

- SmartReader icon.
- App name: `SmartReader`.
- Version and build text.
- Positioning copy: `本地优先 · 隐私安全 · 高效阅读`.
- Link-style action: `检查更新`.

Version source order:

1. Tauri app metadata if exposed through current runtime APIs.
2. Current package or config version when available to the frontend.
3. Fallback text derived from current repo metadata, not a hard-coded prototype-only version unless no other source is available.

If update checking is not implemented, `检查更新` shows a notice such as `检查更新能力待接入。`.

Display format:

- with build: `版本 {version} (Build {build})`;
- without build: `版本 {version}`;
- fallback when no runtime metadata is exposed: use the current app config/package version and omit build.

The prototype example `版本 1.7 (Build 86)` is content guidance, not a hard-coded product fact.

### Bottom Status Bar

Add a fixed `HomeStatusBar` below the home body.

Left side:

- green status dot;
- `本地模式`;
- separator dot;
- `所有数据保存在本地`;
- info icon.

Right side:

- view scale text, defaulting to `125%` if no dynamic home scale exists;
- down chevron;
- zoom/search-like icon entry for future view controls;
- task status icon;
- task status text.

Task state display:

| State | Text |
|---|---|
| `idle` | `无任务运行中` |
| `opening` | `正在打开文件` |
| `importing` | `正在导入文献` |
| `caching` | `正在更新缓存` |
| `error` | `任务异常` |

If no task source exists during implementation, the status bar should render `idle` by default and leave future task wiring as a typed prop extension.

The view scale text is not connected to PDF zoom. If no app-level home zoom exists, render the prototype default and keep the zoom icon action as a notice or no-op with a descriptive `aria-label`. This avoids coupling the home shell to `ViewerController`.

### Main Content

The current main content order remains:

1. Welcome banner.
2. Quick start.
3. Restore last session.
4. Recent files.
5. Favorite files.

Needed behavior refinements:

- `打开本地 PDF` and the top `打开文件` button must use the same `openPdf` flow.
- The drop card should highlight on PDF drag and show a notice for unsupported files.
- `选择文件夹` should route to the folder/import destination without claiming batch import completion.
- `清除记录` should require confirmation. The confirmed action should clear real restorable session state only if a current persistence API exists; otherwise it should show an honest not-yet-implemented notice and not fake deletion.
- Recent file and favorite file clicks should reopen the document through existing `reopenRecentDocument` where possible.
- Empty favorite state must keep the module title and `查看全部（0）` entry.

Detailed main-content decisions:

| Module | Preserve | Change |
|---|---|---|
| Welcome banner | Current copy and illustration are close to prototype. | Only adjust spacing if the new shell squeezes the banner. |
| Quick start | Current three-card layout and hidden input fallback. | Non-PDF drop should surface a notice instead of silently returning. |
| Session restore | Current three-row cap, red PDF icon, progress, time, continue button. | Clear-record confirm remains honest fallback unless real clear API is added. |
| Recent files | Current five-row table, progress bar, menu, favorite state. | Add narrow card-list layout and keep menu actions accessible. |
| Favorites | Current three-card layout and active yellow star. | Add open/reopen behavior for the card body when a document path can be resolved; retain cancel favorite button. |

Favorite opening requires a conservative data path because `FavoriteDocument` has less metadata than `PersistedDocument`. `ReaderApp` should resolve a favorite to a matching recent document by `documentKey` or path. If no reopenable path exists, show a notice instead of failing silently.

### Route Consistency

Top bar, left sidebar, right rail, and main content controls should route to the same destinations for the same feature.

Expected mapping:

| Feature | Destination |
|---|---|
| Global search / full text search | `openGlobalSearch` |
| Import / folder-related entry | existing import workspace or folder placeholder |
| Compare reading | compare workspace |
| Annotation management | annotation manager workspace |
| Bookmark management | bookmark manager workspace |
| Cache management | settings workspace with cache section |
| Shortcut overview | settings workspace with shortcuts section |
| Settings | settings workspace |

`ReaderApp` should remain the single place that decides the destination. `HomeDashboard` should only call named props such as `onOpenShortcutSettings`, `onOpenCacheManagement`, `onOpenBookmarks`, and `onOpenAnnotations`.

## Data Contract

`HomeDashboard` should continue receiving existing data and may add small, optional props for home-only display:

- `recentDocuments: PersistedDocument[]`
- `favoriteDocuments: FavoriteDocument[]`
- `counts`
- `cacheStats`
- `appVersion?: { version: string; build?: string | null }`
- `taskStatus?: 'idle' | 'opening' | 'importing' | 'caching' | 'error'`

Existing computed values:

- recent count from `recentDocuments.length`;
- favorite count from `favoriteDocuments.length`;
- session count from loaded reader session tabs;
- cache usage from `loadCacheStats()`;
- progress from `lastPage`, `pageCount`, and `progress`.

No new persistent tables, columns, or migrations are required.

### Proposed Prop Contracts

`HomeDashboard` should extend its props narrowly:

```ts
type HomeTaskStatus = 'idle' | 'opening' | 'importing' | 'caching' | 'error';

type HomeAppVersion = {
  version: string;
  build?: string | null;
};

type HomeDashboardProps = {
  // existing document, count, cache, and route props remain
  appVersion?: HomeAppVersion;
  taskStatus?: HomeTaskStatus;
  onOpenShortcutSettings?(): void;
  onSetupFileAssociation?(): void | Promise<void>;
  onCheckUpdates?(): void | Promise<void>;
  onOpenFavoriteDocument?(document: FavoriteDocument): void | Promise<void>;
};
```

The optional props allow incremental implementation without changing unrelated call sites. `HomeDashboard` should provide local notice fallbacks when optional capabilities are absent.

`HomeAssistPanel` receives only display data and callbacks:

```ts
type HomeAssistPanelProps = {
  appVersion: HomeAppVersion;
  onOpenGlobalSearch(): void;
  onOpenBookmarks(): void;
  onOpenAnnotations(): void;
  onOpenShortcutSettings(): void;
  onOpenCacheManagement(): void;
  onSetupFileAssociation(): void;
  onCheckUpdates(): void;
};
```

`HomeStatusBar` is presentational:

```ts
type HomeStatusBarProps = {
  viewScale?: string;
  taskStatus?: HomeTaskStatus;
  onOpenViewControls?(): void;
};
```

### Version Data

The implementation should not import JSON with a new bundler pattern unless the project already uses it. Conservative options:

1. Pass `version: '0.1.0'` from a small local constant matching current `package.json` / `tauri.conf.json`.
2. Use an existing Tauri runtime API if it is already available without new native setup.

If the version source changes later, only `ReaderApp` or a tiny metadata helper should change; presentational cards should not know where metadata came from.

## Error Handling

Use `HomeActionNotice` for home-level feedback:

- unsupported file drop: `仅支持 PDF 文件`;
- unsupported file association: `当前环境不支持自动设置文件关联，请在系统设置中关联 PDF。`;
- bookmark/annotation action without an open document: `请先打开一个 PDF 文档。`;
- unavailable update check: `检查更新能力待接入。`;
- unavailable locate/remove/recent-management actions: keep existing honest notices until real APIs exist.

Home feedback should not silently fail and should not pretend a missing capability succeeded.

### Event Flows

Open PDF from top bar or quick start:

```text
User click
  -> HomeTopBar/HomeQuickStart callback
  -> HomeDashboard.handleOpenPdf
  -> ReaderApp.openPdf
  -> native picker or browser fallback
  -> reader workspace opens if a file is selected
```

Drop PDF on quick start:

```text
User drags file over drop card
  -> card shows drag-active state
User drops
  -> HomeQuickStart checks drop event path through HomeDashboard
  -> PDF files call ReaderApp.handleDrop
  -> non-PDF files show HomeActionNotice
```

Open favorite:

```text
User clicks favorite card body
  -> HomeFavorites.onOpenDocument
  -> HomeDashboard.onOpenFavoriteDocument
  -> ReaderApp resolves favorite against recent documents
  -> reopenRecentDocument when path exists
  -> otherwise show HomeActionNotice
```

Shortcut quick tip:

```text
User clicks quick tip row
  -> HomeAssistPanel callback
  -> ReaderApp route owner or HomeDashboard notice fallback
```

## Responsive Design

Wide screens:

- At `1280px` and above, keep left sidebar, main content, and right assist rail visible.
- The assist rail uses a stable width around `320px`.
- The left sidebar remains wide enough for grouped navigation and the cache card.

Medium screens:

- Below the wide threshold, the assist rail may move below the main content or collapse into a lower section.
- The main content should remain readable and should not be squeezed by the assist rail.

Narrow screens:

- The sidebar may collapse to icons or be hidden at the existing mobile breakpoint.
- Top bar buttons may become icon-only.
- The recent files table should degrade to list cards that still show file name, path, last opened, progress, and actions.
- The search box should shrink without covering top shortcut icons.

The key invariant is that wide desktop windows must show the prototype three-area layout and must not fall back to the simplified current layout.

Breakpoint intent:

| Width | Sidebar | Main | Assist rail | Recent files |
|---|---|---|---|---|
| `>= 1280px` | Full width. | Primary column. | Fixed right column. | Table. |
| `1040px - 1279px` | Full or compact per existing sidebar behavior. | Full width. | Moves below primary content. | Table or horizontal-scroll table. |
| `720px - 1039px` | Icon rail or compact sidebar. | Full width. | Below primary content. | Card list preferred if table overflows. |
| `< 720px` | Hidden. | Single column. | Below content or hidden after essential cards. | Card list. |

The existing `@media (max-width: 1280px)` behavior should be revised so that it does not collapse the wide prototype at exactly the common desktop width class. A safer threshold is below the minimum width where `sidebar + main min width + 320px rail` can fit without squeezing content.

## Visual Design

Use the existing SmartReader visual system and tighten it toward the prototype:

- Cards use 8px radius, light border, and little or no shadow.
- Iconography uses `lucide-react` linear icons.
- Blue remains the primary action and highlight color.
- PDF file icons are red.
- Favorite star icons are yellow.
- Section headings are bold and compact.
- Description, path, time, and helper copy use muted gray and smaller type.
- Recent file rows and session rows should be denser than an admin table while preserving click targets.
- Empty states should live inside complete modules rather than replacing module structure.

Do not introduce a new palette, new dependency, or heavy decorative illustration for this pass.

### Visual Tokens and Class Intent

Use existing CSS variables:

- `--sr-bg`
- `--sr-surface`
- `--sr-surface-muted`
- `--sr-border`
- `--sr-text`
- `--sr-text-muted`
- `--sr-primary`
- `--sr-danger`
- `--sr-warning`
- `--sr-radius`

New class families should stay descriptive and local:

- `.home-assist`
- `.home-assist-card`
- `.quick-tip-list`
- `.quick-tip-row`
- `.quick-tip-icon`
- `.shortcut-capsule`
- `.desktop-integration-list`
- `.desktop-integration-item`
- `.home-version-card`
- `.home-status-bar`
- `.home-status-left`
- `.home-status-right`
- `.recent-files-card-list`

Avoid introducing broad global utility classes unless an equivalent already exists.

## Architecture

### Components

Add or replace focused components:

- `src/home/HomeAssistPanel.tsx`
  - Owns the right assist rail composition.
  - Receives routing and notice callbacks through props.

- `src/home/HomeQuickTipsCard.tsx`
  - Presentational quick tips card.
  - Uses configuration rows to avoid repeated JSX.

- `src/home/HomeDesktopIntegrationCard.tsx`
  - Presentational desktop integration card plus button callbacks.

- `src/home/HomeVersionCard.tsx`
  - Presentational app metadata card.

- `src/home/HomeStatusBar.tsx`
  - Presentational bottom status bar.

`HomeDashboard` should remain the composition boundary, but it should not absorb the right rail and status bar implementation details.

### File-Level Changes

Expected frontend file changes:

| File | Expected change |
|---|---|
| `src/home/HomeDashboard.tsx` | Replace `HomeStatusPanel`, add `HomeStatusBar`, route right-rail actions, add notice fallbacks, wire favorite open. |
| `src/home/HomeStatusPanel.tsx` | Delete or stop using after replacement; if kept, rename semantics should not conflict. |
| `src/home/HomeAssistPanel.tsx` | New right rail composition. |
| `src/home/HomeQuickTipsCard.tsx` | New quick tips card. |
| `src/home/HomeDesktopIntegrationCard.tsx` | New desktop integration card. |
| `src/home/HomeVersionCard.tsx` | New version card. |
| `src/home/HomeStatusBar.tsx` | New bottom status bar. |
| `src/home/HomeQuickStart.tsx` | Add unsupported-file notice integration if needed by prop change. |
| `src/home/HomeFavorites.tsx` | Add card-body open behavior without breaking favorite toggle. |
| `src/home/HomeRecentFiles.tsx` | Add narrow card-list rendering if CSS-only table conversion is not enough. |
| `src/app/ReaderApp.tsx` | Provide new callbacks and app metadata; keep workspace route ownership here. |
| `src/app/styles.css` | Shell grid, right rail, status bar, responsive, and density styling. |
| `src/home/*.test.tsx` | Focused tests for right rail, status bar, routing, and regressions. |

No `src-tauri` file should change unless implementation deliberately adds a supported native association or version API, which this design does not require.

### State Ownership

`ReaderApp` remains owner of application data and workspace switching. `HomeDashboard` owns only home-local notice state and file-input fallback wiring.

Right rail and status bar components should not call persistence directly. They receive display data and callbacks as props.

### Design Pattern Decision

Do not introduce Strategy, Factory, Command objects, or new service layers for this task. The problem is UI composition and route wiring. The simplest maintainable design is:

- small React components with clear prop contracts;
- configuration arrays for repeated quick-tip and integration rows;
- shared callback handlers in `HomeDashboard` and `ReaderApp`.

This avoids unnecessary abstraction while keeping the files understandable and testable.

## Accessibility

Accessibility requirements:

- Right-rail actionable rows use `<button type="button">` with clear accessible names.
- Shortcut capsules are decorative text and should not create extra tab stops.
- Icon-only buttons, including status bar view controls and recent-file menus, have `aria-label`.
- The assist rail uses `aria-label="辅助信息"` or equivalent.
- The bottom status bar uses a semantic container with `aria-label="首页状态栏"`.
- Modal notices keep the existing `HomeActionNotice` accessible behavior.
- Recent-files narrow cards expose the same menu actions as the table.
- Clickable favorite cards must not conflict with the nested favorite-toggle button; nested button clicks should stop propagation.

Keyboard behavior:

- Existing recent-file menu keyboard behavior should be preserved.
- Quick tip rows are reachable with Tab.
- `Escape` behavior remains owned by existing modals/overlays.

## Testing

Targeted tests should cover:

- right assist rail renders `快速上手`, `桌面集成`, and version card;
- old right-side `工作台状态` and `阅读流程` cards are absent from the home page;
- quick tips render the four expected titles, descriptions, and shortcut labels;
- `更多技巧` and `快捷键总览` route to shortcut settings;
- `搜索文件与内容` opens global search;
- desktop integration `管理缓存` routes to cache settings;
- unsupported file association and update check show home notices when no real capability exists;
- bottom status bar renders local mode, local-storage copy, zoom text, and task status;
- top/quick-start PDF open entries share the same callback path where applicable;
- `查看全部` entries route to the appropriate home/sidebar destination;
- favorites empty state keeps the module title and count entry;
- non-home blank pages do not render the home assist rail in a broken two-column layout.

Validation commands:

- focused Vitest files for changed home components;
- `bun run typecheck`;
- `bun run test` if the focused test set passes and runtime cost remains acceptable;
- `bun run build` if layout or app-level typing changes cross workspace boundaries.

No Tauri Rust validation is required unless implementation adds native commands or touches `src-tauri`.

## Acceptance Checklist

- Right rail matches prototype content and removes temporary status/help cards.
- Bottom status bar is fixed and visible on the home page.
- Wide desktop layout shows left navigation, main content, and right assist rail together.
- Main content remains scrollable without top or bottom bars scrolling away.
- Existing PDF open, search, bookmark, annotation, settings, cache, compare, and import routes remain consistent.
- Repeated or deep features are either routed to their existing owner or clearly marked unavailable.
- No unrelated reader, persistence, cache schema, or migration behavior changes.
- The app is not started automatically as part of this design or implementation.
