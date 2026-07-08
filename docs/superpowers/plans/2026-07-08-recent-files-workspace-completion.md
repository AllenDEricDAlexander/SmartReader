# Recent Files Workspace Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete SmartReader's `最近文件` workspace with a real high-density list, existing-tag binding, batch tag actions, real recent-history removal, and a derived right-side activity/statistics rail.

**Architecture:** Extend the existing `documents` persistence model instead of adding a new recent-history table. `PersistenceApi` remains the frontend facade, `ReaderApp` remains the data coordinator, and `HomeRecentFilesWorkspace` owns only UI state plus pure derived list state. One new migration adds a recent-hidden marker so records can leave the recent list without deleting document, bookmark, annotation, favorite, or tag data.

**Tech Stack:** Tauri 2 commands, Rust, rusqlite, React 18, TypeScript, Vitest, React Testing Library, lucide-react, existing SmartReader CSS in `src/app/styles.css`.

---

## Scope Source

Implement the approved spec:

- `docs/superpowers/specs/2026-07-08-recent-files-workspace-completion-design.md`

Do not open a browser. Do not use computer-control tools. Do not start the app automatically.

## File Structure

- Create `src-tauri/src/migrations/005_recent_file_management.sql`
  - Adds `documents.recent_hidden_at` and recent-query indexes.
- Modify `src-tauri/src/db.rs`
  - Registers migration 005.
  - Extends `PersistedDocument` with `last_opened_at` and `tag_ids`.
  - Filters hidden recent documents.
  - Adds `remove_recent_document` and `clear_recent_documents` commands and transaction helpers.
  - Adds Rust tests for recent visibility and tag IDs.
- Modify `src-tauri/src/lib.rs`
  - Registers the new Tauri commands.
- Modify `src/persistence/persistenceApi.ts`
  - Extends `PersistedDocument`.
  - Adds `removeRecentDocument` and `clearRecentDocuments`.
- Modify `src/persistence/persistenceApi.test.ts`
  - Verifies new commands and document shape.
- Modify `src/app/readerAppMappers.ts`
  - Preserves existing `lastOpenedAt` and `tagIds` when mapping sessions to persisted documents.
- Modify `src/app/readerAppMappers.test.ts`
  - Covers the new persisted fields.
- Create `src/home/recentWorkspaceUtils.ts`
  - Pure helpers for search, sorting, filters, tag options, selection stats, and right-rail derivations.
- Create `src/home/recentWorkspaceUtils.test.ts`
  - Focused tests for derived behavior.
- Modify `src/home/HomeRecentFilesWorkspace.tsx`
  - Reworks the UI into a table-like list, tag editor, batch actions, clear-history confirmation, and derived right rail.
- Modify `src/home/HomeRecentFilesWorkspace.test.tsx`
  - Updates fixtures and tests all new interactions.
- Modify `src/home/HomeDashboard.tsx`
  - Passes tags and recent management callbacks into `HomeRecentFilesWorkspace`.
- Modify `src/home/HomeDashboard.test.tsx`
  - Verifies recent page tag wiring and clear/remove callbacks.
- Modify `src/app/ReaderWorkspaceSwitch.tsx`
  - Threads new props from `ReaderApp` to `HomeDashboard`.
- Modify `src/app/ReaderWorkspaceSwitch.test.tsx`
  - Verifies recent files receives tags in the home shell.
- Modify `src/app/ReaderApp.tsx`
  - Adds stable handlers for refreshing recents, document tag toggle, recent removal, and clear history.
- Modify `src/app/App.test.tsx`
  - Covers an end-to-end recent-file tag binding and recent removal path.
- Modify `src/app/styles.css`
  - Adds compact table, tag chips, picker popover, batch toolbar, and right rail styles.

## Task 1: Backend Recent Persistence

**Files:**
- Create: `src-tauri/src/migrations/005_recent_file_management.sql`
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add failing Rust tests for hidden recents, reopen behavior, and tag IDs**

Add these tests inside `#[cfg(test)] mod tests` in `src-tauri/src/db.rs`, near `upserts_and_lists_documents`:

```rust
    fn test_document(key: &str, name: &str) -> PersistedDocument {
        PersistedDocument {
            document_key: key.to_string(),
            path: Some(format!("/tmp/{name}")),
            display_name: name.to_string(),
            file_size: Some(100),
            modified_at: Some("2026-07-08T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 4,
            progress: 0.2,
            missing: false,
            last_opened_at: None,
            tag_ids: Vec::new(),
        }
    }

    #[test]
    fn lists_recent_documents_with_last_opened_at_and_tag_ids() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let document = test_document("desktop:/tmp/tagged.pdf", "tagged.pdf");
        upsert_document(&connection, &document).expect("upsert document");
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "AI".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("create tag");
        attach_document_tag_tx(&connection, "desktop:/tmp/tagged.pdf", tag.id)
            .expect("attach document tag");

        let documents = list_documents(&connection).expect("list documents");

        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].document_key, "desktop:/tmp/tagged.pdf");
        assert!(documents[0].last_opened_at.is_some());
        assert_eq!(documents[0].tag_ids, vec![tag.id]);
    }

    #[test]
    fn hides_single_recent_document_without_deleting_related_data() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        upsert_document(
            &connection,
            &test_document("desktop:/tmp/hidden.pdf", "hidden.pdf"),
        )
        .expect("upsert document");
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "Research".to_string(),
                color: "#10b981".to_string(),
            },
        )
        .expect("create tag");
        attach_document_tag_tx(&connection, "desktop:/tmp/hidden.pdf", tag.id)
            .expect("attach document tag");

        remove_recent_document_tx(&connection, "desktop:/tmp/hidden.pdf")
            .expect("hide recent document");

        assert!(list_documents(&connection).expect("list").is_empty());
        assert_eq!(
            list_document_tag_ids_tx(&connection, "desktop:/tmp/hidden.pdf")
                .expect("tag ids"),
            vec![tag.id],
        );
    }

    #[test]
    fn clear_recent_documents_hides_all_visible_recents_and_reopen_restores_one() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let first = test_document("desktop:/tmp/first.pdf", "first.pdf");
        let second = test_document("desktop:/tmp/second.pdf", "second.pdf");
        upsert_document(&connection, &first).expect("upsert first");
        upsert_document(&connection, &second).expect("upsert second");

        clear_recent_documents_tx(&connection).expect("clear recents");

        assert!(list_documents(&connection).expect("list hidden").is_empty());

        upsert_document(&connection, &first).expect("reopen first");
        let documents = list_documents(&connection).expect("list restored");

        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].document_key, "desktop:/tmp/first.pdf");
    }
```

- [ ] **Step 2: Run backend tests and verify they fail**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml recent -- --nocapture
```

Expected: FAIL with missing `last_opened_at`, `tag_ids`, `remove_recent_document_tx`, or `clear_recent_documents_tx`.

- [ ] **Step 3: Add migration 005**

Create `src-tauri/src/migrations/005_recent_file_management.sql`:

```sql
ALTER TABLE documents ADD COLUMN recent_hidden_at TEXT;

CREATE INDEX IF NOT EXISTS idx_documents_recent_hidden_at
ON documents(recent_hidden_at);

CREATE INDEX IF NOT EXISTS idx_documents_last_opened_at
ON documents(last_opened_at);
```

- [ ] **Step 4: Register migration 005**

In `src-tauri/src/db.rs`, extend `MIGRATIONS` after `004_tag_activity_log`:

```rust
    Migration {
        version: "005_recent_file_management",
        sql: include_str!("migrations/005_recent_file_management.sql"),
    },
```

- [ ] **Step 5: Extend the Rust persisted document model**

Replace `PersistedDocument` in `src-tauri/src/db.rs` with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedDocument {
    pub document_key: String,
    pub path: Option<String>,
    pub display_name: String,
    pub file_size: Option<i64>,
    pub modified_at: Option<String>,
    pub page_count: Option<i64>,
    pub last_page: i64,
    pub progress: f64,
    pub missing: bool,
    pub last_opened_at: Option<String>,
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}
```

- [ ] **Step 6: Update document upsert and listing**

In `upsert_document`, add `recent_hidden_at = NULL` to the update list:

```rust
            progress = excluded.progress,
            missing = excluded.missing,
            recent_hidden_at = NULL
```

In `list_documents`, replace the query and row mapper with:

```rust
    let mut statement = connection.prepare(
        r#"
        SELECT document_key, path, display_name, file_size, modified_at, page_count,
               last_page, progress, missing, last_opened_at
        FROM documents
        WHERE recent_hidden_at IS NULL
        ORDER BY last_opened_at DESC
        "#,
    )?;

    let rows = statement.query_map([], |row| {
        let document_key: String = row.get(0)?;
        let tag_ids = list_document_tag_ids_tx(connection, &document_key)?;

        Ok(PersistedDocument {
            document_key,
            path: row.get(1)?,
            display_name: row.get(2)?,
            file_size: row.get(3)?,
            modified_at: row.get(4)?,
            page_count: row.get(5)?,
            last_page: row.get(6)?,
            progress: row.get(7)?,
            missing: row.get::<_, i64>(8)? == 1,
            last_opened_at: row.get(9)?,
            tag_ids,
        })
    })?;
```

- [ ] **Step 7: Add recent removal helpers and commands**

Add these functions after `list_recent_documents` command in `src-tauri/src/db.rs`:

```rust
#[tauri::command]
pub fn remove_recent_document(
    state: State<'_, DatabaseState>,
    document_key: String,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    remove_recent_document_tx(&connection, &document_key)
}

#[tauri::command]
pub fn clear_recent_documents(state: State<'_, DatabaseState>) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    clear_recent_documents_tx(&connection)
}
```

Add these transaction helpers after `list_documents`:

```rust
pub fn remove_recent_document_tx(
    connection: &Connection,
    document_key: &str,
) -> Result<(), DbError> {
    connection.execute(
        "UPDATE documents SET recent_hidden_at = ?1 WHERE document_key = ?2",
        params![now_rfc3339(), document_key],
    )?;

    Ok(())
}

pub fn clear_recent_documents_tx(connection: &Connection) -> Result<(), DbError> {
    connection.execute(
        "UPDATE documents SET recent_hidden_at = ?1 WHERE recent_hidden_at IS NULL",
        [now_rfc3339()],
    )?;

    Ok(())
}
```

- [ ] **Step 8: Register Tauri commands**

In `src-tauri/src/lib.rs`, add after `db::list_recent_documents`:

```rust
            db::remove_recent_document,
            db::clear_recent_documents,
```

- [ ] **Step 9: Update existing Rust `PersistedDocument` literals**

For every `PersistedDocument` object literal in `src-tauri/src/db.rs` tests, add these fields before the closing brace:

```rust
            last_opened_at: None,
            tag_ids: Vec::new(),
```

For cloned expected values returned from `list_documents`, update expectations to compare selected fields or include the generated `last_opened_at`. In `upserts_and_lists_documents`, replace the final assertion with:

```rust
        assert_eq!(documents.len(), 1);
        assert_eq!(documents[0].document_key, document.document_key);
        assert_eq!(documents[0].display_name, document.display_name);
        assert!(documents[0].last_opened_at.is_some());
        assert!(documents[0].tag_ids.is_empty());
```

- [ ] **Step 10: Run backend tests**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 11: Commit backend persistence changes**

Run:

```bash
git add src-tauri/src/migrations/005_recent_file_management.sql src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: persist recent file visibility"
```

## Task 2: Frontend Persistence Types And Mappers

**Files:**
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/persistence/persistenceApi.test.ts`
- Modify: `src/app/readerAppMappers.ts`
- Modify: `src/app/readerAppMappers.test.ts`
- Modify: tests with `PersistedDocument` fixtures found by typecheck.

- [ ] **Step 1: Add failing persistence API expectations**

In `src/persistence/persistenceApi.test.ts`, update the first `document` fixture:

```ts
    const document: PersistedDocument = {
      documentKey: 'desktop:/tmp/book.pdf',
      path: '/tmp/book.pdf',
      displayName: 'book.pdf',
      fileSize: 120,
      modifiedAt: '2026-06-15T00:00:00Z',
      pageCount: 20,
      lastPage: 3,
      progress: 0.15,
      missing: false,
      lastOpenedAt: '2026-07-08T09:00:00Z',
      tagIds: [2],
    };
```

In `persists favorites and tags through Tauri invoke`, add calls after `listRecentDocuments()` or before tag calls:

```ts
    await api.removeRecentDocument('desktop:/tmp/book.pdf');
    await api.clearRecentDocuments();
```

Add expectations:

```ts
    expect(invoke).toHaveBeenCalledWith('remove_recent_document', {
      documentKey: 'desktop:/tmp/book.pdf',
    });
    expect(invoke).toHaveBeenCalledWith('clear_recent_documents');
```

- [ ] **Step 2: Run API test and verify it fails**

Run:

```bash
bunx vitest run src/persistence/persistenceApi.test.ts
```

Expected: FAIL with `removeRecentDocument is not a function`.

- [ ] **Step 3: Extend `PersistedDocument` and API methods**

In `src/persistence/persistenceApi.ts`, replace `PersistedDocument` with:

```ts
export type PersistedDocument = {
  documentKey: string;
  path: string | null;
  displayName: string;
  fileSize: number | null;
  modifiedAt: string | null;
  pageCount: number | null;
  lastPage: number;
  progress: number;
  missing: boolean;
  lastOpenedAt: string | null;
  tagIds: number[];
};
```

In `CorePersistenceApi`, add:

```ts
  removeRecentDocument(documentKey: string): Promise<void>;
  clearRecentDocuments(): Promise<void>;
```

In `createPersistenceApi`, add after `listRecentDocuments()`:

```ts
    removeRecentDocument(documentKey) {
      return invoke<void>('remove_recent_document', { documentKey });
    },
    clearRecentDocuments() {
      return invoke<void>('clear_recent_documents');
    },
```

- [ ] **Step 4: Add failing mapper expectations**

In `src/app/readerAppMappers.test.ts`, update `previous` in `maps a session...`:

```ts
      lastOpenedAt: '2026-07-08T08:00:00.000Z',
      tagIds: [1, 2],
```

Add the same fields to the expected object:

```ts
      lastOpenedAt: '2026-07-08T08:00:00.000Z',
      tagIds: [1, 2],
```

Update `first` in `preserves existing document ordering...`:

```ts
      lastOpenedAt: '2026-07-08T08:00:00.000Z',
      tagIds: [],
```

- [ ] **Step 5: Run mapper test and verify it fails**

Run:

```bash
bunx vitest run src/app/readerAppMappers.test.ts
```

Expected: FAIL because `mapSessionToPersistedDocument` does not preserve `lastOpenedAt` or `tagIds`.

- [ ] **Step 6: Preserve new fields in mappers**

In `src/app/readerAppMappers.ts`, add fields to the returned object in `mapSessionToPersistedDocument`:

```ts
    lastOpenedAt: previousDocument?.lastOpenedAt ?? null,
    tagIds: previousDocument?.tagIds ?? [],
```

- [ ] **Step 7: Update TypeScript fixtures**

Run:

```bash
bun run typecheck
```

Expected: FAIL with `PersistedDocument` fixtures missing `lastOpenedAt` and `tagIds`.

For each failing `PersistedDocument` literal in these files, add:

```ts
    lastOpenedAt: '<same value as modifiedAt when this fixture represents an opened recent file>',
    tagIds: [],
```

Use `lastOpenedAt: null` only for browser upload fixtures or records whose recent-open time is intentionally unknown.

Known files from current tests:

- `src/home/HomeRecentFilesWorkspace.test.tsx`
- `src/home/HomeDashboard.test.tsx`
- `src/app/readerAppMappers.test.ts`
- `src/app/App.test.tsx`
- `src/app/ReaderWorkspaceView.test.tsx`

- [ ] **Step 8: Run focused frontend checks**

Run:

```bash
bunx vitest run src/persistence/persistenceApi.test.ts src/app/readerAppMappers.test.ts
bun run typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit frontend persistence changes**

Run:

```bash
git add src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src/app/readerAppMappers.ts src/app/readerAppMappers.test.ts src/home/HomeRecentFilesWorkspace.test.tsx src/home/HomeDashboard.test.tsx src/app/App.test.tsx src/app/ReaderWorkspaceView.test.tsx
git commit -m "feat: expose recent document tags"
```

## Task 3: Recent Workspace Pure Derivations

**Files:**
- Create: `src/home/recentWorkspaceUtils.ts`
- Create: `src/home/recentWorkspaceUtils.test.ts`

- [ ] **Step 1: Write failing utility tests**

Create `src/home/recentWorkspaceUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';
import {
  buildRecentActivityItems,
  buildRecentStats,
  buildRecentTagOptions,
  filterRecentDocuments,
  sortRecentDocuments,
} from './recentWorkspaceUtils';

const tags: Tag[] = [
  {
    id: 1,
    name: 'AI',
    color: '#2563eb',
    documentCount: 2,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 2,
    name: '医学',
    color: '#10b981',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
];

const documents: PersistedDocument[] = [
  {
    documentKey: 'desktop:/a.pdf',
    path: '/Users/mario/Papers/a.pdf',
    displayName: 'Alpha.pdf',
    fileSize: 100,
    modifiedAt: '2026-07-01T00:00:00Z',
    pageCount: 10,
    lastPage: 5,
    progress: 0.5,
    missing: false,
    lastOpenedAt: '2026-07-08T10:00:00Z',
    tagIds: [1],
  },
  {
    documentKey: 'desktop:/b.pdf',
    path: '/Users/mario/Papers/b.pdf',
    displayName: 'Beta.pdf',
    fileSize: 200,
    modifiedAt: '2026-07-02T00:00:00Z',
    pageCount: 20,
    lastPage: 20,
    progress: 1,
    missing: false,
    lastOpenedAt: '2026-07-08T09:00:00Z',
    tagIds: [1, 2],
  },
  {
    documentKey: 'desktop:/c.pdf',
    path: '/Users/mario/Inbox/c.pdf',
    displayName: 'Gamma.pdf',
    fileSize: 300,
    modifiedAt: null,
    pageCount: null,
    lastPage: 1,
    progress: 0,
    missing: false,
    lastOpenedAt: null,
    tagIds: [],
  },
];

describe('recentWorkspaceUtils', () => {
  it('filters by query, progress, tag, untagged, and favorite state', () => {
    const favoriteKeys = new Set(['desktop:/b.pdf']);

    expect(
      filterRecentDocuments(documents, {
        query: 'papers',
        progressFilter: 'all',
        tagFilter: 'all',
        favoriteFilter: 'all',
      }, favoriteKeys).map((document) => document.displayName),
    ).toEqual(['Alpha.pdf', 'Beta.pdf']);

    expect(
      filterRecentDocuments(documents, {
        query: '',
        progressFilter: 'completed',
        tagFilter: 'all',
        favoriteFilter: 'favorite',
      }, favoriteKeys).map((document) => document.displayName),
    ).toEqual(['Beta.pdf']);

    expect(
      filterRecentDocuments(documents, {
        query: '',
        progressFilter: 'all',
        tagFilter: 'untagged',
        favoriteFilter: 'all',
      }, favoriteKeys).map((document) => document.displayName),
    ).toEqual(['Gamma.pdf']);
  });

  it('sorts by real last opened time before falling back to names', () => {
    expect(sortRecentDocuments(documents, 'recent').map((document) => document.displayName)).toEqual([
      'Alpha.pdf',
      'Beta.pdf',
      'Gamma.pdf',
    ]);
    expect(sortRecentDocuments(documents, 'name').map((document) => document.displayName)).toEqual([
      'Alpha.pdf',
      'Beta.pdf',
      'Gamma.pdf',
    ]);
  });

  it('builds tag options and right rail summaries from real data', () => {
    expect(buildRecentTagOptions(documents, tags)).toEqual([
      { tag: tags[0], count: 2 },
      { tag: tags[1], count: 1 },
    ]);
    expect(buildRecentStats(documents, new Set(['desktop:/b.pdf']))).toEqual({
      recentCount: 3,
      favoriteCount: 1,
      taggedCount: 2,
      completedCount: 1,
    });
    expect(buildRecentActivityItems(documents, new Set(['desktop:/b.pdf']), tags)[0]).toEqual({
      id: 'opened:desktop:/a.pdf',
      title: 'Alpha.pdf',
      description: '最近打开',
      time: '2026-07-08T10:00:00Z',
      tone: 'blue',
    });
  });
});
```

- [ ] **Step 2: Run utility test and verify it fails**

Run:

```bash
bunx vitest run src/home/recentWorkspaceUtils.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement utility module**

Create `src/home/recentWorkspaceUtils.ts`:

```ts
import type { PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';

export type RecentSortMode = 'recent' | 'name' | 'progressDesc' | 'progressAsc';
export type RecentProgressFilter = 'all' | 'notStarted' | 'reading' | 'completed';
export type RecentFavoriteFilter = 'all' | 'favorite' | 'notFavorite';
export type RecentTagFilter = 'all' | 'untagged' | `${number}`;

export type RecentDocumentFilters = {
  query: string;
  progressFilter: RecentProgressFilter;
  tagFilter: RecentTagFilter;
  favoriteFilter: RecentFavoriteFilter;
};

export type RecentTagOption = {
  tag: Tag;
  count: number;
};

export type RecentStats = {
  recentCount: number;
  favoriteCount: number;
  taggedCount: number;
  completedCount: number;
};

export type RecentActivityItem = {
  id: string;
  title: string;
  description: string;
  time: string | null;
  tone: 'blue' | 'green' | 'slate';
};

export function filterRecentDocuments(
  documents: PersistedDocument[],
  filters: RecentDocumentFilters,
  favoriteKeys: Set<string>,
): PersistedDocument[] {
  const normalizedQuery = filters.query.trim().toLowerCase();

  return documents.filter((document) => {
    const matchesQuery =
      normalizedQuery.length === 0 ||
      document.displayName.toLowerCase().includes(normalizedQuery) ||
      (document.path ?? '').toLowerCase().includes(normalizedQuery) ||
      document.documentKey.toLowerCase().includes(normalizedQuery);

    if (!matchesQuery) {
      return false;
    }

    if (filters.progressFilter === 'notStarted' && document.progress > 0) {
      return false;
    }

    if (
      filters.progressFilter === 'reading' &&
      (document.progress <= 0 || document.progress >= 1)
    ) {
      return false;
    }

    if (filters.progressFilter === 'completed' && document.progress < 1) {
      return false;
    }

    if (filters.tagFilter === 'untagged' && document.tagIds.length > 0) {
      return false;
    }

    if (filters.tagFilter !== 'all' && filters.tagFilter !== 'untagged') {
      const tagId = Number(filters.tagFilter);
      if (!document.tagIds.includes(tagId)) {
        return false;
      }
    }

    const favorite = favoriteKeys.has(document.documentKey);
    if (filters.favoriteFilter === 'favorite' && !favorite) {
      return false;
    }

    if (filters.favoriteFilter === 'notFavorite' && favorite) {
      return false;
    }

    return true;
  });
}

export function sortRecentDocuments(
  documents: PersistedDocument[],
  sortMode: RecentSortMode,
): PersistedDocument[] {
  return [...documents].sort((first, second) => {
    if (sortMode === 'name') {
      return first.displayName.localeCompare(second.displayName, 'zh-Hans-CN');
    }

    if (sortMode === 'progressDesc') {
      return second.progress - first.progress || compareByName(first, second);
    }

    if (sortMode === 'progressAsc') {
      return first.progress - second.progress || compareByName(first, second);
    }

    return getOpenedTime(second) - getOpenedTime(first) || compareByName(first, second);
  });
}

export function buildRecentTagOptions(
  documents: PersistedDocument[],
  tags: Tag[],
): RecentTagOption[] {
  const counts = new Map<number, number>();

  for (const document of documents) {
    for (const tagId of document.tagIds) {
      counts.set(tagId, (counts.get(tagId) ?? 0) + 1);
    }
  }

  return tags
    .map((tag) => ({ tag, count: counts.get(tag.id) ?? 0 }))
    .filter((option) => option.count > 0)
    .sort(
      (first, second) =>
        second.count - first.count || first.tag.name.localeCompare(second.tag.name, 'zh-Hans-CN'),
    );
}

export function buildRecentStats(
  documents: PersistedDocument[],
  favoriteKeys: Set<string>,
): RecentStats {
  return {
    recentCount: documents.length,
    favoriteCount: documents.filter((document) => favoriteKeys.has(document.documentKey)).length,
    taggedCount: documents.filter((document) => document.tagIds.length > 0).length,
    completedCount: documents.filter((document) => document.progress >= 1).length,
  };
}

export function buildRecentActivityItems(
  documents: PersistedDocument[],
  favoriteKeys: Set<string>,
  tags: Tag[],
): RecentActivityItem[] {
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const openedItems = sortRecentDocuments(
    documents.filter((document) => document.lastOpenedAt),
    'recent',
  )
    .slice(0, 4)
    .map((document) => ({
      id: `opened:${document.documentKey}`,
      title: document.displayName,
      description: '最近打开',
      time: document.lastOpenedAt,
      tone: 'blue' as const,
    }));
  const taggedItems = documents
    .filter((document) => document.tagIds.some((tagId) => tagsById.has(tagId)))
    .slice(0, 2)
    .map((document) => ({
      id: `tagged:${document.documentKey}`,
      title: document.displayName,
      description: '已标记标签',
      time: document.lastOpenedAt,
      tone: 'green' as const,
    }));
  const favoriteItems = documents
    .filter((document) => favoriteKeys.has(document.documentKey))
    .slice(0, 2)
    .map((document) => ({
      id: `favorite:${document.documentKey}`,
      title: document.displayName,
      description: '已收藏',
      time: document.lastOpenedAt,
      tone: 'slate' as const,
    }));

  return [...openedItems, ...taggedItems, ...favoriteItems].slice(0, 6);
}

function compareByName(first: PersistedDocument, second: PersistedDocument) {
  return first.displayName.localeCompare(second.displayName, 'zh-Hans-CN');
}

function getOpenedTime(document: PersistedDocument) {
  if (!document.lastOpenedAt) {
    return Number.NEGATIVE_INFINITY;
  }

  const time = Date.parse(document.lastOpenedAt);
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}
```

- [ ] **Step 4: Run utility test**

Run:

```bash
bunx vitest run src/home/recentWorkspaceUtils.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit utility changes**

Run:

```bash
git add src/home/recentWorkspaceUtils.ts src/home/recentWorkspaceUtils.test.ts
git commit -m "feat: derive recent workspace state"
```

## Task 4: Recent Workspace UI And Interactions

**Files:**
- Modify: `src/home/HomeRecentFilesWorkspace.tsx`
- Modify: `src/home/HomeRecentFilesWorkspace.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Replace component props in tests and add required tag fixtures**

In `src/home/HomeRecentFilesWorkspace.test.tsx`, add:

```ts
import type { Tag } from '../tags/tagModels';
```

Add tag fixtures after `documents`:

```ts
const tags: Tag[] = [
  {
    id: 1,
    name: 'AI',
    color: '#8b5cf6',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
  {
    id: 2,
    name: '医学',
    color: '#10b981',
    documentCount: 1,
    annotationCount: 0,
    createdAt: '2026-07-01T00:00:00Z',
    updatedAt: '2026-07-01T00:00:00Z',
  },
];
```

Update the first two documents:

```ts
    lastOpenedAt: '2026-07-03T09:30:00+08:00',
    tagIds: [1],
```

```ts
    lastOpenedAt: '2026-07-05T11:00:00+08:00',
    tagIds: [1, 2],
```

Update untagged documents:

```ts
    lastOpenedAt: '2026-07-01T08:00:00+08:00',
    tagIds: [],
```

and:

```ts
    lastOpenedAt: null,
    tagIds: [],
```

Update `renderWorkspace` props:

```ts
    tags,
    onToggleDocumentTag: vi.fn(),
    onRemoveRecentDocuments: vi.fn(),
    onClearRecentDocuments: vi.fn(),
    onOpenTags: vi.fn(),
```

- [ ] **Step 2: Add failing tests for new interactions**

Add these tests to `HomeRecentFilesWorkspace.test.tsx`:

```ts
  it('renders table headers, tag chips, and the derived right rail', () => {
    renderWorkspace();

    expect(screen.getByRole('columnheader', { name: '文件名' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '本地路径' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '最近打开' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '标签' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'AI' })[0]).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '最近文件辅助信息' })).toBeInTheDocument();
    expect(screen.getByText('本地统计')).toBeInTheDocument();
  });

  it('filters by tag and untagged state', () => {
    renderWorkspace();

    fireEvent.change(screen.getByRole('combobox', { name: '标签筛选' }), {
      target: { value: '2' },
    });
    expect(listedNames()).toEqual(['Alpha Notes.pdf']);

    fireEvent.change(screen.getByRole('combobox', { name: '标签筛选' }), {
      target: { value: 'untagged' },
    });
    expect(listedNames()).toEqual(['Gamma Draft.pdf', 'Local Browser Upload.pdf']);
  });

  it('toggles a document tag from the inline tag picker', () => {
    const props = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '编辑标签 Beta Research.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '切换标签 医学' }));

    expect(props.onToggleDocumentTag).toHaveBeenCalledWith(documents[0], tags[1], true);
  });

  it('supports batch tag binding, batch tag removal, and batch remove recent', () => {
    const props = renderWorkspace();

    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Beta Research.pdf' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 Gamma Draft.pdf' }));
    fireEvent.change(screen.getByRole('combobox', { name: '批量选择标签' }), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '批量绑定标签' }));
    expect(props.onToggleDocumentTag).toHaveBeenCalledWith(documents[0], tags[1], true);
    expect(props.onToggleDocumentTag).toHaveBeenCalledWith(documents[2], tags[1], true);

    fireEvent.click(screen.getByRole('button', { name: '批量移除标签' }));
    expect(props.onToggleDocumentTag).toHaveBeenCalledWith(documents[0], tags[1], false);
    expect(props.onToggleDocumentTag).toHaveBeenCalledWith(documents[2], tags[1], false);

    fireEvent.click(screen.getByRole('button', { name: '批量移出最近' }));
    fireEvent.click(screen.getByRole('button', { name: '确认移出' }));
    expect(props.onRemoveRecentDocuments).toHaveBeenCalledWith([documents[0], documents[2]]);
  });

  it('clears recent history after confirmation', () => {
    const props = renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '清空历史记录' }));
    expect(screen.getByRole('dialog', { name: '清空历史记录' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));

    expect(props.onClearRecentDocuments).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 3: Run component test and verify it fails**

Run:

```bash
bunx vitest run src/home/HomeRecentFilesWorkspace.test.tsx
```

Expected: FAIL because props and UI controls are not implemented.

- [ ] **Step 4: Update workspace props and imports**

In `src/home/HomeRecentFilesWorkspace.tsx`, update imports:

```ts
import {
  CheckSquare,
  FileText,
  Grid2X2,
  List,
  MoreVertical,
  Search,
  Star,
  Tags,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import type { PersistedDocument } from '../persistence/persistenceApi';
import type { Tag } from '../tags/tagModels';
import {
  buildRecentActivityItems,
  buildRecentStats,
  buildRecentTagOptions,
  filterRecentDocuments,
  sortRecentDocuments,
  type RecentFavoriteFilter,
  type RecentProgressFilter,
  type RecentSortMode,
  type RecentTagFilter,
} from './recentWorkspaceUtils';
import { formatDateTime, formatProgressPercent, getDirectoryPath } from './homeDisplayUtils';
```

Replace local filter/sort type definitions with utility types. Update props:

```ts
type HomeRecentFilesWorkspaceProps = {
  documents: PersistedDocument[];
  favoriteDocumentKeys: Set<string>;
  tags: Tag[];
  onOpenPdf(): void | Promise<unknown>;
  onReopenDocument(document: PersistedDocument): void | Promise<void>;
  onToggleFavorite(documentKey: string, favorite: boolean): void | Promise<void>;
  onToggleDocumentTag(document: PersistedDocument, tag: Tag, selected: boolean): void | Promise<void>;
  onLocateFile(document: PersistedDocument): void;
  onRemoveRecentDocuments(documents: PersistedDocument[]): void | Promise<void>;
  onClearRecentDocuments(): void | Promise<void>;
  onOpenTags(): void;
};
```

- [ ] **Step 5: Implement workspace state and derived values**

Inside the component, add state:

```ts
  const [tagFilter, setTagFilter] = useState<RecentTagFilter>('all');
  const [selectedDocumentKeys, setSelectedDocumentKeys] = useState<Set<string>>(new Set());
  const [openTagEditorKey, setOpenTagEditorKey] = useState<string | null>(null);
  const [batchTagId, setBatchTagId] = useState('');
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [confirmBatchRemoveOpen, setConfirmBatchRemoveOpen] = useState(false);
```

Replace `visibleDocuments` derivation with:

```ts
  const tagOptions = useMemo(() => buildRecentTagOptions(documents, tags), [documents, tags]);
  const visibleDocuments = useMemo(() => {
    const filteredDocuments = filterRecentDocuments(
      documents,
      {
        query,
        progressFilter,
        tagFilter,
        favoriteFilter,
      },
      favoriteDocumentKeys,
    );

    return sortRecentDocuments(filteredDocuments, sortMode);
  }, [documents, favoriteDocumentKeys, favoriteFilter, progressFilter, query, sortMode, tagFilter]);
  const selectedDocuments = useMemo(
    () => visibleDocuments.filter((document) => selectedDocumentKeys.has(document.documentKey)),
    [selectedDocumentKeys, visibleDocuments],
  );
  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags]);
  const recentStats = useMemo(
    () => buildRecentStats(documents, favoriteDocumentKeys),
    [documents, favoriteDocumentKeys],
  );
  const activityItems = useMemo(
    () => buildRecentActivityItems(documents, favoriteDocumentKeys, tags),
    [documents, favoriteDocumentKeys, tags],
  );
```

Update `filtering`:

```ts
  const filtering =
    normalizedQuery !== '' ||
    progressFilter !== 'all' ||
    favoriteFilter !== 'all' ||
    tagFilter !== 'all';
```

Update `clearFilters`:

```ts
    setTagFilter('all');
```

- [ ] **Step 6: Implement tag and batch handlers**

Add handlers before `renderDocument`:

```ts
  const toggleSelectedDocument = (documentKey: string) => {
    setSelectedDocumentKeys((current) => {
      const next = new Set(current);
      if (next.has(documentKey)) {
        next.delete(documentKey);
      } else {
        next.add(documentKey);
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedDocumentKeys(new Set());

  const toggleAllVisibleDocuments = () => {
    setSelectedDocumentKeys((current) => {
      if (visibleDocuments.every((document) => current.has(document.documentKey))) {
        return new Set();
      }
      return new Set(visibleDocuments.map((document) => document.documentKey));
    });
  };

  const runBatchTagAction = (selected: boolean) => {
    const tag = tagsById.get(Number(batchTagId));
    if (!tag) {
      return;
    }

    for (const document of selectedDocuments) {
      void onToggleDocumentTag(document, tag, selected);
    }
  };

  const removeSelectedDocuments = () => {
    void onRemoveRecentDocuments(selectedDocuments);
    clearSelection();
    setConfirmBatchRemoveOpen(false);
  };
```

- [ ] **Step 7: Rework list markup to table-style layout**

Replace each `article` row with a table row inside a semantic table. Use this row body inside `visibleDocuments.map`:

```tsx
                <tr key={document.documentKey} data-testid="recent-workspace-document">
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`选择 ${document.displayName}`}
                      checked={selectedDocumentKeys.has(document.documentKey)}
                      onChange={() => toggleSelectedDocument(document.documentKey)}
                    />
                  </td>
                  <td>
                    <div className="recent-file-name">
                      <span className="pdf-file-icon" aria-hidden="true">
                        <FileText size={16} />
                      </span>
                      <strong data-testid="recent-workspace-document-name" title={document.displayName}>
                        {document.displayName}
                      </strong>
                    </div>
                  </td>
                  <td className="path-cell" title={document.path ?? '本地浏览器文件'}>
                    {getDirectoryPath(document.path)}
                  </td>
                  <td>{document.lastOpenedAt ? formatDateTime(document.lastOpenedAt) : '最近打开时间未知'}</td>
                  <td>
                    <span className="progress-cell">
                      <span>{progressPercent}%</span>
                      <span
                        className="recent-progress"
                        role="progressbar"
                        aria-label={`阅读进度 ${document.displayName}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={progressPercent}
                      >
                        <span style={{ width: `${progressPercent}%` }} />
                      </span>
                    </span>
                  </td>
                  <td>{document.pageCount ? `${document.lastPage} / ${document.pageCount}` : `第 ${document.lastPage} 页`}</td>
                  <td>
                    <div className="recent-tag-cell">
                      {document.tagIds.length > 0 ? (
                        document.tagIds.map((tagId) => {
                          const tag = tagsById.get(tagId);
                          return tag ? (
                            <button
                              type="button"
                              key={tag.id}
                              className="favorite-tag-chip"
                              style={{ borderColor: tag.color, color: tag.color }}
                              onClick={() => setTagFilter(`${tag.id}`)}
                            >
                              {tag.name}
                            </button>
                          ) : null;
                        })
                      ) : (
                        <span>暂无标签</span>
                      )}
                      <button
                        type="button"
                        className="text-link-button"
                        aria-label={`编辑标签 ${document.displayName}`}
                        onClick={() =>
                          setOpenTagEditorKey(openTagEditorKey === document.documentKey ? null : document.documentKey)
                        }
                      >
                        管理
                      </button>
                      {openTagEditorKey === document.documentKey ? (
                        <div className="recent-tag-picker" role="group" aria-label={`${document.displayName} 标签`}>
                          {tags.length > 0 ? (
                            tags.map((tag) => {
                              const selected = document.tagIds.includes(tag.id);
                              return (
                                <button
                                  type="button"
                                  key={tag.id}
                                  className={selected ? 'tag-chip selected' : 'tag-chip'}
                                  aria-label={`切换标签 ${tag.name}`}
                                  aria-pressed={selected}
                                  onClick={() => void onToggleDocumentTag(document, tag, !selected)}
                                >
                                  <span className="tag-dot" style={{ backgroundColor: tag.color }} aria-hidden="true" />
                                  {tag.name}
                                </button>
                              );
                            })
                          ) : (
                            <button type="button" className="text-link-button" onClick={onOpenTags}>
                              去标签管理
                            </button>
                          )}
                        </div>
                      ) : null}
                    </div>
                  </td>
                  <td className="recent-workspace-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      aria-label={`继续阅读 ${document.displayName}`}
                      onClick={() => void onReopenDocument(document)}
                    >
                      继续阅读
                    </button>
                    <button
                      type="button"
                      className={favorite ? 'icon-button active' : 'icon-button'}
                      aria-label={`${favorite ? '取消收藏' : '收藏'} ${document.displayName}`}
                      onClick={() => void onToggleFavorite(document.documentKey, !favorite)}
                    >
                      <Star size={16} fill={favorite ? 'currentColor' : 'none'} />
                    </button>
                    <div className="recent-workspace-menu-wrap">
                      <button
                        type="button"
                        ref={(element) => setTriggerRef(document.documentKey, element)}
                        className="icon-button"
                        aria-label={`更多操作 ${document.displayName}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={() => setOpenMenuKey(menuOpen ? null : document.documentKey)}
                      >
                        <MoreVertical size={16} />
                      </button>
                      {menuOpen ? (
                        <div
                          className="recent-file-menu"
                          role="menu"
                          onKeyDown={(event) => handleMenuKeyDown(event, document.documentKey)}
                        >
                          <button
                            type="button"
                            ref={(element) => setMenuItemRef(document.documentKey, 0, element)}
                            role="menuitem"
                            onClick={() => handleMenuAction(() => onReopenDocument(document))}
                          >
                            打开
                          </button>
                          <button
                            type="button"
                            ref={(element) => setMenuItemRef(document.documentKey, 1, element)}
                            role="menuitem"
                            onClick={() =>
                              handleMenuAction(() =>
                                onToggleFavorite(document.documentKey, !favorite),
                              )
                            }
                          >
                            {favorite ? '取消收藏' : '收藏'}
                          </button>
                          <button
                            type="button"
                            ref={(element) => setMenuItemRef(document.documentKey, 2, element)}
                            role="menuitem"
                            onClick={() => {
                              closeMenu();
                              setOpenTagEditorKey(document.documentKey);
                            }}
                          >
                            管理标签
                          </button>
                          <button
                            type="button"
                            ref={(element) => setMenuItemRef(document.documentKey, 3, element)}
                            role="menuitem"
                            onClick={() => handleMenuAction(() => onLocateFile(document))}
                          >
                            定位文件
                          </button>
                          <button
                            type="button"
                            ref={(element) => setMenuItemRef(document.documentKey, 4, element)}
                            role="menuitem"
                            onClick={() =>
                              handleMenuAction(() => onRemoveRecentDocuments([document]))
                            }
                          >
                            从最近记录移除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
```

- [ ] **Step 8: Add toolbar controls, batch bar, right rail, and dialogs**

Add tag filter select in the toolbar after progress filter:

```tsx
            <label>
              <span>标签筛选</span>
              <select
                value={tagFilter}
                aria-label="标签筛选"
                onChange={(event) => setTagFilter(event.target.value as RecentTagFilter)}
              >
                <option value="all">全部标签</option>
                <option value="untagged">未打标签</option>
                {tagOptions.map((option) => (
                  <option key={option.tag.id} value={`${option.tag.id}`}>
                    {option.tag.name}（{option.count}）
                  </option>
                ))}
              </select>
            </label>
```

Add batch bar below toolbar:

```tsx
          {selectedDocuments.length > 0 ? (
            <div className="recent-batch-bar" role="region" aria-label="批量操作">
              <span>已选择 {selectedDocuments.length} 个文件</span>
              <select
                value={batchTagId}
                aria-label="批量选择标签"
                onChange={(event) => setBatchTagId(event.target.value)}
              >
                <option value="">选择标签</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={`${tag.id}`}>
                    {tag.name}
                  </option>
                ))}
              </select>
              <button type="button" className="secondary-button" disabled={!batchTagId} onClick={() => runBatchTagAction(true)}>
                <Tags size={14} />
                批量绑定标签
              </button>
              <button type="button" className="secondary-button" disabled={!batchTagId} onClick={() => runBatchTagAction(false)}>
                <CheckSquare size={14} />
                批量移除标签
              </button>
              <button type="button" className="secondary-button danger" onClick={() => setConfirmBatchRemoveOpen(true)}>
                <Trash2 size={14} />
                批量移出最近
              </button>
              <button type="button" className="text-link-button" onClick={clearSelection}>
                取消选择
              </button>
            </div>
          ) : null}
```

Change the component return root from `section.home-panel.recent-workspace` to `div.recent-workspace-layout`. Move the existing section inside that div, then add the `aside.recent-workspace-aside` shown in the next code block after the closing section. Keep the existing section heading, toolbar, result table, card view, and empty states inside the section.

Add right rail content:

```tsx
        <section className="favorite-insight-card">
          <h3>最近活动</h3>
          {activityItems.length > 0 ? (
            <ol className="favorite-activity-list">
              {activityItems.map((item) => (
                <li key={item.id}>
                  <strong>{item.title}</strong>
                  <span>{item.description} · {item.time ? formatDateTime(item.time) : '时间未知'}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p>暂无最近活动。</p>
          )}
        </section>
        <section className="favorite-insight-card">
          <h3>快速操作</h3>
          <button type="button" className="secondary-button" onClick={() => void onOpenPdf()}>
            打开本地 PDF
          </button>
          <button type="button" className="secondary-button danger" onClick={() => setConfirmClearOpen(true)}>
            清空历史记录
          </button>
        </section>
        <section className="favorite-insight-card">
          <h3>本地统计</h3>
          <div className="favorite-overview-grid">
            <span><strong>{recentStats.recentCount}</strong>最近文件</span>
            <span><strong>{recentStats.favoriteCount}</strong>收藏文件</span>
            <span><strong>{recentStats.taggedCount}</strong>已打标签</span>
            <span><strong>{recentStats.completedCount}</strong>已读完</span>
          </div>
        </section>
```

Add confirmation dialogs:

```tsx
      {confirmClearOpen ? (
        <div className="tag-dialog-backdrop">
          <div className="tag-dialog" role="dialog" aria-modal="true" aria-label="清空历史记录">
            <header><h2>清空历史记录</h2></header>
            <p>只会清空最近文件列表记录，不会删除本地文件、书签、批注、收藏或标签。</p>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setConfirmClearOpen(false)}>取消</button>
              <button type="button" className="primary-button" onClick={() => { setConfirmClearOpen(false); void onClearRecentDocuments(); }}>确认清空</button>
            </footer>
          </div>
        </div>
      ) : null}
      {confirmBatchRemoveOpen ? (
        <div className="tag-dialog-backdrop">
          <div className="tag-dialog" role="dialog" aria-modal="true" aria-label="批量移出最近">
            <header><h2>批量移出最近</h2></header>
            <p>将 {selectedDocuments.length} 个文件移出最近列表，不会删除文件或阅读数据。</p>
            <footer>
              <button type="button" className="secondary-button" onClick={() => setConfirmBatchRemoveOpen(false)}>取消</button>
              <button type="button" className="primary-button" onClick={removeSelectedDocuments}>确认移出</button>
            </footer>
          </div>
        </div>
      ) : null}
```

- [ ] **Step 9: Add CSS for the new recent workspace**

In `src/app/styles.css`, replace the current `.recent-workspace-*` block with compact table and layout styles modeled on existing favorite workspace styles:

```css
.recent-workspace-layout {
  align-items: start;
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(0, 1fr) minmax(240px, 300px);
  width: 100%;
}

.recent-workspace-table-wrap {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  overflow: visible;
}

.recent-workspace-table {
  border-collapse: collapse;
  table-layout: fixed;
  width: 100%;
}

.recent-workspace-table th,
.recent-workspace-table td {
  border-bottom: 1px solid #e2e8f0;
  color: #475569;
  font-size: 12px;
  padding: 12px 10px;
  text-align: left;
  vertical-align: middle;
}

.recent-workspace-table th {
  background: #f8fafc;
  color: #64748b;
  font-weight: 700;
}

.recent-tag-cell {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  position: relative;
}

.recent-tag-picker {
  background: #ffffff;
  border: 1px solid #dbe4f0;
  border-radius: 10px;
  box-shadow: 0 16px 38px rgba(15, 23, 42, 0.16);
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  left: 0;
  min-width: 220px;
  padding: 10px;
  position: absolute;
  top: calc(100% + 8px);
  z-index: 40;
}

.recent-batch-bar {
  align-items: center;
  background: #f8fafc;
  border: 1px solid #dbe4f0;
  border-radius: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 10px 12px;
}

.recent-batch-bar > span {
  color: #334155;
  font-size: 13px;
  font-weight: 700;
}

.secondary-button.danger,
.text-link-button.danger {
  color: #dc2626;
}

.recent-workspace-aside {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

@media (max-width: 1180px) {
  .recent-workspace-layout {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 10: Run component test**

Run:

```bash
bunx vitest run src/home/recentWorkspaceUtils.test.ts src/home/HomeRecentFilesWorkspace.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit UI interaction changes**

Run:

```bash
git add src/home/HomeRecentFilesWorkspace.tsx src/home/HomeRecentFilesWorkspace.test.tsx src/app/styles.css
git commit -m "feat: complete recent files workspace"
```

## Task 5: App Wiring And Integration

**Files:**
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx`
- Modify: `src/app/ReaderWorkspaceSwitch.test.tsx`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Add failing integration tests**

In `src/home/HomeDashboard.test.tsx`, update `createDashboardProps` to include:

```ts
    availableTags: [
      {
        id: 1,
        name: 'AI',
        color: '#8b5cf6',
        documentCount: 1,
        annotationCount: 0,
        createdAt: '2026-07-01T00:00:00Z',
        updatedAt: '2026-07-01T00:00:00Z',
      },
    ],
    onToggleDocumentTag: vi.fn(),
    onRemoveRecentDocuments: vi.fn(),
    onClearRecentDocuments: vi.fn(),
```

Add a test:

```ts
  it('passes tags and recent management actions into the recent files workspace', () => {
    const onToggleDocumentTag = vi.fn();
    const onRemoveRecentDocuments = vi.fn();
    const onClearRecentDocuments = vi.fn();
    renderDashboard({
      activeSidebarPage: 'recentFiles',
      recentDocuments: [
        {
          ...recentTableDocuments[0],
          lastOpenedAt: '2026-07-08T10:00:00+08:00',
          tagIds: [1],
        },
      ],
      onToggleDocumentTag,
      onRemoveRecentDocuments,
      onClearRecentDocuments,
    });

    fireEvent.click(screen.getByRole('button', { name: '编辑标签 Design Notes.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '切换标签 AI' }));
    expect(onToggleDocumentTag).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: '清空历史记录' }));
    fireEvent.click(screen.getByRole('button', { name: '确认清空' }));
    expect(onClearRecentDocuments).toHaveBeenCalledTimes(1);
  });
```

In `src/app/ReaderWorkspaceSwitch.test.tsx`, add a recent-files test mirroring the favorite tag test:

```ts
  it('passes available tags to the recent files workspace', () => {
    renderSwitch({
      activeWorkspace: 'home',
      activeSidebarPage: 'recentFiles',
      recentDocuments: [
        {
          documentKey: 'desktop:/Users/mario/Papers/Recent.pdf',
          displayName: 'Recent.pdf',
          path: '/Users/mario/Papers/Recent.pdf',
          fileSize: 100,
          modifiedAt: '2026-07-06T10:00:00+08:00',
          pageCount: 10,
          lastPage: 4,
          progress: 0.4,
          missing: false,
          lastOpenedAt: '2026-07-06T10:00:00+08:00',
          tagIds: [1],
        },
      ],
      availableTags: [
        {
          id: 1,
          name: 'Transformer',
          color: '#2563eb',
          documentCount: 1,
          annotationCount: 0,
          createdAt: '2026-07-01T00:00:00+08:00',
          updatedAt: '2026-07-01T00:00:00+08:00',
        },
      ],
    });

    expect(screen.getByRole('button', { name: 'Transformer' })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run integration tests and verify they fail**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx
```

Expected: FAIL because new props are not wired.

- [ ] **Step 3: Update HomeDashboard props and rendering**

In `src/home/HomeDashboard.tsx`, add props:

```ts
  onToggleDocumentTag(document: PersistedDocument, tag: Tag, selected: boolean): void | Promise<void>;
  onRemoveRecentDocuments(documents: PersistedDocument[]): void | Promise<void>;
  onClearRecentDocuments(): void | Promise<void>;
```

Destructure them and pass into `HomeRecentFilesWorkspace`:

```tsx
        tags={availableTags}
        onToggleDocumentTag={onToggleDocumentTag}
        onRemoveRecentDocuments={onRemoveRecentDocuments}
        onClearRecentDocuments={onClearRecentDocuments}
        onOpenTags={onOpenTags}
```

Remove the old recent `onRemoveRecent` notice fallback for the workspace path. Keep the compact dashboard card fallback until that card is upgraded.

- [ ] **Step 4: Update ReaderWorkspaceSwitch props**

In `src/app/ReaderWorkspaceSwitch.tsx`, add prop types:

```ts
  handleToggleDocumentTag(document: PersistedDocument, tag: Tag, selected: boolean): void | Promise<void>;
  handleRemoveRecentDocuments(documents: PersistedDocument[]): void | Promise<void>;
  handleClearRecentDocuments(): void | Promise<void>;
```

Destructure them and pass to `HomeDashboard`:

```tsx
          onToggleDocumentTag={handleToggleDocumentTag}
          onRemoveRecentDocuments={handleRemoveRecentDocuments}
          onClearRecentDocuments={handleClearRecentDocuments}
```

Update `renderSwitch` defaults in `ReaderWorkspaceSwitch.test.tsx`:

```ts
    handleToggleDocumentTag: vi.fn(),
    handleRemoveRecentDocuments: vi.fn(),
    handleClearRecentDocuments: vi.fn(),
```

- [ ] **Step 5: Add ReaderApp handlers**

In `src/app/ReaderApp.tsx`, add stable helper after `refreshGlobalSearchCollections`:

```ts
  const refreshRecentDocuments = useCallback(() => {
    void persistence
      .listRecentDocuments()
      .then(setRecentDocuments)
      .catch(() => undefined);
  }, [persistence]);
```

Add handlers after `handleToggleFavorite`:

```ts
  const handleToggleDocumentTag = useCallback(
    async (document: PersistedDocument, tag: Tag, selected: boolean) => {
      try {
        if (selected) {
          await persistence.attachDocumentTag(document.documentKey, tag.id);
        } else {
          await persistence.detachDocumentTag(document.documentKey, tag.id);
        }
        refreshRecentDocuments();
        void persistence.listTags().then((tags) => {
          tagsMutatedRef.current = true;
          setAvailableTags(tags);
        });
      } catch {
        return;
      }
    },
    [persistence, refreshRecentDocuments],
  );

  const handleRemoveRecentDocuments = useCallback(
    async (documentsToRemove: PersistedDocument[]) => {
      try {
        await Promise.all(
          documentsToRemove.map((document) =>
            persistence.removeRecentDocument(document.documentKey),
          ),
        );
        setRecentDocuments((current) =>
          current.filter(
            (document) =>
              !documentsToRemove.some((removed) => removed.documentKey === document.documentKey),
          ),
        );
      } catch {
        return;
      }
    },
    [persistence],
  );

  const handleClearRecentDocuments = useCallback(async () => {
    try {
      await persistence.clearRecentDocuments();
      setRecentDocuments([]);
    } catch {
      return;
    }
  }, [persistence]);
```

Pass them into `ReaderWorkspaceSwitch`:

```tsx
        handleToggleDocumentTag={handleToggleDocumentTag}
        handleRemoveRecentDocuments={handleRemoveRecentDocuments}
        handleClearRecentDocuments={handleClearRecentDocuments}
```

- [ ] **Step 6: Update App integration test persistence mocks**

In `src/app/App.test.tsx`, update `createEmptyPersistence()` to include:

```ts
    removeRecentDocument: vi.fn(),
    clearRecentDocuments: vi.fn(),
```

Update `PersistedDocument` fixtures with `lastOpenedAt` and `tagIds` as discovered by typecheck.

Add an integration test:

```ts
  it('binds an existing tag from the recent files workspace', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/Users/mario/Papers/Recent.pdf',
          path: '/Users/mario/Papers/Recent.pdf',
          displayName: 'Recent.pdf',
          fileSize: 1024,
          modifiedAt: '2026-07-08T09:00:00+08:00',
          pageCount: 12,
          lastPage: 3,
          progress: 0.25,
          missing: false,
          lastOpenedAt: '2026-07-08T09:00:00+08:00',
          tagIds: [],
        },
      ]),
      listTags: vi.fn().mockResolvedValue([
        {
          id: 1,
          name: 'AI',
          color: '#8b5cf6',
          documentCount: 0,
          annotationCount: 0,
          createdAt: '2026-07-01T00:00:00Z',
          updatedAt: '2026-07-01T00:00:00Z',
        },
      ]),
      attachDocumentTag: vi.fn().mockResolvedValue(undefined),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: '最近文件 1' }));
    fireEvent.click(await screen.findByRole('button', { name: '编辑标签 Recent.pdf' }));
    fireEvent.click(screen.getByRole('button', { name: '切换标签 AI' }));

    await waitFor(() => {
      expect(persistence.attachDocumentTag).toHaveBeenCalledWith(
        'desktop:/Users/mario/Papers/Recent.pdf',
        1,
      );
    });
  });
```

- [ ] **Step 7: Run integration tests**

Run:

```bash
bunx vitest run src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit app wiring changes**

Run:

```bash
git add src/home/HomeDashboard.tsx src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/ReaderApp.tsx src/app/App.test.tsx
git commit -m "feat: wire recent file management"
```

## Task 6: Final Validation And Polish

**Files:**
- Modify only files touched by Tasks 1-5 when validation exposes a defect.

- [ ] **Step 1: Run focused frontend suite**

Run:

```bash
bunx vitest run src/persistence/persistenceApi.test.ts src/app/readerAppMappers.test.ts src/home/recentWorkspaceUtils.test.ts src/home/HomeRecentFilesWorkspace.test.tsx src/home/HomeDashboard.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run backend suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run full frontend tests when focused tests pass**

Run:

```bash
bun run test
```

Expected: PASS. If unrelated pre-existing failures appear, record the failing test names and keep the code changes limited to this feature.

- [ ] **Step 5: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected:

- `git diff --check` prints no output and exits 0.
- Changed files are limited to the files named in this plan.

- [ ] **Step 6: Commit validation fixes**

If Step 1-5 required edits, commit only those edits:

```bash
git add <paths changed during validation>
git commit -m "test: stabilize recent files completion"
```

If Step 1-5 required no edits, do not create an empty commit.

## Self-Review Checklist

Spec coverage:

- High-density recent list: Task 4.
- Existing-tag display and filtering: Tasks 3 and 4.
- Single-file tag binding: Tasks 4 and 5.
- Batch tag binding/removal: Task 4.
- Real remove and clear recent history: Tasks 1, 4, and 5.
- Derived right rail: Tasks 3 and 4.
- Real `lastOpenedAt`: Tasks 1 and 2.
- No author/source metadata: Task 4 columns exclude those fields.
- One migration only: Task 1 creates only migration 005.
- No browser/app startup: all validation commands are CLI-only.

Red-flag scan:

- This plan intentionally contains no incomplete markers and no incomplete sections.

Type consistency:

- Rust uses `last_opened_at` and `tag_ids`.
- TypeScript uses `lastOpenedAt` and `tagIds`.
- Persistence commands are `remove_recent_document` and `clear_recent_documents`.
- Frontend methods are `removeRecentDocument` and `clearRecentDocuments`.
