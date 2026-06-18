# SmartReader MVP Workbench Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize SmartReader so the full local-first PDF reader MVP is manually testable and presented through the approved prototype-style workbench UI.

**Architecture:** Keep PDF rendering isolated in `src/viewer/PdfViewerBridge.tsx`, move app orchestration out of `src/app/App.tsx`, and route document operations through focused `src/reader/hooks/*` hooks. Rust owns local file reads, SQLite migrations, preferences, favorites, tags, and persistent document state behind typed frontend persistence APIs.

**Tech Stack:** Bun, Vite, React 18, TypeScript, Vitest, Tauri v2, Rust, rusqlite, `@react-pdf-viewer@3.12.0`, `pdfjs-dist@3.11.174`, lucide-react.

---

## Scope Check

This plan implements the confirmed spec in `docs/superpowers/specs/2026-06-18-smartreader-mvp-workbench-stabilization-design.md`.

The spec touches several subsystems, but they are not independent products. The first deliverable is a single usable local PDF workbench. The tasks below are split into commit-sized slices that produce working, testable software in sequence:

1. PDF open/render stabilization.
2. Tauri, SQLite, preferences, favorites, and tags persistence.
3. Frontend typed models and persistence facade.
4. App decomposition into approved package structure.
5. Prototype-aligned home and reader shell.
6. Search, annotations, notes, favorites, and tags wiring.
7. Settings and tag manager workspaces.
8. Final validation and documentation alignment.

## Current Worktree Notes

- `README.md` and `package.json` currently have unrelated local modifications. Do not stage, commit, revert, or reformat them unless a task explicitly requires touching the same lines.
- Existing migrations under `src-tauri/src/migrations` must not be modified.
- The next migration file is `src-tauri/src/migrations/003_workbench_stabilization.sql`.
- Do not start the app automatically. Use automated checks and leave manual runtime testing to the user.
- Do not open a browser.

## Target File Structure

Create and modify these files during implementation.

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

Ownership rules:

- `src/app/App.tsx` stays under 30 lines and only mounts `ReaderApp`.
- `src/app/ReaderApp.tsx` owns top-level workspace switching and dependency composition.
- `src/reader/hooks/*` owns document opening, restore, commands, navigation, persistence, and decorations.
- `src/viewer/PdfViewerBridge.tsx` is the only frontend file importing `@react-pdf-viewer/*`.
- `src/tags/*` owns tag UI, tag models, and pure tag state helpers.
- `src/favorites/*` owns pure favorite state helpers.
- `src-tauri/src/db.rs` owns SQLite setup, migration tracking, and persistence commands.
- `src-tauri/capabilities/default.json` owns Tauri v2 permissions for the main window.

## Task 1: Stabilize PDF Open And Viewer Loading

**Files:**

- Modify: `src/viewer/PdfViewerBridge.tsx`
- Modify: `src/viewer/PdfViewerBridge.test.tsx`
- Modify: `src/viewer/viewerTypes.ts`
- Modify: `src/app/styles.css`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add failing viewer contract tests**

Append tests to `src/viewer/PdfViewerBridge.test.tsx` that prove document load, load errors, timeout, and controller binding are visible contracts.

```tsx
it('reports document load progress with total pages', () => {
  const renderer: PdfRenderer = ({ onPageChange, onZoomChange }) => (
    <button
      type="button"
      onClick={() => {
        onPageChange(2, 12);
        onZoomChange(1.5);
      }}
    >
      Load
    </button>
  );
  const onProgressChange = vi.fn();

  render(
    <PdfViewerBridge
      source={{ sessionId: 'session-a', url: 'blob:book' }}
      renderer={renderer}
      onProgressChange={onProgressChange}
    />,
  );

  screen.getByRole('button', { name: 'Load' }).click();

  expect(onProgressChange).toHaveBeenLastCalledWith({
    sessionId: 'session-a',
    page: 2,
    totalPages: 12,
    zoom: 1.5,
  });
});

it('shows a recoverable timeout instead of spinning forever', async () => {
  vi.useFakeTimers();
  const renderer: PdfRenderer = () => <div>Loading forever</div>;

  render(
    <PdfViewerBridge
      source={{ sessionId: 'session-a', url: 'blob:book' }}
      renderer={renderer}
      loadingTimeoutMs={1000}
      onProgressChange={vi.fn()}
    />,
  );

  vi.advanceTimersByTime(1000);

  expect(await screen.findByRole('alert')).toHaveTextContent('PDF loading timed out');
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run viewer tests and confirm the new timeout contract fails**

Run:

```bash
bun run test -- src/viewer/PdfViewerBridge.test.tsx
```

Expected: FAIL because `loadingTimeoutMs` and timeout UI do not exist yet.

- [ ] **Step 3: Extend viewer types**

Update `src/viewer/viewerTypes.ts` with explicit loading status types:

```ts
export type ViewerLoadStatus =
  | 'idle'
  | 'loading-document'
  | 'measuring-pages'
  | 'ready'
  | 'error'
  | 'timeout';

export type ViewerLoadError = {
  status: 'error' | 'timeout';
  message: string;
};
```

- [ ] **Step 4: Add timeout and error props to `PdfViewerBridge`**

Update `PdfViewerBridgeProps` in `src/viewer/PdfViewerBridge.tsx`:

```ts
export type PdfViewerBridgeProps = {
  source: ViewerSource | null;
  annotations?: ReaderAnnotation[];
  loadingTimeoutMs?: number;
  onHighlightSelection?(selection: ViewerHighlightSelection): void;
  onLoadError?(error: ViewerLoadError): void;
  onProgressChange(progress: ViewerProgress): void;
  controller?: ViewerController;
  renderer?: PdfRenderer;
};
```

Use `loadingTimeoutMs = 15000` as the default. Track whether any successful page or zoom event has been reported for the active `source.sessionId`. If the timeout elapses first, render:

```tsx
<section className="viewer-load-error" role="alert">
  <h2>PDF loading timed out</h2>
  <p>The PDF viewer did not finish loading this document.</p>
</section>
```

Call `onLoadError?.({ status: 'timeout', message: 'PDF loading timed out' })`.

- [ ] **Step 5: Memoize real viewer plugins**

Inside `ReactPdfViewer`, wrap the toolbar and highlight plugin creation with `useMemo` so command bindings do not drift across rerenders:

```ts
const toolbarPluginInstance = useMemo(
  () =>
    toolbarPlugin({
      pageNavigationPlugin: { enableShortcuts: false },
      searchPlugin: { enableShortcuts: false },
      zoomPlugin: { enableShortcuts: false },
    }),
  [],
);
```

Also memoize `highlightPluginInstance` with dependencies on `annotations` and `onHighlightSelection`.

- [ ] **Step 6: Add real viewer load and error callbacks**

In the `<Viewer />` props, add:

```tsx
renderLoader={(percentage) => (
  <div className="viewer-loading" role="status">
    Loading PDF {Math.round(percentage)}%
  </div>
)}
renderError={(error) => (
  <section className="viewer-load-error" role="alert">
    <h2>PDF failed to load</h2>
    <p>{error.message}</p>
  </section>
)}
onDocumentLoad={(event) => onPageChange(1, event.doc.numPages)}
```

- [ ] **Step 7: Add stable viewer layout styles**

Append to `src/app/styles.css`:

```css
.pdf-viewer-bridge {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: #f7f8fb;
}

.viewer-plugin-toolbar {
  min-height: 40px;
  border-bottom: 1px solid rgba(15, 23, 42, 0.1);
  background: rgba(255, 255, 255, 0.92);
}

.viewer-plugin-toolbar-inner {
  min-height: 40px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
}

.viewer-loading,
.viewer-load-error {
  align-self: center;
  justify-self: center;
  color: #334155;
}

.viewer-load-error {
  width: min(420px, calc(100vw - 48px));
  padding: 20px;
  border: 1px solid rgba(220, 38, 38, 0.22);
  border-radius: 8px;
  background: #fff;
}
```

- [ ] **Step 8: Verify viewer tests**

Run:

```bash
bun run test -- src/viewer/PdfViewerBridge.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Verify current frontend checks**

Run:

```bash
bun run typecheck
bun run test
bun run build
```

Expected: all commands exit 0. `bun run build` may still print the existing PDF.js direct `eval` warning.

- [ ] **Step 10: Commit**

```bash
git add src/viewer/PdfViewerBridge.tsx src/viewer/PdfViewerBridge.test.tsx src/viewer/viewerTypes.ts src/app/styles.css src/app/App.test.tsx
git commit -m "fix(viewer): surface PDF loading failures"
```

## Task 2: Add Tauri Capabilities And Safe SQLite Migration Tracking

**Files:**

- Create: `src-tauri/capabilities/default.json`
- Create: `src-tauri/src/migrations/003_workbench_stabilization.sql`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust tests for repeat database open and preferences**

In `src-tauri/src/db.rs`, add tests:

```rust
#[test]
fn opens_database_twice_without_replaying_alter_table() {
    let path = std::env::temp_dir().join(format!(
        "smartreader-{}-{}.sqlite3",
        std::process::id(),
        OffsetDateTime::now_utc().unix_timestamp_nanos()
    ));
    let _ = std::fs::remove_file(&path);

    let first = open_database(&path).expect("first open");
    drop(first);
    let second = open_database(&path).expect("second open");

    let count: i64 = second
        .query_row(
            "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
            [],
            |row| row.get(0),
        )
        .expect("migration table count");
    assert_eq!(count, 1);
    let _ = std::fs::remove_file(&path);
}

#[test]
fn saves_and_loads_reader_preferences() {
    let connection = Connection::open_in_memory().expect("in-memory database");
    apply_migrations(&connection).expect("migrations");

    let preferences = serde_json::json!({
        "sessionRestoreEnabled": true,
        "defaultZoomMode": "fit-width",
        "shortcuts": { "file.open": "Meta+O" }
    });

    save_preferences_tx(&connection, &preferences).expect("save preferences");
    assert_eq!(
        load_preferences_tx(&connection).expect("load preferences"),
        Some(preferences)
    );
}
```

- [ ] **Step 2: Run Rust tests and confirm migration replay failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml opens_database_twice_without_replaying_alter_table
```

Expected: FAIL because `open_database` currently executes concatenated SQL every time.

- [ ] **Step 3: Create Tauri capabilities**

Create `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "SmartReader main window permissions",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "core:event:allow-listen",
    "dialog:allow-open"
  ]
}
```

- [ ] **Step 4: Add the workbench migration**

Create `src-tauri/src/migrations/003_workbench_stabilization.sql`:

```sql
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS document_tags (
    document_key TEXT NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (document_key, tag_id),
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS annotation_tags (
    annotation_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (annotation_id, tag_id),
    FOREIGN KEY (annotation_id) REFERENCES annotations(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_tags_tag_id ON document_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_annotation_tags_tag_id ON annotation_tags(tag_id);
```

- [ ] **Step 5: Replace concatenated migration execution with migration tracking**

In `src-tauri/src/db.rs`, replace `INIT_SQL` usage with ordered migration constants:

```rust
const MIGRATIONS: &[(&str, &str)] = &[
    ("001_init", include_str!("migrations/001_init.sql")),
    (
        "002_reader_core_completion",
        include_str!("migrations/002_reader_core_completion.sql"),
    ),
    (
        "003_workbench_stabilization",
        include_str!("migrations/003_workbench_stabilization.sql"),
    ),
];
```

Add:

```rust
pub fn apply_migrations(connection: &Connection) -> Result<(), DbError> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        );
        "#,
    )?;

    let legacy_002_present = column_exists(connection, "documents", "favorite")?
        && table_exists(connection, "annotations")?;

    if legacy_002_present {
        mark_migration_applied(connection, "001_init")?;
        mark_migration_applied(connection, "002_reader_core_completion")?;
    }

    for (version, sql) in MIGRATIONS {
        if migration_applied(connection, version)? {
            continue;
        }

        let tx = connection.unchecked_transaction()?;
        tx.execute_batch(sql)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
            params![version, now_rfc3339()],
        )?;
        tx.commit()?;
    }

    Ok(())
}
```

Add helper functions `table_exists`, `column_exists`, `migration_applied`, and `mark_migration_applied` using `sqlite_master`, `pragma_table_info`, and `INSERT OR IGNORE`.

Update `open_database` to call `apply_migrations(&connection)?`.

- [ ] **Step 6: Add preferences commands**

Add serializable preference command handlers in `src-tauri/src/db.rs`:

```rust
#[tauri::command]
pub fn save_preferences(
    state: State<'_, DatabaseState>,
    preferences: serde_json::Value,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    save_preferences_tx(&connection, &preferences)
}

#[tauri::command]
pub fn load_preferences(
    state: State<'_, DatabaseState>,
) -> Result<Option<serde_json::Value>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    load_preferences_tx(&connection)
}
```

Use key `reader_preferences` in the existing `preferences` table.

- [ ] **Step 7: Register preference commands**

In `src-tauri/src/lib.rs`, add `db::save_preferences` and `db::load_preferences` to `tauri::generate_handler![...]`.

- [ ] **Step 8: Verify Rust tests**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: both commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add src-tauri/capabilities/default.json src-tauri/src/migrations/003_workbench_stabilization.sql src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "fix(tauri): add reader permissions and safe migrations"
```

## Task 3: Add Favorites And Tags Persistence Contracts

**Files:**

- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/persistence/persistenceApi.test.ts`
- Create: `src/tags/tagModels.ts`
- Create: `src/tags/tagStore.ts`
- Create: `src/favorites/favoriteModels.ts`
- Create: `src/favorites/favoriteStore.ts`

- [ ] **Step 1: Add frontend persistence tests**

Append to `src/persistence/persistenceApi.test.ts`:

```ts
it('persists favorites and tags through Tauri invoke', async () => {
  const invoke = vi.fn().mockResolvedValue([]);
  const api = createPersistenceApi(invoke);

  await api.setDocumentFavorite('desktop:/tmp/book.pdf', true);
  await api.listFavoriteDocuments();
  await api.createTag({ name: '机器学习', color: '#2563eb' });
  await api.renameTag(1, '深度学习');
  await api.mergeTags({ sourceTagId: 1, targetTagId: 2 });
  await api.attachDocumentTag('desktop:/tmp/book.pdf', 2);
  await api.attachAnnotationTag(7, 2);

  expect(invoke).toHaveBeenCalledWith('set_document_favorite', {
    documentKey: 'desktop:/tmp/book.pdf',
    favorite: true,
  });
  expect(invoke).toHaveBeenCalledWith('list_favorite_documents');
  expect(invoke).toHaveBeenCalledWith('create_tag', {
    input: { name: '机器学习', color: '#2563eb' },
  });
  expect(invoke).toHaveBeenCalledWith('rename_tag', { id: 1, name: '深度学习' });
  expect(invoke).toHaveBeenCalledWith('merge_tags', {
    input: { sourceTagId: 1, targetTagId: 2 },
  });
  expect(invoke).toHaveBeenCalledWith('attach_document_tag', {
    documentKey: 'desktop:/tmp/book.pdf',
    tagId: 2,
  });
  expect(invoke).toHaveBeenCalledWith('attach_annotation_tag', {
    annotationId: 7,
    tagId: 2,
  });
});
```

- [ ] **Step 2: Run the persistence API test and confirm missing methods**

Run:

```bash
bun run test -- src/persistence/persistenceApi.test.ts
```

Expected: FAIL because the new persistence API methods do not exist.

- [ ] **Step 3: Add TypeScript models**

Create `src/tags/tagModels.ts`:

```ts
export type Tag = {
  id: number;
  name: string;
  color: string;
  documentCount: number;
  annotationCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateTagInput = {
  name: string;
  color: string;
};

export type MergeTagsInput = {
  sourceTagId: number;
  targetTagId: number;
};
```

Create `src/favorites/favoriteModels.ts`:

```ts
export type FavoriteDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  lastPage: number;
  progress: number;
};
```

- [ ] **Step 4: Add pure store helpers**

Create `src/tags/tagStore.ts`:

```ts
import type { Tag } from './tagModels';

export function addOrReplaceTag(tags: Tag[], tag: Tag): Tag[] {
  const withoutTag = tags.filter((candidate) => candidate.id !== tag.id);
  return [...withoutTag, tag].sort((a, b) => a.name.localeCompare(b.name));
}

export function removeTag(tags: Tag[], id: number): Tag[] {
  return tags.filter((tag) => tag.id !== id);
}
```

Create `src/favorites/favoriteStore.ts`:

```ts
export function setFavoriteFlag<T extends { documentKey: string; favorite?: boolean }>(
  documents: T[],
  documentKey: string,
  favorite: boolean,
): T[] {
  return documents.map((document) =>
    document.documentKey === documentKey ? { ...document, favorite } : document,
  );
}
```

- [ ] **Step 5: Extend frontend persistence API**

In `src/persistence/persistenceApi.ts`, import tag models and add methods:

```ts
setDocumentFavorite(documentKey: string, favorite: boolean): Promise<void>;
listFavoriteDocuments(): Promise<FavoriteDocument[]>;
createTag(input: CreateTagInput): Promise<Tag>;
renameTag(id: number, name: string): Promise<Tag>;
deleteTag(id: number): Promise<void>;
mergeTags(input: MergeTagsInput): Promise<Tag>;
listTags(): Promise<Tag[]>;
attachDocumentTag(documentKey: string, tagId: number): Promise<void>;
detachDocumentTag(documentKey: string, tagId: number): Promise<void>;
attachAnnotationTag(annotationId: number, tagId: number): Promise<void>;
detachAnnotationTag(annotationId: number, tagId: number): Promise<void>;
```

Implement each method with the command names used in the test.

- [ ] **Step 6: Add Rust command tests for tags and favorites**

In `src-tauri/src/db.rs`, add Rust tests that create a document, mark it favorite, create two tags, attach one tag to the document, merge tags, and verify the target tag retains the relation.

- [ ] **Step 7: Implement Rust commands**

Add Rust structs:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedTag {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub document_count: i64,
    pub annotation_count: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CreateTagInput {
    pub name: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MergeTagsInput {
    pub source_tag_id: i64,
    pub target_tag_id: i64,
}
```

Add Tauri commands for the frontend methods and register them in `src-tauri/src/lib.rs`.

- [ ] **Step 8: Verify frontend and Rust persistence**

Run:

```bash
bun run typecheck
bun run test -- src/persistence/persistenceApi.test.ts
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src/tags/tagModels.ts src/tags/tagStore.ts src/favorites/favoriteModels.ts src/favorites/favoriteStore.ts src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat(data): persist favorites and tags"
```

## Task 4: Decompose App Into ReaderApp And Reader Hooks

**Files:**

- Modify: `src/app/App.tsx`
- Create: `src/app/ReaderApp.tsx`
- Create: `src/app/appTypes.ts`
- Create: `src/reader/hooks/useDocumentOpening.ts`
- Create: `src/reader/hooks/useSessionRestore.ts`
- Create: `src/reader/hooks/useReaderCommands.ts`
- Create: `src/reader/hooks/useReaderPersistence.ts`
- Create: `src/reader/hooks/useReaderDecorations.ts`
- Create: `src/reader/hooks/useReaderNavigation.ts`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add a failing test that keeps App thin**

Append to `src/app/App.test.tsx`:

```tsx
it('renders the ReaderApp through the thin App entry', () => {
  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={createEmptyPersistence()}
      viewerRenderer={testViewerRenderer}
    />,
  );

  expect(screen.getByLabelText('SmartReader workbench')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run App tests and confirm missing workbench label**

Run:

```bash
bun run test -- src/app/App.test.tsx
```

Expected: FAIL because `ReaderApp` and the workbench label do not exist.

- [ ] **Step 3: Create app types**

Create `src/app/appTypes.ts`:

```ts
import type { PersistenceApi } from '../persistence/persistenceApi';
import type { TauriBridge } from '../platform/tauriBridge';
import type { PdfRenderer } from '../viewer/PdfViewerBridge';
import type { ViewerActions } from '../viewer/viewerController';

export type AppWorkspace = 'home' | 'reader' | 'settings' | 'tags';

export type ReaderAppProps = {
  bridge?: TauriBridge;
  persistence?: PersistenceApi;
  viewerController?: ViewerActions;
  viewerRenderer?: PdfRenderer;
};
```

- [ ] **Step 4: Move existing App implementation into ReaderApp**

Create `src/app/ReaderApp.tsx` by moving the existing implementation from `src/app/App.tsx` into `ReaderApp`. Rename the exported function to:

```tsx
export function ReaderApp({
  bridge: providedBridge,
  persistence: providedPersistence,
  viewerController,
  viewerRenderer,
}: ReaderAppProps) {
```

Wrap the returned root element with:

```tsx
<main className="app-shell" aria-label="SmartReader workbench">
```

- [ ] **Step 5: Make App a thin entry point**

Replace `src/app/App.tsx` with:

```tsx
import { ReaderApp } from './ReaderApp';
import type { ReaderAppProps } from './appTypes';

export function App(props: ReaderAppProps) {
  return <ReaderApp {...props} />;
}
```

- [ ] **Step 6: Extract hooks one at a time**

Move behavior without changing UI output:

- Move open PDF, browser picker, drag-drop, Open With, Blob URL, and byte cache orchestration into `useDocumentOpening.ts`.
- Move startup recent/session restore into `useSessionRestore.ts`.
- Move command registry and keyboard listener setup into `useReaderCommands.ts`.
- Move typed persistence convenience methods into `useReaderPersistence.ts`.
- Move bookmark, annotation, favorite, and tag loading into `useReaderDecorations.ts`.
- Move tab selection, close tab, page jump, history, zoom wheel, and active viewer source synchronization into `useReaderNavigation.ts`.

Each hook must expose explicit return values. Do not add a broad global context in this task.

- [ ] **Step 7: Verify App stays thin**

Run:

```bash
wc -l src/app/App.tsx
bun run typecheck
bun run test -- src/app/App.test.tsx
```

Expected:

- `src/app/App.tsx` is under 30 lines.
- Typecheck exits 0.
- App tests exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/App.tsx src/app/ReaderApp.tsx src/app/appTypes.ts src/reader/hooks src/app/App.test.tsx
git commit -m "refactor(app): split reader orchestration into hooks"
```

## Task 5: Build Prototype-Aligned Home And Reader Shell

**Files:**

- Create: `src/home/HomeDashboard.tsx`
- Create: `src/home/HomeQuickStart.tsx`
- Create: `src/home/HomeRecentSessions.tsx`
- Create: `src/home/HomeFavorites.tsx`
- Create: `src/home/HomeStatusPanel.tsx`
- Create: `src/reader/ReaderWorkspace.tsx`
- Create: `src/reader/ReaderToolbar.tsx`
- Create: `src/reader/ReaderTabs.tsx`
- Create: `src/reader/ReaderLeftPanel.tsx`
- Create: `src/reader/ReaderRightPanel.tsx`
- Create: `src/reader/ReaderStatusBar.tsx`
- Create: `src/reader/ReaderEmptyState.tsx`
- Create: `src/reader/ReaderErrorState.tsx`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/styles.css`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add workbench UI tests**

Add tests to `src/app/App.test.tsx`:

```tsx
it('shows the home dashboard with primary open actions', async () => {
  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={createEmptyPersistence()}
      viewerRenderer={testViewerRenderer}
    />,
  );

  expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '打开本地 PDF' })).toBeInTheDocument();
  expect(screen.getByText('拖拽到这里')).toBeInTheDocument();
  expect(screen.getByText('AI 助手')).toHaveAttribute('aria-disabled', 'true');
});

it('switches to the reader workspace after opening a PDF', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:reader');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  renderApp(
    <App
      bridge={{
        openNativePdf: vi.fn().mockResolvedValue({
          source: { kind: 'desktop-path', path: '/tmp/book.pdf', name: 'book.pdf' },
          bytes: new Uint8Array([37, 80, 68, 70, 45]),
          fileSize: 5,
          modifiedAt: '2026-06-18T00:00:00Z',
        }),
        readDesktopPdf: vi.fn(),
      }}
      persistence={createEmptyPersistence()}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '打开本地 PDF' }));

  expect(await screen.findByLabelText('阅读工作区')).toBeInTheDocument();
  expect(await screen.findByRole('tab', { name: 'book.pdf' })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run App tests and confirm new UI fails**

Run:

```bash
bun run test -- src/app/App.test.tsx
```

Expected: FAIL because the home dashboard and reader workspace components do not exist.

- [ ] **Step 3: Implement home components**

Create focused home components:

- `HomeDashboard` owns the dashboard layout and receives recent documents, favorites, and action callbacks.
- `HomeQuickStart` renders `打开本地 PDF`, `拖拽到这里`, and disabled `选择文件夹`.
- `HomeRecentSessions` renders recoverable session rows.
- `HomeFavorites` renders favorite document cards.
- `HomeStatusPanel` renders quick tips, desktop integration status, cache status, and version info.

Visible future entries must render with `aria-disabled="true"` and disabled styling.

- [ ] **Step 4: Implement reader shell components**

Create focused reader components:

- `ReaderWorkspace` owns the page grid.
- `ReaderToolbar` renders open, search, page, previous/next, history, zoom, fit, bookmark, annotation, recent, and more controls.
- `ReaderTabs` renders document tabs.
- `ReaderLeftPanel` switches between recent, bookmarks, annotations, thumbnails, and search.
- `ReaderRightPanel` switches between document info, search controls, annotation detail, and disabled local file actions.
- `ReaderStatusBar` renders local file state, saved progress, page, zoom, and shortcut hint.
- `ReaderEmptyState` renders the reader empty state.
- `ReaderErrorState` renders recoverable PDF and file errors.

- [ ] **Step 5: Add prototype-aligned CSS tokens and layout**

Update `src/app/styles.css` with neutral tokens:

```css
:root {
  --sr-bg: #f5f6f8;
  --sr-surface: #ffffff;
  --sr-surface-muted: #f8fafc;
  --sr-border: rgba(15, 23, 42, 0.1);
  --sr-text: #111827;
  --sr-text-muted: #64748b;
  --sr-primary: #2563eb;
  --sr-danger: #dc2626;
  --sr-warning: #f59e0b;
  --sr-radius: 8px;
}
```

Replace the current beige-heavy shell styles with white, light gray, and blue-accent workbench styles. Keep cards at `8px` radius or less.

- [ ] **Step 6: Verify UI tests and build**

Run:

```bash
bun run typecheck
bun run test -- src/app/App.test.tsx
bun run build
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/home src/reader src/app/ReaderApp.tsx src/app/styles.css src/app/App.test.tsx
git commit -m "feat(ui): add SmartReader workbench shell"
```

## Task 6: Wire Search, Annotations, Notes, Favorites, And Tags

**Files:**

- Create: `src/reader/search/SearchPanel.tsx`
- Create: `src/reader/search/SearchResultsList.tsx`
- Create: `src/reader/search/SearchInspector.tsx`
- Create: `src/reader/annotations/AnnotationPanel.tsx`
- Create: `src/reader/annotations/AnnotationList.tsx`
- Create: `src/reader/annotations/AnnotationDetail.tsx`
- Create: `src/reader/annotations/AnnotationToolbar.tsx`
- Create: `src/tags/TagPicker.tsx`
- Modify: `src/annotations/annotationModels.ts`
- Modify: `src/annotations/annotationStore.ts`
- Modify: `src/reader/hooks/useReaderDecorations.ts`
- Modify: `src/reader/ReaderLeftPanel.tsx`
- Modify: `src/reader/ReaderRightPanel.tsx`
- Modify: `src/reader/ReaderToolbar.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add tests for annotation notes and tags**

Append an App test:

```tsx
it('adds a page note and lets the user tag the annotation', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:note');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

  const persistence = {
    ...createEmptyPersistence(),
    saveAnnotation: vi.fn().mockImplementation(async (annotation) => ({ ...annotation, id: 3 })),
    listAnnotations: vi.fn().mockResolvedValue([]),
    listBookmarks: vi.fn().mockResolvedValue([]),
    listTags: vi.fn().mockResolvedValue([
      {
        id: 1,
        name: '重点',
        color: '#facc15',
        documentCount: 0,
        annotationCount: 0,
        createdAt: '2026-06-18T00:00:00Z',
        updatedAt: '2026-06-18T00:00:00Z',
      },
    ]),
    attachAnnotationTag: vi.fn().mockResolvedValue(undefined),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.change(screen.getByLabelText('选择 PDF 文件'), {
    target: { files: [new File(['%PDF-1.7'], 'book.pdf', { type: 'application/pdf' })] },
  });

  await screen.findByRole('tab', { name: 'book.pdf' });
  fireEvent.click(screen.getByRole('button', { name: '新建批注' }));

  expect(await screen.findByText('页面笔记')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '添加标签 重点' }));

  expect(persistence.attachAnnotationTag).toHaveBeenCalledWith(3, 1);
});
```

- [ ] **Step 2: Run the focused test and confirm missing UI**

Run:

```bash
bun run test -- src/app/App.test.tsx -t "adds a page note"
```

Expected: FAIL because the annotation detail and tag picker are not implemented yet.

- [ ] **Step 3: Extend annotation model**

In `src/annotations/annotationModels.ts`, ensure annotation type supports:

```ts
export type AnnotationKind = 'highlight' | 'underline' | 'note';
```

Use `text` for editable note content and `quote` for selected source text.

- [ ] **Step 4: Implement search panels**

Create:

- `SearchPanel` with search field, count, sort control, and result list.
- `SearchResultsList` with result cards showing page and match count.
- `SearchInspector` with current match, previous, next, jump page, fit controls, case-sensitive toggle, whole-word toggle, and clear search.

The search controls must call existing viewer controller methods and update local search state.

- [ ] **Step 5: Implement annotation panels**

Create:

- `AnnotationPanel` with bookmarks tab and annotations tab.
- `AnnotationList` with page, type, quote/note preview, and color indicator.
- `AnnotationDetail` with type, location, quote, editable note text, color, tags, metadata, delete, copy text, and jump.
- `AnnotationToolbar` with add bookmark, add page note, filter, import JSON, and export JSON.

- [ ] **Step 6: Implement `TagPicker`**

Create `src/tags/TagPicker.tsx`:

```tsx
import type { Tag } from './tagModels';

type TagPickerProps = {
  label: string;
  tags: Tag[];
  selectedTagIds: number[];
  onToggle(tag: Tag): void;
};

export function TagPicker({ label, tags, selectedTagIds, onToggle }: TagPickerProps) {
  return (
    <section className="tag-picker" aria-label={label}>
      {tags.map((tag) => (
        <button
          key={tag.id}
          type="button"
          className={selectedTagIds.includes(tag.id) ? 'tag-chip selected' : 'tag-chip'}
          onClick={() => onToggle(tag)}
          aria-label={`添加标签 ${tag.name}`}
        >
          <span style={{ background: tag.color }} />
          {tag.name}
        </button>
      ))}
    </section>
  );
}
```

- [ ] **Step 7: Wire favorites**

Add favorite toggle buttons in:

- `HomeFavorites`.
- `ReaderToolbar`.
- `ReaderRightPanel` document info state.

Use `PersistenceApi.setDocumentFavorite(documentKey, favorite)` and update local state immediately after successful persistence.

- [ ] **Step 8: Verify focused features**

Run:

```bash
bun run typecheck
bun run test -- src/app/App.test.tsx
bun run test -- src/annotations/annotationStore.test.ts
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/reader/search src/reader/annotations src/tags/TagPicker.tsx src/annotations src/reader/hooks/useReaderDecorations.ts src/reader/ReaderLeftPanel.tsx src/reader/ReaderRightPanel.tsx src/reader/ReaderToolbar.tsx src/app/App.test.tsx
git commit -m "feat(reader): wire search annotations tags and favorites"
```

## Task 7: Build Settings And Tag Manager Workspaces

**Files:**

- Create: `src/settings/SettingsWorkspace.tsx`
- Create: `src/settings/ShortcutSettings.tsx`
- Create: `src/settings/CacheSettings.tsx`
- Create: `src/settings/DesktopIntegrationSettings.tsx`
- Create: `src/settings/SessionRestoreSettings.tsx`
- Create: `src/tags/TagManager.tsx`
- Create: `src/tags/TagList.tsx`
- Create: `src/tags/TagEditor.tsx`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add settings and tag manager tests**

Append to `src/app/App.test.tsx`:

```tsx
it('opens settings and saves preferences', async () => {
  const persistence = createEmptyPersistence();

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '设置' }));
  expect(screen.getByRole('heading', { name: '快捷键' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '保存设置' }));
  await waitFor(() => expect(persistence.savePreferences).toHaveBeenCalled());
});

it('opens tag manager and creates a tag', async () => {
  const persistence = {
    ...createEmptyPersistence(),
    listTags: vi.fn().mockResolvedValue([]),
    createTag: vi.fn().mockResolvedValue({
      id: 1,
      name: '论文',
      color: '#2563eb',
      documentCount: 0,
      annotationCount: 0,
      createdAt: '2026-06-18T00:00:00Z',
      updatedAt: '2026-06-18T00:00:00Z',
    }),
  };

  renderApp(
    <App
      bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
      persistence={persistence}
      viewerRenderer={testViewerRenderer}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: '标签管理' }));
  fireEvent.change(screen.getByLabelText('标签名称'), { target: { value: '论文' } });
  fireEvent.click(screen.getByRole('button', { name: '创建标签' }));

  await waitFor(() =>
    expect(persistence.createTag).toHaveBeenCalledWith({ name: '论文', color: '#2563eb' }),
  );
});
```

- [ ] **Step 2: Run focused tests and confirm missing workspaces**

Run:

```bash
bun run test -- src/app/App.test.tsx -t "opens settings|opens tag manager"
```

Expected: FAIL because settings and tag manager workspaces do not exist yet.

- [ ] **Step 3: Implement settings workspace**

Create:

- `SettingsWorkspace` with left nav, save, cancel, restore defaults, and close.
- `ShortcutSettings` with shortcut list, conflict warnings, and disabled edit affordances when editing is not active.
- `CacheSettings` with memory Blob URL cache and disk cache status.
- `DesktopIntegrationSettings` with Open With and file association status, plus disabled unsupported controls.
- `SessionRestoreSettings` with restore toggle and scope segmented control.

Use explicit save. Do not persist every toggle instantly.

- [ ] **Step 4: Implement tag manager workspace**

Create:

- `TagManager` with list, editor, merge action, delete action, and relation counts.
- `TagList` with search and active tag selection.
- `TagEditor` with name, color, counts, rename, merge, delete, and confirmation prompts.

Use `window.confirm` for destructive tag delete and merge in this iteration.

- [ ] **Step 5: Wire workspace navigation**

In `ReaderApp`, route:

- Home `设置` to `settings`.
- Home `标签管理` to `tags`.
- Settings close back to previous workspace or `home`.
- Tag manager close back to previous workspace or `home`.

- [ ] **Step 6: Verify settings and tags**

Run:

```bash
bun run typecheck
bun run test -- src/app/App.test.tsx
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/settings src/tags/TagManager.tsx src/tags/TagList.tsx src/tags/TagEditor.tsx src/app/ReaderApp.tsx src/app/App.test.tsx src/app/styles.css
git commit -m "feat(workbench): add settings and tag manager"
```

## Task 8: Final Validation And Documentation Alignment

**Files:**

- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-06-18-smartreader-mvp-workbench-stabilization-design.md`
- Modify: `docs/superpowers/plans/2026-06-18-smartreader-mvp-workbench-stabilization.md`

- [ ] **Step 1: Run full automated validation**

Run:

```bash
bun run typecheck
bun run test
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected:

- TypeScript exits 0.
- Vitest exits 0.
- Build exits 0, allowing the existing PDF.js direct `eval` warning.
- Rust formatting check exits 0.
- Rust tests exit 0.

- [ ] **Step 2: Update README to match shipped behavior**

Edit `README.md` so its current-status bullets match the implemented behavior:

- PDF open/render works through browser picker, drag-drop, desktop dialog, recent files, and Open With.
- Infinite PDF loading is replaced by recoverable error states.
- Favorites and tags are implemented for documents.
- Tags are implemented for annotations and notes.
- AI assistant, compare reading, folder library management, full-text knowledge base, export, print, and local file mutation remain future-version disabled entry points.

Keep the existing README style and do not rewrite unrelated sections.

- [ ] **Step 3: Add manual test evidence section to the plan**

Append a short execution note to this plan after manual testing:

```markdown
## Manual Test Evidence

- Desktop Open PDF:
- Browser Choose:
- Drag and drop:
- Search:
- Zoom and fit:
- Bookmarks:
- Annotations and notes:
- Tags:
- Favorites:
- Settings persistence:
- Restart/session restore:
```

Fill each line with `pass`, `fail`, or `not run`, plus a brief reason for failures.

- [ ] **Step 4: Run final diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected:

- `git diff --check` exits 0.
- `git status --short` shows only files intentionally modified by this implementation.

- [ ] **Step 5: Commit documentation alignment**

```bash
git add README.md docs/superpowers/specs/2026-06-18-smartreader-mvp-workbench-stabilization-design.md docs/superpowers/plans/2026-06-18-smartreader-mvp-workbench-stabilization.md
git commit -m "docs: align SmartReader workbench status"
```

## Completion Checklist

Before final response after implementation:

- `App.tsx` is under 30 lines.
- `src/viewer/PdfViewerBridge.tsx` is the only frontend file importing `@react-pdf-viewer/*`.
- Browser `Choose` and desktop `Open PDF` no longer leave every PDF loading forever.
- Viewer load failure and timeout are visible UI states.
- Tauri capabilities exist and include dialog open and event listen.
- Database can be opened twice without duplicate migration failures.
- Preferences commands are registered in Rust.
- Favorites persist through `documents.favorite`.
- Tags persist and attach to documents and annotations.
- Home, reader, search, annotation, settings, and tag manager workspaces render.
- Disabled future features are visibly disabled and do not pretend to work.
- Full automated validation commands have been run and results recorded.
