# SmartReader PDF Core Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the approved SmartReader PDF-reader core so local PDF reading has durable recent files, full session restore, search, jump, zoom, bookmarks, SmartReader-managed annotations, shortcuts, cache, and desktop integration.

**Architecture:** Keep `@react-pdf-viewer` isolated behind `src/viewer/PdfViewerBridge.tsx`. SmartReader owns application state, commands, recent files, bookmarks, annotations, preferences, cache metadata, and SQLite persistence through typed frontend APIs backed by Rust commands. Add exactly one new SQLite migration for the remaining structured state and keep browser-only files runtime-only.

**Tech Stack:** Bun, Vite, React 18, TypeScript, Vitest, Tauri v2, Rust, rusqlite, `@react-pdf-viewer@3.12.0`, `pdfjs-dist@3.11.174`, lucide-react.

---

## Requirement Checklist

This plan implements the PDF-reader core that is still incomplete on `main`.

- Validation hygiene:
  - `bun run test` must ignore local `.worktrees/**`.
  - The validation command set must be stable: `bun run typecheck`, `bun run test`, `bun run build`, `cargo test --manifest-path src-tauri/Cargo.toml`.
- Local PDF open:
  - Browser file picker using `<input type="file" accept="application/pdf,.pdf">`.
  - Drag-drop PDF open.
  - Tauri native PDF dialog.
  - Desktop Open With event routing into the running app.
  - PDF file association in Tauri bundle config.
  - Duplicate desktop paths focus the existing tab.
- Reading and restore:
  - Persist desktop-path documents on open and on progress change.
  - Restore desktop-path tabs by reading bytes again through Rust/Tauri.
  - Restore active tab, page, zoom, sidebar state, and per-tab history.
  - Mark missing files as recoverable errors without deleting recent rows.
  - Browser `File` tabs remain runtime-only and are not restored after restart.
- Search, jump, and zoom:
  - External SmartReader search input calls the viewer search plugin.
  - Search next and previous shortcuts work.
  - Page jump input records hard navigation.
  - Fit width and fit page commands are exposed in the toolbar and shortcuts.
  - Trackpad pinch/`ctrlKey` wheel zoom works inside the viewer pane.
- Reading history:
  - Per-tab back and forward history is wired to shortcuts.
  - Ordinary scroll/progress updates do not create history.
  - Page jump, search jump, bookmark jump, annotation jump, history back, and history forward are hard navigation events.
- Bookmarks:
  - Add, delete, list, and jump per document.
  - Persist through SQLite.
  - Show in the side panel.
- Annotations:
  - Store SmartReader-managed highlight records and page notes.
  - Capture highlight areas and selected text when `@react-pdf-viewer/highlight` provides them.
  - Add page note when no text selection exists.
  - List, jump, delete, JSON export, and JSON import.
  - Do not write annotations back into the original PDF file.
- Recent files:
  - Show a grid/list section in the empty state or side panel.
  - Reopen desktop-path entries.
  - Show progress, last page, last opened time, file size, missing state, and path on hover/focus.
- Cache:
  - Runtime byte cache by `documentKey` to avoid repeat reads while the app is open.
  - Blob URL cache by `sessionId`.
  - Disk cache for desktop PDFs with SQLite metadata and a simple size cap.
  - Cache failures fall back to direct file reads.
- Shortcuts and preferences:
  - All default command IDs run real actions.
  - Shortcut conflict warnings are visible in preferences.
  - Preferences persist session restore, default zoom mode, and shortcut overrides.
- Desktop integration:
  - Single-instance plugin forwards second-instance args to the frontend.
  - The frontend filters `.pdf` paths from Open With args and opens them.
  - Bundle file association declares `.pdf` and `application/pdf`.

Explicitly excluded from this plan because they were removed from the approved PDF-reader core: category/tag taxonomy, category-level encryption, RAG/knowledge-base features, cloud sync, and writing annotations back into original PDFs.

## File Structure

Modify existing files:

- `vite.config.ts`  
  Owns Vitest include/exclude rules.
- `package.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`  
  Add the Tauri single-instance plugin.
- `src-tauri/tauri.conf.json`  
  Add PDF file association and bundle icon references if needed.
- `src-tauri/src/lib.rs`  
  Register single-instance first and emit Open With paths.
- `src-tauri/src/db.rs`  
  Add commands for session snapshots, bookmarks, annotations, preferences, and cache metadata.
- `src-tauri/src/file_commands.rs`  
  Add path existence and cache read/write helpers.
- `src/app/App.tsx`, `src/app/App.test.tsx`, `src/app/styles.css`  
  Wire app shell, browser picker, restore, persistence, side panel, recent files, bookmarks, annotations, search, page jump, shortcuts, preferences, and cache warnings.
- `src/viewer/PdfViewerBridge.tsx`, `src/viewer/PdfViewerBridge.test.tsx`  
  Expand viewer action bindings for search, highlight capture, annotation rendering, document load, pinch zoom, and jump-to-highlight.
- `src/viewer/viewerController.ts`, `src/viewer/viewerController.test.ts`, `src/viewer/viewerTypes.ts`  
  Expand the bridge command interface.
- `src/documents/documentModels.ts`, `src/documents/documentSessionStore.ts`, `src/documents/documentSessionStore.test.ts`, `src/documents/readingHistory.ts`, `src/documents/readingHistory.test.ts`  
  Add per-tab history and restore metadata.
- `src/persistence/persistenceApi.ts`, `src/persistence/persistenceApi.test.ts`  
  Add typed frontend API methods for all new Rust commands.
- `src/library/recentFiles.ts`, `src/library/recentFiles.test.ts`  
  Add rich recent-file mapping and reopen state.
- `src/cache/blobUrlCache.ts`, `src/cache/blobUrlCache.test.ts`  
  Keep Blob URL behavior and add byte cache tests if shared cache lives here.
- `src/commands/commandRegistry.ts`, `src/commands/commandRegistry.test.ts`  
  Add commands for find, page focus, fit width/page, bookmark add, note add, preferences, import/export, and tab switching.

Create new files:

- `src-tauri/src/migrations/002_reader_core_completion.sql`  
  Adds remaining tables and compatible columns. This is the only new migration in this plan.
- `src/cache/pdfByteCache.ts`, `src/cache/pdfByteCache.test.ts`  
  Runtime byte cache by document key.
- `src/preferences/preferencesModels.ts`, `src/preferences/preferencesStore.ts`, `src/preferences/preferencesStore.test.ts`  
  Typed preferences and shortcut merge logic.
- `src/annotations/annotationModels.ts`, `src/annotations/annotationStore.ts`, `src/annotations/annotationStore.test.ts`  
  Bookmark and annotation state helpers.
- `src/platform/browserFilePicker.ts`, `src/platform/browserFilePicker.test.ts`  
  Browser file picker adaptation.
- `src/platform/openWithEvents.ts`, `src/platform/openWithEvents.test.ts`  
  Frontend listener for desktop Open With events.
- `src/platform/pathFilters.ts`, `src/platform/pathFilters.test.ts`  
  PDF path filtering for Open With args.
- `src/persistence/debounce.ts`, `src/persistence/debounce.test.ts`  
  Debounced and flushable persistence scheduling.
- `src/test/renderApp.tsx`  
  Shared test render helper that always calls `cleanup()`.

## Task 1: Stabilize Test Discovery And Shared App Test Cleanup

**Files:**

- Modify: `vite.config.ts`
- Create: `src/test/renderApp.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add a failing assertion for clean App tests**

Append this test to `src/app/App.test.tsx`:

```tsx
it('keeps one reader workspace per render', () => {
  render(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={createEmptyPersistence()}
      viewerRenderer={testViewerRenderer}
    />,
  );

  expect(screen.getAllByLabelText('Reader workspace')).toHaveLength(1);
});
```

- [ ] **Step 2: Run the full frontend test command to confirm current failure source**

Run:

```bash
bun run test
```

Expected: FAIL because Vitest discovers `.worktrees/smartreader-mvp/**` and the App tests render duplicate workspaces.

- [ ] **Step 3: Exclude local worktrees and generated output from Vitest**

Replace the `test` block in `vite.config.ts` with:

```ts
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.worktrees/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
    ],
  },
```

- [ ] **Step 4: Add a shared render helper**

Create `src/test/renderApp.tsx`:

```tsx
import { cleanup, render, type RenderOptions } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

export function renderApp(ui: ReactElement, options?: RenderOptions) {
  return render(ui, options);
}
```

- [ ] **Step 5: Use the shared helper in App tests**

In `src/app/App.test.tsx`, replace:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
```

with:

```tsx
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '../test/renderApp';
```

Then replace every `render(` call with `renderApp(`.

- [ ] **Step 6: Verify**

Run:

```bash
bun run test
```

Expected: PASS with the current 36 tests plus the new App cleanup test.

- [ ] **Step 7: Commit**

```bash
git add vite.config.ts src/test/renderApp.tsx src/app/App.test.tsx
git commit -m "test: stabilize SmartReader frontend test discovery"
```

## Task 2: Add Reader-Core SQLite Migration

**Files:**

- Create: `src-tauri/src/migrations/002_reader_core_completion.sql`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Add migration tests before implementation**

Append this test to the `tests` module in `src-tauri/src/db.rs`:

```rust
#[test]
fn opens_reader_core_schema() {
    let connection = Connection::open_in_memory().expect("in-memory database");
    connection
        .execute_batch(INIT_SQL)
        .expect("schema applies");

    let tables = [
        "bookmarks",
        "annotations",
        "cache_entries",
        "preferences",
        "sessions",
        "session_tabs",
    ];

    for table in tables {
        let count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |row| row.get(0),
            )
            .expect("table count");
        assert_eq!(count, 1, "{table} table should exist");
    }

    let favorite_column_count: i64 = connection
        .query_row(
            "SELECT count(*) FROM pragma_table_info('documents') WHERE name = 'last_error'",
            [],
            |row| row.get(0),
        )
        .expect("column count");
    assert_eq!(favorite_column_count, 1);
}
```

- [ ] **Step 2: Run Rust tests to verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests::opens_reader_core_schema
```

Expected: FAIL because `bookmarks`, `annotations`, `cache_entries`, and `documents.last_error` do not exist.

- [ ] **Step 3: Add the append-only migration file**

Create `src-tauri/src/migrations/002_reader_core_completion.sql`:

```sql
ALTER TABLE documents ADD COLUMN last_error TEXT;
ALTER TABLE documents ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE documents ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS bookmarks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL,
    page INTEGER NOT NULL,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(document_key, page, title)
);

CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL,
    page INTEGER NOT NULL,
    type TEXT NOT NULL,
    color TEXT NOT NULL,
    text TEXT,
    quote TEXT,
    areas_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_key TEXT NOT NULL UNIQUE,
    source_path TEXT NOT NULL,
    cache_path TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    modified_at TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS open_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    received_at TEXT NOT NULL,
    handled INTEGER NOT NULL DEFAULT 0
);
```

- [ ] **Step 4: Include both migrations in order**

At the top of `src-tauri/src/db.rs`, replace:

```rust
const INIT_SQL: &str = include_str!("migrations/001_init.sql");
```

with:

```rust
const INIT_SQL: &str = concat!(
    include_str!("migrations/001_init.sql"),
    "\n",
    include_str!("migrations/002_reader_core_completion.sql"),
);
```

- [ ] **Step 5: Verify**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml db::tests::opens_reader_core_schema
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/migrations/002_reader_core_completion.sql src-tauri/src/db.rs
git commit -m "feat: add reader core persistence schema"
```

## Task 3: Add Typed Persistence Commands And Frontend API

**Files:**

- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/persistence/persistenceApi.test.ts`

- [ ] **Step 1: Add frontend API tests**

Append to `src/persistence/persistenceApi.test.ts`:

```ts
it('saves and loads reader sessions', async () => {
  const invoke = vi.fn().mockResolvedValue([{ documentKey: 'desktop:/tmp/book.pdf', page: 4 }]);
  const api = createPersistenceApi(invoke);

  await api.saveReaderSession({
    activeDocumentKey: 'desktop:/tmp/book.pdf',
    sidebarOpen: true,
    tabs: [
      {
        documentKey: 'desktop:/tmp/book.pdf',
        tabOrder: 0,
        page: 4,
        zoom: 1.25,
        history: { currentPage: 4, backStack: [1], forwardStack: [] },
      },
    ],
  });

  expect(invoke).toHaveBeenCalledWith('save_reader_session', {
    session: {
      activeDocumentKey: 'desktop:/tmp/book.pdf',
      sidebarOpen: true,
      tabs: [
        {
          documentKey: 'desktop:/tmp/book.pdf',
          tabOrder: 0,
          page: 4,
          zoom: 1.25,
          history: { currentPage: 4, backStack: [1], forwardStack: [] },
        },
      ],
    },
  });

  await api.loadReaderSession();
  expect(invoke).toHaveBeenCalledWith('load_reader_session');
});

it('persists bookmarks and annotations', async () => {
  const invoke = vi.fn().mockResolvedValue([]);
  const api = createPersistenceApi(invoke);

  await api.saveBookmark({
    id: null,
    documentKey: 'desktop:/tmp/book.pdf',
    page: 3,
    title: 'Method',
    createdAt: '2026-06-16T00:00:00Z',
    updatedAt: '2026-06-16T00:00:00Z',
  });
  await api.listBookmarks('desktop:/tmp/book.pdf');
  await api.deleteBookmark(8);

  await api.saveAnnotation({
    id: null,
    documentKey: 'desktop:/tmp/book.pdf',
    page: 5,
    type: 'highlight',
    color: '#facc15',
    text: 'Important',
    quote: 'quoted text',
    areas: [{ pageIndex: 4, top: 10, left: 12, height: 3, width: 30 }],
    createdAt: '2026-06-16T00:00:00Z',
    updatedAt: '2026-06-16T00:00:00Z',
  });
  await api.listAnnotations('desktop:/tmp/book.pdf');
  await api.deleteAnnotation(9);

  expect(invoke).toHaveBeenCalledWith('save_bookmark', expect.any(Object));
  expect(invoke).toHaveBeenCalledWith('list_bookmarks', { documentKey: 'desktop:/tmp/book.pdf' });
  expect(invoke).toHaveBeenCalledWith('delete_bookmark', { id: 8 });
  expect(invoke).toHaveBeenCalledWith('save_annotation', expect.any(Object));
  expect(invoke).toHaveBeenCalledWith('list_annotations', { documentKey: 'desktop:/tmp/book.pdf' });
  expect(invoke).toHaveBeenCalledWith('delete_annotation', { id: 9 });
});
```

- [ ] **Step 2: Run frontend persistence tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/persistence/persistenceApi.test.ts
```

Expected: FAIL because the new API methods do not exist.

- [ ] **Step 3: Add frontend persistence types and methods**

Extend `src/persistence/persistenceApi.ts` with:

```ts
export type PersistedHistory = {
  currentPage: number;
  backStack: number[];
  forwardStack: number[];
};

export type PersistedSessionTab = {
  documentKey: string;
  tabOrder: number;
  page: number;
  zoom: number;
  history: PersistedHistory;
};

export type PersistedReaderSession = {
  activeDocumentKey: string | null;
  sidebarOpen: boolean;
  tabs: PersistedSessionTab[];
};

export type PersistedBookmark = {
  id: number | null;
  documentKey: string;
  page: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type PersistedHighlightArea = {
  pageIndex: number;
  top: number;
  left: number;
  height: number;
  width: number;
};

export type PersistedAnnotation = {
  id: number | null;
  documentKey: string;
  page: number;
  type: 'highlight' | 'note';
  color: string;
  text: string | null;
  quote: string | null;
  areas: PersistedHighlightArea[];
  createdAt: string;
  updatedAt: string;
};
```

Update `PersistenceApi`:

```ts
  saveReaderSession(session: PersistedReaderSession): Promise<void>;
  loadReaderSession(): Promise<PersistedReaderSession | null>;
  saveBookmark(bookmark: PersistedBookmark): Promise<PersistedBookmark>;
  listBookmarks(documentKey: string): Promise<PersistedBookmark[]>;
  deleteBookmark(id: number): Promise<void>;
  saveAnnotation(annotation: PersistedAnnotation): Promise<PersistedAnnotation>;
  listAnnotations(documentKey: string): Promise<PersistedAnnotation[]>;
  deleteAnnotation(id: number): Promise<void>;
```

Add implementations inside `createPersistenceApi`:

```ts
    saveReaderSession(session) {
      return invoke<void>('save_reader_session', { session });
    },
    loadReaderSession() {
      return invoke<PersistedReaderSession | null>('load_reader_session');
    },
    saveBookmark(bookmark) {
      return invoke<PersistedBookmark>('save_bookmark', { bookmark });
    },
    listBookmarks(documentKey) {
      return invoke<PersistedBookmark[]>('list_bookmarks', { documentKey });
    },
    deleteBookmark(id) {
      return invoke<void>('delete_bookmark', { id });
    },
    saveAnnotation(annotation) {
      return invoke<PersistedAnnotation>('save_annotation', { annotation });
    },
    listAnnotations(documentKey) {
      return invoke<PersistedAnnotation[]>('list_annotations', { documentKey });
    },
    deleteAnnotation(id) {
      return invoke<void>('delete_annotation', { id });
    },
```

- [ ] **Step 4: Add Rust serializable structs**

In `src-tauri/src/db.rs`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedHistory {
    pub current_page: i64,
    pub back_stack: Vec<i64>,
    pub forward_stack: Vec<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedSessionTab {
    pub document_key: String,
    pub tab_order: i64,
    pub page: i64,
    pub zoom: f64,
    pub history: PersistedHistory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedReaderSession {
    pub active_document_key: Option<String>,
    pub sidebar_open: bool,
    pub tabs: Vec<PersistedSessionTab>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBookmark {
    pub id: Option<i64>,
    pub document_key: String,
    pub page: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAnnotation {
    pub id: Option<i64>,
    pub document_key: String,
    pub page: i64,
    pub r#type: String,
    pub color: String,
    pub text: Option<String>,
    pub quote: Option<String>,
    pub areas: serde_json::Value,
    pub created_at: String,
    pub updated_at: String,
}
```

- [ ] **Step 5: Add Rust commands**

Add command functions in `src-tauri/src/db.rs`:

```rust
#[tauri::command]
pub fn save_reader_session(
    state: State<'_, DatabaseState>,
    session: PersistedReaderSession,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    save_reader_session_tx(&connection, &session)
}

#[tauri::command]
pub fn load_reader_session(
    state: State<'_, DatabaseState>,
) -> Result<Option<PersistedReaderSession>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    load_reader_session_tx(&connection)
}

#[tauri::command]
pub fn save_bookmark(
    state: State<'_, DatabaseState>,
    bookmark: PersistedBookmark,
) -> Result<PersistedBookmark, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    upsert_bookmark(&connection, bookmark)
}

#[tauri::command]
pub fn list_bookmarks(
    state: State<'_, DatabaseState>,
    document_key: String,
) -> Result<Vec<PersistedBookmark>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_bookmarks_for_document(&connection, &document_key)
}

#[tauri::command]
pub fn delete_bookmark(state: State<'_, DatabaseState>, id: i64) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    connection.execute("DELETE FROM bookmarks WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub fn save_annotation(
    state: State<'_, DatabaseState>,
    annotation: PersistedAnnotation,
) -> Result<PersistedAnnotation, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    upsert_annotation(&connection, annotation)
}

#[tauri::command]
pub fn list_annotations(
    state: State<'_, DatabaseState>,
    document_key: String,
) -> Result<Vec<PersistedAnnotation>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_annotations_for_document(&connection, &document_key)
}

#[tauri::command]
pub fn delete_annotation(state: State<'_, DatabaseState>, id: i64) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    connection.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    Ok(())
}
```

Add these helper functions below the command functions:

```rust
pub fn save_reader_session_tx(
    connection: &Connection,
    session: &PersistedReaderSession,
) -> Result<(), DbError> {
    let now = now_rfc3339();
    let active_document_id = match &session.active_document_key {
        Some(document_key) => document_id_for_key(connection, document_key)?,
        None => None,
    };

    connection.execute("DELETE FROM session_tabs", [])?;
    connection.execute("DELETE FROM sessions", [])?;
    connection.execute(
        r#"
        INSERT INTO sessions (active_document_id, sidebar_open, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![active_document_id, i64::from(session.sidebar_open), now, now],
    )?;
    let session_id = connection.last_insert_rowid();

    for tab in &session.tabs {
        if let Some(document_id) = document_id_for_key(connection, &tab.document_key)? {
            connection.execute(
                r#"
                INSERT INTO session_tabs (
                    session_id, document_id, tab_order, page, zoom, history_json, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    session_id,
                    document_id,
                    tab.tab_order,
                    tab.page,
                    tab.zoom,
                    serde_json::to_string(&tab.history).map_err(DbError::Json)?,
                    now,
                ],
            )?;
        }
    }

    Ok(())
}

pub fn load_reader_session_tx(
    connection: &Connection,
) -> Result<Option<PersistedReaderSession>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT s.id, d.document_key, s.sidebar_open
        FROM sessions s
        LEFT JOIN documents d ON d.id = s.active_document_id
        ORDER BY s.updated_at DESC
        LIMIT 1
        "#,
    )?;

    let mut rows = statement.query([])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };

    let session_id: i64 = row.get(0)?;
    let active_document_key: Option<String> = row.get(1)?;
    let sidebar_open = row.get::<_, i64>(2)? == 1;
    let mut tabs_statement = connection.prepare(
        r#"
        SELECT d.document_key, st.tab_order, st.page, st.zoom, st.history_json
        FROM session_tabs st
        JOIN documents d ON d.id = st.document_id
        WHERE st.session_id = ?1
        ORDER BY st.tab_order ASC
        "#,
    )?;
    let tabs = tabs_statement
        .query_map([session_id], |row| {
            let history_json: String = row.get(4)?;
            let history = serde_json::from_str(&history_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    4,
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;
            Ok(PersistedSessionTab {
                document_key: row.get(0)?,
                tab_order: row.get(1)?,
                page: row.get(2)?,
                zoom: row.get(3)?,
                history,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(Some(PersistedReaderSession {
        active_document_key,
        sidebar_open,
        tabs,
    }))
}

fn document_id_for_key(
    connection: &Connection,
    document_key: &str,
) -> Result<Option<i64>, DbError> {
    let mut statement = connection.prepare("SELECT id FROM documents WHERE document_key = ?1")?;
    let mut rows = statement.query([document_key])?;
    Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
}

pub fn upsert_bookmark(
    connection: &Connection,
    bookmark: PersistedBookmark,
) -> Result<PersistedBookmark, DbError> {
    if let Some(id) = bookmark.id {
        connection.execute(
            r#"
            UPDATE bookmarks
            SET document_key = ?1, page = ?2, title = ?3, created_at = ?4, updated_at = ?5
            WHERE id = ?6
            "#,
            params![
                bookmark.document_key,
                bookmark.page,
                bookmark.title,
                bookmark.created_at,
                bookmark.updated_at,
                id,
            ],
        )?;
        return Ok(bookmark);
    }

    connection.execute(
        r#"
        INSERT INTO bookmarks (document_key, page, title, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![
            bookmark.document_key,
            bookmark.page,
            bookmark.title,
            bookmark.created_at,
            bookmark.updated_at,
        ],
    )?;

    Ok(PersistedBookmark {
        id: Some(connection.last_insert_rowid()),
        ..bookmark
    })
}

pub fn list_bookmarks_for_document(
    connection: &Connection,
    document_key: &str,
) -> Result<Vec<PersistedBookmark>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, document_key, page, title, created_at, updated_at
        FROM bookmarks
        WHERE document_key = ?1
        ORDER BY page ASC, title ASC
        "#,
    )?;
    let rows = statement.query_map([document_key], |row| {
        Ok(PersistedBookmark {
            id: Some(row.get(0)?),
            document_key: row.get(1)?,
            page: row.get(2)?,
            title: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn upsert_annotation(
    connection: &Connection,
    annotation: PersistedAnnotation,
) -> Result<PersistedAnnotation, DbError> {
    let areas_json = serde_json::to_string(&annotation.areas).map_err(DbError::Json)?;

    if let Some(id) = annotation.id {
        connection.execute(
            r#"
            UPDATE annotations
            SET document_key = ?1, page = ?2, type = ?3, color = ?4, text = ?5,
                quote = ?6, areas_json = ?7, created_at = ?8, updated_at = ?9
            WHERE id = ?10
            "#,
            params![
                annotation.document_key,
                annotation.page,
                annotation.r#type,
                annotation.color,
                annotation.text,
                annotation.quote,
                areas_json,
                annotation.created_at,
                annotation.updated_at,
                id,
            ],
        )?;
        return Ok(annotation);
    }

    connection.execute(
        r#"
        INSERT INTO annotations (
            document_key, page, type, color, text, quote, areas_json, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            annotation.document_key,
            annotation.page,
            annotation.r#type,
            annotation.color,
            annotation.text,
            annotation.quote,
            areas_json,
            annotation.created_at,
            annotation.updated_at,
        ],
    )?;

    Ok(PersistedAnnotation {
        id: Some(connection.last_insert_rowid()),
        ..annotation
    })
}

pub fn list_annotations_for_document(
    connection: &Connection,
    document_key: &str,
) -> Result<Vec<PersistedAnnotation>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, document_key, page, type, color, text, quote, areas_json, created_at, updated_at
        FROM annotations
        WHERE document_key = ?1
        ORDER BY page ASC, created_at ASC
        "#,
    )?;
    let rows = statement.query_map([document_key], |row| {
        let areas_json: String = row.get(7)?;
        let areas = serde_json::from_str(&areas_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        Ok(PersistedAnnotation {
            id: Some(row.get(0)?),
            document_key: row.get(1)?,
            page: row.get(2)?,
            r#type: row.get(3)?,
            color: row.get(4)?,
            text: row.get(5)?,
            quote: row.get(6)?,
            areas,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}
```

Extend `DbError` with a JSON variant:

```rust
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
```

- [ ] **Step 6: Register commands**

In `src-tauri/src/lib.rs`, extend `tauri::generate_handler!`:

```rust
            db::save_reader_session,
            db::load_reader_session,
            db::save_bookmark,
            db::list_bookmarks,
            db::delete_bookmark,
            db::save_annotation,
            db::list_annotations,
            db::delete_annotation,
```

- [ ] **Step 7: Add Rust persistence roundtrip tests**

Append tests in `src-tauri/src/db.rs`:

```rust
#[test]
fn saves_and_loads_reader_session() {
    let connection = Connection::open_in_memory().expect("in-memory database");
    connection.execute_batch(INIT_SQL).expect("schema applies");

    let document = PersistedDocument {
        document_key: "desktop:/tmp/book.pdf".to_string(),
        path: Some("/tmp/book.pdf".to_string()),
        display_name: "book.pdf".to_string(),
        file_size: Some(100),
        modified_at: Some("2026-06-16T00:00:00Z".to_string()),
        page_count: Some(20),
        last_page: 4,
        progress: 0.2,
        missing: false,
    };
    upsert_document(&connection, &document).expect("document");

    let session = PersistedReaderSession {
        active_document_key: Some(document.document_key.clone()),
        sidebar_open: true,
        tabs: vec![PersistedSessionTab {
            document_key: document.document_key.clone(),
            tab_order: 0,
            page: 4,
            zoom: 1.25,
            history: PersistedHistory {
                current_page: 4,
                back_stack: vec![1],
                forward_stack: vec![],
            },
        }],
    };

    save_reader_session_tx(&connection, &session).expect("save");
    assert_eq!(load_reader_session_tx(&connection).expect("load"), Some(session));
}
```

- [ ] **Step 8: Verify**

Run:

```bash
bunx vitest run --dir src src/persistence/persistenceApi.test.ts
cargo test --manifest-path src-tauri/Cargo.toml db::tests
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: add reader persistence commands"
```

## Task 4: Add Runtime Byte Cache And Disk Cache Commands

**Files:**

- Create: `src/cache/pdfByteCache.ts`
- Create: `src/cache/pdfByteCache.test.ts`
- Modify: `src-tauri/src/file_commands.rs`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/persistence/persistenceApi.test.ts`

- [ ] **Step 1: Write byte cache tests**

Create `src/cache/pdfByteCache.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { PdfByteCache } from './pdfByteCache';

describe('PdfByteCache', () => {
  it('stores copied bytes by document key', () => {
    const cache = new PdfByteCache();
    const source = new Uint8Array([1, 2, 3]);

    cache.set('desktop:/tmp/book.pdf', source);
    source[0] = 9;

    expect(cache.get('desktop:/tmp/book.pdf')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('evicts the least recently used entry when over limit', () => {
    const cache = new PdfByteCache(5);

    cache.set('a', new Uint8Array([1, 2, 3]));
    cache.set('b', new Uint8Array([4, 5, 6]));

    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toEqual(new Uint8Array([4, 5, 6]));
  });
});
```

- [ ] **Step 2: Run byte cache tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/cache/pdfByteCache.test.ts
```

Expected: FAIL because `pdfByteCache.ts` does not exist.

- [ ] **Step 3: Implement byte cache**

Create `src/cache/pdfByteCache.ts`:

```ts
export class PdfByteCache {
  private readonly entries = new Map<string, Uint8Array>();
  private totalBytes = 0;

  constructor(private readonly maxBytes = 128 * 1024 * 1024) {}

  get(documentKey: string): Uint8Array | null {
    const bytes = this.entries.get(documentKey);

    if (!bytes) {
      return null;
    }

    this.entries.delete(documentKey);
    this.entries.set(documentKey, bytes);
    return copyBytes(bytes);
  }

  set(documentKey: string, bytes: Uint8Array): void {
    this.delete(documentKey);
    const copied = copyBytes(bytes);
    this.entries.set(documentKey, copied);
    this.totalBytes += copied.byteLength;
    this.prune();
  }

  delete(documentKey: string): void {
    const existing = this.entries.get(documentKey);

    if (!existing) {
      return;
    }

    this.totalBytes -= existing.byteLength;
    this.entries.delete(documentKey);
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private prune(): void {
    while (this.totalBytes > this.maxBytes) {
      const firstKey = this.entries.keys().next().value as string | undefined;

      if (!firstKey) {
        return;
      }

      this.delete(firstKey);
    }
  }
}

function copyBytes(bytes: Uint8Array): Uint8Array {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}
```

- [ ] **Step 4: Add Rust disk cache command tests**

Append to `src-tauri/src/file_commands.rs` tests:

```rust
#[test]
fn cache_file_name_is_stable() {
    let name = cache_file_name("desktop:/tmp/book.pdf");
    assert!(name.ends_with(".pdf"));
    assert!(name.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.'));
}
```

- [ ] **Step 5: Add Rust cache helpers**

In `src-tauri/src/file_commands.rs`, add:

```rust
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedPdfFile {
    pub cache_path: String,
    pub bytes: Vec<u8>,
}

#[tauri::command]
pub fn read_cached_pdf(cache_path: String) -> Result<CachedPdfFile, FileCommandError> {
    let bytes = fs::read(&cache_path)?;
    validate_pdf_bytes(&bytes)?;
    Ok(CachedPdfFile { cache_path, bytes })
}

pub fn cache_file_name(document_key: &str) -> String {
    let mut name = String::new();

    for byte in document_key.as_bytes() {
      name.push_str(&format!("{byte:02x}"));
    }

    format!("{name}.pdf")
}
```

After implementation, run `cargo fmt --manifest-path src-tauri/Cargo.toml`.

- [ ] **Step 6: Register cache read command**

In `src-tauri/src/lib.rs`, add `file_commands::read_cached_pdf` to `generate_handler!`.

- [ ] **Step 7: Verify**

Run:

```bash
bunx vitest run --dir src src/cache/pdfByteCache.test.ts
cargo test --manifest-path src-tauri/Cargo.toml file_commands::tests
cargo fmt --manifest-path src-tauri/Cargo.toml --check
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/cache/pdfByteCache.ts src/cache/pdfByteCache.test.ts src-tauri/src/file_commands.rs src-tauri/src/lib.rs
git commit -m "feat: add PDF byte cache primitives"
```

## Task 5: Expand Document State For History, Restore, Errors, And Tab Switching

**Files:**

- Modify: `src/documents/documentModels.ts`
- Modify: `src/documents/documentSessionStore.ts`
- Modify: `src/documents/documentSessionStore.test.ts`
- Modify: `src/documents/readingHistory.ts`
- Modify: `src/documents/readingHistory.test.ts`

- [ ] **Step 1: Add state tests**

Append to `src/documents/documentSessionStore.test.ts`:

```ts
it('moves active tab forward and backward', () => {
  const first = addDocumentSession(createEmptyDocumentState(), {
    kind: 'desktop-path',
    path: '/tmp/a.pdf',
    name: 'a.pdf',
  });
  const second = addDocumentSession(first, {
    kind: 'desktop-path',
    path: '/tmp/b.pdf',
    name: 'b.pdf',
  });

  expect(selectNextSession(second).activeSessionId).toBe(first.sessions[0].id);
  expect(selectPreviousSession(second).activeSessionId).toBe(first.sessions[0].id);
});

it('records hard navigation and steps through history', () => {
  const state = addDocumentSession(createEmptyDocumentState(), {
    kind: 'desktop-path',
    path: '/tmp/a.pdf',
    name: 'a.pdf',
  });
  const sessionId = state.activeSessionId!;

  const jumped = recordHardNavigation(state, sessionId, 5);
  const backed = stepSessionHistoryBack(jumped, sessionId);
  const forwarded = stepSessionHistoryForward(backed, sessionId);

  expect(jumped.sessions[0].history).toMatchObject({ currentPage: 5, backStack: [1] });
  expect(backed.sessions[0].page).toBe(1);
  expect(forwarded.sessions[0].page).toBe(5);
});

it('marks restored missing files as recoverable errors', () => {
  const state = markSessionError(
    restoreDocumentSessions([
      {
        documentKey: 'desktop:/tmp/missing.pdf',
        path: '/tmp/missing.pdf',
        displayName: 'missing.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-16T00:00:00Z',
        pageCount: 10,
        lastPage: 2,
        progress: 0.2,
        missing: false,
      },
    ]),
    'session-ZGVza3RvcDovdG1wL21pc3NpbmcucGRm',
    'file does not exist',
  );

  expect(state.sessions[0]).toMatchObject({
    status: 'error',
    errorMessage: 'file does not exist',
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/documents/documentSessionStore.test.ts src/documents/readingHistory.test.ts
```

Expected: FAIL because history and tab switching helpers do not exist.

- [ ] **Step 3: Extend models**

In `src/documents/documentModels.ts`, import `ReadingHistory` and add fields:

```ts
import type { ReadingHistory } from './readingHistory';
```

Update `DocumentSession`:

```ts
  history: ReadingHistory;
  restored: boolean;
```

Update `DocumentState`:

```ts
  sidebarOpen: boolean;
```

- [ ] **Step 4: Initialize new state**

In `createEmptyDocumentState`, return:

```ts
  return {
    sessions: [],
    activeSessionId: null,
    sidebarOpen: true,
  };
```

In new session creation, add:

```ts
    history: createReadingHistory(1),
    restored: false,
```

In `restoreDocumentSessions`, add:

```ts
        history: createReadingHistory(document.lastPage),
        restored: true,
```

- [ ] **Step 5: Add state helpers**

Add to `src/documents/documentSessionStore.ts`:

```ts
export function selectSession(state: DocumentState, sessionId: string): DocumentState {
  if (!state.sessions.some((session) => session.id === sessionId)) {
    return state;
  }

  return { ...state, activeSessionId: sessionId };
}

export function selectNextSession(state: DocumentState): DocumentState {
  return selectRelativeSession(state, 1);
}

export function selectPreviousSession(state: DocumentState): DocumentState {
  return selectRelativeSession(state, -1);
}

export function recordHardNavigation(
  state: DocumentState,
  sessionId: string,
  page: number,
): DocumentState {
  return updateSessionHistory(state, sessionId, (history) => pushHardNavigation(history, page));
}

export function stepSessionHistoryBack(state: DocumentState, sessionId: string): DocumentState {
  return updateSessionHistory(state, sessionId, stepBack);
}

export function stepSessionHistoryForward(state: DocumentState, sessionId: string): DocumentState {
  return updateSessionHistory(state, sessionId, stepForward);
}

export function markSessionError(
  state: DocumentState,
  sessionId: string,
  errorMessage: string,
): DocumentState {
  return {
    ...state,
    sessions: state.sessions.map((session) =>
      session.id === sessionId
        ? { ...session, status: 'error', errorMessage, updatedAt: new Date().toISOString() }
        : session,
    ),
  };
}

function selectRelativeSession(state: DocumentState, offset: number): DocumentState {
  if (!state.activeSessionId || state.sessions.length === 0) {
    return state;
  }

  const index = state.sessions.findIndex((session) => session.id === state.activeSessionId);
  const nextIndex = (index + offset + state.sessions.length) % state.sessions.length;
  return { ...state, activeSessionId: state.sessions[nextIndex].id };
}

function updateSessionHistory(
  state: DocumentState,
  sessionId: string,
  update: (history: ReadingHistory) => ReadingHistory,
): DocumentState {
  return {
    ...state,
    sessions: state.sessions.map((session) => {
      if (session.id !== sessionId) {
        return session;
      }

      const history = update(session.history);
      return {
        ...session,
        history,
        page: history.currentPage,
        progress: calculateProgress(history.currentPage, session.totalPages),
        updatedAt: new Date().toISOString(),
      };
    }),
  };
}
```

- [ ] **Step 6: Verify**

Run:

```bash
bunx vitest run --dir src src/documents/documentSessionStore.test.ts src/documents/readingHistory.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/documents/documentModels.ts src/documents/documentSessionStore.ts src/documents/documentSessionStore.test.ts src/documents/readingHistory.ts src/documents/readingHistory.test.ts
git commit -m "feat: wire document history state"
```

## Task 6: Add Preferences And Debounced Persistence

**Files:**

- Create: `src/preferences/preferencesModels.ts`
- Create: `src/preferences/preferencesStore.ts`
- Create: `src/preferences/preferencesStore.test.ts`
- Create: `src/persistence/debounce.ts`
- Create: `src/persistence/debounce.test.ts`
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/persistence/persistenceApi.test.ts`

- [ ] **Step 1: Write preferences tests**

Create `src/preferences/preferencesStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { defaultReaderPreferences, mergeReaderPreferences } from './preferencesStore';

describe('preferencesStore', () => {
  it('merges stored preferences over defaults', () => {
    expect(
      mergeReaderPreferences({
        sessionRestoreEnabled: false,
        defaultZoomMode: 'fit-page',
        shortcuts: { 'file.open': 'Meta+Shift+O' },
      }),
    ).toEqual({
      ...defaultReaderPreferences,
      sessionRestoreEnabled: false,
      defaultZoomMode: 'fit-page',
      shortcuts: {
        ...defaultReaderPreferences.shortcuts,
        'file.open': 'Meta+Shift+O',
      },
    });
  });
});
```

Create `src/persistence/debounce.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createDebouncedFlush } from './debounce';

describe('createDebouncedFlush', () => {
  it('runs only the latest scheduled write and supports immediate flush', async () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const flush = createDebouncedFlush<string>((value) => {
      writes.push(value);
      return Promise.resolve();
    }, 100);

    flush.schedule('first');
    flush.schedule('second');
    await flush.flushNow();

    expect(writes).toEqual(['second']);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/preferences/preferencesStore.test.ts src/persistence/debounce.test.ts
```

Expected: FAIL because the files do not exist.

- [ ] **Step 3: Add preference models**

Create `src/preferences/preferencesModels.ts`:

```ts
import type { CommandId } from '../commands/commandRegistry';

export type DefaultZoomMode = 'actual-size' | 'fit-width' | 'fit-page';

export type ReaderPreferences = {
  sessionRestoreEnabled: boolean;
  defaultZoomMode: DefaultZoomMode;
  shortcuts: Record<CommandId, string | null>;
};

export type PartialReaderPreferences = Partial<
  Omit<ReaderPreferences, 'shortcuts'> & {
    shortcuts: Partial<Record<CommandId, string | null>>;
  }
>;
```

Create `src/preferences/preferencesStore.ts`:

```ts
import { defaultShortcuts, type CommandId } from '../commands/commandRegistry';
import type { PartialReaderPreferences, ReaderPreferences } from './preferencesModels';

export const defaultReaderPreferences: ReaderPreferences = {
  sessionRestoreEnabled: true,
  defaultZoomMode: 'fit-width',
  shortcuts: {
    'file.open': defaultShortcuts.openFile,
    'tab.close': defaultShortcuts.closeTab,
    'find.open': defaultShortcuts.find,
    'find.next': defaultShortcuts.findNext,
    'find.previous': defaultShortcuts.findPrevious,
    'sidebar.toggle': defaultShortcuts.toggleSidebar,
    'zoom.in': defaultShortcuts.zoomIn,
    'zoom.out': defaultShortcuts.zoomOut,
    'zoom.fitWidth': defaultShortcuts.fitWidth,
    'zoom.fitPage': defaultShortcuts.fitPage,
    'page.focus': defaultShortcuts.focusPage,
    'history.back': defaultShortcuts.historyBack,
    'history.forward': defaultShortcuts.historyForward,
    'tab.next': defaultShortcuts.nextTab,
    'tab.previous': defaultShortcuts.previousTab,
    'bookmark.add': defaultShortcuts.addBookmark,
    'annotation.note': defaultShortcuts.addNote,
    'preferences.open': defaultShortcuts.openPreferences,
  } satisfies Record<CommandId, string | null>,
};

export function mergeReaderPreferences(
  stored: PartialReaderPreferences | null | undefined,
): ReaderPreferences {
  return {
    ...defaultReaderPreferences,
    ...(stored ?? {}),
    shortcuts: {
      ...defaultReaderPreferences.shortcuts,
      ...(stored?.shortcuts ?? {}),
    },
  };
}
```

- [ ] **Step 4: Add debounced flush helper**

Create `src/persistence/debounce.ts`:

```ts
export type DebouncedFlush<T> = {
  schedule(value: T): void;
  flushNow(): Promise<void>;
  cancel(): void;
};

export function createDebouncedFlush<T>(
  write: (value: T) => Promise<void>,
  delayMs: number,
): DebouncedFlush<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: T | null = null;

  const cancel = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(value) {
      pending = value;
      cancel();
      timer = setTimeout(() => {
        void this.flushNow();
      }, delayMs);
    },
    async flushNow() {
      cancel();

      if (pending === null) {
        return;
      }

      const value = pending;
      pending = null;
      await write(value);
    },
    cancel,
  };
}
```

- [ ] **Step 5: Add preference persistence API**

In `src/persistence/persistenceApi.ts`, import `ReaderPreferences` and add:

```ts
  savePreferences(preferences: ReaderPreferences): Promise<void>;
  loadPreferences(): Promise<ReaderPreferences | null>;
```

Implement:

```ts
    savePreferences(preferences) {
      return invoke<void>('save_preferences', { preferences });
    },
    loadPreferences() {
      return invoke<ReaderPreferences | null>('load_preferences');
    },
```

- [ ] **Step 6: Verify**

Run:

```bash
bunx vitest run --dir src src/preferences/preferencesStore.test.ts src/persistence/debounce.test.ts src/persistence/persistenceApi.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/preferences src/persistence/debounce.ts src/persistence/debounce.test.ts src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts
git commit -m "feat: add reader preferences and debounced persistence"
```

## Task 7: Add Browser File Picker And Robust Open Flows

**Files:**

- Create: `src/platform/browserFilePicker.ts`
- Create: `src/platform/browserFilePicker.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write browser file picker tests**

Create `src/platform/browserFilePicker.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { fileToBrowserSource, isBrowserPdfFile } from './browserFilePicker';

describe('browserFilePicker', () => {
  it('accepts PDF files by mime type or extension', () => {
    expect(isBrowserPdfFile(new File(['x'], 'a.pdf', { type: '' }))).toBe(true);
    expect(isBrowserPdfFile(new File(['x'], 'a.bin', { type: 'application/pdf' }))).toBe(true);
    expect(isBrowserPdfFile(new File(['x'], 'a.txt', { type: 'text/plain' }))).toBe(false);
  });

  it('creates browser file sources', () => {
    const file = new File(['%PDF-1.7'], 'paper.pdf', { type: 'application/pdf' });

    expect(fileToBrowserSource(file)).toEqual({
      kind: 'browser-file',
      file,
      name: 'paper.pdf',
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/platform/browserFilePicker.test.ts
```

Expected: FAIL because `browserFilePicker.ts` does not exist.

- [ ] **Step 3: Implement browser file picker helpers**

Create `src/platform/browserFilePicker.ts`:

```ts
import type { BrowserFileSource } from './fileSource';

export function isBrowserPdfFile(file: File): boolean {
  return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
}

export function fileToBrowserSource(file: File): BrowserFileSource {
  return {
    kind: 'browser-file',
    file,
    name: file.name,
  };
}
```

- [ ] **Step 4: Add App tests for file picker and persistence on open**

Append to `src/app/App.test.tsx`:

```tsx
it('opens a PDF from the browser file picker', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:picker');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const file = new File(['%PDF-1.7'], 'picker.pdf', { type: 'application/pdf' });

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={createEmptyPersistence()}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.change(screen.getByLabelText('Choose PDF file'), {
    target: { files: [file] },
  });

  await waitFor(() => {
    expect(screen.getByRole('tab', { name: 'picker.pdf' })).toBeInTheDocument();
  });
});

it('saves desktop documents when they are opened', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:book');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const persistence = createEmptyPersistence();
  const openNativePdf = vi.fn().mockResolvedValue({
    source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
    fileSize: 5,
    modifiedAt: '2026-06-16T00:00:00Z',
  });

  renderApp(
    <App
      bridge={{ openNativePdf, readDesktopPdf: vi.fn() }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Open PDF' }));

  await waitFor(() => {
    expect(persistence.saveDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
      }),
    );
  });
});
```

- [ ] **Step 5: Implement App file picker**

In `src/app/App.tsx`, import:

```ts
import { fileToBrowserSource } from '../platform/browserFilePicker';
import { PdfByteCache } from '../cache/pdfByteCache';
```

Add cache:

```ts
  const pdfByteCache = useMemo(() => new PdfByteCache(), []);
```

Add file input handler:

```ts
  const handleBrowserFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);

    if (!file) {
      return;
    }

    openBytes(fileToBrowserSource(file), new Uint8Array(await file.arrayBuffer()));
    event.target.value = '';
  };
```

Add hidden input near the Open PDF toolbar button:

```tsx
        <label className="file-picker-button">
          <FolderOpen size={16} />
          Choose
          <input
            aria-label="Choose PDF file"
            type="file"
            accept="application/pdf,.pdf"
            onChange={handleBrowserFileChange}
          />
        </label>
```

In `openBytes`, store runtime bytes:

```ts
      pdfByteCache.set(documentKey, bytes);
```

For desktop sources, call `persistence.saveDocument` with:

```ts
void persistence.saveDocument({
  documentKey,
  path: source.kind === 'desktop-path' ? source.path : null,
  displayName: session.title,
  fileSize: source.kind === 'desktop-path' && 'fileSize' in source ? source.fileSize : null,
  modifiedAt: source.kind === 'desktop-path' && 'modifiedAt' in source ? source.modifiedAt : null,
  pageCount: session.totalPages,
  lastPage: session.page,
  progress: session.progress,
  missing: false,
});
```

Change the `openBytes` signature so desktop metadata is explicit:

```ts
const openBytes = (
  source: FileSource,
  bytes: Uint8Array,
  metadata: { fileSize?: number | null; modifiedAt?: string | null } = {},
) => {
```

Then pass `{ fileSize: opened.fileSize, modifiedAt: opened.modifiedAt }` from native open.

- [ ] **Step 6: Verify**

Run:

```bash
bunx vitest run --dir src src/platform/browserFilePicker.test.ts src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/platform/browserFilePicker.ts src/platform/browserFilePicker.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add browser PDF open flow"
```

## Task 8: Restore Sessions End-To-End

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/documents/documentSessionStore.ts`

- [ ] **Step 1: Add App restore tests**

Replace the existing restore test in `src/app/App.test.tsx` with:

```tsx
it('restores desktop sessions by reading the PDF bytes again', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:restored');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const readDesktopPdf = vi.fn().mockResolvedValue({
    source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
    fileSize: 5,
    modifiedAt: '2026-06-16T00:00:00Z',
  });
  const persistence = {
    ...createEmptyPersistence(),
    listRecentDocuments: vi.fn().mockResolvedValue([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-16T00:00:00Z',
        pageCount: 20,
        lastPage: 6,
        progress: 0.3,
        missing: false,
      },
    ]),
    loadReaderSession: vi.fn().mockResolvedValue({
      activeDocumentKey: 'desktop:/tmp/book.pdf',
      sidebarOpen: true,
      tabs: [
        {
          documentKey: 'desktop:/tmp/book.pdf',
          tabOrder: 0,
          page: 6,
          zoom: 1.25,
          history: { currentPage: 6, backStack: [1], forwardStack: [] },
        },
      ],
    }),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  await waitFor(() => {
    expect(screen.getByText('PDF blob:restored')).toBeInTheDocument();
  });

  expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/book.pdf');
});

it('keeps a restored tab in error state when the PDF is missing', async () => {
  const persistence = {
    ...createEmptyPersistence(),
    listRecentDocuments: vi.fn().mockResolvedValue([
      {
        documentKey: 'desktop:/tmp/missing.pdf',
        path: '/tmp/missing.pdf',
        displayName: 'missing.pdf',
        fileSize: 100,
        modifiedAt: '2026-06-16T00:00:00Z',
        pageCount: 20,
        lastPage: 6,
        progress: 0.3,
        missing: false,
      },
    ]),
    loadReaderSession: vi.fn().mockResolvedValue(null),
  };

  renderApp(
    <App
      bridge={{
        openNativePdf: vi.fn(),
        readDesktopPdf: vi.fn().mockRejectedValue(new Error('file does not exist')),
      }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  await waitFor(() => {
    expect(screen.getByText('file does not exist')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run App restore tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/app/App.test.tsx
```

Expected: FAIL because restore currently creates tabs without reading bytes.

- [ ] **Step 3: Implement restore loader in App**

In `src/app/App.tsx`, update startup effect to:

```ts
  useEffect(() => {
    let cancelled = false;

    async function restore() {
      const [restoredDocuments, restoredSession] = await Promise.all([
        persistence.listRecentDocuments(),
        persistence.loadReaderSession(),
      ]);

      if (cancelled || restoredDocuments.length === 0) {
        return;
      }

      const restoredState = restoreDocumentSessions(restoredDocuments, restoredSession);
      setDocuments(restoredState);

      for (const session of restoredState.sessions) {
        if (session.source.kind !== 'desktop-path') {
          continue;
        }

        try {
          const opened = await bridge.readDesktopPdf(session.source.path);
          if (cancelled) {
            return;
          }
          pdfByteCache.set(session.documentKey, opened.bytes);
          const url = blobUrlCache.createForSession(session.id, opened.bytes);
          if (session.id === restoredState.activeSessionId) {
            setViewerSource({ sessionId: session.id, url });
          }
        } catch (error) {
          if (!cancelled) {
            setDocuments((current) =>
              markSessionError(
                current,
                session.id,
                error instanceof Error ? error.message : String(error),
              ),
            );
          }
        }
      }
    }

    restore().catch(() => {
      if (!cancelled) {
        setDocuments(createEmptyDocumentState());
      }
    });

    return () => {
      cancelled = true;
    };
  }, [bridge, persistence, blobUrlCache, pdfByteCache]);
```

- [ ] **Step 4: Persist session snapshots on relevant state changes**

Add an effect in `src/app/App.tsx`:

```ts
  useEffect(() => {
    if (documents.sessions.length === 0) {
      return;
    }

    persistence.saveReaderSession({
      activeDocumentKey: activeSession?.documentKey ?? null,
      sidebarOpen,
      tabs: documents.sessions
        .filter((session) => session.source.kind === 'desktop-path')
        .map((session, tabOrder) => ({
          documentKey: session.documentKey,
          tabOrder,
          page: session.page,
          zoom: session.zoom,
          history: session.history,
        })),
    });
  }, [documents, activeSession, sidebarOpen, persistence]);
```

In the same task, wrap the write in the `createDebouncedFlush` helper from Task 6 and call `flushNow()` on `beforeunload` so progress updates are batched.

- [ ] **Step 5: Add recoverable error UI**

In the viewer pane branch, before `PdfViewerBridge`, render:

```tsx
            {activeSession.status === 'error' ? (
              <section className="reader-error" role="alert">
                <h2>{activeSession.title}</h2>
                <p>{activeSession.errorMessage}</p>
                {activeSession.source.kind === 'desktop-path' ? (
                  <button type="button" onClick={() => void reopenDesktopSession(activeSession.id)}>
                    Retry
                  </button>
                ) : null}
              </section>
            ) : (
```

Close the conditional after `PdfViewerBridge`.

- [ ] **Step 6: Verify**

Run:

```bash
bunx vitest run --dir src src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx src/documents/documentSessionStore.ts src/persistence/persistenceApi.ts
git commit -m "feat: restore desktop PDF sessions"
```

## Task 9: Add Search, Page Jump, Fit Modes, And Pinch Zoom

**Files:**

- Modify: `src/viewer/viewerController.ts`
- Modify: `src/viewer/viewerController.test.ts`
- Modify: `src/viewer/viewerTypes.ts`
- Modify: `src/viewer/PdfViewerBridge.tsx`
- Modify: `src/viewer/PdfViewerBridge.test.tsx`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/commands/commandRegistry.ts`

- [ ] **Step 1: Add viewer controller tests**

Extend the `ViewerActions` mock in `src/viewer/viewerController.test.ts` with:

```ts
      openSearch: vi.fn(),
      search: vi.fn(),
```

Add assertions:

```ts
    expect(controller.openSearch()).toBe(true);
    expect(controller.search('method')).toBe(true);
    expect(actions.openSearch).toHaveBeenCalledTimes(1);
    expect(actions.search).toHaveBeenCalledWith('method');
```

- [ ] **Step 2: Run controller tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/viewer/viewerController.test.ts
```

Expected: FAIL because `openSearch` and `search` do not exist.

- [ ] **Step 3: Expand viewer actions**

In `src/viewer/viewerController.ts`, update `ViewerActions`:

```ts
  openSearch(): void;
  search(keyword: string): void;
```

Add methods:

```ts
  openSearch(): boolean {
    return this.run((actions) => actions.openSearch());
  }

  search(keyword: string): boolean {
    return this.run((actions) => actions.search(keyword));
  }
```

- [ ] **Step 4: Bind search and fit mode in the viewer bridge**

In `src/viewer/PdfViewerBridge.tsx`, update no-renderer bind:

```ts
      openSearch: () => undefined,
      search: () => undefined,
```

In `ReactPdfViewer`, add:

```ts
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
```

In controller binding:

```ts
      openSearch: () => {
        searchButtonRef.current?.click();
      },
      search: (keyword) => {
        void searchPluginInstance.highlight(keyword);
      },
```

Render a controlled search button around `ShowSearchPopover`:

```tsx
                <ShowSearchPopover>
                  {(props) => (
                    <button
                      ref={searchButtonRef}
                      type="button"
                      aria-label={props.label}
                      onClick={props.onClick}
                    >
                      {props.icon}
                    </button>
                  )}
                </ShowSearchPopover>
```

- [ ] **Step 5: Add App search and jump tests**

Append to `src/app/App.test.tsx`:

```tsx
it('runs search and page jump commands from the toolbar', async () => {
  const viewerController = {
    jumpToPage: vi.fn().mockReturnValue(true),
    openSearch: vi.fn().mockReturnValue(true),
    search: vi.fn().mockReturnValue(true),
    searchNext: vi.fn().mockReturnValue(true),
    searchPrevious: vi.fn().mockReturnValue(true),
    zoomIn: vi.fn().mockReturnValue(true),
    zoomOut: vi.fn().mockReturnValue(true),
    fitWidth: vi.fn().mockReturnValue(true),
    fitPage: vi.fn().mockReturnValue(true),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={createEmptyPersistence()}
      viewerController={viewerController}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.change(screen.getByLabelText('Search text'), { target: { value: 'method' } });
  fireEvent.click(screen.getByRole('button', { name: 'Search PDF' }));
  fireEvent.change(screen.getByLabelText('Page number'), { target: { value: '8' } });
  fireEvent.click(screen.getByRole('button', { name: 'Go to page' }));

  expect(viewerController.search).toHaveBeenCalledWith('method');
  expect(viewerController.jumpToPage).toHaveBeenCalledWith(8);
});
```

- [ ] **Step 6: Implement App toolbar controls**

Add state:

```ts
  const [searchText, setSearchText] = useState('');
  const [pageInput, setPageInput] = useState('');
```

Add toolbar controls:

```tsx
        <input
          aria-label="Search text"
          className="toolbar-input"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          onFocus={() => activeViewerController.openSearch()}
        />
        <button
          type="button"
          onClick={() => activeViewerController.search(searchText)}
          aria-label="Search PDF"
        >
          <Search size={16} />
        </button>
        <input
          aria-label="Page number"
          className="page-input"
          inputMode="numeric"
          value={pageInput}
          onChange={(event) => setPageInput(event.target.value)}
        />
        <button
          type="button"
          onClick={() => {
            const page = Number(pageInput);
            if (Number.isInteger(page) && page > 0 && activeSession) {
              setDocuments((current) => recordHardNavigation(current, activeSession.id, page));
              activeViewerController.jumpToPage(page);
            }
          }}
          aria-label="Go to page"
        >
          Go
        </button>
        <button type="button" onClick={() => activeViewerController.fitWidth()} aria-label="Fit width">
          Fit width
        </button>
        <button type="button" onClick={() => activeViewerController.fitPage()} aria-label="Fit page">
          Fit page
        </button>
```

- [ ] **Step 7: Add pinch zoom handler**

Wrap the viewer pane with:

```tsx
        <section
          className="viewer-pane"
          onWheel={(event) => {
            if (!event.ctrlKey && !event.metaKey) {
              return;
            }

            event.preventDefault();
            if (event.deltaY < 0) {
              activeViewerController.zoomIn();
            } else {
              activeViewerController.zoomOut();
            }
          }}
        >
```

- [ ] **Step 8: Verify**

Run:

```bash
bunx vitest run --dir src src/viewer/viewerController.test.ts src/viewer/PdfViewerBridge.test.tsx src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/viewer src/app/App.tsx src/app/App.test.tsx src/commands/commandRegistry.ts
git commit -m "feat: add reader search and jump controls"
```

## Task 10: Wire All Shortcut Commands

**Files:**

- Modify: `src/commands/commandRegistry.ts`
- Modify: `src/commands/commandRegistry.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add command registry tests for remaining shortcuts**

Update `CommandId` tests in `src/commands/commandRegistry.test.ts` so the MVP shortcut assertion expects:

```ts
expect(defaultShortcuts).toMatchObject({
  openFile: 'Meta+O',
  closeTab: 'Meta+W',
  find: 'Meta+F',
  findNext: 'Meta+G',
  findPrevious: 'Shift+Meta+G',
  toggleSidebar: 'Meta+B',
  zoomIn: 'Meta+=',
  zoomOut: 'Meta+-',
  fitWidth: 'Meta+0',
  fitPage: 'Meta+9',
  focusPage: 'Meta+L',
  historyBack: 'Meta+[',
  historyForward: 'Meta+]',
  nextTab: 'Control+Tab',
  previousTab: 'Shift+Control+Tab',
  addBookmark: 'Meta+D',
  addNote: 'Meta+Shift+N',
  openPreferences: 'Meta+,',
});
```

- [ ] **Step 2: Run command tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/commands/commandRegistry.test.ts
```

Expected: FAIL because the new shortcuts do not exist.

- [ ] **Step 3: Extend command IDs and defaults**

In `src/commands/commandRegistry.ts`, add command IDs:

```ts
  | 'zoom.fitWidth'
  | 'zoom.fitPage'
  | 'bookmark.add'
  | 'annotation.note'
  | 'preferences.open'
```

Add default shortcuts:

```ts
  fitWidth: 'Meta+0',
  fitPage: 'Meta+9',
  addBookmark: 'Meta+D',
  addNote: 'Meta+Shift+N',
  openPreferences: 'Meta+,',
```

- [ ] **Step 4: Wire no-op commands to real App actions**

In `src/app/App.tsx`, replace the existing no-op command registrations:

```ts
    registry.register({
      id: 'history.back',
      label: 'History Back',
      shortcut: defaultShortcuts.historyBack,
      run: () => {
        if (!activeSession) {
          return;
        }
        setDocuments((current) => stepSessionHistoryBack(current, activeSession.id));
        activeViewerController.jumpToPage(activeSession.history.backStack.at(-1) ?? activeSession.page);
      },
    });
```

Use the same pattern for:

```ts
    registry.register({
      id: 'history.forward',
      label: 'History Forward',
      shortcut: defaultShortcuts.historyForward,
      run: () => {
        if (!activeSession) {
          return;
        }
        setDocuments((current) => stepSessionHistoryForward(current, activeSession.id));
        activeViewerController.jumpToPage(activeSession.history.forwardStack[0] ?? activeSession.page);
      },
    });
    registry.register({
      id: 'tab.next',
      label: 'Next Tab',
      shortcut: defaultShortcuts.nextTab,
      run: () => setDocuments(selectNextSession),
    });
    registry.register({
      id: 'tab.previous',
      label: 'Previous Tab',
      shortcut: defaultShortcuts.previousTab,
      run: () => setDocuments(selectPreviousSession),
    });
    registry.register({
      id: 'zoom.fitWidth',
      label: 'Fit Width',
      shortcut: defaultShortcuts.fitWidth,
      run: () => activeViewerController.fitWidth(),
    });
    registry.register({
      id: 'zoom.fitPage',
      label: 'Fit Page',
      shortcut: defaultShortcuts.fitPage,
      run: () => activeViewerController.fitPage(),
    });
    registry.register({
      id: 'find.open',
      label: 'Find',
      shortcut: defaultShortcuts.find,
      run: () => activeViewerController.openSearch(),
    });
```

Bookmark and annotation commands are completed in Tasks 11 and 12.

- [ ] **Step 5: Add shortcut behavior tests**

Append to `src/app/App.test.tsx`:

```tsx
it('runs tab and fit mode shortcuts', () => {
  const viewerController = {
    jumpToPage: vi.fn().mockReturnValue(true),
    openSearch: vi.fn().mockReturnValue(true),
    search: vi.fn().mockReturnValue(true),
    searchNext: vi.fn().mockReturnValue(true),
    searchPrevious: vi.fn().mockReturnValue(true),
    zoomIn: vi.fn().mockReturnValue(true),
    zoomOut: vi.fn().mockReturnValue(true),
    fitWidth: vi.fn().mockReturnValue(true),
    fitPage: vi.fn().mockReturnValue(true),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={createEmptyPersistence()}
      viewerController={viewerController}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.keyDown(window, { key: '0', metaKey: true });
  fireEvent.keyDown(window, { key: '9', metaKey: true });
  fireEvent.keyDown(window, { key: 'f', metaKey: true });

  expect(viewerController.fitWidth).toHaveBeenCalledTimes(1);
  expect(viewerController.fitPage).toHaveBeenCalledTimes(1);
  expect(viewerController.openSearch).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 6: Verify**

Run:

```bash
bunx vitest run --dir src src/commands/commandRegistry.test.ts src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/commands/commandRegistry.ts src/commands/commandRegistry.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: wire reader command shortcuts"
```

## Task 11: Implement Bookmarks

**Files:**

- Create: `src/annotations/annotationModels.ts`
- Create: `src/annotations/annotationStore.ts`
- Create: `src/annotations/annotationStore.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write bookmark store tests**

Create `src/annotations/annotationStore.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addOrReplaceBookmark, removeBookmark } from './annotationStore';
import type { Bookmark } from './annotationModels';

describe('annotationStore bookmarks', () => {
  it('adds bookmarks sorted by page', () => {
    const first: Bookmark = {
      id: null,
      documentKey: 'desktop:/tmp/book.pdf',
      page: 10,
      title: 'Results',
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    };
    const second: Bookmark = { ...first, page: 2, title: 'Intro' };

    expect(addOrReplaceBookmark(addOrReplaceBookmark([], first), second).map((b) => b.page)).toEqual([
      2,
      10,
    ]);
  });

  it('removes bookmarks by id', () => {
    expect(
      removeBookmark(
        [
          {
            id: 1,
            documentKey: 'desktop:/tmp/book.pdf',
            page: 1,
            title: 'Intro',
            createdAt: '2026-06-16T00:00:00Z',
            updatedAt: '2026-06-16T00:00:00Z',
          },
        ],
        1,
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/annotations/annotationStore.test.ts
```

Expected: FAIL because annotation model files do not exist.

- [ ] **Step 3: Add bookmark models and store helpers**

Create `src/annotations/annotationModels.ts`:

```ts
export type HighlightAreaRecord = {
  pageIndex: number;
  top: number;
  left: number;
  height: number;
  width: number;
};

export type Bookmark = {
  id: number | null;
  documentKey: string;
  page: number;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type ReaderAnnotation = {
  id: number | null;
  documentKey: string;
  page: number;
  type: 'highlight' | 'note';
  color: string;
  text: string | null;
  quote: string | null;
  areas: HighlightAreaRecord[];
  createdAt: string;
  updatedAt: string;
};
```

Create `src/annotations/annotationStore.ts`:

```ts
import type { Bookmark, ReaderAnnotation } from './annotationModels';

export function addOrReplaceBookmark(bookmarks: Bookmark[], bookmark: Bookmark): Bookmark[] {
  return [...bookmarks.filter((item) => item.id !== bookmark.id), bookmark].sort(
    (left, right) => left.page - right.page || left.title.localeCompare(right.title),
  );
}

export function removeBookmark(bookmarks: Bookmark[], id: number): Bookmark[] {
  return bookmarks.filter((bookmark) => bookmark.id !== id);
}

export function addOrReplaceAnnotation(
  annotations: ReaderAnnotation[],
  annotation: ReaderAnnotation,
): ReaderAnnotation[] {
  return [...annotations.filter((item) => item.id !== annotation.id), annotation].sort(
    (left, right) => left.page - right.page || left.createdAt.localeCompare(right.createdAt),
  );
}

export function removeAnnotation(annotations: ReaderAnnotation[], id: number): ReaderAnnotation[] {
  return annotations.filter((annotation) => annotation.id !== id);
}
```

- [ ] **Step 4: Add App bookmark tests**

Append to `src/app/App.test.tsx`:

```tsx
it('adds and jumps to bookmarks', async () => {
  const persistence = {
    ...createEmptyPersistence(),
    saveBookmark: vi.fn().mockImplementation(async (bookmark) => ({ ...bookmark, id: 7 })),
    listBookmarks: vi.fn().mockResolvedValue([]),
    deleteBookmark: vi.fn(),
    listAnnotations: vi.fn().mockResolvedValue([]),
  };
  const viewerController = {
    jumpToPage: vi.fn().mockReturnValue(true),
    openSearch: vi.fn().mockReturnValue(true),
    search: vi.fn().mockReturnValue(true),
    searchNext: vi.fn().mockReturnValue(true),
    searchPrevious: vi.fn().mockReturnValue(true),
    zoomIn: vi.fn().mockReturnValue(true),
    zoomOut: vi.fn().mockReturnValue(true),
    fitWidth: vi.fn().mockReturnValue(true),
    fitPage: vi.fn().mockReturnValue(true),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={persistence}
      viewerController={viewerController}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.keyDown(window, { key: 'd', metaKey: true });

  await waitFor(() => {
    expect(persistence.saveBookmark).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Implement bookmark UI and commands**

In `src/app/App.tsx`, add state:

```ts
  const [bookmarksByDocument, setBookmarksByDocument] = useState<Record<string, Bookmark[]>>({});
```

Add helper:

```ts
  const addBookmarkForActivePage = async () => {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const saved = await persistence.saveBookmark({
      id: null,
      documentKey: activeSession.documentKey,
      page: activeSession.page,
      title: `Page ${activeSession.page}`,
      createdAt: now,
      updatedAt: now,
    });

    setBookmarksByDocument((current) => ({
      ...current,
      [activeSession.documentKey]: addOrReplaceBookmark(
        current[activeSession.documentKey] ?? [],
        saved,
      ),
    }));
  };
```

Register command:

```ts
    registry.register({
      id: 'bookmark.add',
      label: 'Add Bookmark',
      shortcut: defaultShortcuts.addBookmark,
      run: () => void addBookmarkForActivePage(),
    });
```

Render side panel bookmarks:

```tsx
            <section className="side-section">
              <h3>Bookmarks</h3>
              {(bookmarksByDocument[activeSession.documentKey] ?? []).map((bookmark) => (
                <button
                  key={bookmark.id ?? `${bookmark.page}-${bookmark.title}`}
                  type="button"
                  className="side-list-item"
                  onClick={() => {
                    setDocuments((current) =>
                      recordHardNavigation(current, activeSession.id, bookmark.page),
                    );
                    activeViewerController.jumpToPage(bookmark.page);
                  }}
                >
                  {bookmark.title}
                </button>
              ))}
              <button type="button" onClick={() => void addBookmarkForActivePage()}>
                Add bookmark
              </button>
            </section>
```

- [ ] **Step 6: Verify**

Run:

```bash
bunx vitest run --dir src src/annotations/annotationStore.test.ts src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/annotations src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add PDF bookmarks"
```

## Task 12: Implement SmartReader-Managed Annotations

**Files:**

- Modify: `src/viewer/PdfViewerBridge.tsx`
- Modify: `src/viewer/PdfViewerBridge.test.tsx`
- Modify: `src/annotations/annotationStore.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add annotation store tests**

Append to `src/annotations/annotationStore.test.ts`:

```ts
it('adds and removes annotations', () => {
  const annotation = {
    id: 4,
    documentKey: 'desktop:/tmp/book.pdf',
    page: 3,
    type: 'highlight' as const,
    color: '#facc15',
    text: 'Important',
    quote: 'quoted text',
    areas: [{ pageIndex: 2, top: 10, left: 10, height: 2, width: 20 }],
    createdAt: '2026-06-16T00:00:00Z',
    updatedAt: '2026-06-16T00:00:00Z',
  };

  expect(addOrReplaceAnnotation([], annotation)).toEqual([annotation]);
  expect(removeAnnotation([annotation], 4)).toEqual([]);
});
```

- [ ] **Step 2: Add viewer annotation callback types**

In `src/viewer/viewerTypes.ts`, add:

```ts
export type ViewerHighlightArea = {
  pageIndex: number;
  top: number;
  left: number;
  height: number;
  width: number;
};

export type ViewerHighlightSelection = {
  selectedText: string;
  page: number;
  areas: ViewerHighlightArea[];
};
```

- [ ] **Step 3: Add bridge props**

In `src/viewer/PdfViewerBridge.tsx`, import the highlight plugin:

```ts
import { highlightPlugin, Trigger, type HighlightArea } from '@react-pdf-viewer/highlight';
import '@react-pdf-viewer/highlight/lib/styles/index.css';
```

Add prop:

```ts
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
```

Pass it through `ActivePdfViewerBridge` and `ReactPdfViewer`.

- [ ] **Step 4: Bind highlight plugin**

Inside `ReactPdfViewer`, add:

```ts
  const highlightPluginInstance = highlightPlugin({
    trigger: Trigger.TextSelection,
    renderHighlightTarget: (props) => (
      <button
        type="button"
        className="highlight-target"
        onClick={() => {
          onHighlightSelection?.({
            selectedText: props.selectedText,
            page: props.selectionRegion.pageIndex + 1,
            areas: props.highlightAreas.map(mapHighlightArea),
          });
          props.cancel();
        }}
      >
        Save highlight
      </button>
    ),
    renderHighlights: (props) => (
      <>
        {annotations
          .flatMap((annotation) => annotation.areas)
          .filter((area) => area.pageIndex === props.pageIndex)
          .map((area, index) => (
            <div
              key={`${area.pageIndex}-${area.top}-${area.left}-${index}`}
              className="reader-highlight"
              style={props.getCssProperties(area, props.rotation)}
            />
          ))}
      </>
    ),
  });
```

Add helper in the same file:

```ts
function mapHighlightArea(area: HighlightArea): ViewerHighlightArea {
  return {
    pageIndex: area.pageIndex,
    top: area.top,
    left: area.left,
    height: area.height,
    width: area.width,
  };
}
```

Add `highlightPluginInstance` to the `plugins` array.

- [ ] **Step 5: Add App annotation tests**

Append to `src/app/App.test.tsx`:

```tsx
it('adds page notes through the note shortcut', async () => {
  const persistence = {
    ...createEmptyPersistence(),
    saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 3 })),
    listAnnotations: vi.fn().mockResolvedValue([]),
    listBookmarks: vi.fn().mockResolvedValue([]),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.keyDown(window, { key: 'N', metaKey: true, shiftKey: true });

  await waitFor(() => {
    expect(persistence.saveAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'note' }),
    );
  });
});
```

- [ ] **Step 6: Implement note and highlight state in App**

Add state:

```ts
  const [annotationsByDocument, setAnnotationsByDocument] = useState<Record<string, ReaderAnnotation[]>>({});
```

Add helper:

```ts
  const saveAnnotationForActiveDocument = async (
    input: Pick<ReaderAnnotation, 'page' | 'type' | 'color' | 'text' | 'quote' | 'areas'>,
  ) => {
    if (!activeSession) {
      return;
    }

    const now = new Date().toISOString();
    const saved = await persistence.saveAnnotation({
      id: null,
      documentKey: activeSession.documentKey,
      createdAt: now,
      updatedAt: now,
      ...input,
    });

    setAnnotationsByDocument((current) => ({
      ...current,
      [activeSession.documentKey]: addOrReplaceAnnotation(
        current[activeSession.documentKey] ?? [],
        saved,
      ),
    }));
  };

  const addPageNote = () =>
    saveAnnotationForActiveDocument({
      page: activeSession?.page ?? 1,
      type: 'note',
      color: '#38bdf8',
      text: 'Page note',
      quote: null,
      areas: [],
    });
```

Register command:

```ts
    registry.register({
      id: 'annotation.note',
      label: 'Add Note',
      shortcut: defaultShortcuts.addNote,
      run: () => void addPageNote(),
    });
```

Pass annotations and selection handler to `PdfViewerBridge`:

```tsx
              annotations={activeSession ? annotationsByDocument[activeSession.documentKey] ?? [] : []}
              onHighlightSelection={(selection) =>
                void saveAnnotationForActiveDocument({
                  page: selection.page,
                  type: 'highlight',
                  color: '#facc15',
                  text: null,
                  quote: selection.selectedText,
                  areas: selection.areas,
                })
              }
```

- [ ] **Step 7: Add annotation side panel list and delete**

Render:

```tsx
            <section className="side-section">
              <h3>Annotations</h3>
              {(annotationsByDocument[activeSession.documentKey] ?? []).map((annotation) => (
                <div key={annotation.id ?? `${annotation.page}-${annotation.createdAt}`} className="side-list-row">
                  <button
                    type="button"
                    className="side-list-item"
                    onClick={() => {
                      setDocuments((current) =>
                        recordHardNavigation(current, activeSession.id, annotation.page),
                      );
                      activeViewerController.jumpToPage(annotation.page);
                    }}
                  >
                    Page {annotation.page}: {annotation.quote ?? annotation.text ?? annotation.type}
                  </button>
                  {annotation.id ? (
                    <button
                      type="button"
                      aria-label="Delete annotation"
                      onClick={() => {
                        void persistence.deleteAnnotation(annotation.id!);
                        setAnnotationsByDocument((current) => ({
                          ...current,
                          [activeSession.documentKey]: removeAnnotation(
                            current[activeSession.documentKey] ?? [],
                            annotation.id!,
                          ),
                        }));
                      }}
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
              ))}
            </section>
```

- [ ] **Step 8: Verify**

Run:

```bash
bunx vitest run --dir src src/annotations/annotationStore.test.ts src/viewer/PdfViewerBridge.test.tsx src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/viewer src/annotations src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add SmartReader annotations"
```

## Task 13: Add Recent Files UI And Missing-File Recovery

**Files:**

- Modify: `src/library/recentFiles.ts`
- Modify: `src/library/recentFiles.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Extend recent file tests**

Append to `src/library/recentFiles.test.ts`:

```ts
it('maps rich recent file details', () => {
  expect(
    mapDocumentsToRecentFiles([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 2048,
        modifiedAt: '2026-06-16T00:00:00Z',
        pageCount: 20,
        lastPage: 5,
        progress: 0.25,
        missing: false,
      },
    ]),
  ).toEqual([
    {
      documentKey: 'desktop:/tmp/book.pdf',
      title: 'book.pdf',
      path: '/tmp/book.pdf',
      progressLabel: '25%',
      lastPageLabel: 'Page 5',
      fileSizeLabel: '2 KB',
      modifiedAtLabel: '2026-06-16T00:00:00Z',
      missing: false,
    },
  ]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/library/recentFiles.test.ts
```

Expected: FAIL because the new fields are missing.

- [ ] **Step 3: Implement rich recent mapping**

Update `RecentFileCard` in `src/library/recentFiles.ts`:

```ts
  fileSizeLabel: string;
  modifiedAtLabel: string;
```

Add helper:

```ts
function formatFileSize(bytes: number | null): string {
  if (!bytes) {
    return 'Unknown size';
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

Map:

```ts
      fileSizeLabel: formatFileSize(document.fileSize),
      modifiedAtLabel: document.modifiedAt ?? 'Unknown modified time',
```

- [ ] **Step 4: Add App tests for recent reopen**

Append to `src/app/App.test.tsx`:

```tsx
it('shows recent files and reopens one from the empty state', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:recent');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  const readDesktopPdf = vi.fn().mockResolvedValue({
    source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
    bytes: new Uint8Array([37, 80, 68, 70, 45]),
    fileSize: 5,
    modifiedAt: '2026-06-16T00:00:00Z',
  });
  const persistence = {
    ...createEmptyPersistence(),
    listRecentDocuments: vi.fn().mockResolvedValue([
      {
        documentKey: 'desktop:/tmp/book.pdf',
        path: '/tmp/book.pdf',
        displayName: 'book.pdf',
        fileSize: 2048,
        modifiedAt: '2026-06-16T00:00:00Z',
        pageCount: 20,
        lastPage: 5,
        progress: 0.25,
        missing: false,
      },
    ]),
    loadReaderSession: vi.fn().mockResolvedValue({ activeDocumentKey: null, sidebarOpen: true, tabs: [] }),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.click(await screen.findByRole('button', { name: 'Open recent book.pdf' }));

  await waitFor(() => {
    expect(readDesktopPdf).toHaveBeenCalledWith('/tmp/book.pdf');
  });
});
```

- [ ] **Step 5: Render recent files**

In `src/app/App.tsx`, add:

```ts
  const [recentDocuments, setRecentDocuments] = useState<PersistedDocument[]>([]);
```

Set it in restore startup:

```ts
      setRecentDocuments(restoredDocuments);
```

Add reopen helper:

```ts
  const reopenRecentDocument = async (document: PersistedDocument) => {
    if (!document.path) {
      return;
    }

    try {
      const opened = await bridge.readDesktopPdf(document.path);
      openBytes(opened.source, opened.bytes, {
        fileSize: opened.fileSize,
        modifiedAt: opened.modifiedAt,
      });
    } catch (error) {
      setRecentDocuments((current) =>
        current.map((item) =>
          item.documentKey === document.documentKey ? { ...item, missing: true } : item,
        ),
      );
    }
  };
```

Render in empty state:

```tsx
              <div className="recent-grid">
                {mapDocumentsToRecentFiles(recentDocuments).map((file) => (
                  <button
                    key={file.documentKey}
                    type="button"
                    className={file.missing ? 'recent-card missing' : 'recent-card'}
                    aria-label={`Open recent ${file.title}`}
                    title={file.path ?? ''}
                    onClick={() => {
                      const document = recentDocuments.find(
                        (candidate) => candidate.documentKey === file.documentKey,
                      );
                      if (document) {
                        void reopenRecentDocument(document);
                      }
                    }}
                  >
                    <strong>{file.title}</strong>
                    <span>{file.progressLabel}</span>
                    <span>{file.lastPageLabel}</span>
                    <span>{file.fileSizeLabel}</span>
                  </button>
                ))}
              </div>
```

- [ ] **Step 6: Add CSS**

Add to `src/app/styles.css`:

```css
.recent-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 8px;
  margin-top: 18px;
}

.recent-card {
  min-height: 96px;
  display: grid;
  gap: 6px;
  align-content: start;
  padding: 10px;
  text-align: left;
}

.recent-card span {
  color: #6b6258;
  font-size: 12px;
}

.recent-card.missing {
  border-color: rgba(180, 83, 9, 0.45);
}
```

- [ ] **Step 7: Verify**

Run:

```bash
bunx vitest run --dir src src/library/recentFiles.test.ts src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/library/recentFiles.ts src/library/recentFiles.test.ts src/app/App.tsx src/app/App.test.tsx src/app/styles.css
git commit -m "feat: add recent PDF library"
```

## Task 14: Add Annotation Import And Export

**Files:**

- Modify: `src/annotations/annotationStore.ts`
- Modify: `src/annotations/annotationStore.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Write import/export tests**

Append to `src/annotations/annotationStore.test.ts`:

```ts
it('exports and imports annotation JSON', () => {
  const annotations = [
    {
      id: 1,
      documentKey: 'desktop:/tmp/book.pdf',
      page: 3,
      type: 'note' as const,
      color: '#38bdf8',
      text: 'Remember this',
      quote: null,
      areas: [],
      createdAt: '2026-06-16T00:00:00Z',
      updatedAt: '2026-06-16T00:00:00Z',
    },
  ];

  const json = exportAnnotations(annotations);
  expect(importAnnotations(json)).toEqual(annotations);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run --dir src src/annotations/annotationStore.test.ts
```

Expected: FAIL because import/export helpers do not exist.

- [ ] **Step 3: Implement import/export helpers**

Add to `src/annotations/annotationStore.ts`:

```ts
export function exportAnnotations(annotations: ReaderAnnotation[]): string {
  return JSON.stringify({ version: 1, annotations }, null, 2);
}

export function importAnnotations(json: string): ReaderAnnotation[] {
  const parsed = JSON.parse(json) as { version?: number; annotations?: ReaderAnnotation[] };

  if (parsed.version !== 1 || !Array.isArray(parsed.annotations)) {
    throw new Error('Unsupported annotation export');
  }

  return parsed.annotations;
}
```

- [ ] **Step 4: Add App export/import controls**

Add side panel buttons:

```tsx
              <button
                type="button"
                onClick={() => {
                  if (!activeSession) {
                    return;
                  }
                  const json = exportAnnotations(
                    annotationsByDocument[activeSession.documentKey] ?? [],
                  );
                  void navigator.clipboard?.writeText(json);
                }}
              >
                Export annotations
              </button>
              <textarea
                aria-label="Annotation import JSON"
                className="annotation-import"
                onBlur={(event) => {
                  if (!activeSession || !event.target.value.trim()) {
                    return;
                  }
                  const imported = importAnnotations(event.target.value);
                  setAnnotationsByDocument((current) => ({
                    ...current,
                    [activeSession.documentKey]: imported,
                  }));
                }}
              />
```

- [ ] **Step 5: Verify**

Run:

```bash
bunx vitest run --dir src src/annotations/annotationStore.test.ts src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/annotations/annotationStore.ts src/annotations/annotationStore.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add annotation import export"
```

## Task 15: Add Desktop Open With And File Association

**Files:**

- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src/platform/pathFilters.ts`
- Create: `src/platform/pathFilters.test.ts`
- Create: `src/platform/openWithEvents.ts`
- Create: `src/platform/openWithEvents.test.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add path filter tests**

Create `src/platform/pathFilters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { getPdfPathsFromArgs } from './pathFilters';

describe('pathFilters', () => {
  it('extracts PDF paths from Open With args', () => {
    expect(getPdfPathsFromArgs(['SmartReader', '/tmp/a.pdf', '--flag', '/tmp/b.txt'])).toEqual([
      '/tmp/a.pdf',
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run --dir src src/platform/pathFilters.test.ts
```

Expected: FAIL because `pathFilters.ts` does not exist.

- [ ] **Step 3: Implement path filter**

Create `src/platform/pathFilters.ts`:

```ts
export function getPdfPathsFromArgs(args: string[]): string[] {
  return args.filter((arg) => arg.toLowerCase().endsWith('.pdf'));
}
```

- [ ] **Step 4: Add single-instance dependency**

Run:

```bash
cd src-tauri
cargo add tauri-plugin-single-instance --target 'cfg(any(target_os = "macos", windows, target_os = "linux"))'
```

Expected: `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` include `tauri-plugin-single-instance`.

- [ ] **Step 5: Register single instance first**

In `src-tauri/src/lib.rs`, rewrite builder setup so single-instance is registered before dialog/fs:

```rust
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }
            let pdf_paths: Vec<String> = args
                .into_iter()
                .filter(|arg| arg.to_lowercase().ends_with(".pdf"))
                .collect();
            if !pdf_paths.is_empty() {
                let _ = app.emit("smartreader://open-pdfs", pdf_paths);
            }
        }));
    }

    builder
        .setup(|app| {
            let database = db::setup_database(app.handle())?;
            app.manage(database);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            db::save_document,
            db::list_recent_documents,
            db::save_reader_session,
            db::load_reader_session,
            db::save_bookmark,
            db::list_bookmarks,
            db::delete_bookmark,
            db::save_annotation,
            db::list_annotations,
            db::delete_annotation,
            file_commands::read_desktop_pdf,
            file_commands::read_cached_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SmartReader");
}
```

- [ ] **Step 6: Add file association config**

In `src-tauri/tauri.conf.json`, add to `bundle`:

```json
    "fileAssociations": [
      {
        "ext": ["pdf"],
        "mimeType": "application/pdf",
        "name": "PDF document",
        "description": "PDF document"
      }
    ]
```

Keep existing `"active"`, `"targets"`, and `"icon"` keys.

- [ ] **Step 7: Add frontend event listener**

Create `src/platform/openWithEvents.ts`:

```ts
import { listen } from '@tauri-apps/api/event';
import { getPdfPathsFromArgs } from './pathFilters';

export type OpenWithListener = (paths: string[]) => void;

export async function listenForOpenWith(listener: OpenWithListener): Promise<() => void> {
  const unlisten = await listen<string[]>('smartreader://open-pdfs', (event) => {
    const paths = getPdfPathsFromArgs(event.payload);

    if (paths.length > 0) {
      listener(paths);
    }
  });

  return unlisten;
}
```

- [ ] **Step 8: Wire event listener in App**

In `src/app/App.tsx`, add:

```ts
  useEffect(() => {
    let disposed = false;
    let disposeListener: (() => void) | null = null;

    listenForOpenWith((paths) => {
      for (const path of paths) {
        void openDesktopPath(path);
      }
    }).then((dispose) => {
      if (disposed) {
        dispose();
      } else {
        disposeListener = dispose;
      }
    });

    return () => {
      disposed = true;
      disposeListener?.();
    };
  }, [openDesktopPath]);
```

Implement `openDesktopPath`:

```ts
  const openDesktopPath = async (path: string) => {
    const opened = await bridge.readDesktopPdf(path);
    openBytes(opened.source, opened.bytes, {
      fileSize: opened.fileSize,
      modifiedAt: opened.modifiedAt,
    });
  };
```

- [ ] **Step 9: Verify**

Run:

```bash
bunx vitest run --dir src src/platform/pathFilters.test.ts src/app/App.test.tsx
bun run typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add package.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/tauri.conf.json src/platform/pathFilters.ts src/platform/pathFilters.test.ts src/platform/openWithEvents.ts src/platform/openWithEvents.test.ts src/app/App.tsx src/app/App.test.tsx
git commit -m "feat: add desktop PDF open integration"
```

## Task 16: Add Preferences UI And Shortcut Conflict Warning

**Files:**

- Modify: `src/app/App.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/styles.css`
- Modify: `src/commands/commandRegistry.ts`

- [ ] **Step 1: Add App tests**

Append to `src/app/App.test.tsx`:

```tsx
it('shows shortcut conflicts in preferences', () => {
  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={createEmptyPersistence()}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.keyDown(window, { key: ',', metaKey: true });

  expect(screen.getByRole('dialog', { name: 'Preferences' })).toBeInTheDocument();
  expect(screen.getByText('Session restore')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run --dir src src/app/App.test.tsx
```

Expected: FAIL because the preferences dialog does not exist.

- [ ] **Step 3: Add preferences dialog state and command**

In `src/app/App.tsx`, add:

```ts
  const [preferencesOpen, setPreferencesOpen] = useState(false);
```

Register:

```ts
    registry.register({
      id: 'preferences.open',
      label: 'Preferences',
      shortcut: defaultShortcuts.openPreferences,
      run: () => setPreferencesOpen(true),
    });
```

Render:

```tsx
      {preferencesOpen ? (
        <section role="dialog" aria-label="Preferences" className="preferences-panel">
          <header>
            <h2>Preferences</h2>
            <button type="button" onClick={() => setPreferencesOpen(false)}>
              Close
            </button>
          </header>
          <label>
            <input
              type="checkbox"
              checked={readerPreferences.sessionRestoreEnabled}
              onChange={(event) =>
                setReaderPreferences((current) => ({
                  ...current,
                  sessionRestoreEnabled: event.target.checked,
                }))
              }
            />
            Session restore
          </label>
          <section>
            <h3>Shortcut conflicts</h3>
            {commandRegistry.getShortcutConflicts().length === 0 ? (
              <p>No conflicts</p>
            ) : (
              commandRegistry.getShortcutConflicts().map((conflict) => (
                <p key={conflict.shortcut}>
                  {conflict.shortcut}: {conflict.commandIds.join(', ')}
                </p>
              ))
            )}
          </section>
        </section>
      ) : null}
```

- [ ] **Step 4: Add preferences CSS**

Add to `src/app/styles.css`:

```css
.preferences-panel {
  position: fixed;
  z-index: 20;
  inset: 80px auto auto 50%;
  width: min(420px, calc(100vw - 32px));
  transform: translateX(-50%);
  padding: 16px;
  border: 1px solid rgba(93, 79, 61, 0.18);
  border-radius: 8px;
  background: #fffaf0;
  box-shadow: 0 24px 60px rgba(76, 62, 42, 0.2);
}

.preferences-panel header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
```

- [ ] **Step 5: Verify**

Run:

```bash
bunx vitest run --dir src src/app/App.test.tsx
bun run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/App.tsx src/app/App.test.tsx src/app/styles.css src/commands/commandRegistry.ts
git commit -m "feat: add reader preferences panel"
```

## Task 17: Final Validation And README Alignment

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md` only if implementation decisions changed

- [ ] **Step 1: Update README technology wording**

Replace README references to EmbedPDF/PDFium ownership with wording matching the approved implementation:

```md
PDF 阅读基于 `@react-pdf-viewer` 和 PDF.js。SmartReader 通过 React bridge 调用 viewer 的渲染、搜索、页码、缩放和高亮能力；SmartReader 自己管理桌面文件打开、标签页、最近文件、会话恢复、书签、批注、快捷键、缓存和 SQLite 持久化。
```

Add a section:

```md
## 当前 MVP 范围

当前实现聚焦 PDF 阅读器核心能力：本地 PDF 打开、阅读、搜索、跳转、缩放、书签、SmartReader 管理的批注、最近文件、会话恢复、快捷键、缓存和桌面系统集成。

分类、标签、分类级加密、RAG、云同步、写回原始 PDF 文件不属于当前 MVP。
```

- [ ] **Step 2: Run full validation**

Run:

```bash
bun run typecheck
bun run test
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- TypeScript typecheck exits 0.
- Vitest exits 0 and does not discover `.worktrees/**`.
- Vite production build exits 0. Existing pdfjs direct-eval and large chunk warnings are acceptable unless the build exits non-zero.
- Rust format check exits 0.
- Rust tests exit 0.

- [ ] **Step 3: Inspect changed files**

Run:

```bash
git status --short
git diff --check
```

Expected:

- Only files from this plan are modified.
- `git diff --check` exits 0.

- [ ] **Step 4: Commit final docs and validation fixes**

```bash
git add README.md docs/superpowers/specs/2026-06-15-smartreader-pdf-reader-design.md
git commit -m "docs: align SmartReader MVP scope"
```

Do not run the docs commit command when neither file changed.

## Final Manual Acceptance Checklist

The agent must not start the app automatically. The user runs desktop manual testing.

After implementation, ask the user to run these checks:

```bash
bun run tauri dev
```

Manual checks:

- Open a PDF through the native dialog.
- Open a PDF through the browser file picker.
- Drag a PDF into the app.
- Open the same desktop path twice and confirm one tab is focused.
- Switch between two PDF tabs and confirm each keeps its page.
- Search text, jump next, jump previous.
- Jump to a page, go back, go forward.
- Zoom in, zoom out, fit width, fit page, and trackpad pinch/ctrl-wheel zoom.
- Add a bookmark, restart, and confirm the bookmark persists.
- Add a highlight or note, restart, and confirm it persists.
- Export annotations to JSON and import them back.
- Close and reopen the app and confirm desktop-path tabs restore with visible PDFs.
- Rename/delete a previously opened PDF and confirm SmartReader shows a recoverable missing-file state.
- Use macOS Open With on a PDF and confirm SmartReader opens/focuses the document.

## Plan Self-Review

Spec coverage:

- Local PDF open: Tasks 7, 8, 13, 15.
- Reading/rendering/session restore: Tasks 5, 8, 17.
- Search/jump/zoom/history: Tasks 5, 9, 10.
- Bookmarks: Task 11.
- Annotations: Tasks 12 and 14.
- Recent files: Task 13.
- Shortcuts/preferences: Tasks 6, 10, 16.
- Cache: Task 4.
- Desktop integration: Task 15.
- Validation and README alignment: Tasks 1 and 17.

Placeholder scan:

- The plan has no deferred-work markers.
- Every task lists concrete files, test commands, and expected results.

Type consistency:

- Frontend persistence uses camelCase types.
- Rust persistence structs use `#[serde(rename_all = "camelCase")]`.
- `documentKey`, `sessionId`, `page`, `zoom`, `history`, `areas`, and `sidebarOpen` names are consistent across frontend models and Rust command payloads.
