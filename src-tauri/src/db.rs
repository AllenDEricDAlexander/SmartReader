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
    let areas_json = serde_json::to_string(&annotation.areas)?;

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

#[cfg(test)]
mod tests {
    use super::*;

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
}
