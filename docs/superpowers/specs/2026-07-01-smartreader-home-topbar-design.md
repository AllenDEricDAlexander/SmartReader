# SmartReader Home Top Bar Design

Date: 2026-07-01

## Purpose

SmartReader's home page should match the supplied desktop-app prototype more closely. The current home page exposes the main PDF open actions, but its top area still reads like an ordinary page header. This design upgrades the home screen with a complete macOS-style application top bar, a global search entry, and the prototype's right-side shortcut actions while keeping the implementation scoped to the local-first desktop client.

This is a client application change. It does not introduce a backend service, remote API, cloud sync, or a frontend-backend split.

## Requirements Covered

- `SR-HOME-DIFF-001`: Replace the current home page title header with a desktop app top bar that includes macOS window controls, SmartReader icon, `SmartReader`, and `本地优先的 PDF 阅读器`.
- `SR-HOME-DIFF-002`: Add a left-side `打开文件` button with a folder icon. It opens the local PDF picker using the existing document-opening flow.
- `SR-HOME-DIFF-003`: Add a centered global search box with placeholder `搜索文件、书签、批注...` and shortcut hint `⌘K`.
- `SR-HOME-DIFF-004`: Enter global search from input focus or `⌘K`. Search covers file names, file paths, bookmark titles, annotation text, and a clearly bounded full-text path.
- `SR-HOME-DIFF-005`: Add right-side shortcut entries for `导入文献`, `对比阅读`, `批注管理`, `书签`, and `设置`, each with an icon and text.
- `SR-HOME-DIFF-006`: Make every shortcut entry clickable and route to the appropriate local workspace or flow.

## Scope

In scope:

- Home top bar layout and styling.
- Reusing the existing local PDF open flow for the top bar `打开文件` action.
- A global search state and search panel opened by top bar focus or `Meta+K`.
- Search over locally available document metadata, bookmarks, and annotations.
- Full-text search for currently opened PDFs through the existing viewer search capability.
- New local workspace states for import, compare reading, annotation management, and bookmark management.
- Settings shortcut reuse of the existing settings workspace.
- Focused regression coverage for top bar rendering, `打开文件`, `Meta+K`, search state, and shortcut routing.

Out of scope:

- Persistent cross-document full-text indexing for unopened PDFs.
- Batch folder import.
- Metadata extraction for academic references.
- A complete compare-reading engine.
- PDF content export, printing, cloud sync, RAG, or AI assistant features.
- Large homepage/sidebar redesign outside the top bar and necessary layout accommodation.

## Current Code Boundary

The affected frontend boundary is:

- `src/home/HomeDashboard.tsx` for the current home layout and home-level actions.
- `src/home/HomeQuickStart.tsx` for the existing open-file and hidden file input behavior.
- `src/app/ReaderApp.tsx` for workspace switching, document state, persistence access, and command registration.
- `src/app/appTypes.ts` for the `AppWorkspace` union.
- `src/commands/commandRegistry.ts` and `src/reader/hooks/useReaderCommands.ts` for shortcut registration.
- `src/persistence/persistenceApi.ts` for typed local persistence calls.

The implementation should preserve the existing `App.tsx` thin entry point and avoid broad structural refactoring.

## Product Behavior

### Top Bar

The home page uses a new `HomeTopBar` component. It sits above the existing home content, spanning the app width, with three zones:

1. Left zone:
   - macOS red/yellow/green window-control dots.
   - SmartReader icon using the existing icon style or a lucide icon that matches the prototype.
   - Brand text:
     - title: `SmartReader`
     - subtitle: `本地优先的 PDF 阅读器`
   - `打开文件` button with folder icon.

2. Center zone:
   - Search field with search icon.
   - Placeholder: `搜索文件、书签、批注...`.
   - Shortcut hint: `⌘K`.
   - Focus opens global search mode without immediately executing a query.

3. Right zone:
   - Clickable shortcut buttons:
     - `导入文献`
     - `对比阅读`
     - `批注管理`
     - `书签`
     - `设置`
   - Each button includes a lucide icon and visible text.

The top bar is part of the home workspace for this iteration. Reader, settings, tag manager, and future workspaces may receive their own top-level chrome later if the product direction requires it.

### Open File

The top bar `打开文件` action calls the same `openPdf()` path used by the current quick-start `打开本地 PDF` button. If native dialog access fails in non-Tauri contexts, the existing browser file input fallback remains the fallback behavior.

`HomeDashboard` should receive or own the file input bridge needed by the top bar without duplicating file-opening logic.

### Global Search

Global search opens when:

- the user focuses or clicks the top bar search field;
- the user presses `Meta+K`.

The panel accepts a query and aggregates results from provider functions:

- documents provider: recent and favorite documents, matching `displayName` and `path`;
- bookmarks provider: bookmark title and document identity;
- annotations provider: annotation text and quote;
- active PDF full-text provider: delegates to the existing viewer search command for the active opened document when possible.

The first implementation must not claim indexed cross-document PDF content search. For unopened PDFs, full-text indexing remains a future extension. The UI should label this honestly, for example by showing file/bookmark/annotation results immediately and offering current-document PDF search when a reader session is active.

### Shortcut Routing

Workspace routing stays local to `ReaderApp` by extending `AppWorkspace`.

Expected target behavior:

- `导入文献`: opens an import workspace or import panel that presents local PDF open/select/drop actions. It may reuse the existing file-opening functions and should avoid adding a metadata extraction flow in this task.
- `对比阅读`: opens a compare-reading workspace shell. It should allow the user to see that compare reading is a distinct workspace, but the full two-document synchronized reader is deferred.
- `批注管理`: opens an annotation management workspace listing persisted annotations. Selecting a row should reopen the related document when a path is available, then jump to the annotation page where possible.
- `书签`: opens a bookmark management workspace listing persisted bookmarks. Selecting a row should reopen the related document when a path is available, then jump to the bookmark page where possible.
- `设置`: reuses the existing settings workspace.

If persisted annotation or bookmark data cannot be loaded, the workspace should show an inline empty/error state instead of failing the whole app shell.

## Architecture

### Components

Add focused components under the current structure:

- `src/home/HomeTopBar.tsx`
  - Owns the visual top bar and forwards events through props.
  - Does not open files directly and does not query persistence directly.

- `src/search/GlobalSearchPanel.tsx`
  - Owns the search overlay/panel UI.
  - Receives query state, results, and callbacks.

- `src/search/globalSearch.ts`
  - Contains pure result mapping and matching helpers.
  - Keeps search provider logic testable without rendering React.

- `src/workspaces/ImportWorkspace.tsx`
  - Lightweight import entry surface.

- `src/workspaces/CompareWorkspace.tsx`
  - Lightweight compare-reading shell.

- `src/workspaces/AnnotationManagerWorkspace.tsx`
  - Lists annotation results and exposes open/jump actions.

- `src/workspaces/BookmarkManagerWorkspace.tsx`
  - Lists bookmark results and exposes open/jump actions.

The exact folder name may follow the existing project style if a better local convention appears during implementation, but the components should remain small and responsibility-focused.

### State

`ReaderApp` remains the top-level owner for:

- active workspace;
- recent and favorite documents;
- active reader session;
- global search open/closed state;
- global search query;
- global search results;
- workspace navigation callbacks.

`HomeTopBar` remains presentational. It receives callbacks such as `onOpenPdf`, `onOpenGlobalSearch`, `onOpenImport`, `onOpenCompare`, `onOpenAnnotations`, `onOpenBookmarks`, and `onOpenSettings`.

### Persistence

The existing frontend API can list recent and favorite documents. It can list bookmarks and annotations by document key. For global management pages, the implementation should add explicit local persistence commands only if the current API cannot efficiently list all bookmarks or all annotations.

If new all-bookmarks or all-annotations queries are needed:

- add typed methods to `PersistenceApi`;
- add Tauri commands in Rust;
- add Rust unit tests for the query;
- do not modify existing migration files;
- do not add a migration unless a new persisted table or column is actually required.

### Commands

Add a command for global search:

- command id: `global.search.open`;
- default shortcut: `Meta+K`;
- label: `Global Search`.

This command opens global search without interfering with the existing document search command `find.open` (`Meta+F`).

## Data Flow

1. Home renders `HomeTopBar` above the current home body.
2. `打开文件` calls `ReaderApp.openPdf`.
3. Search focus or `Meta+K` sets global search open and focuses the global search input.
4. Query changes are matched against locally loaded document metadata and any loaded bookmark/annotation collections.
5. If the user chooses a file result, SmartReader reopens that document through the existing recent-document path.
6. If the user chooses a bookmark or annotation result, SmartReader reopens the document where possible and then jumps to the saved page.
7. If the user uses current-document full-text search, SmartReader delegates to the existing viewer search controller.

## Error Handling

- If native open-file fails, preserve the existing browser file picker fallback.
- If global search provider data fails to load, show the rest of the providers that succeeded and render an inline message for the failed category.
- If a bookmark or annotation points to a missing local file, keep the row visible and show a missing-file state rather than deleting local metadata.
- If a future workspace is only a shell in this iteration, it should be explicit in UI copy through concise local wording, not a disabled or dead button.

## Design Pattern Decision

Use a lightweight Strategy-style provider list for global search. Each provider has one job: accept a normalized query and return typed results for one source. This fits the known variation point: files, bookmarks, annotations, and current-document full-text search have different data sources but a shared result presentation.

Do not introduce class hierarchies, factories, or a global search service layer. Simple typed functions are enough for this iteration and match the existing direct React-plus-hooks style.

## Testing

Targeted frontend tests:

- Home top bar renders macOS controls, brand text, subtitle, `打开文件`, search placeholder, shortcut hint, and all five shortcut buttons.
- Top bar `打开文件` triggers the same open PDF flow as the quick-start action.
- `Meta+K` opens global search.
- Search focus opens global search.
- File-name and path search returns recent/favorite document results.
- Bookmark and annotation search mapping works through pure helper tests.
- Shortcut buttons route to the expected workspace.
- Settings shortcut still opens the existing settings workspace.

Targeted Rust tests if new commands are added:

- list all bookmarks returns document metadata needed by management/search UI.
- list all annotations returns text, quote, page, document key, and available path.

Validation commands:

```bash
bun run typecheck
bun run test
```

If Rust persistence commands are added:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Do not start the app automatically after implementation. Runtime testing is left to the user.

## Acceptance Criteria

- The home page top bar visually includes the full desktop app structure from the prototype.
- `打开文件` in the top bar opens local PDFs through the existing supported flow.
- Search field and `Meta+K` both enter global search state.
- Global search covers local files, bookmarks, annotations, and current opened PDF full-text search without overstating unopened-PDF indexing.
- The five right-side shortcuts are visible, clickable, and routed.
- No unrelated workspace refactor or new dependency is introduced.
- Existing reader open, recent sessions, favorites, settings, and tag management behavior remain intact.
