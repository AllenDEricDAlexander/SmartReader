use crate::db::DatabaseState;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use tauri::State;

const MAX_ID_BYTES: usize = 160;
const MAX_STATE_BYTES: usize = 64 * 1024 * 1024;
const MAX_FILE_BYTES: usize = 256 * 1024 * 1024;
const MAX_BATCH_BYTES: usize = 512 * 1024 * 1024;
const MAX_BATCH_FILES: usize = 512;
const MAX_MANIFEST_BYTES: usize = MAX_STATE_BYTES + MAX_BATCH_FILES * 200;
const BINARY_HEADER_BYTES: usize = 8;
// Revisions cross the JavaScript IPC boundary and must remain exact integers.
const MAX_REVISION: u64 = 9_007_199_254_740_991;

#[derive(Debug, thiserror::Error)]
pub enum LibraryStorageError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("LIBRARY_INVALID_INPUT: {0}")]
    InvalidInput(&'static str),
    #[error("LIBRARY_CONFLICT: expected revision {expected}, current revision {current}; reload the library before saving")]
    Conflict { expected: u64, current: u64 },
    #[error("LIBRARY_FILE_MISSING: the imported library file does not exist")]
    MissingFile,
    #[error("library database is unavailable after an interrupted operation")]
    DatabaseUnavailable,
}

impl serde::Serialize for LibraryStorageError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStorageSnapshot {
    pub revision: u64,
    pub data: Option<Value>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBlobMutation {
    pub id: String,
    /// None deletes the stored payload; Some replaces it, including encrypted bytes.
    pub bytes: Option<Vec<u8>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryLibraryManifest {
    expected_revision: u64,
    data: Value,
    blobs: Vec<BinaryBlobDescriptor>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BinaryBlobDescriptor {
    id: String,
    byte_length: BinaryBlobLength,
}

#[derive(Deserialize)]
#[serde(untagged)]
enum BinaryBlobLength {
    Bytes(u64),
    Delete(()),
}

struct BinaryLibraryWrite {
    expected_revision: u64,
    data: Value,
    blobs: Vec<LibraryBlobMutation>,
}

#[tauri::command]
pub fn read_library_storage(
    state: State<'_, DatabaseState>,
) -> Result<LibraryStorageSnapshot, LibraryStorageError> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| LibraryStorageError::DatabaseUnavailable)?;
    read_snapshot(&connection)
}

#[tauri::command]
pub fn write_library_storage(
    state: State<'_, DatabaseState>,
    expected_revision: u64,
    data: Value,
    blobs: Vec<LibraryBlobMutation>,
) -> Result<u64, LibraryStorageError> {
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| LibraryStorageError::DatabaseUnavailable)?;
    write_snapshot(&mut connection, expected_revision, data, blobs)
}

#[tauri::command]
pub fn write_library_storage_binary(
    state: State<'_, DatabaseState>,
    request: tauri::ipc::Request<'_>,
) -> Result<u64, LibraryStorageError> {
    let parsed = parse_binary_request(request.body())?;
    let mut connection = state
        .connection
        .lock()
        .map_err(|_| LibraryStorageError::DatabaseUnavailable)?;
    write_snapshot(
        &mut connection,
        parsed.expected_revision,
        parsed.data,
        parsed.blobs,
    )
}

#[tauri::command]
pub fn read_library_file(
    state: State<'_, DatabaseState>,
    id: String,
) -> Result<tauri::ipc::Response, LibraryStorageError> {
    let connection = state
        .connection
        .lock()
        .map_err(|_| LibraryStorageError::DatabaseUnavailable)?;
    Ok(tauri::ipc::Response::new(read_file(&connection, &id)?))
}

fn read_snapshot(connection: &Connection) -> Result<LibraryStorageSnapshot, LibraryStorageError> {
    let (revision, data_json): (u64, Option<String>) = connection.query_row(
        "SELECT revision, data_json FROM research_library_state WHERE id = 1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    Ok(LibraryStorageSnapshot {
        revision,
        data: data_json
            .map(|json| serde_json::from_str(&json))
            .transpose()?,
    })
}

fn parse_binary_request(
    body: &tauri::ipc::InvokeBody,
) -> Result<BinaryLibraryWrite, LibraryStorageError> {
    let tauri::ipc::InvokeBody::Raw(bytes) = body else {
        return Err(LibraryStorageError::InvalidInput(
            "binary library writes require a raw IPC body",
        ));
    };
    if bytes.len() < BINARY_HEADER_BYTES
        || bytes.len() > BINARY_HEADER_BYTES + MAX_MANIFEST_BYTES + MAX_BATCH_BYTES
        || &bytes[..4] != b"SRL1"
    {
        return Err(LibraryStorageError::InvalidInput(
            "invalid binary library frame header or size",
        ));
    }
    let manifest_length = u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize;
    let manifest_end = BINARY_HEADER_BYTES
        .checked_add(manifest_length)
        .filter(|end| manifest_length <= MAX_MANIFEST_BYTES && *end <= bytes.len())
        .ok_or(LibraryStorageError::InvalidInput(
            "binary library manifest is oversized or truncated",
        ))?;
    let manifest: BinaryLibraryManifest =
        serde_json::from_slice(&bytes[BINARY_HEADER_BYTES..manifest_end])
            .map_err(|_| LibraryStorageError::InvalidInput("invalid binary library manifest"))?;
    if manifest.expected_revision >= MAX_REVISION || manifest.blobs.len() > MAX_BATCH_FILES {
        return Err(LibraryStorageError::InvalidInput(
            "binary library revision or file count exceeds the supported range",
        ));
    }
    let state_length = serde_json::to_vec(&manifest.data)
        .map_err(|_| LibraryStorageError::InvalidInput("invalid library state"))?
        .len();
    if state_length > MAX_STATE_BYTES {
        return Err(LibraryStorageError::InvalidInput(
            "library state exceeds 64 MiB",
        ));
    }
    let mut offset = manifest_end;
    let mut batch_bytes = 0usize;
    let mut ids = HashSet::new();
    let mut payloads = Vec::with_capacity(manifest.blobs.len());
    for blob in manifest.blobs {
        validate_id(&blob.id)?;
        if !ids.insert(blob.id.clone()) {
            return Err(LibraryStorageError::InvalidInput(
                "a save cannot change the same file id twice",
            ));
        }
        let range = match blob.byte_length {
            BinaryBlobLength::Delete(()) => None,
            BinaryBlobLength::Bytes(length) => {
                let length = usize::try_from(length)
                    .ok()
                    .filter(|length| *length <= MAX_FILE_BYTES)
                    .ok_or(LibraryStorageError::InvalidInput(
                        "an imported file exceeds 256 MiB",
                    ))?;
                batch_bytes = batch_bytes
                    .checked_add(length)
                    .filter(|total| *total <= MAX_BATCH_BYTES)
                    .ok_or(LibraryStorageError::InvalidInput(
                        "the imported files in one save exceed 512 MiB",
                    ))?;
                let end = offset
                    .checked_add(length)
                    .ok_or(LibraryStorageError::InvalidInput(
                        "binary file payload length exceeds the supported range",
                    ))?;
                let range = offset..end;
                offset = end;
                Some(range)
            }
        };
        payloads.push((blob.id, range));
    }
    if offset != bytes.len() {
        return Err(LibraryStorageError::InvalidInput(
            "binary file payload is truncated or has trailing bytes",
        ));
    }
    // Validate every descriptor and the complete frame before allocating any
    // file copies. The existing transaction path owns these raw byte buffers.
    let blobs = payloads
        .into_iter()
        .map(|(id, range)| LibraryBlobMutation {
            id,
            bytes: range.map(|range| bytes[range].to_vec()),
        })
        .collect();
    Ok(BinaryLibraryWrite {
        expected_revision: manifest.expected_revision,
        data: manifest.data,
        blobs,
    })
}

fn write_snapshot(
    connection: &mut Connection,
    expected_revision: u64,
    data: Value,
    blobs: Vec<LibraryBlobMutation>,
) -> Result<u64, LibraryStorageError> {
    if expected_revision >= MAX_REVISION {
        return Err(LibraryStorageError::InvalidInput(
            "revision exceeds the supported range",
        ));
    }
    validate_blob_mutations(&blobs)?;
    let data_json = serde_json::to_string(&data)?;
    if data_json.len() > MAX_STATE_BYTES {
        return Err(LibraryStorageError::InvalidInput(
            "library state exceeds 64 MiB",
        ));
    }

    // Replacing an imported plaintext payload with encrypted bytes must also
    // clear its old SQLite cells instead of leaving plaintext in free pages.
    connection.execute_batch("PRAGMA secure_delete = ON")?;
    // State and all file changes commit together, so an encryption or import save
    // cannot leave metadata pointing at a half-written set of files.
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let current_revision: u64 = transaction.query_row(
        "SELECT revision FROM research_library_state WHERE id = 1",
        [],
        |row| row.get(0),
    )?;
    if current_revision != expected_revision {
        return Err(LibraryStorageError::Conflict {
            expected: expected_revision,
            current: current_revision,
        });
    }
    for blob in blobs {
        match blob.bytes {
            Some(bytes) => {
                transaction.execute(
                    "INSERT INTO research_library_files (id, bytes) VALUES (?1, ?2)
                     ON CONFLICT(id) DO UPDATE SET bytes = excluded.bytes",
                    params![blob.id, bytes],
                )?;
            }
            None => {
                transaction.execute(
                    "DELETE FROM research_library_files WHERE id = ?1",
                    [blob.id],
                )?;
            }
        }
    }
    let next_revision = current_revision + 1;
    transaction.execute(
        "UPDATE research_library_state SET revision = ?1, data_json = ?2 WHERE id = 1",
        params![next_revision, data_json],
    )?;
    transaction.commit()?;
    Ok(next_revision)
}

fn read_file(connection: &Connection, id: &str) -> Result<Vec<u8>, LibraryStorageError> {
    validate_id(id)?;
    connection
        .query_row(
            "SELECT bytes FROM research_library_files WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?
        .ok_or(LibraryStorageError::MissingFile)
}

fn validate_id(id: &str) -> Result<(), LibraryStorageError> {
    if id.is_empty()
        || id.len() > MAX_ID_BYTES
        || id.contains("..")
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-:.".contains(&byte))
    {
        return Err(LibraryStorageError::InvalidInput(
            "file id must be a 1-160 character key, not a file path",
        ));
    }
    Ok(())
}

fn validate_blob_mutations(blobs: &[LibraryBlobMutation]) -> Result<(), LibraryStorageError> {
    if blobs.len() > MAX_BATCH_FILES {
        return Err(LibraryStorageError::InvalidInput(
            "a save may contain at most 512 file changes",
        ));
    }
    let mut ids = HashSet::new();
    let mut batch_bytes = 0usize;
    for blob in blobs {
        validate_id(&blob.id)?;
        if !ids.insert(&blob.id) {
            return Err(LibraryStorageError::InvalidInput(
                "a save cannot change the same file id twice",
            ));
        }
        if let Some(bytes) = &blob.bytes {
            if bytes.len() > MAX_FILE_BYTES {
                return Err(LibraryStorageError::InvalidInput(
                    "an imported file exceeds 256 MiB",
                ));
            }
            batch_bytes += bytes.len();
            if batch_bytes > MAX_BATCH_BYTES {
                return Err(LibraryStorageError::InvalidInput(
                    "the imported files in one save exceed 512 MiB",
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::apply_migrations;
    use serde_json::json;

    fn test_connection() -> Connection {
        let connection = Connection::open_in_memory().expect("in-memory database");
        apply_migrations(&connection).expect("migrations apply");
        connection
    }

    fn blob(id: &str, bytes: Option<&[u8]>) -> LibraryBlobMutation {
        LibraryBlobMutation {
            id: id.to_string(),
            bytes: bytes.map(Vec::from),
        }
    }

    fn binary_frame(manifest: Value, payload: &[u8]) -> tauri::ipc::InvokeBody {
        let manifest = serde_json::to_vec(&manifest).unwrap();
        let mut frame = b"SRL1".to_vec();
        frame.extend_from_slice(&(manifest.len() as u32).to_be_bytes());
        frame.extend_from_slice(&manifest);
        frame.extend_from_slice(payload);
        tauri::ipc::InvokeBody::Raw(frame)
    }

    fn write_binary_frame(
        connection: &mut Connection,
        frame: tauri::ipc::InvokeBody,
    ) -> Result<u64, LibraryStorageError> {
        let parsed = parse_binary_request(&frame)?;
        write_snapshot(
            connection,
            parsed.expected_revision,
            parsed.data,
            parsed.blobs,
        )
    }

    fn assert_invalid_binary(frame: tauri::ipc::InvokeBody) {
        match parse_binary_request(&frame) {
            Err(LibraryStorageError::InvalidInput(message)) => {
                assert!(!message.contains("PRIVATE-CONTENT"));
            }
            _ => panic!("invalid binary frame must be rejected without exposing its contents"),
        }
    }

    #[test]
    fn binary_frame_writes_chinese_metadata_deletes_and_preserves_empty_files() {
        let mut connection = test_connection();
        write_snapshot(
            &mut connection,
            0,
            json!({"title": "old"}),
            vec![blob("remove", Some(b"old"))],
        )
        .unwrap();
        let data =
            json!({"title": "认知神经科学论文 🧠", "encrypted": {"iv": "abc", "data": "opaque"}});
        let frame = binary_frame(
            json!({
                "expectedRevision": 1,
                "data": data,
                "blobs": [
                    {"id": "remove", "byteLength": null},
                    {"id": "empty", "byteLength": 0},
                    {"id": "paper", "byteLength": 5},
                    {"id": "cipher", "byteLength": 3}
                ]
            }),
            &[37, 80, 68, 70, 45, 0, 128, 255],
        );
        assert_eq!(write_binary_frame(&mut connection, frame).unwrap(), 2);
        assert_eq!(read_snapshot(&connection).unwrap().data, Some(data));
        assert!(matches!(
            read_file(&connection, "remove"),
            Err(LibraryStorageError::MissingFile)
        ));
        assert_eq!(read_file(&connection, "empty").unwrap(), Vec::<u8>::new());
        assert_eq!(read_file(&connection, "paper").unwrap(), b"%PDF-");
        assert_eq!(read_file(&connection, "cipher").unwrap(), vec![0, 128, 255]);
    }

    #[test]
    fn binary_frame_preserves_cas_conflicts_and_atomic_rollback() {
        let mut connection = test_connection();
        write_snapshot(
            &mut connection,
            0,
            json!({"title": "keep"}),
            vec![blob("keep", Some(b"original"))],
        )
        .unwrap();
        let stale = binary_frame(
            json!({
                "expectedRevision": 0, "data": {"title": "stale"},
                "blobs": [{"id": "keep", "byteLength": null}]
            }),
            &[],
        );
        assert!(matches!(
            write_binary_frame(&mut connection, stale),
            Err(LibraryStorageError::Conflict {
                expected: 0,
                current: 1
            })
        ));
        connection
            .execute_batch(
                "CREATE TRIGGER fail_binary_file BEFORE INSERT ON research_library_files
             WHEN NEW.id = 'fail' BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END;",
            )
            .unwrap();
        let failed = binary_frame(
            json!({
                "expectedRevision": 1, "data": {"title": "discard"},
                "blobs": [
                    {"id": "keep", "byteLength": null},
                    {"id": "new", "byteLength": 2},
                    {"id": "fail", "byteLength": 1}
                ]
            }),
            &[1, 2, 3],
        );
        assert!(matches!(
            write_binary_frame(&mut connection, failed),
            Err(LibraryStorageError::Sqlite(_))
        ));
        assert_eq!(read_file(&connection, "keep").unwrap(), b"original");
        assert!(matches!(
            read_file(&connection, "new"),
            Err(LibraryStorageError::MissingFile)
        ));
        assert_eq!(
            read_snapshot(&connection).unwrap(),
            LibraryStorageSnapshot {
                revision: 1,
                data: Some(json!({"title": "keep"}))
            }
        );
    }

    #[test]
    fn binary_parser_rejects_json_bodies_bad_headers_and_invalid_utf8() {
        assert_invalid_binary(tauri::ipc::InvokeBody::Json(
            json!({"data": "PRIVATE-CONTENT", "bytes": [83, 82, 76, 49]}),
        ));
        let tauri::ipc::InvokeBody::Raw(valid_bytes) =
            binary_frame(json!({"expectedRevision": 0, "data": {}, "blobs": []}), &[])
        else {
            unreachable!();
        };
        assert_invalid_binary(tauri::ipc::InvokeBody::Json(
            serde_json::to_value(valid_bytes).unwrap(),
        ));
        for bytes in [
            b"".as_slice(),
            b"SRL1",
            b"SRL1\0\0\0",
            b"BAD1\0\0\0\0",
            b"SRL2\0\0\0\0",
            b"SRL1\0\0\0\0",
            b"SRL1\0\0\0\x01\xff",
        ] {
            assert_invalid_binary(tauri::ipc::InvokeBody::Raw(bytes.to_vec()));
        }
        let mut too_large = b"SRL1".to_vec();
        too_large.extend_from_slice(&((MAX_MANIFEST_BYTES + 1) as u32).to_be_bytes());
        assert_invalid_binary(tauri::ipc::InvokeBody::Raw(too_large));
        let mut overflowing_length = b"SRL1".to_vec();
        overflowing_length.extend_from_slice(&u32::MAX.to_be_bytes());
        assert_invalid_binary(tauri::ipc::InvokeBody::Raw(overflowing_length));
        assert_invalid_binary(tauri::ipc::InvokeBody::Raw(b"SRL1\0\0\0\x20{}".to_vec()));
    }

    #[test]
    fn binary_parser_requires_exact_payload_lengths_and_required_descriptor_fields() {
        let manifest = json!({"expectedRevision": 0, "data": {"title": "PRIVATE-CONTENT"}, "blobs": [{"id": "paper", "byteLength": 2}]});
        assert_invalid_binary(binary_frame(manifest.clone(), &[1]));
        assert_invalid_binary(binary_frame(manifest, &[1, 2, 3]));
        assert_invalid_binary(binary_frame(
            json!({"expectedRevision": 0, "data": {}, "blobs": []}),
            &[0],
        ));
        for descriptor in [
            json!({"id": "paper"}),
            json!({"id": "paper", "byteLength": -1}),
            json!({"id": "paper", "byteLength": 1.5}),
            json!({"id": "paper", "byteLength": "2"}),
            json!({"id": "paper", "byteLength": null, "bytes": [1]}),
        ] {
            assert_invalid_binary(binary_frame(
                json!({"expectedRevision": 0, "data": {}, "blobs": [descriptor]}),
                &[],
            ));
        }
    }

    #[test]
    fn binary_parser_rejects_invalid_ids_duplicates_and_size_limits_before_copying_payloads() {
        let manifests = [
            json!({"expectedRevision": 0, "data": {}, "blobs": [{"id": "../PRIVATE-CONTENT", "byteLength": null}]}),
            json!({"expectedRevision": 0, "data": {}, "blobs": [{"id": "same", "byteLength": null}, {"id": "same", "byteLength": 0}]}),
            json!({"expectedRevision": 0, "data": {}, "blobs": [{"id": "large", "byteLength": MAX_FILE_BYTES + 1}]}),
            json!({"expectedRevision": 0, "data": {}, "blobs": [{"id": "overflow", "byteLength": u64::MAX}]}),
            json!({"expectedRevision": 0, "data": {}, "blobs": (0..3).map(|index| json!({"id": format!("file-{index}"), "byteLength": MAX_FILE_BYTES})).collect::<Vec<_>>()}),
            json!({"expectedRevision": 0, "data": {}, "blobs": (0..=MAX_BATCH_FILES).map(|index| json!({"id": format!("file-{index}"), "byteLength": null})).collect::<Vec<_>>()}),
            json!({"expectedRevision": MAX_REVISION, "data": {}, "blobs": []}),
        ];
        for manifest in manifests {
            assert_invalid_binary(binary_frame(manifest, &[]));
        }
    }

    #[test]
    fn binary_parser_checks_declared_limits_before_requiring_large_payloads() {
        let cases = [
            (
                json!([{"id": "large", "byteLength": MAX_FILE_BYTES + 1}]),
                "an imported file exceeds 256 MiB",
            ),
            (
                json!((0..3)
                    .map(
                        |index| json!({"id": format!("file-{index}"), "byteLength": MAX_FILE_BYTES})
                    )
                    .collect::<Vec<_>>()),
                "the imported files in one save exceed 512 MiB",
            ),
            (
                json!((0..=MAX_BATCH_FILES)
                    .map(|index| json!({"id": format!("file-{index}"), "byteLength": null}))
                    .collect::<Vec<_>>()),
                "binary library revision or file count exceeds the supported range",
            ),
        ];
        for (blobs, expected) in cases {
            let frame = binary_frame(
                json!({"expectedRevision": 0, "data": {}, "blobs": blobs}),
                &[],
            );
            match parse_binary_request(&frame) {
                Err(LibraryStorageError::InvalidInput(message)) => assert_eq!(message, expected),
                _ => {
                    panic!("declared limits must be validated before reading or copying file bytes")
                }
            }
        }
    }

    #[test]
    fn saves_reads_replaces_and_deletes_payloads_without_interpreting_them() {
        let mut connection = test_connection();
        assert_eq!(
            read_snapshot(&connection).expect("empty snapshot"),
            LibraryStorageSnapshot {
                revision: 0,
                data: None
            }
        );
        let data = json!({"version": 1, "papers": ["sha256:abc"]});
        assert_eq!(
            write_snapshot(
                &mut connection,
                0,
                data.clone(),
                vec![blob("sha256:abc", Some(b"%PDF-1.7\nbody"))]
            )
            .expect("save"),
            1
        );
        assert_eq!(
            read_snapshot(&connection).expect("saved snapshot").data,
            Some(data)
        );
        assert_eq!(
            read_file(&connection, "sha256:abc").expect("stored file"),
            b"%PDF-1.7\nbody"
        );
        let encrypted_bytes = [0, 255, 2, 128, 42];
        write_snapshot(
            &mut connection,
            1,
            json!({"encrypted": true}),
            vec![blob("sha256:abc", Some(&encrypted_bytes))],
        )
        .expect("replace with encrypted payload");
        assert_eq!(
            read_file(&connection, "sha256:abc").expect("opaque payload"),
            encrypted_bytes
        );
        write_snapshot(
            &mut connection,
            2,
            json!({"papers": []}),
            vec![blob("sha256:abc", None)],
        )
        .expect("delete");
        assert!(matches!(
            read_file(&connection, "sha256:abc"),
            Err(LibraryStorageError::MissingFile)
        ));
    }

    #[test]
    fn enables_secure_delete_for_each_save() {
        let mut connection = test_connection();
        for revision in 0..2 {
            connection
                .execute_batch("PRAGMA secure_delete = OFF")
                .unwrap();
            write_snapshot(
                &mut connection,
                revision,
                json!({"revision": revision}),
                vec![blob(
                    "paper",
                    if revision == 0 {
                        Some(b"private")
                    } else {
                        None
                    },
                )],
            )
            .expect("save with secure deletion enabled");
            let secure_delete: i64 = connection
                .query_row("PRAGMA secure_delete", [], |row| row.get(0))
                .unwrap();
            assert_eq!(secure_delete, 1);
        }
        assert!(matches!(
            read_file(&connection, "paper"),
            Err(LibraryStorageError::MissingFile)
        ));
    }

    #[test]
    fn rejects_stale_writes_without_overwriting_state_or_files() {
        let mut connection = test_connection();
        let first = json!({"title": "manual edit"});
        write_snapshot(
            &mut connection,
            0,
            first.clone(),
            vec![blob("paper", Some(b"original"))],
        )
        .expect("first save");
        let error = write_snapshot(
            &mut connection,
            0,
            json!({"title": "stale edit"}),
            vec![blob("paper", None), blob("stale", Some(b"stale"))],
        )
        .expect_err("conflict");
        assert!(matches!(
            error,
            LibraryStorageError::Conflict {
                expected: 0,
                current: 1
            }
        ));
        assert_eq!(read_file(&connection, "paper").unwrap(), b"original");
        assert!(matches!(
            read_file(&connection, "stale"),
            Err(LibraryStorageError::MissingFile)
        ));
        assert_eq!(
            read_snapshot(&connection).unwrap(),
            LibraryStorageSnapshot {
                revision: 1,
                data: Some(first)
            }
        );
    }

    #[test]
    fn rolls_back_earlier_file_changes_when_a_later_write_fails() {
        let mut connection = test_connection();
        write_snapshot(
            &mut connection,
            0,
            json!({"title": "original"}),
            vec![blob("original", Some(b"keep"))],
        )
        .unwrap();
        connection
            .execute_batch(
                "CREATE TRIGGER reject_failed_file BEFORE INSERT ON research_library_files
                 WHEN NEW.id = 'failed' BEGIN SELECT RAISE(ABORT, 'simulated disk error'); END;",
            )
            .unwrap();
        let error = write_snapshot(
            &mut connection,
            1,
            json!({"title": "must not persist"}),
            vec![
                blob("original", None),
                blob("added", Some(b"discard")),
                blob("failed", Some(b"failure")),
            ],
        )
        .expect_err("transaction fails");
        assert!(matches!(error, LibraryStorageError::Sqlite(_)));
        assert_eq!(read_file(&connection, "original").unwrap(), b"keep");
        assert!(matches!(
            read_file(&connection, "added"),
            Err(LibraryStorageError::MissingFile)
        ));
        assert_eq!(read_snapshot(&connection).unwrap().revision, 1);
        assert_eq!(
            read_snapshot(&connection).unwrap().data,
            Some(json!({"title": "original"}))
        );
        connection
            .execute_batch("DROP TRIGGER reject_failed_file")
            .unwrap();
        assert_eq!(
            write_snapshot(&mut connection, 1, json!({"recovered": true}), vec![]).unwrap(),
            2
        );
    }

    #[test]
    fn rolls_back_files_when_the_state_write_fails() {
        let mut connection = test_connection();
        connection
            .execute_batch(
                "CREATE TRIGGER reject_state BEFORE UPDATE ON research_library_state
                 BEGIN SELECT RAISE(ABORT, 'simulated state error'); END;",
            )
            .unwrap();
        assert!(write_snapshot(
            &mut connection,
            0,
            json!({"papers": ["paper"]}),
            vec![blob("paper", Some(b"discard"))],
        )
        .is_err());
        assert!(matches!(
            read_file(&connection, "paper"),
            Err(LibraryStorageError::MissingFile)
        ));
        assert_eq!(read_snapshot(&connection).unwrap().revision, 0);
    }

    #[test]
    fn rejects_path_keys_duplicate_mutations_and_unsafe_revisions() {
        let mut connection = test_connection();
        for id in ["", "../paper", "/paper.pdf", "C:\\paper", "paper\n", "a..b"] {
            assert!(matches!(
                read_file(&connection, id),
                Err(LibraryStorageError::InvalidInput(_))
            ));
            assert!(write_snapshot(
                &mut connection,
                0,
                json!({}),
                vec![blob(id, Some(b"bytes"))]
            )
            .is_err());
        }
        assert!(validate_id(&"a".repeat(MAX_ID_BYTES + 1)).is_err());
        assert!(write_snapshot(
            &mut connection,
            0,
            json!({}),
            vec![blob("paper", Some(b"bytes")), blob("paper", None)]
        )
        .is_err());
        assert!(write_snapshot(&mut connection, MAX_REVISION, json!({}), vec![]).is_err());
        assert!(write_snapshot(
            &mut connection,
            0,
            json!({}),
            (0..=MAX_BATCH_FILES)
                .map(|index| blob(&format!("file-{index}"), None))
                .collect()
        )
        .is_err());
        assert_eq!(read_snapshot(&connection).unwrap().revision, 0);
    }

    #[test]
    fn upgrades_existing_library_without_changing_legacy_records() {
        let connection = Connection::open_in_memory().unwrap();
        // Start with the previously released schema, then migrate in the same
        // way as an installed app. Older migrations remain immutable.
        let migrations = [
            ("001_init", include_str!("migrations/001_init.sql")),
            (
                "002_reader_core_completion",
                include_str!("migrations/002_reader_core_completion.sql"),
            ),
            (
                "003_workbench_stabilization",
                include_str!("migrations/003_workbench_stabilization.sql"),
            ),
            (
                "004_tag_activity_log",
                include_str!("migrations/004_tag_activity_log.sql"),
            ),
            (
                "005_recent_file_management",
                include_str!("migrations/005_recent_file_management.sql"),
            ),
            (
                "006_bookmark_management",
                include_str!("migrations/006_bookmark_management.sql"),
            ),
        ];
        connection
            .execute_batch("CREATE TABLE schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)")
            .unwrap();
        for (version, sql) in migrations {
            connection.execute_batch(sql).unwrap();
            connection
                .execute(
                    "INSERT INTO schema_migrations VALUES (?1, '2026-10-10')",
                    [version],
                )
                .unwrap();
        }
        connection
            .execute_batch(
                "INSERT INTO documents (document_key, display_name, last_opened_at, favorite)
                 VALUES ('desktop:/original.pdf', 'Original.pdf', '2026-10-10', 1);
                 INSERT INTO preferences VALUES ('reader_preferences', '{\"theme\":\"sepia\"}', '2026-10-10');",
            )
            .unwrap();
        apply_migrations(&connection).expect("upgrade succeeds");
        apply_migrations(&connection).expect("second launch preserves migration state");
        let original: (String, i64) = connection
            .query_row(
                "SELECT display_name, favorite FROM documents WHERE document_key = 'desktop:/original.pdf'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(original, ("Original.pdf".to_string(), 1));
        let preferences: String = connection
            .query_row(
                "SELECT value_json FROM preferences WHERE key = 'reader_preferences'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(preferences, "{\"theme\":\"sepia\"}");
        assert_eq!(read_snapshot(&connection).unwrap().revision, 0);
        let migration_count: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = '007_research_library'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(migration_count, 1);
    }
}
