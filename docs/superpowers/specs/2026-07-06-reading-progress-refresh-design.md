# SmartReader Reading Progress Refresh Design

Date: 2026-07-06

## Purpose

SmartReader should persist reading progress from the current page and total page count, and the home/history surfaces should update immediately after a PDF is opened or its reading position changes.

The current code already has the core data shape for this feature: `DocumentSession` tracks `page`, `totalPages`, and `progress`; `PersistedDocument` tracks `lastPage`, `pageCount`, and `progress`; and the Tauri documents table already stores `last_page`, `page_count`, and `progress`. The missing behavior is reliable synchronization between the active reader session, persistent storage, and the in-memory `recentDocuments` list used by the home UI.

This design uses the confirmed option 3: update memory immediately and write to persistence with debounce. It does not start the app automatically and does not use browser or computer-control verification.

## Requirements Covered

- `SR-PROGRESS-001`: Calculate reading progress from read page count and total page count.
- `SR-PROGRESS-002`: Persist both read page count and total page count for each opened PDF.
- `SR-PROGRESS-003`: Persist the derived progress value consistently with `lastPage / pageCount`.
- `SR-PROGRESS-004`: Newly opened PDF files should appear in the current in-memory recent/history list without restarting the app.
- `SR-PROGRESS-005`: Page changes should refresh home/history progress immediately in memory.
- `SR-PROGRESS-006`: Database writes should be debounced to avoid excessive writes while paging.
- `SR-PROGRESS-007`: Existing session restore, reopen, favorites, bookmarks, annotations, and viewer behavior should be preserved.
- `SR-PROGRESS-008`: The implementation should stay within existing project style and avoid unnecessary new architecture.

## Scope

In scope:

- Synchronizing `DocumentSession` changes into `recentDocuments` in memory.
- Persisting `PersistedDocument.lastPage`, `PersistedDocument.pageCount`, and `PersistedDocument.progress` after open/load/progress changes.
- Reusing the existing progress formula and clamping behavior.
- Reusing existing persistence APIs and database columns.
- Focused tests for immediate recent-list refresh and progress persistence inputs.

Out of scope:

- New database migration or schema changes.
- Removing recent-file records.
- File-system reveal support.
- New global state library or routing layer.
- Changing how PDF pages are rendered or navigated.
- Automatically starting the application for runtime testing.

## Existing Context

Relevant current files:

- `src/app/ReaderApp.tsx` owns `documents`, `recentDocuments`, viewer state, and top-level persistence wiring.
- `src/documents/documentSessionStore.ts` updates active session progress and calculates `progress` from `page / totalPages`.
- `src/documents/documentModels.ts` defines `DocumentSession` and `ProgressUpdate`.
- `src/viewer/PdfViewerBridge.tsx` reports page changes and document load page count.
- `src/reader/hooks/useDocumentOpening.ts` opens desktop/browser PDFs and can save an initial document record.
- `src/reader/hooks/useReaderPersistence.ts` already creates debounced session persistence.
- `src/reader/hooks/useSessionRestore.ts` loads persisted recent documents into memory on startup.
- `src/persistence/persistenceApi.ts` exposes `saveDocument` and `listRecentDocuments`.
- `src-tauri/src/db.rs` and `src-tauri/src/migrations/001_init.sql` already support `page_count`, `last_page`, and `progress`.

The issue is not a missing database column. The issue is that data written to the database is not consistently reflected back into `recentDocuments` during the current process lifetime.

## Design Decision

Use immediate in-memory synchronization plus debounced document persistence.

Confirmed approach:

1. When a PDF opens, create or activate its `DocumentSession` as today.
2. When the viewer reports document load or page changes, update the session through the existing session store.
3. In the same progress path, convert the affected session into a `PersistedDocument` shape.
4. Upsert that document into `recentDocuments` immediately so home/history UI updates without restart.
5. Schedule `persistence.saveDocument()` through a debounced document save path so the database catches up without writing on every rapid page event.

Why this fits:

- The UI becomes responsive immediately because it no longer waits for a restart-time reload from SQLite.
- The database remains the source of truth across restarts.
- Debounced writes prevent excessive persistence calls when the viewer emits many progress events.
- The change aligns with existing `ReaderApp` ownership of both session state and recent-document state.
- No schema migration is needed because the required columns already exist.

Rejected alternatives:

- Writing to SQLite on every page event was rejected because it is unnecessarily noisy and may degrade performance during fast paging.
- Saving only on close, app exit, or document switch was rejected because it does not solve the current stale in-memory history problem.
- Introducing Observer, Strategy, Factory, or a new global store was rejected because the current problem is a narrow state synchronization issue. A small typed helper is clearer and consistent with the existing codebase.

## Progress Rules

The persisted values should be:

- `lastPage`: the current one-based page number reported by the viewer/session.
- `pageCount`: the total page count reported by the viewer when known; otherwise `null`.
- `progress`: `lastPage / pageCount` when `pageCount` is known and greater than zero; otherwise `0`.

The progress value should stay clamped between `0` and `1`, matching the existing session calculation style.

If a document is opened before total pages are known, the in-memory recent record may initially have `pageCount: null` and `progress: 0`. After document load reports total pages, the same record should be updated with the correct page count and progress.

## Data Flow

Reader progress flow:

1. `PdfViewerBridge` emits `onPageChange(page, totalPages)` from document load and page change callbacks.
2. `ReaderApp` receives the progress event and calls `updateSessionProgress()`.
3. The updated session contains the latest `page`, `totalPages`, and `progress`.
4. `ReaderApp` upserts a mapped `PersistedDocument` into `recentDocuments` immediately.
5. `ReaderApp` schedules a debounced `saveDocument()` for the same mapped document.
6. Home components receive the updated `recentDocuments` prop and re-render automatically.

Open-new-document flow:

1. `useDocumentOpening` adds or activates a session for the selected PDF.
2. The active document can be upserted into `recentDocuments` as soon as enough metadata exists to create a `PersistedDocument`.
3. If total pages are unknown at open time, the record is still visible with unknown page count.
4. When `PdfViewerBridge` reports total pages, progress synchronization updates the same record.

Startup flow:

1. `useSessionRestore` continues loading `listRecentDocuments()` on startup.
2. Restored recent data remains compatible with the new runtime synchronization.
3. No migration or data repair is required.

## Component and Helper Changes

Recommended implementation shape:

- Add a small local helper in `ReaderApp.tsx` or a nearby focused module to upsert a `PersistedDocument` into a `PersistedDocument[]` by `documentKey`.
- Reuse the existing `mapSessionToPersistedDocument(session)` mapping so persistence and in-memory recent state use the same values.
- Add a debounced document save helper similar in spirit to existing session persistence debouncing.
- Keep `documentSessionStore.calculateProgress()` behavior as the single session-side calculation unless the implementation needs a small exported helper to avoid duplicated formulas.

The helper should preserve recent-list ordering expectations. If the current list ordering depends on the database `last_opened_at`, the in-memory upsert should place the newly opened or recently updated document at the top, while keeping missing records and other ordering behavior consistent with existing home display expectations.

## Error Handling

- If `saveDocument()` fails, keep the in-memory recent record because the user has genuinely opened or read the document during the current session.
- Do not show a new blocking error for debounced progress save failure unless the project already has a suitable non-intrusive notice pattern for background persistence errors.
- Existing open/load errors should continue to mark the document session error through current reader error handling.
- Browser-file sessions should preserve existing behavior for metadata such as `fileSize` and `modifiedAt`.
- Desktop-path sessions should preserve the desktop path and display name.

## Testing Plan

Focused frontend tests should cover:

- A newly opened PDF is added to the in-memory recent documents list without requiring a fresh `listRecentDocuments()` call.
- A viewer progress event updates the active session and the corresponding recent document's `lastPage`, `pageCount`, and `progress`.
- Progress is calculated as `lastPage / pageCount` and clamped through existing behavior.
- Debounced persistence receives the mapped `PersistedDocument` with the updated page values.
- Existing recent-file reopen behavior still works after the synchronization change.

Focused backend tests are only needed if Rust persistence code changes. If no Tauri persistence code changes, existing `db.rs` document upsert/list tests are sufficient as a safety net.

Recommended validation commands after implementation:

- `bunx vitest run src/app/App.test.tsx src/documents/documentSessionStore.test.ts src/home/HomeRecentFilesWorkspace.test.tsx`
- `bun run typecheck`
- `cargo test --manifest-path src-tauri/Cargo.toml` only if Rust persistence code is touched.

## Acceptance Criteria

- Opening a new PDF makes it visible in current home/history recent files without restarting SmartReader.
- Moving through pages updates the recent/history progress display during the same app session.
- The database stores `lastPage`, `pageCount`, and `progress` for the document.
- Restarting the app still shows the same saved progress from persistence.
- Fast page changes do not trigger a database write for every single event.
- No existing Flyway/Tauri migration file is modified.
- No unrelated UI, routing, database, or viewer behavior is changed.
