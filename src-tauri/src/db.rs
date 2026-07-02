use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use time::OffsetDateTime;

const MIGRATIONS: &[Migration] = &[
    Migration {
        version: "001_init",
        sql: include_str!("migrations/001_init.sql"),
    },
    Migration {
        version: "002_reader_core_completion",
        sql: include_str!("migrations/002_reader_core_completion.sql"),
    },
    Migration {
        version: "003_workbench_stabilization",
        sql: include_str!("migrations/003_workbench_stabilization.sql"),
    },
];
const READER_PREFERENCES_KEY: &str = "reader_preferences";
pub const DEFAULT_CACHE_TOTAL_BYTES: i64 = 5 * 1024 * 1024 * 1024;

struct Migration {
    version: &'static str,
    sql: &'static str,
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("app data directory is not available")]
    AppDataDirUnavailable,
}

impl serde::Serialize for DbError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

pub struct DatabaseState {
    connection: Mutex<Connection>,
}

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
}

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
pub struct PersistedBookmarkRecord {
    pub id: Option<i64>,
    pub document_key: String,
    pub document_display_name: Option<String>,
    pub document_path: Option<String>,
    pub document_missing: bool,
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
    #[serde(default)]
    pub tag_ids: Option<Vec<i64>>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedAnnotationRecord {
    pub id: Option<i64>,
    pub document_key: String,
    pub document_display_name: Option<String>,
    pub document_path: Option<String>,
    pub document_missing: bool,
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
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    pub used_bytes: i64,
    pub total_bytes: i64,
    pub file_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FavoriteDocument {
    pub document_key: String,
    pub display_name: String,
    pub path: Option<String>,
    pub last_page: i64,
    pub progress: f64,
}

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

pub fn setup_database(app: &AppHandle) -> Result<DatabaseState, DbError> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| DbError::AppDataDirUnavailable)?;
    let connection = open_database(&default_database_path(app_data_dir))?;
    Ok(DatabaseState {
        connection: Mutex::new(connection),
    })
}

pub fn open_database(path: &Path) -> Result<Connection, DbError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }

    let connection = Connection::open(path)?;
    enable_foreign_keys(&connection)?;
    apply_migrations(&connection)?;
    Ok(connection)
}

pub fn default_database_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("smartreader.sqlite3")
}

pub fn apply_migrations(connection: &Connection) -> Result<(), DbError> {
    let had_schema_migrations = table_exists(connection, "schema_migrations")?;

    connection.execute(
        r#"
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TEXT NOT NULL
        )
        "#,
        [],
    )?;

    if !had_schema_migrations
        && column_exists(connection, "documents", "favorite")?
        && table_exists(connection, "annotations")?
    {
        mark_migration_applied(connection, "001_init")?;
        mark_migration_applied(connection, "002_reader_core_completion")?;
    }

    for migration in MIGRATIONS {
        if !migration_applied(connection, migration.version)? {
            apply_migration(connection, migration)?;
        }
    }

    Ok(())
}

fn enable_foreign_keys(connection: &Connection) -> Result<(), DbError> {
    connection.execute_batch("PRAGMA foreign_keys = ON")?;
    Ok(())
}

fn apply_migration(connection: &Connection, migration: &Migration) -> Result<(), DbError> {
    connection.execute_batch("BEGIN IMMEDIATE TRANSACTION")?;

    let result = (|| {
        connection.execute_batch(migration.sql)?;
        mark_migration_applied(connection, migration.version)?;
        Ok(())
    })();

    match result {
        Ok(()) => {
            connection.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn table_exists(connection: &Connection, table_name: &str) -> Result<bool, DbError> {
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
        [table_name],
        |row| row.get(0),
    )?;

    Ok(count == 1)
}

fn column_exists(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
) -> Result<bool, DbError> {
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM pragma_table_info(?1) WHERE name = ?2",
        params![table_name, column_name],
        |row| row.get(0),
    )?;

    Ok(count == 1)
}

fn migration_applied(connection: &Connection, version: &str) -> Result<bool, DbError> {
    let count: i64 = connection.query_row(
        "SELECT count(*) FROM schema_migrations WHERE version = ?1",
        [version],
        |row| row.get(0),
    )?;

    Ok(count == 1)
}

fn mark_migration_applied(connection: &Connection, version: &str) -> Result<(), DbError> {
    connection.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?1, ?2)",
        params![version, now_rfc3339()],
    )?;

    Ok(())
}

#[tauri::command]
pub fn save_document(
    state: State<'_, DatabaseState>,
    document: PersistedDocument,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    upsert_document(&connection, &document)
}

#[tauri::command]
pub fn list_recent_documents(
    state: State<'_, DatabaseState>,
) -> Result<Vec<PersistedDocument>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_documents(&connection)
}

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

#[tauri::command]
pub fn load_cache_stats(state: State<'_, DatabaseState>) -> Result<CacheStats, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    load_cache_stats_tx(&connection)
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
pub fn list_all_bookmarks(
    state: State<'_, DatabaseState>,
) -> Result<Vec<PersistedBookmarkRecord>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_all_bookmark_records_tx(&connection)
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
pub fn list_all_annotations(
    state: State<'_, DatabaseState>,
) -> Result<Vec<PersistedAnnotationRecord>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_all_annotation_records_tx(&connection)
}

#[tauri::command]
pub fn delete_annotation(state: State<'_, DatabaseState>, id: i64) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    connection.execute("DELETE FROM annotations WHERE id = ?1", [id])?;
    Ok(())
}

#[tauri::command]
pub fn set_document_favorite(
    state: State<'_, DatabaseState>,
    document_key: String,
    favorite: bool,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    set_document_favorite_tx(&connection, &document_key, favorite)
}

#[tauri::command]
pub fn list_favorite_documents(
    state: State<'_, DatabaseState>,
) -> Result<Vec<FavoriteDocument>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_favorite_documents_tx(&connection)
}

#[tauri::command]
pub fn create_tag(
    state: State<'_, DatabaseState>,
    input: CreateTagInput,
) -> Result<PersistedTag, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    create_tag_tx(&connection, input)
}

#[tauri::command]
pub fn rename_tag(
    state: State<'_, DatabaseState>,
    id: i64,
    name: String,
) -> Result<PersistedTag, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    rename_tag_tx(&connection, id, &name)
}

#[tauri::command]
pub fn delete_tag(state: State<'_, DatabaseState>, id: i64) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    delete_tag_tx(&connection, id)
}

#[tauri::command]
pub fn merge_tags(
    state: State<'_, DatabaseState>,
    input: MergeTagsInput,
) -> Result<PersistedTag, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    merge_tags_tx(&connection, input)
}

#[tauri::command]
pub fn list_tags(state: State<'_, DatabaseState>) -> Result<Vec<PersistedTag>, DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    list_tags_tx(&connection)
}

#[tauri::command]
pub fn attach_document_tag(
    state: State<'_, DatabaseState>,
    document_key: String,
    tag_id: i64,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    attach_document_tag_tx(&connection, &document_key, tag_id)
}

#[tauri::command]
pub fn detach_document_tag(
    state: State<'_, DatabaseState>,
    document_key: String,
    tag_id: i64,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    detach_document_tag_tx(&connection, &document_key, tag_id)
}

#[tauri::command]
pub fn attach_annotation_tag(
    state: State<'_, DatabaseState>,
    annotation_id: i64,
    tag_id: i64,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    attach_annotation_tag_tx(&connection, annotation_id, tag_id)
}

#[tauri::command]
pub fn detach_annotation_tag(
    state: State<'_, DatabaseState>,
    annotation_id: i64,
    tag_id: i64,
) -> Result<(), DbError> {
    let connection = state.connection.lock().expect("database mutex poisoned");
    detach_annotation_tag_tx(&connection, annotation_id, tag_id)
}

pub fn upsert_document(
    connection: &Connection,
    document: &PersistedDocument,
) -> Result<(), DbError> {
    let now = now_rfc3339();

    connection.execute(
        r#"
        INSERT INTO documents (
            document_key, path, display_name, file_size, modified_at, page_count,
            last_opened_at, last_page, progress, missing
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
        ON CONFLICT(document_key) DO UPDATE SET
            path = excluded.path,
            display_name = excluded.display_name,
            file_size = excluded.file_size,
            modified_at = excluded.modified_at,
            page_count = excluded.page_count,
            last_opened_at = excluded.last_opened_at,
            last_page = excluded.last_page,
            progress = excluded.progress,
            missing = excluded.missing
        "#,
        params![
            document.document_key,
            document.path,
            document.display_name,
            document.file_size,
            document.modified_at,
            document.page_count,
            now,
            document.last_page,
            document.progress,
            i64::from(document.missing),
        ],
    )?;

    Ok(())
}

pub fn list_documents(connection: &Connection) -> Result<Vec<PersistedDocument>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT document_key, path, display_name, file_size, modified_at, page_count,
               last_page, progress, missing
        FROM documents
        ORDER BY last_opened_at DESC
        "#,
    )?;

    let rows = statement.query_map([], |row| {
        Ok(PersistedDocument {
            document_key: row.get(0)?,
            path: row.get(1)?,
            display_name: row.get(2)?,
            file_size: row.get(3)?,
            modified_at: row.get(4)?,
            page_count: row.get(5)?,
            last_page: row.get(6)?,
            progress: row.get(7)?,
            missing: row.get::<_, i64>(8)? == 1,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn set_document_favorite_tx(
    connection: &Connection,
    document_key: &str,
    favorite: bool,
) -> Result<(), DbError> {
    let affected = connection.execute(
        "UPDATE documents SET favorite = ?1 WHERE document_key = ?2",
        params![i64::from(favorite), document_key],
    )?;
    if affected == 0 {
        return Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
    }

    Ok(())
}

pub fn list_favorite_documents_tx(
    connection: &Connection,
) -> Result<Vec<FavoriteDocument>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT document_key, display_name, path, last_page, progress
        FROM documents
        WHERE favorite = 1
        ORDER BY last_opened_at DESC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok(FavoriteDocument {
            document_key: row.get(0)?,
            display_name: row.get(1)?,
            path: row.get(2)?,
            last_page: row.get(3)?,
            progress: row.get(4)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn save_reader_session_tx(
    connection: &Connection,
    session: &PersistedReaderSession,
) -> Result<(), DbError> {
    connection.execute_batch("BEGIN IMMEDIATE TRANSACTION")?;

    let result = (|| -> Result<(), DbError> {
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
            params![
                active_document_id,
                i64::from(session.sidebar_open),
                now,
                now
            ],
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
                        serde_json::to_string(&tab.history)?,
                        now,
                    ],
                )?;
            }
        }

        Ok(())
    })();

    match result {
        Ok(()) => {
            connection.execute_batch("COMMIT")?;
            Ok(())
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
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

pub fn save_preferences_tx(
    connection: &Connection,
    preferences: &serde_json::Value,
) -> Result<(), DbError> {
    let now = now_rfc3339();
    connection.execute(
        r#"
        INSERT INTO preferences (key, value_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(key) DO UPDATE SET
            value_json = excluded.value_json,
            updated_at = excluded.updated_at
        "#,
        params![
            READER_PREFERENCES_KEY,
            serde_json::to_string(preferences)?,
            now,
        ],
    )?;

    Ok(())
}

pub fn load_preferences_tx(connection: &Connection) -> Result<Option<serde_json::Value>, DbError> {
    let mut statement =
        connection.prepare("SELECT value_json FROM preferences WHERE key = ?1 LIMIT 1")?;
    let mut rows = statement.query([READER_PREFERENCES_KEY])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };

    let value_json: String = row.get(0)?;
    Ok(Some(serde_json::from_str(&value_json)?))
}

pub fn load_cache_stats_tx(connection: &Connection) -> Result<CacheStats, DbError> {
    connection
        .query_row(
            "SELECT COALESCE(SUM(file_size), 0), COUNT(*) FROM cache_entries",
            [],
            |row| {
                Ok(CacheStats {
                    used_bytes: row.get(0)?,
                    total_bytes: DEFAULT_CACHE_TOTAL_BYTES,
                    file_count: row.get(1)?,
                })
            },
        )
        .map_err(DbError::from)
}

fn document_id_for_key(
    connection: &Connection,
    document_key: &str,
) -> Result<Option<i64>, DbError> {
    let mut statement = connection.prepare("SELECT id FROM documents WHERE document_key = ?1")?;
    let mut rows = statement.query([document_key])?;
    Ok(rows.next()?.map(|row| row.get(0)).transpose()?)
}

fn require_document_key(connection: &Connection, document_key: &str) -> Result<(), DbError> {
    connection.query_row(
        "SELECT 1 FROM documents WHERE document_key = ?1",
        [document_key],
        |_| Ok(()),
    )?;
    Ok(())
}

fn require_annotation_id(connection: &Connection, annotation_id: i64) -> Result<(), DbError> {
    connection.query_row(
        "SELECT 1 FROM annotations WHERE id = ?1",
        [annotation_id],
        |_| Ok(()),
    )?;
    Ok(())
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

pub fn list_all_bookmark_records_tx(
    connection: &Connection,
) -> Result<Vec<PersistedBookmarkRecord>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT b.id, b.document_key, d.display_name, d.path, COALESCE(d.missing, 1),
               b.page, b.title, b.created_at, b.updated_at
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
            document_missing: row.get::<_, i64>(4)? == 1,
            page: row.get(5)?,
            title: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
        })
    })?;
    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn upsert_annotation(
    connection: &Connection,
    annotation: PersistedAnnotation,
) -> Result<PersistedAnnotation, DbError> {
    let areas_json = serde_json::to_string(&annotation.areas)?;
    let replacement_tag_ids = annotation.tag_ids.clone();

    connection.execute_batch("BEGIN IMMEDIATE TRANSACTION")?;

    let result = (|| {
        let id = if let Some(id) = annotation.id {
            let affected = connection.execute(
                r#"
                UPDATE annotations
                SET document_key = ?1, page = ?2, type = ?3, color = ?4, text = ?5,
                    quote = ?6, areas_json = ?7, created_at = ?8, updated_at = ?9
                WHERE id = ?10
                "#,
                params![
                    &annotation.document_key,
                    annotation.page,
                    &annotation.r#type,
                    &annotation.color,
                    &annotation.text,
                    &annotation.quote,
                    &areas_json,
                    &annotation.created_at,
                    &annotation.updated_at,
                    id,
                ],
            )?;

            if affected == 0 {
                return Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows));
            }

            id
        } else {
            connection.execute(
                r#"
                INSERT INTO annotations (
                    document_key, page, type, color, text, quote, areas_json, created_at, updated_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
                params![
                    &annotation.document_key,
                    annotation.page,
                    &annotation.r#type,
                    &annotation.color,
                    &annotation.text,
                    &annotation.quote,
                    &areas_json,
                    &annotation.created_at,
                    &annotation.updated_at,
                ],
            )?;
            connection.last_insert_rowid()
        };

        if let Some(tag_ids) = replacement_tag_ids.as_ref() {
            replace_annotation_tag_ids_tx(connection, id, tag_ids)?;
        }

        Ok(PersistedAnnotation {
            id: Some(id),
            tag_ids: Some(list_annotation_tag_ids_tx(connection, id)?),
            ..annotation
        })
    })();

    match result {
        Ok(annotation) => {
            connection.execute_batch("COMMIT")?;
            Ok(annotation)
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
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
        let id = row.get(0)?;
        Ok(PersistedAnnotation {
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

pub fn list_all_annotation_records_tx(
    connection: &Connection,
) -> Result<Vec<PersistedAnnotationRecord>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT a.id, a.document_key, d.display_name, d.path, COALESCE(d.missing, 1),
               a.page, a.type, a.color, a.text, a.quote, a.areas_json, a.created_at, a.updated_at
        FROM annotations a
        LEFT JOIN documents d ON d.document_key = a.document_key
        ORDER BY COALESCE(d.display_name, a.document_key) COLLATE NOCASE ASC,
                 a.page ASC, a.created_at ASC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        let areas_json: String = row.get(10)?;
        let areas = serde_json::from_str(&areas_json).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                10,
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        let id = row.get(0)?;
        Ok(PersistedAnnotationRecord {
            id: Some(id),
            document_key: row.get(1)?,
            document_display_name: row.get(2)?,
            document_path: row.get(3)?,
            document_missing: row.get::<_, i64>(4)? == 1,
            page: row.get(5)?,
            r#type: row.get(6)?,
            color: row.get(7)?,
            text: row.get(8)?,
            quote: row.get(9)?,
            areas,
            tag_ids: Some(Vec::new()),
            created_at: row.get(11)?,
            updated_at: row.get(12)?,
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

fn list_annotation_tag_ids_tx(
    connection: &Connection,
    annotation_id: i64,
) -> Result<Vec<i64>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT tag_id
        FROM annotation_tags
        WHERE annotation_id = ?1
        ORDER BY tag_id ASC
        "#,
    )?;
    let rows = statement.query_map([annotation_id], |row| row.get(0))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn create_tag_tx(
    connection: &Connection,
    input: CreateTagInput,
) -> Result<PersistedTag, DbError> {
    let now = now_rfc3339();
    connection.execute(
        r#"
        INSERT INTO tags (name, color, created_at, updated_at)
        VALUES (?1, ?2, ?3, ?4)
        "#,
        params![input.name, input.color, now, now],
    )?;

    tag_by_id(connection, connection.last_insert_rowid())
}

pub fn rename_tag_tx(
    connection: &Connection,
    id: i64,
    name: &str,
) -> Result<PersistedTag, DbError> {
    connection.execute(
        "UPDATE tags SET name = ?1, updated_at = ?2 WHERE id = ?3",
        params![name, now_rfc3339(), id],
    )?;

    tag_by_id(connection, id)
}

pub fn delete_tag_tx(connection: &Connection, id: i64) -> Result<(), DbError> {
    connection.execute("DELETE FROM annotation_tags WHERE tag_id = ?1", [id])?;
    connection.execute("DELETE FROM document_tags WHERE tag_id = ?1", [id])?;
    connection.execute("DELETE FROM tags WHERE id = ?1", [id])?;
    Ok(())
}

pub fn merge_tags_tx(
    connection: &Connection,
    input: MergeTagsInput,
) -> Result<PersistedTag, DbError> {
    if input.source_tag_id == input.target_tag_id {
        return tag_by_id(connection, input.target_tag_id);
    }

    connection.execute_batch("BEGIN IMMEDIATE TRANSACTION")?;

    let result: Result<PersistedTag, DbError> = (|| {
        let now = now_rfc3339();
        tag_by_id(connection, input.source_tag_id)?;
        tag_by_id(connection, input.target_tag_id)?;
        connection.execute(
            r#"
            INSERT OR IGNORE INTO document_tags (document_key, tag_id, created_at)
            SELECT document_key, ?1, ?2
            FROM document_tags
            WHERE tag_id = ?3
            "#,
            params![input.target_tag_id, now, input.source_tag_id],
        )?;
        connection.execute(
            r#"
            INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id, created_at)
            SELECT annotation_id, ?1, ?2
            FROM annotation_tags
            WHERE tag_id = ?3
            "#,
            params![input.target_tag_id, now, input.source_tag_id],
        )?;
        connection.execute(
            "DELETE FROM document_tags WHERE tag_id = ?1",
            [input.source_tag_id],
        )?;
        connection.execute(
            "DELETE FROM annotation_tags WHERE tag_id = ?1",
            [input.source_tag_id],
        )?;
        connection.execute("DELETE FROM tags WHERE id = ?1", [input.source_tag_id])?;
        connection.execute(
            "UPDATE tags SET updated_at = ?1 WHERE id = ?2",
            params![now, input.target_tag_id],
        )?;

        tag_by_id(connection, input.target_tag_id)
    })();

    match result {
        Ok(tag) => {
            connection.execute_batch("COMMIT")?;
            Ok(tag)
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

pub fn list_tags_tx(connection: &Connection) -> Result<Vec<PersistedTag>, DbError> {
    let mut statement = connection.prepare(
        r#"
        SELECT t.id, t.name, t.color,
               count(DISTINCT dt.document_key) AS document_count,
               count(DISTINCT at.annotation_id) AS annotation_count,
               t.created_at, t.updated_at
        FROM tags t
        LEFT JOIN document_tags dt ON dt.tag_id = t.id
        LEFT JOIN annotation_tags at ON at.tag_id = t.id
        GROUP BY t.id, t.name, t.color, t.created_at, t.updated_at
        ORDER BY t.name ASC
        "#,
    )?;
    let rows = statement.query_map([], |row| {
        Ok(PersistedTag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
            document_count: row.get(3)?,
            annotation_count: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>().map_err(DbError::from)
}

pub fn attach_document_tag_tx(
    connection: &Connection,
    document_key: &str,
    tag_id: i64,
) -> Result<(), DbError> {
    tag_by_id(connection, tag_id)?;
    require_document_key(connection, document_key)?;
    connection.execute(
        r#"
        INSERT OR IGNORE INTO document_tags (document_key, tag_id, created_at)
        VALUES (?1, ?2, ?3)
        "#,
        params![document_key, tag_id, now_rfc3339()],
    )?;
    Ok(())
}

pub fn detach_document_tag_tx(
    connection: &Connection,
    document_key: &str,
    tag_id: i64,
) -> Result<(), DbError> {
    connection.execute(
        "DELETE FROM document_tags WHERE document_key = ?1 AND tag_id = ?2",
        params![document_key, tag_id],
    )?;
    Ok(())
}

pub fn attach_annotation_tag_tx(
    connection: &Connection,
    annotation_id: i64,
    tag_id: i64,
) -> Result<(), DbError> {
    tag_by_id(connection, tag_id)?;
    require_annotation_id(connection, annotation_id)?;
    connection.execute(
        r#"
        INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id, created_at)
        VALUES (?1, ?2, ?3)
        "#,
        params![annotation_id, tag_id, now_rfc3339()],
    )?;
    Ok(())
}

fn replace_annotation_tag_ids_tx(
    connection: &Connection,
    annotation_id: i64,
    tag_ids: &[i64],
) -> Result<(), DbError> {
    require_annotation_id(connection, annotation_id)?;
    for tag_id in tag_ids {
        tag_by_id(connection, *tag_id)?;
    }

    connection.execute(
        "DELETE FROM annotation_tags WHERE annotation_id = ?1",
        [annotation_id],
    )?;

    for tag_id in tag_ids {
        connection.execute(
            r#"
            INSERT OR IGNORE INTO annotation_tags (annotation_id, tag_id, created_at)
            VALUES (?1, ?2, ?3)
            "#,
            params![annotation_id, tag_id, now_rfc3339()],
        )?;
    }

    Ok(())
}

pub fn detach_annotation_tag_tx(
    connection: &Connection,
    annotation_id: i64,
    tag_id: i64,
) -> Result<(), DbError> {
    connection.execute(
        "DELETE FROM annotation_tags WHERE annotation_id = ?1 AND tag_id = ?2",
        params![annotation_id, tag_id],
    )?;
    Ok(())
}

fn tag_by_id(connection: &Connection, id: i64) -> Result<PersistedTag, DbError> {
    connection
        .query_row(
            r#"
            SELECT t.id, t.name, t.color,
                   (SELECT count(*) FROM document_tags WHERE tag_id = t.id) AS document_count,
                   (SELECT count(*) FROM annotation_tags WHERE tag_id = t.id) AS annotation_count,
                   t.created_at, t.updated_at
            FROM tags t
            WHERE t.id = ?1
            "#,
            [id],
            |row| {
                Ok(PersistedTag {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    color: row.get(2)?,
                    document_count: row.get(3)?,
                    annotation_count: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(DbError::from)
}

fn now_rfc3339() -> String {
    OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn migrated_test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        enable_foreign_keys(&connection).expect("enable foreign keys");
        apply_migrations(&connection).expect("schema applies");
        connection
    }

    #[test]
    fn opens_database_twice_without_replaying_alter_table() {
        let path = std::env::temp_dir().join(format!(
            "smartreader-test-{}-{}.sqlite3",
            std::process::id(),
            now_rfc3339().replace([':', '.'], "-")
        ));

        let connection = open_database(&path).expect("first open");
        drop(connection);
        let connection = open_database(&path).expect("second open");

        let table_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
                [],
                |row| row.get(0),
            )
            .expect("table count");

        assert_eq!(table_count, 1);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn open_database_enables_foreign_keys() {
        let path = std::env::temp_dir().join(format!(
            "smartreader-fk-test-{}-{}.sqlite3",
            std::process::id(),
            now_rfc3339().replace([':', '.'], "-")
        ));

        let connection = open_database(&path).expect("open database");
        let enabled: i64 = connection
            .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
            .expect("foreign key pragma");

        assert_eq!(enabled, 1);
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn saves_and_loads_reader_preferences() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let preferences = serde_json::json!({
            "theme": "sepia",
            "fontSize": 18,
            "showToolbar": true
        });

        save_preferences_tx(&connection, &preferences).expect("save preferences");

        assert_eq!(
            load_preferences_tx(&connection).expect("load preferences"),
            Some(preferences)
        );
    }

    #[test]
    fn opens_database_and_creates_schema() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let table_count: i64 = connection
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = 'documents'",
                [],
                |row| row.get(0),
            )
            .expect("table count");

        assert_eq!(table_count, 1);
    }

    #[test]
    fn opens_reader_core_schema() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

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

    #[test]
    fn cache_stats_returns_empty_totals_without_cache_entries() {
        let connection = migrated_test_connection();

        let stats = load_cache_stats_tx(&connection).expect("cache stats");

        assert_eq!(
            stats,
            CacheStats {
                used_bytes: 0,
                total_bytes: DEFAULT_CACHE_TOTAL_BYTES,
                file_count: 0,
            }
        );
    }

    #[test]
    fn cache_stats_sums_cache_entry_sizes_and_counts_files() {
        let connection = migrated_test_connection();
        connection
            .execute(
                r#"
                INSERT INTO cache_entries (
                    document_key, source_path, cache_path, file_size, modified_at, created_at,
                    last_used_at
                )
                VALUES
                    (?1, ?2, ?3, ?4, ?5, ?6, ?6),
                    (?7, ?8, ?9, ?10, ?11, ?6, ?6)
                "#,
                params![
                    "desktop:/tmp/one.pdf",
                    "/tmp/one.pdf",
                    "/cache/one.pdf",
                    1024,
                    "2026-07-02T00:00:00Z",
                    "2026-07-02T00:01:00Z",
                    "desktop:/tmp/two.pdf",
                    "/tmp/two.pdf",
                    "/cache/two.pdf",
                    2048,
                    "2026-07-02T00:02:00Z",
                ],
            )
            .expect("insert cache entries");

        let stats = load_cache_stats_tx(&connection).expect("cache stats");

        assert_eq!(
            stats,
            CacheStats {
                used_bytes: 3072,
                total_bytes: DEFAULT_CACHE_TOTAL_BYTES,
                file_count: 2,
            }
        );
    }

    #[test]
    fn upserts_and_lists_documents() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let document = PersistedDocument {
            document_key: "desktop:/tmp/book.pdf".to_string(),
            path: Some("/tmp/book.pdf".to_string()),
            display_name: "book.pdf".to_string(),
            file_size: Some(100),
            modified_at: Some("2026-06-15T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 4,
            progress: 0.2,
            missing: false,
        };

        upsert_document(&connection, &document).expect("upsert");
        let documents = list_documents(&connection).expect("list");

        assert_eq!(documents, vec![document]);
    }

    #[test]
    fn saves_and_loads_reader_session() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

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
        assert_eq!(
            load_reader_session_tx(&connection).expect("load"),
            Some(session)
        );
    }

    #[test]
    fn saving_empty_reader_session_clears_previous_tabs() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

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
                document_key: document.document_key,
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
        save_reader_session_tx(&connection, &session).expect("save session");

        let empty_session = PersistedReaderSession {
            active_document_key: None,
            sidebar_open: false,
            tabs: vec![],
        };
        save_reader_session_tx(&connection, &empty_session).expect("save empty session");

        assert_eq!(
            load_reader_session_tx(&connection).expect("load"),
            Some(empty_session)
        );
    }

    #[test]
    fn marks_and_lists_favorite_documents() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

        let document = PersistedDocument {
            document_key: "desktop:/tmp/book.pdf".to_string(),
            path: Some("/tmp/book.pdf".to_string()),
            display_name: "book.pdf".to_string(),
            file_size: Some(100),
            modified_at: Some("2026-06-16T00:00:00Z".to_string()),
            page_count: Some(20),
            last_page: 7,
            progress: 0.35,
            missing: false,
        };
        upsert_document(&connection, &document).expect("document");

        set_document_favorite_tx(&connection, &document.document_key, true).expect("favorite");
        let favorites = list_favorite_documents_tx(&connection).expect("favorites");

        assert_eq!(
            favorites,
            vec![FavoriteDocument {
                document_key: document.document_key,
                display_name: document.display_name,
                path: document.path,
                last_page: document.last_page,
                progress: document.progress,
            }]
        );
    }

    #[test]
    fn favoriting_missing_document_key_fails() {
        let connection = migrated_test_connection();

        let result = set_document_favorite_tx(&connection, "desktop:/tmp/missing.pdf", true);

        assert!(matches!(
            result,
            Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
        ));
    }

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
        assert_eq!(
            records[0].document_display_name.as_deref(),
            Some("book.pdf")
        );
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
        assert_eq!(
            records[0].document_display_name.as_deref(),
            Some("annotated.pdf")
        );
        assert_eq!(
            records[0].document_path.as_deref(),
            Some("/tmp/annotated.pdf")
        );
        assert_eq!(records[0].text.as_deref(), Some("Remember this claim"));
        assert_eq!(records[0].quote.as_deref(), Some("quoted PDF text"));
        assert_eq!(records[0].tag_ids, Some(vec![tag.id]));
    }

    #[test]
    fn merges_tags_and_preserves_document_and_annotation_relations() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("schema applies");

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
        let annotation = upsert_annotation(
            &connection,
            PersistedAnnotation {
                id: None,
                document_key: document.document_key.clone(),
                page: 4,
                r#type: "highlight".to_string(),
                color: "#facc15".to_string(),
                text: Some("Important".to_string()),
                quote: Some("quoted text".to_string()),
                areas: serde_json::json!([]),
                tag_ids: Some(vec![]),
                created_at: "2026-06-16T00:00:00Z".to_string(),
                updated_at: "2026-06-16T00:00:00Z".to_string(),
            },
        )
        .expect("annotation");

        let source = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "机器学习".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("source tag");
        let target = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "深度学习".to_string(),
                color: "#16a34a".to_string(),
            },
        )
        .expect("target tag");
        attach_document_tag_tx(&connection, &document.document_key, source.id)
            .expect("document tag");
        attach_annotation_tag_tx(
            &connection,
            annotation.id.expect("annotation id"),
            source.id,
        )
        .expect("annotation tag");

        let merged = merge_tags_tx(
            &connection,
            MergeTagsInput {
                source_tag_id: source.id,
                target_tag_id: target.id,
            },
        )
        .expect("merge");
        let tags = list_tags_tx(&connection).expect("tags");

        assert_eq!(merged.id, target.id);
        assert_eq!(merged.document_count, 1);
        assert_eq!(merged.annotation_count, 1);
        assert_eq!(tags, vec![merged]);
    }

    #[test]
    fn list_annotations_returns_attached_tag_ids() {
        let connection = migrated_test_connection();
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
        let annotation = upsert_annotation(
            &connection,
            PersistedAnnotation {
                id: None,
                document_key: document.document_key.clone(),
                page: 4,
                r#type: "underline".to_string(),
                color: "#2563eb".to_string(),
                text: None,
                quote: Some("quoted text".to_string()),
                areas: serde_json::json!([]),
                tag_ids: Some(vec![]),
                created_at: "2026-06-16T00:00:00Z".to_string(),
                updated_at: "2026-06-16T00:00:00Z".to_string(),
            },
        )
        .expect("annotation");
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "重点".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("tag");

        attach_annotation_tag_tx(&connection, annotation.id.expect("annotation id"), tag.id)
            .expect("annotation tag");

        let annotations =
            list_annotations_for_document(&connection, &document.document_key).expect("list");

        assert_eq!(annotations[0].tag_ids, Some(vec![tag.id]));
    }

    #[test]
    fn save_annotation_replaces_tag_ids() {
        let connection = migrated_test_connection();
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
        let first = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "重点".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("first tag");
        let second = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "复习".to_string(),
                color: "#16a34a".to_string(),
            },
        )
        .expect("second tag");
        let annotation = upsert_annotation(
            &connection,
            PersistedAnnotation {
                id: None,
                document_key: document.document_key.clone(),
                page: 4,
                r#type: "note".to_string(),
                color: "#38bdf8".to_string(),
                text: Some("Original".to_string()),
                quote: None,
                areas: serde_json::json!([]),
                tag_ids: Some(vec![first.id]),
                created_at: "2026-06-16T00:00:00Z".to_string(),
                updated_at: "2026-06-16T00:00:00Z".to_string(),
            },
        )
        .expect("annotation");

        let replaced = upsert_annotation(
            &connection,
            PersistedAnnotation {
                tag_ids: Some(vec![second.id]),
                text: Some("Changed".to_string()),
                ..annotation.clone()
            },
        )
        .expect("replace tags");

        assert_eq!(replaced.tag_ids, Some(vec![second.id]));

        let removed = upsert_annotation(
            &connection,
            PersistedAnnotation {
                tag_ids: Some(vec![]),
                ..replaced
            },
        )
        .expect("remove tags");

        assert_eq!(removed.tag_ids, Some(Vec::<i64>::new()));
        assert_eq!(
            list_annotations_for_document(&connection, &document.document_key).expect("list")[0]
                .tag_ids,
            Some(Vec::<i64>::new())
        );
    }

    #[test]
    fn save_annotation_rolls_back_when_replacing_with_invalid_tag_id() {
        let connection = migrated_test_connection();
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
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "重点".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("tag");
        let annotation = upsert_annotation(
            &connection,
            PersistedAnnotation {
                id: None,
                document_key: document.document_key.clone(),
                page: 4,
                r#type: "note".to_string(),
                color: "#38bdf8".to_string(),
                text: Some("Original".to_string()),
                quote: None,
                areas: serde_json::json!([]),
                tag_ids: Some(vec![tag.id]),
                created_at: "2026-06-16T00:00:00Z".to_string(),
                updated_at: "2026-06-16T00:00:00Z".to_string(),
            },
        )
        .expect("annotation");

        let result = upsert_annotation(
            &connection,
            PersistedAnnotation {
                text: Some("Changed".to_string()),
                tag_ids: Some(vec![404]),
                ..annotation
            },
        );

        assert!(matches!(
            result,
            Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
        ));

        let annotations =
            list_annotations_for_document(&connection, &document.document_key).expect("list");

        assert_eq!(annotations[0].text, Some("Original".to_string()));
        assert_eq!(annotations[0].tag_ids, Some(vec![tag.id]));
    }

    #[test]
    fn attach_document_tag_rejects_missing_document_without_inflating_counts() {
        let connection = migrated_test_connection();
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "机器学习".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("tag");

        let result = attach_document_tag_tx(&connection, "desktop:/tmp/missing.pdf", tag.id);

        assert!(matches!(
            result,
            Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
        ));
        assert_eq!(
            tag_by_id(&connection, tag.id).expect("tag").document_count,
            0
        );
    }

    #[test]
    fn attach_annotation_tag_rejects_missing_annotation_without_inflating_counts() {
        let connection = migrated_test_connection();
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "机器学习".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("tag");

        let result = attach_annotation_tag_tx(&connection, 404, tag.id);

        assert!(matches!(
            result,
            Err(DbError::Sqlite(rusqlite::Error::QueryReturnedNoRows))
        ));
        assert_eq!(
            tag_by_id(&connection, tag.id)
                .expect("tag")
                .annotation_count,
            0
        );
    }

    #[test]
    fn deleting_tagged_annotation_cascades_annotation_tag_relation() {
        let connection = migrated_test_connection();
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
        let annotation = upsert_annotation(
            &connection,
            PersistedAnnotation {
                id: None,
                document_key: document.document_key,
                page: 4,
                r#type: "highlight".to_string(),
                color: "#facc15".to_string(),
                text: Some("Important".to_string()),
                quote: Some("quoted text".to_string()),
                areas: serde_json::json!([]),
                tag_ids: Some(vec![]),
                created_at: "2026-06-16T00:00:00Z".to_string(),
                updated_at: "2026-06-16T00:00:00Z".to_string(),
            },
        )
        .expect("annotation");
        let annotation_id = annotation.id.expect("annotation id");
        let tag = create_tag_tx(
            &connection,
            CreateTagInput {
                name: "机器学习".to_string(),
                color: "#2563eb".to_string(),
            },
        )
        .expect("tag");
        attach_annotation_tag_tx(&connection, annotation_id, tag.id).expect("annotation tag");

        assert_eq!(
            tag_by_id(&connection, tag.id)
                .expect("tag")
                .annotation_count,
            1
        );

        connection
            .execute("DELETE FROM annotations WHERE id = ?1", [annotation_id])
            .expect("delete annotation");

        assert_eq!(
            tag_by_id(&connection, tag.id)
                .expect("tag")
                .annotation_count,
            0
        );
    }
}
