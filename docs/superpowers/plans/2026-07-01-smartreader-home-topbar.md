# SmartReader Home Top Bar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the prototype-style SmartReader home top bar with file open, global search, and shortcut routing while keeping search and workspace behavior local-first.

**Architecture:** Keep `ReaderApp` as the workspace/state owner and make the new top bar presentational. Add typed all-bookmark/all-annotation persistence queries for global search and management workspaces, then use a small Strategy-style search helper to aggregate files, bookmarks, annotations, and current-document full-text search. New import, compare, annotation, and bookmark workspaces are lightweight local client surfaces with no new backend or dependency.

**Tech Stack:** React 18, TypeScript, Vite, Vitest, Tauri v2, Rust, SQLite via `rusqlite`, lucide-react icons, existing `@react-pdf-viewer` viewer controller.

---

## Scope Check

This plan implements one cohesive feature slice from `docs/superpowers/specs/2026-07-01-smartreader-home-topbar-design.md`: home chrome, global search entry, and the shortcut targets needed by that chrome. Persistent cross-document PDF full-text indexing, full academic metadata import, full compare-reading engine, cloud sync, AI assistant, and broad homepage redesign remain outside this plan.

## File Structure

Create:

- `src/home/HomeTopBar.tsx` - presentational desktop-style top bar with search entry and shortcut buttons.
- `src/home/HomeTopBar.test.tsx` - component tests for top bar rendering and callbacks.
- `src/search/globalSearch.ts` - pure search result model and provider aggregation helpers.
- `src/search/globalSearch.test.ts` - pure tests for file, bookmark, annotation, and active full-text result mapping.
- `src/search/GlobalSearchPanel.tsx` - global search dialog/panel UI.
- `src/workspaces/ImportWorkspace.tsx` - local import entry workspace.
- `src/workspaces/CompareWorkspace.tsx` - compare-reading workspace shell.
- `src/workspaces/AnnotationManagerWorkspace.tsx` - persisted annotation list workspace.
- `src/workspaces/BookmarkManagerWorkspace.tsx` - persisted bookmark list workspace.

Modify:

- `src-tauri/src/db.rs` - add all-bookmark/all-annotation record structs, query functions, Tauri commands, and Rust tests.
- `src-tauri/src/lib.rs` - register the new Tauri commands.
- `src/persistence/persistenceApi.ts` - add typed frontend methods for all bookmarks and all annotations.
- `src/app/appTypes.ts` - extend `AppWorkspace`.
- `src/commands/commandRegistry.ts` - add global search command id and default shortcut.
- `src/preferences/preferencesStore.ts` - include the global search shortcut in defaults.
- `src/reader/hooks/useReaderCommands.ts` - register the `Meta+K` global search command.
- `src/home/HomeDashboard.tsx` - render `HomeTopBar`, centralize file picker fallback, and pass shortcut callbacks.
- `src/home/HomeQuickStart.tsx` - reuse the parent file picker bridge instead of owning its own hidden input.
- `src/app/ReaderApp.tsx` - own global search state, load global records, route shortcuts, and render new workspaces.
- `src/app/styles.css` - add top bar, global search, and workspace styles.
- `src/app/App.test.tsx` - add integration tests for `Meta+K`, top bar open, and workspace routing.
- `src/home/HomeQuickStart.test.tsx` - update quick-start tests for the new `onPickBrowserFile` prop if failing after the parent file input move.
- `src/commands/commandRegistry.test.ts` - verify `Meta+K` is part of MVP shortcuts.

## Pre-Flight

- [ ] **Step 1: Confirm a clean worktree**

Run:

```bash
git status --short
```

Expected: no output. If output appears, inspect it and do not overwrite unrelated user changes.

- [ ] **Step 2: Read the approved spec**

Run:

```bash
sed -n '1,320p' docs/superpowers/specs/2026-07-01-smartreader-home-topbar-design.md
```

Expected: spec includes the accepted full-text boundary: current opened PDF search now, persistent unopened-PDF indexing outside this task.

---

### Task 1: Add Global Bookmark And Annotation Persistence Queries

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/persistence/persistenceApi.ts`

- [ ] **Step 1: Add failing Rust tests**

Append these tests inside the existing `#[cfg(test)] mod tests` in `src-tauri/src/db.rs`:

```rust
    #[test]
    fn lists_all_bookmarks_with_document_metadata() {
        let connection = migrated_test_connection();
        let document = PersistedDocument {
            document_key: "desktop:/tmp/book.pdf".to_string(),
            path: Some("/tmp/book.pdf".to_string()),
            display_name: "book.pdf".to_string(),
            file_size: Some(100),
            modified_at: Some("2026-07-01T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 1,
            progress: 0.0,
            missing: false,
        };
        upsert_document(&connection, &document).expect("document");
        upsert_bookmark(
            &connection,
            PersistedBookmark {
                id: None,
                document_key: document.document_key.clone(),
                page: 12,
                title: "Important section".to_string(),
                created_at: "2026-07-01T00:00:00Z".to_string(),
                updated_at: "2026-07-01T00:00:00Z".to_string(),
            },
        )
        .expect("bookmark");

        let records = list_all_bookmark_records_tx(&connection).expect("records");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].document_key, document.document_key);
        assert_eq!(records[0].document_display_name.as_deref(), Some("book.pdf"));
        assert_eq!(records[0].document_path.as_deref(), Some("/tmp/book.pdf"));
        assert!(!records[0].document_missing);
        assert_eq!(records[0].title, "Important section");
    }

    #[test]
    fn lists_all_annotations_with_document_metadata_and_tag_ids() {
        let connection = migrated_test_connection();
        let document = PersistedDocument {
            document_key: "desktop:/tmp/annotated.pdf".to_string(),
            path: Some("/tmp/annotated.pdf".to_string()),
            display_name: "annotated.pdf".to_string(),
            file_size: Some(100),
            modified_at: Some("2026-07-01T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 1,
            progress: 0.0,
            missing: false,
        };
        upsert_document(&connection, &document).expect("document");
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "Research".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("tag");
        let annotation = upsert_annotation(
            &connection,
            PersistedAnnotation {
                id: None,
                document_key: document.document_key.clone(),
                page: 3,
                r#type: "note".to_string(),
                color: "#facc15".to_string(),
                text: Some("Remember this claim".to_string()),
                quote: Some("quoted PDF text".to_string()),
                areas: serde_json::json!([]),
                tag_ids: Some(vec![tag.id]),
                created_at: "2026-07-01T00:00:00Z".to_string(),
                updated_at: "2026-07-01T00:00:00Z".to_string(),
            },
        )
        .expect("annotation");

        let records = list_all_annotation_records_tx(&connection).expect("records");

        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, annotation.id);
        assert_eq!(records[0].document_key, document.document_key);
        assert_eq!(records[0].document_display_name.as_deref(), Some("annotated.pdf"));
        assert_eq!(records[0].document_path.as_deref(), Some("/tmp/annotated.pdf"));
        assert_eq!(records[0].text.as_deref(), Some("Remember this claim"));
        assert_eq!(records[0].quote.as_deref(), Some("quoted PDF text"));
        assert_eq!(records[0].tag_ids, Some(vec![tag.id]));
    }
```

- [ ] **Step 2: Run Rust tests to verify failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml lists_all_bookmarks_with_document_metadata
cargo test --manifest-path src-tauri/Cargo.toml lists_all_annotations_with_document_metadata_and_tag_ids
```

Expected: FAIL with unresolved function errors for `list_all_bookmark_records_tx` and `list_all_annotation_records_tx`.

- [ ] **Step 3: Add Rust record structs**

In `src-tauri/src/db.rs`, after `PersistedBookmark`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBookmarkRecord {
    pub id: Option<i64>,
    pub document_key: String,
    pub page: i64,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub document_display_name: Option<String>,
    pub document_path: Option<String>,
    pub document_missing: bool,
}
```

After `PersistedAnnotation`, add:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAnnotationRecord {
    pub id: Option<i64>,
    pub document_key: String,
    pub page: i64,
    pub r#type: String,
    pub color: String,
    pub text: Option<String>,
    pub quote: Option<String>,
    pub areas: serde_json::Value,
    #[serde(default)]
    pub tag_ids: Option<Vec<i64>>,
    pub created_at: String,
    pub updated_at: String,
    pub document_display_name: Option<String>,
    pub document_path: Option<String>,
    pub document_missing: bool,
}
```

- [ ] **Step 4: Add Tauri commands**

In `src-tauri/src/db.rs`, after `list_bookmarks`, add:

```rust
#[tauri::command]
pub fn list_all_bookmarks(
    state: State<'_, DatabaseState>,
) -> Result<Vec<PersistedBookmarkRecord>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_all_bookmark_records_tx(&connection)
}
```

After `list_annotations`, add:

```rust
#[tauri::command]
pub fn list_all_annotations(
    state: State<'_, DatabaseState>,
) -> Result<Vec<PersistedAnnotationRecord>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_all_annotation_records_tx(&connection)
}
```

- [ ] **Step 5: Add query implementations**

In `src-tauri/src/db.rs`, after `list_bookmarks_for_document`, add:

```rust
pub fn list_all_bookmark_records_tx(
    connection: &Connection,
) -> Result<Vec<PersistedBookmarkRecord>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT b.id, b.document_key, b.page, b.title, b.created_at, b.updated_at,
               d.display_name, d.path, COALESCE(d.missing, 1)
        FROM bookmarks b
        LEFT JOIN documents d ON d.document_key = b.document_key
        ORDER BY COALESCE(d.display_name, b.document_key) ASC, b.page ASC, b.title ASC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PersistedBookmarkRecord {
            id: Some(row.get(0)?),
            document_key: row.get(1)?,
            page: row.get(2)?,
            title: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            document_display_name: row.get(6)?,
            document_path: row.get(7)?,
            document_missing: row.get::<_, i64>(8)? == 1,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}
```

After `list_annotations_for_document`, add:

```rust
pub fn list_all_annotation_records_tx(
    connection: &Connection,
) -> Result<Vec<PersistedAnnotationRecord>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT a.id, a.document_key, a.page, a.type, a.color, a.text, a.quote,
               a.areas_json, a.created_at, a.updated_at, d.display_name, d.path,
               COALESCE(d.missing, 1)
        FROM annotations a
        LEFT JOIN documents d ON d.document_key = a.document_key
        ORDER BY COALESCE(d.display_name, a.document_key) ASC, a.page ASC, a.created_at ASC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        let areas_json: String = row.get(7)?;
        let areas = serde_json::from_str(&areas_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                7,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        let id = row.get(0)?;
        Ok(PersistedAnnotationRecord {
            id: Some(id),
            document_key: row.get(1)?,
            page: row.get(2)?,
            r#type: row.get(3)?,
            color: row.get(4)?,
            text: row.get(5)?,
            quote: row.get(6)?,
            areas,
            tag_ids: Some(Vec::new()),
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            document_display_name: row.get(10)?,
            document_path: row.get(11)?,
            document_missing: row.get::<_, i64>(12)? == 1,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(DbError::from)?
        .into_iter()
        .map(|mut annotation| {
            if let Some(id) = annotation.id {
                annotation.tag_ids = Some(list_annotation_tag_ids_tx(connection, id)?);
            }
            Ok(annotation)
        })
        .collect()
}
```

- [ ] **Step 6: Register commands in Tauri**

In `src-tauri/src/lib.rs`, add these entries to the `tauri::generate_handler!` list immediately after the existing per-document list commands:

```rust
            db::list_all_bookmarks,
            db::list_all_annotations,
```

- [ ] **Step 7: Add frontend persistence types and methods**

In `src/persistence/persistenceApi.ts`, after `PersistedBookmark`, add:

```ts
export type PersistedBookmarkRecord = PersistedBookmark & {
  documentDisplayName: string | null;
  documentPath: string | null;
  documentMissing: boolean;
};
```

After `PersistedAnnotation`, add:

```ts
export type PersistedAnnotationRecord = PersistedAnnotation & {
  documentDisplayName: string | null;
  documentPath: string | null;
  documentMissing: boolean;
};
```

In `CorePersistenceApi`, add:

```ts
  listAllBookmarks(): Promise<PersistedBookmarkRecord[]>;
  listAllAnnotations(): Promise<PersistedAnnotationRecord[]>;
```

In `createPersistenceApi`, add:

```ts
    listAllBookmarks() {
      return invoke<PersistedBookmarkRecord[]>('list_all_bookmarks');
    },
    listAllAnnotations() {
      return invoke<PersistedAnnotationRecord[]>('list_all_annotations');
    },
```

- [ ] **Step 8: Update test persistence stubs**

In `src/app/App.test.tsx`, add these methods to `createEmptyPersistence()`:

```ts
    listAllBookmarks: vi.fn().mockResolvedValue([]),
    listAllAnnotations: vi.fn().mockResolvedValue([]),
```

Search for other object literals typed as `PersistenceApi` and add the same two methods when TypeScript requires them:

```bash
rg -n "PersistenceApi|createEmptyPersistence|listAllBookmarks|listAllAnnotations" src
```

- [ ] **Step 9: Run Task 1 validation**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml lists_all_bookmarks_with_document_metadata
cargo test --manifest-path src-tauri/Cargo.toml lists_all_annotations_with_document_metadata_and_tag_ids
bun run typecheck
```

Expected: both commands PASS.

- [ ] **Step 10: Commit Task 1**

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs src/persistence/persistenceApi.ts src/app/App.test.tsx
git commit -m "feat: add global bookmark annotation queries"
```

---

### Task 2: Add Pure Global Search Helpers

**Files:**
- Create: `src/search/globalSearch.ts`
- Create: `src/search/globalSearch.test.ts`

- [ ] **Step 1: Write failing pure search tests**

Create `src/search/globalSearch.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { PersistedAnnotationRecord, PersistedBookmarkRecord } from '../persistence/persistenceApi';
import { buildGlobalSearchResults } from './globalSearch';

const bookmark: PersistedBookmarkRecord = {
  id: 1,
  documentKey: 'desktop:/tmp/ml.pdf',
  page: 8,
  title: 'Transformer overview',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  documentDisplayName: 'ml.pdf',
  documentPath: '/tmp/ml.pdf',
  documentMissing: false,
};

const annotation: PersistedAnnotationRecord = {
  id: 2,
  documentKey: 'desktop:/tmp/nlp.pdf',
  page: 12,
  type: 'note',
  color: '#facc15',
  text: 'Compare this benchmark',
  quote: 'Important benchmark quote',
  areas: [],
  tagIds: [],
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-07-01T00:00:00Z',
  documentDisplayName: 'nlp.pdf',
  documentPath: '/tmp/nlp.pdf',
  documentMissing: false,
};

describe('buildGlobalSearchResults', () => {
  it('returns file results by file name and path', () => {
    const results = buildGlobalSearchResults({
      query: 'stats',
      recentDocuments: [
        {
          documentKey: 'desktop:/tmp/stats.pdf',
          displayName: 'statistics.pdf',
          path: '/tmp/books/stats.pdf',
          fileSize: 100,
          modifiedAt: null,
          pageCount: 20,
          lastPage: 3,
          progress: 0.15,
          missing: false,
        },
      ],
      favoriteDocuments: [],
      bookmarks: [],
      annotations: [],
      activeSession: null,
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: 'file:desktop:/tmp/stats.pdf',
        source: 'file',
        title: 'statistics.pdf',
        documentKey: 'desktop:/tmp/stats.pdf',
        path: '/tmp/books/stats.pdf',
      }),
    ]);
  });

  it('returns bookmark results', () => {
    const results = buildGlobalSearchResults({
      query: 'transformer',
      recentDocuments: [],
      favoriteDocuments: [],
      bookmarks: [bookmark],
      annotations: [annotation],
      activeSession: null,
    });

    expect(results.map((result) => result.source)).toEqual(['bookmark']);
    expect(results[0]).toMatchObject({
      id: 'bookmark:1',
      title: 'Transformer overview',
      page: 8,
      documentKey: 'desktop:/tmp/ml.pdf',
    });
  });

  it('returns annotation results', () => {
    const results = buildGlobalSearchResults({
      query: 'benchmark',
      recentDocuments: [],
      favoriteDocuments: [],
      bookmarks: [bookmark],
      annotations: [annotation],
      activeSession: null,
    });

    expect(results.map((result) => result.source)).toEqual(['annotation']);
    expect(results[0]).toMatchObject({
      id: 'annotation:2',
      title: 'Compare this benchmark',
      page: 12,
      documentKey: 'desktop:/tmp/nlp.pdf',
    });
  });

  it('adds a current document full-text action when a reader session is active', () => {
    const results = buildGlobalSearchResults({
      query: 'privacy',
      recentDocuments: [],
      favoriteDocuments: [],
      bookmarks: [],
      annotations: [],
      activeSession: {
        documentKey: 'desktop:/tmp/current.pdf',
        title: 'current.pdf',
      },
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: 'fullText:desktop:/tmp/current.pdf:privacy',
        source: 'fullText',
        title: '在当前文档中搜索 "privacy"',
        documentKey: 'desktop:/tmp/current.pdf',
        query: 'privacy',
      }),
    ]);
  });

  it('deduplicates files that are both recent and favorite', () => {
    const results = buildGlobalSearchResults({
      query: 'paper',
      recentDocuments: [
        {
          documentKey: 'desktop:/tmp/paper.pdf',
          displayName: 'paper.pdf',
          path: '/tmp/paper.pdf',
          fileSize: 100,
          modifiedAt: null,
          pageCount: 20,
          lastPage: 1,
          progress: 0,
          missing: false,
        },
      ],
      favoriteDocuments: [
        {
          documentKey: 'desktop:/tmp/paper.pdf',
          displayName: 'paper.pdf',
          path: '/tmp/paper.pdf',
          lastPage: 1,
          progress: 0,
        },
      ],
      bookmarks: [],
      annotations: [],
      activeSession: null,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('file:desktop:/tmp/paper.pdf');
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bunx vitest run src/search/globalSearch.test.ts
```

Expected: FAIL because `src/search/globalSearch.ts` does not exist.

- [ ] **Step 3: Implement pure search helper**

Create `src/search/globalSearch.ts`:

```ts
import type {
  PersistedAnnotationRecord,
  PersistedBookmarkRecord,
  PersistedDocument,
} from '../persistence/persistenceApi';
import type { FavoriteDocument } from '../favorites/favoriteModels';

export type GlobalSearchSource = 'file' | 'bookmark' | 'annotation' | 'fullText';

export type GlobalSearchActiveSession = {
  documentKey: string;
  title: string;
};

export type GlobalSearchResult = {
  id: string;
  source: GlobalSearchSource;
  title: string;
  subtitle: string;
  actionLabel: string;
  documentKey: string | null;
  path: string | null;
  page: number | null;
  query?: string;
  missing?: boolean;
};

type BuildGlobalSearchResultsInput = {
  query: string;
  recentDocuments: PersistedDocument[];
  favoriteDocuments: FavoriteDocument[];
  bookmarks: PersistedBookmarkRecord[];
  annotations: PersistedAnnotationRecord[];
  activeSession: GlobalSearchActiveSession | null;
};

type SearchableDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  lastPage: number;
  progress: number;
  missing: boolean;
};

const maxResultsPerSource = 8;

export function buildGlobalSearchResults({
  query,
  recentDocuments,
  favoriteDocuments,
  bookmarks,
  annotations,
  activeSession,
}: BuildGlobalSearchResultsInput): GlobalSearchResult[] {
  const normalizedQuery = normalizeQuery(query);

  if (!normalizedQuery) {
    return [];
  }

  return [
    ...buildFileResults(normalizedQuery, recentDocuments, favoriteDocuments),
    ...buildBookmarkResults(normalizedQuery, bookmarks),
    ...buildAnnotationResults(normalizedQuery, annotations),
    ...buildFullTextResult(normalizedQuery, activeSession),
  ];
}

function buildFileResults(
  normalizedQuery: string,
  recentDocuments: PersistedDocument[],
  favoriteDocuments: FavoriteDocument[],
): GlobalSearchResult[] {
  const documents = new Map<string, SearchableDocument>();

  for (const document of recentDocuments) {
    documents.set(document.documentKey, {
      documentKey: document.documentKey,
      displayName: document.displayName,
      path: document.path,
      lastPage: document.lastPage,
      progress: document.progress,
      missing: document.missing,
    });
  }

  for (const document of favoriteDocuments) {
    if (!documents.has(document.documentKey)) {
      documents.set(document.documentKey, {
        documentKey: document.documentKey,
        displayName: document.displayName,
        path: document.path,
        lastPage: document.lastPage,
        progress: document.progress,
        missing: false,
      });
    }
  }

  return [...documents.values()]
    .filter((document) =>
      matchesAny(normalizedQuery, [document.displayName, document.path ?? '']),
    )
    .slice(0, maxResultsPerSource)
    .map((document) => ({
      id: `file:${document.documentKey}`,
      source: 'file',
      title: document.displayName,
      subtitle: document.path ?? '浏览器选择的本地文件',
      actionLabel: document.missing ? '文件缺失' : '打开文件',
      documentKey: document.documentKey,
      path: document.path,
      page: document.lastPage,
      missing: document.missing,
    }));
}

function buildBookmarkResults(
  normalizedQuery: string,
  bookmarks: PersistedBookmarkRecord[],
): GlobalSearchResult[] {
  return bookmarks
    .filter((bookmark) =>
      matchesAny(normalizedQuery, [
        bookmark.title,
        bookmark.documentDisplayName ?? '',
        bookmark.documentPath ?? '',
      ]),
    )
    .slice(0, maxResultsPerSource)
    .map((bookmark) => ({
      id: `bookmark:${bookmark.id ?? `${bookmark.documentKey}:${bookmark.page}:${bookmark.title}`}`,
      source: 'bookmark',
      title: bookmark.title,
      subtitle: `${bookmark.documentDisplayName ?? bookmark.documentKey} · 第 ${bookmark.page} 页`,
      actionLabel: bookmark.documentMissing ? '文件缺失' : '跳转书签',
      documentKey: bookmark.documentKey,
      path: bookmark.documentPath,
      page: bookmark.page,
      missing: bookmark.documentMissing,
    }));
}

function buildAnnotationResults(
  normalizedQuery: string,
  annotations: PersistedAnnotationRecord[],
): GlobalSearchResult[] {
  return annotations
    .filter((annotation) =>
      matchesAny(normalizedQuery, [
        annotation.text ?? '',
        annotation.quote ?? '',
        annotation.documentDisplayName ?? '',
        annotation.documentPath ?? '',
      ]),
    )
    .slice(0, maxResultsPerSource)
    .map((annotation) => ({
      id: `annotation:${annotation.id ?? `${annotation.documentKey}:${annotation.page}`}`,
      source: 'annotation',
      title: annotation.text || annotation.quote || '未命名批注',
      subtitle: `${annotation.documentDisplayName ?? annotation.documentKey} · 第 ${annotation.page} 页`,
      actionLabel: annotation.documentMissing ? '文件缺失' : '跳转批注',
      documentKey: annotation.documentKey,
      path: annotation.documentPath,
      page: annotation.page,
      missing: annotation.documentMissing,
    }));
}

function buildFullTextResult(
  normalizedQuery: string,
  activeSession: GlobalSearchActiveSession | null,
): GlobalSearchResult[] {
  if (!activeSession) {
    return [];
  }

  return [
    {
      id: `fullText:${activeSession.documentKey}:${normalizedQuery}`,
      source: 'fullText',
      title: `在当前文档中搜索 "${normalizedQuery}"`,
      subtitle: activeSession.title,
      actionLabel: '搜索全文',
      documentKey: activeSession.documentKey,
      path: null,
      page: null,
      query: normalizedQuery,
    },
  ];
}

function matchesAny(normalizedQuery: string, values: string[]): boolean {
  return values.some((value) => normalizeQuery(value).includes(normalizedQuery));
}

function normalizeQuery(value: string): string {
  return value.trim().toLowerCase();
}
```

- [ ] **Step 4: Run Task 2 tests**

Run:

```bash
bunx vitest run src/search/globalSearch.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/search/globalSearch.ts src/search/globalSearch.test.ts
git commit -m "feat: add global search result mapping"
```

---

### Task 3: Add Home Top Bar And Centralized File Picker Bridge

**Files:**
- Create: `src/home/HomeTopBar.tsx`
- Create: `src/home/HomeTopBar.test.tsx`
- Modify: `src/home/HomeDashboard.tsx`
- Modify: `src/home/HomeQuickStart.tsx`
- Modify: `src/home/HomeQuickStart.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Write failing top bar component tests**

Create `src/home/HomeTopBar.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeTopBar } from './HomeTopBar';

function renderTopBar() {
  const props = {
    onOpenPdf: vi.fn(),
    onOpenGlobalSearch: vi.fn(),
    onOpenImport: vi.fn(),
    onOpenCompare: vi.fn(),
    onOpenAnnotations: vi.fn(),
    onOpenBookmarks: vi.fn(),
    onOpenSettings: vi.fn(),
  };

  render(<HomeTopBar {...props} />);
  return props;
}

describe('HomeTopBar', () => {
  it('renders desktop app chrome and shortcut entries', () => {
    renderTopBar();

    expect(screen.getByLabelText('macOS 窗口控制')).toBeInTheDocument();
    expect(screen.getByText('SmartReader')).toBeInTheDocument();
    expect(screen.getByText('本地优先的 PDF 阅读器')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开文件' })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜索文件、书签、批注...')).toBeInTheDocument();
    expect(screen.getByText('⌘K')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '导入文献' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '对比阅读' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '批注管理' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '书签' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '设置' })).toBeInTheDocument();
  });

  it('forwards click and focus actions', () => {
    const props = renderTopBar();

    fireEvent.click(screen.getByRole('button', { name: '打开文件' }));
    fireEvent.focus(screen.getByPlaceholderText('搜索文件、书签、批注...'));
    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    fireEvent.click(screen.getByRole('button', { name: '对比阅读' }));
    fireEvent.click(screen.getByRole('button', { name: '批注管理' }));
    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));

    expect(props.onOpenPdf).toHaveBeenCalledTimes(1);
    expect(props.onOpenGlobalSearch).toHaveBeenCalledTimes(1);
    expect(props.onOpenImport).toHaveBeenCalledTimes(1);
    expect(props.onOpenCompare).toHaveBeenCalledTimes(1);
    expect(props.onOpenAnnotations).toHaveBeenCalledTimes(1);
    expect(props.onOpenBookmarks).toHaveBeenCalledTimes(1);
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run src/home/HomeTopBar.test.tsx
```

Expected: FAIL because `HomeTopBar.tsx` does not exist.

- [ ] **Step 3: Implement `HomeTopBar`**

Create `src/home/HomeTopBar.tsx`:

```tsx
import {
  BookOpenCheck,
  BookMarked,
  Columns2,
  FileInput,
  FolderOpen,
  LibraryBig,
  Search,
  Settings,
} from 'lucide-react';

type HomeTopBarProps = {
  onOpenPdf(): void;
  onOpenGlobalSearch(): void;
  onOpenImport(): void;
  onOpenCompare(): void;
  onOpenAnnotations(): void;
  onOpenBookmarks(): void;
  onOpenSettings(): void;
};

export function HomeTopBar({
  onOpenPdf,
  onOpenGlobalSearch,
  onOpenImport,
  onOpenCompare,
  onOpenAnnotations,
  onOpenBookmarks,
  onOpenSettings,
}: HomeTopBarProps) {
  return (
    <header className="home-top-bar" aria-label="SmartReader 顶部栏">
      <div className="home-top-brand">
        <div className="window-controls" aria-label="macOS 窗口控制">
          <span className="window-dot close" />
          <span className="window-dot minimize" />
          <span className="window-dot maximize" />
        </div>
        <BookOpenCheck size={28} strokeWidth={1.8} />
        <div className="home-top-title">
          <strong>SmartReader</strong>
          <span>本地优先的 PDF 阅读器</span>
        </div>
        <button type="button" className="top-open-button" onClick={onOpenPdf}>
          <FolderOpen size={18} />
          <span>打开文件</span>
        </button>
      </div>

      <div className="global-search-trigger" onClick={onOpenGlobalSearch}>
        <Search size={18} />
        <input
          aria-label="全局搜索"
          placeholder="搜索文件、书签、批注..."
          readOnly
          onFocus={onOpenGlobalSearch}
        />
        <kbd>⌘K</kbd>
      </div>

      <nav className="top-shortcuts" aria-label="全局快捷入口">
        <button type="button" onClick={onOpenImport}>
          <FileInput size={18} />
          <span>导入文献</span>
        </button>
        <button type="button" onClick={onOpenCompare}>
          <Columns2 size={18} />
          <span>对比阅读</span>
        </button>
        <button type="button" onClick={onOpenAnnotations}>
          <LibraryBig size={18} />
          <span>批注管理</span>
        </button>
        <button type="button" onClick={onOpenBookmarks}>
          <BookMarked size={18} />
          <span>书签</span>
        </button>
        <button type="button" onClick={onOpenSettings}>
          <Settings size={18} />
          <span>设置</span>
        </button>
      </nav>
    </header>
  );
}
```

- [ ] **Step 4: Update `HomeQuickStart` to use a parent picker bridge**

Replace `src/home/HomeQuickStart.tsx` with:

```tsx
import { FileDown, FolderOpen, HardDriveUpload } from 'lucide-react';

type HomeQuickStartProps = {
  onOpenPdf(): void;
  onPickBrowserFile(): void;
};

export function HomeQuickStart({ onOpenPdf, onPickBrowserFile }: HomeQuickStartProps) {
  return (
    <section className="home-panel home-quick-start" aria-labelledby="home-quick-start-title">
      <div className="section-heading">
        <p>快速开始</p>
        <h2 id="home-quick-start-title">打开或导入 PDF</h2>
      </div>
      <div className="quick-actions">
        <button type="button" className="primary-action" onClick={onOpenPdf}>
          <FolderOpen size={18} />
          打开本地 PDF
        </button>
        <button
          type="button"
          className="secondary-action file-picker-button"
          onClick={onPickBrowserFile}
        >
          <FileDown size={18} />
          选择 PDF 文件
        </button>
        <button type="button" className="secondary-action" disabled aria-disabled="true">
          <HardDriveUpload size={18} />
          选择文件夹
        </button>
      </div>
      <div className="drop-target" aria-label="PDF 拖拽区域">
        <FileDown size={20} />
        <strong>拖拽到这里</strong>
        <span>支持从桌面拖入单个 PDF，本地文件不会离开你的设备。</span>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Update `HomeDashboard`**

In `src/home/HomeDashboard.tsx`, add `useCallback`, `useRef`, and import `HomeTopBar`:

```tsx
import { BookOpen, FileText, Settings, Tags } from 'lucide-react';
import { useCallback, useRef, type ChangeEventHandler } from 'react';
import { HomeTopBar } from './HomeTopBar';
```

Extend `HomeDashboardProps`:

```ts
  onOpenGlobalSearch(): void;
  onOpenImport(): void;
  onOpenCompare(): void;
  onOpenAnnotations(): void;
  onOpenBookmarks(): void;
```

Read the new props in the function parameter list:

```ts
  onOpenGlobalSearch,
  onOpenImport,
  onOpenCompare,
  onOpenAnnotations,
  onOpenBookmarks,
```

Inside `HomeDashboard`, before `return`, add:

```tsx
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openBrowserFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleOpenPdf = useCallback(() => {
    try {
      void Promise.resolve(onOpenPdf()).catch(openBrowserFilePicker);
    } catch {
      openBrowserFilePicker();
    }
  }, [onOpenPdf, openBrowserFilePicker]);
```

Replace the current `home-dashboard` return shape with a `home-dashboard-shell` wrapper:

```tsx
    <section className="home-dashboard-shell" aria-label="SmartReader 首页">
      <HomeTopBar
        onOpenPdf={handleOpenPdf}
        onOpenGlobalSearch={onOpenGlobalSearch}
        onOpenImport={onOpenImport}
        onOpenCompare={onOpenCompare}
        onOpenAnnotations={onOpenAnnotations}
        onOpenBookmarks={onOpenBookmarks}
        onOpenSettings={onOpenSettings}
      />
      <input
        ref={fileInputRef}
        className="file-picker-input"
        aria-label="选择 PDF 文件"
        type="file"
        accept="application/pdf,.pdf"
        onChange={onBrowserFileChange}
      />
      <div className="home-dashboard" aria-label="SmartReader 首页内容">
        {/* keep the existing aside and home-main content here */}
      </div>
    </section>
```

Within the existing main content, replace the `HomeQuickStart` usage with:

```tsx
            <HomeQuickStart onOpenPdf={handleOpenPdf} onPickBrowserFile={openBrowserFilePicker} />
```

Keep the existing left sidebar, content panels, recent sessions, favorites, and status panel unchanged.

- [ ] **Step 6: Add top bar styles**

In `src/app/styles.css`, add these styles after `.home-mode`:

```css
.home-dashboard-shell {
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: 80px minmax(0, 1fr);
  background: var(--sr-bg);
}

.home-top-bar {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(300px, 1fr) minmax(280px, 420px) minmax(360px, 1fr);
  align-items: center;
  gap: 16px;
  padding: 10px 18px;
  border-bottom: 1px solid var(--sr-border);
  background: rgba(255, 255, 255, 0.96);
}

.home-top-brand,
.top-shortcuts {
  min-width: 0;
  display: flex;
  align-items: center;
}

.home-top-brand {
  gap: 12px;
}

.window-controls {
  display: flex;
  align-items: center;
  gap: 7px;
  flex: 0 0 auto;
}

.window-dot {
  width: 12px;
  height: 12px;
  border-radius: 999px;
  border: 1px solid rgba(15, 23, 42, 0.12);
}

.window-dot.close {
  background: #ff5f57;
}

.window-dot.minimize {
  background: #ffbd2e;
}

.window-dot.maximize {
  background: #28c840;
}

.home-top-title {
  min-width: 0;
  display: grid;
  gap: 2px;
}

.home-top-title strong {
  font-size: 15px;
  line-height: 1.2;
}

.home-top-title span {
  color: var(--sr-text-muted);
  font-size: 12px;
}

.top-open-button {
  margin-left: 8px;
  padding: 0 12px;
}

.global-search-trigger {
  min-width: 0;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  padding: 0 12px;
  border: 1px solid var(--sr-border);
  border-radius: 7px;
  background: var(--sr-surface);
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.06);
  cursor: pointer;
}

.global-search-trigger input {
  min-width: 0;
  width: 100%;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--sr-text);
  cursor: pointer;
}

.global-search-trigger kbd {
  min-width: 34px;
  padding: 2px 6px;
  border: 1px solid var(--sr-border);
  border-radius: 5px;
  background: var(--sr-surface-muted);
  color: var(--sr-text-muted);
  font-size: 12px;
  text-align: center;
}

.top-shortcuts {
  justify-content: flex-end;
  gap: 8px;
}

.top-shortcuts button {
  min-width: 72px;
  height: 54px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 4px;
  border-color: transparent;
  background: transparent;
  color: var(--sr-text);
  font-size: 12px;
}

.top-shortcuts button:hover {
  border-color: rgba(37, 99, 235, 0.16);
  background: #f8fbff;
  color: var(--sr-primary);
}
```

Update `.home-dashboard`:

```css
.home-dashboard {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: 232px minmax(0, 1fr);
  background: var(--sr-bg);
}
```

Remove the old `height: 100%` from `.home-dashboard` only if the duplicate rule conflicts with this exact block.

- [ ] **Step 7: Update quick-start tests if needed**

If `src/home/HomeQuickStart.test.tsx` fails because `onBrowserFileChange` no longer exists, update its render call to:

```tsx
render(
  <HomeQuickStart
    onOpenPdf={onOpenPdf}
    onPickBrowserFile={onPickBrowserFile}
  />,
);
```

Assert `选择 PDF 文件` calls `onPickBrowserFile`:

```tsx
fireEvent.click(screen.getByRole('button', { name: '选择 PDF 文件' }));
expect(onPickBrowserFile).toHaveBeenCalledTimes(1);
```

- [ ] **Step 8: Run Task 3 tests**

Run:

```bash
bunx vitest run src/home/HomeTopBar.test.tsx src/home/HomeQuickStart.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 3**

```bash
git add src/home/HomeTopBar.tsx src/home/HomeTopBar.test.tsx src/home/HomeDashboard.tsx src/home/HomeQuickStart.tsx src/home/HomeQuickStart.test.tsx src/app/styles.css
git commit -m "feat: add SmartReader home top bar"
```

---

### Task 4: Wire Global Search State, Shortcut, And Panel

**Files:**
- Create: `src/search/GlobalSearchPanel.tsx`
- Modify: `src/commands/commandRegistry.ts`
- Modify: `src/commands/commandRegistry.test.ts`
- Modify: `src/preferences/preferencesStore.ts`
- Modify: `src/reader/hooks/useReaderCommands.ts`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing command tests**

In `src/commands/commandRegistry.test.ts`, update the MVP shortcut expectation:

```ts
      globalSearch: 'Meta+K',
```

Add this test:

```ts
  it('registers global search as a command id', () => {
    const registry = new CommandRegistry();
    const handler = vi.fn();

    registry.register({
      id: 'global.search.open',
      label: 'Global Search',
      shortcut: 'Meta+K',
      run: handler,
    });
    registry.run('global.search.open');

    expect(handler).toHaveBeenCalledTimes(1);
  });
```

- [ ] **Step 2: Run command test to verify failure**

Run:

```bash
bunx vitest run src/commands/commandRegistry.test.ts
```

Expected: FAIL because `global.search.open` is not part of `CommandId` and `defaultShortcuts.globalSearch` does not exist.

- [ ] **Step 3: Add global search command id**

In `src/commands/commandRegistry.ts`, add to `CommandId`:

```ts
  | 'global.search.open'
```

Add to `defaultShortcuts`:

```ts
  globalSearch: 'Meta+K',
```

In `src/preferences/preferencesStore.ts`, add to `defaultReaderPreferences.shortcuts`:

```ts
    'global.search.open': defaultShortcuts.globalSearch,
```

- [ ] **Step 4: Update `useReaderCommands`**

In `src/reader/hooks/useReaderCommands.ts`, add to `UseReaderCommandsInput`:

```ts
  openGlobalSearch(): void;
```

Read it from the function arguments:

```ts
  openGlobalSearch,
```

Register the command after `file.open`:

```ts
    registry.register({
      id: 'global.search.open',
      label: 'Global Search',
      shortcut: shortcuts['global.search.open'],
      run: openGlobalSearch,
    });
```

Add `openGlobalSearch` to the `useMemo` dependency array.

- [ ] **Step 5: Create `GlobalSearchPanel`**

Create `src/search/GlobalSearchPanel.tsx`:

```tsx
import { FileText, Highlighter, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { GlobalSearchResult } from './globalSearch';

type GlobalSearchPanelProps = {
  open: boolean;
  query: string;
  results: GlobalSearchResult[];
  onQueryChange(value: string): void;
  onClose(): void;
  onSelectResult(result: GlobalSearchResult): void;
};

const sourceLabels: Record<GlobalSearchResult['source'], string> = {
  file: '文件',
  bookmark: '书签',
  annotation: '批注',
  fullText: '全文',
};

export function GlobalSearchPanel({
  open,
  query,
  results,
  onQueryChange,
  onClose,
  onSelectResult,
}: GlobalSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    }
  }, [open]);

  if (!open) {
    return null;
  }

  return (
    <section className="global-search-panel" role="dialog" aria-label="全局搜索">
      <div className="global-search-card">
        <div className="global-search-input-row">
          <Search size={18} />
          <input
            ref={inputRef}
            aria-label="搜索文件、书签、批注"
            value={query}
            placeholder="搜索文件、书签、批注..."
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                onClose();
              }
            }}
          />
          <button type="button" aria-label="关闭全局搜索" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="global-search-hint">
          <span>文件、书签、批注立即搜索。</span>
          <span>全文搜索限定当前已打开 PDF。</span>
        </div>
        <div className="global-search-results" role="list">
          {results.length > 0 ? (
            results.map((result) => (
              <button
                key={result.id}
                type="button"
                className="global-search-result"
                onClick={() => onSelectResult(result)}
                role="listitem"
                disabled={result.missing}
                aria-disabled={result.missing ? 'true' : undefined}
              >
                <span className="result-icon">
                  {result.source === 'annotation' ? <Highlighter size={16} /> : <FileText size={16} />}
                </span>
                <span className="result-main">
                  <strong>{result.title}</strong>
                  <small>{result.subtitle}</small>
                </span>
                <span className="result-source">{sourceLabels[result.source]}</span>
                <span className="result-action">{result.actionLabel}</span>
              </button>
            ))
          ) : (
            <p className="muted-copy">
              {query.trim() ? '没有匹配结果' : '输入关键词后搜索本地文件、书签和批注。'}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Add failing app integration tests**

In `src/app/App.test.tsx`, add tests:

```tsx
  it('opens global search from the top bar and Meta+K', async () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.focus(screen.getByPlaceholderText('搜索文件、书签、批注...'));
    expect(screen.getByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭全局搜索' }));
    fireEvent.keyDown(window, { key: 'k', metaKey: true });

    expect(screen.getByRole('dialog', { name: '全局搜索' })).toBeInTheDocument();
  });

  it('shows file search results from recent documents', async () => {
    const persistence = {
      ...createEmptyPersistence(),
      listRecentDocuments: vi.fn().mockResolvedValue([
        {
          documentKey: 'desktop:/tmp/stats.pdf',
          path: '/tmp/stats.pdf',
          displayName: 'statistics.pdf',
          fileSize: 100,
          modifiedAt: null,
          pageCount: 20,
          lastPage: 4,
          progress: 0.2,
          missing: false,
        },
      ]),
    };

    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.keyDown(window, { key: 'k', metaKey: true });
    fireEvent.change(screen.getByLabelText('搜索文件、书签、批注'), {
      target: { value: 'stats' },
    });

    expect(await screen.findByText('statistics.pdf')).toBeInTheDocument();
  });
```

- [ ] **Step 7: Wire global search in `ReaderApp`**

In `src/app/ReaderApp.tsx`, add imports:

```tsx
import type { PersistedAnnotationRecord, PersistedBookmarkRecord } from '../persistence/persistenceApi';
import { GlobalSearchPanel } from '../search/GlobalSearchPanel';
import { buildGlobalSearchResults, type GlobalSearchResult } from '../search/globalSearch';
```

Add state near existing home state:

```tsx
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalBookmarks, setGlobalBookmarks] = useState<PersistedBookmarkRecord[]>([]);
  const [globalAnnotations, setGlobalAnnotations] = useState<PersistedAnnotationRecord[]>([]);
  const [pendingPageJump, setPendingPageJump] = useState<{
    documentKey: string;
    page: number;
  } | null>(null);
```

Add a refresh callback after the initial data-loading effect:

```tsx
  const refreshGlobalSearchCollections = useCallback(async () => {
    const [bookmarks, annotations] = await Promise.all([
      persistence.listAllBookmarks(),
      persistence.listAllAnnotations(),
    ]);
    setGlobalBookmarks(bookmarks);
    setGlobalAnnotations(annotations);
  }, [persistence]);

  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true);
    void refreshGlobalSearchCollections().catch(() => undefined);
  }, [refreshGlobalSearchCollections]);
```

Pass `openGlobalSearch` to `useReaderCommands`:

```tsx
    openGlobalSearch,
```

Add global search results:

```tsx
  const globalSearchResults = useMemo(
    () =>
      buildGlobalSearchResults({
        query: globalSearchQuery,
        recentDocuments,
        favoriteDocuments,
        bookmarks: globalBookmarks,
        annotations: globalAnnotations,
        activeSession: activeSession
          ? { documentKey: activeSession.documentKey, title: activeSession.title }
          : null,
      }),
    [
      activeSession,
      favoriteDocuments,
      globalAnnotations,
      globalBookmarks,
      globalSearchQuery,
      recentDocuments,
    ],
  );
```

Add result selection:

```tsx
  const handleGlobalSearchResult = useCallback(
    (result: GlobalSearchResult) => {
      setGlobalSearchOpen(false);

      if (result.source === 'fullText' && result.query) {
        setWorkspaceOverride(null);
        setSearchText(result.query);
        activeViewerController.openSearch();
        activeViewerController.search(result.query);
        return;
      }

      if (!result.documentKey) {
        return;
      }

      const recent = recentDocuments.find(
        (document) => document.documentKey === result.documentKey,
      );

      if (result.page) {
        setPendingPageJump({ documentKey: result.documentKey, page: result.page });
      }

      if (activeSession?.documentKey === result.documentKey && result.page) {
        jumpToActiveDocumentPage(result.page);
        setPendingPageJump(null);
        return;
      }

      if (recent) {
        void reopenRecentDocument(recent);
      }
    },
    [
      activeSession,
      activeViewerController,
      jumpToActiveDocumentPage,
      recentDocuments,
      reopenRecentDocument,
    ],
  );
```

Add pending jump effect after `jumpToActiveDocumentPage` is defined:

```tsx
  useEffect(() => {
    if (!pendingPageJump || activeSession?.documentKey !== pendingPageJump.documentKey) {
      return;
    }

    jumpToActiveDocumentPage(pendingPageJump.page);
    setPendingPageJump(null);
  }, [activeSession, jumpToActiveDocumentPage, pendingPageJump]);
```

Render `GlobalSearchPanel` inside `<main>` before workspace conditionals:

```tsx
      <GlobalSearchPanel
        open={globalSearchOpen}
        query={globalSearchQuery}
        results={globalSearchResults}
        onQueryChange={setGlobalSearchQuery}
        onClose={() => setGlobalSearchOpen(false)}
        onSelectResult={handleGlobalSearchResult}
      />
```

Update the `HomeDashboard` props:

```tsx
          onOpenGlobalSearch={openGlobalSearch}
          onOpenImport={() => setWorkspaceOverride('import')}
          onOpenCompare={() => setWorkspaceOverride('compare')}
          onOpenAnnotations={() => {
            void refreshGlobalSearchCollections().catch(() => undefined);
            setWorkspaceOverride('annotations');
          }}
          onOpenBookmarks={() => {
            void refreshGlobalSearchCollections().catch(() => undefined);
            setWorkspaceOverride('bookmarks');
          }}
```

- [ ] **Step 8: Add global search styles**

In `src/app/styles.css`, add:

```css
.global-search-panel {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: grid;
  align-items: start;
  justify-items: center;
  padding: 88px 16px 16px;
  background: rgba(15, 23, 42, 0.18);
}

.global-search-card {
  width: min(720px, calc(100vw - 32px));
  max-height: min(640px, calc(100vh - 120px));
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.16);
  overflow: hidden;
}

.global-search-input-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-bottom: 1px solid var(--sr-border);
}

.global-search-input-row input {
  min-width: 0;
  flex: 1;
  height: 36px;
  border: 0;
  outline: 0;
  background: transparent;
}

.global-search-hint {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  color: var(--sr-text-muted);
  font-size: 12px;
}

.global-search-results {
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 6px;
  padding: 8px 12px 12px;
  overflow: auto;
}

.global-search-result {
  width: 100%;
  min-height: 58px;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr) auto auto;
  gap: 10px;
  justify-content: stretch;
  padding: 10px;
  text-align: left;
}

.result-icon {
  width: 28px;
  height: 28px;
  display: grid;
  place-items: center;
  border-radius: 7px;
  background: #eff6ff;
  color: var(--sr-primary);
}

.result-main {
  min-width: 0;
  display: grid;
  gap: 3px;
}

.result-main strong,
.result-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-main small,
.result-source,
.result-action {
  color: var(--sr-text-muted);
  font-size: 12px;
}
```

- [ ] **Step 9: Run Task 4 tests**

Run:

```bash
bunx vitest run src/commands/commandRegistry.test.ts src/app/App.test.tsx src/search/globalSearch.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 4**

```bash
git add src/search/GlobalSearchPanel.tsx src/commands/commandRegistry.ts src/commands/commandRegistry.test.ts src/preferences/preferencesStore.ts src/reader/hooks/useReaderCommands.ts src/app/ReaderApp.tsx src/app/App.test.tsx src/app/styles.css
git commit -m "feat: wire global search shortcut"
```

---

### Task 5: Add Shortcut Target Workspaces

**Files:**
- Create: `src/workspaces/ImportWorkspace.tsx`
- Create: `src/workspaces/CompareWorkspace.tsx`
- Create: `src/workspaces/AnnotationManagerWorkspace.tsx`
- Create: `src/workspaces/BookmarkManagerWorkspace.tsx`
- Modify: `src/app/appTypes.ts`
- Modify: `src/app/ReaderApp.tsx`
- Modify: `src/app/App.test.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Add failing workspace routing tests**

In `src/app/App.test.tsx`, add:

```tsx
  it('routes top bar shortcuts to local workspaces', () => {
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={createEmptyPersistence()}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '导入文献' }));
    expect(screen.getByLabelText('文献导入工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    fireEvent.click(screen.getByRole('button', { name: '对比阅读' }));
    expect(screen.getByLabelText('对比阅读工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    fireEvent.click(screen.getByRole('button', { name: '批注管理' }));
    expect(screen.getByLabelText('批注管理工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    expect(screen.getByLabelText('书签管理工作区')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '返回首页' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByLabelText('设置工作区')).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run test to verify failure**

Run:

```bash
bunx vitest run src/app/App.test.tsx
```

Expected: FAIL because workspace components and workspace union values are missing.

- [ ] **Step 3: Extend workspace type**

In `src/app/appTypes.ts`, replace `AppWorkspace` with:

```ts
export type AppWorkspace =
  | 'home'
  | 'reader'
  | 'settings'
  | 'tags'
  | 'import'
  | 'compare'
  | 'annotations'
  | 'bookmarks';
```

- [ ] **Step 4: Create import workspace**

Create `src/workspaces/ImportWorkspace.tsx`:

```tsx
import { FileInput, FolderOpen, Upload, X } from 'lucide-react';
import { useCallback, useRef, type ChangeEventHandler } from 'react';

type ImportWorkspaceProps = {
  onOpenPdf(): void;
  onBrowserFileChange: ChangeEventHandler<HTMLInputElement>;
  onClose(): void;
};

export function ImportWorkspace({
  onOpenPdf,
  onBrowserFileChange,
  onClose,
}: ImportWorkspaceProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openBrowserFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <section className="tool-workspace" aria-label="文献导入工作区">
      <header className="workspace-header">
        <div>
          <p>Import</p>
          <h1>导入文献</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content">
        <section className="tool-panel">
          <div className="panel-title">
            <FileInput size={18} />
            <h2>本地 PDF 导入</h2>
          </div>
          <p className="muted-copy">当前版本使用本地 PDF 打开流程导入阅读记录。</p>
          <div className="quick-actions">
            <button type="button" className="primary-action" onClick={onOpenPdf}>
              <FolderOpen size={18} />
              打开本地 PDF
            </button>
            <button type="button" className="secondary-action" onClick={openBrowserFilePicker}>
              <Upload size={18} />
              选择 PDF 文件
            </button>
            <input
              ref={fileInputRef}
              className="file-picker-input"
              aria-label="导入 PDF 文件"
              type="file"
              accept="application/pdf,.pdf"
              onChange={onBrowserFileChange}
            />
          </div>
        </section>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create compare workspace**

Create `src/workspaces/CompareWorkspace.tsx`:

```tsx
import { Columns2, X } from 'lucide-react';
import type { PersistedDocument } from '../persistence/persistenceApi';

type CompareWorkspaceProps = {
  recentDocuments: PersistedDocument[];
  onClose(): void;
  onOpenDocument(document: PersistedDocument): void | Promise<void>;
};

export function CompareWorkspace({
  recentDocuments,
  onClose,
  onOpenDocument,
}: CompareWorkspaceProps) {
  return (
    <section className="tool-workspace" aria-label="对比阅读工作区">
      <header className="workspace-header">
        <div>
          <p>Compare</p>
          <h1>对比阅读</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content two-column">
        <section className="tool-panel">
          <div className="panel-title">
            <Columns2 size={18} />
            <h2>选择第一份文档</h2>
          </div>
          <DocumentPickList documents={recentDocuments} onOpenDocument={onOpenDocument} />
        </section>
        <section className="tool-panel">
          <div className="panel-title">
            <Columns2 size={18} />
            <h2>选择第二份文档</h2>
          </div>
          <DocumentPickList documents={recentDocuments} onOpenDocument={onOpenDocument} />
        </section>
      </div>
    </section>
  );
}

function DocumentPickList({
  documents,
  onOpenDocument,
}: {
  documents: PersistedDocument[];
  onOpenDocument(document: PersistedDocument): void | Promise<void>;
}) {
  if (documents.length === 0) {
    return <p className="muted-copy">暂无最近文件。先打开 PDF 后可从这里选择。</p>;
  }

  return (
    <div className="workspace-list">
      {documents.slice(0, 8).map((document) => (
        <button
          key={document.documentKey}
          type="button"
          className="workspace-list-row"
          onClick={() => void onOpenDocument(document)}
          disabled={document.missing}
          aria-disabled={document.missing ? 'true' : undefined}
        >
          <strong>{document.displayName}</strong>
          <span>{document.path ?? '浏览器选择的本地文件'}</span>
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Create annotation manager workspace**

Create `src/workspaces/AnnotationManagerWorkspace.tsx`:

```tsx
import { Highlighter, X } from 'lucide-react';
import type { PersistedAnnotationRecord } from '../persistence/persistenceApi';

type AnnotationManagerWorkspaceProps = {
  annotations: PersistedAnnotationRecord[];
  onClose(): void;
  onOpenAnnotation(annotation: PersistedAnnotationRecord): void;
};

export function AnnotationManagerWorkspace({
  annotations,
  onClose,
  onOpenAnnotation,
}: AnnotationManagerWorkspaceProps) {
  return (
    <section className="tool-workspace" aria-label="批注管理工作区">
      <header className="workspace-header">
        <div>
          <p>Annotations</p>
          <h1>批注管理</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content">
        <section className="tool-panel">
          <div className="panel-title">
            <Highlighter size={18} />
            <h2>全部批注</h2>
          </div>
          <div className="workspace-list">
            {annotations.length > 0 ? (
              annotations.map((annotation) => (
                <button
                  key={annotation.id ?? `${annotation.documentKey}:${annotation.page}`}
                  type="button"
                  className="workspace-list-row"
                  onClick={() => onOpenAnnotation(annotation)}
                  disabled={annotation.documentMissing}
                  aria-disabled={annotation.documentMissing ? 'true' : undefined}
                >
                  <strong>{annotation.text || annotation.quote || '未命名批注'}</strong>
                  <span>
                    {annotation.documentDisplayName ?? annotation.documentKey} · 第 {annotation.page} 页
                  </span>
                </button>
              ))
            ) : (
              <p className="muted-copy">暂无批注。阅读 PDF 时新增批注后会显示在这里。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Create bookmark manager workspace**

Create `src/workspaces/BookmarkManagerWorkspace.tsx`:

```tsx
import { BookMarked, X } from 'lucide-react';
import type { PersistedBookmarkRecord } from '../persistence/persistenceApi';

type BookmarkManagerWorkspaceProps = {
  bookmarks: PersistedBookmarkRecord[];
  onClose(): void;
  onOpenBookmark(bookmark: PersistedBookmarkRecord): void;
};

export function BookmarkManagerWorkspace({
  bookmarks,
  onClose,
  onOpenBookmark,
}: BookmarkManagerWorkspaceProps) {
  return (
    <section className="tool-workspace" aria-label="书签管理工作区">
      <header className="workspace-header">
        <div>
          <p>Bookmarks</p>
          <h1>书签</h1>
        </div>
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={14} />
        </button>
      </header>
      <div className="tool-workspace-content">
        <section className="tool-panel">
          <div className="panel-title">
            <BookMarked size={18} />
            <h2>全部书签</h2>
          </div>
          <div className="workspace-list">
            {bookmarks.length > 0 ? (
              bookmarks.map((bookmark) => (
                <button
                  key={bookmark.id ?? `${bookmark.documentKey}:${bookmark.page}:${bookmark.title}`}
                  type="button"
                  className="workspace-list-row"
                  onClick={() => onOpenBookmark(bookmark)}
                  disabled={bookmark.documentMissing}
                  aria-disabled={bookmark.documentMissing ? 'true' : undefined}
                >
                  <strong>{bookmark.title}</strong>
                  <span>
                    {bookmark.documentDisplayName ?? bookmark.documentKey} · 第 {bookmark.page} 页
                  </span>
                </button>
              ))
            ) : (
              <p className="muted-copy">暂无书签。阅读 PDF 时添加书签后会显示在这里。</p>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
```

- [ ] **Step 8: Wire workspaces in `ReaderApp`**

In `src/app/ReaderApp.tsx`, add imports:

```tsx
import { AnnotationManagerWorkspace } from '../workspaces/AnnotationManagerWorkspace';
import { BookmarkManagerWorkspace } from '../workspaces/BookmarkManagerWorkspace';
import { CompareWorkspace } from '../workspaces/CompareWorkspace';
import { ImportWorkspace } from '../workspaces/ImportWorkspace';
```

Add a shared workspace close callback:

```tsx
  const closeToolWorkspace = useCallback(() => {
    setWorkspaceOverride(null);
  }, []);
```

Add a helper to open bookmark/annotation pages:

```tsx
  const openRecordPage = useCallback(
    (documentKey: string, page: number) => {
      const recent = recentDocuments.find((document) => document.documentKey === documentKey);
      setPendingPageJump({ documentKey, page });

      if (activeSession?.documentKey === documentKey) {
        jumpToActiveDocumentPage(page);
        setPendingPageJump(null);
        setWorkspaceOverride(null);
        return;
      }

      if (recent) {
        setWorkspaceOverride(null);
        void reopenRecentDocument(recent);
      }
    },
    [activeSession, jumpToActiveDocumentPage, recentDocuments, reopenRecentDocument],
  );
```

Render workspaces before the reader/home conditional blocks:

```tsx
      {activeWorkspace === 'import' ? (
        <ImportWorkspace
          onOpenPdf={openPdf}
          onBrowserFileChange={handleBrowserFileChange}
          onClose={closeToolWorkspace}
        />
      ) : null}
      {activeWorkspace === 'compare' ? (
        <CompareWorkspace
          recentDocuments={recentDocuments}
          onOpenDocument={(document) => void reopenRecentDocument(document)}
          onClose={closeToolWorkspace}
        />
      ) : null}
      {activeWorkspace === 'annotations' ? (
        <AnnotationManagerWorkspace
          annotations={globalAnnotations}
          onClose={closeToolWorkspace}
          onOpenAnnotation={(annotation) => openRecordPage(annotation.documentKey, annotation.page)}
        />
      ) : null}
      {activeWorkspace === 'bookmarks' ? (
        <BookmarkManagerWorkspace
          bookmarks={globalBookmarks}
          onClose={closeToolWorkspace}
          onOpenBookmark={(bookmark) => openRecordPage(bookmark.documentKey, bookmark.page)}
        />
      ) : null}
```

Keep settings, tags, reader, and home rendering unchanged except for the new home props from Task 4.

- [ ] **Step 9: Add workspace styles**

In `src/app/styles.css`, add:

```css
.tool-workspace {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--sr-bg);
}

.tool-workspace-content {
  min-width: 0;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 16px;
  padding: 16px;
  overflow: auto;
}

.tool-workspace-content.two-column {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  align-items: start;
}

.tool-panel {
  min-width: 0;
  display: grid;
  gap: 14px;
  padding: 16px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
}

.workspace-list {
  display: grid;
  gap: 8px;
}

.workspace-list-row {
  width: 100%;
  min-height: 58px;
  display: grid;
  justify-items: start;
  gap: 4px;
  padding: 10px;
  text-align: left;
}

.workspace-list-row strong,
.workspace-list-row span {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-list-row span {
  color: var(--sr-text-muted);
  font-size: 12px;
}
```

- [ ] **Step 10: Run Task 5 tests**

Run:

```bash
bunx vitest run src/app/App.test.tsx
```

Expected: PASS.

- [ ] **Step 11: Commit Task 5**

```bash
git add src/workspaces/ImportWorkspace.tsx src/workspaces/CompareWorkspace.tsx src/workspaces/AnnotationManagerWorkspace.tsx src/workspaces/BookmarkManagerWorkspace.tsx src/app/appTypes.ts src/app/ReaderApp.tsx src/app/App.test.tsx src/app/styles.css
git commit -m "feat: add home shortcut workspaces"
```

---

### Task 6: Final Validation And Polish

**Files:**
- Modify only files touched in Tasks 1-5 if validation exposes issues.

- [ ] **Step 1: Run typecheck**

Run:

```bash
bun run typecheck
```

Expected: PASS.

- [ ] **Step 2: Run frontend test suite**

Run:

```bash
bun run test
```

Expected: PASS.

- [ ] **Step 3: Run Rust tests because Task 1 changed Tauri persistence commands**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS. If this rewrites generated Tauri schema files, inspect `git status --short` and only include generated changes when they are directly tied to the new command registration.

- [ ] **Step 4: Run production build**

Run:

```bash
bun run build
```

Expected: PASS.

- [ ] **Step 5: Check diff hygiene**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` has no output. `git status --short` shows only files from this plan.

- [ ] **Step 6: Commit final validation fixes if any were needed**

If validation required fixes, commit only those scoped files:

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs src/persistence/persistenceApi.ts src/app/appTypes.ts src/commands/commandRegistry.ts src/commands/commandRegistry.test.ts src/preferences/preferencesStore.ts src/reader/hooks/useReaderCommands.ts src/home/HomeTopBar.tsx src/home/HomeTopBar.test.tsx src/home/HomeDashboard.tsx src/home/HomeQuickStart.tsx src/home/HomeQuickStart.test.tsx src/search/globalSearch.ts src/search/globalSearch.test.ts src/search/GlobalSearchPanel.tsx src/workspaces/ImportWorkspace.tsx src/workspaces/CompareWorkspace.tsx src/workspaces/AnnotationManagerWorkspace.tsx src/workspaces/BookmarkManagerWorkspace.tsx src/app/ReaderApp.tsx src/app/App.test.tsx src/app/styles.css
git commit -m "fix: polish home top bar integration"
```

If no validation fixes were needed, do not create an empty commit.

## Self-Review Checklist

- Spec coverage:
  - `SR-HOME-DIFF-001`: Task 3 adds `HomeTopBar` with macOS controls, icon, title, and subtitle.
  - `SR-HOME-DIFF-002`: Task 3 wires `打开文件` through existing `openPdf` and the file input fallback.
  - `SR-HOME-DIFF-003`: Task 3 adds the centered search box and `⌘K` hint.
  - `SR-HOME-DIFF-004`: Tasks 1, 2, and 4 add search over files, bookmarks, annotations, and current-document full-text.
  - `SR-HOME-DIFF-005`: Task 3 adds all right-side shortcut entries with icons and text.
  - `SR-HOME-DIFF-006`: Tasks 4 and 5 route shortcuts to local workspaces.
- Persistent unopened-PDF full-text indexing is intentionally excluded and represented honestly in `GlobalSearchPanel`.
- Existing reader open, recent sessions, favorites, settings, and tag management are preserved by using existing props and workspace routing.
- No new dependency, backend service, or migration file is planned.
- Validation includes targeted tests, full frontend checks, Rust tests, production build, and diff hygiene.
