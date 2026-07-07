# Tag Management Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SmartReader tag management workspace as a high-fidelity, prototype-matching page backed by real SQLite dashboard data and persisted tag activity logs.

**Architecture:** Add one SQLite migration for tag activity logs, then expose a single dashboard-style Tauri command that returns the full tag management view model. The React tag workspace renders that view model with local UI state for filtering, sorting, pagination, selection, dialogs, and mutations that refresh the dashboard after success.

**Tech Stack:** Tauri 2, Rust, rusqlite, SQLite migrations, React 18, TypeScript, lucide-react, Vitest, Testing Library, Vite, existing `src/app/styles.css`.

---

## File Structure

- Modify: `src-tauri/src/db.rs`
  - Add `004_tag_activity_log` to `MIGRATIONS`.
  - Add dashboard DTO structs.
  - Add tag activity logging helpers.
  - Log successful tag mutations.
  - Add SQL queries for overview, table rows, details, documents, folder distribution, activities, and recommendations.
  - Add Rust tests for migration, logging, and dashboard data.
- Create: `src-tauri/src/migrations/004_tag_activity_log.sql`
  - Create `tag_activity_log` and indexes.
- Modify: `src-tauri/src/lib.rs`
  - Register `db::load_tag_dashboard` in the Tauri invoke handler.
- Modify: `src/persistence/persistenceApi.ts`
  - Add dashboard response types and `loadTagDashboard()`.
- Modify: `src/persistence/persistenceApi.test.ts`
  - Verify `load_tag_dashboard` invoke wiring.
- Modify: `src/app/ReaderWorkspaceSwitch.tsx`
  - Pass `openRecordPage` into `TagManager` and rely on dashboard API rather than only `availableTags`.
- Modify: `src/tags/tagModels.ts`
  - Add frontend dashboard DTO types shared by tag components.
- Modify: `src/tags/TagManager.tsx`
  - Replace the old three-column manager with the full dashboard orchestrator.
- Create: `src/tags/tagDashboardUtils.ts`
  - Implement pure local filtering, sorting, pagination, default selection, and formatting helpers.
- Create: `src/tags/tagDashboardUtils.test.ts`
  - Test filter, sort, pagination, and selection helpers.
- Create: `src/tags/TagDashboardToolbar.tsx`
  - Render search, color filter, sort dropdown, clear filters, and create button.
- Create: `src/tags/TagOverviewCards.tsx`
  - Render overview metrics.
- Create: `src/tags/TagCloudPanel.tsx`
  - Render colored tag cloud pills.
- Create: `src/tags/TagTable.tsx`
  - Render table, row selection, row actions, and pagination.
- Create: `src/tags/TagDetailsPanel.tsx`
  - Render right-side tag detail panel, documents, folder distribution, activities, and recommendations.
- Create: `src/tags/TagCreateEditDialog.tsx`
  - Render create/edit/merge dialogs using existing project style and no external dialog dependency.
- Create: `src/tags/TagManager.test.tsx`
  - Test dashboard rendering and interactions.
- Modify: `src/app/styles.css`
  - Add high-fidelity tag workspace styles using dedicated class names.

---

### Task 1: Add Tag Activity Migration

**Files:**
- Create: `src-tauri/src/migrations/004_tag_activity_log.sql`
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Write the migration file**

Create `src-tauri/src/migrations/004_tag_activity_log.sql` with this schema:

```sql
CREATE TABLE IF NOT EXISTS tag_activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tag_id INTEGER,
    tag_name TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    target_label TEXT,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    FOREIGN KEY(tag_id) REFERENCES tags(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tag_activity_log_tag_id ON tag_activity_log(tag_id);
CREATE INDEX IF NOT EXISTS idx_tag_activity_log_created_at ON tag_activity_log(created_at);
CREATE INDEX IF NOT EXISTS idx_tag_activity_log_action ON tag_activity_log(action);
```

- [ ] **Step 2: Register the migration**

In `src-tauri/src/db.rs`, extend `MIGRATIONS` immediately after `003_workbench_stabilization`:

```rust
    Migration {
        version: "004_tag_activity_log",
        sql: include_str!("migrations/004_tag_activity_log.sql"),
    },
```

- [ ] **Step 3: Add the migration test**

In the existing `#[cfg(test)]` module in `src-tauri/src/db.rs`, add this test near the schema tests:

```rust
    #[test]
    fn opens_tag_activity_log_schema() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let table_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'tag_activity_log'",
                [],
                |row| row.get(0),
            )
            .expect("table count");
        let index_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'index' AND name IN ('idx_tag_activity_log_tag_id', 'idx_tag_activity_log_created_at', 'idx_tag_activity_log_action')",
                [],
                |row| row.get(0),
            )
            .expect("index count");

        assert_eq!(table_count, 1);
        assert_eq!(index_count, 3);
    }
```

- [ ] **Step 4: Run the focused Rust schema test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml opens_tag_activity_log_schema
```

Expected: the new test passes.

- [ ] **Step 5: Commit migration**

Run:

```bash
git add src-tauri/src/migrations/004_tag_activity_log.sql src-tauri/src/db.rs
git commit -m "feat: add tag activity log migration"
```

---

### Task 2: Log Real Tag Activity

**Files:**
- Modify: `src-tauri/src/db.rs`

- [ ] **Step 1: Add activity input and helper functions**

Add these Rust types and helpers after `MergeTagsInput` in `src-tauri/src/db.rs`:

```rust
#[derive(Debug, Clone)]
struct TagActivityInput {
    tag_id: Option<i64>,
    tag_name: String,
    action: &'static str,
    target_type: Option<&'static str>,
    target_id: Option<String>,
    target_label: Option<String>,
    metadata: serde_json::Value,
}

fn insert_tag_activity_tx(
    connection: &Connection,
    input: TagActivityInput,
) -> Result<(), DbError> {
    connection.execute(
        r#"
        INSERT INTO tag_activity_log (
            tag_id, tag_name, action, target_type, target_id,
            target_label, metadata_json, created_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        "#,
        params![
            input.tag_id,
            input.tag_name,
            input.action,
            input.target_type,
            input.target_id,
            input.target_label,
            input.metadata.to_string(),
            now_rfc3339(),
        ],
    )?;
    Ok(())
}

fn log_tag_activity_tx(
    connection: &Connection,
    tag: &PersistedTag,
    action: &'static str,
    target_type: Option<&'static str>,
    target_id: Option<String>,
    target_label: Option<String>,
    metadata: serde_json::Value,
) -> Result<(), DbError> {
    insert_tag_activity_tx(
        connection,
        TagActivityInput {
            tag_id: Some(tag.id),
            tag_name: tag.name.clone(),
            action,
            target_type,
            target_id,
            target_label,
            metadata,
        },
    )
}
```

- [ ] **Step 2: Log create and rename**

Update `create_tag_tx` so it stores the returned tag in a variable, logs `create`, and returns it:

```rust
    let tag = tag_by_id(connection, connection.last_insert_rowid())?;
    log_tag_activity_tx(connection, &tag, "create", Some("tag"), Some(tag.id.to_string()), Some(tag.name.clone()), serde_json::json!({}))?;
    Ok(tag)
```

Update `rename_tag_tx` to fetch the old tag before the update, then log the rename after fetching the renamed tag:

```rust
    let old_tag = tag_by_id(connection, id)?;
    connection.execute(
        "UPDATE tags SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now_rfc3339(), id],
    )?;
    let renamed_tag = tag_by_id(connection, id)?;
    log_tag_activity_tx(
        connection,
        &renamed_tag,
        "rename",
        Some("tag"),
        Some(id.to_string()),
        Some(renamed_tag.name.clone()),
        serde_json::json!({ "oldName": old_tag.name, "newName": renamed_tag.name }),
    )?;
    Ok(renamed_tag)
```

- [ ] **Step 3: Log delete and merge**

Update `delete_tag_tx` to fetch the tag before deleting relations, then insert a delete event with a nullable `tag_id` after deletion:

```rust
    let tag = tag_by_id(connection, id)?;
    connection.execute("DELETE FROM annotation_tags WHERE tag_id = ?1", [id])?;
    connection.execute("DELETE FROM document_tags WHERE tag_id = ?1", [id])?;
    connection.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    insert_tag_activity_tx(
        connection,
        TagActivityInput {
            tag_id: None,
            tag_name: tag.name,
            action: "delete",
            target_type: Some("tag"),
            target_id: Some(id.to_string()),
            target_label: None,
            metadata: serde_json::json!({ "deletedTagId": id }),
        },
    )?;
    Ok(())
```

Update the successful merge block inside `merge_tags_tx` before returning `tag_by_id`:

```rust
        let merged_tag = tag_by_id(connection, input.target_tag_id)?;
        log_tag_activity_tx(
            connection,
            &merged_tag,
            "merge",
            Some("tag"),
            Some(input.source_tag_id.to_string()),
            None,
            serde_json::json!({
                "sourceTagId": input.source_tag_id,
                "targetTagId": input.target_tag_id
            }),
        )?;
        Ok(merged_tag)
```

- [ ] **Step 4: Log attach and detach operations**

Update document tag helpers:

```rust
pub fn attach_document_tag_tx(
    connection: &Connection,
    document_key: &str,
    tag_id: i64,
) -> Result<(), DbError> {
    let tag = tag_by_id(connection, tag_id)?;
    require_document_key(connection, document_key)?;
    connection.execute(
        r#"
        INSERT OR IGNORE INTO document_tags (document_key, tag_id, created_at)
        VALUES (?1, ?2, ?3)
        "#,
        params![document_key, tag_id, now_rfc3339()],
    )?;
    log_tag_activity_tx(
        connection,
        &tag,
        "attach_document",
        Some("document"),
        Some(document_key.to_string()),
        document_display_name_tx(connection, document_key)?,
        serde_json::json!({}),
    )?;
    Ok(())
}

pub fn detach_document_tag_tx(
    connection: &Connection,
    document_key: &str,
    tag_id: i64,
) -> Result<(), DbError> {
    let tag = tag_by_id(connection, tag_id)?;
    connection.execute(
        "DELETE FROM document_tags WHERE document_key = ?1 AND tag_id = ?2",
        params![document_key, tag_id],
    )?;
    log_tag_activity_tx(
        connection,
        &tag,
        "detach_document",
        Some("document"),
        Some(document_key.to_string()),
        document_display_name_tx(connection, document_key)?,
        serde_json::json!({}),
    )?;
    Ok(())
}
```

Add the helper used above near `require_document_key`:

```rust
fn document_display_name_tx(
    connection: &Connection,
    document_key: &str,
) -> Result<Option<String>, DbError> {
    match connection.query_row(
        "SELECT display_name FROM documents WHERE document_key = ?1",
        [document_key],
        |row| row.get(0),
    ) {
        Ok(display_name) => Ok(Some(display_name)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(DbError::from(error)),
    }
}
```

Update annotation tag helpers similarly with `annotation` target IDs:

```rust
    let tag = tag_by_id(connection, tag_id)?;
    require_annotation_id(connection, annotation_id)?;
```

After the insert/delete, call:

```rust
    log_tag_activity_tx(
        connection,
        &tag,
        "attach_annotation",
        Some("annotation"),
        Some(annotation_id.to_string()),
        None,
        serde_json::json!({}),
    )?;
```

Use `"detach_annotation"` in `detach_annotation_tag_tx`.

- [ ] **Step 5: Add activity logging test**

Add this test in `src-tauri/src/db.rs`:

```rust
    #[test]
    fn records_tag_activity_for_tag_mutations() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "深度学习".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("create tag");
        let renamed = rename_tag_tx(&connection, tag.id, "机器学习").expect("rename tag");
        delete_tag_tx(&connection, renamed.id).expect("delete tag");

        let actions: Vec<String> = connection
            .prepare("SELECT action FROM tag_activity_log ORDER BY id ASC")
            .expect("prepare actions")
            .query_map([], |row| row.get(0))
            .expect("query actions")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect actions");

        assert_eq!(actions, vec!["create", "rename", "delete"]);
    }
```

- [ ] **Step 6: Run focused activity test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml records_tag_activity_for_tag_mutations
```

Expected: PASS.

- [ ] **Step 7: Commit activity logging**

Run:

```bash
git add src-tauri/src/db.rs
git commit -m "feat: record tag activity events"
```

---

### Task 3: Add Backend Dashboard Query

**Files:**
- Modify: `src-tauri/src/db.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add dashboard DTO structs**

Add these structs after `PersistedTag`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagDashboard {
    pub overview: TagDashboardOverview,
    pub tags: Vec<TagDashboardTagRow>,
    pub details: Vec<TagDashboardDetail>,
    pub recommendations: Vec<TagDashboardRecommendation>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagDashboardOverview {
    pub total_tags: i64,
    pub active_tags: i64,
    pub total_usage: i64,
    pub orphan_tags: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagDashboardTagRow {
    pub id: i64,
    pub name: String,
    pub color: String,
    pub usage_count: i64,
    pub document_count: i64,
    pub annotation_count: i64,
    pub recent_used_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagDashboardDetail {
    pub tag: TagDashboardTagRow,
    pub documents: Vec<TagDashboardDocument>,
    pub folder_distribution: Vec<TagFolderDistribution>,
    pub activities: Vec<TagActivityRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagDashboardDocument {
    pub document_key: String,
    pub display_name: String,
    pub path: Option<String>,
    pub missing: bool,
    pub page_count: Option<i64>,
    pub last_opened_at: Option<String>,
    pub relation_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagFolderDistribution {
    pub folder: String,
    pub count: i64,
    pub percent: i64,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagActivityRecord {
    pub id: i64,
    pub tag_id: Option<i64>,
    pub tag_name: String,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub target_label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TagDashboardRecommendation {
    pub id: String,
    pub title: String,
    pub description: String,
    pub tag_ids: Vec<i64>,
    pub severity: String,
}
```

- [ ] **Step 2: Add dashboard query helpers**

Add `load_tag_dashboard_tx` after `list_tags_tx`:

```rust
pub fn load_tag_dashboard_tx(connection: &Connection) -> Result<TagDashboard, DbError> {
    let tags = list_tag_dashboard_rows_tx(connection)?;
    let overview = TagDashboardOverview {
        total_tags: tags.len() as i64,
        active_tags: tags.iter().filter(|tag| tag.usage_count > 0).count() as i64,
        total_usage: tags.iter().map(|tag| tag.usage_count).sum(),
        orphan_tags: tags.iter().filter(|tag| tag.usage_count == 0).count() as i64,
    };
    let details = tags
        .iter()
        .map(|tag| load_tag_dashboard_detail_tx(connection, tag.clone()))
        .collect::<Result<Vec<_>, _>>()?;
    let recommendations = build_tag_recommendations(&tags);

    Ok(TagDashboard {
        overview,
        tags,
        details,
        recommendations,
    })
}
```

Add `list_tag_dashboard_rows_tx` using real relation counts and latest activity:

```rust
fn list_tag_dashboard_rows_tx(connection: &Connection) -> Result<Vec<TagDashboardTagRow>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT t.id, t.name, t.color,
               count(DISTINCT dt.document_key) AS document_count,
               count(DISTINCT at.annotation_id) AS annotation_count,
               max(COALESCE(tal.created_at, t.updated_at)) AS recent_used_at,
               t.created_at, t.updated_at
        FROM tags t
        LEFT JOIN document_tags dt ON dt.tag_id = t.id
        LEFT JOIN annotation_tags at ON at.tag_id = t.id
        LEFT JOIN tag_activity_log tal ON tal.tag_id = t.id
        GROUP BY t.id, t.name, t.color, t.created_at, t.updated_at
        ORDER BY recent_used_at DESC, t.name COLLATE NOCASE ASC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        let document_count: i64 = row.get(3)?;
        let annotation_count: i64 = row.get(4)?;
        let name: String = row.get(1)?;
        Ok(TagDashboardTagRow {
            id: row.get(0)?,
            name: name.clone(),
            color: row.get(2)?,
            usage_count: document_count + annotation_count,
            document_count,
            annotation_count,
            recent_used_at: row.get(5)?,
            created_at: row.get(6)?,
            updated_at: row.get(7)?,
            description: format!("{} 相关文献与批注", name),
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}
```

- [ ] **Step 3: Add detail queries**

Add helpers:

```rust
fn load_tag_dashboard_detail_tx(
    connection: &Connection,
    tag: TagDashboardTagRow,
) -> Result<TagDashboardDetail, DbError> {
    let documents = list_tag_documents_tx(connection, tag.id)?;
    let folder_distribution = build_folder_distribution(&documents);
    let activities = list_tag_activities_tx(connection, tag.id, &tag.name)?;

    Ok(TagDashboardDetail {
        tag,
        documents,
        folder_distribution,
        activities,
    })
}

fn list_tag_documents_tx(
    connection: &Connection,
    tag_id: i64,
) -> Result<Vec<TagDashboardDocument>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT d.document_key, d.display_name, d.path, d.missing, d.page_count,
               d.last_opened_at, count(*) AS relation_count
        FROM documents d
        JOIN (
            SELECT document_key FROM document_tags WHERE tag_id = ?1
            UNION ALL
            SELECT a.document_key FROM annotations a
            JOIN annotation_tags at ON at.annotation_id = a.id
            WHERE at.tag_id = ?1
        ) r ON r.document_key = d.document_key
        GROUP BY d.document_key, d.display_name, d.path, d.missing, d.page_count, d.last_opened_at
        ORDER BY COALESCE(d.last_opened_at, '') DESC, relation_count DESC, d.display_name COLLATE NOCASE ASC
        LIMIT 6
        "#,
    )?;
    let rows = statement.query_map([tag_id], |row| {
        Ok(TagDashboardDocument {
            document_key: row.get(0)?,
            display_name: row.get(1)?,
            path: row.get(2)?,
            missing: row.get::<_, i64>(3)? != 0,
            page_count: row.get(4)?,
            last_opened_at: row.get(5)?,
            relation_count: row.get(6)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}
```

Add `build_folder_distribution`, `list_tag_activities_tx`, and recommendations:

```rust
fn build_folder_distribution(documents: &[TagDashboardDocument]) -> Vec<TagFolderDistribution> {
    let mut counts = std::collections::BTreeMap::<String, i64>::new();
    for document in documents {
        let folder = document
            .path
            .as_ref()
            .and_then(|path| Path::new(path).parent())
            .map(|path| path.to_string_lossy().to_string())
            .filter(|folder| !folder.is_empty())
            .unwrap_or_else(|| "未知位置".to_string());
        *counts.entry(folder).or_insert(0) += 1;
    }

    let total: i64 = counts.values().sum();
    let colors = ["#2563eb", "#06b6d4", "#f59e0b", "#ec4899", "#94a3b8"];
    counts
        .into_iter()
        .enumerate()
        .map(|(index, (folder, count))| TagFolderDistribution {
            folder,
            count,
            percent: if total == 0 { 0 } else { (count * 100 / total).max(1) },
            color: colors[index % colors.len()].to_string(),
        })
        .collect()
}

fn list_tag_activities_tx(
    connection: &Connection,
    tag_id: i64,
    tag_name: &str,
) -> Result<Vec<TagActivityRecord>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT id, tag_id, tag_name, action, target_type, target_id, target_label, created_at
        FROM tag_activity_log
        WHERE tag_id = ?1 OR tag_name = ?2
        ORDER BY created_at DESC, id DESC
        LIMIT 8
        "#,
    )?;
    let rows = statement.query_map(params![tag_id, tag_name], |row| {
        Ok(TagActivityRecord {
            id: row.get(0)?,
            tag_id: row.get(1)?,
            tag_name: row.get(2)?,
            action: row.get(3)?,
            target_type: row.get(4)?,
            target_id: row.get(5)?,
            target_label: row.get(6)?,
            created_at: row.get(7)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

fn build_tag_recommendations(tags: &[TagDashboardTagRow]) -> Vec<TagDashboardRecommendation> {
    let mut recommendations = Vec::new();
    let orphan_ids: Vec<i64> = tags
        .iter()
        .filter(|tag| tag.usage_count == 0)
        .map(|tag| tag.id)
        .collect();
    if !orphan_ids.is_empty() {
        recommendations.push(TagDashboardRecommendation {
            id: "orphan-tags".to_string(),
            title: format!("发现 {} 个孤立标签", orphan_ids.len()),
            description: "这些标签尚未关联文档或批注，可考虑删除或合并。".to_string(),
            tag_ids: orphan_ids,
            severity: "warning".to_string(),
        });
    }

    let low_usage_ids: Vec<i64> = tags
        .iter()
        .filter(|tag| tag.usage_count > 0 && tag.usage_count <= 2)
        .map(|tag| tag.id)
        .collect();
    if !low_usage_ids.is_empty() {
        recommendations.push(TagDashboardRecommendation {
            id: "low-usage-tags".to_string(),
            title: format!("发现 {} 个低频标签", low_usage_ids.len()),
            description: "低频标签可能适合与相近主题合并。".to_string(),
            tag_ids: low_usage_ids,
            severity: "info".to_string(),
        });
    }

    recommendations
}
```

- [ ] **Step 4: Add the Tauri command and register it**

Add in `src-tauri/src/db.rs` near other commands:

```rust
#[tauri::command]
pub fn load_tag_dashboard(state: State<'_, DatabaseState>) -> Result<TagDashboard, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    load_tag_dashboard_tx(&connection)
}
```

Add `db::load_tag_dashboard` to `src-tauri/src/lib.rs` after `db::list_tags`.

- [ ] **Step 5: Add dashboard query test**

Add this test:

```rust
    #[test]
    fn loads_tag_dashboard_from_real_relations() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");
        save_document_tx(
            &connection,
            PersistedDocument {
                document_key: "desktop:/paper.pdf".to_string(),
                path: Some("/Users/mario/Papers/paper.pdf".to_string()),
                display_name: "Attention Is All You Need.pdf".to_string(),
                file_size: None,
                modified_at: None,
                page_count: Some(15),
                last_page: 1,
                progress: 0.2,
                missing: false,
            },
        )
        .expect("save document");
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "Transformer".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("create tag");
        attach_document_tag_tx(&connection, "desktop:/paper.pdf", tag.id).expect("attach tag");

        let dashboard = load_tag_dashboard_tx(&connection).expect("load dashboard");

        assert_eq!(dashboard.overview.total_tags, 1);
        assert_eq!(dashboard.overview.active_tags, 1);
        assert_eq!(dashboard.overview.total_usage, 1);
        assert_eq!(dashboard.tags[0].name, "Transformer");
        assert_eq!(dashboard.details[0].documents[0].display_name, "Attention Is All You Need.pdf");
        assert_eq!(dashboard.details[0].folder_distribution[0].count, 1);
        assert!(!dashboard.details[0].activities.is_empty());
    }
```

- [ ] **Step 6: Run focused dashboard test**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml loads_tag_dashboard_from_real_relations
```

Expected: PASS.

- [ ] **Step 7: Commit backend dashboard**

Run:

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs
git commit -m "feat: expose tag dashboard data"
```

---

### Task 4: Extend Frontend Persistence Types

**Files:**
- Modify: `src/tags/tagModels.ts`
- Modify: `src/persistence/persistenceApi.ts`
- Modify: `src/persistence/persistenceApi.test.ts`

- [ ] **Step 1: Add dashboard TypeScript types**

Append to `src/tags/tagModels.ts`:

```ts
export type TagDashboard = {
  overview: TagDashboardOverview;
  tags: TagDashboardTagRow[];
  details: TagDashboardDetail[];
  recommendations: TagDashboardRecommendation[];
};

export type TagDashboardOverview = {
  totalTags: number;
  activeTags: number;
  totalUsage: number;
  orphanTags: number;
};

export type TagDashboardTagRow = {
  id: number;
  name: string;
  color: string;
  usageCount: number;
  documentCount: number;
  annotationCount: number;
  recentUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
  description: string;
};

export type TagDashboardDetail = {
  tag: TagDashboardTagRow;
  documents: TagDashboardDocument[];
  folderDistribution: TagFolderDistribution[];
  activities: TagActivityRecord[];
};

export type TagDashboardDocument = {
  documentKey: string;
  displayName: string;
  path: string | null;
  missing: boolean;
  pageCount: number | null;
  lastOpenedAt: string | null;
  relationCount: number;
};

export type TagFolderDistribution = {
  folder: string;
  count: number;
  percent: number;
  color: string;
};

export type TagActivityRecord = {
  id: number;
  tagId: number | null;
  tagName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  createdAt: string;
};

export type TagDashboardRecommendation = {
  id: string;
  title: string;
  description: string;
  tagIds: number[];
  severity: 'info' | 'warning' | 'danger';
};
```

- [ ] **Step 2: Add persistence API method**

Update the import in `src/persistence/persistenceApi.ts`:

```ts
import type { CreateTagInput, MergeTagsInput, Tag, TagDashboard } from '../tags/tagModels';
```

Add to `PersistenceApi`:

```ts
  loadTagDashboard(): Promise<TagDashboard>;
```

Add to `createPersistenceApi`:

```ts
    loadTagDashboard() {
      return invoke<TagDashboard>('load_tag_dashboard');
    },
```

- [ ] **Step 3: Test invoke wiring**

In `src/persistence/persistenceApi.test.ts`, extend the existing tags test or add a new test:

```ts
  it('loads the tag dashboard through Tauri invoke', async () => {
    const invoke = vi.fn().mockResolvedValue({
      overview: { totalTags: 0, activeTags: 0, totalUsage: 0, orphanTags: 0 },
      tags: [],
      details: [],
      recommendations: [],
    });
    const api = createPersistenceApi(invoke);

    await api.loadTagDashboard();

    expect(invoke).toHaveBeenCalledWith('load_tag_dashboard');
  });
```

- [ ] **Step 4: Run focused persistence test**

Run:

```bash
bunx vitest run src/persistence/persistenceApi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit frontend API types**

Run:

```bash
git add src/tags/tagModels.ts src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts
git commit -m "feat: add tag dashboard frontend API"
```

---

### Task 5: Add Dashboard Utility Tests and Helpers

**Files:**
- Create: `src/tags/tagDashboardUtils.ts`
- Create: `src/tags/tagDashboardUtils.test.ts`

- [ ] **Step 1: Write utility tests**

Create `src/tags/tagDashboardUtils.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { TagDashboardTagRow } from './tagModels';
import {
  filterTagRows,
  getDefaultTagId,
  paginateTagRows,
  sortTagRows,
} from './tagDashboardUtils';

const rows: TagDashboardTagRow[] = [
  {
    id: 1,
    name: '深度学习',
    color: '#2563eb',
    usageCount: 9,
    documentCount: 5,
    annotationCount: 4,
    recentUsedAt: '2026-07-07T09:42:00Z',
    createdAt: '2026-07-01T09:00:00Z',
    updatedAt: '2026-07-07T09:42:00Z',
    description: '深度学习 相关文献与批注',
  },
  {
    id: 2,
    name: 'Transformer',
    color: '#f97316',
    usageCount: 3,
    documentCount: 2,
    annotationCount: 1,
    recentUsedAt: '2026-07-06T09:42:00Z',
    createdAt: '2026-07-02T09:00:00Z',
    updatedAt: '2026-07-06T09:42:00Z',
    description: 'Transformer 相关文献与批注',
  },
];

describe('tagDashboardUtils', () => {
  it('filters rows by name, description, and color', () => {
    expect(filterTagRows(rows, '深度', 'all')).toHaveLength(1);
    expect(filterTagRows(rows, '文献', '#f97316')).toEqual([rows[1]]);
  });

  it('sorts by usage, documents, and recent activity', () => {
    expect(sortTagRows(rows, 'usage').map((row) => row.id)).toEqual([1, 2]);
    expect(sortTagRows(rows, 'documents').map((row) => row.id)).toEqual([1, 2]);
    expect(sortTagRows([...rows].reverse(), 'recent').map((row) => row.id)).toEqual([1, 2]);
  });

  it('paginates rows with a bounded page number', () => {
    expect(paginateTagRows(rows, 1, 1).items).toEqual([rows[0]]);
    expect(paginateTagRows(rows, 99, 1).page).toBe(2);
  });

  it('selects the highest-usage tag by default', () => {
    expect(getDefaultTagId(rows)).toBe(1);
    expect(getDefaultTagId([])).toBeNull();
  });
});
```

- [ ] **Step 2: Implement helpers**

Create `src/tags/tagDashboardUtils.ts`:

```ts
import type { TagDashboardTagRow } from './tagModels';

export type TagSortKey = 'usage' | 'documents' | 'recent';

export function filterTagRows(
  rows: TagDashboardTagRow[],
  query: string,
  color: string,
): TagDashboardTagRow[] {
  const keyword = query.trim().toLocaleLowerCase();

  return rows.filter((row) => {
    const matchesColor = color === 'all' || row.color === color;
    const matchesKeyword =
      keyword.length === 0 ||
      row.name.toLocaleLowerCase().includes(keyword) ||
      row.description.toLocaleLowerCase().includes(keyword);

    return matchesColor && matchesKeyword;
  });
}

export function sortTagRows(
  rows: TagDashboardTagRow[],
  sortKey: TagSortKey,
): TagDashboardTagRow[] {
  const sorted = [...rows];

  sorted.sort((left, right) => {
    if (sortKey === 'documents') {
      return right.documentCount - left.documentCount || compareNames(left, right);
    }

    if (sortKey === 'recent') {
      return compareDates(right.recentUsedAt, left.recentUsedAt) || compareNames(left, right);
    }

    return right.usageCount - left.usageCount || compareNames(left, right);
  });

  return sorted;
}

export function paginateTagRows(
  rows: TagDashboardTagRow[],
  page: number,
  pageSize: number,
): { items: TagDashboardTagRow[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const boundedPage = Math.min(Math.max(1, page), totalPages);
  const start = (boundedPage - 1) * pageSize;

  return {
    items: rows.slice(start, start + pageSize),
    page: boundedPage,
    totalPages,
  };
}

export function getDefaultTagId(rows: TagDashboardTagRow[]): number | null {
  return sortTagRows(rows, 'usage')[0]?.id ?? null;
}

function compareNames(left: TagDashboardTagRow, right: TagDashboardTagRow): number {
  return left.name.localeCompare(right.name, 'zh-Hans-CN');
}

function compareDates(left: string | null, right: string | null): number {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime();
}
```

- [ ] **Step 3: Run utility tests**

Run:

```bash
bunx vitest run src/tags/tagDashboardUtils.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit utilities**

Run:

```bash
git add src/tags/tagDashboardUtils.ts src/tags/tagDashboardUtils.test.ts
git commit -m "feat: add tag dashboard utilities"
```

---

### Task 6: Build Tag Workspace Shell

**Files:**
- Modify: `src/tags/TagManager.tsx`
- Modify: `src/app/ReaderWorkspaceSwitch.tsx`
- Modify: `src/app/styles.css`
- Create: `src/tags/TagManager.test.tsx`

- [ ] **Step 1: Write shell rendering test**

Create `src/tags/TagManager.test.tsx` with a minimal dashboard fixture:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagManager } from './TagManager';
import type { TagDashboard } from './tagModels';

const dashboard: TagDashboard = {
  overview: { totalTags: 1, activeTags: 1, totalUsage: 4, orphanTags: 0 },
  tags: [
    {
      id: 1,
      name: '深度学习',
      color: '#2563eb',
      usageCount: 4,
      documentCount: 2,
      annotationCount: 2,
      recentUsedAt: '2026-07-07T09:42:00Z',
      createdAt: '2026-07-01T08:00:00Z',
      updatedAt: '2026-07-07T09:42:00Z',
      description: '深度学习 相关文献与批注',
    },
  ],
  details: [
    {
      tag: {
        id: 1,
        name: '深度学习',
        color: '#2563eb',
        usageCount: 4,
        documentCount: 2,
        annotationCount: 2,
        recentUsedAt: '2026-07-07T09:42:00Z',
        createdAt: '2026-07-01T08:00:00Z',
        updatedAt: '2026-07-07T09:42:00Z',
        description: '深度学习 相关文献与批注',
      },
      documents: [],
      folderDistribution: [],
      activities: [],
    },
  ],
  recommendations: [],
};

function renderTagManager() {
  const persistence = {
    loadTagDashboard: vi.fn().mockResolvedValue(dashboard),
    createTag: vi.fn(),
    renameTag: vi.fn(),
    deleteTag: vi.fn(),
    mergeTags: vi.fn(),
  } as unknown as Parameters<typeof TagManager>[0]['persistence'];

  render(
    <TagManager
      persistence={persistence}
      onTagsChange={vi.fn()}
      onClose={vi.fn()}
      onOpenDocument={vi.fn()}
    />,
  );

  return persistence;
}

describe('TagManager', () => {
  it('renders the dashboard shell from backend data', async () => {
    renderTagManager();

    expect(await screen.findByRole('heading', { name: '标签管理' })).toBeInTheDocument();
    expect(screen.getByText('标签概览')).toBeInTheDocument();
    expect(screen.getByText('标签云')).toBeInTheDocument();
    expect(screen.getByText('标签详情')).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText('深度学习').length).toBeGreaterThan(0));
  });
});
```

- [ ] **Step 2: Update TagManager props and shell**

Replace `src/tags/TagManager.tsx` with an orchestrator that loads dashboard data:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Plus, RotateCcw, X } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
import type { PersistenceApi } from '../persistence/persistenceApi';
import type { Tag, TagDashboard } from './tagModels';
import { filterTagRows, getDefaultTagId, paginateTagRows, sortTagRows, type TagSortKey } from './tagDashboardUtils';

type TagManagerProps = {
  persistence: Pick<
    PersistenceApi,
    'loadTagDashboard' | 'createTag' | 'renameTag' | 'deleteTag' | 'mergeTags'
  >;
  onTagsChange: Dispatch<SetStateAction<Tag[]>>;
  onClose(): void;
  onOpenDocument(documentKey: string, documentPath: string | null, page: number, missing: boolean): void;
};

export function TagManager({ persistence, onClose }: TagManagerProps) {
  const [dashboard, setDashboard] = useState<TagDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<number | null>(null);
  const [query, setQuery] = useState('');
  const [color, setColor] = useState('all');
  const [sortKey, setSortKey] = useState<TagSortKey>('usage');
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const nextDashboard = await persistence.loadTagDashboard();
      setDashboard(nextDashboard);
      setSelectedTagId((current) => current ?? getDefaultTagId(nextDashboard.tags));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '标签看板加载失败');
    } finally {
      setLoading(false);
    }
  }, [persistence]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const visibleRows = useMemo(() => {
    if (!dashboard) {
      return [];
    }

    return sortTagRows(filterTagRows(dashboard.tags, query, color), sortKey);
  }, [color, dashboard, query, sortKey]);

  const pageRows = paginateTagRows(visibleRows, page, pageSize);
  const selectedDetail = dashboard?.details.find((detail) => detail.tag.id === selectedTagId) ?? dashboard?.details[0] ?? null;

  return (
    <section className="tag-dashboard-workspace" aria-label="标签管理工作区">
      <main className="tag-dashboard-main">
        <header className="tag-dashboard-heading">
          <h1>标签管理</h1>
        </header>
        {loading ? (
          <div className="tag-dashboard-state" role="status">
            <Loader2 size={18} />
            <span>正在加载标签看板...</span>
          </div>
        ) : error ? (
          <div className="tag-dashboard-state error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
            <button type="button" onClick={() => void loadDashboard()}>
              <RotateCcw size={14} />
              重试
            </button>
          </div>
        ) : dashboard ? (
          <div className="tag-dashboard-content">
            <div className="tag-dashboard-toolbar">
              <input
                aria-label="搜索标签名称或描述"
                placeholder="搜索标签名称或描述..."
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(1);
                }}
              />
              <select aria-label="颜色筛选" value={color} onChange={(event) => setColor(event.target.value)}>
                <option value="all">全部颜色</option>
                {Array.from(new Set(dashboard.tags.map((tag) => tag.color))).map((tagColor) => (
                  <option key={tagColor} value={tagColor}>{tagColor}</option>
                ))}
              </select>
              <select aria-label="排序方式" value={sortKey} onChange={(event) => setSortKey(event.target.value as TagSortKey)}>
                <option value="usage">使用次数</option>
                <option value="documents">关联文献</option>
                <option value="recent">最近使用</option>
              </select>
              <button type="button" onClick={() => { setQuery(''); setColor('all'); setSortKey('usage'); setPage(1); }}>
                清除筛选
              </button>
              <button type="button" className="tag-dashboard-primary">
                <Plus size={14} />
                创建标签
              </button>
            </div>
            <section className="tag-dashboard-card">
              <h2>标签概览</h2>
              <div className="tag-dashboard-overview-grid">
                <strong>{dashboard.overview.totalTags}</strong>
                <strong>{dashboard.overview.activeTags}</strong>
                <strong>{dashboard.overview.totalUsage}</strong>
                <strong>{dashboard.overview.orphanTags}</strong>
              </div>
            </section>
            <section className="tag-dashboard-card">
              <h2>标签云</h2>
              <div className="tag-cloud-list">
                {dashboard.tags.map((tag) => (
                  <button key={tag.id} type="button" onClick={() => setSelectedTagId(tag.id)} style={{ borderColor: tag.color, color: tag.color }}>
                    {tag.name} <span>{tag.usageCount}</span>
                  </button>
                ))}
              </div>
            </section>
            <section className="tag-dashboard-card tag-table-card">
              <h2>全部标签（{visibleRows.length}）</h2>
              <div className="tag-dashboard-table" role="table">
                {pageRows.items.map((tag) => (
                  <button key={tag.id} type="button" className="tag-dashboard-row" onClick={() => setSelectedTagId(tag.id)}>
                    <span style={{ backgroundColor: tag.color }} />
                    <strong>{tag.name}</strong>
                    <span>{tag.usageCount}</span>
                    <span>{tag.documentCount}</span>
                    <span>{tag.recentUsedAt ?? '暂无'}</span>
                    <span>{tag.description}</span>
                  </button>
                ))}
              </div>
              <div className="tag-dashboard-pagination">
                <span>共 {visibleRows.length} 条记录</span>
                <button type="button" disabled={pageRows.page <= 1} onClick={() => setPage(pageRows.page - 1)}>上一页</button>
                <span>{pageRows.page} / {pageRows.totalPages}</span>
                <button type="button" disabled={pageRows.page >= pageRows.totalPages} onClick={() => setPage(pageRows.page + 1)}>下一页</button>
              </div>
            </section>
          </div>
        ) : null}
      </main>
      <aside className="tag-dashboard-detail-panel">
        <header>
          <h2>标签详情</h2>
          <button type="button" aria-label="关闭标签详情" onClick={onClose}>
            <X size={14} />
          </button>
        </header>
        {selectedDetail ? <strong>{selectedDetail.tag.name}</strong> : <span>暂无标签</span>}
      </aside>
    </section>
  );
}
```

This shell is intentionally incomplete visually; later tasks replace temporary internal markup with focused components.

- [ ] **Step 3: Update workspace switch prop**

In `src/app/ReaderWorkspaceSwitch.tsx`, update the `TagManager` usage:

```tsx
        <TagManager
          persistence={persistence}
          onTagsChange={onTagsChange}
          onClose={() => setWorkspaceOverride(null)}
          onOpenDocument={(documentKey, documentPath, page, missing) =>
            void openRecordPage(documentKey, documentPath, page, missing)
          }
        />
```

- [ ] **Step 4: Add shell styles**

Append minimal layout styles to `src/app/styles.css`:

```css
.tag-dashboard-workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  background: #f8fafc;
  color: var(--sr-text);
}

.tag-dashboard-main {
  min-width: 0;
  min-height: 0;
  padding: 28px;
  overflow: auto;
}

.tag-dashboard-heading h1 {
  margin: 0;
  color: #0f172a;
  font-size: 26px;
  line-height: 1.2;
}

.tag-dashboard-content {
  display: grid;
  gap: 18px;
  margin-top: 24px;
}

.tag-dashboard-card,
.tag-dashboard-detail-panel {
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  background: #ffffff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.04);
}
```

- [ ] **Step 5: Run shell test**

Run:

```bash
bunx vitest run src/tags/TagManager.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit shell**

Run:

```bash
git add src/tags/TagManager.tsx src/tags/TagManager.test.tsx src/app/ReaderWorkspaceSwitch.tsx src/app/styles.css
git commit -m "feat: add tag dashboard shell"
```

---

### Task 7: Split Main Dashboard Components

**Files:**
- Create: `src/tags/TagDashboardToolbar.tsx`
- Create: `src/tags/TagOverviewCards.tsx`
- Create: `src/tags/TagCloudPanel.tsx`
- Create: `src/tags/TagTable.tsx`
- Modify: `src/tags/TagManager.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Create toolbar component**

Create `src/tags/TagDashboardToolbar.tsx`:

```tsx
import { Plus, Search } from 'lucide-react';
import type { TagDashboardTagRow } from './tagModels';
import type { TagSortKey } from './tagDashboardUtils';

type TagDashboardToolbarProps = {
  tags: TagDashboardTagRow[];
  query: string;
  color: string;
  sortKey: TagSortKey;
  onQueryChange(value: string): void;
  onColorChange(value: string): void;
  onSortChange(value: TagSortKey): void;
  onClear(): void;
  onCreate(): void;
};

export function TagDashboardToolbar({
  tags,
  query,
  color,
  sortKey,
  onQueryChange,
  onColorChange,
  onSortChange,
  onClear,
  onCreate,
}: TagDashboardToolbarProps) {
  const colors = Array.from(new Set(tags.map((tag) => tag.color)));

  return (
    <div className="tag-dashboard-toolbar" aria-label="标签筛选工具栏">
      <label className="tag-dashboard-search">
        <Search size={16} />
        <input
          aria-label="搜索标签名称或描述"
          placeholder="搜索标签名称或描述..."
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </label>
      <select aria-label="颜色筛选" value={color} onChange={(event) => onColorChange(event.target.value)}>
        <option value="all">全部颜色</option>
        {colors.map((tagColor) => (
          <option key={tagColor} value={tagColor}>{tagColor}</option>
        ))}
      </select>
      <select aria-label="排序方式" value={sortKey} onChange={(event) => onSortChange(event.target.value as TagSortKey)}>
        <option value="usage">使用次数</option>
        <option value="documents">关联文献</option>
        <option value="recent">最近使用</option>
      </select>
      <button type="button" className="tag-dashboard-ghost" onClick={onClear}>清除筛选</button>
      <button type="button" className="tag-dashboard-primary" onClick={onCreate}>
        <Plus size={15} />
        创建标签
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create overview component**

Create `src/tags/TagOverviewCards.tsx`:

```tsx
import { Hash, Link2, RotateCcw, Tags } from 'lucide-react';
import type { TagDashboardOverview } from './tagModels';

type TagOverviewCardsProps = {
  overview: TagDashboardOverview;
};

export function TagOverviewCards({ overview }: TagOverviewCardsProps) {
  const cards = [
    { label: '全部标签', value: overview.totalTags, icon: Tags },
    { label: '使用中的标签', value: overview.activeTags, icon: Link2 },
    { label: '总使用次数', value: overview.totalUsage, icon: RotateCcw },
    { label: '孤立标签', value: overview.orphanTags, icon: Hash },
  ];

  return (
    <section className="tag-dashboard-card tag-overview-card" aria-label="标签概览">
      <h2>标签概览</h2>
      <div className="tag-overview-grid">
        {cards.map(({ label, value, icon: Icon }) => (
          <div key={label}>
            <span><Icon size={15} />{label}</span>
            <strong>{value.toLocaleString()}</strong>
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create cloud component**

Create `src/tags/TagCloudPanel.tsx`:

```tsx
import type { TagDashboardTagRow } from './tagModels';

type TagCloudPanelProps = {
  tags: TagDashboardTagRow[];
  selectedTagId: number | null;
  onSelectTag(tagId: number): void;
};

export function TagCloudPanel({ tags, selectedTagId, onSelectTag }: TagCloudPanelProps) {
  return (
    <section className="tag-dashboard-card tag-cloud-card" aria-label="标签云">
      <h2>标签云</h2>
      <div className="tag-cloud-list">
        {tags.length > 0 ? tags.slice(0, 12).map((tag) => (
          <button
            key={tag.id}
            type="button"
            className={tag.id === selectedTagId ? 'active' : undefined}
            style={{ '--tag-color': tag.color } as React.CSSProperties}
            onClick={() => onSelectTag(tag.id)}
          >
            {tag.name}
            <span>{tag.usageCount}</span>
          </button>
        )) : <p className="tag-dashboard-empty">暂无标签</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Create table component**

Create `src/tags/TagTable.tsx`:

```tsx
import { ChevronLeft, ChevronRight, GitMerge, Pencil, Trash2 } from 'lucide-react';
import type { TagDashboardTagRow } from './tagModels';

type TagTableProps = {
  rows: TagDashboardTagRow[];
  totalCount: number;
  page: number;
  totalPages: number;
  selectedTagId: number | null;
  onPageChange(page: number): void;
  onSelectTag(tagId: number): void;
  onEdit(tag: TagDashboardTagRow): void;
  onMerge(tag: TagDashboardTagRow): void;
  onDelete(tag: TagDashboardTagRow): void;
};

export function TagTable({
  rows,
  totalCount,
  page,
  totalPages,
  selectedTagId,
  onPageChange,
  onSelectTag,
  onEdit,
  onMerge,
  onDelete,
}: TagTableProps) {
  return (
    <section className="tag-dashboard-card tag-table-card" aria-label="全部标签">
      <h2>全部标签（{totalCount}）</h2>
      <div className="tag-table">
        <div className="tag-table-head">
          <span>标签名称</span>
          <span>使用次数</span>
          <span>关联文献数</span>
          <span>最近使用时间</span>
          <span>描述</span>
          <span>操作</span>
        </div>
        {rows.map((tag) => (
          <div key={tag.id} className={tag.id === selectedTagId ? 'tag-table-row active' : 'tag-table-row'}>
            <button type="button" className="tag-table-name" onClick={() => onSelectTag(tag.id)}>
              <i style={{ backgroundColor: tag.color }} />
              <strong>{tag.name}</strong>
            </button>
            <span>{tag.usageCount}</span>
            <span>{tag.documentCount}</span>
            <span>{tag.recentUsedAt ?? '暂无'}</span>
            <span>{tag.description}</span>
            <div className="tag-table-actions">
              <button type="button" aria-label={`编辑 ${tag.name}`} onClick={() => onEdit(tag)}><Pencil size={15} /></button>
              <button type="button" aria-label={`合并 ${tag.name}`} onClick={() => onMerge(tag)}><GitMerge size={15} /></button>
              <button type="button" aria-label={`删除 ${tag.name}`} onClick={() => onDelete(tag)}><Trash2 size={15} /></button>
            </div>
          </div>
        ))}
      </div>
      <footer className="tag-dashboard-pagination">
        <span>共 {totalCount} 条记录</span>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)}><ChevronLeft size={15} /></button>
        <strong>{page}</strong>
        <span>/</span>
        <strong>{totalPages}</strong>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}><ChevronRight size={15} /></button>
        <span>10 条/页</span>
      </footer>
    </section>
  );
}
```

- [ ] **Step 5: Wire components into TagManager**

Replace internal toolbar/overview/cloud/table markup in `TagManager.tsx` with imports and component usage:

```tsx
<TagDashboardToolbar
  tags={dashboard.tags}
  query={query}
  color={color}
  sortKey={sortKey}
  onQueryChange={(value) => { setQuery(value); setPage(1); }}
  onColorChange={(value) => { setColor(value); setPage(1); }}
  onSortChange={(value) => { setSortKey(value); setPage(1); }}
  onClear={() => { setQuery(''); setColor('all'); setSortKey('usage'); setPage(1); }}
  onCreate={() => undefined}
/>
<div className="tag-dashboard-top-grid">
  <TagOverviewCards overview={dashboard.overview} />
  <TagCloudPanel tags={dashboard.tags} selectedTagId={selectedTagId} onSelectTag={setSelectedTagId} />
</div>
<TagTable
  rows={pageRows.items}
  totalCount={visibleRows.length}
  page={pageRows.page}
  totalPages={pageRows.totalPages}
  selectedTagId={selectedTagId}
  onPageChange={setPage}
  onSelectTag={setSelectedTagId}
  onEdit={() => undefined}
  onMerge={() => undefined}
  onDelete={() => undefined}
/>
```

- [ ] **Step 6: Add high-fidelity main-area styles**

Append styles to `src/app/styles.css` for `.tag-dashboard-toolbar`, `.tag-dashboard-search`, `.tag-dashboard-primary`, `.tag-dashboard-ghost`, `.tag-dashboard-top-grid`, `.tag-overview-grid`, `.tag-cloud-list`, `.tag-table`, `.tag-table-head`, `.tag-table-row`, `.tag-table-actions`, and `.tag-dashboard-pagination`. Match the prototype with 40px controls, `#2563eb` primary, `#f8fafc` background, `#e2e8f0` borders, 12px card radius, compact table rows, and colored pills using `--tag-color`.

- [ ] **Step 7: Run TagManager test**

Run:

```bash
bunx vitest run src/tags/TagManager.test.tsx src/tags/tagDashboardUtils.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit main dashboard components**

Run:

```bash
git add src/tags/TagDashboardToolbar.tsx src/tags/TagOverviewCards.tsx src/tags/TagCloudPanel.tsx src/tags/TagTable.tsx src/tags/TagManager.tsx src/app/styles.css
git commit -m "feat: build tag dashboard main view"
```

---

### Task 8: Add Details Panel and Dialogs

**Files:**
- Create: `src/tags/TagDetailsPanel.tsx`
- Create: `src/tags/TagCreateEditDialog.tsx`
- Modify: `src/tags/TagManager.tsx`
- Modify: `src/app/styles.css`

- [ ] **Step 1: Create details panel**

Create `src/tags/TagDetailsPanel.tsx`:

```tsx
import { FileText, Lightbulb, Pencil, X } from 'lucide-react';
import type { TagDashboardDetail, TagDashboardRecommendation } from './tagModels';

type TagDetailsPanelProps = {
  detail: TagDashboardDetail | null;
  recommendations: TagDashboardRecommendation[];
  onClose(): void;
  onEdit(): void;
  onOpenDocument(documentKey: string, path: string | null, missing: boolean): void;
};

export function TagDetailsPanel({
  detail,
  recommendations,
  onClose,
  onEdit,
  onOpenDocument,
}: TagDetailsPanelProps) {
  return (
    <aside className="tag-dashboard-detail-panel" aria-label="标签详情">
      <header>
        <h2>标签详情</h2>
        <button type="button" aria-label="关闭标签详情" onClick={onClose}><X size={15} /></button>
      </header>
      {detail ? (
        <>
          <section className="tag-detail-summary">
            <div>
              <i style={{ backgroundColor: detail.tag.color }} />
              <strong>{detail.tag.name}</strong>
            </div>
            <button type="button" onClick={onEdit}><Pencil size={14} />编辑</button>
            <dl>
              <div><dt>使用次数</dt><dd>{detail.tag.usageCount}</dd></div>
              <div><dt>关联文献数</dt><dd>{detail.tag.documentCount}</dd></div>
              <div><dt>最近使用</dt><dd>{detail.tag.recentUsedAt ?? '暂无'}</dd></div>
              <div><dt>创建时间</dt><dd>{detail.tag.createdAt}</dd></div>
            </dl>
            <p>{detail.tag.description}</p>
          </section>
          <section className="tag-detail-card">
            <div className="tag-detail-card-heading"><h3>代表性文献</h3><span>{detail.documents.length}</span></div>
            {detail.documents.length > 0 ? detail.documents.map((document) => (
              <button key={document.documentKey} type="button" onClick={() => onOpenDocument(document.documentKey, document.path, document.missing)}>
                <FileText size={16} />
                <span><strong>{document.displayName}</strong><small>{document.relationCount} 个关联</small></span>
              </button>
            )) : <p className="tag-dashboard-empty">暂无关联文献</p>}
          </section>
          <section className="tag-detail-card">
            <div className="tag-detail-card-heading"><h3>文件夹分布</h3></div>
            {detail.folderDistribution.length > 0 ? detail.folderDistribution.map((item) => (
              <div key={item.folder} className="tag-folder-row">
                <i style={{ backgroundColor: item.color }} />
                <span>{item.folder}</span>
                <strong>{item.count} ({item.percent}%)</strong>
              </div>
            )) : <p className="tag-dashboard-empty">暂无分布数据</p>}
          </section>
          <section className="tag-detail-card">
            <div className="tag-detail-card-heading"><h3>最近活动</h3></div>
            {detail.activities.length > 0 ? detail.activities.map((activity) => (
              <div key={activity.id} className="tag-activity-row">
                <span>{activity.createdAt}</span>
                <strong>{activity.targetLabel ?? activity.action}</strong>
              </div>
            )) : <p className="tag-dashboard-empty">暂无活动记录</p>}
          </section>
          <section className="tag-detail-card tag-recommendation-card">
            <div className="tag-detail-card-heading"><h3>批量整理建议</h3></div>
            {recommendations.length > 0 ? recommendations.slice(0, 2).map((recommendation) => (
              <div key={recommendation.id}>
                <Lightbulb size={15} />
                <span><strong>{recommendation.title}</strong><small>{recommendation.description}</small></span>
              </div>
            )) : <p className="tag-dashboard-empty">暂无整理建议</p>}
          </section>
        </>
      ) : <p className="tag-dashboard-empty">暂无标签详情</p>}
    </aside>
  );
}
```

- [ ] **Step 2: Create dialog component**

Create `src/tags/TagCreateEditDialog.tsx`:

```tsx
import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { TagDashboardTagRow } from './tagModels';

type TagCreateEditDialogProps = {
  mode: 'create' | 'edit' | 'merge' | null;
  tag: TagDashboardTagRow | null;
  tags: TagDashboardTagRow[];
  saving: boolean;
  error: string | null;
  onClose(): void;
  onCreate(name: string, color: string): void;
  onRename(tag: TagDashboardTagRow, name: string): void;
  onMerge(source: TagDashboardTagRow, targetId: number): void;
};

const colors = ['#2563eb', '#f97316', '#22c55e', '#8b5cf6', '#ec4899', '#14b8a6', '#facc15', '#94a3b8'];

export function TagCreateEditDialog({ mode, tag, tags, saving, error, onClose, onCreate, onRename, onMerge }: TagCreateEditDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(colors[0]);
  const [targetId, setTargetId] = useState('');

  useEffect(() => {
    setName(tag?.name ?? '');
    setColor(tag?.color ?? colors[0]);
    setTargetId('');
  }, [mode, tag]);

  if (!mode) {
    return null;
  }

  const title = mode === 'create' ? '创建标签' : mode === 'edit' ? '编辑标签' : '合并标签';

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'create') {
      onCreate(name.trim(), color);
    }
    if (mode === 'edit' && tag) {
      onRename(tag, name.trim());
    }
    if (mode === 'merge' && tag && targetId) {
      onMerge(tag, Number(targetId));
    }
  }

  return (
    <div className="tag-dialog-backdrop" role="presentation">
      <form className="tag-dialog" aria-label={title} onSubmit={handleSubmit}>
        <header>
          <h2>{title}</h2>
          <button type="button" aria-label="关闭弹窗" onClick={onClose}><X size={15} /></button>
        </header>
        {mode === 'merge' ? (
          <label>
            <span>合并到</span>
            <select aria-label="合并目标标签" value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              <option value="">选择目标标签</option>
              {tags.filter((item) => item.id !== tag?.id).map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              <span>标签名称</span>
              <input aria-label="标签名称" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="tag-dialog-colors" role="radiogroup" aria-label="标签颜色">
              {colors.map((item) => (
                <button key={item} type="button" aria-label={`选择颜色 ${item}`} aria-pressed={item === color} style={{ backgroundColor: item }} onClick={() => setColor(item)} />
              ))}
            </div>
          </>
        )}
        {error ? <p className="settings-error" role="alert">{error}</p> : null}
        <footer>
          <button type="button" onClick={onClose}>取消</button>
          <button type="submit" className="tag-dashboard-primary" disabled={saving || (mode !== 'merge' && !name.trim()) || (mode === 'merge' && !targetId)}>{saving ? '保存中...' : '确认'}</button>
        </footer>
      </form>
    </div>
  );
}
```

- [ ] **Step 3: Wire details and dialogs into TagManager**

In `TagManager.tsx`, import and render `TagDetailsPanel` and `TagCreateEditDialog`. Add state:

```tsx
const [dialogMode, setDialogMode] = useState<'create' | 'edit' | 'merge' | null>(null);
const [dialogTag, setDialogTag] = useState<TagDashboardTagRow | null>(null);
const [saving, setSaving] = useState(false);
const [mutationError, setMutationError] = useState<string | null>(null);
```

Add handlers that call existing persistence mutations and then `loadDashboard()`:

```tsx
async function runMutation(action: () => Promise<void>) {
  setSaving(true);
  setMutationError(null);
  try {
    await action();
    setDialogMode(null);
    setDialogTag(null);
    await loadDashboard();
  } catch (mutationError) {
    setMutationError(mutationError instanceof Error ? mutationError.message : '标签操作失败');
  } finally {
    setSaving(false);
  }
}
```

Use `onCreate`, `onRename`, `onMerge`, and table actions to open dialogs and invoke mutations.

- [ ] **Step 4: Add detail and dialog styles**

Append dedicated styles for `.tag-dashboard-detail-panel`, `.tag-detail-summary`, `.tag-detail-card`, `.tag-folder-row`, `.tag-activity-row`, `.tag-recommendation-card`, `.tag-dialog-backdrop`, `.tag-dialog`, and `.tag-dialog-colors`. Match the prototype right panel width, white cards, 12px radius, compact typography, red PDF-like document icon styling through existing icon colors, and fixed overlay dialog behavior.

- [ ] **Step 5: Run TagManager test**

Run:

```bash
bunx vitest run src/tags/TagManager.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit details and dialogs**

Run:

```bash
git add src/tags/TagDetailsPanel.tsx src/tags/TagCreateEditDialog.tsx src/tags/TagManager.tsx src/app/styles.css
git commit -m "feat: add tag details and dialogs"
```

---

### Task 9: Complete Interactions and Tests

**Files:**
- Modify: `src/tags/TagManager.test.tsx`
- Modify: `src/tags/TagManager.tsx`
- Modify: `src/tags/TagTable.tsx`
- Modify: `src/tags/TagDetailsPanel.tsx`

- [ ] **Step 1: Add interaction tests**

Extend `src/tags/TagManager.test.tsx` with tests for filter and create:

```tsx
import userEvent from '@testing-library/user-event';

it('filters tags from the toolbar', async () => {
  renderTagManager();

  await screen.findByText('深度学习');
  await userEvent.type(screen.getByLabelText('搜索标签名称或描述'), '不存在');

  expect(screen.queryByText('深度学习')).not.toBeInTheDocument();
});

it('creates a tag and refreshes the dashboard', async () => {
  const persistence = renderTagManager();

  await screen.findByRole('heading', { name: '标签管理' });
  await userEvent.click(screen.getByRole('button', { name: '创建标签' }));
  await userEvent.type(screen.getByLabelText('标签名称'), '计算机视觉');
  await userEvent.click(screen.getByRole('button', { name: '确认' }));

  await waitFor(() => expect(persistence.createTag).toHaveBeenCalledWith({ name: '计算机视觉', color: '#2563eb' }));
  await waitFor(() => expect(persistence.loadTagDashboard).toHaveBeenCalledTimes(2));
});
```

- [ ] **Step 2: Ensure create handler uses the selected color**

In `TagManager.tsx`, implement create callback:

```tsx
onCreate={(name, color) => void runMutation(async () => {
  const createdTag = await persistence.createTag({ name, color });
  onTagsChange((current) => [...current.filter((item) => item.id !== createdTag.id), createdTag]);
  setSelectedTagId(createdTag.id);
})}
```

- [ ] **Step 3: Ensure rename updates tag cache**

Implement rename callback:

```tsx
onRename={(tag, name) => void runMutation(async () => {
  const renamedTag = await persistence.renameTag(tag.id, name);
  onTagsChange((current) => [...current.filter((item) => item.id !== renamedTag.id), renamedTag]);
  setSelectedTagId(renamedTag.id);
})}
```

- [ ] **Step 4: Ensure merge and delete update selection**

Implement table delete and merge callbacks:

```tsx
async function handleDelete(tag: TagDashboardTagRow) {
  if (!window.confirm(`删除标签“${tag.name}”？`)) {
    return;
  }
  await runMutation(async () => {
    await persistence.deleteTag(tag.id);
    onTagsChange((current) => current.filter((item) => item.id !== tag.id));
    setSelectedTagId(null);
  });
}
```

For merge dialog:

```tsx
onMerge={(source, targetId) => void runMutation(async () => {
  const mergedTag = await persistence.mergeTags({ sourceTagId: source.id, targetTagId: targetId });
  onTagsChange((current) => [...current.filter((item) => item.id !== source.id && item.id !== mergedTag.id), mergedTag]);
  setSelectedTagId(mergedTag.id);
})}
```

- [ ] **Step 5: Wire document open from details**

In `TagDetailsPanel`, call `onOpenDocument(document.documentKey, document.path, document.missing)` and in `TagManager` adapt it to page 1:

```tsx
onOpenDocument={(documentKey, path, missing) => onOpenDocument(documentKey, path, 1, missing)}
```

- [ ] **Step 6: Run interaction tests**

Run:

```bash
bunx vitest run src/tags/TagManager.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit interactions**

Run:

```bash
git add src/tags/TagManager.test.tsx src/tags/TagManager.tsx src/tags/TagTable.tsx src/tags/TagDetailsPanel.tsx
git commit -m "feat: complete tag dashboard interactions"
```

---

### Task 10: Final Verification and Polish

**Files:**
- Modify only files required by failing tests or type errors.

- [ ] **Step 1: Run targeted frontend tests**

Run:

```bash
bunx vitest run src/persistence/persistenceApi.test.ts src/tags/tagDashboardUtils.test.ts src/tags/TagManager.test.tsx src/app/ReaderWorkspaceSwitch.test.tsx src/app/App.test.tsx
```

Expected: PASS. If a failure is unrelated to tag changes, record it before deciding whether a small compatibility fix is in scope.

- [ ] **Step 2: Run Rust tests**

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

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git status --short
git diff --stat
git diff -- src/app/styles.css src/tags src/persistence src-tauri/src | sed -n '1,240p'
```

Expected: only tag workspace, persistence API, and Tauri tag data files changed.

- [ ] **Step 5: Commit verification fixes**

If Step 1-3 required fixes, commit them:

```bash
git add src-tauri/src/db.rs src-tauri/src/lib.rs src-tauri/src/migrations/004_tag_activity_log.sql src/persistence/persistenceApi.ts src/persistence/persistenceApi.test.ts src/app/ReaderWorkspaceSwitch.tsx src/tags src/app/styles.css
git commit -m "test: verify tag management workspace"
```

If no fixes were required and the working tree is clean, do not create an empty commit.

---

## Self-Review Checklist

- Spec coverage: Tasks cover the migration, backend dashboard command, real activity logging, frontend API types, high-fidelity workspace, full interactions, tests, and final validation.
- No unsupported data: The plan does not use frontend mock data as product behavior; tests use fixtures only.
- Migration safety: The plan creates exactly one new migration file and does not modify existing migration files.
- Design pattern fit: The plan keeps aggregation behind `load_tag_dashboard` and avoids unnecessary frontend data assembly.
- Validation: The plan includes focused Rust tests, focused Vitest tests, broader frontend tests, Rust full tests, and TypeScript typecheck.
