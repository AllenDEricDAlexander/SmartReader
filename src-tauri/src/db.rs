use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use time::OffsetDateTime;

const INIT_SQL: &str = include_str!("migrations/001_init.sql");

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
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
    connection.execute_batch(INIT_SQL)?;
    Ok(connection)
}

pub fn default_database_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("smartreader.sqlite3")
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

pub fn upsert_document(connection: &Connection, document: &PersistedDocument) -> Result<(), DbError> {
    let now = OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_string());

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_database_and_creates_schema() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection.execute_batch(INIT_SQL).expect("schema applies");

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
    fn upserts_and_lists_documents() {
        let connection = Connection::open_in_memory().expect("in-memory database");
        connection.execute_batch(INIT_SQL).expect("schema applies");

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
}
