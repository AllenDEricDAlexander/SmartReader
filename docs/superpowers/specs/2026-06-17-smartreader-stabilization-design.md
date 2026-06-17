# SmartReader Stabilization Design

Date: 2026-06-17

## Purpose

SmartReader currently has the major PDF-reader surfaces in place, but the product is not usable enough to validate manually. The immediate goal is to stabilize the existing PDF-reader MVP so the README-listed reader core works end to end: open local PDFs, render and navigate them, search, zoom, bookmark, annotate, restore sessions, reopen recent files, use shortcuts, cache safely, and integrate with desktop Open With behavior.

This design keeps the approved stack:

- React 18, TypeScript, Vite, Bun
- Tauri v2 and Rust commands
- SQLite through Rust-side persistence commands
- `@react-pdf-viewer@3.12.0` and `pdfjs-dist@3.11.174`

This is a stabilization and boundary refactor, not a product expansion.

## Current Findings

The current automated checks pass:

- `bun run typecheck`
- `bun run test`
- `bun run build`
- `cargo test --manifest-path src-tauri/Cargo.toml`

Passing validation does not prove the desktop reader works. The current tests mostly inject fake bridges, fake persistence, and fake viewer renderers. They verify mocked happy paths, not the real Tauri permission layer, native file picker, PDF worker, viewer plugin lifecycle, or SQLite reopen behavior.

The main issues identified in code are:

- Tauri v2 capability files are missing, while the frontend calls plugin APIs such as the dialog plugin.
- The frontend persistence API exposes `save_preferences` and `load_preferences`, but the Rust command handler does not register matching commands.
- The current database initialization concatenates SQL migrations and executes them on open. Existing `ALTER TABLE ... ADD COLUMN` statements are not safe to execute repeatedly against an existing database.
- `App.tsx` owns too many responsibilities: opening, restoring, caching, persistence, commands, bookmarks, annotations, side panels, and viewer orchestration.
- The `@react-pdf-viewer` plugin instances are created inside render flow, making controller bindings and plugin state fragile.
- Several README-listed capabilities are only partially wired, especially preferences and disk cache metadata.

## In Scope

Stabilize the PDF-reader core currently claimed by the README:

- Native PDF file picker.
- Browser file picker.
- Drag-and-drop PDF open.
- Desktop Open With event handling.
- Multi-tab document sessions.
- Session-scoped Blob URL rendering.
- PDF page rendering through `@react-pdf-viewer`.
- Page jump, page progress, and per-tab navigation history.
- Search, next match, and previous match.
- Zoom in, zoom out, fit width, and fit page.
- Bookmarks: add, list, jump, delete, persist.
- SmartReader-managed annotations: highlight, note, list, jump, delete, import, export, persist.
- Recent files: list, reopen, missing-file state, progress display.
- Session restore for desktop-path documents.
- Reader preferences and shortcut conflict display.
- Runtime byte cache, Blob URL cache, and a clear disk-cache contract.
- Tauri permissions, commands, and SQLite schema safety.
- Validation coverage for real contracts, not only mocked UI outcomes.

## Out of Scope

The following remain outside this stabilization:

- Category and tag taxonomy.
- Category-level encryption.
- RAG or knowledge-base features.
- Cloud sync.
- Writing annotations back into the original PDF.
- Replacing `@react-pdf-viewer`.
- Redesigning the app into a landing page or document-management suite.

If an existing README line claims a capability that remains incomplete after this work, either complete it or downgrade the README wording in the same implementation plan.

## Recommended Approach

Use a staged stabilization refactor.

Do not patch individual symptoms in the current `App.tsx` shape. Also do not rewrite the whole app from a blank slate. The current code already has useful domain modules, tests, Rust commands, and chosen dependencies. The safer path is to keep the stack and split the broken reader workflow into smaller, testable units.

The implementation should prioritize the PDF open and render path first. Every other feature depends on the app being able to open a file, create a document session, create a valid viewer source, and render the PDF.

## Target Architecture

### Frontend Boundary

`src/app/App.tsx` should become a dependency composition and layout entry point. It should not contain direct implementations for every reader behavior.

Target frontend units:

- `useReaderDocuments`
  - Owns document sessions, active session, progress, tab selection, close behavior, and per-tab navigation history.
  - Depends on document state helpers, not on Tauri directly.
- `useDocumentOpening`
  - Owns native open, browser open, drop open, Open With open, duplicate desktop-path focusing, Blob URL creation, byte cache writes, and open error reporting.
  - Depends on `TauriBridge`, `BlobUrlCache`, `PdfByteCache`, and document state actions.
- `useSessionRestore`
  - Owns startup restore, desktop-path byte rereads, missing-file session errors, restored active tab, and restored viewer source.
  - Depends on persistence, bridge, document actions, and cache helpers.
- `useReaderPersistence`
  - Provides a typed facade over recent documents, reader sessions, bookmarks, annotations, preferences, and cache metadata.
  - Keeps React components away from raw invoke command names.
- `useReaderCommands`
  - Builds the command registry from stable action callbacks.
  - Owns shortcut registration and command enablement checks.
- `ReaderShell`
  - Owns the layout skeleton and drag-drop surface.
- `ReaderToolbar`
  - Owns visible reader commands and input controls.
- `ReaderSidebar`
  - Owns reading status, bookmarks, annotations, recent files, import/export affordances, and preferences entry points.
- `ReaderWorkspace`
  - Owns the active viewer pane, empty state, and recoverable error state.

### Viewer Boundary

`PdfViewerBridge` remains the only component importing `@react-pdf-viewer/*`.

The bridge owns:

- PDF worker configuration.
- Stable plugin instances.
- Binding viewer actions to `ViewerController`.
- Translating viewer events into SmartReader events.
- Rendering saved SmartReader highlights.
- Reporting load, page, zoom, and failure events.

The app owns:

- Which document is active.
- Which session owns the Blob URL.
- Saved page, zoom, search text, bookmarks, annotations, and history.

The bridge should expose these events:

- `onDocumentLoad(totalPages)`
- `onPageChange(page)`
- `onZoomChange(zoom)`
- `onLoadError(errorMessage)`
- `onHighlightSelection(selection)`

The controller should expose these actions:

- `jumpToPage(page)`
- `openSearch()`
- `search(keyword)`
- `searchNext()`
- `searchPrevious()`
- `zoomIn()`
- `zoomOut()`
- `fitWidth()`
- `fitPage()`

Plugin instances should be memoized so command bindings do not drift on rerender.

### Tauri Boundary

The frontend should use typed adapters:

- `TauriBridge` for file and desktop integration.
- `PersistenceApi` for SQLite-backed data.

Rust should own:

- Native local file reads.
- PDF header validation for local sources.
- Database location and schema setup.
- Preferences persistence.
- Disk-cache read/write helpers if disk cache remains in scope.
- Open With event forwarding.

The frontend should not infer Tauri permission failures as generic no-op behavior. Permission and command errors should become visible, recoverable reader errors.

## Data Flow

### Open PDF

1. User opens a PDF from native dialog, browser picker, drag-drop, recent file, or Open With.
2. The selected source is normalized into a `FileSource`.
3. Desktop paths are read through `read_desktop_pdf`; browser files are read through `File.arrayBuffer()`.
4. SmartReader creates or focuses a document session by `documentKey`.
5. The byte cache stores the PDF bytes by `documentKey`.
6. The Blob URL cache creates a URL keyed by `sessionId`.
7. The active viewer source becomes `{ sessionId, url }`.
8. Desktop-path documents are saved to recent files.
9. Bookmarks and annotations for the document are loaded.
10. The viewer loads the Blob URL and reports page count, current page, and zoom changes.

Failures at any step should set a visible error state with enough context to retry or reopen.

### Switch Tab

1. User selects a tab or triggers next/previous tab.
2. Document state changes the active session.
3. The app looks up the Blob URL for that session.
4. If the Blob URL exists, the viewer source is set for that session.
5. If the Blob URL is missing for a desktop-path session, the app attempts a reread.
6. If reread fails, the session remains open in a recoverable error state.

The viewer must never display a Blob URL from another session.

### Session Restore

1. On startup, the app loads recent documents and the saved reader session.
2. Only desktop-path tabs are restored.
3. Each restored tab starts as loading or recoverable error depending on available metadata.
4. The app rereads bytes for each restored desktop path.
5. Successful rereads create session-scoped Blob URLs.
6. Missing paths are marked as recoverable errors but remain in recent files.
7. Restored page, zoom, history, active tab, and sidebar state are applied.

Browser `File` documents are runtime-only and are not restored after restart.

### Persistence

Persistence writes should be debounced for session progress and immediate for user-visible explicit actions such as adding a bookmark, deleting an annotation, or changing preferences.

React code should call typed persistence methods. Rust code should translate those into SQLite reads and writes.

## SQLite And Migration Design

The database setup needs a real schema version guard.

Add or use a `schema_migrations` table with one row per applied migration. On startup:

1. Create `schema_migrations` if missing.
2. Check which migrations have already been applied.
3. Apply only unapplied migration files in order.
4. Insert the applied version into `schema_migrations` in the same transaction.

Existing migration files should not be modified unless this repository decides they were never shipped and the user explicitly accepts that. The safer default is to add a new migration that repairs the current schema state.

The next implementation plan should inspect the existing migration history and create exactly one new migration for schema changes needed by this stabilization. That migration should cover:

- Preferences data if the existing table is insufficient.
- Cache metadata if disk cache remains enabled.
- Any compatibility columns required for recoverable errors.
- A schema migration tracking table if no equivalent exists.

## Tauri Permissions And Commands

Add `src-tauri/capabilities/default.json` for the main window.

It should authorize only the permissions needed by the current reader:

- Core event/listen permissions for Open With events.
- Dialog open permission for native PDF selection.
- Any required command invoke permissions.
- App-local filesystem permissions only if frontend filesystem plugin APIs are actually used.

The preferred local PDF read path is the Rust `read_desktop_pdf` command, so broad frontend filesystem read permissions should be avoided unless a concrete frontend API requires them.

Add Rust commands for:

- `save_preferences`
- `load_preferences`
- Disk cache write/list/delete if disk cache remains a README-listed capability

Each command needs Rust unit tests or integration-style tests around the underlying pure functions.

## Error Handling

Errors should be explicit and recoverable.

Open and restore errors should be represented as document-session state:

- `loading`
- `ready`
- `error`

Error messages should distinguish:

- Tauri permission failure.
- User cancelled file picker.
- Missing file.
- Path is not a file.
- Invalid PDF header.
- File read failure.
- Viewer load failure.
- Persistence failure.

User cancellation is not an error. Other failures should leave the app usable and should not close other tabs.

Persistence failures should not prevent PDF reading when possible. They should be surfaced as non-blocking reader warnings or side-panel status.

## UI Design

The UI should remain a utilitarian desktop reader.

Do not introduce a landing page. The first screen is the reader shell with an empty state when no document is open.

Stabilization goals:

- Toolbar controls should not overlap or disappear unexpectedly.
- Toolbar controls should have disabled states when no PDF is active.
- Text should fit inside buttons and list rows.
- Side panel should not cover or resize the viewer in a way that hides content.
- Empty state should expose open actions and recent files.
- Recent files should show missing state and allow retry.
- Active document error state should stay inside the viewer pane.
- Preferences should be a modal or contained panel with clear close behavior.

The first implementation should keep styling restrained and focus on usability.

## Feature Completion Rules

### Bookmarks

Bookmarks are page-based SmartReader records.

Required behavior:

- Add bookmark for current page.
- List bookmarks for active document.
- Jump to bookmark and record hard navigation.
- Delete bookmark.
- Persist through SQLite.
- Show errors when persistence fails.

### Annotations

Annotations remain SmartReader-managed and do not write back into the PDF.

Required behavior:

- Save highlight selection with quote and areas when viewer selection data is available.
- Add page note when no selection exists.
- List annotations for active document.
- Jump to annotation and record hard navigation.
- Delete annotation.
- Export active document annotations as JSON.
- Import annotations from JSON and persist imported records, not only local component state.

### Search

Search should use the viewer plugin through `ViewerController`.

Required behavior:

- Search input calls `search(keyword)`.
- Next and previous commands work.
- Search command opens the viewer search affordance when needed.
- Empty searches are ignored or clear search state deliberately.

### Cache

Runtime cache is required:

- PDF bytes by `documentKey`.
- Blob URLs by `sessionId`.
- Blob URLs revoked on tab close and app cleanup.

Disk cache is optional only if README wording is downgraded. If kept, it must be real:

- Write desktop PDF bytes to app cache directory.
- Store cache metadata in SQLite.
- Reuse cache only when source path, file size, and modified timestamp match.
- Fall back to direct read on cache failure.
- Enforce a simple size cap.

## Testing Strategy

### Frontend Unit Tests

Add focused tests for:

- `useReaderDocuments`
- `useDocumentOpening`
- `useSessionRestore`
- `useReaderCommands`
- persistence facade error handling
- annotation import/export persistence behavior
- bookmark add/delete/jump behavior
- tab switching with missing Blob URL

### Viewer Bridge Tests

Test bridge behavior without replacing the whole bridge with a fake app-level renderer:

- controller binds actions after mount
- `jumpToPage` uses one-based app pages and zero-based viewer pages
- search and zoom actions delegate to plugin instances
- source changes do not reuse stale session URLs
- viewer load errors report into app state

Where direct plugin testing is impractical, isolate the adapter logic and test it with small fake plugin objects.

### Rust Tests

Add tests for:

- repeated database open against the same file path
- schema migration tracking
- preferences save/load
- cache metadata save/load if disk cache remains
- file command invalid/missing/not-file cases

### Integration Tests

Maintain app-level tests for:

- native-open success with fake bridge
- native-open failure produces visible error
- browser file open
- drag-drop open
- restore success
- restore missing file
- recent reopen
- bookmark and annotation workflows
- preferences panel behavior

These tests should complement, not replace, lower-level contract tests.

### Required Validation Commands

The implementation is not complete until these pass:

```bash
bun run typecheck
bun run test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
```

If Tauri smoke validation is available without disrupting the user, add a documented manual checklist instead of auto-starting the project.

## Implementation Phases

### Phase 1: Foundation Fix

Goal: one PDF opens and renders reliably.

Scope:

- Add Tauri capability file.
- Implement the missing preferences commands and tests.
- Add migration tracking or otherwise make repeated database open safe.
- Stabilize viewer source by session.
- Stabilize viewer plugin instances.
- Show open and viewer errors in the UI.
- Add tests for these contracts.

### Phase 2: App Boundary Refactor

Goal: split `App.tsx` into small, testable units without changing the user-visible feature set.

Scope:

- Extract document state hook.
- Extract open/restore hooks.
- Extract command hook.
- Extract toolbar, sidebar, workspace components.
- Preserve current routes and public app entry.
- Keep module APIs narrow and typed.

### Phase 3: Feature Completion

Goal: make every README-listed reader feature real or downgrade its README claim.

Scope:

- Bookmarks end to end.
- Annotations end to end, including persisted import.
- Recent files and missing state.
- Session restore with active tab, page, zoom, sidebar, and history.
- Shortcut enablement and preferences.
- Runtime cache.
- Disk cache if retained in README.

### Phase 4: Validation Hardening

Goal: prevent another "tests pass, app unusable" state.

Scope:

- Add contract tests around real boundaries.
- Add repeated SQLite open tests.
- Add viewer controller tests.
- Add open/restore integration coverage.
- Refresh README to match only verified behavior.

## Acceptance Criteria

The stabilization is complete when:

- A local PDF can be opened from native dialog, browser picker, drag-drop, recent list, and Open With path.
- The active PDF renders in the viewer pane.
- Switching tabs never displays another tab's PDF.
- Closing a tab revokes its Blob URL and selects a sensible fallback tab.
- Page jump, search, zoom, fit width, and fit page work through the SmartReader toolbar and shortcuts.
- Bookmarks persist and can be jumped to and deleted.
- Annotations persist and can be jumped to, deleted, exported, and imported.
- Desktop-path sessions restore after app restart.
- Missing restored files show recoverable errors.
- Preferences save and load through Rust commands.
- Database setup works against a fresh database and an existing database.
- README claims match implemented behavior.
- Required validation commands pass.

## Risks

- `@react-pdf-viewer` may still expose plugin-level limitations after the bridge is stabilized. If the viewer remains unreliable after Phase 1, the next design decision should be whether to replace the viewer library.
- Existing local SQLite databases may already be in inconsistent states. The implementation plan should include a compatibility strategy for development databases.
- Disk cache can become larger than the core MVP needs. If it delays PDF usability, downgrade README wording and keep runtime cache only for the first stabilization.

## Non-Goals For The Implementation Plan

The implementation plan should not include:

- New product surfaces outside the PDF-reader MVP.
- A new PDF rendering engine.
- A broad visual redesign.
- Rewriting all tests from scratch.
- Multiple simultaneous architecture experiments.

The work should stay incremental: stabilize the root path, split boundaries, complete claimed behavior, then harden validation.
