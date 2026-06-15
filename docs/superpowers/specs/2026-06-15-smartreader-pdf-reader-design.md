# SmartReader PDF Reader Design

Date: 2026-06-15

## Purpose

SmartReader is a desktop PDF reader built with React, TypeScript, Bun, and Tauri. The product centers on local PDF reading and desktop workflow support: opening local PDFs, reading, searching, jumping, zooming, bookmarks, annotations, recent files, session restore, shortcuts, cache, and desktop system integration.

The README contains older technical notes. This design intentionally resets the technical plan and uses `@react-pdf-viewer` as the PDF viewer foundation.

## In Scope

- Local PDF open flows:
  - browser file picker
  - drag and drop
  - Tauri native file dialog
  - system Open With events
  - PDF file association
  - focusing an existing tab when the same desktop path is opened again
- PDF reading:
  - multi-tab reading
  - page rendering
  - continuous reading
  - current page and total page state
  - loading and error states
- Search:
  - search input entry point
  - next and previous match
  - jump to match
  - search status feedback
- Jumping and history:
  - page number jump
  - bookmark jump
  - search result jump
  - per-tab back and forward history
  - ordinary scrolling updates progress but does not create hard navigation history
- Zoom:
  - zoom in
  - zoom out
  - fit width
  - fit page
  - visible zoom state
- Bookmarks:
  - per-document bookmarks
  - add, delete, list, and jump
  - persisted through SQLite
- Annotations:
  - SmartReader-managed highlights and text notes
  - annotation list
  - jump to annotation
  - delete annotation
  - persisted through SQLite
  - no PDF file write-back in the first design
- Recent files:
  - file name, path, reading progress, last page, last opened time
  - reopen and restore position
  - missing-file state when a previously opened path is unavailable
- Session restore:
  - opened desktop-path tabs
  - active tab
  - page, zoom, reading progress
  - sidebar state
  - bookmarks and annotations
- Shortcuts:
  - open file
  - close tab
  - find
  - next and previous match
  - toggle sidebar
  - zoom
  - page jump
  - history back and forward
  - tab switching
- Cache:
  - runtime PDF byte cache
  - session-scoped Blob URL cache
  - optional disk cache for large desktop PDFs
  - debounced persistence writes
- Desktop integration:
  - Tauri window
  - native file dialog
  - local file reads
  - Open With event handling
  - file association
  - Rust fallback for local file read and basic PDF validation

## Out of Scope

- Category and tag management for recent files
- Category-level encryption
- PDFKit managed-copy sync
- Writing annotations back into the original PDF file
- Cloud sync
- Knowledge base or RAG features
- Full document library taxonomy
- Replacing PDF content rendering with a custom PDF engine

## Technical Choice

Use `@react-pdf-viewer` as the primary PDF viewer stack.

The viewer package provides a React-oriented PDF.js wrapper and a plugin model for toolbar, page navigation, search, zoom, selection, and highlighting behavior. SmartReader will use those viewer capabilities where possible and keep application-level state outside the viewer.

There is one important risk: the upstream `react-pdf-viewer` GitHub repository is archived and its public site indicates commercial licensing. The implementation should still wrap viewer usage behind a small `PdfViewerBridge` interface so the rest of the app does not depend directly on plugin internals.

## Product Layout

The UI follows a macOS utility-style desktop reader layout:

- top tab strip for opened PDFs
- compact toolbar for file, search, navigation, zoom, and side panel commands
- collapsible side panel for bookmarks, annotations, search results, and document status
- document-first main reading area
- responsive toolbar simplification for narrow windows

The first screen should be the actual reader shell, not a landing page. When no PDF is open, the shell shows a quiet empty state with open-file and drag-drop affordances.

## Architecture

### Frontend Modules

- `app/`
  - application shell
  - global providers
  - top-level layout composition
- `viewer/`
  - `PdfViewerBridge`
  - `@react-pdf-viewer` plugin setup
  - viewer event adapters
  - Blob URL lifecycle binding
- `documents/`
  - opened document sessions
  - tab state
  - active document selection
  - per-tab reading history
- `library/`
  - recent files
  - reopen behavior
  - missing-file state
- `annotations/`
  - bookmarks
  - highlights
  - text notes
  - sidebar list models
- `commands/`
  - command registry
  - shortcut registration
  - menu and toolbar command binding
- `persistence/`
  - SQLite access layer
  - migrations
  - debounced writes
  - restore queries
- `platform/`
  - Tauri dialog, fs, and event adapters
  - desktop path normalization
  - Rust command invocation
- `cache/`
  - runtime byte cache
  - Blob URL cache
  - optional disk cache metadata
- `preferences/`
  - reader defaults
  - shortcut settings
  - session restore settings

### Rust/Tauri Modules

- file read fallback
- basic PDF validation
- path normalization
- Open With event forwarding
- application data/cache directory resolution
- SQLite connection setup through explicit Rust commands

SQLite access should be implemented through explicit Rust commands instead of making React components depend on SQL plugin calls. This keeps filesystem permissions, database location, migrations, and atomic writes on the desktop side while preserving a typed frontend repository interface.

## State Boundaries

SmartReader owns:

- documents and tabs
- recent files
- session restore
- bookmarks
- SmartReader-managed annotations
- command registry
- shortcuts
- cache metadata
- preferences

`@react-pdf-viewer` owns:

- PDF rendering
- page viewport rendering
- plugin-level search mechanics
- plugin-level zoom behavior
- plugin-level page navigation behavior

Initial viewer plugins:

- `default-layout` only if its bundled layout can be stripped down cleanly
- `toolbar` for compact toolbar building blocks
- `page-navigation` for page jump and current page state
- `search` for text search and next/previous match
- `zoom` for zoom controls and fit modes
- `highlight` for SmartReader-managed highlight capture when the plugin data is stable enough

The bridge between them should be narrow:

- load this document source
- jump to page
- set zoom or fit mode
- open search UI / run search command
- report page and zoom changes
- report selection/highlight data when available

## Open File Flow

1. The user opens a PDF from a browser file picker, drag-drop, native dialog, or Open With event.
2. SmartReader creates a `FileSource`.
3. For desktop paths, SmartReader normalizes the path and checks whether an open tab already uses the same `documentKey`.
4. If already open, SmartReader focuses the existing tab.
5. If not open, SmartReader reads bytes through the Tauri fs path. If that fails, it uses the Rust fallback command.
6. SmartReader performs lightweight PDF validation.
7. SmartReader creates a document session and a session-scoped Blob URL.
8. The viewer receives the Blob URL through `PdfViewerBridge`.
9. Recent-file metadata and session state are written to SQLite with debounce.

Browser `File` objects are readable for the current runtime session but cannot be restored after app restart unless the user reopens the file. Desktop paths are the primary restore-capable source.

## Persistence Design

Use SQLite for structured local state.

SQLite runs on the Tauri/Rust side. React calls typed persistence commands rather than issuing SQL directly.

Proposed tables:

- `documents`
  - `id`
  - `document_key`
  - `path`
  - `display_name`
  - `file_size`
  - `modified_at`
  - `page_count`
  - `last_opened_at`
  - `last_page`
  - `progress`
  - `missing`
- `sessions`
  - `id`
  - `active_document_id`
  - `sidebar_open`
  - `created_at`
  - `updated_at`
- `session_tabs`
  - `id`
  - `session_id`
  - `document_id`
  - `tab_order`
  - `page`
  - `zoom`
  - `history_json`
  - `updated_at`
- `bookmarks`
  - `id`
  - `document_id`
  - `page`
  - `title`
  - `created_at`
- `annotations`
  - `id`
  - `document_id`
  - `page`
  - `type`
  - `color`
  - `text`
  - `quote`
  - `position_json`
  - `created_at`
  - `updated_at`
- `preferences`
  - `key`
  - `value_json`
  - `updated_at`
- `cache_entries`
  - `id`
  - `document_id`
  - `cache_key`
  - `file_path`
  - `size`
  - `created_at`
  - `last_used_at`

Migration files should be append-only. If schema changes are needed after implementation starts, add a new migration rather than editing an existing migration.

## Cache Design

Runtime cache:

- maps `documentKey` to PDF bytes while the app is open
- maps `sessionId` to Blob URL
- revokes Blob URLs when tabs close or source changes

Disk cache:

- stores large PDF byte copies only when useful
- does not replace the original file path as the source of truth
- records cache metadata in SQLite
- falls back safely if cache read/write fails

Persistence writes:

- page, zoom, progress, sidebar state, bookmarks, and annotations use debounced writes
- close-app and close-tab events force a final flush when possible

## Navigation History

Each tab has its own history stack.

History entries are created by:

- page number jump
- bookmark jump
- search result jump
- explicit viewer navigation event when the bridge can identify it as a hard jump
- back or forward navigation

History entries are not created by:

- mouse wheel scroll
- trackpad scroll
- zoom
- search typing
- preference changes
- ordinary progress updates

This keeps back and forward useful in continuous-reading mode.

## Bookmarks And Annotations

Bookmarks are simple page-based records owned by SmartReader.

Annotations are SmartReader-managed records. The first implementation supports:

- highlight metadata when selection coordinates are available from the viewer
- text notes attached to a page or selection
- sidebar listing
- jump to annotation
- delete annotation

Annotations are not written back into the PDF file. This avoids destructive file writes and keeps the first version focused on reader workflow.

## Desktop Integration

Tauri handles:

- native window and packaging
- native file dialog
- local file access
- Open With events
- file association configuration
- Rust fallback commands

The frontend should not assume browser permissions for desktop paths. Desktop path access goes through `platform/` adapters.

## Error Handling

- File missing:
  - keep the recent-file row
  - mark the document as missing
  - show reopen/locate action
- Permission denied:
  - keep the tab in recoverable error state
  - show a concise permission error
- Invalid PDF:
  - show open failure
  - do not update reading progress
- Password-protected PDF:
  - rely on viewer password flow when available
  - keep tab state recoverable
- Viewer load failure:
  - revoke the failed Blob URL
  - keep the session but mark it failed
- SQLite failure:
  - keep runtime reading functional
  - show persistence warning only when user data may not save
- Cache failure:
  - fall back to direct read
  - do not block reading

## Phasing

### Phase 1: Reader MVP

- scaffold React, TypeScript, Bun, Vite, and Tauri v2
- integrate `@react-pdf-viewer`
- implement reader shell, tabs, toolbar, sidebar
- open local PDFs through file picker, drag-drop, and native dialog
- read desktop paths through Tauri/Rust fallback
- render PDFs with loading/error states
- page navigation, search, zoom, fit width/page
- session-scoped Blob URL handling
- SQLite persistence through Rust commands for documents, sessions, tabs, preferences
- recent files list
- session restore for desktop-path PDFs
- command registry and default shortcuts
- targeted tests for document/session/cache/persistence state

### Phase 2: Bookmarks And Annotations

- bookmarks table and UI
- bookmark jump and deletion
- SmartReader-managed highlight records
- text notes
- annotation sidebar
- annotation jump and deletion
- persistence tests

### Phase 3: Desktop Polish

- Open With handling
- PDF file association
- menu integration
- missing-file recovery
- cache metadata and optional disk cache
- close-app flush behavior
- shortcut conflict warning

### Phase 4: Reading Quality

- responsive toolbar simplification
- trackpad zoom if feasible
- larger-file responsiveness tuning
- search result side panel polish
- import/export of SmartReader annotation data if needed

## Validation Plan

Use targeted validation first:

- `bun run typecheck`
- `bun test`
- Tauri/Rust tests for file commands
- focused tests for:
  - duplicate desktop path opens focus existing tab
  - session-scoped Blob URL does not leak across tabs
  - ordinary scroll does not create navigation history
  - hard jumps create navigation history
  - SQLite restore rebuilds tabs and active document
  - missing desktop path restores as recoverable state

Manual validation, run by the user after implementation:

- open one PDF
- open two PDFs and switch between tabs
- reopen the same desktop path and confirm focus behavior
- search text and jump between matches
- zoom and fit modes
- close and reopen the app to confirm session restore
- test Open With after desktop integration phase

The agent should not start the project automatically after implementation. The user will initiate runtime testing.

## Implementation Constraints

- Use `@react-pdf-viewer` as the viewer foundation.
- Access SQLite through explicit Rust commands and a typed frontend repository layer.
- Keep `PdfViewerBridge` small so the application state model is not coupled to plugin internals.
- If highlight coordinates from the viewer are not stable enough, store page-attached notes and text quotes first, then improve highlight fidelity later.
- Do not write annotations back into the original PDF file in this design.

## Approval State

The user approved the direction:

- use `@react-pdf-viewer`
- reset technical choices from the old README
- implement only the core PDF reader capabilities listed above
- use SQLite for structured persistence
