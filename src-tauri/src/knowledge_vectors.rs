use crate::db::DatabaseState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::OnceLock;
use tauri::State;

const MAX_VALUES: usize = 8 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum KnowledgeError {
    #[error("KNOWLEDGE_INVALID: invalid vector dimensions, values or document identity")]
    Invalid,
    #[error("KNOWLEDGE_STORAGE: local knowledge storage is unavailable")]
    Storage,
    #[error("KNOWLEDGE_LOCKED: vector caches require an accessible public document")]
    Locked,
}

impl serde::Serialize for KnowledgeError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<rusqlite::Error> for KnowledgeError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Storage
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheKey {
    pub paper_id: String,
    pub model_key: String,
    pub content_key: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorCache {
    pub key: CacheKey,
    pub vectors: Vec<Vec<f32>>,
}

#[derive(Debug, Deserialize)]
pub struct VectorEntry {
    pub id: String,
    pub vector: Vec<f32>,
}

#[derive(Debug, Serialize)]
pub struct VectorHit {
    pub id: String,
    pub score: f32,
}

fn valid_vector(vector: &[f32], dimension: usize) -> bool {
    vector.len() == dimension
        && vector.iter().all(|x| x.is_finite())
        && vector.iter().any(|x| *x != 0.0)
}

fn validate_key(key: &CacheKey) -> Result<(), KnowledgeError> {
    if [&key.paper_id, &key.model_key, &key.content_key]
        .iter()
        .any(|value| value.len() != 64 || !value.bytes().all(|x| x.is_ascii_hexdigit()))
    {
        return Err(KnowledgeError::Invalid);
    }
    Ok(())
}

fn public_paper(connection: &Connection, id: &str) -> Result<bool, KnowledgeError> {
    Ok(connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM research_library_state, json_each(data_json, '$.papers')
         WHERE json_extract(value, '$.id') = ?1 AND json_extract(value, '$.kind') = 'plain')",
        [id],
        |row| row.get(0),
    )?)
}

fn bytes(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|x| x.to_le_bytes()).collect()
}

fn cosine_bytes(vector: &[f32]) -> Vec<u8> {
    // Normalize in f64 before sqlite-vec's f32 cosine calculation, preventing
    // overflow or underflow for valid but unusually scaled provider vectors.
    let norm = vector
        .iter()
        .map(|x| f64::from(*x).powi(2))
        .sum::<f64>()
        .sqrt();
    vector
        .iter()
        .flat_map(|x| ((f64::from(*x) / norm) as f32).to_le_bytes())
        .collect()
}

pub(crate) fn save_cache(
    connection: &mut Connection,
    cache: VectorCache,
) -> Result<(), KnowledgeError> {
    validate_key(&cache.key)?;
    let dimension = cache.vectors.first().map(Vec::len).unwrap_or(0);
    if !(1..=4096).contains(&dimension)
        || cache.vectors.len() > 20000
        || cache.vectors.len() * dimension > MAX_VALUES
        || cache.vectors.iter().any(|v| !valid_vector(v, dimension))
    {
        return Err(KnowledgeError::Invalid);
    }
    connection.execute_batch("PRAGMA secure_delete = ON")?;
    let transaction = connection.transaction()?;
    if !public_paper(&transaction, &cache.key.paper_id)? {
        return Err(KnowledgeError::Locked);
    }
    transaction.execute(
        "DELETE FROM knowledge_vector_cache WHERE paper_id = ?1",
        [&cache.key.paper_id],
    )?;
    let payload: Vec<u8> = cache.vectors.iter().flat_map(|v| bytes(v)).collect();
    transaction.execute(
        "INSERT INTO knowledge_vector_cache (paper_id, model_key, content_key, dimension, chunk_count, vectors)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![cache.key.paper_id, cache.key.model_key, cache.key.content_key, dimension, cache.vectors.len(), payload],
    )?;
    transaction.commit()?;
    Ok(())
}

pub(crate) fn read_cache(
    connection: &Connection,
    key: CacheKey,
) -> Result<Option<VectorCache>, KnowledgeError> {
    validate_key(&key)?;
    if !public_paper(connection, &key.paper_id)? {
        return Ok(None);
    }
    let mut statement = connection.prepare(
        "SELECT dimension, chunk_count, vectors FROM knowledge_vector_cache
         WHERE paper_id = ?1 AND model_key = ?2 AND content_key = ?3",
    )?;
    let mut rows = statement.query(params![key.paper_id, key.model_key, key.content_key])?;
    let Some(row) = rows.next()? else {
        return Ok(None);
    };
    let dimension: usize = row.get(0)?;
    let count: usize = row.get(1)?;
    let payload: Vec<u8> = row.get(2)?;
    if dimension == 0
        || dimension > 4096
        || count > 20000
        || count * dimension > MAX_VALUES
        || payload.len() != count * dimension * 4
    {
        return Err(KnowledgeError::Invalid);
    }
    let vectors: Vec<Vec<f32>> = payload
        .chunks_exact(dimension * 4)
        .map(|chunk| {
            chunk
                .chunks_exact(4)
                .map(|x| f32::from_le_bytes(x.try_into().unwrap()))
                .collect()
        })
        .collect();
    if vectors.iter().any(|v| !valid_vector(v, dimension)) {
        return Err(KnowledgeError::Invalid);
    }
    Ok(Some(VectorCache { key, vectors }))
}

pub(crate) fn search(
    entries: Vec<VectorEntry>,
    query: Vec<f32>,
    limit: usize,
) -> Result<Vec<VectorHit>, KnowledgeError> {
    let dimension = query.len();
    let mut ids = HashSet::new();
    if !(1..=4096).contains(&dimension)
        || !valid_vector(&query, dimension)
        || !(1..=40).contains(&limit)
        || entries.len() > 20000
        || entries.len() * dimension > MAX_VALUES
        || entries.iter().any(|entry| {
            entry.id.is_empty()
                || entry.id.len() > 160
                || !entry
                    .id
                    .bytes()
                    .all(|x| x.is_ascii_alphanumeric() || b"_:-".contains(&x))
                || !ids.insert(entry.id.clone())
                || !valid_vector(&entry.vector, dimension)
        })
    {
        return Err(KnowledgeError::Invalid);
    }
    static REGISTERED: OnceLock<bool> = OnceLock::new();
    let registered = REGISTERED.get_or_init(|| {
        // sqlite-vec statically links this documented SQLite extension entrypoint.
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
                *const (),
                unsafe extern "C" fn(
                    *mut rusqlite::ffi::sqlite3,
                    *mut *mut std::ffi::c_char,
                    *const rusqlite::ffi::sqlite3_api_routines,
                ) -> std::ffi::c_int,
            >(
                sqlite_vec::sqlite3_vec_init as *const ()
            ))) == rusqlite::ffi::SQLITE_OK
        }
    });
    if !registered {
        return Err(KnowledgeError::Storage);
    }
    // The searchable index is disposable and contains only this request's scope.
    // Private vectors never enter the durable SQLite cache or another request.
    let mut connection = Connection::open_in_memory()?;
    connection.execute_batch(&format!(
        "CREATE VIRTUAL TABLE knowledge USING vec0(id TEXT PRIMARY KEY, embedding float[{dimension}] distance_metric=cosine)"))?;
    let transaction = connection.transaction()?;
    for entry in entries {
        transaction.execute(
            "INSERT INTO knowledge (id, embedding) VALUES (?1, ?2)",
            params![entry.id, cosine_bytes(&entry.vector)],
        )?;
    }
    transaction.commit()?;
    let mut statement = connection.prepare(
        "SELECT id, distance FROM knowledge WHERE embedding MATCH ?1 AND k = ?2 ORDER BY distance",
    )?;
    let rows = statement.query_map(params![cosine_bytes(&query), limit], |row| {
        let distance: f32 = row.get(1)?;
        Ok(VectorHit {
            id: row.get(0)?,
            score: 1.0 - distance,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

#[tauri::command]
pub fn read_knowledge_cache(
    key: CacheKey,
    database: State<'_, DatabaseState>,
) -> Result<Option<VectorCache>, KnowledgeError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| KnowledgeError::Storage)?;
    read_cache(&connection, key)
}

#[tauri::command]
pub fn write_knowledge_cache(
    cache: VectorCache,
    database: State<'_, DatabaseState>,
) -> Result<(), KnowledgeError> {
    let mut connection = database
        .connection
        .lock()
        .map_err(|_| KnowledgeError::Storage)?;
    save_cache(&mut connection, cache)
}

#[tauri::command]
pub async fn search_knowledge_vectors(
    entries: Vec<VectorEntry>,
    query: Vec<f32>,
    limit: usize,
) -> Result<Vec<VectorHit>, KnowledgeError> {
    tauri::async_runtime::spawn_blocking(move || search(entries, query, limit))
        .await
        .map_err(|_| KnowledgeError::Storage)?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use serde_json::json;

    fn connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        apply_migrations(&connection).unwrap();
        connection
            .execute(
                "INSERT INTO research_library_state (id, revision, data_json) VALUES (1, 0, ?1)
            ON CONFLICT(id) DO UPDATE SET data_json=excluded.data_json",
                [json!({"papers":[{"id":"a".repeat(64),"kind":"plain"}]}).to_string()],
            )
            .unwrap();
        connection
    }

    fn cache() -> VectorCache {
        VectorCache {
            key: CacheKey {
                paper_id: "a".repeat(64),
                model_key: "b".repeat(64),
                content_key: "c".repeat(64),
            },
            vectors: vec![vec![1.0, 0.5, -0.5], vec![0.0, 1.0, 0.0]],
        }
    }

    #[test]
    fn real_sqlite_vec_ranks_vectors_and_keeps_each_request_scope_isolated() {
        let hits = search(
            vec![
                VectorEntry {
                    id: "paper_b:0".into(),
                    vector: vec![0.0, 1.0],
                },
                VectorEntry {
                    id: "paper_a:4".into(),
                    vector: vec![1.0, 0.0],
                },
            ],
            vec![1.0, 0.0],
            20,
        )
        .unwrap();
        assert_eq!(hits[0].id, "paper_a:4");
        assert!((hits[0].score - 1.0).abs() < 0.0001);
        let next = search(
            vec![VectorEntry {
                id: "paper_b:0".into(),
                vector: vec![0.0, 1.0],
            }],
            vec![1.0, 0.0],
            20,
        )
        .unwrap();
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "paper_b:0");
    }

    #[test]
    fn persists_compact_cache_and_replaces_obsolete_fingerprints() {
        let mut connection = connection();
        let key = cache().key.clone();
        save_cache(&mut connection, cache()).unwrap();
        assert_eq!(
            read_cache(&connection, key.clone())
                .unwrap()
                .unwrap()
                .vectors,
            cache().vectors
        );
        let length: i64 = connection
            .query_row(
                "SELECT length(vectors) FROM knowledge_vector_cache",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(length, 2 * 3 * 4);
        let mut replacement = cache();
        replacement.key.model_key = "d".repeat(64);
        save_cache(&mut connection, replacement).unwrap();
        assert!(read_cache(&connection, key).unwrap().is_none());
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM knowledge_vector_cache", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            1
        );
    }

    #[test]
    fn never_saves_or_reads_private_vectors_in_durable_cache() {
        let mut connection = connection();
        save_cache(&mut connection, cache()).unwrap();
        connection
            .execute(
                "UPDATE research_library_state SET data_json=?1",
                [json!({"papers":[{"id":"a".repeat(64),"kind":"encrypted"}]}).to_string()],
            )
            .unwrap();
        assert!(read_cache(&connection, cache().key).unwrap().is_none());
        assert!(matches!(
            save_cache(&mut connection, cache()),
            Err(KnowledgeError::Locked)
        ));
    }

    #[test]
    fn rejects_invalid_vectors_and_duplicate_identities() {
        for vector in [
            vec![0.0, 0.0],
            vec![f32::NAN, 1.0],
            vec![f32::INFINITY, 1.0],
        ] {
            assert!(matches!(
                search(vec![], vector, 6),
                Err(KnowledgeError::Invalid)
            ));
        }
        assert!(matches!(
            search(
                vec![VectorEntry {
                    id: "a".into(),
                    vector: vec![1.0]
                }],
                vec![1.0, 0.0],
                6
            ),
            Err(KnowledgeError::Invalid)
        ));
        assert!(matches!(
            search(
                vec![
                    VectorEntry {
                        id: "a".into(),
                        vector: vec![1.0]
                    },
                    VectorEntry {
                        id: "a".into(),
                        vector: vec![1.0]
                    }
                ],
                vec![1.0],
                6
            ),
            Err(KnowledgeError::Invalid)
        ));
    }

    #[test]
    fn normalizes_extreme_finite_values_without_nan_scores() {
        let hits = search(
            vec![VectorEntry {
                id: "large".into(),
                vector: vec![f32::MAX, f32::MAX],
            }],
            vec![f32::MAX, f32::MAX],
            6,
        )
        .unwrap();
        assert!((hits[0].score - 1.0).abs() < 0.0001);
    }
}
