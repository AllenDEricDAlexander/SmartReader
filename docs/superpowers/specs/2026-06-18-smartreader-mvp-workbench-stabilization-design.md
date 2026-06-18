# SmartReader MVP Workbench Stabilization Design

Date: 2026-06-18

## Purpose

SmartReader should become a usable local-first PDF reader workbench, matching the supplied product prototype while making every MVP capability manually testable. The current app passes automated checks, but the user reports that desktop file opening can fail, browser PDF opening loads forever, and the UI does not match the intended product quality.

This design keeps the current Tauri + React + PDF.js stack, stabilizes the real PDF open and render path first, and rebuilds the app shell around the prototype's professional macOS-style workbench.

## Confirmed Scope

This work implements the README-level MVP plus the confirmed local organization features.

In scope:

- Home dashboard with open PDF, drag-and-drop, recent files, session restore, favorites, tag entry points, cache status, desktop integration status, and version/status information.
- Reader workspace with multi-document tabs, page navigation, history back/forward, zoom, fit width, fit page, search, bookmarks, annotations, notes, tags, favorites, recent files, and status bar.
- Search mode with viewer search commands, previous/next match controls, page jump, fit controls, and honest unavailable-state copy when the current viewer API cannot provide real match counts or result snippets.
- Annotation mode with bookmarks, highlights, underlines, page notes, selected-text notes, annotation detail, editable note text, colors, and tags.
- Favorites for PDF documents.
- Tag management center with create, rename, merge, delete, color, statistics, and batch maintenance.
- Tags attached to PDF documents and annotations or notes.
- Settings workspace for shortcuts, cache, desktop integration, session restore, saving settings, and restoring defaults.
- Tauri dialog permissions, event permissions, command registration, SQLite migration safety, preferences persistence, and visible error handling.
- Automated validation and a manual test checklist.

Out of scope for this implementation:

- AI assistant.
- Compare reading.
- Full folder-based library management.
- Full-text knowledge base or RAG.
- Cloud sync.
- Category-level encryption.
- Writing annotations back into original PDF files.
- Export as text or image.
- Printing.
- Renaming, moving, or deleting local files from disk.

Out-of-scope entry points may remain visible when they are part of the prototype's product direction, but they must be disabled and clearly marked as future-version functionality.

## Current Findings

The automated checks currently pass:

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`

Passing tests do not prove the real app works. The current tests mostly use fake viewer renderers, fake Tauri bridges, and fake persistence APIs. They do not verify the real PDF.js worker path, real viewer plugin lifecycle, Tauri v2 capabilities, native dialog permissions, or SQLite reopen behavior.

Observed and code-level findings:

- Browser `Choose` can select PDFs but all PDFs remain loading forever.
- Desktop `Open PDF` can fail to show the native file dialog.
- Desktop-selected PDFs can create a tab but still leave the viewer loading.
- The current UI is functionally crowded and does not match the supplied product prototype.
- `App.tsx` owns too many responsibilities: opening, restoring, caching, persistence, commands, bookmarks, annotations, preferences, side panels, and viewer orchestration.
- `PdfViewerBridge` creates viewer plugin instances inside render flow, making controller bindings and plugin state fragile.
- The viewer wrapper has no explicit layout CSS for the bridge and plugin toolbar, so loading and measurement states are hard to reason about.
- The frontend persistence API calls `save_preferences` and `load_preferences`, but the Rust invoke handler does not register matching commands.
- The database setup concatenates migrations and executes them on every open. Existing `ALTER TABLE ... ADD COLUMN` statements can fail on an existing database.
- Tauri v2 capabilities are missing, while the frontend uses plugin APIs such as dialog open and event listen.

## Product Direction

The supplied prototype defines the target experience:

- Professional desktop-reader interface rather than a landing page.
- Light, restrained macOS-style surfaces.
- White and light-gray layout, blue as the primary accent, and red/yellow/green macOS window controls.
- Left navigation and side panels for document organization.
- Central PDF as the main work surface.
- Right inspector panels for document information, search controls, annotation detail, and local operations.
- A settings workspace with a left settings nav and structured cards.

The implementation should use Chinese UI copy for visible product text, while keeping code identifiers and tests in English.

## Package Structure

`App.tsx` must become a thin entry point. Business logic should move into focused pages, hooks, and stores.

Target structure:

```text
src/
  app/
    App.tsx
    ReaderApp.tsx
    appTypes.ts
    styles.css

  home/
    HomeDashboard.tsx
    HomeQuickStart.tsx
    HomeRecentSessions.tsx
    HomeFavorites.tsx
    HomeStatusPanel.tsx

  reader/
    ReaderWorkspace.tsx
    ReaderToolbar.tsx
    ReaderTabs.tsx
    ReaderLeftPanel.tsx
    ReaderRightPanel.tsx
    ReaderStatusBar.tsx
    ReaderEmptyState.tsx
    ReaderErrorState.tsx

    hooks/
      useDocumentOpening.ts
      useSessionRestore.ts
      useReaderCommands.ts
      useReaderPersistence.ts
      useReaderDecorations.ts
      useReaderNavigation.ts

    search/
      SearchPanel.tsx
      SearchResultsList.tsx
      SearchInspector.tsx

    annotations/
      AnnotationPanel.tsx
      AnnotationList.tsx
      AnnotationDetail.tsx
      AnnotationToolbar.tsx

  tags/
    TagManager.tsx
    TagList.tsx
    TagEditor.tsx
    TagPicker.tsx
    tagModels.ts
    tagStore.ts

  favorites/
    favoriteModels.ts
    favoriteStore.ts

  settings/
    SettingsWorkspace.tsx
    ShortcutSettings.tsx
    CacheSettings.tsx
    DesktopIntegrationSettings.tsx
    SessionRestoreSettings.tsx

  viewer/
    PdfViewerBridge.tsx
    viewerController.ts
    viewerTypes.ts
```

Constraints:

- `App.tsx` should stay under 30 lines and only mount `ReaderApp`.
- `ReaderApp.tsx` owns top-level view switching: home, reader, settings, and tag manager.
- `ReaderApp.tsx` must not directly implement file opening, SQLite calls, PDF viewer commands, or annotation logic.
- Individual UI components should stay near 150 lines when practical. If a component grows beyond that because it owns multiple responsibilities, split by responsibility.
- `PdfViewerBridge.tsx` remains the only file that imports `@react-pdf-viewer/*`.
- Do not create one giant global context. Prefer focused hooks and explicit props until shared state genuinely needs a provider.

## Frontend Architecture

### App Boundary

`ReaderApp` owns:

- Current workspace view.
- Active document state at the page level.
- Wiring of persistence, Tauri bridge, cache helpers, command registry, and viewer controller.

It delegates behavior to hooks:

- `useDocumentOpening`
  - Native open, browser file open, drag-and-drop, Open With events, duplicate desktop-path focusing, byte cache writes, Blob URL creation, and open errors.
- `useSessionRestore`
  - Startup restore, rereading desktop PDFs, missing-file recovery, restored active tab, and restored viewer source.
- `useReaderPersistence`
  - Typed frontend facade over documents, sessions, bookmarks, annotations, tags, favorites, preferences, and cache metadata.
- `useReaderCommands`
  - Command registry, shortcuts, command enablement, conflict detection, and command execution.
- `useReaderDecorations`
  - Bookmarks, annotations, notes, favorite state, and annotation/note tags for the active document.
- `useReaderNavigation`
  - Page jump, previous/next page, history back/forward, tab next/previous, and viewer synchronization.

### Viewer Boundary

`PdfViewerBridge` owns all direct `@react-pdf-viewer` integration:

- PDF worker configuration.
- Stable plugin instances created with `useMemo`.
- Controller bindings for jump, search, search next/previous, zoom, fit width, and fit page.
- `onDocumentLoad` reporting total page count.
- `onPageChange` and `onZoom` progress reporting.
- `renderLoader` with visible progress.
- `renderError` with recoverable error UI.
- Loading timeout detection so the UI never spins forever.
- SmartReader-managed highlight rendering.
- Text selection conversion into SmartReader annotation input.

The app owns:

- Which session is active.
- Which Blob URL belongs to which session.
- Current page, zoom, search text, bookmarks, annotations, tags, favorites, and history.

The viewer must not display a Blob URL from another session.

## Shipped Behavior Notes

The implementation keeps search command-driven because `ViewerController` exposes search commands but not real match result data. The UI must not fabricate result counts or snippets. Search panels therefore show the active query, the last search command state, previous/next controls, clear search, page jump, and fit controls, while explicitly stating that match details are not available yet.

Session restore settings are persisted and applied:

- Disabled session restore still loads recent documents for the home dashboard, but does not reopen reader tabs.
- `restoreScope: all` restores all saved desktop-path tabs.
- `restoreScope: active` restores only the saved active desktop-path tab, with a safe fallback to one restorable tab.

Shortcut settings are persisted and used by command registration. Saved shortcut overrides replace default shortcuts at runtime.

## Data Model

Existing documents, sessions, bookmarks, and annotations remain the foundation.

Add or repair support for:

- Favorites for PDF documents through the existing `documents.favorite` column.
- Tags.
- Document-tag relations.
- Annotation-tag relations.
- Preferences persistence.
- Migration tracking.

Conceptual relationships:

```text
documents
  has many bookmarks
  has many annotations
  has many document_tags
  may be favorite

annotations
  belongs to document
  may have many annotation_tags
  stores highlight, underline, page note, or selected-text note data

tags
  has name, color, created_at, updated_at
  has usage counts derived from document_tags and annotation_tags

preferences
  stores shortcuts, cache settings, desktop integration settings, and session restore settings
```

Tags bind to documents and annotations or notes. Tags do not bind to bookmarks in this iteration.

Bookmarks remain lightweight page locators.

Notes and remarks are part of the annotation system. They are not a separate knowledge-base module.

## SQLite And Migration Design

Existing migration files under `src-tauri/src/migrations` must not be modified.

Add exactly one new migration for this implementation. The migration should cover:

- `tags`.
- `document_tags`.
- `annotation_tags`.
- Any preferences columns or compatibility tables needed by the Rust commands.
- Migration tracking table if no equivalent exists.

Favorites should use the existing `documents.favorite` column introduced by `002_reader_core_completion.sql`. The new implementation should not add a separate favorites table unless the existing column is proven unusable during implementation review. Legacy databases without migration tracking should be inspected and marked for already-present `001` and `002` schema state instead of replaying duplicate `ALTER TABLE` statements.

Database startup must stop blindly executing every migration every time.

Startup should:

1. Create the migration tracking table if missing.
2. Detect which migrations were already applied.
3. Apply only unapplied migrations in order.
4. Record each applied migration in the same transaction.
5. Treat legacy databases carefully so existing user data is not deleted or reinitialized.

The implementation should include Rust tests for:

- Opening a fresh database.
- Opening a database twice without duplicate-column failures.
- Applying the new migration after existing schema.
- Persisting and reading preferences.
- Persisting and reading favorites.
- Creating, renaming, merging, deleting, and listing tags.
- Attaching tags to documents and annotations.

## Tauri Boundary

Add the required Tauri v2 capability configuration for the main window.

The capabilities should allow only the current reader needs:

- Native dialog open.
- Event listen for Open With.
- Invoking SmartReader commands.
- Local file read through SmartReader Rust commands, not broad frontend filesystem access unless a concrete API requires it.

Rust commands should include:

- Existing document, session, bookmark, annotation, and file-read commands.
- `save_preferences`.
- `load_preferences`.
- Favorite commands.
- Tag commands.
- Any cache metadata commands needed by the settings UI.

Tauri and Rust errors must be serialized into clear user-facing categories instead of disappearing into console-only failures.

## Core Flows

### Open PDF

1. User opens a PDF through desktop dialog, browser file picker, drag-and-drop, recent file, or Open With.
2. The selected source becomes a normalized `FileSource`.
3. Desktop paths are read through `read_desktop_pdf`; browser files are read through `File.arrayBuffer()`.
4. Bytes are validated where possible.
5. SmartReader creates or focuses a document session by document key.
6. The byte cache stores the PDF bytes by document key.
7. The Blob URL cache creates a URL keyed by session ID.
8. The active viewer source becomes `{ sessionId, url }`.
9. Desktop-path documents are saved to recent files.
10. Bookmarks, annotations, favorite state, and annotation/note tags are loaded.
11. The viewer loads the Blob URL and reports document load, page, and zoom events.
12. Failure at any step shows a visible error with retry or reopen actions.

### Viewer Loading

The viewer must have explicit loading states:

- `preparing-source`: reading bytes and creating Blob URL.
- `loading-document`: PDF.js is loading the document.
- `measuring-pages`: viewer has loaded the document and is calculating page sizes.
- `ready`: pages are visible and commands are available.
- `error`: load failed.
- `timeout`: load exceeded the allowed loading window.

Timeout must replace infinite loading with a visible error and actions:

- Retry viewer load.
- Reopen file.
- Close tab.

### Search

1. User activates search through toolbar or shortcut.
2. Left panel switches to search results.
3. The search keyword is passed to the viewer search plugin.
4. Results display by page with snippets when available.
5. Current match count and next/previous controls appear in the right inspector.
6. No result, empty query, and plugin failure are visible states.

### Annotation And Notes

1. User selects text or chooses page note.
2. SmartReader stores annotation type, page, color, quote, note text, areas, and tags.
3. Highlights and underlines render inside the PDF viewer.
4. Page notes and selected-text notes appear in the annotation list and detail inspector.
5. Editing note text, color, and tags updates SQLite.
6. Deleting annotations requires confirmation.
7. Import/export JSON remains SmartReader-managed and does not write to the original PDF.

### Tags

Tag manager supports:

- Create tag.
- Rename tag.
- Change color.
- Merge tags.
- Delete tag.
- List document count and annotation count.
- Show linked documents and annotations.

Tag picker supports:

- Attach or remove tags from a document.
- Attach or remove tags from an annotation or note.
- Search existing tags.
- Create a new tag from the picker if the name does not exist.

Merging tags requires confirmation and moves document and annotation relations to the target tag.

Deleting a tag requires confirmation and removes only tag relations, not documents or annotations.

### Favorites

Favorites apply to documents.

Users can toggle favorite state from:

- Home recent/favorites area.
- Reader toolbar or document info panel.
- Recent files list.

Favorites appear on the home dashboard and can be filtered in document lists.

### Settings

Settings workspace includes:

- Shortcut settings with conflict detection.
- Cache settings for memory Blob URL cache and disk cache status.
- Desktop integration status and disabled controls for unsupported future actions.
- Session restore toggle and restore scope.
- Save settings, cancel, and restore defaults.

Preference changes should be explicit-save in settings, with clear success or failure feedback.

## UI Design

### Home Dashboard

Layout:

- Left navigation: home, recent files, favorites, session restore, tags, annotation management, settings, and disabled future entries.
- Center content: welcome panel, quick start actions, restore last session, recent files, favorite files.
- Right rail: quick tips, desktop integration, cache status, version and update status.
- Bottom status bar: local mode, data stored locally, task status.

Primary actions:

- Open local PDF.
- Drag PDF here.
- Continue reading from last session.

Disabled future actions should look disabled and include a short title tooltip.

### Reader Workspace

Layout:

- Top toolbar with open, search, page, previous/next, history back/forward, zoom, fit width, fit page, bookmark, annotation, recent files, and more.
- Document tab strip below the toolbar.
- Left panel changes by mode: recent files, bookmarks, annotations, page thumbnails, or search results.
- Center PDF surface.
- Right inspector changes by mode: document info, search controls, annotation detail, or local file actions.
- Bottom status bar with local file status, saved progress, current page, zoom, and shortcut hint.

The PDF surface is the visual priority. Side panels should be useful but not overpower the document.

### Search Mode

Left panel:

- Search field.
- Result count.
- Sort or relevance control.
- Result cards by page and match count.

Right inspector:

- Current match index.
- Previous and next match.
- Jump to page.
- Fit width and fit page.
- Case-sensitive and whole-word toggles.
- Clear search.

### Annotation Mode

Left panel:

- Bookmarks tab.
- Annotations tab.
- Add bookmark.
- Add page note.
- Filter annotations.
- Import JSON.
- Export JSON.

Right inspector:

- Annotation type.
- Page location.
- Quote or selected text.
- Editable note.
- Color.
- Tags.
- Created metadata.
- Edit, delete, copy text, mark resolved or todo, and jump to location.

### Settings And Tag Manager

Settings uses a dedicated workspace similar to the prototype:

- Left settings nav.
- Main settings panel.
- Save/cancel controls.
- Restore defaults.

Tag manager uses a similar structure:

- Left tag list with search.
- Main tag detail and relations.
- Actions for rename, color, merge, delete, and batch maintenance.

## Error Handling

Every important failure path should produce a visible state.

Required errors:

- Native file dialog permission or plugin failure.
- Desktop file missing.
- Desktop path is not a file.
- Desktop file is not a PDF.
- File read permission denied.
- Browser file read failure.
- Blob URL creation failure.
- PDF.js load failure.
- PDF.js load timeout.
- Viewer command called before viewer is ready.
- SQLite migration failure.
- Preferences save or load failure.
- Tag merge or delete failure.
- Annotation save or delete failure.

Errors should include:

- What failed.
- Why it likely failed when known.
- A recovery action: retry, reopen, close tab, reset setting, or view details.

## Validation Plan

Automated validation:

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check`
- `cargo test --manifest-path src-tauri/Cargo.toml`

Frontend tests should cover:

- `useDocumentOpening` success and failure paths.
- Browser file picker open.
- Drag-and-drop open.
- Desktop open through bridge.
- Session restore success and missing-file recovery.
- Viewer load success, load error, and timeout.
- Controller binding for page, search, zoom, fit width, and fit page.
- Tag store operations.
- Favorite store operations.
- Annotation note editing and tag attachment.
- Shortcut conflict display.
- Settings save and load.

Rust tests should cover:

- Migration tracking and repeated database open.
- Preferences commands.
- Favorites commands.
- Tag CRUD, merge, and relation commands.
- PDF read error categorization.

Manual test checklist:

- Desktop app starts.
- Desktop `Open PDF` opens the native file dialog.
- Browser `Choose` opens and renders a PDF in dev mode.
- Drag-and-drop opens and renders a PDF.
- Viewer shows pages instead of infinite loading.
- Search finds text and navigates matches.
- Page jump, previous/next, history back/forward work.
- Zoom, fit width, and fit page work.
- Add, list, jump to, and delete bookmark.
- Add highlight, underline, page note, and selected-text note.
- Edit annotation note, color, and tags.
- Import and export annotations as JSON.
- Favorite and unfavorite a document.
- Create, rename, color, merge, and delete tags.
- Attach tags to documents and annotations.
- Recent files reopen.
- Session restores after restart.
- Preferences save and reload.
- Disabled future entry points do not pretend to work.

## Implementation Slices

Implementation should be split into independent commits:

1. Stabilize PDF open and render path, viewer state, loading timeout, and Tauri capabilities.
2. Add migration tracking, preferences commands, favorites, and tags persistence.
3. Refactor package structure and make `App.tsx` thin.
4. Build the prototype-aligned home dashboard and reader workspace.
5. Complete bookmarks, annotations, notes, tags, favorites, recent files, session restore, and settings wiring.
6. Add validation coverage, manual checklist, and README alignment.

Each slice should keep changes scoped and avoid unrelated refactoring.

## Completion Criteria

The implementation is complete when:

- All in-scope features are visible and manually testable.
- The user can open a normal PDF from browser `Choose`, desktop `Open PDF`, drag-and-drop, recent files, and Open With.
- The PDF no longer remains in infinite loading without a visible error or timeout.
- `App.tsx` is a thin entry point.
- The UI matches the supplied prototype's structure and visual direction.
- Favorites, tags, bookmarks, annotations, notes, preferences, recent files, and session restore persist through SQLite.
- Existing user data and existing migrations are preserved.
- Disabled future features are visibly disabled.
- Automated validation passes or any remaining failure is documented with cause and next action.
