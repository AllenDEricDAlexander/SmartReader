use crate::db::DatabaseState;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::cmp::{Ordering, Reverse};
use std::collections::{BinaryHeap, HashSet};
use tauri::State;

/// Vector budget for one paper's durable cache, and for a whole retrieval scope.
/// Scoped search reads straight from SQLite, so its budget is not bounded by an
/// IPC payload the way session vectors from the webview are.
const MAX_VALUES: usize = 8 * 1024 * 1024;
const MAX_SCOPE_VALUES: usize = 64 * 1024 * 1024;
const MAX_LIMIT: usize = 64;

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

/// One retrieval scope. `paperIds` name public papers whose vectors are read
/// directly from the durable cache, so only the query vector crosses IPC.
/// `entries` carry the session-only vectors of unlocked encrypted papers, which
/// never reach durable storage.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VectorScope {
    pub query: Vec<f32>,
    pub limit: usize,
    pub model_key: String,
    #[serde(default)]
    pub paper_ids: Vec<String>,
    #[serde(default)]
    pub entries: Vec<VectorEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStatus {
    pub paper_id: String,
    pub model_key: String,
    pub content_key: String,
    pub dimension: usize,
    pub chunk_count: usize,
}

fn hex_identity(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Finite cosine scores only; validation rejects NaN before ranking.
#[derive(Debug, PartialEq)]
struct Ranked {
    score: f32,
    paper: usize,
    ordinal: usize,
}

impl Eq for Ranked {}

impl Ord for Ranked {
    fn cmp(&self, other: &Self) -> Ordering {
        self.score
            .partial_cmp(&other.score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| other.paper.cmp(&self.paper))
            .then_with(|| other.ordinal.cmp(&self.ordinal))
    }
}

impl PartialOrd for Ranked {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn unit(vector: &[f32]) -> Vec<f32> {
    // Normalizing in f64 keeps unusually scaled but valid provider vectors from
    // overflowing or underflowing the f32 cosine calculation.
    let norm = vector
        .iter()
        .map(|x| f64::from(*x).powi(2))
        .sum::<f64>()
        .sqrt();
    vector
        .iter()
        .map(|x| (f64::from(*x) / norm) as f32)
        .collect()
}

/// Cosine similarity against an already normalized query.
fn similarity(query: &[f32], vector: &[f32]) -> f32 {
    let norm = vector
        .iter()
        .map(|x| f64::from(*x).powi(2))
        .sum::<f64>()
        .sqrt();
    if norm == 0.0 {
        return 0.0;
    }
    let dot: f64 = query
        .iter()
        .zip(vector)
        .map(|(a, b)| f64::from(*a) * f64::from(*b))
        .sum();
    (dot / norm).clamp(-1.0, 1.0) as f32
}

/// Bounded top-k over a stream of candidates, so a large scope never allocates
/// a score or an identifier per chunk.
struct TopK {
    limit: usize,
    heap: BinaryHeap<Reverse<Ranked>>,
}

impl TopK {
    fn new(limit: usize) -> Self {
        Self {
            limit,
            heap: BinaryHeap::with_capacity(limit),
        }
    }

    fn offer(&mut self, candidate: Ranked) {
        if self.heap.len() < self.limit {
            self.heap.push(Reverse(candidate));
        } else if self
            .heap
            .peek()
            .is_some_and(|Reverse(weakest)| *weakest < candidate)
        {
            self.heap.pop();
            self.heap.push(Reverse(candidate));
        }
    }

    fn ranked(self) -> Vec<Ranked> {
        let mut ranked: Vec<Ranked> = self.heap.into_iter().map(|Reverse(item)| item).collect();
        ranked.sort_by(|a, b| b.cmp(a));
        ranked
    }
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

/// Reads one paper's durable vectors. Retrieval ranks inside SQLite through
/// `search_scope`; this is for publishing a single paper to a cloud store, which
/// is bounded by that paper's own chunk count.
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

/// Reads the durable vectors of the scoped public papers straight from SQLite,
/// merges any session-only vectors, and returns the globally best chunks. Chunk
/// identifiers follow the webview's `<paperId>:<ordinal>` chunk order, which is
/// also the order the cache stores vectors in.
pub(crate) fn search_scope(
    connection: &Connection,
    scope: VectorScope,
) -> Result<Vec<VectorHit>, KnowledgeError> {
    let dimension = scope.query.len();
    let mut requested = HashSet::new();
    if !(1..=4096).contains(&dimension)
        || !valid_vector(&scope.query, dimension)
        || !(1..=MAX_LIMIT).contains(&scope.limit)
        || !hex_identity(&scope.model_key)
        || scope.paper_ids.len() > 20000
        || scope
            .paper_ids
            .iter()
            .any(|id| !hex_identity(id) || !requested.insert(id.clone()))
    {
        return Err(KnowledgeError::Invalid);
    }
    let normalized = unit(&scope.query);
    let mut top = TopK::new(scope.limit);
    let mut papers: Vec<String> = Vec::new();
    let mut budget = 0usize;
    if !requested.is_empty() {
        let public = public_papers(connection)?;
        let mut scoped: Vec<&String> = requested.iter().collect();
        scoped.sort();
        // Scoping by primary key keeps a question off the other papers' rows,
        // in batches that stay inside SQLite's bound-parameter limit.
        for batch in scoped.chunks(500) {
            let placeholders = (2..batch.len() + 2)
                .map(|at| format!("?{at}"))
                .collect::<Vec<_>>()
                .join(", ");
            let mut statement = connection.prepare(&format!(
                "SELECT paper_id, dimension, chunk_count, vectors FROM knowledge_vector_cache
                 WHERE model_key = ?1 AND paper_id IN ({placeholders}) ORDER BY paper_id"
            ))?;
            let bound: Vec<&dyn rusqlite::ToSql> =
                std::iter::once(&scope.model_key as &dyn rusqlite::ToSql)
                    .chain(batch.iter().map(|id| *id as &dyn rusqlite::ToSql))
                    .collect();
            let mut rows = statement.query(bound.as_slice())?;
            while let Some(row) = rows.next()? {
                let paper_id: String = row.get(0)?;
                if !public.contains(&paper_id) {
                    continue;
                }
                let stored: usize = row.get(1)?;
                let count: usize = row.get(2)?;
                // A cache written by another embedding dimension is stale, not
                // corrupt; the webview re-indexes it after `cache_status` reports it.
                if stored != dimension {
                    continue;
                }
                let payload: Vec<u8> = row.get(3)?;
                if count == 0 || count > 20000 || payload.len() != count * dimension * 4 {
                    return Err(KnowledgeError::Invalid);
                }
                budget += count * dimension;
                if budget > MAX_SCOPE_VALUES {
                    return Err(KnowledgeError::Invalid);
                }
                let paper = papers.len();
                papers.push(paper_id);
                for (ordinal, chunk) in payload.chunks_exact(dimension * 4).enumerate() {
                    let vector: Vec<f32> = chunk
                        .chunks_exact(4)
                        .map(|x| f32::from_le_bytes(x.try_into().unwrap()))
                        .collect();
                    if !valid_vector(&vector, dimension) {
                        return Err(KnowledgeError::Invalid);
                    }
                    top.offer(Ranked {
                        score: similarity(&normalized, &vector),
                        paper,
                        ordinal,
                    });
                }
            }
        }
    }
    let session = scope.entries;
    let offset = papers.len();
    let mut ids = HashSet::new();
    if session.len() > 20000
        || session.len() * dimension > MAX_VALUES
        || session.iter().any(|entry| {
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
    for (index, entry) in session.iter().enumerate() {
        top.offer(Ranked {
            score: similarity(&normalized, &entry.vector),
            paper: offset + index,
            ordinal: 0,
        });
    }
    Ok(top
        .ranked()
        .into_iter()
        .map(|item| VectorHit {
            id: match papers.get(item.paper) {
                Some(paper_id) => format!("{paper_id}:{}", item.ordinal),
                None => session[item.paper - offset].id.clone(),
            },
            score: item.score,
        })
        .collect())
}

/// Reports which scoped papers already hold usable vectors, without moving any
/// vector across IPC. The webview compares the fingerprints and dimension to
/// decide what still needs embedding.
pub(crate) fn cache_status(
    connection: &Connection,
    paper_ids: Vec<String>,
) -> Result<Vec<CacheStatus>, KnowledgeError> {
    let mut requested = HashSet::new();
    if paper_ids.len() > 20000
        || paper_ids
            .iter()
            .any(|id| !hex_identity(id) || !requested.insert(id.clone()))
    {
        return Err(KnowledgeError::Invalid);
    }
    if requested.is_empty() {
        return Ok(Vec::new());
    }
    let public = public_papers(connection)?;
    let mut statement = connection.prepare(
        "SELECT paper_id, model_key, content_key, dimension, chunk_count
         FROM knowledge_vector_cache ORDER BY paper_id",
    )?;
    let mut rows = statement.query([])?;
    let mut status = Vec::new();
    while let Some(row) = rows.next()? {
        let paper_id: String = row.get(0)?;
        if !requested.contains(&paper_id) || !public.contains(&paper_id) {
            continue;
        }
        status.push(CacheStatus {
            paper_id,
            model_key: row.get(1)?,
            content_key: row.get(2)?,
            dimension: row.get(3)?,
            chunk_count: row.get(4)?,
        });
    }
    Ok(status)
}

fn public_papers(connection: &Connection) -> Result<HashSet<String>, KnowledgeError> {
    let mut statement = connection.prepare(
        "SELECT json_extract(value, '$.id') FROM research_library_state, json_each(data_json, '$.papers')
         WHERE json_extract(value, '$.kind') = 'plain'",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<HashSet<_>, _>>()?)
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
pub fn knowledge_cache_status(
    paper_ids: Vec<String>,
    database: State<'_, DatabaseState>,
) -> Result<Vec<CacheStatus>, KnowledgeError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| KnowledgeError::Storage)?;
    cache_status(&connection, paper_ids)
}

#[tauri::command]
pub fn search_knowledge_scope(
    scope: VectorScope,
    database: State<'_, DatabaseState>,
) -> Result<Vec<VectorHit>, KnowledgeError> {
    let connection = database
        .connection
        .lock()
        .map_err(|_| KnowledgeError::Storage)?;
    search_scope(&connection, scope)
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

    fn session_scope(entries: Vec<VectorEntry>, query: Vec<f32>) -> VectorScope {
        VectorScope {
            query,
            limit: 20,
            model_key: "b".repeat(64),
            paper_ids: Vec::new(),
            entries,
        }
    }

    #[test]
    fn ranks_session_vectors_and_keeps_each_request_scope_isolated() {
        let connection = connection();
        let hits = search_scope(
            &connection,
            session_scope(
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
            ),
        )
        .unwrap();
        assert_eq!(hits[0].id, "paper_a:4");
        assert!((hits[0].score - 1.0).abs() < 0.0001);
        let next = search_scope(
            &connection,
            session_scope(
                vec![VectorEntry {
                    id: "paper_b:0".into(),
                    vector: vec![0.0, 1.0],
                }],
                vec![1.0, 0.0],
            ),
        )
        .unwrap();
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].id, "paper_b:0");
    }

    #[test]
    fn ranks_the_durable_cache_without_moving_vectors_across_ipc() {
        let mut connection = connection();
        connection
            .execute(
                "UPDATE research_library_state SET data_json=?1",
                [json!({"papers":[
                    {"id":"a".repeat(64),"kind":"plain"},
                    {"id":"b".repeat(64),"kind":"plain"},
                ]})
                .to_string()],
            )
            .unwrap();
        for (paper, vectors) in [
            ("a".repeat(64), vec![vec![1.0, 0.0], vec![0.0, 1.0]]),
            ("b".repeat(64), vec![vec![0.9, 0.1]]),
        ] {
            save_cache(
                &mut connection,
                VectorCache {
                    key: CacheKey {
                        paper_id: paper,
                        model_key: "b".repeat(64),
                        content_key: "c".repeat(64),
                    },
                    vectors,
                },
            )
            .unwrap();
        }
        let hits = search_scope(
            &connection,
            VectorScope {
                query: vec![1.0, 0.0],
                limit: 10,
                model_key: "b".repeat(64),
                paper_ids: vec!["a".repeat(64), "b".repeat(64)],
                entries: Vec::new(),
            },
        )
        .unwrap();
        assert_eq!(
            hits.iter().map(|hit| hit.id.clone()).collect::<Vec<_>>(),
            vec![
                format!("{}:0", "a".repeat(64)),
                format!("{}:0", "b".repeat(64)),
                format!("{}:1", "a".repeat(64)),
            ]
        );
        assert!((hits[0].score - 1.0).abs() < 0.0001);
        assert!(hits[1].score > 0.9 && hits[1].score < 1.0);
        assert!(hits[2].score.abs() < 0.0001);
    }

    #[test]
    fn scoped_search_excludes_unselected_private_and_stale_caches() {
        let mut connection = connection();
        save_cache(&mut connection, cache()).unwrap();
        let scope = |paper_ids: Vec<String>, query: Vec<f32>| {
            search_scope(
                &connection,
                VectorScope {
                    query,
                    limit: 10,
                    model_key: "b".repeat(64),
                    paper_ids,
                    entries: Vec::new(),
                },
            )
            .unwrap()
        };
        assert!(scope(vec!["d".repeat(64)], vec![1.0, 0.0, 0.0]).is_empty());
        // A cache written for another embedding dimension is skipped rather than
        // ranked, so `cache_status` can drive a re-index instead of failing.
        assert!(scope(vec!["a".repeat(64)], vec![1.0, 0.0]).is_empty());
        assert_eq!(scope(vec!["a".repeat(64)], vec![1.0, 0.0, 0.0]).len(), 2);
        assert!(matches!(
            search_scope(
                &connection,
                VectorScope {
                    query: vec![1.0, 0.0, 0.0],
                    limit: 10,
                    model_key: "not-a-fingerprint".into(),
                    paper_ids: vec!["a".repeat(64)],
                    entries: Vec::new(),
                },
            ),
            Err(KnowledgeError::Invalid)
        ));
        connection
            .execute(
                "UPDATE research_library_state SET data_json=?1",
                [json!({"papers":[{"id":"a".repeat(64),"kind":"encrypted"}]}).to_string()],
            )
            .unwrap();
        assert!(scope(vec!["a".repeat(64)], vec![1.0, 0.0, 0.0]).is_empty());
    }

    #[test]
    fn merges_session_vectors_with_the_durable_scope() {
        let mut connection = connection();
        save_cache(&mut connection, cache()).unwrap();
        let hits = search_scope(
            &connection,
            VectorScope {
                query: vec![0.0, 1.0, 0.0],
                limit: 2,
                model_key: "b".repeat(64),
                paper_ids: vec!["a".repeat(64)],
                entries: vec![VectorEntry {
                    id: "session_paper:7".into(),
                    vector: vec![0.0, 2.0, 0.0],
                }],
            },
        )
        .unwrap();
        // Equal scores resolve toward the durable scope, so the ordering of a
        // merged result stays stable between requests.
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].id, format!("{}:1", "a".repeat(64)));
        assert!((hits[0].score - 1.0).abs() < 0.0001);
        assert_eq!(hits[1].id, "session_paper:7");
        assert!((hits[1].score - 1.0).abs() < 0.0001);
    }

    #[test]
    fn reports_cache_fingerprints_for_public_papers_only() {
        let mut connection = connection();
        save_cache(&mut connection, cache()).unwrap();
        let status = cache_status(&connection, vec!["a".repeat(64), "d".repeat(64)]).unwrap();
        assert_eq!(status.len(), 1);
        assert_eq!(status[0].paper_id, "a".repeat(64));
        assert_eq!(status[0].content_key, "c".repeat(64));
        assert_eq!(status[0].dimension, 3);
        assert_eq!(status[0].chunk_count, 2);
        assert!(cache_status(&connection, vec!["short".into()]).is_err());
        connection
            .execute(
                "UPDATE research_library_state SET data_json=?1",
                [json!({"papers":[{"id":"a".repeat(64),"kind":"encrypted"}]}).to_string()],
            )
            .unwrap();
        assert!(cache_status(&connection, vec!["a".repeat(64)])
            .unwrap()
            .is_empty());
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
        let connection = connection();
        let rank = |entries, query| search_scope(&connection, session_scope(entries, query));
        for vector in [
            vec![0.0, 0.0],
            vec![f32::NAN, 1.0],
            vec![f32::INFINITY, 1.0],
        ] {
            assert!(matches!(rank(vec![], vector), Err(KnowledgeError::Invalid)));
        }
        assert!(matches!(
            rank(
                vec![VectorEntry {
                    id: "a".into(),
                    vector: vec![1.0]
                }],
                vec![1.0, 0.0]
            ),
            Err(KnowledgeError::Invalid)
        ));
        assert!(matches!(
            rank(
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
                vec![1.0]
            ),
            Err(KnowledgeError::Invalid)
        ));
    }

    #[test]
    fn normalizes_extreme_finite_values_without_nan_scores() {
        let connection = connection();
        let hits = search_scope(
            &connection,
            session_scope(
                vec![VectorEntry {
                    id: "large".into(),
                    vector: vec![f32::MAX, f32::MAX],
                }],
                vec![f32::MAX, f32::MAX],
            ),
        )
        .unwrap();
        assert!((hits[0].score - 1.0).abs() < 0.0001);
    }
}
