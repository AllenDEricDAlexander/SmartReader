# Bookmark Management Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 SmartReader 当前 App Shell 内的“书签管理”升级为真实持久化驱动的完整工作台，支持独立备注、分组、搜索、筛选、排序、分页、详情、编辑、复制引用、单条删除和可报告部分失败的批量删除。

**Architecture:** SQLite 只新增 `bookmarks.note`；Rust 继续复用既有书签写入/删除能力，并以一个只读 `load_bookmark_dashboard` Facade 返回按文档聚合的 Dashboard DTO。`ReaderApp` 持有唯一 dashboard 状态，全局搜索从它派生；React 书签工作台使用纯函数管线和本地 UI hook 管理搜索、筛选、排序、分页、选中和批量模式，首页入口与旧独立入口复用同一个核心内容组件。

**Tech Stack:** Tauri 2、Rust、rusqlite、SQLite migration、React 18、TypeScript 6、Lucide React、Vitest、Testing Library、Vite、现有 `src/app/styles.css` 与 CSS tokens。

**Approved Design:** `docs/superpowers/specs/2026-07-20-bookmark-management-workspace-design.md`

## Global Constraints

- 执行 Task 1 前必须先使用 `superpowers:using-git-worktrees` 创建隔离 worktree。当前 `/Users/mario/SelfProject/SmartReader` 的 `main` 有已 staged 的 `docs/img.png` 和多处未提交阅读器 UI 改动；不得把这些改动复制、清理、覆盖或带入书签提交。
- 每个任务只 stage 该任务列出的路径；每个提交前运行该任务验证步骤中列出的精确 `git diff --check` 命令和目标测试。
- 只新增 `src-tauri/src/migrations/006_bookmark_management.sql` 一个 migration；不得修改、重命名、格式化或重排 `001` 至 `005`。
- 只新增 `load_bookmark_dashboard` 一个 Tauri command；不增加批量删除 command，不改变 `delete_bookmark` SQL 语义。
- `title` 继续是必填名称；`note` 是独立的 `string | null` / `Option<String>`。空白备注在写入边界归一化为 `NULL`。
- 页面只使用真实 persistence 数据；不得加入 mock 业务数据、临时演示数组、缩略图生成、章节推断、书签类型、作者/年份字段或新依赖。
- 不修改 PDF 渲染、打开和页码跳转核心；打开文档与跳转书签必须继续走现有 `openRecordPage`。
- 设计模式只采用现有项目可承受的轻量 Facade + Dashboard DTO，以及无状态纯函数派生。Strategy、Factory、Repository、Command Pattern 或新状态管理层都不会降低当前复杂度，因此不引入。
- 所有新 CSS 使用 `bookmark-management-*` 前缀并复用现有 `--sr-*` tokens；不开发暗色主题，不影响最近文件、收藏、标签或阅读器选择器。
- 不运行 `bun run dev`、`bun run tauri` 或任何自动启动命令。项目没有 lint script，完成时必须如实记录“未配置可执行的 lint 命令”。
- 每个任务完成后提交一次。提交失败或测试失败时先修复当前任务，不把失败留给后续任务。

---

## Contract Map

### Rust / Tauri dashboard contract

```text
BookmarkDashboard
├── totalBookmarks: i64
└── groups: BookmarkDashboardGroup[]
    ├── document: BookmarkDashboardDocument
    │   ├── documentKey: String
    │   ├── displayName: String
    │   ├── path: Option<String>
    │   ├── missing: bool
    │   ├── fileSize: Option<i64>
    │   └── pageCount: Option<i64>
    ├── bookmarkCount: i64
    └── bookmarks: PersistedBookmark[]
        ├── id: Option<i64>
        ├── documentKey: String
        ├── page: i64
        ├── title: String
        ├── note: Option<String>
        ├── createdAt: String
        └── updatedAt: String
```

### Frontend mutation contract

```ts
export type BookmarkUpdateInput = {
  title: string;
  note: string | null;
};

export type BookmarkDeleteResult = {
  succeededIds: number[];
  failedIds: number[];
};
```

`BookmarkManagementContent` 不直接调用 Tauri。它接收：

```ts
type BookmarkManagementContentProps = {
  dashboard: BookmarkDashboard | null;
  loading: boolean;
  error: string | null;
  canOpenBookmark(bookmark: BookmarkManagementRecord): boolean;
  onOpenPdf(): void | Promise<unknown>;
  onOpenBookmark(bookmark: BookmarkManagementRecord): void | Promise<void>;
  onUpdateBookmark(
    bookmark: BookmarkManagementRecord,
    updates: BookmarkUpdateInput,
  ): Promise<void>;
  onDeleteBookmarks(bookmarks: BookmarkManagementRecord[]): Promise<BookmarkDeleteResult>;
  onRefresh(): void | Promise<void>;
};
```

---

### Task 1: Add the Bookmark Note Migration and Rust Round-Trip

**Files:**
- Create: `src-tauri/src/migrations/006_bookmark_management.sql`
- Modify: `src-tauri/src/db.rs:8-29`
- Modify: `src-tauri/src/db.rs:106-129`
- Modify: `src-tauri/src/db.rs:1024-1119`
- Modify: `src-tauri/src/db.rs:1929-2070`
- Modify: `src-tauri/src/db.rs:2509-2550`

- [ ] **Step 1: Write a failing migration and persistence test**

Add these tests inside the existing `#[cfg(test)] mod tests` in `src-tauri/src/db.rs`:

```rust
    #[test]
    fn migrates_bookmark_note_and_accepts_legacy_payloads() {
        let connection = migrated_test_connection();

        let note_column_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM pragma_table_info('bookmarks') WHERE name = 'note'",
                [],
                |row| row.get(0),
            )
            .expect("bookmark note column");
        let legacy: PersistedBookmark = serde_json::from_value(serde_json::json!({
            "id": null,
            "documentKey": "desktop:/tmp/legacy.pdf",
            "page": 2,
            "title": "Legacy bookmark",
            "createdAt": "2026-07-20T00:00:00Z",
            "updatedAt": "2026-07-20T00:00:00Z"
        }))
        .expect("legacy payload without note");
        let saved_legacy =
            upsert_bookmark(&connection, legacy).expect("save legacy payload without note");
        connection
            .execute(
                r#"
                INSERT INTO bookmarks (document_key, page, title, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                "#,
                rusqlite::params![
                    "desktop:/tmp/historical.pdf",
                    4,
                    "Historical bookmark",
                    "2026-07-19T00:00:00Z",
                    "2026-07-19T00:00:00Z",
                ],
            )
            .expect("historical row without note");
        let historical_note: Option<String> = connection
            .query_row(
                "SELECT note FROM bookmarks WHERE document_key = ?1",
                ["desktop:/tmp/historical.pdf"],
                |row| row.get(0),
            )
            .expect("historical note");

        assert_eq!(note_column_count, 1);
        assert_eq!(saved_legacy.note, None);
        assert_eq!(historical_note, None);
    }

    #[test]
    fn saves_loads_and_clears_bookmark_note() {
        let connection = migrated_test_connection();
        let saved = upsert_bookmark(
            &connection,
            PersistedBookmark {
                id: None,
                document_key: "desktop:/tmp/noted.pdf".to_string(),
                page: 8,
                title: "Core result".to_string(),
                note: Some("  Compare with section 3  ".to_string()),
                created_at: "2026-07-20T00:00:00Z".to_string(),
                updated_at: "2026-07-20T00:00:00Z".to_string(),
            },
        )
        .expect("save noted bookmark");

        assert_eq!(saved.note.as_deref(), Some("Compare with section 3"));
        let loaded = list_bookmarks_for_document(&connection, "desktop:/tmp/noted.pdf")
            .expect("load noted bookmark");
        assert_eq!(loaded[0].note.as_deref(), Some("Compare with section 3"));

        let cleared = upsert_bookmark(
            &connection,
            PersistedBookmark {
                note: Some("   ".to_string()),
                updated_at: "2026-07-20T01:00:00Z".to_string(),
                ..saved
            },
        )
        .expect("clear bookmark note");
        let stored_note: Option<String> = connection
            .query_row(
                "SELECT note FROM bookmarks WHERE id = ?1",
                [cleared.id.expect("persisted id")],
                |row| row.get(0),
            )
            .expect("stored note");

        assert_eq!(cleared.note, None);
        assert_eq!(stored_note, None);
    }
```

- [ ] **Step 2: Run the tests and verify the intended failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml bookmark_note
```

Expected before implementation: compilation fails because `PersistedBookmark` has no `note`, or the schema assertion fails because migration `006` is absent.

- [ ] **Step 3: Add exactly one migration**

Create `src-tauri/src/migrations/006_bookmark_management.sql` with exactly:

```sql
ALTER TABLE bookmarks ADD COLUMN note TEXT;
```

Append this entry after `005_recent_file_management` in `MIGRATIONS`:

```rust
    Migration {
        version: "006_bookmark_management",
        sql: include_str!("migrations/006_bookmark_management.sql"),
    },
```

- [ ] **Step 4: Extend both Rust bookmark records**

Replace the two bookmark structs with:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBookmark {
    pub id: Option<i64>,
    pub document_key: String,
    pub page: i64,
    pub title: String,
    #[serde(default)]
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedBookmarkRecord {
    pub id: Option<i64>,
    pub document_key: String,
    pub document_display_name: Option<String>,
    pub document_path: Option<String>,
    pub document_missing: bool,
    pub page: i64,
    pub title: String,
    #[serde(default)]
    pub note: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}
```

- [ ] **Step 5: Normalize, save, and read `note` in existing SQL**

Add the helper immediately before `upsert_bookmark`:

```rust
fn normalize_bookmark_note(note: Option<String>) -> Option<String> {
    note.map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
```

Replace the three bookmark SQL helpers with:

```rust
pub fn upsert_bookmark(
    connection: &Connection,
    mut bookmark: PersistedBookmark,
) -> Result<PersistedBookmark, DbError> {
    bookmark.note = normalize_bookmark_note(bookmark.note.take());

    if let Some(id) = bookmark.id {
        connection.execute(
            r#"
            UPDATE bookmarks
            SET document_key = ?1, page = ?2, title = ?3, note = ?4,
                created_at = ?5, updated_at = ?6
            WHERE id = ?7
            "#,
            params![
                bookmark.document_key,
                bookmark.page,
                bookmark.title,
                bookmark.note,
                bookmark.created_at,
                bookmark.updated_at,
                id,
            ],
        )?;
        return Ok(bookmark);
    }

    connection.execute(
        r#"
        INSERT INTO bookmarks (document_key, page, title, note, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6)
        "#,
        params![
            bookmark.document_key,
            bookmark.page,
            bookmark.title,
            bookmark.note,
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
        SELECT id, document_key, page, title, note, created_at, updated_at
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
            note: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn list_all_bookmark_records_tx(
    connection: &Connection,
) -> Result<Vec<PersistedBookmarkRecord>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT b.id, b.document_key, d.display_name, d.path, COALESCE(d.missing, 1),
               b.page, b.title, b.note, b.created_at, b.updated_at
        FROM bookmarks b
        LEFT JOIN documents d ON d.document_key = b.document_key
        ORDER BY COALESCE(d.display_name, b.document_key) COLLATE NOCASE ASC,
                 b.page ASC, b.title ASC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PersistedBookmarkRecord {
            id: Some(row.get(0)?),
            document_key: row.get(1)?,
            document_display_name: row.get(2)?,
            document_path: row.get(3)?,
            document_missing: row.get::<_, i64>(4)? != 0,
            page: row.get(5)?,
            title: row.get(6)?,
            note: row.get(7)?,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}
```

- [ ] **Step 6: Update the existing Rust bookmark fixture**

In `lists_all_bookmarks_with_document_metadata`, add:

```rust
                note: Some("Read again".to_string()),
```

immediately after `title`, then add:

```rust
        assert_eq!(records[0].note.as_deref(), Some("Read again"));
```

- [ ] **Step 7: Run focused and full Rust checks**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml bookmark_note
cargo test --manifest-path src-tauri/Cargo.toml lists_all_bookmarks_with_document_metadata
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
git diff --check -- src-tauri/src/db.rs src-tauri/src/migrations/006_bookmark_management.sql
```

Expected: all tests pass, formatting is clean, and only migration `006` is new.

- [ ] **Step 8: Commit Task 1**

```bash
git add src-tauri/src/db.rs src-tauri/src/migrations/006_bookmark_management.sql
git commit -m "feat: persist bookmark notes"
```

---

### Task 2: Add the Bookmark Dashboard Facade and Tauri Command

**Files:**
- Modify: `src-tauri/src/db.rs:117-129`
- Modify: `src-tauri/src/db.rs:510-540`
- Modify: `src-tauri/src/db.rs:1092-1119`
- Modify: `src-tauri/src/db.rs:2509-2550`
- Modify: `src-tauri/src/lib.rs:35-67`

- [ ] **Step 1: Write a failing dashboard aggregation test**

Add this test near `lists_all_bookmarks_with_document_metadata`:

```rust
    #[test]
    fn loads_bookmark_dashboard_with_document_groups_and_orphans() {
        let connection = migrated_test_connection();
        let document = PersistedDocument {
            document_key: "desktop:/tmp/dashboard.pdf".to_string(),
            path: Some("/tmp/dashboard.pdf".to_string()),
            display_name: "Dashboard.pdf".to_string(),
            file_size: Some(4096),
            modified_at: Some("2026-07-20T00:00:00Z".to_string()),
            page_count: Some(80),
            last_page: 1,
            progress: 0.0,
            missing: false,
            last_opened_at: None,
            tag_ids: Vec::new(),
        };
        upsert_document(&connection, &document).expect("document");

        for (page, title, note) in [
            (8, "Architecture", Some("Facade boundary".to_string())),
            (24, "Evaluation", None),
        ] {
            upsert_bookmark(
                &connection,
                PersistedBookmark {
                    id: None,
                    document_key: document.document_key.clone(),
                    page,
                    title: title.to_string(),
                    note,
                    created_at: format!("2026-07-20T00:{page:02}:00Z"),
                    updated_at: format!("2026-07-20T00:{page:02}:00Z"),
                },
            )
            .expect("document bookmark");
        }
        upsert_bookmark(
            &connection,
            PersistedBookmark {
                id: None,
                document_key: "desktop:/tmp/orphan.pdf".to_string(),
                page: 3,
                title: "Orphan".to_string(),
                note: None,
                created_at: "2026-07-20T01:00:00Z".to_string(),
                updated_at: "2026-07-20T01:00:00Z".to_string(),
            },
        )
        .expect("orphan bookmark");

        let dashboard = load_bookmark_dashboard_tx(&connection).expect("bookmark dashboard");
        let document_group = dashboard
            .groups
            .iter()
            .find(|group| group.document.document_key == document.document_key)
            .expect("document group");
        let orphan_group = dashboard
            .groups
            .iter()
            .find(|group| group.document.document_key == "desktop:/tmp/orphan.pdf")
            .expect("orphan group");

        assert_eq!(dashboard.total_bookmarks, 3);
        assert_eq!(document_group.bookmark_count, 2);
        assert_eq!(document_group.document.display_name, "Dashboard.pdf");
        assert_eq!(document_group.document.file_size, Some(4096));
        assert_eq!(document_group.document.page_count, Some(80));
        assert_eq!(
            document_group.bookmarks[0].note.as_deref(),
            Some("Facade boundary")
        );
        assert!(orphan_group.document.missing);
        assert_eq!(
            orphan_group.document.display_name,
            "desktop:/tmp/orphan.pdf"
        );
        assert_eq!(orphan_group.document.path, None);
        assert_eq!(orphan_group.document.file_size, None);
        assert_eq!(orphan_group.document.page_count, None);
    }
```

- [ ] **Step 2: Run the test and verify the intended failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml loads_bookmark_dashboard_with_document_groups_and_orphans
```

Expected: compilation fails because the dashboard DTO and loader do not exist.

- [ ] **Step 3: Add the dashboard DTOs**

Add these structs immediately after `PersistedBookmarkRecord`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDashboard {
    pub total_bookmarks: i64,
    pub groups: Vec<BookmarkDashboardGroup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDashboardGroup {
    pub document: BookmarkDashboardDocument,
    pub bookmark_count: i64,
    pub bookmarks: Vec<PersistedBookmark>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkDashboardDocument {
    pub document_key: String,
    pub display_name: String,
    pub path: Option<String>,
    pub missing: bool,
    pub file_size: Option<i64>,
    pub page_count: Option<i64>,
}
```

- [ ] **Step 4: Implement the read-only dashboard query**

Add this function after `list_all_bookmark_records_tx`:

```rust
pub fn load_bookmark_dashboard_tx(
    connection: &Connection,
) -> Result<BookmarkDashboard, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT b.id, b.document_key, b.page, b.title, b.note, b.created_at, b.updated_at,
               COALESCE(d.display_name, b.document_key),
               d.path,
               CASE WHEN d.document_key IS NULL OR d.missing != 0 THEN 1 ELSE 0 END,
               d.file_size,
               d.page_count
        FROM bookmarks b
        LEFT JOIN documents d ON d.document_key = b.document_key
        ORDER BY COALESCE(d.display_name, b.document_key) COLLATE NOCASE ASC,
                 b.document_key ASC,
                 b.page ASC,
                 b.title COLLATE NOCASE ASC,
                 b.id ASC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        let document_key: String = row.get(1)?;
        Ok((
            BookmarkDashboardDocument {
                document_key: document_key.clone(),
                display_name: row.get(7)?,
                path: row.get(8)?,
                missing: row.get::<_, i64>(9)? != 0,
                file_size: row.get(10)?,
                page_count: row.get(11)?,
            },
            PersistedBookmark {
                id: Some(row.get(0)?),
                document_key,
                page: row.get(2)?,
                title: row.get(3)?,
                note: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            },
        ))
    })?;

    let mut groups: Vec<BookmarkDashboardGroup> = Vec::new();
    for row in rows {
        let (document, bookmark) = row?;
        if let Some(group) = groups
            .last_mut()
            .filter(|group| group.document.document_key == document.document_key)
        {
            group.bookmarks.push(bookmark);
            group.bookmark_count += 1;
        } else {
            groups.push(BookmarkDashboardGroup {
                document,
                bookmark_count: 1,
                bookmarks: vec![bookmark],
            });
        }
    }

    Ok(BookmarkDashboard {
        total_bookmarks: groups.iter().map(|group| group.bookmark_count).sum(),
        groups,
    })
}
```

- [ ] **Step 5: Expose and register the command**

Add the command after `list_all_bookmarks`:

```rust
#[tauri::command]
pub fn load_bookmark_dashboard(
    state: State<'_, DatabaseState>,
) -> Result<BookmarkDashboard, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    load_bookmark_dashboard_tx(&connection)
}
```

Add `db::load_bookmark_dashboard` in `src-tauri/src/lib.rs` immediately after `db::list_all_bookmarks`:

```rust
            db::list_all_bookmarks,
            db::load_bookmark_dashboard,
            db::delete_bookmark,
```

- [ ] **Step 6: Run focused Rust verification**

```bash
cargo test --manifest-path src-tauri/Cargo.toml loads_bookmark_dashboard_with_document_groups_and_orphans
cargo test --manifest-path src-tauri/Cargo.toml lists_all_bookmarks_with_document_metadata
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check -- src-tauri/src/db.rs src-tauri/src/lib.rs
```

Expected: the dashboard test passes, existing list-all behavior still passes, and handler registration compiles.

- [ ] **Step 7: Commit Task 2**

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: expose bookmark dashboard"
```

---

### Task 3: Add Frontend Bookmark/Dashboard Contracts and Note-Aware Global Search

**Files:**
- Modify: `src/persistence/persistenceApi.ts:42-55`
- Modify: `src/persistence/persistenceApi.ts:91-109`
- Modify: `src/persistence/persistenceApi.ts:148-159`
- Modify: `src/persistence/persistenceApi.test.ts:74-114`
- Modify: `src/annotations/annotationModels.ts:9-16`
- Modify: `src/search/globalSearch.ts:119-143`
- Modify: `src/search/globalSearch.test.ts:1-126`
- Modify fixtures: `src/reader/hooks/useReaderDecorations.test.tsx`
- Modify fixtures: `src/reader/annotations/BookmarkActions.test.tsx`
- Modify fixtures: `src/home/HomeDashboard.test.tsx`
- Modify fixtures: `src/app/App.test.tsx`

- [ ] **Step 1: Write failing persistence and search tests**

In `src/persistence/persistenceApi.test.ts`, add `note: null` to the existing save payload and add:

```ts
  it('loads the bookmark dashboard and forwards nullable notes', async () => {
    const dashboard = {
      totalBookmarks: 1,
      groups: [
        {
          document: {
            documentKey: 'desktop:/tmp/book.pdf',
            displayName: 'book.pdf',
            path: '/tmp/book.pdf',
            missing: false,
            fileSize: 4096,
            pageCount: 20,
          },
          bookmarkCount: 1,
          bookmarks: [
            {
              id: 7,
              documentKey: 'desktop:/tmp/book.pdf',
              page: 3,
              title: 'Method',
              note: null,
              createdAt: '2026-07-20T00:00:00Z',
              updatedAt: '2026-07-20T00:00:00Z',
            },
          ],
        },
      ],
    };
    const invoke = vi.fn().mockResolvedValue(dashboard);
    const api = createPersistenceApi(invoke);

    await expect(api.loadBookmarkDashboard()).resolves.toEqual(dashboard);
    expect(invoke).toHaveBeenCalledWith('load_bookmark_dashboard');
  });
```

Tighten the existing bookmark invoke assertion so it proves nullable-note
forwarding while retaining the existing delete-command assertion:

```ts
    expect(invoke).toHaveBeenCalledWith('save_bookmark', {
      bookmark: expect.objectContaining({ note: null }),
    });
    expect(invoke).toHaveBeenCalledWith('delete_bookmark', { id: 8 });
```

Change the bookmark fixture in `src/search/globalSearch.test.ts` to include:

```ts
  note: 'Encoder-decoder dependency',
```

Then add:

```ts
  it('matches bookmark notes in global search', () => {
    const results = buildGlobalSearchResults({
      query: 'encoder-decoder',
      recentDocuments: [],
      favoriteDocuments: [],
      bookmarks: [bookmark],
      annotations: [],
      activeSession: null,
    });

    expect(results).toEqual([
      expect.objectContaining({
        id: 'bookmark:1',
        source: 'bookmark',
        title: 'Transformer overview',
      }),
    ]);
  });
```

- [ ] **Step 2: Run focused tests and verify failure**

```bash
bun run test src/persistence/persistenceApi.test.ts src/search/globalSearch.test.ts
```

Expected: TypeScript fails because `loadBookmarkDashboard` and `note` are not in the contracts, or the note query returns no bookmark.

- [ ] **Step 3: Define the exact TypeScript contracts**

Replace the bookmark types and add dashboard types in `src/persistence/persistenceApi.ts`:

```ts
export type PersistedBookmark = {
  id: number | null;
  documentKey: string;
  page: number;
  title: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PersistedBookmarkRecord = PersistedBookmark & {
  documentDisplayName: string | null;
  documentPath: string | null;
  documentMissing: boolean;
};

export type BookmarkDashboardDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  missing: boolean;
  fileSize: number | null;
  pageCount: number | null;
};

export type BookmarkDashboardGroup = {
  document: BookmarkDashboardDocument;
  bookmarkCount: number;
  bookmarks: PersistedBookmark[];
};

export type BookmarkDashboard = {
  totalBookmarks: number;
  groups: BookmarkDashboardGroup[];
};
```

Add this method to `CorePersistenceApi`:

```ts
  loadBookmarkDashboard(): Promise<BookmarkDashboard>;
```

Add this implementation immediately after `listAllBookmarks`:

```ts
    loadBookmarkDashboard() {
      return invoke<BookmarkDashboard>('load_bookmark_dashboard');
    },
```

- [ ] **Step 4: Extend the shared reader bookmark model**

Replace `Bookmark` in `src/annotations/annotationModels.ts` with:

```ts
export type Bookmark = {
  id: number | null;
  documentKey: string;
  page: number;
  title: string;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};
```

- [ ] **Step 5: Make global search note-aware**

Use this exact match list in `buildBookmarkResults`:

```ts
      matchesAny(normalizedQuery, [
        bookmark.title,
        bookmark.note ?? '',
        bookmark.documentDisplayName ?? '',
        bookmark.documentPath ?? '',
      ]),
```

- [ ] **Step 6: Update every typed bookmark fixture**

Add `note: null` immediately after `title` in:

- `src/reader/hooks/useReaderDecorations.test.tsx` constant `bookmark`
- `src/reader/annotations/BookmarkActions.test.tsx` constant `bookmark`
- `src/home/HomeDashboard.test.tsx` bookmark literal in the current bookmark workspace test
- all four `PersistedBookmarkRecord` literals in `src/app/App.test.tsx`

Keep the global-search fixture’s non-null value from Step 1. Also add this default method to `createEmptyPersistence()` in `src/app/App.test.tsx`:

```ts
    loadBookmarkDashboard: vi.fn().mockResolvedValue({
      totalBookmarks: 0,
      groups: [],
    }),
```

- [ ] **Step 7: Run focused tests and typecheck**

```bash
bun run test src/persistence/persistenceApi.test.ts src/search/globalSearch.test.ts src/reader/annotations/BookmarkActions.test.tsx
bun run typecheck
git diff --check -- src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src/annotations/annotationModels.ts src/search/globalSearch.ts src/search/globalSearch.test.ts src/reader/hooks/useReaderDecorations.test.tsx src/reader/annotations/BookmarkActions.test.tsx src/home/HomeDashboard.test.tsx src/app/App.test.tsx
```

Expected: invoke wiring, nullable note forwarding, note search, and all typed fixtures pass.

- [ ] **Step 8: Commit Task 3**

```bash
git add src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src/annotations/annotationModels.ts src/search/globalSearch.ts src/search/globalSearch.test.ts src/reader/hooks/useReaderDecorations.test.tsx src/reader/annotations/BookmarkActions.test.tsx src/home/HomeDashboard.test.tsx src/app/App.test.tsx
git commit -m "feat: add bookmark dashboard contracts"
```

---

### Task 4: Generalize Reader Bookmark Updates for Name and Note

**Files:**
- Modify: `src/reader/hooks/useReaderDecorations.ts:58-116`
- Modify: `src/reader/hooks/useReaderDecorations.ts:272-285`
- Modify: `src/reader/hooks/useReaderDecorations.test.tsx:41-110`

- [ ] **Step 1: Replace the rename-only test with failing update coverage**

Keep the deletion assertions and add these two tests:

```ts
  it('persists a normalized title and note before updating loaded local state', async () => {
    const persistence = {
      listBookmarks: vi.fn().mockResolvedValue([bookmark]),
      listAnnotations: vi.fn().mockResolvedValue([]),
      saveBookmark: vi
        .fn()
        .mockImplementation(async (savedBookmark: Bookmark) => savedBookmark),
    } as unknown as PersistenceApi;
    const { result } = renderHook(() =>
      useReaderDecorations({
        activeSession,
        persistence,
      }),
    );

    await act(async () => {
      await result.current.loadDocumentDecorations(bookmark.documentKey);
      await result.current.updateBookmarkForDocument(bookmark.documentKey, bookmark, {
        title: '  核心结论  ',
        note: '  对照第 3 节  ',
      });
    });

    expect(persistence.saveBookmark).toHaveBeenCalledWith(
      expect.objectContaining({
        id: bookmark.id,
        title: '核心结论',
        note: '对照第 3 节',
      }),
    );
    expect(result.current.bookmarksByDocument[bookmark.documentKey][0]).toMatchObject({
      title: '核心结论',
      note: '对照第 3 节',
    });
  });

  it('keeps the loaded bookmark unchanged when an update fails', async () => {
    const persistence = {
      listBookmarks: vi.fn().mockResolvedValue([bookmark]),
      listAnnotations: vi.fn().mockResolvedValue([]),
      saveBookmark: vi.fn().mockRejectedValue(new Error('write failed')),
    } as unknown as PersistenceApi;
    const { result } = renderHook(() =>
      useReaderDecorations({
        activeSession,
        persistence,
      }),
    );

    await act(async () => {
      await result.current.loadDocumentDecorations(bookmark.documentKey);
    });
    await expect(
      act(async () => {
        await result.current.updateBookmarkForDocument(bookmark.documentKey, bookmark, {
          title: 'Changed',
          note: 'Changed note',
        });
      }),
    ).rejects.toThrow('write failed');

    expect(result.current.bookmarksByDocument[bookmark.documentKey]).toEqual([bookmark]);
  });
```

- [ ] **Step 2: Run the hook test and verify failure**

```bash
bun run test src/reader/hooks/useReaderDecorations.test.tsx
```

Expected: `updateBookmarkForDocument` does not exist.

- [ ] **Step 3: Add `note: null` to new bookmarks**

Change the save payload in `addBookmarkForActivePage` to:

```ts
    const saved = await persistence.saveBookmark({
      id: null,
      documentKey: activeSession.documentKey,
      page: activeSession.page,
      title: `Page ${activeSession.page}`,
      note: null,
      createdAt: now,
      updatedAt: now,
    });
```

- [ ] **Step 4: Add the general update method and keep rename as a delegate**

Replace `renameBookmarkForDocument` with:

```ts
  const updateBookmarkForDocument = useCallback(
    async (
      documentKey: string,
      bookmark: Bookmark,
      updates: Pick<Bookmark, 'title' | 'note'>,
    ) => {
      if (bookmark.id === null) {
        return undefined;
      }

      const normalizedTitle = updates.title.trim();
      const normalizedNote = updates.note?.trim() || null;

      if (!normalizedTitle) {
        return bookmark;
      }

      if (normalizedTitle === bookmark.title && normalizedNote === bookmark.note) {
        return bookmark;
      }

      const saved = await persistence.saveBookmark({
        ...bookmark,
        title: normalizedTitle,
        note: normalizedNote,
        updatedAt: new Date().toISOString(),
      });

      setBookmarksByDocument((current) => {
        const bookmarks = current[documentKey];
        if (!bookmarks) {
          return current;
        }

        return {
          ...current,
          [documentKey]: addOrReplaceBookmark(bookmarks, saved),
        };
      });

      return saved;
    },
    [persistence],
  );

  const renameBookmarkForDocument = useCallback(
    (documentKey: string, bookmark: Bookmark, title: string) =>
      updateBookmarkForDocument(documentKey, bookmark, {
        title,
        note: bookmark.note,
      }),
    [updateBookmarkForDocument],
  );
```

Expose `updateBookmarkForDocument` in the returned object:

```ts
    toggleAnnotationTagForDocument,
    updateAnnotationForDocument,
    updateBookmarkForDocument,
```

- [ ] **Step 5: Run hook and compatibility tests**

```bash
bun run test src/reader/hooks/useReaderDecorations.test.tsx src/reader/annotations/BookmarkActions.test.tsx
bun run typecheck
git diff --check -- src/reader/hooks/useReaderDecorations.ts src/reader/hooks/useReaderDecorations.test.tsx
```

Expected: name+note update is persistence-first, failed writes keep local state, and the old inline rename component still works.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/reader/hooks/useReaderDecorations.ts src/reader/hooks/useReaderDecorations.test.tsx
git commit -m "feat: update bookmark names and notes"
```

---

### Task 5: Build the Pure Bookmark Management View-Model Pipeline

**Files:**
- Create: `src/home/bookmarkManagementUtils.ts`
- Create: `src/home/bookmarkManagementUtils.test.ts`

- [ ] **Step 1: Write the failing pure-function test file**

Create `src/home/bookmarkManagementUtils.test.ts` with a typed dashboard fixture and the required behavior:

```ts
import { describe, expect, it } from 'vitest';
import type { BookmarkDashboard } from '../persistence/persistenceApi';
import {
  buildBookmarkReference,
  deriveBookmarkPage,
  findAdjacentBookmarks,
  findBookmarkPage,
  findSelectionAfterDelete,
  flattenBookmarkDashboard,
  formatBookmarkFileSize,
  formatBookmarkPageProgress,
} from './bookmarkManagementUtils';

const dashboard: BookmarkDashboard = {
  totalBookmarks: 4,
  groups: [
    {
      document: {
        documentKey: 'desktop:/papers/b.pdf',
        displayName: 'Beta.pdf',
        path: '/papers/b.pdf',
        missing: false,
        fileSize: 2_048,
        pageCount: 100,
      },
      bookmarkCount: 3,
      bookmarks: [
        {
          id: 3,
          documentKey: 'desktop:/papers/b.pdf',
          page: 30,
          title: 'Third',
          note: null,
          createdAt: '2026-07-01T08:00:00+08:00',
          updatedAt: '2026-07-01T08:00:00+08:00',
        },
        {
          id: 1,
          documentKey: 'desktop:/papers/b.pdf',
          page: 10,
          title: 'First',
          note: 'Encoder dependency',
          createdAt: '2026-07-20T09:00:00+08:00',
          updatedAt: '2026-07-20T09:00:00+08:00',
        },
        {
          id: 2,
          documentKey: 'desktop:/papers/b.pdf',
          page: 20,
          title: 'Second',
          note: 'Recent result',
          createdAt: '2026-07-15T09:00:00+08:00',
          updatedAt: '2026-07-15T09:00:00+08:00',
        },
      ],
    },
    {
      document: {
        documentKey: 'desktop:/papers/a.pdf',
        displayName: 'Alpha.pdf',
        path: '/papers/a.pdf',
        missing: true,
        fileSize: null,
        pageCount: null,
      },
      bookmarkCount: 1,
      bookmarks: [
        {
          id: 4,
          documentKey: 'desktop:/papers/a.pdf',
          page: 5,
          title: 'Alpha note',
          note: null,
          createdAt: 'invalid-date',
          updatedAt: '2026-07-01T08:00:00+08:00',
        },
      ],
    },
  ],
};

describe('bookmarkManagementUtils', () => {
  it('flattens dashboard metadata without mutating source groups', () => {
    const records = flattenBookmarkDashboard(dashboard);

    expect(records).toHaveLength(4);
    expect(records.find((record) => record.id === 1)).toMatchObject({
      documentDisplayName: 'Beta.pdf',
      documentPath: '/papers/b.pdf',
      documentMissing: false,
      documentFileSize: 2_048,
      documentPageCount: 100,
      documentBookmarkCount: 3,
    });
    expect(dashboard.groups[0].bookmarks.map((bookmark) => bookmark.id)).toEqual([3, 1, 2]);
  });

  it('searches title, note, document name, and path case-insensitively', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const base = {
      documentKey: 'all',
      dateFilter: 'all' as const,
      sortMode: 'createdDesc' as const,
      page: 1,
      pageSize: 20 as const,
      now: new Date('2026-07-20T12:00:00+08:00'),
    };

    expect(deriveBookmarkPage(records, { ...base, query: 'encoder' }).totalBookmarks).toBe(1);
    expect(deriveBookmarkPage(records, { ...base, query: 'ALPHA' }).totalBookmarks).toBe(1);
    expect(deriveBookmarkPage(records, { ...base, query: '/papers/b' }).totalBookmarks).toBe(3);
    expect(deriveBookmarkPage(records, { ...base, query: '' }).totalBookmarks).toBe(4);
  });

  it('filters by document and local calendar date ranges', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const base = {
      query: '',
      documentKey: 'all',
      sortMode: 'createdDesc' as const,
      page: 1,
      pageSize: 20 as const,
      now: new Date('2026-07-20T12:00:00+08:00'),
    };

    expect(
      deriveBookmarkPage(records, {
        ...base,
        documentKey: 'desktop:/papers/b.pdf',
        dateFilter: 'all',
      }).totalBookmarks,
    ).toBe(3);
    expect(deriveBookmarkPage(records, { ...base, dateFilter: 'today' }).visibleBookmarks.map(
      (record) => record.id,
    )).toEqual([1]);
    expect(deriveBookmarkPage(records, { ...base, dateFilter: '7days' }).visibleBookmarks.map(
      (record) => record.id,
    )).toEqual([1, 2]);
    expect(deriveBookmarkPage(records, { ...base, dateFilter: '30days' }).visibleBookmarks.map(
      (record) => record.id,
    )).toEqual([1, 2, 3]);
  });

  it('sorts groups by document name and records inside each group', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const base = {
      query: '',
      documentKey: 'all',
      dateFilter: 'all' as const,
      page: 1,
      pageSize: 20 as const,
      now: new Date('2026-07-20T12:00:00+08:00'),
    };

    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'pageAsc' }).groups.map(
        (group) => group.document.displayName,
      ),
    ).toEqual(['Alpha.pdf', 'Beta.pdf']);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'pageAsc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([1, 2, 3]);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'pageDesc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([3, 2, 1]);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'createdAsc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([3, 2, 1]);
    expect(
      deriveBookmarkPage(records, { ...base, sortMode: 'createdDesc' }).groups[1].bookmarks.map(
        (record) => record.id,
      ),
    ).toEqual([1, 2, 3]);
  });

  it('paginates bookmark records and keeps full document counts on split groups', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const page = deriveBookmarkPage(records, {
      query: '',
      documentKey: 'desktop:/papers/b.pdf',
      dateFilter: 'all',
      sortMode: 'pageAsc',
      page: 2,
      pageSize: 2,
      now: new Date('2026-07-20T12:00:00+08:00'),
    });

    expect(page.page).toBe(2);
    expect(page.pageCount).toBe(2);
    expect(page.visibleBookmarks.map((record) => record.id)).toEqual([3]);
    expect(page.groups[0].bookmarkCount).toBe(3);
    expect(findBookmarkPage(page.allMatchingBookmarks, 3, 2)).toBe(2);
  });

  it('finds document-local neighbors and deterministic post-delete selection', () => {
    const records = flattenBookmarkDashboard(dashboard);
    const ordered = deriveBookmarkPage(records, {
      query: '',
      documentKey: 'all',
      dateFilter: 'all',
      sortMode: 'pageAsc',
      page: 1,
      pageSize: 20,
      now: new Date('2026-07-20T12:00:00+08:00'),
    }).allMatchingBookmarks;

    expect(findAdjacentBookmarks(records, 2)).toMatchObject({
      previous: { id: 1 },
      next: { id: 3 },
    });
    expect(findSelectionAfterDelete(ordered, 2)).toBe(3);
    expect(findSelectionAfterDelete(ordered, 3)).toBe(2);
    expect(findSelectionAfterDelete(ordered, 4)).toBe(1);
  });

  it('formats references, file sizes, and page progress without invented metadata', () => {
    const record = flattenBookmarkDashboard(dashboard).find((item) => item.id === 1)!;

    expect(buildBookmarkReference(record)).toBe('《Beta.pdf》，“First”，第 10 页');
    expect(
      buildBookmarkReference({
        ...record,
        documentDisplayName: null,
        page: Number.NaN,
      }),
    ).toBe('《desktop:/papers/b.pdf》，“First”');
    expect(formatBookmarkFileSize(record.documentFileSize)).toBe('2 KB');
    expect(formatBookmarkFileSize(null)).toBe('—');
    expect(formatBookmarkPageProgress(record)).toEqual({
      pageLabel: '第 10 页',
      ratioLabel: '10 / 100',
      percent: 10,
    });
    expect(
      formatBookmarkPageProgress(
        flattenBookmarkDashboard(dashboard).find((item) => item.id === 4)!,
      ),
    ).toEqual({
      pageLabel: '第 5 页',
      ratioLabel: null,
      percent: null,
    });
  });
});
```

- [ ] **Step 2: Run the test and verify module-not-found failure**

```bash
bun run test src/home/bookmarkManagementUtils.test.ts
```

Expected: the test fails because `bookmarkManagementUtils.ts` does not exist.

- [ ] **Step 3: Implement the complete immutable pipeline**

Create `src/home/bookmarkManagementUtils.ts`:

```ts
import type {
  BookmarkDashboard,
  BookmarkDashboardDocument,
  PersistedBookmarkRecord,
} from '../persistence/persistenceApi';

export const BOOKMARK_PAGE_SIZES = [20, 50, 100] as const;

export type BookmarkPageSize = (typeof BOOKMARK_PAGE_SIZES)[number];
export type BookmarkDateFilter = 'all' | 'today' | '7days' | '30days';
export type BookmarkSortMode = 'createdDesc' | 'createdAsc' | 'pageAsc' | 'pageDesc';
export type BookmarkDensity = 'standard' | 'compact';

export type BookmarkUpdateInput = {
  title: string;
  note: string | null;
};

export type BookmarkDeleteResult = {
  succeededIds: number[];
  failedIds: number[];
};

export type BookmarkManagementRecord = PersistedBookmarkRecord & {
  documentFileSize: number | null;
  documentPageCount: number | null;
  documentBookmarkCount: number;
};

export type BookmarkPageGroup = {
  document: BookmarkDashboardDocument;
  bookmarkCount: number;
  bookmarks: BookmarkManagementRecord[];
};

export type BookmarkPageOptions = {
  query: string;
  documentKey: string;
  dateFilter: BookmarkDateFilter;
  sortMode: BookmarkSortMode;
  page: number;
  pageSize: number;
  now: Date;
};

export type BookmarkDerivedPage = {
  page: number;
  pageCount: number;
  pageSize: number;
  totalBookmarks: number;
  groups: BookmarkPageGroup[];
  visibleBookmarks: BookmarkManagementRecord[];
  allMatchingBookmarks: BookmarkManagementRecord[];
};

export function flattenBookmarkDashboard(
  dashboard: BookmarkDashboard | null,
): BookmarkManagementRecord[] {
  if (!dashboard) {
    return [];
  }

  return dashboard.groups.flatMap((group) =>
    group.bookmarks.map((bookmark) => ({
      ...bookmark,
      documentDisplayName: group.document.displayName,
      documentPath: group.document.path,
      documentMissing: group.document.missing,
      documentFileSize: group.document.fileSize,
      documentPageCount: group.document.pageCount,
      documentBookmarkCount: group.bookmarkCount,
    })),
  );
}

export function filterBookmarkRecords(
  records: BookmarkManagementRecord[],
  options: Pick<BookmarkPageOptions, 'query' | 'documentKey' | 'dateFilter' | 'now'>,
): BookmarkManagementRecord[] {
  const query = options.query.trim().toLocaleLowerCase();

  return records.filter((record) => {
    const matchesQuery =
      query.length === 0 ||
      [
        record.title,
        record.note ?? '',
        record.documentDisplayName ?? record.documentKey,
        record.documentPath ?? '',
      ].some((value) => value.toLocaleLowerCase().includes(query));
    const matchesDocument =
      options.documentKey === 'all' || record.documentKey === options.documentKey;

    return (
      matchesQuery &&
      matchesDocument &&
      matchesBookmarkDate(record.createdAt, options.dateFilter, options.now)
    );
  });
}

export function deriveBookmarkPage(
  records: BookmarkManagementRecord[],
  options: BookmarkPageOptions,
): BookmarkDerivedPage {
  const filtered = filterBookmarkRecords(records, options);
  const documentGroups = new Map<string, BookmarkManagementRecord[]>();

  for (const record of filtered) {
    const group = documentGroups.get(record.documentKey) ?? [];
    group.push(record);
    documentGroups.set(record.documentKey, group);
  }

  const sortedGroups = [...documentGroups.values()]
    .map((bookmarks) => [...bookmarks].sort((first, second) =>
      compareBookmarks(first, second, options.sortMode),
    ))
    .sort((first, second) => compareDocuments(first[0], second[0]));
  const allMatchingBookmarks = sortedGroups.flat();
  const pageSize = Math.max(1, options.pageSize);
  const pageCount = Math.max(1, Math.ceil(allMatchingBookmarks.length / pageSize));
  const page = Math.min(Math.max(1, options.page), pageCount);
  const start = (page - 1) * pageSize;
  const visibleBookmarks = allMatchingBookmarks.slice(start, start + pageSize);
  const groups = regroupVisibleBookmarks(visibleBookmarks);

  return {
    page,
    pageCount,
    pageSize,
    totalBookmarks: allMatchingBookmarks.length,
    groups,
    visibleBookmarks,
    allMatchingBookmarks,
  };
}

export function findAdjacentBookmarks(
  records: BookmarkManagementRecord[],
  bookmarkId: number,
): {
  previous: BookmarkManagementRecord | null;
  next: BookmarkManagementRecord | null;
} {
  const selected = records.find((record) => record.id === bookmarkId);
  if (!selected) {
    return { previous: null, next: null };
  }

  const documentRecords = records
    .filter((record) => record.documentKey === selected.documentKey)
    .sort(compareAdjacentBookmarks);
  const index = documentRecords.findIndex((record) => record.id === bookmarkId);

  return {
    previous: index > 0 ? documentRecords[index - 1] : null,
    next: index >= 0 && index < documentRecords.length - 1 ? documentRecords[index + 1] : null,
  };
}

export function findSelectionAfterDelete(
  orderedRecords: BookmarkManagementRecord[],
  deletedId: number,
): number | null {
  const deletedIndex = orderedRecords.findIndex((record) => record.id === deletedId);
  if (deletedIndex < 0) {
    return null;
  }

  const deleted = orderedRecords[deletedIndex];
  const nextInDocument = orderedRecords
    .slice(deletedIndex + 1)
    .find((record) => record.documentKey === deleted.documentKey);
  if (nextInDocument?.id != null) {
    return nextInDocument.id;
  }

  const previousInDocument = [...orderedRecords.slice(0, deletedIndex)]
    .reverse()
    .find((record) => record.documentKey === deleted.documentKey);
  if (previousInDocument?.id != null) {
    return previousInDocument.id;
  }

  const next = orderedRecords[deletedIndex + 1];
  if (next?.id != null) {
    return next.id;
  }

  const previous = orderedRecords[deletedIndex - 1];
  return previous?.id ?? null;
}

export function findBookmarkPage(
  orderedRecords: BookmarkManagementRecord[],
  bookmarkId: number,
  pageSize: number,
): number {
  const index = orderedRecords.findIndex((record) => record.id === bookmarkId);
  return index < 0 ? 1 : Math.floor(index / Math.max(1, pageSize)) + 1;
}

export function buildBookmarkReference(record: BookmarkManagementRecord): string {
  const documentName = record.documentDisplayName || record.documentKey;
  const pagePart = Number.isFinite(record.page) && record.page > 0 ? `，第 ${record.page} 页` : '';
  return `《${documentName}》，“${record.title}”${pagePart}`;
}

export function formatBookmarkPageProgress(record: BookmarkManagementRecord): {
  pageLabel: string;
  ratioLabel: string | null;
  percent: number | null;
} {
  const pageLabel = `第 ${record.page} 页`;
  if (!record.documentPageCount || record.documentPageCount <= 0) {
    return { pageLabel, ratioLabel: null, percent: null };
  }

  const percent = Math.min(
    100,
    Math.max(0, Math.round((record.page / record.documentPageCount) * 100)),
  );
  return {
    pageLabel,
    ratioLabel: `${record.page} / ${record.documentPageCount}`,
    percent,
  };
}

export function formatBookmarkFileSize(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return '—';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unitIndex]}`;
}

export function bookmarkRecordKey(record: BookmarkManagementRecord): string {
  return record.id == null
    ? `${record.documentKey}:${record.page}:${record.title}:${record.createdAt}`
    : String(record.id);
}

function regroupVisibleBookmarks(records: BookmarkManagementRecord[]): BookmarkPageGroup[] {
  const groups: BookmarkPageGroup[] = [];

  for (const record of records) {
    const existing = groups.find((group) => group.document.documentKey === record.documentKey);
    if (existing) {
      existing.bookmarks.push(record);
      continue;
    }

    groups.push({
      document: {
        documentKey: record.documentKey,
        displayName: record.documentDisplayName ?? record.documentKey,
        path: record.documentPath,
        missing: record.documentMissing,
        fileSize: record.documentFileSize,
        pageCount: record.documentPageCount,
      },
      bookmarkCount: record.documentBookmarkCount,
      bookmarks: [record],
    });
  }

  return groups;
}

function matchesBookmarkDate(
  value: string,
  filter: BookmarkDateFilter,
  now: Date,
): boolean {
  if (filter === 'all') {
    return true;
  }

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    return false;
  }

  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const nextDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const days = filter === 'today' ? 1 : filter === '7days' ? 7 : 30;
  const lowerBound = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (days - 1),
  ).getTime();

  return timestamp >= lowerBound && timestamp < nextDay && timestamp >= startToday - (days - 1) * 86_400_000;
}

function compareDocuments(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
): number {
  const firstName = first.documentDisplayName ?? first.documentKey;
  const secondName = second.documentDisplayName ?? second.documentKey;
  return (
    firstName.localeCompare(secondName, 'zh-Hans-CN', { sensitivity: 'base' }) ||
    first.documentKey.localeCompare(second.documentKey)
  );
}

function compareBookmarks(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
  sortMode: BookmarkSortMode,
): number {
  if (sortMode === 'pageAsc' || sortMode === 'pageDesc') {
    const pageDifference =
      sortMode === 'pageAsc' ? first.page - second.page : second.page - first.page;
    return (
      pageDifference ||
      compareCreatedAt(first.createdAt, second.createdAt, 'asc') ||
      compareTitleAndId(first, second)
    );
  }

  const direction = sortMode === 'createdAsc' ? 'asc' : 'desc';
  return (
    compareCreatedAt(first.createdAt, second.createdAt, direction) ||
    first.page - second.page ||
    compareTitleAndId(first, second)
  );
}

function compareAdjacentBookmarks(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
): number {
  return (
    first.page - second.page ||
    compareCreatedAt(first.createdAt, second.createdAt, 'asc') ||
    compareNullableIds(first.id, second.id)
  );
}

function compareCreatedAt(first: string, second: string, direction: 'asc' | 'desc'): number {
  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);
  const firstValid = !Number.isNaN(firstTime);
  const secondValid = !Number.isNaN(secondTime);

  if (!firstValid && !secondValid) {
    return 0;
  }
  if (!firstValid) {
    return 1;
  }
  if (!secondValid) {
    return -1;
  }
  return direction === 'asc' ? firstTime - secondTime : secondTime - firstTime;
}

function compareTitleAndId(
  first: BookmarkManagementRecord,
  second: BookmarkManagementRecord,
): number {
  return (
    first.title.localeCompare(second.title, 'zh-Hans-CN', { sensitivity: 'base' }) ||
    compareNullableIds(first.id, second.id)
  );
}

function compareNullableIds(first: number | null, second: number | null): number {
  return (first ?? Number.MAX_SAFE_INTEGER) - (second ?? Number.MAX_SAFE_INTEGER);
}
```

- [ ] **Step 4: Remove the redundant millisecond comparison**

The local-calendar lower bound already comes from the local `Date` constructor. Keep `matchesBookmarkDate` readable by replacing its final return with:

```ts
  return timestamp >= lowerBound && timestamp < nextDay;
```

This explicit cleanup avoids DST-sensitive `86_400_000` arithmetic.

- [ ] **Step 5: Run pure tests and typecheck**

```bash
bun run test src/home/bookmarkManagementUtils.test.ts
bun run typecheck
git diff --check -- src/home/bookmarkManagementUtils.ts src/home/bookmarkManagementUtils.test.ts
```

Expected: all search, filter, sort, pagination, neighbor, selection, reference, size, and progress assertions pass without mutating the dashboard fixture.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/home/bookmarkManagementUtils.ts src/home/bookmarkManagementUtils.test.ts
git commit -m "feat: derive bookmark management views"
```

---

### Task 6: Build the Shared Workspace Shell, State Hook, Toolbar, and Grouped List

**Files:**
- Create: `src/home/useBookmarkManagement.ts`
- Create: `src/home/BookmarkToolbar.tsx`
- Create: `src/home/BookmarkGroupList.tsx`
- Create: `src/home/BookmarkManagementContent.tsx`
- Create: `src/home/HomeBookmarksWorkspace.test.tsx`
- Replace: `src/home/HomeBookmarksWorkspace.tsx`
- Replace: `src/workspaces/BookmarkManagerWorkspace.tsx`

- [ ] **Step 1: Create a failing component test fixture**

Create `src/home/HomeBookmarksWorkspace.test.tsx`. Use the dashboard below for every interaction test:

```tsx
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BookmarkDashboard } from '../persistence/persistenceApi';
import { HomeBookmarksWorkspace } from './HomeBookmarksWorkspace';

const dashboard: BookmarkDashboard = {
  totalBookmarks: 3,
  groups: [
    {
      document: {
        documentKey: 'desktop:/papers/transformer.pdf',
        displayName: 'Transformer.pdf',
        path: '/papers/transformer.pdf',
        missing: false,
        fileSize: 12_582_912,
        pageCount: 89,
      },
      bookmarkCount: 2,
      bookmarks: [
        {
          id: 1,
          documentKey: 'desktop:/papers/transformer.pdf',
          page: 32,
          title: '自注意力机制',
          note: '核心思想',
          createdAt: '2026-07-20T09:00:00+08:00',
          updatedAt: '2026-07-20T09:00:00+08:00',
        },
        {
          id: 2,
          documentKey: 'desktop:/papers/transformer.pdf',
          page: 45,
          title: '多头注意力',
          note: null,
          createdAt: '2026-07-19T09:00:00+08:00',
          updatedAt: '2026-07-19T09:00:00+08:00',
        },
      ],
    },
    {
      document: {
        documentKey: 'desktop:/papers/diffusion.pdf',
        displayName: 'Diffusion.pdf',
        path: '/papers/diffusion.pdf',
        missing: false,
        fileSize: 8_192,
        pageCount: 60,
      },
      bookmarkCount: 1,
      bookmarks: [
        {
          id: 3,
          documentKey: 'desktop:/papers/diffusion.pdf',
          page: 18,
          title: '正向过程',
          note: '噪声调度',
          createdAt: '2026-06-01T09:00:00+08:00',
          updatedAt: '2026-06-01T09:00:00+08:00',
        },
      ],
    },
  ],
};

function renderWorkspace(
  overrides: Partial<Parameters<typeof HomeBookmarksWorkspace>[0]> = {},
) {
  const props: Parameters<typeof HomeBookmarksWorkspace>[0] = {
    dashboard,
    loading: false,
    error: null,
    canOpenBookmark: () => true,
    onOpenPdf: vi.fn(),
    onOpenBookmark: vi.fn(),
    onUpdateBookmark: vi.fn().mockResolvedValue(undefined),
    onDeleteBookmarks: vi.fn().mockResolvedValue({
      succeededIds: [],
      failedIds: [],
    }),
    onRefresh: vi.fn(),
    ...overrides,
  };

  render(<HomeBookmarksWorkspace {...props} />);
  return props;
}
```

Add these initial tests:

```tsx
describe('HomeBookmarksWorkspace', () => {
  it('renders the canonical grouped workspace and collapses a document group', () => {
    renderWorkspace();

    expect(screen.getByRole('heading', { name: '书签管理' })).toBeInTheDocument();
    expect(screen.getByText('共 3 个书签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起 Transformer.pdf' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByText('自注意力机制')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起 Transformer.pdf' }));

    expect(screen.getByRole('button', { name: '展开 Transformer.pdf' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('自注意力机制')).not.toBeInTheDocument();
  });

  it('searches notes, filters documents, clears filters, and preserves density', () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole('button', { name: '紧凑密度' }));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索书签' }), {
      target: { value: '噪声调度' },
    });
    expect(screen.getByText('正向过程')).toBeInTheDocument();
    expect(screen.queryByText('自注意力机制')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清空搜索关键词' }));
    expect(screen.getByRole('searchbox', { name: '搜索书签' })).toHaveValue('');
    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索书签' }), {
      target: { value: '噪声调度' },
    });

    fireEvent.change(screen.getByRole('combobox', { name: '文档筛选' }), {
      target: { value: 'desktop:/papers/transformer.pdf' },
    });
    expect(screen.getByText('没有找到符合条件的书签')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '紧凑密度' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('applies the date filter through the toolbar', () => {
    const today = new Date().toISOString();
    const datedDashboard: BookmarkDashboard = {
      ...dashboard,
      groups: dashboard.groups.map((group) => ({
        ...group,
        bookmarks: group.bookmarks.map((bookmark) => ({
          ...bookmark,
          createdAt: bookmark.id === 1 ? today : '2020-01-01T00:00:00Z',
        })),
      })),
    };
    renderWorkspace({ dashboard: datedDashboard });

    fireEvent.change(screen.getByRole('combobox', { name: '日期筛选' }), {
      target: { value: 'today' },
    });

    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    expect(screen.queryByText('多头注意力')).not.toBeInTheDocument();
    expect(screen.queryByText('正向过程')).not.toBeInTheDocument();
  });

  it('renders loading, initial error, global empty, and filtered empty states', () => {
    const onRefresh = vi.fn();
    const { rerender } = render(
      <HomeBookmarksWorkspace
        dashboard={null}
        loading
        error={null}
        canOpenBookmark={() => true}
        onOpenPdf={vi.fn()}
        onOpenBookmark={vi.fn()}
        onUpdateBookmark={vi.fn()}
        onDeleteBookmarks={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByLabelText('正在加载书签')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '请选择一条书签查看详情',
    );

    rerender(
      <HomeBookmarksWorkspace
        dashboard={null}
        loading={false}
        error="书签加载失败，请重试。"
        canOpenBookmark={() => true}
        onOpenPdf={vi.fn()}
        onOpenBookmark={vi.fn()}
        onUpdateBookmark={vi.fn()}
        onDeleteBookmarks={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('书签加载失败，请重试。');
    fireEvent.click(screen.getByRole('button', { name: '重试加载书签' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);

    rerender(
      <HomeBookmarksWorkspace
        dashboard={{ totalBookmarks: 0, groups: [] }}
        loading={false}
        error={null}
        canOpenBookmark={() => true}
        onOpenPdf={vi.fn()}
        onOpenBookmark={vi.fn()}
        onUpdateBookmark={vi.fn()}
        onDeleteBookmarks={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText('暂无书签')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开文档添加书签' })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toBeInTheDocument();
  });

  it('keeps the last dashboard visible when a background refresh fails', () => {
    const onRefresh = vi.fn();
    renderWorkspace({
      error: '书签加载失败，请重试。',
      onRefresh,
    });

    expect(screen.getByText('自注意力机制')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('书签加载失败，请重试。');
    fireEvent.click(screen.getByRole('button', { name: '重新加载书签' }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('switches sorting, page size, pagination, and standard/compact density', () => {
    const manyBookmarks: BookmarkDashboard = {
      totalBookmarks: 21,
      groups: [
        {
          ...dashboard.groups[0],
          bookmarkCount: 21,
          bookmarks: Array.from({ length: 21 }, (_, index) => ({
            id: index + 1,
            documentKey: 'desktop:/papers/transformer.pdf',
            page: index + 1,
            title: `Bookmark ${index + 1}`,
            note: null,
            createdAt: `2026-07-${String((index % 20) + 1).padStart(2, '0')}T09:00:00+08:00`,
            updatedAt: '2026-07-20T09:00:00+08:00',
          })),
        },
      ],
    };
    renderWorkspace({ dashboard: manyBookmarks });

    fireEvent.change(screen.getByRole('combobox', { name: '书签排序' }), {
      target: { value: 'pageAsc' },
    });
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByText('Bookmark 21')).toBeInTheDocument();
    expect(screen.getByText('第 2 / 2 页')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '每页书签数' }), {
      target: { value: '50' },
    });
    expect(screen.getByText('第 1 / 1 页')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '紧凑密度' }));
    expect(screen.getByTestId('bookmark-management-list')).toHaveAttribute(
      'data-density',
      'compact',
    );
  });
});
```

- [ ] **Step 2: Run the test and verify failure**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx
```

Expected: the old workspace props and markup do not satisfy the new dashboard, toolbar, grouping, pagination, and state contracts.

- [ ] **Step 3: Implement the state hook**

Create `src/home/useBookmarkManagement.ts` with this public input and returned state:

```ts
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  deriveBookmarkPage,
  findBookmarkPage,
  type BookmarkDateFilter,
  type BookmarkDensity,
  type BookmarkManagementRecord,
  type BookmarkPageSize,
  type BookmarkSortMode,
} from './bookmarkManagementUtils';

type UseBookmarkManagementInput = {
  records: BookmarkManagementRecord[];
  now?: Date;
};

export function useBookmarkManagement({ records, now }: UseBookmarkManagementInput) {
  const stableNowRef = useRef(now ?? new Date());
  const effectiveNow = now ?? stableNowRef.current;
  const [query, setQueryState] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [documentKey, setDocumentKeyState] = useState('all');
  const [dateFilter, setDateFilterState] = useState<BookmarkDateFilter>('all');
  const [sortMode, setSortModeState] = useState<BookmarkSortMode>('createdDesc');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<BookmarkPageSize>(20);
  const [density, setDensity] = useState<BookmarkDensity>('standard');
  const [expandedDocumentKeys, setExpandedDocumentKeys] = useState<Set<string>>(
    () => new Set(records.map((record) => record.documentKey)),
  );
  const knownDocumentKeysRef = useRef(new Set(records.map((record) => record.documentKey)));
  const [selectedBookmarkId, setSelectedBookmarkId] = useState<number | null>(null);
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<number>>(() => new Set());

  const documentOptions = useMemo(() => {
    const names = new Map<string, string>();
    for (const record of records) {
      names.set(record.documentKey, record.documentDisplayName ?? record.documentKey);
    }
    return [...names].sort(
      (first, second) =>
        first[1].localeCompare(second[1], 'zh-Hans-CN', { sensitivity: 'base' }) ||
        first[0].localeCompare(second[0]),
    );
  }, [records]);

  const derived = useMemo(
    () =>
      deriveBookmarkPage(records, {
        query: deferredQuery,
        documentKey,
        dateFilter,
        sortMode,
        page,
        pageSize,
        now: effectiveNow,
      }),
    [dateFilter, deferredQuery, documentKey, effectiveNow, page, pageSize, records, sortMode],
  );
  const selectedBookmark =
    derived.allMatchingBookmarks.find((record) => record.id === selectedBookmarkId) ?? null;
  const selectedVisibleCount = derived.visibleBookmarks.filter(
    (record) => record.id != null && selectedBatchIds.has(record.id),
  ).length;
  const selectableVisibleCount = derived.visibleBookmarks.filter(
    (record) => record.id != null,
  ).length;
  const allVisibleSelected =
    selectableVisibleCount > 0 && selectedVisibleCount === selectableVisibleCount;

  useEffect(() => {
    const available = new Set(records.map((record) => record.documentKey));
    setExpandedDocumentKeys((current) => {
      const next = new Set([...current].filter((key) => available.has(key)));
      for (const key of available) {
        if (!knownDocumentKeysRef.current.has(key)) {
          next.add(key);
        }
      }
      return next;
    });
    knownDocumentKeysRef.current = available;
  }, [records]);

  useEffect(() => {
    if (derived.page !== page) {
      setPage(derived.page);
    }
  }, [derived.page, page]);

  useEffect(() => {
    if (
      selectedBookmarkId != null &&
      !derived.allMatchingBookmarks.some((record) => record.id === selectedBookmarkId)
    ) {
      setSelectedBookmarkId(null);
    }
  }, [derived.allMatchingBookmarks, selectedBookmarkId]);

  useEffect(() => {
    const availableIds = new Set(
      records.flatMap((record) => (record.id == null ? [] : [record.id])),
    );
    setSelectedBatchIds(
      (current) => new Set([...current].filter((id) => availableIds.has(id))),
    );
  }, [records]);

  const resetPage = () => setPage(1);
  const setQuery = (value: string) => {
    setQueryState(value);
    resetPage();
  };
  const setDocumentKey = (value: string) => {
    setDocumentKeyState(value);
    resetPage();
  };
  const setDateFilter = (value: BookmarkDateFilter) => {
    setDateFilterState(value);
    resetPage();
  };
  const setSortMode = (value: BookmarkSortMode) => {
    setSortModeState(value);
    resetPage();
  };
  const setPageSize = (value: BookmarkPageSize) => {
    setPageSizeState(value);
    resetPage();
  };
  const clearFilters = () => {
    setQueryState('');
    setDocumentKeyState('all');
    setDateFilterState('all');
    resetPage();
  };
  const toggleDocument = (key: string) => {
    setExpandedDocumentKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };
  const selectBookmark = (record: BookmarkManagementRecord) => {
    if (record.id != null) {
      setSelectedBookmarkId(record.id);
    }
  };
  const navigateToBookmark = (record: BookmarkManagementRecord) => {
    if (record.id == null) {
      return;
    }
    setExpandedDocumentKeys((current) => new Set(current).add(record.documentKey));
    setPage(findBookmarkPage(derived.allMatchingBookmarks, record.id, pageSize));
    setSelectedBookmarkId(record.id);
    setPendingFocusId(record.id);
  };
  const startBatchMode = () => setBatchMode(true);
  const cancelBatchMode = () => {
    setBatchMode(false);
    setSelectedBatchIds(new Set());
  };
  const toggleBatchSelection = (id: number, selected: boolean) => {
    setSelectedBatchIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };
  const toggleVisibleBatchSelection = (selected: boolean) => {
    setSelectedBatchIds((current) => {
      const next = new Set(current);
      for (const record of derived.visibleBookmarks) {
        if (record.id == null) {
          continue;
        }
        if (selected) {
          next.add(record.id);
        } else {
          next.delete(record.id);
        }
      }
      return next;
    });
  };

  return {
    query,
    documentKey,
    dateFilter,
    sortMode,
    page: derived.page,
    pageSize,
    density,
    expandedDocumentKeys,
    selectedBookmarkId,
    selectedBookmark,
    pendingFocusId,
    batchMode,
    selectedBatchIds,
    selectedVisibleCount,
    allVisibleSelected,
    documentOptions,
    derived,
    setQuery,
    setDocumentKey,
    setDateFilter,
    setSortMode,
    setPage,
    setPageSize,
    setDensity,
    clearFilters,
    toggleDocument,
    selectBookmark,
    setSelectedBookmarkId,
    navigateToBookmark,
    setPendingFocusId,
    startBatchMode,
    cancelBatchMode,
    toggleBatchSelection,
    toggleVisibleBatchSelection,
    setSelectedBatchIds,
    setBatchMode,
  };
}
```

- [ ] **Step 4: Implement the toolbar contract**

Create `src/home/BookmarkToolbar.tsx`. Its props must be exactly:

```tsx
import { List, Rows3, Search, X } from 'lucide-react';
import {
  BOOKMARK_PAGE_SIZES,
  type BookmarkDateFilter,
  type BookmarkDensity,
  type BookmarkPageSize,
  type BookmarkSortMode,
} from './bookmarkManagementUtils';

type BookmarkToolbarProps = {
  query: string;
  documentKey: string;
  dateFilter: BookmarkDateFilter;
  sortMode: BookmarkSortMode;
  pageSize: BookmarkPageSize;
  density: BookmarkDensity;
  documentOptions: Array<[string, string]>;
  filtering: boolean;
  batchMode: boolean;
  onQueryChange(value: string): void;
  onDocumentChange(value: string): void;
  onDateFilterChange(value: BookmarkDateFilter): void;
  onSortModeChange(value: BookmarkSortMode): void;
  onPageSizeChange(value: BookmarkPageSize): void;
  onDensityChange(value: BookmarkDensity): void;
  onClearFilters(): void;
  onStartBatch(): void;
  onCancelBatch(): void;
};
```

Render:

- a `<div className="bookmark-management-search">` containing an associated `<label htmlFor="bookmark-management-query">搜索书签</label>` and `<div className="bookmark-management-search-control">`;
- inside that control, a decorative `Search` icon and `<input id="bookmark-management-query" type="search" aria-label="搜索书签" placeholder="搜索书签名称、备注或文档..." />`;
- when `query` is non-empty, a `type="button"` icon button with class `bookmark-management-search-clear`, labelled `清空搜索关键词`, that calls `onQueryChange('')`; hide it when already empty, and do not nest the button inside a `<label>`;
- native selects labelled `文档筛选`, `日期筛选`, `书签排序`, and `每页书签数`;
- date values `all`, `today`, `7days`, `30days`;
- sort values `createdDesc`, `createdAsc`, `pageAsc`, `pageDesc`;
- page size values from `BOOKMARK_PAGE_SIZES`;
- convert the page-size select with `Number(event.currentTarget.value) as BookmarkPageSize`;
  cast date and sort select values only to their declared unions, never keep raw
  select strings in hook state;
- a `清除筛选` button disabled only when `filtering` is false;
- two density buttons with labels `标准密度` and `紧凑密度`, `aria-pressed`, and `List` / `Rows3` icons;
- a `批量操作` button outside batch mode and `取消批量操作` with `X` inside batch mode.

No control in this component calls persistence or keeps its own state.

- [ ] **Step 5: Implement the grouped list contract**

Create `src/home/BookmarkGroupList.tsx` with:

```tsx
import { ChevronDown, ChevronRight, FileText } from 'lucide-react';
import { formatDateTime } from './homeDisplayUtils';
import {
  bookmarkRecordKey,
  formatBookmarkPageProgress,
  type BookmarkDensity,
  type BookmarkManagementRecord,
  type BookmarkPageGroup,
} from './bookmarkManagementUtils';

type BookmarkGroupListProps = {
  groups: BookmarkPageGroup[];
  density: BookmarkDensity;
  expandedDocumentKeys: Set<string>;
  selectedBookmarkId: number | null;
  batchMode: boolean;
  selectedBatchIds: Set<number>;
  allVisibleSelected: boolean;
  pendingFocusId: number | null;
  onToggleDocument(documentKey: string): void;
  onSelectBookmark(bookmark: BookmarkManagementRecord): void;
  onToggleBatchSelection(id: number, selected: boolean): void;
  onToggleVisibleBatchSelection(selected: boolean): void;
  onPendingFocusHandled(): void;
};
```

Use a `Map<number, HTMLTableRowElement>` ref. When `pendingFocusId` changes and the row exists, call `.focus()` and then `onPendingFocusHandled()`.

Render one `<section>` per group:

```tsx
<section
  className="bookmark-management-group"
  key={group.document.documentKey}
  aria-labelledby={`bookmark-group-${encodeURIComponent(group.document.documentKey)}`}
>
```

The group header button must expose `aria-expanded`, `aria-controls`, `收起/展开 {displayName}`, the PDF icon, full `bookmarkCount`, and the text `源文件不可用` when missing. The controlled content ID is based on `encodeURIComponent(documentKey)`.

Inside expanded content, render a semantic table. Columns are:

1. current-page checkbox only in batch mode;
2. `书签名称`;
3. `页码`;
4. `创建时间`;
5. `备注`;
6. `操作`.

Each row:

- has `tabIndex={0}`, `aria-selected`, a stable `key={bookmarkRecordKey(bookmark)}`, and `data-testid="bookmark-management-row"`;
- selects on click, Enter, or Space, but does not jump;
- stops row selection when a checkbox or action is used;
- shows `formatBookmarkPageProgress`, `formatDateTime`, a native `title` for truncated name/note, and `—` for empty note;
- renders an empty action cell with class `bookmark-management-row-actions` in this task; Task 7 fills the exact menu without changing row semantics.

Keep `BookmarkGroupHeader` and `BookmarkListItem` as private components in this file so the approved component boundaries stay named without creating one-file wrappers. The list root must be:

```tsx
<div
  className="bookmark-management-groups"
  data-testid="bookmark-management-list"
  data-density={density}
>
```

- [ ] **Step 6: Implement the canonical shared content and all page states**

Create `src/home/BookmarkManagementContent.tsx`, export
`BookmarkManagementContentProps` using the exact prop contract from **Contract
Map** plus optional `onClose?: () => void`, and export the component. It must:

1. derive records with `flattenBookmarkDashboard`;
2. call `useBookmarkManagement`;
3. render the title `书签管理`, subtitle `统一管理所有文献中的书签，快速定位重要内容`, and `共 N 个书签`;
4. show the toolbar and current-page result count;
5. show `BookmarkGroupList`;
6. render pagination with `上一页`, `下一页`, `第 X / Y 页`, correct disabled states, and no hidden mutation;
7. reserve `<aside className="bookmark-management-detail">` in every loading, error, empty, filtered-empty, and populated state and initially show `请选择一条书签查看详情`;
8. show a non-blocking `role="alert"` refresh banner when both `dashboard` and `error` exist.

Import `X` from `lucide-react` and `useMemo` plus `type ReactNode` from React.
Memoize the flattened records before calling the hook; passing a freshly
allocated array on every render would retrigger its reconciliation effects:

```tsx
const records = useMemo(
  () => flattenBookmarkDashboard(dashboard),
  [dashboard],
);
const management = useBookmarkManagement({ records });
```

Always render the shared page heading first, including loading, error, and empty states:

```tsx
const heading = (
  <header className="bookmark-management-heading">
    <div>
      <h1>书签管理</h1>
      <p>统一管理所有文献中的书签，快速定位重要内容</p>
    </div>
    <div className="bookmark-management-heading-actions">
      <span className="bookmark-management-count">
        共 {dashboard?.totalBookmarks ?? 0} 个书签
      </span>
      {onClose ? (
        <button type="button" aria-label="返回首页" onClick={onClose}>
          <X size={16} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  </header>
);
```

Choose exactly one main-column body state without returning a second page root. Keep `BookmarkPageState` and `BookmarkPagination` as private components in this file; they only own the repeated markup shown below and no state:

```tsx
let body: ReactNode;
const filtering =
  management.query.trim() !== '' ||
  management.documentKey !== 'all' ||
  management.dateFilter !== 'all';

if (!dashboard) {
  body = error ? (
    <BookmarkPageState role="alert">
      <strong>书签加载失败</strong>
      <p>{error}</p>
      <button type="button" onClick={() => void onRefresh()}>
        重试加载书签
      </button>
    </BookmarkPageState>
  ) : (
    <div className="bookmark-management-skeleton" aria-label="正在加载书签">
      <span />
      <span />
      <span />
    </div>
  );
} else if (dashboard.totalBookmarks === 0) {
  body = (
    <BookmarkPageState>
      <strong>暂无书签</strong>
      <p>在阅读文献时添加书签后，可在这里统一管理</p>
      <button type="button" onClick={() => void onOpenPdf()}>
        打开文档添加书签
      </button>
    </BookmarkPageState>
  );
} else {
  body = (
    <>
      <BookmarkToolbar
        query={management.query}
        documentKey={management.documentKey}
        dateFilter={management.dateFilter}
        sortMode={management.sortMode}
        pageSize={management.pageSize}
        density={management.density}
        documentOptions={management.documentOptions}
        filtering={filtering}
        batchMode={management.batchMode}
        onQueryChange={management.setQuery}
        onDocumentChange={management.setDocumentKey}
        onDateFilterChange={management.setDateFilter}
        onSortModeChange={management.setSortMode}
        onPageSizeChange={management.setPageSize}
        onDensityChange={management.setDensity}
        onClearFilters={management.clearFilters}
        onStartBatch={management.startBatchMode}
        onCancelBatch={management.cancelBatchMode}
      />
      <p className="bookmark-management-status">
        当前页 {management.derived.visibleBookmarks.length} 条，共{' '}
        {management.derived.totalBookmarks} 条书签
      </p>
      {management.derived.totalBookmarks === 0 ? (
        <BookmarkPageState>
          <strong>没有找到符合条件的书签</strong>
          <button type="button" onClick={management.clearFilters}>
            清除筛选
          </button>
        </BookmarkPageState>
      ) : (
        <>
          <BookmarkGroupList
            groups={management.derived.groups}
            density={management.density}
            expandedDocumentKeys={management.expandedDocumentKeys}
            selectedBookmarkId={management.selectedBookmarkId}
            batchMode={management.batchMode}
            selectedBatchIds={management.selectedBatchIds}
            allVisibleSelected={management.allVisibleSelected}
            pendingFocusId={management.pendingFocusId}
            onToggleDocument={management.toggleDocument}
            onSelectBookmark={management.selectBookmark}
            onToggleBatchSelection={management.toggleBatchSelection}
            onToggleVisibleBatchSelection={management.toggleVisibleBatchSelection}
            onPendingFocusHandled={() => management.setPendingFocusId(null)}
          />
          <BookmarkPagination
            page={management.page}
            pageCount={management.derived.pageCount}
            onPageChange={management.setPage}
          />
        </>
      )}
    </>
  );
}

return (
  <section
    className="bookmark-management-content"
    aria-label="书签管理"
    aria-busy={loading}
  >
    {heading}
    <div className="bookmark-management-body">
      {dashboard && error ? (
        <div className="bookmark-management-refresh-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void onRefresh()}>
            重新加载书签
          </button>
        </div>
      ) : null}
      <div className="bookmark-management-layout">
        <main className="bookmark-management-main">{body}</main>
        <aside className="bookmark-management-detail" aria-label="书签详情">
          请选择一条书签查看详情
        </aside>
      </div>
    </div>
  </section>
);
```

Define the two private display components with these exact contracts:

```tsx
function BookmarkPageState({
  children,
  role,
}: {
  children: ReactNode;
  role?: 'alert' | 'status';
}) {
  return (
    <div className="bookmark-management-page-state" role={role}>
      {children}
    </div>
  );
}

function BookmarkPagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange(page: number): void;
}) {
  return (
    <nav className="bookmark-management-pagination" aria-label="书签分页">
      <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        上一页
      </button>
      <span>第 {page} / {pageCount} 页</span>
      <button
        type="button"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}
```

- [ ] **Step 7: Replace both wrappers with the shared content**

Replace `src/home/HomeBookmarksWorkspace.tsx` with:

```tsx
import {
  BookmarkManagementContent,
  type BookmarkManagementContentProps,
} from './BookmarkManagementContent';

export type HomeBookmarksWorkspaceProps = BookmarkManagementContentProps;

export function HomeBookmarksWorkspace(props: HomeBookmarksWorkspaceProps) {
  return <BookmarkManagementContent {...props} />;
}
```

Replace `src/workspaces/BookmarkManagerWorkspace.tsx` with:

```tsx
import {
  BookmarkManagementContent,
  type BookmarkManagementContentProps,
} from '../home/BookmarkManagementContent';

type BookmarkManagerWorkspaceProps = BookmarkManagementContentProps & {
  onClose(): void;
};

export function BookmarkManagerWorkspace({
  onClose,
  ...props
}: BookmarkManagerWorkspaceProps) {
  return (
    <section
      className="tool-workspace bookmark-management-standalone"
      aria-label="书签管理工作区"
    >
      <BookmarkManagementContent {...props} onClose={onClose} />
    </section>
  );
}
```

The content heading renders a `返回首页` icon button only when `onClose` exists. No list, filter, or mutation behavior may live in either wrapper.

- [ ] **Step 8: Run component tests and typecheck**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx
bun run typecheck
git diff --check -- src/home/useBookmarkManagement.ts src/home/BookmarkToolbar.tsx src/home/BookmarkGroupList.tsx src/home/BookmarkManagementContent.tsx src/home/HomeBookmarksWorkspace.tsx src/home/HomeBookmarksWorkspace.test.tsx src/workspaces/BookmarkManagerWorkspace.tsx
```

Expected: shared wrappers compile; grouping, collapse, search, filters, reset, sorting, pagination, density, and all page states pass.

- [ ] **Step 9: Commit Task 6**

```bash
git add src/home/useBookmarkManagement.ts src/home/BookmarkToolbar.tsx src/home/BookmarkGroupList.tsx src/home/BookmarkManagementContent.tsx src/home/HomeBookmarksWorkspace.tsx src/home/HomeBookmarksWorkspace.test.tsx src/workspaces/BookmarkManagerWorkspace.tsx
git commit -m "feat: build bookmark management workspace"
```

---

### Task 7: Add Accessible Row Menus, Details, Adjacent Navigation, Editing, and Copy

**Files:**
- Create: `src/home/BookmarkDetailPanel.tsx`
- Create: `src/home/BookmarkEditorDialog.tsx`
- Modify: `src/home/BookmarkGroupList.tsx`
- Modify: `src/home/BookmarkManagementContent.tsx`
- Modify: `src/home/useBookmarkManagement.ts`
- Modify: `src/home/HomeBookmarksWorkspace.test.tsx`

- [ ] **Step 1: Add failing detail, editor, clipboard, and menu tests**

Append these cases to `HomeBookmarksWorkspace.test.tsx`:

```tsx
  it('selects a row without jumping and exposes real detail data', () => {
    const props = renderWorkspace();

    fireEvent.click(screen.getByText('自注意力机制'));

    expect(props.onOpenBookmark).not.toHaveBeenCalled();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      'Transformer.pdf',
    );
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '/papers/transformer.pdf',
    );
    expect(screen.getByText('未识别章节')).toBeInTheDocument();
    expect(screen.getByText('32 / 89')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '跳转到书签 自注意力机制' }));
    expect(props.onOpenBookmark).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, page: 32 }),
    );
  });

  it('clears the selected detail without opening the document', () => {
    const props = renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '关闭书签详情' }));

    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '请选择一条书签查看详情',
    );
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'false',
    );
    expect(props.onOpenBookmark).not.toHaveBeenCalled();
  });

  it('retains a visible selection across group collapse and re-expand', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '收起 Transformer.pdf' }));

    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '自注意力机制',
    );
    fireEvent.click(screen.getByRole('button', { name: '展开 Transformer.pdf' }));
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('clears detail when the selected bookmark is hidden by filtering', async () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.change(screen.getByRole('searchbox', { name: '搜索书签' }), {
      target: { value: '噪声调度' },
    });

    await waitFor(() => {
      expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
        '请选择一条书签查看详情',
      );
    });
  });

  it('navigates to the next bookmark and focuses its row', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));

    fireEvent.click(screen.getByRole('button', { name: '下一条书签 多头注意力' }));

    expect(screen.getByTestId('bookmark-management-row-2')).toHaveFocus();
    expect(screen.getByTestId('bookmark-management-row-2')).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '多头注意力',
    );

    fireEvent.click(screen.getByRole('button', { name: '上一条书签 自注意力机制' }));
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveFocus();
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('edits title and note together and preserves input after a failed save', async () => {
    const onUpdateBookmark = vi
      .fn()
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);
    renderWorkspace({ onUpdateBookmark });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '编辑备注 自注意力机制' }));

    expect(screen.getByRole('textbox', { name: '书签备注' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: '  核心结论  ' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: '  重新核对  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('书签保存失败，请重试。');
    expect(screen.getByRole('textbox', { name: '书签名称' })).toHaveValue('  核心结论  ');
    expect(screen.getByRole('textbox', { name: '书签备注' })).toHaveValue('  重新核对  ');

    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));
    await waitFor(() => {
      expect(onUpdateBookmark).toHaveBeenLastCalledWith(
        expect.objectContaining({ id: 1 }),
        { title: '核心结论', note: '重新核对' },
      );
    });
    expect(screen.queryByRole('dialog', { name: '编辑书签' })).not.toBeInTheDocument();
  });

  it('focuses title from the row menu, validates it, and normalizes blank note to null', async () => {
    const onUpdateBookmark = vi.fn().mockResolvedValue(undefined);
    renderWorkspace({ onUpdateBookmark });
    fireEvent.click(screen.getByRole('button', { name: '打开书签操作 自注意力机制' }));
    fireEvent.click(screen.getByRole('menuitem', { name: '编辑书签 自注意力机制' }));

    expect(screen.getByRole('textbox', { name: '书签名称' })).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));
    expect(screen.getByRole('alert')).toHaveTextContent('书签名称不能为空。');

    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: '核心结论' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: '   ' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));
    await waitFor(() => {
      expect(onUpdateBookmark).toHaveBeenCalledWith(
        expect.objectContaining({ id: 1 }),
        { title: '核心结论', note: null },
      );
    });
  });

  it('confirms before discarding dirty editor values', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '编辑备注 自注意力机制' }));
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: 'changed' },
    });

    fireEvent.keyDown(screen.getByRole('dialog', { name: '编辑书签' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: '放弃书签更改' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '继续编辑' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '放弃更改' }));
    expect(screen.queryByRole('dialog', { name: '编辑书签' })).not.toBeInTheDocument();
  });

  it('traps editor focus and restores it to the opening action', () => {
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    const trigger = screen.getByRole('button', { name: '编辑备注 自注意力机制' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '编辑书签' });
    const buttons = within(dialog).getAllByRole('button');
    const first = buttons[0];
    const last = buttons.at(-1)!;
    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(first).toHaveFocus();
    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '取消编辑' }));
    expect(trigger).toHaveFocus();
  });

  it('copies a reference and reports unavailable clipboard access', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '复制引用 自注意力机制' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('《Transformer.pdf》，“自注意力机制”，第 32 页');
    });
    expect(screen.getByRole('status')).toHaveTextContent('引用已复制');

    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: undefined,
    });
    fireEvent.click(screen.getByRole('button', { name: '复制引用 自注意力机制' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('复制引用失败，请重试。');
  });

  it('supports row-menu arrows, Home, End, and Escape', () => {
    renderWorkspace();
    const trigger = screen.getByRole('button', { name: '打开书签操作 自注意力机制' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: '书签操作 自注意力机制' });
    const items = within(menu).getAllByRole('menuitem');

    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'End' });
    expect(items.at(-1)).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Home' });
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
```

Add a missing-file assertion:

```tsx
  it('disables open and jump for missing files but keeps edit and copy enabled', () => {
    const missingDashboard: BookmarkDashboard = {
      totalBookmarks: 1,
      groups: [
        {
          ...dashboard.groups[1],
          document: {
            ...dashboard.groups[1].document,
            missing: true,
          },
        },
      ],
    };
    renderWorkspace({
      dashboard: missingDashboard,
      canOpenBookmark: () => false,
    });
    fireEvent.click(screen.getByText('正向过程'));

    expect(screen.getByRole('button', { name: '打开文档 Diffusion.pdf' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '跳转到书签 正向过程' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '编辑备注 正向过程' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '复制引用 正向过程' })).toBeEnabled();
    expect(screen.getAllByText('源文件不可用').length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run the focused test and verify failure**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx
```

Expected: details, editor, clipboard status, focus movement, and row menu do not exist.

- [ ] **Step 3: Create the editor and reusable safe confirmation dialog**

Create `src/home/BookmarkEditorDialog.tsx`. Define:

```tsx
type BookmarkEditorDialogProps = {
  bookmark: BookmarkManagementRecord;
  initialFocus: 'title' | 'note';
  saving: boolean;
  error: string | null;
  onSave(updates: BookmarkUpdateInput): void;
  onRequestClose(dirty: boolean): void;
};

type BookmarkConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
};
```

Export both `BookmarkEditorDialog` and `BookmarkConfirmDialog`. Use this focusable selector in both:

```ts
const focusableSelector =
  'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
```

`BookmarkEditorDialog` must:

- initialize `title` and `note` from the bookmark whenever the bookmark ID changes;
- calculate dirty state against the original untrimmed values;
- focus title or note according to `initialFocus`;
- store and restore the previously focused element on mount/unmount;
- render `<form role="dialog" aria-modal="true" aria-label="编辑书签">`;
- render `书签名称` input and `书签备注` textarea;
- block submission with inline `书签名称不能为空。` when `title.trim()` is empty;
- call `onSave({ title: title.trim(), note: note.trim() || null })`;
- call `onRequestClose(dirty)` for Escape, close icon, and cancel when not saving;
- trap Tab/Shift+Tab inside the dialog;
- keep fields and dialog mounted while `saving` or `error` changes;
- label the icon button `关闭编辑书签` and the text cancel button `取消编辑`;
- render persistence `error` with `role="alert"`, set `aria-busy={saving}` on the dialog,
  and disable close, cancel, and save while saving.

`BookmarkConfirmDialog` must:

- use `role="dialog"`, `aria-modal="true"`, and `aria-label={title}`;
- focus the cancel button on mount, including danger confirmations;
- restore the previous focus on unmount;
- trap focus between cancel and confirm;
- close on Escape by calling `onCancel` only when not busy;
- apply `bookmark-management-danger-action` only when `danger` is true;
- set `aria-busy={busy}` on the dialog and disable both buttons while `busy` is true.

- [ ] **Step 4: Create the real detail panel**

Create `src/home/BookmarkDetailPanel.tsx` with:

```tsx
type BookmarkDetailPanelProps = {
  bookmark: BookmarkManagementRecord | null;
  previous: BookmarkManagementRecord | null;
  next: BookmarkManagementRecord | null;
  canOpen: boolean;
  onClearSelection(): void;
  onNavigate(bookmark: BookmarkManagementRecord): void;
  onOpen(bookmark: BookmarkManagementRecord): void;
  onEdit(bookmark: BookmarkManagementRecord, initialFocus: 'title' | 'note'): void;
  onCopy(bookmark: BookmarkManagementRecord): void;
  onDelete(bookmark: BookmarkManagementRecord): void;
};
```

The root is:

```tsx
<aside className="bookmark-management-detail" aria-label="书签详情">
```

When no bookmark is selected, render `请选择一条书签查看详情`. For a selection, render:

- a close button `关闭书签详情`;
- a page placeholder card using `FileText`, `formatBookmarkPageProgress`, ratio, and a native `<progress>` only when percent is non-null;
- the selected title and note (`—` for empty note);
- a document card with name, full path, `formatBookmarkFileSize`, total pages or `—`, missing text, and `打开文档 {displayName}`;
- `章节位置` with the literal `未识别章节`;
- previous/next buttons labelled `上一条书签 {title}` and `下一条书签 {title}`, disabled when absent;
- quick actions labelled `跳转到书签 {title}`, `编辑备注 {title}`, `复制引用 {title}`, and `删除书签 {title}`.

Both open buttons are disabled when `!canOpen`; edit/copy/delete remain enabled for missing documents.

- [ ] **Step 5: Fill the row action menu and keyboard behavior**

Extend `BookmarkGroupListProps` with:

```tsx
  canOpenBookmark(bookmark: BookmarkManagementRecord): boolean;
  onOpenBookmark(bookmark: BookmarkManagementRecord): void;
  onEditBookmark(bookmark: BookmarkManagementRecord): void;
  onCopyBookmark(bookmark: BookmarkManagementRecord): void;
  onDeleteBookmark(bookmark: BookmarkManagementRecord): void;
```

Replace the empty action cell with one icon trigger and a conditional menu. The menu items, in order, are:

```tsx
[
  { label: `跳转到书签 ${bookmark.title}`, disabled: !canOpenBookmark(bookmark), action: onOpenBookmark },
  { label: `编辑书签 ${bookmark.title}`, disabled: false, action: onEditBookmark },
  { label: `复制引用 ${bookmark.title}`, disabled: false, action: onCopyBookmark },
  { label: `删除书签 ${bookmark.title}`, disabled: false, action: onDeleteBookmark },
]
```

Use `role="menu"` / `role="menuitem"`, `aria-label="书签操作 {title}"`, and a trigger `aria-label="打开书签操作 {title}"`. Keep trigger and item refs keyed by persisted ID. On open, focus the first enabled item. Handle:

```ts
function moveMenuFocus(
  event: React.KeyboardEvent<HTMLElement>,
  items: HTMLButtonElement[],
  close: () => void,
  restore: () => void,
) {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    restore();
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    return;
  }

  event.preventDefault();
  const enabledItems = items.filter((item) => !item.disabled);
  if (enabledItems.length === 0) {
    return;
  }
  const current = Math.max(
    0,
    enabledItems.indexOf(document.activeElement as HTMLButtonElement),
  );
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? enabledItems.length - 1
        : event.key === 'ArrowDown'
          ? (current + 1) % enabledItems.length
          : (current - 1 + enabledItems.length) % enabledItems.length;
  enabledItems[index]?.focus();
}
```

Add `data-testid={`bookmark-management-row-${bookmark.id}`}` for persisted rows. Every menu action first closes the menu, then invokes its callback; Escape closes and returns focus to the trigger. Actions must stop row click propagation.

- [ ] **Step 6: Wire detail, editing, clipboard, and focus in shared content**

In `BookmarkManagementContent` add state:

```tsx
const [editor, setEditor] = useState<{
  bookmark: BookmarkManagementRecord;
  initialFocus: 'title' | 'note';
} | null>(null);
const [editorSaving, setEditorSaving] = useState(false);
const [editorError, setEditorError] = useState<string | null>(null);
const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
const [copyStatus, setCopyStatus] = useState<{
  tone: 'status' | 'alert';
  message: string;
} | null>(null);
```

Derive neighbors with:

```tsx
const adjacent = management.selectedBookmark?.id == null
  ? { previous: null, next: null }
  : findAdjacentBookmarks(records, management.selectedBookmark.id);
```

Use these handlers:

```tsx
const openEditor = (
  bookmark: BookmarkManagementRecord,
  initialFocus: 'title' | 'note',
) => {
  setEditor({ bookmark, initialFocus });
  setEditorError(null);
};

const saveEditor = async (updates: BookmarkUpdateInput) => {
  if (!editor) {
    return;
  }
  setEditorSaving(true);
  setEditorError(null);
  try {
    await onUpdateBookmark(editor.bookmark, updates);
    setEditor(null);
  } catch {
    setEditorError('书签保存失败，请重试。');
  } finally {
    setEditorSaving(false);
  }
};

const copyReference = async (bookmark: BookmarkManagementRecord) => {
  setCopyStatus(null);
  try {
    if (!navigator.clipboard?.writeText) {
      throw new Error('clipboard unavailable');
    }
    await navigator.clipboard.writeText(buildBookmarkReference(bookmark));
    setCopyStatus({ tone: 'status', message: '引用已复制' });
  } catch {
    setCopyStatus({ tone: 'alert', message: '复制引用失败，请重试。' });
  }
};
```

Pass selection and action callbacks to list/detail. Render `copyStatus` with its corresponding role. Render the editor and, when dirty close is requested, keep it mounted behind `BookmarkConfirmDialog`:

```tsx
<BookmarkConfirmDialog
  title="放弃书签更改"
  message="当前名称或备注尚未保存。"
  confirmLabel="放弃更改"
  cancelLabel="继续编辑"
  danger
  onCancel={() => setDiscardConfirmOpen(false)}
  onConfirm={() => {
    setDiscardConfirmOpen(false);
    setEditor(null);
  }}
/>
```

When the user navigates to an adjacent bookmark, call `management.navigateToBookmark`.

- [ ] **Step 7: Make adjacent navigation reveal filtered-out targets**

Update `navigateToBookmark` in `useBookmarkManagement` so an adjacent target is guaranteed visible:

```ts
  const navigateToBookmark = (record: BookmarkManagementRecord) => {
    if (record.id == null) {
      return;
    }

    const targetDocumentKey = documentKey === 'all' ? 'all' : record.documentKey;
    const targetPage = deriveBookmarkPage(records, {
      query: '',
      documentKey: targetDocumentKey,
      dateFilter: 'all',
      sortMode,
      page: 1,
      pageSize,
      now: effectiveNow,
    });

    setQueryState('');
    setDateFilterState('all');
    setDocumentKeyState(targetDocumentKey);
    setExpandedDocumentKeys((current) => new Set(current).add(record.documentKey));
    setPage(findBookmarkPage(targetPage.allMatchingBookmarks, record.id, pageSize));
    setSelectedBookmarkId(record.id);
    setPendingFocusId(record.id);
  };
```

This deliberately clears search/date only for explicit adjacent navigation; ordinary filtering still clears a hidden selection.

- [ ] **Step 8: Run focused UI verification**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx
bun run test src/home/bookmarkManagementUtils.test.ts
bun run typecheck
git diff --check -- src/home/BookmarkDetailPanel.tsx src/home/BookmarkEditorDialog.tsx src/home/BookmarkGroupList.tsx src/home/BookmarkManagementContent.tsx src/home/useBookmarkManagement.ts src/home/HomeBookmarksWorkspace.test.tsx
```

Expected: selection is separate from jumping; details use only real fields; editor preserves failed input; dirty Escape confirms; copy reports both outcomes; row menus and adjacent focus are keyboard accessible.

- [ ] **Step 9: Commit Task 7**

```bash
git add src/home/BookmarkDetailPanel.tsx src/home/BookmarkEditorDialog.tsx src/home/BookmarkGroupList.tsx src/home/BookmarkManagementContent.tsx src/home/useBookmarkManagement.ts src/home/HomeBookmarksWorkspace.test.tsx
git commit -m "feat: add bookmark details and editing"
```

---

### Task 8: Add Confirmed Single Delete and Partial-Failure Batch Delete

**Files:**
- Modify: `src/home/BookmarkManagementContent.tsx`
- Modify: `src/home/BookmarkGroupList.tsx`
- Modify: `src/home/useBookmarkManagement.ts`
- Modify: `src/home/HomeBookmarksWorkspace.test.tsx`

- [ ] **Step 1: Add failing single-delete tests**

Add:

```tsx
import type { BookmarkDeleteResult } from './bookmarkManagementUtils';
```

Append:

```tsx
  it('cancels single delete with safe default focus', () => {
    const props = renderWorkspace();
    fireEvent.click(screen.getByText('自注意力机制'));
    const trigger = screen.getByRole('button', { name: '删除书签 自注意力机制' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: '删除书签' });
    expect(dialog).toHaveTextContent('自注意力机制');
    expect(dialog).toHaveTextContent('此操作不可撤销');
    expect(screen.getByRole('button', { name: '取消删除' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('button', { name: '确认删除' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(screen.getByRole('button', { name: '取消删除' })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: '取消删除' }));
    expect(props.onDeleteBookmarks).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: '删除书签' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('selects the next same-document bookmark after successful single delete', async () => {
    const onDeleteBookmarks = vi.fn().mockResolvedValue({
      succeededIds: [1],
      failedIds: [],
    });
    renderWorkspace({ onDeleteBookmarks });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '删除书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    await waitFor(() => {
      expect(onDeleteBookmarks).toHaveBeenCalledWith([
        expect.objectContaining({ id: 1, title: '自注意力机制' }),
      ]);
    });
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      '多头注意力',
    );
  });

  it('keeps the selected bookmark when single delete fails', async () => {
    renderWorkspace({
      onDeleteBookmarks: vi.fn().mockResolvedValue({
        succeededIds: [],
        failedIds: [1],
      }),
    });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '删除书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('删除书签失败，请重试。');
    expect(screen.getByTestId('bookmark-management-row-1')).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('disables every confirmation action while deletion is pending', () => {
    renderWorkspace({
      onDeleteBookmarks: vi.fn(
        () => new Promise<BookmarkDeleteResult>(() => undefined),
      ),
    });
    fireEvent.click(screen.getByText('自注意力机制'));
    fireEvent.click(screen.getByRole('button', { name: '删除书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }));

    expect(screen.getByRole('dialog', { name: '删除书签' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    expect(screen.getByRole('button', { name: '确认删除' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消删除' })).toBeDisabled();
  });
```

- [ ] **Step 2: Add failing batch-mode tests**

Append:

```tsx
  it('selects only the current page in batch mode and cancels without clearing detail', () => {
    const pagedDashboard: BookmarkDashboard = {
      totalBookmarks: 21,
      groups: [
        {
          ...dashboard.groups[0],
          bookmarkCount: 21,
          bookmarks: Array.from({ length: 21 }, (_, index) => ({
            id: index + 1,
            documentKey: 'desktop:/papers/transformer.pdf',
            page: index + 1,
            title: `Bookmark ${index + 1}`,
            note: null,
            createdAt: `2026-07-${String((index % 20) + 1).padStart(2, '0')}T09:00:00+08:00`,
            updatedAt: '2026-07-20T09:00:00+08:00',
          })),
        },
      ],
    };
    renderWorkspace({ dashboard: pagedDashboard });
    fireEvent.click(screen.getByText('Bookmark 1'));
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页书签' }));

    expect(screen.getByText('已选择 20 条书签')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox', { name: /选择书签/ })).toHaveLength(20);
    fireEvent.click(screen.getByRole('button', { name: '下一页' }));
    expect(screen.getByRole('checkbox', { name: '选择当前页书签' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择书签 Bookmark 21' })).not.toBeChecked();
    expect(screen.getByText('已选择 20 条书签')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '取消批量操作' }));
    expect(screen.queryByRole('checkbox', { name: '选择当前页书签' })).not.toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: '书签详情' })).toHaveTextContent(
      'Bookmark 1',
    );
  });

  it('retains only failed IDs after partial batch deletion', async () => {
    const onDeleteBookmarks = vi.fn().mockResolvedValue({
      succeededIds: [1],
      failedIds: [2],
    });
    renderWorkspace({ onDeleteBookmarks });
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 多头注意力' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除 2 条书签' }));

    expect(screen.getByRole('dialog', { name: '批量删除书签' })).toHaveTextContent('2 条');
    fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }));

    await waitFor(() => {
      expect(onDeleteBookmarks).toHaveBeenCalledWith([
        expect.objectContaining({ id: 1 }),
        expect.objectContaining({ id: 2 }),
      ]);
    });
    expect(screen.getByRole('status')).toHaveTextContent('成功 1 条，失败 1 条');
    expect(screen.getByRole('checkbox', { name: '选择书签 自注意力机制' })).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: '选择书签 多头注意力' })).toBeChecked();
    expect(screen.getByText('已选择 1 条书签')).toBeInTheDocument();
  });

  it('exits batch mode after all selected bookmarks are deleted', async () => {
    renderWorkspace({
      onDeleteBookmarks: vi.fn().mockResolvedValue({
        succeededIds: [1, 2],
        failedIds: [],
      }),
    });
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 自注意力机制' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 多头注意力' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除 2 条书签' }));
    fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }));

    await waitFor(() => {
      expect(screen.queryByRole('checkbox', { name: '选择当前页书签' })).not.toBeInTheDocument();
    });
    expect(screen.getByRole('status')).toHaveTextContent('成功 2 条，失败 0 条');
  });
```

- [ ] **Step 3: Run tests and verify delete/batch failures**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx
```

Expected: confirmation, batch checkboxes, result retention, and selection fallback are absent.

- [ ] **Step 4: Make current-page selection semantically correct**

In `BookmarkGroupList`, render exactly one current-page checkbox at the list root,
before all document sections, and only in batch mode. Do not repeat it in each
document table; batch-mode tables use an empty first-column heading labelled for
screen readers as `选择`. Use:

```tsx
<input
  type="checkbox"
  aria-label="选择当前页书签"
  checked={allVisibleSelected}
  ref={(element) => {
    if (element) {
      const selectedOnPage = groups
        .flatMap((group) => group.bookmarks)
        .filter((bookmark) => bookmark.id != null && selectedBatchIds.has(bookmark.id))
        .length;
      element.indeterminate = selectedOnPage > 0 && !allVisibleSelected;
    }
  }}
  onChange={(event) => onToggleVisibleBatchSelection(event.target.checked)}
/>
```

Each persisted row gets:

```tsx
<input
  type="checkbox"
  aria-label={`选择书签 ${bookmark.title}`}
  checked={selectedBatchIds.has(bookmark.id!)}
  onClick={(event) => event.stopPropagation()}
  onChange={(event) => onToggleBatchSelection(bookmark.id!, event.target.checked)}
/>
```

Do not render a checkbox for `id === null`.

- [ ] **Step 5: Add deletion state and selected-record derivation**

In `BookmarkManagementContent` add:

```tsx
type DeleteConfirmation =
  | { kind: 'single'; bookmarks: BookmarkManagementRecord[] }
  | { kind: 'batch'; bookmarks: BookmarkManagementRecord[] };

const [deleteConfirmation, setDeleteConfirmation] =
  useState<DeleteConfirmation | null>(null);
const [deleteBusy, setDeleteBusy] = useState(false);
const [deleteError, setDeleteError] = useState<string | null>(null);
const [deleteStatus, setDeleteStatus] = useState<string | null>(null);

const selectedBatchBookmarks = records.filter(
  (record) => record.id != null && management.selectedBatchIds.has(record.id),
);
```

Keep `BookmarkBatchToolbar` as a private component in
`BookmarkManagementContent.tsx` with `selectedCount: number` and
`onRequestDelete(): void` props. Render it only in batch mode; it owns only this
markup and no selection state:

```tsx
<div className="bookmark-management-batch-toolbar" role="region" aria-label="书签批量操作">
  <strong>已选择 {selectedBatchBookmarks.length} 条书签</strong>
  <button
    type="button"
    disabled={selectedBatchBookmarks.length === 0}
    onClick={() =>
      setDeleteConfirmation({ kind: 'batch', bookmarks: selectedBatchBookmarks })
    }
  >
    批量删除 {selectedBatchBookmarks.length} 条书签
  </button>
</div>
```

The existing toolbar’s `取消批量操作` remains the sole cancel button and calls `management.cancelBatchMode()`.

- [ ] **Step 6: Implement single and batch confirmation handlers**

Use:

```tsx
const requestSingleDelete = (bookmark: BookmarkManagementRecord) => {
  setDeleteError(null);
  setDeleteConfirmation({ kind: 'single', bookmarks: [bookmark] });
};

const confirmDelete = async () => {
  if (!deleteConfirmation) {
    return;
  }

  const target = deleteConfirmation;
  const fallbackId =
    target.kind === 'single' && target.bookmarks[0].id != null
      ? findSelectionAfterDelete(
          management.derived.allMatchingBookmarks,
          target.bookmarks[0].id,
        )
      : null;
  setDeleteBusy(true);
  setDeleteError(null);
  setDeleteStatus(null);

  try {
    const result = await onDeleteBookmarks(target.bookmarks);
    if (target.kind === 'single') {
      const id = target.bookmarks[0].id;
      if (id != null && result.succeededIds.includes(id)) {
        management.setSelectedBookmarkId(fallbackId);
        setDeleteConfirmation(null);
      } else {
        setDeleteError('删除书签失败，请重试。');
      }
      return;
    }

    management.setSelectedBatchIds(new Set(result.failedIds));
    setDeleteStatus(
      `批量删除完成：成功 ${result.succeededIds.length} 条，失败 ${result.failedIds.length} 条`,
    );
    setDeleteConfirmation(null);
    if (result.failedIds.length === 0) {
      management.setBatchMode(false);
    }
  } catch {
    setDeleteError(
      target.kind === 'single'
        ? '删除书签失败，请重试。'
        : '批量删除失败，所选书签未发生变化。',
    );
  } finally {
    setDeleteBusy(false);
  }
};
```

Pass `requestSingleDelete` to both the row menu and detail panel. The delete callback receives records in the same order as `records.filter`, which is the stable dashboard order.

- [ ] **Step 7: Render safe confirmation and async result messages**

For a single record:

```tsx
<BookmarkConfirmDialog
  title="删除书签"
  message={`确定删除“${deleteConfirmation.bookmarks[0].title}”吗？此操作不可撤销。`}
  confirmLabel="确认删除"
  cancelLabel="取消删除"
  danger
  busy={deleteBusy}
  onCancel={() => {
    setDeleteError(null);
    setDeleteConfirmation(null);
  }}
  onConfirm={() => void confirmDelete()}
/>
```

For batch:

```tsx
<BookmarkConfirmDialog
  title="批量删除书签"
  message={`确定删除选中的 ${deleteConfirmation.bookmarks.length} 条书签吗？此操作不可撤销。`}
  confirmLabel="确认批量删除"
  cancelLabel="取消批量删除"
  danger
  busy={deleteBusy}
  onCancel={() => {
    setDeleteError(null);
    setDeleteConfirmation(null);
  }}
  onConfirm={() => void confirmDelete()}
/>
```

Render `deleteError` as `role="alert"` inside or immediately adjacent to the active confirmation. Render `deleteStatus` as `role="status"`. The exact batch status text must contain `成功 N 条，失败 M 条`, as in the handler.

- [ ] **Step 8: Run focused delete/batch verification**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx
bun run typecheck
git diff --check -- src/home/BookmarkManagementContent.tsx src/home/BookmarkGroupList.tsx src/home/useBookmarkManagement.ts src/home/HomeBookmarksWorkspace.test.tsx
```

Expected: danger confirmations focus cancel; single failure preserves selection; successful single delete applies the deterministic fallback; batch mode selects only current page; partial failures retain only failed IDs; all-success exits batch mode.

- [ ] **Step 9: Commit Task 8**

```bash
git add src/home/BookmarkManagementContent.tsx src/home/BookmarkGroupList.tsx src/home/useBookmarkManagement.ts src/home/HomeBookmarksWorkspace.test.tsx
git commit -m "feat: add bookmark deletion workflows"
```

---

### Task 9: Integrate One Dashboard Source into ReaderApp, Both Routes, and Global Search

**Files:**
- Modify: `src/app/ReaderApp.tsx:20-31`
- Modify: `src/app/ReaderApp.tsx:88-110`
- Modify: `src/app/ReaderApp.tsx:127-169`
- Modify: `src/app/ReaderApp.tsx:361-432`
- Modify: `src/app/ReaderApp.tsx:902-1002`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx:1-112`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx:242-261`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx:316-379`
- Modify: `src/home/HomeDashboard.tsx:9-90`
- Modify: `src/home/HomeDashboard.tsx:92-140`
- Modify: `src/home/HomeDashboard.tsx:322-333`
- Modify: `src/app/ReaderWorkspaceSwitch.test.tsx`
- Modify: `src/home/HomeDashboard.test.tsx`
- Modify: `src/app/App.test.tsx`

- [ ] **Step 1: Update shared test defaults before changing production props**

In `src/app/ReaderWorkspaceSwitch.test.tsx`, add:

```ts
const emptyBookmarkDashboard = {
  totalBookmarks: 0,
  groups: [],
};
```

Replace `globalSearchBookmarkError` / `globalSearchBookmarks` defaults with:

```ts
    bookmarkDashboard: emptyBookmarkDashboard,
    bookmarkDashboardError: null,
    bookmarkDashboardLoading: false,
```

Add:

```ts
    deleteManagedBookmarks: vi.fn().mockResolvedValue({
      succeededIds: [],
      failedIds: [],
    }),
    refreshBookmarkDashboard: vi.fn(),
    updateManagedBookmark: vi.fn().mockResolvedValue(undefined),
```

Keep `deleteBookmark` and `renameBookmark`; they still serve reader-inline actions.

In `src/home/HomeDashboard.test.tsx`, replace the old inline rename/delete test with a dashboard-prop routing test:

```tsx
  it('renders the shared bookmark workspace inside the home dashboard frame', () => {
    const bookmarkDashboard = {
      totalBookmarks: 1,
      groups: [
        {
          document: {
            documentKey: 'desktop:/Users/mario/Papers/Book.pdf',
            displayName: 'Book.pdf',
            path: '/Users/mario/Papers/Book.pdf',
            missing: false,
            fileSize: 1024,
            pageCount: 20,
          },
          bookmarkCount: 1,
          bookmarks: [
            {
              id: 7,
              documentKey: 'desktop:/Users/mario/Papers/Book.pdf',
              page: 12,
              title: '关键段落',
              note: '复核结论',
              createdAt: '2026-07-07T10:00:00+08:00',
              updatedAt: '2026-07-07T10:00:00+08:00',
            },
          ],
        },
      ],
    };

    renderDashboard({
      activeSidebarPage: 'bookmarks',
      bookmarkDashboard,
      bookmarkDashboardLoading: false,
      bookmarkDashboardError: null,
      onUpdateBookmark: vi.fn(),
      onDeleteBookmarks: vi.fn(),
      onRefreshBookmarks: vi.fn(),
    });

    expect(screen.getByRole('button', { name: '书签管理' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('region', { name: '书签管理' })).toBeInTheDocument();
    expect(screen.getByText('关键段落')).toBeInTheDocument();
    expect(screen.queryByLabelText('书签管理工作区')).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Add failing switch tests for shared rendering and navigation decoupling**

Add to `ReaderWorkspaceSwitch.test.tsx`:

```tsx
  it('uses the same bookmark dashboard in home and standalone routes', () => {
    const bookmarkDashboard = {
      totalBookmarks: 1,
      groups: [
        {
          document: {
            documentKey: 'desktop:/tmp/shared.pdf',
            displayName: 'shared.pdf',
            path: '/tmp/shared.pdf',
            missing: false,
            fileSize: 1024,
            pageCount: 10,
          },
          bookmarkCount: 1,
          bookmarks: [
            {
              id: 1,
              documentKey: 'desktop:/tmp/shared.pdf',
              page: 4,
              title: 'Shared bookmark',
              note: null,
              createdAt: '2026-07-20T00:00:00Z',
              updatedAt: '2026-07-20T00:00:00Z',
            },
          ],
        },
      ],
    };
    const { unmount } = renderSwitch({
      activeWorkspace: 'home',
      activeSidebarPage: 'bookmarks',
      bookmarkDashboard,
    });
    expect(screen.getByText('Shared bookmark')).toBeInTheDocument();
    unmount();

    renderSwitch({
      activeWorkspace: 'bookmarks',
      bookmarkDashboard,
    });
    expect(screen.getByLabelText('书签管理工作区')).toBeInTheDocument();
    expect(screen.getByText('Shared bookmark')).toBeInTheDocument();
  });

  it('opens bookmark management and refreshes it without opening global search', () => {
    const openHomeSidebarPage = vi.fn();
    const openGlobalSearch = vi.fn();
    const refreshBookmarkDashboard = vi.fn();
    renderSwitch({
      openHomeSidebarPage,
      openGlobalSearch,
      refreshBookmarkDashboard,
    });

    fireEvent.click(screen.getByRole('button', { name: '书签管理' }));

    expect(openHomeSidebarPage).toHaveBeenCalledWith('bookmarks');
    expect(refreshBookmarkDashboard).toHaveBeenCalledTimes(1);
    expect(openGlobalSearch).not.toHaveBeenCalled();
  });
```

Change the test import to include `fireEvent`, and make `renderSwitch` return Testing Library’s render result:

```tsx
  return render(<ReaderWorkspaceSwitch {...props} />);
```

- [ ] **Step 3: Run routing tests and verify prop-contract failure**

```bash
bun run test src/app/ReaderWorkspaceSwitch.test.tsx src/home/HomeDashboard.test.tsx
```

Expected: new dashboard props and callbacks are not accepted; the old route still consumes global-search arrays.

- [ ] **Step 4: Replace HomeDashboard bookmark props and render path**

Import:

```ts
import type { BookmarkDashboard, PersistedDocument } from '../persistence/persistenceApi';
import type {
  BookmarkDeleteResult,
  BookmarkManagementRecord,
  BookmarkUpdateInput,
} from './bookmarkManagementUtils';
```

Replace old bookmark props with:

```ts
  bookmarkDashboard?: BookmarkDashboard | null;
  bookmarkDashboardLoading?: boolean;
  bookmarkDashboardError?: string | null;
  canOpenBookmark?(bookmark: BookmarkManagementRecord): boolean;
  onOpenBookmark?(bookmark: BookmarkManagementRecord): void | Promise<void>;
  onUpdateBookmark?(
    bookmark: BookmarkManagementRecord,
    updates: BookmarkUpdateInput,
  ): Promise<void>;
  onDeleteBookmarks?(
    bookmarks: BookmarkManagementRecord[],
  ): Promise<BookmarkDeleteResult>;
  onRefreshBookmarks?(): void | Promise<void>;
```

Use these defaults in the function parameters:

```ts
  bookmarkDashboard = null,
  bookmarkDashboardLoading = false,
  bookmarkDashboardError = null,
  canOpenBookmark = () => true,
  onOpenBookmark = noop,
  onUpdateBookmark = async () => undefined,
  onDeleteBookmarks = async () => ({ succeededIds: [], failedIds: [] }),
  onRefreshBookmarks = noop,
```

Replace `bookmarksContent` with:

```tsx
  const bookmarksContent = (
    <div className="home-content bookmark-management-home-content">
      <HomeBookmarksWorkspace
        dashboard={bookmarkDashboard}
        loading={bookmarkDashboardLoading}
        error={bookmarkDashboardError}
        canOpenBookmark={canOpenBookmark}
        onOpenPdf={handleOpenPdf}
        onOpenBookmark={onOpenBookmark}
        onUpdateBookmark={onUpdateBookmark}
        onDeleteBookmarks={onDeleteBookmarks}
        onRefresh={onRefreshBookmarks}
      />
    </div>
  );
```

- [ ] **Step 5: Replace ReaderWorkspaceSwitch bookmark props**

Import `BookmarkDashboard` and the three types from `bookmarkManagementUtils`. Remove `PersistedBookmarkRecord` from this file.

Replace:

```ts
  globalSearchBookmarkError: string | null;
  globalSearchBookmarks: PersistedBookmarkRecord[];
```

with:

```ts
  bookmarkDashboard: BookmarkDashboard | null;
  bookmarkDashboardError: string | null;
  bookmarkDashboardLoading: boolean;
```

Add:

```ts
  deleteManagedBookmarks(
    bookmarks: BookmarkManagementRecord[],
  ): Promise<BookmarkDeleteResult>;
  refreshBookmarkDashboard(): void | Promise<void>;
  updateManagedBookmark(
    bookmark: BookmarkManagementRecord,
    updates: BookmarkUpdateInput,
  ): Promise<void>;
```

Update both bookmark render branches to pass:

```tsx
dashboard={bookmarkDashboard}
loading={bookmarkDashboardLoading}
error={bookmarkDashboardError}
canOpenBookmark={(bookmark) =>
  canOpenRecordPage(bookmark.documentKey, bookmark.documentPath, bookmark.documentMissing)
}
onOpenPdf={openPdf}
onOpenBookmark={(bookmark) =>
  void openRecordPage(
    bookmark.documentKey,
    bookmark.documentPath,
    bookmark.page,
    bookmark.documentMissing,
  )
}
onUpdateBookmark={updateManagedBookmark}
onDeleteBookmarks={deleteManagedBookmarks}
onRefresh={refreshBookmarkDashboard}
```

The standalone branch also passes `onClose={closeToolWorkspace}`. The `HomeDashboard` branch uses the corresponding prop names from Step 4.

Replace its home `onOpenBookmarks` callback with:

```tsx
onOpenBookmarks={() => {
  openHomeSidebarPage('bookmarks');
  void refreshBookmarkDashboard();
}}
```

Do not call `openGlobalSearch` in this callback.

- [ ] **Step 6: Add ReaderApp’s single dashboard state and flatten it for global search**

Import:

```ts
import type {
  BookmarkDashboard,
  CacheStats,
  PersistedAnnotationRecord,
  PersistedDocument,
  PersistedSessionTab,
} from '../persistence/persistenceApi';
import {
  flattenBookmarkDashboard,
  type BookmarkDeleteResult,
  type BookmarkManagementRecord,
  type BookmarkUpdateInput,
} from '../home/bookmarkManagementUtils';
```

Remove the `globalSearchBookmarks` and `globalSearchBookmarkError` states. Add:

```ts
  const [bookmarkDashboard, setBookmarkDashboard] = useState<BookmarkDashboard | null>(null);
  const [bookmarkDashboardLoading, setBookmarkDashboardLoading] = useState(false);
  const [bookmarkDashboardError, setBookmarkDashboardError] = useState<string | null>(null);
```

Replace `globalSearchRefreshRequestRef` with:

```ts
  const bookmarkDashboardRequestRef = useRef(0);
  const annotationRefreshRequestRef = useRef(0);
```

After state declarations, derive:

```ts
  const globalSearchBookmarks = useMemo(
    () => flattenBookmarkDashboard(bookmarkDashboard),
    [bookmarkDashboard],
  );
```

Destructure the new hook operation:

```ts
    updateBookmarkForDocument,
```

Remove the old early `handleRenameBookmark` / `handleDeleteBookmark` definitions; re-add them after the refresh callbacks in Step 8 so dependencies are initialized in declaration order.

- [ ] **Step 7: Split dashboard refresh from annotation refresh**

Replace `refreshGlobalSearchCollections` with:

```ts
  const refreshBookmarkDashboard = useCallback(async () => {
    bookmarkDashboardRequestRef.current += 1;
    const requestId = bookmarkDashboardRequestRef.current;
    setBookmarkDashboardLoading(true);
    setBookmarkDashboardError(null);

    try {
      const dashboard = await persistence.loadBookmarkDashboard();
      if (requestId === bookmarkDashboardRequestRef.current) {
        setBookmarkDashboard(dashboard);
        setBookmarkDashboardError(null);
      }
    } catch {
      if (requestId === bookmarkDashboardRequestRef.current) {
        setBookmarkDashboardError(bookmarkProviderErrorMessage);
      }
    } finally {
      if (requestId === bookmarkDashboardRequestRef.current) {
        setBookmarkDashboardLoading(false);
      }
    }
  }, [persistence]);

  const refreshGlobalSearchAnnotations = useCallback(() => {
    annotationRefreshRequestRef.current += 1;
    const requestId = annotationRefreshRequestRef.current;
    setGlobalSearchAnnotationError(null);

    void persistence
      .listAllAnnotations()
      .then((annotations) => {
        if (requestId === annotationRefreshRequestRef.current) {
          setGlobalSearchAnnotations(annotations);
          setGlobalSearchAnnotationError(null);
        }
      })
      .catch(() => {
        if (requestId === annotationRefreshRequestRef.current) {
          setGlobalSearchAnnotations([]);
          setGlobalSearchAnnotationError(annotationProviderErrorMessage);
        }
      });
  }, [persistence]);

  const refreshGlobalSearchCollections = useCallback(() => {
    void refreshBookmarkDashboard();
    refreshGlobalSearchAnnotations();
  }, [refreshBookmarkDashboard, refreshGlobalSearchAnnotations]);
```

The bookmark failure path deliberately does not clear `bookmarkDashboard`; this is the required background-refresh behavior.

- [ ] **Step 8: Add one-update, reader-compatibility, and sequential-delete handlers**

Define after Step 7:

```ts
  const updateManagedBookmark = useCallback(
    async (bookmark: BookmarkManagementRecord, updates: BookmarkUpdateInput) => {
      const saved = await updateBookmarkForDocument(
        bookmark.documentKey,
        bookmark,
        updates,
      );
      if (!saved || saved.id === null) {
        throw new Error('bookmark is not persisted');
      }
      await refreshBookmarkDashboard();
    },
    [refreshBookmarkDashboard, updateBookmarkForDocument],
  );

  const deleteManagedBookmarks = useCallback(
    async (
      bookmarks: BookmarkManagementRecord[],
    ): Promise<BookmarkDeleteResult> => {
      const succeededIds: number[] = [];
      const failedIds: number[] = [];

      for (const bookmark of bookmarks) {
        if (bookmark.id === null) {
          continue;
        }
        try {
          await deleteBookmarkForDocument(bookmark.documentKey, bookmark.id);
          succeededIds.push(bookmark.id);
        } catch {
          failedIds.push(bookmark.id);
        }
      }

      await refreshBookmarkDashboard();
      return { succeededIds, failedIds };
    },
    [deleteBookmarkForDocument, refreshBookmarkDashboard],
  );

  const handleRenameBookmark = useCallback(
    async (bookmark: Bookmark, title: string) => {
      const saved = await updateBookmarkForDocument(bookmark.documentKey, bookmark, {
        title,
        note: bookmark.note,
      });
      if (saved?.id != null) {
        await refreshBookmarkDashboard();
      }
    },
    [refreshBookmarkDashboard, updateBookmarkForDocument],
  );

  const handleDeleteBookmark = useCallback(
    async (bookmark: Bookmark) => {
      if (bookmark.id === null) {
        return;
      }
      await deleteBookmarkForDocument(bookmark.documentKey, bookmark.id);
      await refreshBookmarkDashboard();
    },
    [deleteBookmarkForDocument, refreshBookmarkDashboard],
  );
```

This preserves reader-inline rename/delete behavior while management batch deletion refreshes only once.

- [ ] **Step 9: Decouple all open paths**

Keep:

```ts
  const openGlobalSearch = useCallback(() => {
    setGlobalSearchOpen(true);
    refreshGlobalSearchCollections();
  }, [refreshGlobalSearchCollections]);
```

Change `openShortcutWorkspace` to:

```ts
  const openShortcutWorkspace = useCallback(
    (workspace: Extract<AppWorkspace, 'import' | 'compare' | 'annotations' | 'bookmarks'>) => {
      if (workspace === 'annotations') {
        refreshGlobalSearchAnnotations();
      }
      if (workspace === 'bookmarks') {
        void refreshBookmarkDashboard();
      }
      setWorkspaceOverride(workspace);
    },
    [refreshBookmarkDashboard, refreshGlobalSearchAnnotations],
  );
```

Opening a home bookmark page remains the Step 5 callback inside `ReaderWorkspaceSwitch`. Opening global search refreshes both providers. Opening annotations does not issue a bookmark request.

- [ ] **Step 10: Pass the new state and operations to the switch and search**

Remove `globalSearchBookmarkError` / `globalSearchBookmarks` props from `ReaderWorkspaceSwitch`. Pass:

```tsx
bookmarkDashboard={bookmarkDashboard}
bookmarkDashboardError={bookmarkDashboardError}
bookmarkDashboardLoading={bookmarkDashboardLoading}
deleteManagedBookmarks={deleteManagedBookmarks}
refreshBookmarkDashboard={refreshBookmarkDashboard}
updateManagedBookmark={updateManagedBookmark}
```

Keep `GlobalSearchPanel` outside the switch and change only:

```tsx
bookmarkError={bookmarkDashboardError}
bookmarks={globalSearchBookmarks}
```

- [ ] **Step 11: Convert App test fixtures from list-all arrays to dashboards**

Import `BookmarkDashboard`. Add this helper near `createDeferred`:

```ts
function dashboardFromRecords(
  records: PersistedBookmarkRecord[],
  fileSize: number | null = null,
  pageCount: number | null = null,
): BookmarkDashboard {
  const groups = new Map<string, PersistedBookmarkRecord[]>();
  for (const record of records) {
    const group = groups.get(record.documentKey) ?? [];
    group.push(record);
    groups.set(record.documentKey, group);
  }

  return {
    totalBookmarks: records.length,
    groups: [...groups.values()].map((bookmarks) => ({
      document: {
        documentKey: bookmarks[0].documentKey,
        displayName: bookmarks[0].documentDisplayName ?? bookmarks[0].documentKey,
        path: bookmarks[0].documentPath,
        missing: bookmarks[0].documentMissing,
        fileSize,
        pageCount,
      },
      bookmarkCount: bookmarks.length,
      bookmarks: bookmarks.map((bookmark) => ({
        id: bookmark.id,
        documentKey: bookmark.documentKey,
        page: bookmark.page,
        title: bookmark.title,
        note: bookmark.note,
        createdAt: bookmark.createdAt,
        updatedAt: bookmark.updatedAt,
      })),
    })),
  };
}
```

For existing tests, replace:

```ts
listAllBookmarks: vi.fn().mockResolvedValue(bookmarkRecords)
```

with:

```ts
loadBookmarkDashboard: vi.fn().mockResolvedValue(
  dashboardFromRecords(bookmarkRecords, 2048, 20),
)
```

Change expectations from `listAllBookmarks` to `loadBookmarkDashboard`.

Update the two manager-record navigation tests for the new “select, then act” contract. Replace the old row-button click with:

```tsx
fireEvent.click(await screen.findByText('关键书签'));
fireEvent.click(screen.getByRole('button', { name: '跳转到书签 关键书签' }));
```

and:

```tsx
fireEvent.click(await screen.findByText('失效书签'));
fireEvent.click(screen.getByRole('button', { name: '跳转到书签 失效书签' }));
```

Keep the existing PDF reopen, page-jump, and “manager remains visible on failure” assertions.

In the stale refresh test, change deferred types to `BookmarkDashboard`, resolve `dashboardFromRecords(freshBookmarks)` before `dashboardFromRecords(oldBookmarks)`, and assert `loadBookmarkDashboard` is called twice. The expected visible result remains “Fresh bookmark”, never “Old bookmark”.

Change failure mocks to:

```ts
loadBookmarkDashboard: vi.fn().mockRejectedValue(new Error('bookmark provider failed'))
```

- [ ] **Step 12: Add app-level entry and sequential partial-delete tests**

Strengthen the existing top-bar routing test:

```tsx
const persistence = createEmptyPersistence();
renderApp(
  <App
    bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
    persistence={persistence}
    viewerRenderer={testViewerRenderer}
  />,
);

fireEvent.click(screen.getByRole('button', { name: '书签' }));
expect(await screen.findByRole('region', { name: '书签管理' })).toBeInTheDocument();
expect(persistence.loadBookmarkDashboard).toHaveBeenCalledTimes(1);
expect(persistence.listAllAnnotations).not.toHaveBeenCalled();
expect(screen.queryByRole('dialog', { name: '全局搜索' })).not.toBeInTheDocument();
```

Add:

```tsx
  it('updates a managed bookmark once and refreshes the shared dashboard', async () => {
    const original: PersistedBookmarkRecord = {
      id: 21,
      documentKey: 'desktop:/tmp/edit.pdf',
      page: 7,
      title: 'Original bookmark',
      note: null,
      createdAt: '2026-07-20T00:00:00Z',
      updatedAt: '2026-07-20T00:00:00Z',
      documentDisplayName: 'edit.pdf',
      documentPath: '/tmp/edit.pdf',
      documentMissing: false,
    };
    const updated: PersistedBookmarkRecord = {
      ...original,
      title: 'Updated bookmark',
      note: 'Review this result',
      updatedAt: '2026-07-20T01:00:00Z',
    };
    const saveBookmark = vi
      .fn()
      .mockImplementation(async (bookmark) => ({ ...bookmark, id: original.id }));
    const persistence = {
      ...createEmptyPersistence(),
      saveBookmark,
      loadBookmarkDashboard: vi
        .fn()
        .mockResolvedValueOnce(dashboardFromRecords([original], 1024, 10))
        .mockResolvedValueOnce(dashboardFromRecords([updated], 1024, 10)),
    };
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    fireEvent.click(await screen.findByText('Original bookmark'));
    fireEvent.click(screen.getByRole('button', { name: '编辑备注 Original bookmark' }));
    fireEvent.change(screen.getByRole('textbox', { name: '书签名称' }), {
      target: { value: 'Updated bookmark' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: '书签备注' }), {
      target: { value: 'Review this result' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));

    await waitFor(() => {
      expect(saveBookmark).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 21,
          title: 'Updated bookmark',
          note: 'Review this result',
        }),
      );
    });
    expect(await screen.findAllByText('Updated bookmark')).not.toHaveLength(0);
    expect(persistence.loadBookmarkDashboard).toHaveBeenCalledTimes(2);
  });

  it('deletes selected bookmarks sequentially and retains the failed record', async () => {
    const records: PersistedBookmarkRecord[] = [
      {
        id: 31,
        documentKey: 'desktop:/tmp/batch.pdf',
        page: 3,
        title: 'Delete success',
        note: null,
        createdAt: '2026-07-20T00:00:00Z',
        updatedAt: '2026-07-20T00:00:00Z',
        documentDisplayName: 'batch.pdf',
        documentPath: '/tmp/batch.pdf',
        documentMissing: false,
      },
      {
        id: 32,
        documentKey: 'desktop:/tmp/batch.pdf',
        page: 4,
        title: 'Delete failure',
        note: null,
        createdAt: '2026-07-20T01:00:00Z',
        updatedAt: '2026-07-20T01:00:00Z',
        documentDisplayName: 'batch.pdf',
        documentPath: '/tmp/batch.pdf',
        documentMissing: false,
      },
    ];
    const calls: string[] = [];
    const deleteBookmark = vi.fn().mockImplementation(async (id: number) => {
      calls.push(`start:${id}`);
      await Promise.resolve();
      calls.push(`finish:${id}`);
      if (id === 32) {
        throw new Error('delete failed');
      }
    });
    const persistence = {
      ...createEmptyPersistence(),
      deleteBookmark,
      loadBookmarkDashboard: vi
        .fn()
        .mockResolvedValueOnce(dashboardFromRecords(records, 1024, 10))
        .mockResolvedValueOnce(dashboardFromRecords([records[1]], 1024, 10)),
    };
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    await screen.findByText('Delete success');
    fireEvent.click(screen.getByRole('button', { name: '批量操作' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 Delete success' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择书签 Delete failure' }));
    fireEvent.click(screen.getByRole('button', { name: '批量删除 2 条书签' }));
    fireEvent.click(screen.getByRole('button', { name: '确认批量删除' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('成功 1 条，失败 1 条');
    });
    expect(calls).toEqual([
      'start:31',
      'finish:31',
      'start:32',
      'finish:32',
    ]);
    expect(screen.queryByText('Delete success')).not.toBeInTheDocument();
    expect(screen.getByText('Delete failure')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: '选择书签 Delete failure' })).toBeChecked();
  });

  it('retains the last successful dashboard after a background refresh fails', async () => {
    const records: PersistedBookmarkRecord[] = [
      {
        id: 41,
        documentKey: 'desktop:/tmp/retained.pdf',
        page: 5,
        title: 'Retained bookmark',
        note: null,
        createdAt: '2026-07-20T00:00:00Z',
        updatedAt: '2026-07-20T00:00:00Z',
        documentDisplayName: 'retained.pdf',
        documentPath: '/tmp/retained.pdf',
        documentMissing: false,
      },
    ];
    const persistence = {
      ...createEmptyPersistence(),
      loadBookmarkDashboard: vi
        .fn()
        .mockResolvedValueOnce(dashboardFromRecords(records, 1024, 10))
        .mockRejectedValueOnce(new Error('refresh failed')),
    };
    renderApp(
      <App
        bridge={{ openNativePdf: vi.fn(), readDesktopPdf: vi.fn() }}
        persistence={persistence}
        viewerRenderer={testViewerRenderer}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: '书签' }));
    expect(await screen.findByText('Retained bookmark')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('全局搜索'));
    const searchDialog = await screen.findByRole('dialog', { name: '全局搜索' });
    await within(searchDialog).findByText('书签加载失败，请重试。');
    fireEvent.click(within(searchDialog).getByRole('button', { name: '关闭全局搜索' }));

    expect(screen.getByText('Retained bookmark')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('书签加载失败，请重试。');
    expect(screen.getByRole('button', { name: '重新加载书签' })).toBeInTheDocument();
  });
```

- [ ] **Step 13: Run all integration-focused tests**

```bash
bun run test src/app/ReaderWorkspaceSwitch.test.tsx src/home/HomeDashboard.test.tsx src/home/HomeBookmarksWorkspace.test.tsx src/app/App.test.tsx src/search/globalSearch.test.ts
bun run typecheck
git diff --check -- src/app/ReaderApp.tsx src/app/ReaderWorkspaceSwitch.tsx src/home/HomeDashboard.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/home/HomeDashboard.test.tsx src/app/App.test.tsx
```

Expected:

- home and standalone routes share the same content;
- bookmark navigation does not open global search;
- global search still refreshes both providers and derives bookmarks from dashboard;
- stale dashboard requests cannot win;
- background dashboard errors retain old data;
- reader rename/delete and management edits keep dashboard synchronized;
- batch deletion is sequential and retains failed IDs.

- [ ] **Step 14: Commit Task 9**

```bash
git add src/app/ReaderApp.tsx src/app/ReaderWorkspaceSwitch.tsx src/home/HomeDashboard.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/home/HomeDashboard.test.tsx src/app/App.test.tsx
git commit -m "feat: integrate bookmark dashboard state"
```

---

### Task 10: Add Scoped Desktop Styling and Responsive/Accessibility Contracts

**Files:**
- Modify: `src/app/styles.css`
- Modify: `src/home/BookmarkManagementContent.tsx`
- Modify: `src/home/BookmarkToolbar.tsx`
- Modify: `src/home/BookmarkGroupList.tsx`
- Modify: `src/home/BookmarkDetailPanel.tsx`
- Modify: `src/home/BookmarkEditorDialog.tsx`
- Modify: `src/home/HomeBookmarksWorkspace.test.tsx`

- [ ] **Step 1: Add failing static style and ARIA assertions**

Add imports:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
```

Append:

```tsx
  it('keeps bookmark styles scoped and moves the detail rail below at the desktop breakpoint', () => {
    const styles = readFileSync(join(process.cwd(), 'src/app/styles.css'), 'utf8');

    expect(styles).toMatch(
      /\.bookmark-management-layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+320px;/s,
    );
    expect(styles).toMatch(
      /\.home-content\.bookmark-management-home-content\s*{[^}]*padding:\s*0;[^}]*overflow:\s*hidden;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width:\s*1180px\)\s*{[^@]*\.bookmark-management-layout\s*{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\);/s,
    );
    expect(styles).toMatch(
      /\.bookmark-management-groups\[data-density='compact'\][^{]*\s[^}]*padding:/s,
    );
    expect(styles).toMatch(
      /\.bookmark-management-row\[aria-selected='true'\]\s*{[^}]*background:/s,
    );
    expect(styles).not.toMatch(
      /(^|[\s,>])table\s*{[^}]*bookmark-management/s,
    );
  });

  it('exposes selected, expanded, busy, and async states without color-only meaning', async () => {
    renderWorkspace({
      onUpdateBookmark: vi.fn(
        () => new Promise<void>(() => undefined),
      ),
    });
    const groupButton = screen.getByRole('button', { name: '收起 Transformer.pdf' });
    expect(groupButton).toHaveAttribute('aria-expanded', 'true');

    const row = screen.getByTestId('bookmark-management-row-1');
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('button', { name: '编辑备注 自注意力机制' }));
    fireEvent.click(screen.getByRole('button', { name: '保存书签' }));
    expect(screen.getByRole('button', { name: '保存书签' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消编辑' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '关闭编辑书签' })).toBeDisabled();
    expect(screen.getByRole('dialog', { name: '编辑书签' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });
```

- [ ] **Step 2: Run the test and verify style-contract failure**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx
```

Expected: scoped bookmark selectors and responsive rules are absent.

- [ ] **Step 3: Normalize the component class contract**

Before writing CSS, ensure components use only these page-owned class families:

```text
bookmark-management-content
bookmark-management-home-content
bookmark-management-standalone
bookmark-management-body
bookmark-management-heading
bookmark-management-heading-actions
bookmark-management-count
bookmark-management-refresh-error
bookmark-management-layout
bookmark-management-main
bookmark-management-toolbar
bookmark-management-search
bookmark-management-search-control
bookmark-management-search-clear
bookmark-management-select
bookmark-management-density
bookmark-management-batch-toolbar
bookmark-management-groups
bookmark-management-group
bookmark-management-group-heading
bookmark-management-table-wrap
bookmark-management-table
bookmark-management-row
bookmark-management-row-main
bookmark-management-note
bookmark-management-page-progress
bookmark-management-row-actions
bookmark-management-menu
bookmark-management-pagination
bookmark-management-detail
bookmark-management-detail-card
bookmark-management-page-preview
bookmark-management-neighbors
bookmark-management-quick-actions
bookmark-management-page-state
bookmark-management-skeleton
bookmark-management-dialog-backdrop
bookmark-management-dialog
bookmark-management-dialog-actions
bookmark-management-danger-action
bookmark-management-status
bookmark-management-missing
```

Shared generic button classes may remain on the same element, but no new unprefixed selector is allowed.

- [ ] **Step 4: Add the base desktop layout styles**

Append this block to `src/app/styles.css`:

```css
.bookmark-management-content {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  background: var(--sr-bg);
  color: var(--sr-text);
}

.home-content.bookmark-management-home-content {
  grid-template-columns: minmax(0, 1fr);
  gap: 0;
  padding: 0;
  overflow: hidden;
}

.tool-workspace.bookmark-management-standalone {
  grid-template-rows: minmax(0, 1fr);
}

.bookmark-management-body {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.bookmark-management-body > .bookmark-management-layout {
  grid-row: 2;
}

.bookmark-management-heading {
  min-width: 0;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 24px 18px;
  border-bottom: 1px solid var(--sr-border);
  background: var(--sr-surface);
}

.bookmark-management-heading h1 {
  margin: 0;
  font-size: 24px;
  line-height: 1.25;
}

.bookmark-management-heading p {
  margin: 6px 0 0;
  color: var(--sr-text-muted);
  font-size: 13px;
}

.bookmark-management-heading-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.bookmark-management-count {
  flex: 0 0 auto;
  color: var(--sr-text-muted);
  font-size: 13px;
  font-weight: 700;
}

.bookmark-management-layout {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
}

.bookmark-management-main {
  min-width: 0;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 14px;
  padding: 18px 20px 20px;
  overflow: auto;
}

.bookmark-management-detail {
  min-width: 0;
  min-height: 0;
  display: grid;
  align-content: start;
  gap: 12px;
  padding: 18px 14px;
  border-left: 1px solid var(--sr-border);
  background: var(--sr-surface);
  overflow: auto;
}

.bookmark-management-toolbar {
  min-width: 0;
  display: grid;
  grid-template-columns:
    minmax(240px, 1fr)
    minmax(140px, 180px)
    minmax(120px, 150px)
    minmax(150px, 180px)
    minmax(110px, 130px)
    auto
    auto;
  align-items: end;
  gap: 10px;
}

.bookmark-management-toolbar label,
.bookmark-management-select {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.bookmark-management-toolbar label > span,
.bookmark-management-select > span {
  color: var(--sr-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.bookmark-management-toolbar input,
.bookmark-management-toolbar select,
.bookmark-management-toolbar button {
  min-width: 0;
  min-height: 38px;
  border: 1px solid var(--sr-border);
  border-radius: 8px;
  background: var(--sr-surface);
  color: var(--sr-text);
}

.bookmark-management-toolbar input,
.bookmark-management-toolbar select {
  width: 100%;
  padding: 0 11px;
}

.bookmark-management-search {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.bookmark-management-search-control {
  position: relative;
}

.bookmark-management-search-control > svg {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--sr-text-muted);
  pointer-events: none;
}

.bookmark-management-search-control input {
  padding-left: 34px;
  padding-right: 38px;
}

.bookmark-management-search-control .bookmark-management-search-clear {
  position: absolute;
  right: 4px;
  top: 4px;
  width: 30px;
  min-height: 30px;
  display: inline-grid;
  place-items: center;
  padding: 0;
  border: 0;
  background: transparent;
}

.bookmark-management-search-clear svg {
  position: static;
  transform: none;
}

.bookmark-management-density {
  display: inline-flex;
  align-items: end;
  overflow: hidden;
  border: 1px solid var(--sr-border);
  border-radius: 8px;
}

.bookmark-management-density button {
  border: 0;
  border-radius: 0;
}

.bookmark-management-density button[aria-pressed='true'] {
  background: #eff6ff;
  color: var(--sr-primary);
}

.bookmark-management-refresh-error,
.bookmark-management-status,
.bookmark-management-batch-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 13px;
}

.bookmark-management-refresh-error {
  border: 1px solid rgba(239, 68, 68, 0.28);
  background: #fef2f2;
  color: var(--sr-danger);
}

.bookmark-management-status,
.bookmark-management-batch-toolbar {
  border: 1px solid rgba(37, 99, 235, 0.24);
  background: #eff6ff;
  color: #1e3a8a;
}
```

- [ ] **Step 5: Add grouped table, menu, density, and pagination styles**

Append:

```css
.bookmark-management-groups {
  min-width: 0;
  display: grid;
  gap: 12px;
}

.bookmark-management-group {
  min-width: 0;
  overflow: visible;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
}

.bookmark-management-group-heading {
  width: 100%;
  min-height: 46px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 12px;
  border: 0;
  border-radius: var(--sr-radius) var(--sr-radius) 0 0;
  background: var(--sr-surface-muted);
  color: var(--sr-text);
  text-align: left;
}

.bookmark-management-group-heading strong {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-management-group-heading small {
  margin-left: auto;
  color: var(--sr-text-muted);
}

.bookmark-management-missing {
  color: var(--sr-danger);
  font-size: 12px;
  font-weight: 700;
}

.bookmark-management-table-wrap {
  min-width: 0;
  overflow-x: auto;
}

.bookmark-management-table {
  width: 100%;
  min-width: 830px;
  border-collapse: collapse;
}

.bookmark-management-table th,
.bookmark-management-table td {
  padding: 11px 10px;
  border-top: 1px solid var(--sr-border);
  text-align: left;
  vertical-align: middle;
}

.bookmark-management-table th {
  color: var(--sr-text-muted);
  font-size: 12px;
  font-weight: 800;
  background: var(--sr-surface);
}

.bookmark-management-row {
  color: var(--sr-text);
  font-size: 13px;
  outline: none;
}

.bookmark-management-row:hover {
  background: var(--sr-surface-muted);
}

.bookmark-management-row[aria-selected='true'] {
  background: #eff6ff;
  box-shadow: inset 3px 0 0 var(--sr-primary);
}

.bookmark-management-row:focus-visible {
  box-shadow: inset 0 0 0 2px var(--sr-primary);
}

.bookmark-management-row-main,
.bookmark-management-note {
  min-width: 0;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.bookmark-management-page-progress {
  min-width: 96px;
  display: grid;
  gap: 4px;
  color: var(--sr-text-muted);
  font-size: 12px;
}

.bookmark-management-row-actions {
  position: relative;
  width: 52px;
}

.bookmark-management-menu {
  position: absolute;
  right: 8px;
  top: calc(100% - 4px);
  z-index: 40;
  width: 176px;
  display: grid;
  gap: 3px;
  padding: 6px;
  border: 1px solid var(--sr-border);
  border-radius: 9px;
  background: var(--sr-surface);
  box-shadow: 0 14px 32px rgba(15, 23, 42, 0.16);
}

.bookmark-management-menu button {
  justify-content: flex-start;
  min-height: 32px;
  padding: 0 9px;
  border: 0;
  background: transparent;
  color: var(--sr-text);
}

.bookmark-management-menu button:focus-visible,
.bookmark-management-menu button:hover {
  background: var(--sr-surface-muted);
  outline: none;
}

.bookmark-management-menu button:last-child {
  color: var(--sr-danger);
}

.bookmark-management-groups[data-density='compact'] .bookmark-management-table th,
.bookmark-management-groups[data-density='compact'] .bookmark-management-table td {
  padding: 6px 9px;
}

.bookmark-management-groups[data-density='compact'] .bookmark-management-row {
  font-size: 12px;
}

.bookmark-management-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--sr-text-muted);
  font-size: 13px;
}

.bookmark-management-pagination button {
  min-height: 34px;
  padding: 0 12px;
  border: 1px solid var(--sr-border);
  border-radius: 8px;
  background: var(--sr-surface);
  color: var(--sr-text);
}
```

- [ ] **Step 6: Add detail, page-state, dialog, and skeleton styles**

Append:

```css
.bookmark-management-detail-card,
.bookmark-management-page-preview {
  min-width: 0;
  display: grid;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
}

.bookmark-management-detail-card h2,
.bookmark-management-detail-card h3 {
  margin: 0;
  font-size: 14px;
}

.bookmark-management-detail-card p,
.bookmark-management-detail-card small {
  margin: 0;
  color: var(--sr-text-muted);
  font-size: 12px;
  line-height: 1.55;
  overflow-wrap: anywhere;
}

.bookmark-management-page-preview {
  min-height: 180px;
  place-content: center;
  place-items: center;
  background: var(--sr-surface-muted);
  text-align: center;
}

.bookmark-management-page-preview strong {
  font-size: 18px;
}

.bookmark-management-page-preview progress {
  width: min(180px, 100%);
}

.bookmark-management-neighbors,
.bookmark-management-quick-actions {
  display: grid;
  gap: 8px;
}

.bookmark-management-neighbors {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.bookmark-management-quick-actions button,
.bookmark-management-neighbors button {
  justify-content: flex-start;
  min-height: 36px;
  border: 1px solid var(--sr-border);
  border-radius: 8px;
  background: var(--sr-surface);
  color: var(--sr-text);
}

.bookmark-management-page-state {
  min-height: 260px;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 9px;
  padding: 24px;
  color: var(--sr-text-muted);
  text-align: center;
}

.bookmark-management-page-state strong {
  color: var(--sr-text);
  font-size: 17px;
}

.bookmark-management-page-state p {
  margin: 0;
}

.bookmark-management-skeleton {
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  padding: 24px;
}

.bookmark-management-skeleton span {
  min-height: 120px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface-muted);
  animation: bookmark-management-pulse 1.2s ease-in-out infinite alternate;
}

.bookmark-management-skeleton span:first-child {
  grid-row: span 2;
}

@keyframes bookmark-management-pulse {
  from {
    opacity: 0.55;
  }
  to {
    opacity: 1;
  }
}

.bookmark-management-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgba(15, 23, 42, 0.34);
}

.bookmark-management-dialog {
  width: min(520px, 100%);
  display: grid;
  gap: 14px;
  padding: 18px;
  border: 1px solid var(--sr-border);
  border-radius: var(--sr-radius);
  background: var(--sr-surface);
  box-shadow: 0 20px 50px rgba(15, 23, 42, 0.2);
}

.bookmark-management-dialog header,
.bookmark-management-dialog-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.bookmark-management-dialog h2,
.bookmark-management-dialog p {
  margin: 0;
}

.bookmark-management-dialog label {
  display: grid;
  gap: 6px;
  color: var(--sr-text-muted);
  font-size: 12px;
  font-weight: 700;
}

.bookmark-management-dialog input,
.bookmark-management-dialog textarea {
  width: 100%;
  border: 1px solid var(--sr-border);
  border-radius: 8px;
  background: var(--sr-surface);
  color: var(--sr-text);
}

.bookmark-management-dialog input {
  min-height: 38px;
  padding: 0 10px;
}

.bookmark-management-dialog textarea {
  min-height: 120px;
  padding: 10px;
  resize: vertical;
}

.bookmark-management-dialog-actions {
  justify-content: flex-end;
}

.bookmark-management-danger-action {
  border-color: var(--sr-danger) !important;
  background: var(--sr-danger) !important;
  color: #ffffff !important;
}
```

- [ ] **Step 7: Add responsive behavior without changing data capability**

Append:

```css
@media (max-width: 1180px) {
  .bookmark-management-layout {
    grid-template-columns: minmax(0, 1fr);
    align-content: start;
    overflow: auto;
  }

  .bookmark-management-main,
  .bookmark-management-detail {
    overflow: visible;
  }

  .bookmark-management-detail {
    border-top: 1px solid var(--sr-border);
    border-left: 0;
  }

  .bookmark-management-toolbar {
    grid-template-columns: repeat(3, minmax(160px, 1fr));
  }
}

@media (max-width: 760px) {
  .bookmark-management-heading {
    flex-direction: column;
    padding: 18px 14px;
  }

  .bookmark-management-main,
  .bookmark-management-detail {
    padding: 14px;
  }

  .bookmark-management-toolbar {
    grid-template-columns: minmax(0, 1fr);
  }

  .bookmark-management-density,
  .bookmark-management-toolbar > button {
    justify-self: start;
  }

  .bookmark-management-table {
    min-width: 760px;
  }

  .bookmark-management-neighbors {
    grid-template-columns: minmax(0, 1fr);
  }

  .bookmark-management-skeleton {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bookmark-management-skeleton span {
    animation: none;
  }
}
```

- [ ] **Step 8: Run scoped UI tests, typecheck, and build**

```bash
bun run test src/home/HomeBookmarksWorkspace.test.tsx src/home/bookmarkManagementUtils.test.ts
bun run typecheck
bun run build
git diff --check -- src/app/styles.css src/home/BookmarkManagementContent.tsx src/home/BookmarkToolbar.tsx src/home/BookmarkGroupList.tsx src/home/BookmarkDetailPanel.tsx src/home/BookmarkEditorDialog.tsx src/home/HomeBookmarksWorkspace.test.tsx
```

Expected: scoped CSS contracts pass, the desktop rail is 320px, narrow layout stacks the rail, compact density only changes presentation, and no global page selector regresses other workspaces.

- [ ] **Step 9: Commit Task 10**

```bash
git add src/app/styles.css src/home/BookmarkManagementContent.tsx src/home/BookmarkToolbar.tsx src/home/BookmarkGroupList.tsx src/home/BookmarkDetailPanel.tsx src/home/BookmarkEditorDialog.tsx src/home/HomeBookmarksWorkspace.test.tsx
git commit -m "style: polish bookmark management workspace"
```

---

### Task 11: Run the Full Regression and Scope Audit

**Files:**
- Verify only; no intended source changes

- [ ] **Step 0: Invoke completion verification discipline**

Use `superpowers:verification-before-completion` before making any passing or completion claim. The commands below are the evidence set; do not substitute remembered results.

- [ ] **Step 1: Confirm migration and command cardinality**

```bash
rg --files src-tauri/src/migrations -g '*.sql' | sort
rg -n "load_bookmark_dashboard" src-tauri/src/db.rs src-tauri/src/lib.rs src/persistence/persistenceApi.ts
git diff "$(git merge-base HEAD main)" -- src-tauri/src/migrations
```

Expected:

- migrations are exactly `001` through `006`;
- the diff contains only the new `006_bookmark_management.sql`;
- one dashboard command is defined, registered, and invoked;
- no batch-delete command exists.

- [ ] **Step 2: Run the target suite**

```bash
bun run test src/home/bookmarkManagementUtils.test.ts src/home/HomeBookmarksWorkspace.test.tsx src/persistence/persistenceApi.test.ts src/reader/hooks/useReaderDecorations.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/home/HomeDashboard.test.tsx src/search/globalSearch.test.ts src/app/App.test.tsx
```

Expected: all targeted Rust-to-UI behavior and application integration tests pass.

- [ ] **Step 3: Run all Rust verification**

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: migration replay, note compatibility, dashboard aggregation, existing delete semantics, and all unrelated Rust tests pass.

- [ ] **Step 4: Run all frontend verification**

```bash
bun run typecheck
bun run test
bun run build
```

Expected: TypeScript, the complete Vitest suite, and the production Vite build pass.

- [ ] **Step 5: Audit forbidden scope and working tree**

```bash
git diff --check
git status --short
git diff --stat "$(git merge-base HEAD main)"..HEAD
! rg -n "antd|@mui|chakra|tailwind" package.json bun.lock
! rg -n "TODO|TBD|mock bookmark|placeholder bookmark" src/home/BookmarkManagementContent.tsx src/home/BookmarkToolbar.tsx src/home/BookmarkGroupList.tsx src/home/BookmarkDetailPanel.tsx src/home/BookmarkEditorDialog.tsx src/home/useBookmarkManagement.ts src/home/bookmarkManagementUtils.ts
```

Expected:

- no whitespace errors;
- no uncommitted implementation files;
- no dependency changes;
- no edits to PDF renderer/core or unrelated business pages;
- no unresolved placeholder markers;
- the original dirty `main` files are absent from this isolated worktree’s commits.

- [ ] **Step 6: Record the validation boundary**

Final implementation report must state:

```text
未自动启动 SmartReader；运行态验收由用户执行。
package.json 未配置可执行的 lint 命令，因此没有声称 lint 已通过。
```

If any full-suite failure is caused by a pre-existing issue, retain the exact command/output and prove all target tests pass. Do not hide or relabel a failing command.

- [ ] **Step 7: Commit only if verification required a real fix**

If Task 11 reveals an implementation defect, return to the task that owns the affected file, apply the smallest patch, rerun the failed command plus that task’s target suite, and use the exact `git add` command already listed in that task. Then commit the actual fix:

```bash
git commit -m "fix: complete bookmark management verification"
```

If no source fix is necessary, do not create an empty commit.

---

## Acceptance Trace

| Approved requirement | Implementation task(s) | Primary evidence |
|---|---:|---|
| One `006` migration and nullable note | 1, 3, 4 | Rust migration/round-trip tests, persistence test, hook test |
| One read-only dashboard command | 2, 3 | Rust aggregation test, Tauri registration compile, invoke test |
| Dashboard is the only bookmark collection state | 9 | stale request and global-search integration tests |
| Reader-local bookmarks and dashboard stay synchronized after writes | 4, 9 | persistence-first hook tests and ReaderApp refresh integration |
| Existing App Shell page is canonical | 6, 9 | HomeDashboard and ReaderWorkspaceSwitch tests |
| Old standalone route shares the core view | 6, 9 | switch shared-render test |
| Search document/name/note/path | 5, 6 | pure and component tests |
| Document/date filters and four sort modes | 5, 6 | pure and component tests |
| Record pagination with full group counts | 5, 6 | split-group pure test and UI pagination test |
| Standard/compact density only | 6, 10 | component and CSS contract tests |
| Row selection does not jump | 7 | detail selection test |
| Fixed detail, real metadata, no thumbnail/section invention | 7 | detail and missing-file tests |
| Adjacent navigation changes page, expands, focuses | 5, 7 | utility and component focus tests |
| Name + note atomic edit and failure retention | 1, 4, 7 | Rust, hook, and dialog tests |
| Clipboard reference with failure state | 5, 7 | utility and component tests |
| Confirmed single delete and deterministic fallback | 5, 8 | utility and component tests |
| Sequential partial-failure batch delete | 8, 9 | component and App integration tests |
| Missing files disable only open/jump | 2, 7 | Rust orphan and UI missing-file tests |
| Loading, empty, filtered empty, initial/background errors | 6, 9 | page-state and integration tests |
| Keyboard menus, focus traps, async roles | 7, 8, 10 | component accessibility tests |
| Scoped responsive CSS | 10 | static CSS contract, typecheck, build |
| No startup and no false lint claim | 11 | final report boundary |
