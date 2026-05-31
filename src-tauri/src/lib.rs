use std::{
    collections::HashMap,
    env, fs,
    io::{self, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};

use quick_xml::{
    events::{BytesStart, Event},
    Reader,
};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager};
use zip::ZipArchive;

use lopdf::{Document as PdfDocument, Object, ObjectId, Outline};

mod pdfkit;

const OPEN_FILE_EVENT: &str = "smartreader://open-file";
const UNSUPPORTED_DOCUMENT_ERROR: &str = "Unsupported document format";
const ENCRYPTED_DOCUMENT_ERROR: &str = "encrypted-document";
const DOCUMENT_ACCESS_ERROR: &str =
    "SmartReader cannot access this file path. Choose the file again to reopen it.";
const DOCUMENT_READ_CANCELLED_ERROR: &str =
    "SmartReader could not finish reading this document. Try reopening it.";
const INVALID_EPUB_CONTAINER_ERROR: &str = "Invalid EPUB: missing container";
const INVALID_EPUB_PACKAGE_ERROR: &str = "Invalid EPUB: missing package";
const CACHE_FILE_NAME: &str = "smartreader-cache.json";
const CACHE_LOCATION_FILE_NAME: &str = "smartreader-cache-location.json";
const CACHE_SCHEMA_VERSION: u64 = 1;
const CACHE_DIRECTORY_ERROR: &str = "SmartReader cache path must be a directory";
const CACHE_ACCESS_ERROR: &str = "SmartReader cannot access this cache location.";
const CACHE_SCHEMA_ERROR: &str = "Invalid SmartReader cache schema.";
// Keep annotation IPC validation independent from opening the PDF while rejecting
// page-space bounds that are far outside a normal PDF page.
const PDF_ANNOTATION_MAX_PAGE_SPACE_BOUND: f64 = 14_400.0;

type SmartReaderCacheEnvelope = serde_json::Value;

#[derive(Clone, Debug, PartialEq, Serialize)]
struct EpubDocumentDto {
    id: String,
    title: Option<String>,
    chapters: Vec<EpubChapterMetadataDto>,
    outline: Vec<EpubOutlineItemDto>,
    resources: Vec<EpubManifestResourceDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct EpubChapterMetadataDto {
    id: String,
    href: String,
    label: String,
    index: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct EpubOutlineItemDto {
    id: String,
    title: String,
    href: String,
    index: Option<usize>,
    level: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct EpubManifestResourceDto {
    id: String,
    href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    media_type: Option<String>,
    properties: Vec<String>,
    spine: bool,
    encrypted: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct EpubChapterDto {
    id: String,
    href: String,
    label: String,
    index: usize,
    sanitized_html: String,
    text: String,
    resources: Vec<EpubManifestResourceDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct EpubSearchResultDto {
    id: String,
    label: String,
    snippet: String,
    href: String,
    index: usize,
    progress: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfDocumentDto {
    id: String,
    page_count: usize,
    outline: Vec<PdfOutlineItemDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
struct PdfOutlineItemDto {
    id: String,
    title: String,
    page: usize,
    level: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum PdfAnnotationKind {
    #[serde(alias = "square")]
    Area,
    Note,
    Highlight,
    Underline,
    Strike,
    Wavy,
    RedText,
}

#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PdfAnnotationWriteMode {
    Copy,
}

// PDFKit annotation bounds use PDF page-space points; the frontend converts
// viewport areas before IPC.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfAnnotationRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfKitAnnotationCapabilitiesDto {
    supported: bool,
    status: String,
    write_modes: Vec<String>,
    annotations: Vec<PdfKitAnnotationCapabilityDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfKitAnnotationCapabilityDto {
    kind: PdfAnnotationKind,
    supported: bool,
    multi_rect: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
enum PdfKitAnnotationOperation {
    Upsert,
    Delete,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfKitAnnotationSyncItem {
    id: String,
    operation: PdfKitAnnotationOperation,
    page: usize,
    kind: PdfAnnotationKind,
    color: String,
    thickness: Option<f64>,
    note: Option<String>,
    rects: Vec<PdfAnnotationRect>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PdfKitAnnotationSyncRequest {
    write_mode: PdfAnnotationWriteMode,
    managed_copy_path: Option<String>,
    annotations: Vec<PdfKitAnnotationSyncItem>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfKitAnnotationSyncDto {
    supported: bool,
    status: String,
    source_path: String,
    managed_copy_path: String,
    annotations: Vec<PdfKitAnnotationSyncItemDto>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct PdfKitAnnotationSyncItemDto {
    id: String,
    status: String,
    page: usize,
    kind: PdfAnnotationKind,
    native_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
struct PdfAnnotationColor {
    red: f64,
    green: f64,
    blue: f64,
    alpha: f64,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpubAnchorCreateRequest {
    chapter_href: String,
    selected_text: String,
    occurrence_index: Option<usize>,
    cfi_hint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpubTextAnchorDto {
    chapter_href: String,
    selected_text: String,
    occurrence_index: usize,
    start_offset: usize,
    end_offset: usize,
    prefix: String,
    suffix: String,
    text_hash: String,
    anchor_hash: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    cfi_hint: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
struct EpubAnchorResolveRequest {
    anchor: EpubTextAnchorDto,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct EpubAnchorResolveDto {
    status: String,
    anchor: EpubTextAnchorDto,
    selected_text: String,
    occurrence_index: usize,
    start_offset: usize,
    end_offset: usize,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct CacheInfoDto {
    default_path: String,
    active_path: String,
    is_custom: bool,
    schema_version: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct LoadCacheDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    cache: Option<SmartReaderCacheEnvelope>,
    info: CacheInfoDto,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveCacheDto {
    saved_at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct SetCacheLocationDto {
    active_path: String,
    moved: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    fallback_used: Option<bool>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportCacheDto {
    path: String,
    bytes_written: u64,
    exported_at: u64,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct ImportCacheDto {
    cache: SmartReaderCacheEnvelope,
    imported_at: u64,
    applied: bool,
}

#[derive(Clone, Debug, PartialEq)]
struct CachePaths {
    default_dir: PathBuf,
    state_dir: PathBuf,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CustomCacheLocationDto {
    path: String,
}

struct EpubPackage {
    title: Option<String>,
    chapters: Vec<EpubChapterMetadataDto>,
    outline: Vec<EpubOutlineItemDto>,
    resources: Vec<EpubManifestResourceDto>,
}

struct PendingOpenFiles {
    paths: Mutex<Vec<String>>,
}

impl PendingOpenFiles {
    fn new(paths: Vec<String>) -> Self {
        Self {
            paths: Mutex::new(paths),
        }
    }

    fn push_all(&self, paths: &[String]) {
        let mut pending = self.paths.lock().expect("pending open file state poisoned");
        pending.extend(paths.iter().cloned());
    }

    fn drain(&self) -> Vec<String> {
        let mut pending = self.paths.lock().expect("pending open file state poisoned");
        pending.drain(..).collect()
    }
}

#[tauri::command]
fn pending_open_files(state: tauri::State<'_, PendingOpenFiles>) -> Vec<String> {
    state.drain()
}

#[tauri::command]
async fn read_document(path: String) -> Result<Vec<u8>, String> {
    let document_path = PathBuf::from(path);

    // Keep large filesystem reads off the async command executor while preserving the IPC contract.
    tauri::async_runtime::spawn_blocking(move || read_supported_document(document_path))
        .await
        .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn open_epub_document(path: String) -> Result<EpubDocumentDto, String> {
    let document_path = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || open_epub_document_from_path(document_path))
        .await
        .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn open_pdf_document(path: String) -> Result<PdfDocumentDto, String> {
    let document_path = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || open_pdf_document_from_path(document_path))
        .await
        .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn get_pdfkit_annotation_capabilities() -> Result<PdfKitAnnotationCapabilitiesDto, String> {
    Ok(pdfkit_annotation_capabilities())
}

#[tauri::command]
async fn sync_pdfkit_annotations(
    app_handle: tauri::AppHandle,
    path: String,
    managed_copy_path: Option<String>,
    write_mode: PdfAnnotationWriteMode,
    annotations: Vec<PdfKitAnnotationSyncItem>,
) -> Result<PdfKitAnnotationSyncDto, String> {
    let document_path = PathBuf::from(path);
    let managed_copy_dir = pdfkit_managed_copy_dir_from_app(&app_handle);
    let request = PdfKitAnnotationSyncRequest {
        write_mode,
        managed_copy_path,
        annotations,
    };

    tauri::async_runtime::spawn_blocking(move || {
        sync_pdfkit_annotations_from_path_with_managed_copy_dir(
            document_path,
            request,
            managed_copy_dir,
        )
    })
    .await
    .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn read_epub_chapter(path: String, href: String) -> Result<EpubChapterDto, String> {
    let document_path = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || read_epub_chapter_from_path(document_path, href))
        .await
        .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn search_epub_document(
    path: String,
    query: String,
) -> Result<Vec<EpubSearchResultDto>, String> {
    let document_path = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || {
        search_epub_document_from_path(document_path, query)
    })
    .await
    .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn create_epub_anchor(
    path: String,
    chapter_href: String,
    selected_text: String,
    occurrence_index: Option<usize>,
    cfi_hint: Option<String>,
) -> Result<EpubTextAnchorDto, String> {
    let document_path = PathBuf::from(path);
    let request = EpubAnchorCreateRequest {
        chapter_href,
        selected_text,
        occurrence_index,
        cfi_hint,
    };

    tauri::async_runtime::spawn_blocking(move || {
        create_epub_anchor_from_path(document_path, request)
    })
    .await
    .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn resolve_epub_anchor(
    path: String,
    anchor: EpubTextAnchorDto,
) -> Result<EpubAnchorResolveDto, String> {
    let document_path = PathBuf::from(path);
    let request = EpubAnchorResolveRequest { anchor };

    tauri::async_runtime::spawn_blocking(move || {
        resolve_epub_anchor_from_path(document_path, request)
    })
    .await
    .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
async fn rebind_epub_anchor(
    path: String,
    anchor: EpubTextAnchorDto,
) -> Result<EpubAnchorResolveDto, String> {
    let document_path = PathBuf::from(path);
    let request = EpubAnchorResolveRequest { anchor };

    tauri::async_runtime::spawn_blocking(move || {
        rebind_epub_anchor_from_path(document_path, request)
    })
    .await
    .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
}

#[tauri::command]
fn get_cache_info(app_handle: tauri::AppHandle) -> Result<CacheInfoDto, String> {
    let paths = cache_paths_from_app(&app_handle);
    cache_info_from_paths(&paths)
}

#[tauri::command]
fn load_smartreader_cache(app_handle: tauri::AppHandle) -> Result<LoadCacheDto, String> {
    let paths = cache_paths_from_app(&app_handle);
    load_cache_from_paths(&paths)
}

#[tauri::command]
fn save_smartreader_cache(
    app_handle: tauri::AppHandle,
    cache: SmartReaderCacheEnvelope,
) -> Result<SaveCacheDto, String> {
    let paths = cache_paths_from_app(&app_handle);
    save_cache_to_paths(&paths, cache)
}

#[tauri::command]
fn set_cache_location(
    app_handle: tauri::AppHandle,
    path: String,
    move_existing: bool,
) -> Result<SetCacheLocationDto, String> {
    let paths = cache_paths_from_app(&app_handle);
    set_cache_location_for_paths(&paths, PathBuf::from(path), move_existing)
}

#[tauri::command]
fn export_smartreader_cache(
    app_handle: tauri::AppHandle,
    destination_path: String,
    cache: Option<SmartReaderCacheEnvelope>,
) -> Result<ExportCacheDto, String> {
    let paths = cache_paths_from_app(&app_handle);
    export_cache_from_paths(&paths, PathBuf::from(destination_path), cache)
}

#[tauri::command]
fn import_smartreader_cache(
    app_handle: tauri::AppHandle,
    source_path: String,
    apply: bool,
) -> Result<ImportCacheDto, String> {
    let paths = cache_paths_from_app(&app_handle);
    import_cache_from_paths(&paths, PathBuf::from(source_path), apply)
}

fn read_supported_document(document_path: PathBuf) -> Result<Vec<u8>, String> {
    if !is_supported_document_path(&document_path) {
        return Err(UNSUPPORTED_DOCUMENT_ERROR.to_string());
    }

    read_document_bytes(&document_path).map_err(|_| DOCUMENT_ACCESS_ERROR.to_string())
}

fn read_document_bytes(document_path: &Path) -> io::Result<Vec<u8>> {
    let mut file = fs::File::open(document_path)?;
    let metadata = file.metadata()?;

    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "document path is not a file",
        ));
    }

    let capacity = usize::try_from(metadata.len()).map_err(|_| {
        io::Error::new(
            io::ErrorKind::InvalidData,
            "document is too large for this platform",
        )
    })?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(capacity)
        .map_err(|error| io::Error::new(io::ErrorKind::OutOfMemory, error))?;
    file.read_to_end(&mut bytes)?;

    Ok(bytes)
}

fn cache_paths_from_app(app_handle: &tauri::AppHandle) -> CachePaths {
    // Keep the custom cache pointer in app config so moving the cache directory cannot lose it.
    let fallback_root = stable_cache_fallback_root();
    let default_dir = app_handle
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| fallback_root.join("data"))
        .join("cache");
    let state_dir = app_handle
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| fallback_root.join("config"));

    CachePaths {
        default_dir,
        state_dir,
    }
}

fn stable_cache_fallback_root() -> PathBuf {
    env::current_dir()
        .unwrap_or_else(|_| env::temp_dir())
        .join(".smartreader-state")
}

fn pdfkit_managed_copy_dir_from_app(app_handle: &tauri::AppHandle) -> PathBuf {
    cache_paths_from_app(app_handle)
        .default_dir
        .join("managed-copy")
}

#[cfg(test)]
fn default_pdfkit_managed_copy_dir() -> PathBuf {
    stable_cache_fallback_root()
        .join("data")
        .join("cache")
        .join("managed-copy")
}

fn cache_info_from_paths(paths: &CachePaths) -> Result<CacheInfoDto, String> {
    let custom_dir = read_custom_cache_location(paths)?;
    let active_dir = custom_dir
        .as_ref()
        .cloned()
        .unwrap_or_else(|| paths.default_dir.clone());

    Ok(CacheInfoDto {
        default_path: paths.default_dir.to_string_lossy().into_owned(),
        active_path: active_dir.to_string_lossy().into_owned(),
        is_custom: custom_dir.is_some(),
        schema_version: CACHE_SCHEMA_VERSION,
    })
}

fn load_cache_from_paths(paths: &CachePaths) -> Result<LoadCacheDto, String> {
    let info = cache_info_from_paths(paths)?;
    let cache_path = PathBuf::from(&info.active_path).join(CACHE_FILE_NAME);
    let cache = if cache_path.exists() {
        Some(read_cache_file(&cache_path)?)
    } else {
        None
    };

    Ok(LoadCacheDto { cache, info })
}

fn save_cache_to_paths(
    paths: &CachePaths,
    cache: SmartReaderCacheEnvelope,
) -> Result<SaveCacheDto, String> {
    validate_cache_envelope(&cache)?;
    let info = cache_info_from_paths(paths)?;
    let active_dir = PathBuf::from(info.active_path);
    ensure_writable_directory(&active_dir)?;
    write_cache_file(&active_dir.join(CACHE_FILE_NAME), &cache)?;

    Ok(SaveCacheDto {
        saved_at: unix_timestamp_seconds(),
    })
}

fn set_cache_location_for_paths(
    paths: &CachePaths,
    new_dir: PathBuf,
    move_existing: bool,
) -> Result<SetCacheLocationDto, String> {
    if new_dir.as_os_str().is_empty() {
        let current_info = cache_info_from_paths(paths)?;
        let current_cache_path = PathBuf::from(current_info.active_path).join(CACHE_FILE_NAME);
        let default_cache_path = paths.default_dir.join(CACHE_FILE_NAME);

        ensure_writable_directory(&paths.default_dir)?;
        let mut moved = false;
        if move_existing && current_cache_path.exists() && current_cache_path != default_cache_path
        {
            fs::copy(&current_cache_path, &default_cache_path)
                .map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
            moved = true;
        }
        let location_path = paths.state_dir.join(CACHE_LOCATION_FILE_NAME);
        if location_path.exists() {
            fs::remove_file(location_path).map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
        }

        return Ok(SetCacheLocationDto {
            active_path: paths.default_dir.to_string_lossy().into_owned(),
            moved,
            fallback_used: Some(false),
        });
    }

    ensure_writable_directory(&new_dir)?;

    let current_info = cache_info_from_paths(paths)?;
    let current_cache_path = PathBuf::from(current_info.active_path).join(CACHE_FILE_NAME);
    let new_cache_path = new_dir.join(CACHE_FILE_NAME);
    let mut moved = false;

    if move_existing && current_cache_path.exists() {
        fs::copy(&current_cache_path, &new_cache_path)
            .map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
        moved = true;
    }

    write_custom_cache_location(paths, &new_dir)?;

    Ok(SetCacheLocationDto {
        active_path: new_dir.to_string_lossy().into_owned(),
        moved,
        fallback_used: None,
    })
}

fn export_cache_from_paths(
    paths: &CachePaths,
    destination_path: PathBuf,
    cache: Option<SmartReaderCacheEnvelope>,
) -> Result<ExportCacheDto, String> {
    if destination_path.exists() && destination_path.is_dir() {
        return Err("SmartReader cache export path must be a file".to_string());
    }

    let cache = match cache {
        Some(cache) => {
            validate_cache_envelope(&cache)?;
            cache
        }
        None => {
            let info = cache_info_from_paths(paths)?;
            let cache_path = PathBuf::from(info.active_path).join(CACHE_FILE_NAME);
            read_cache_file(&cache_path)?
        }
    };
    let bytes_written = write_cache_file(&destination_path, &cache)?;

    Ok(ExportCacheDto {
        path: destination_path.to_string_lossy().into_owned(),
        bytes_written,
        exported_at: unix_timestamp_seconds(),
    })
}

fn import_cache_from_paths(
    paths: &CachePaths,
    source_path: PathBuf,
    apply: bool,
) -> Result<ImportCacheDto, String> {
    let cache = read_cache_file(&source_path)?;

    if apply {
        save_cache_to_paths(paths, cache.clone())?;
    }

    Ok(ImportCacheDto {
        cache,
        imported_at: unix_timestamp_seconds(),
        applied: apply,
    })
}

fn read_cache_file(cache_path: &Path) -> Result<SmartReaderCacheEnvelope, String> {
    let text = fs::read_to_string(cache_path).map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
    let cache: SmartReaderCacheEnvelope =
        serde_json::from_str(&text).map_err(|_| CACHE_SCHEMA_ERROR.to_string())?;
    validate_cache_envelope(&cache)?;
    Ok(cache)
}

fn write_cache_file(cache_path: &Path, cache: &SmartReaderCacheEnvelope) -> Result<u64, String> {
    validate_cache_envelope(cache)?;

    if let Some(parent) = cache_path.parent() {
        ensure_writable_directory(parent)?;
    }

    let bytes = serde_json::to_vec_pretty(cache).map_err(|_| CACHE_SCHEMA_ERROR.to_string())?;
    let temp_path = cache_path.with_extension(format!("json.{}.tmp", unique_suffix()));
    fs::write(&temp_path, &bytes).map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
    fs::rename(&temp_path, cache_path).map_err(|_| CACHE_ACCESS_ERROR.to_string())?;

    Ok(bytes.len() as u64)
}

fn validate_cache_envelope(cache: &SmartReaderCacheEnvelope) -> Result<(), String> {
    let Some(object) = cache.as_object() else {
        return Err(CACHE_SCHEMA_ERROR.to_string());
    };

    if object
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(CACHE_SCHEMA_VERSION)
    {
        return Err(CACHE_SCHEMA_ERROR.to_string());
    }

    if object.keys().any(|key| !is_allowed_cache_key(key)) {
        return Err(CACHE_SCHEMA_ERROR.to_string());
    }

    required_cache_object_field(object, "settings")?;
    optional_cache_object_field(object, "preferences")?;
    required_cache_array_field(object, "recentFiles")?;
    required_cache_array_field(object, "readingProgress")?;
    let session = required_cache_object_field(object, "session")?;
    required_cache_array_field(session, "tabs")?;
    let adapter_cache = required_cache_object_field(object, "adapterCache")?;
    required_cache_array_field(adapter_cache, "searchIndexes")?;
    optional_cache_string_field(object, "appVersion")?;
    optional_cache_timestamp_field(object, "savedAt")?;
    validate_cache_payload_value(cache)?;

    Ok(())
}

fn required_cache_object_field<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<&'a serde_json::Map<String, serde_json::Value>, String> {
    object
        .get(key)
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| CACHE_SCHEMA_ERROR.to_string())
}

fn optional_cache_object_field(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<(), String> {
    if let Some(value) = object.get(key) {
        if !value.is_object() {
            return Err(CACHE_SCHEMA_ERROR.to_string());
        }
    }

    Ok(())
}

fn required_cache_array_field<'a>(
    object: &'a serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<&'a Vec<serde_json::Value>, String> {
    object
        .get(key)
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| CACHE_SCHEMA_ERROR.to_string())
}

fn optional_cache_string_field(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<(), String> {
    if let Some(value) = object.get(key) {
        if !value.is_string() {
            return Err(CACHE_SCHEMA_ERROR.to_string());
        }
    }

    Ok(())
}

fn optional_cache_timestamp_field(
    object: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<(), String> {
    if let Some(value) = object.get(key) {
        if !(value.is_string() || value.is_number()) {
            return Err(CACHE_SCHEMA_ERROR.to_string());
        }
    }

    Ok(())
}

fn validate_cache_payload_value(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::Object(object) => {
            for (key, value) in object {
                if is_disallowed_cache_payload_key(key) {
                    return Err(CACHE_SCHEMA_ERROR.to_string());
                }
                validate_cache_payload_value(value)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                validate_cache_payload_value(value)?;
            }
        }
        serde_json::Value::String(value) => {
            if is_disallowed_cache_payload_string(value) {
                return Err(CACHE_SCHEMA_ERROR.to_string());
            }
        }
        _ => {}
    }

    Ok(())
}

fn is_disallowed_cache_payload_key(key: &str) -> bool {
    let normalized = normalize_cache_key(key);
    matches!(
        normalized.as_str(),
        "rawtext"
            | "rawhtml"
            | "rawcontent"
            | "rawdocument"
            | "objecturl"
            | "objecturls"
            | "pdfproxy"
            | "pdfbytes"
            | "epubbytes"
            | "documentbytes"
            | "filebytes"
            | "bytes"
            | "blob"
            | "bloburl"
            | "dataurl"
            | "datauri"
    )
}

fn normalize_cache_key(key: &str) -> String {
    key.chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_disallowed_cache_payload_string(value: &str) -> bool {
    let value = value.trim().to_ascii_lowercase();

    value.starts_with("blob:")
        || value.starts_with("data:application/pdf")
        || value.starts_with("data:application/epub")
        || value.starts_with("data:application/octet-stream")
}

fn is_allowed_cache_key(key: &str) -> bool {
    matches!(
        key,
        "schemaVersion"
            | "appVersion"
            | "savedAt"
            | "settings"
            | "preferences"
            | "recentFiles"
            | "readingProgress"
            | "session"
            | "adapterCache"
    )
}

fn ensure_writable_directory(path: &Path) -> Result<(), String> {
    if path.exists() && !path.is_dir() {
        return Err(CACHE_DIRECTORY_ERROR.to_string());
    }

    fs::create_dir_all(path).map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
    let probe_path = path.join(format!(".smartreader-write-test-{}", unique_suffix()));
    fs::write(&probe_path, b"ok").map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
    fs::remove_file(probe_path).map_err(|_| CACHE_ACCESS_ERROR.to_string())?;

    Ok(())
}

fn read_custom_cache_location(paths: &CachePaths) -> Result<Option<PathBuf>, String> {
    let path = paths.state_dir.join(CACHE_LOCATION_FILE_NAME);
    if !path.exists() {
        return Ok(None);
    }

    let text = fs::read_to_string(path).map_err(|_| CACHE_ACCESS_ERROR.to_string())?;
    let location: CustomCacheLocationDto =
        serde_json::from_str(&text).map_err(|_| CACHE_SCHEMA_ERROR.to_string())?;
    if location.path.trim().is_empty() {
        return Err(CACHE_SCHEMA_ERROR.to_string());
    }

    Ok(Some(PathBuf::from(location.path)))
}

fn write_custom_cache_location(paths: &CachePaths, new_dir: &Path) -> Result<(), String> {
    ensure_writable_directory(&paths.state_dir)?;
    let location = CustomCacheLocationDto {
        path: new_dir.to_string_lossy().into_owned(),
    };
    let text = serde_json::to_vec_pretty(&location).map_err(|_| CACHE_SCHEMA_ERROR.to_string())?;
    fs::write(paths.state_dir.join(CACHE_LOCATION_FILE_NAME), text)
        .map_err(|_| CACHE_ACCESS_ERROR.to_string())
}

fn unix_timestamp_seconds() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn unique_suffix() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();

    format!("{}-{nanos}", std::process::id())
}

fn open_pdf_document_from_path(document_path: PathBuf) -> Result<PdfDocumentDto, String> {
    validate_pdf_path(&document_path)?;

    let document =
        PdfDocument::load(&document_path).map_err(|_| DOCUMENT_ACCESS_ERROR.to_string())?;
    let page_count = document.get_pages().len();
    let outline = pdf_outline_items(&document);

    Ok(PdfDocumentDto {
        id: document_path.to_string_lossy().into_owned(),
        page_count,
        outline,
    })
}

fn pdfkit_annotation_capabilities() -> PdfKitAnnotationCapabilitiesDto {
    PdfKitAnnotationCapabilitiesDto {
        supported: cfg!(target_os = "macos"),
        status: if cfg!(target_os = "macos") {
            "available".to_string()
        } else {
            "unsupported-platform".to_string()
        },
        write_modes: vec!["copy".to_string()],
        annotations: vec![
            pdfkit_annotation_capability(PdfAnnotationKind::Area, true, false, None),
            pdfkit_annotation_capability(PdfAnnotationKind::Note, true, false, None),
            pdfkit_annotation_capability(PdfAnnotationKind::Highlight, true, true, None),
            pdfkit_annotation_capability(PdfAnnotationKind::Underline, true, true, None),
            pdfkit_annotation_capability(PdfAnnotationKind::Strike, true, true, None),
            pdfkit_annotation_capability(
                PdfAnnotationKind::Wavy,
                false,
                false,
                Some("unsupported-native-mapping"),
            ),
            pdfkit_annotation_capability(
                PdfAnnotationKind::RedText,
                false,
                false,
                Some("unsupported-native-mapping"),
            ),
        ],
    }
}

fn pdfkit_annotation_capability(
    kind: PdfAnnotationKind,
    supported: bool,
    multi_rect: bool,
    reason: Option<&str>,
) -> PdfKitAnnotationCapabilityDto {
    PdfKitAnnotationCapabilityDto {
        kind,
        supported,
        multi_rect,
        reason: reason.map(str::to_string),
    }
}

#[cfg(test)]
fn sync_pdfkit_annotations_from_path(
    document_path: PathBuf,
    request: PdfKitAnnotationSyncRequest,
) -> Result<PdfKitAnnotationSyncDto, String> {
    sync_pdfkit_annotations_from_path_with_managed_copy_dir(
        document_path,
        request,
        default_pdfkit_managed_copy_dir(),
    )
}

fn sync_pdfkit_annotations_from_path_with_managed_copy_dir(
    document_path: PathBuf,
    request: PdfKitAnnotationSyncRequest,
    managed_copy_dir: PathBuf,
) -> Result<PdfKitAnnotationSyncDto, String> {
    validate_pdfkit_annotation_sync_request(&request)?;
    validate_pdf_path(&document_path)?;
    pdfkit::sync_pdfkit_annotations_from_path(document_path, request, managed_copy_dir)
}

fn validate_pdfkit_annotation_sync_request(
    request: &PdfKitAnnotationSyncRequest,
) -> Result<(), String> {
    match request.write_mode {
        PdfAnnotationWriteMode::Copy => {}
    }

    if request.annotations.len() > 10_000 {
        return Err("Invalid PDFKit annotation sync request".to_string());
    }

    for annotation in &request.annotations {
        validate_pdfkit_annotation_sync_item(annotation)?;
    }

    Ok(())
}

fn validate_pdfkit_annotation_sync_item(
    annotation: &PdfKitAnnotationSyncItem,
) -> Result<(), String> {
    if annotation.id.trim().is_empty() || annotation.id.len() > 256 {
        return Err("Invalid PDFKit annotation id".to_string());
    }

    if annotation.page == 0 {
        return Err("Invalid PDF annotation page".to_string());
    }

    if !pdfkit_annotation_kind_supported(annotation.kind) {
        return Err("Unsupported PDFKit annotation kind".to_string());
    }

    if let Some(thickness) = annotation.thickness {
        if !thickness.is_finite() || thickness <= 0.0 || thickness > 100.0 {
            return Err("Invalid PDF annotation thickness".to_string());
        }
    }

    if annotation
        .note
        .as_deref()
        .map(|note| note.len() > 4096)
        .unwrap_or(false)
    {
        return Err("Invalid PDF annotation note".to_string());
    }

    if matches!(annotation.operation, PdfKitAnnotationOperation::Delete) {
        return Ok(());
    }

    parse_pdf_annotation_color(&annotation.color)?;
    if annotation.rects.is_empty()
        || annotation
            .rects
            .iter()
            .any(|rect| !is_valid_pdf_annotation_rect(rect))
    {
        return Err("Invalid PDF annotation rect".to_string());
    }
    if !pdfkit_annotation_kind_allows_multi_rect(annotation.kind) && annotation.rects.len() != 1 {
        return Err("Invalid PDF annotation rect".to_string());
    }

    Ok(())
}

fn pdfkit_annotation_kind_supported(kind: PdfAnnotationKind) -> bool {
    matches!(
        kind,
        PdfAnnotationKind::Area
            | PdfAnnotationKind::Note
            | PdfAnnotationKind::Highlight
            | PdfAnnotationKind::Underline
            | PdfAnnotationKind::Strike
    )
}

fn pdfkit_annotation_kind_allows_multi_rect(kind: PdfAnnotationKind) -> bool {
    matches!(
        kind,
        PdfAnnotationKind::Highlight | PdfAnnotationKind::Underline | PdfAnnotationKind::Strike
    )
}

fn is_valid_pdf_annotation_rect(rect: &PdfAnnotationRect) -> bool {
    let max_x = rect.x + rect.width;
    let max_y = rect.y + rect.height;

    rect.x.is_finite()
        && rect.y.is_finite()
        && rect.width.is_finite()
        && rect.height.is_finite()
        && max_x.is_finite()
        && max_y.is_finite()
        && rect.x >= 0.0
        && rect.y >= 0.0
        && rect.width > 0.0
        && rect.height > 0.0
        && rect.x <= PDF_ANNOTATION_MAX_PAGE_SPACE_BOUND
        && rect.y <= PDF_ANNOTATION_MAX_PAGE_SPACE_BOUND
        && rect.width <= PDF_ANNOTATION_MAX_PAGE_SPACE_BOUND
        && rect.height <= PDF_ANNOTATION_MAX_PAGE_SPACE_BOUND
        && max_x <= PDF_ANNOTATION_MAX_PAGE_SPACE_BOUND
        && max_y <= PDF_ANNOTATION_MAX_PAGE_SPACE_BOUND
}

fn parse_pdf_annotation_color(color: &str) -> Result<PdfAnnotationColor, String> {
    let hex = color
        .strip_prefix('#')
        .ok_or_else(|| "Invalid PDF annotation color".to_string())?;
    if hex.len() != 6 && hex.len() != 8 {
        return Err("Invalid PDF annotation color".to_string());
    }
    if !hex.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("Invalid PDF annotation color".to_string());
    }

    let red = u8::from_str_radix(&hex[0..2], 16)
        .map_err(|_| "Invalid PDF annotation color".to_string())?;
    let green = u8::from_str_radix(&hex[2..4], 16)
        .map_err(|_| "Invalid PDF annotation color".to_string())?;
    let blue = u8::from_str_radix(&hex[4..6], 16)
        .map_err(|_| "Invalid PDF annotation color".to_string())?;
    let alpha = if hex.len() == 8 {
        u8::from_str_radix(&hex[6..8], 16)
            .map_err(|_| "Invalid PDF annotation color".to_string())?
    } else {
        u8::MAX
    };

    Ok(PdfAnnotationColor {
        red: f64::from(red) / 255.0,
        green: f64::from(green) / 255.0,
        blue: f64::from(blue) / 255.0,
        alpha: f64::from(alpha) / 255.0,
    })
}

fn validate_pdf_path(document_path: &Path) -> Result<(), String> {
    if !is_supported_pdf_path(document_path) {
        return Err(UNSUPPORTED_DOCUMENT_ERROR.to_string());
    }

    let metadata = fs::metadata(document_path).map_err(|_| DOCUMENT_ACCESS_ERROR.to_string())?;
    if metadata.is_file() {
        Ok(())
    } else {
        Err(DOCUMENT_ACCESS_ERROR.to_string())
    }
}

fn pdf_outline_items(document: &PdfDocument) -> Vec<PdfOutlineItemDto> {
    let mut named_destinations = Default::default();
    let Ok(Some(outlines)) = document.get_outlines(None, None, &mut named_destinations) else {
        return Vec::new();
    };
    let page_lookup: HashMap<ObjectId, usize> = document
        .get_pages()
        .into_iter()
        .filter_map(|(page_number, object_id)| {
            usize::try_from(page_number)
                .ok()
                .map(|page_number| (object_id, page_number))
        })
        .collect();
    let mut items = Vec::new();
    flatten_pdf_outlines(&outlines, 0, &page_lookup, &mut items);
    items
}

fn flatten_pdf_outlines(
    outlines: &[Outline],
    level: usize,
    page_lookup: &HashMap<ObjectId, usize>,
    items: &mut Vec<PdfOutlineItemDto>,
) {
    for outline in outlines {
        match outline {
            Outline::Destination(destination) => {
                if let (Some(title), Some(page)) = (
                    pdf_object_text(destination.title().ok()),
                    pdf_destination_page(destination.page().ok(), page_lookup),
                ) {
                    items.push(PdfOutlineItemDto {
                        id: format!("pdf-outline-{}", items.len()),
                        title,
                        page,
                        level,
                    });
                }
            }
            Outline::SubOutlines(children) => {
                flatten_pdf_outlines(children, level + 1, page_lookup, items);
            }
        }
    }
}

fn pdf_destination_page(
    page: Option<&Object>,
    page_lookup: &HashMap<ObjectId, usize>,
) -> Option<usize> {
    match page? {
        Object::Reference(object_id) => page_lookup.get(object_id).copied(),
        Object::Integer(index) if *index >= 0 => usize::try_from(index + 1).ok(),
        _ => None,
    }
}

fn pdf_object_text(value: Option<&Object>) -> Option<String> {
    let bytes = value?.as_str().ok()?;
    if bytes.starts_with(&[0xFE, 0xFF]) {
        let text: Vec<u16> = bytes[2..]
            .chunks_exact(2)
            .map(|chunk| u16::from_be_bytes([chunk[0], chunk[1]]))
            .collect();
        String::from_utf16(&text).ok()
    } else {
        Some(String::from_utf8_lossy(bytes).to_string())
    }
    .map(|text| normalize_whitespace(&text))
    .filter(|text| !text.is_empty())
}

fn open_epub_document_from_path(document_path: PathBuf) -> Result<EpubDocumentDto, String> {
    validate_epub_path(&document_path)?;

    let id = document_path.to_string_lossy().into_owned();
    let mut archive = open_epub_archive(&document_path)?;
    let package = read_epub_package(&mut archive)?;

    Ok(EpubDocumentDto {
        id,
        title: package.title,
        chapters: package.chapters,
        outline: package.outline,
        resources: package.resources,
    })
}

fn read_epub_chapter_from_path(
    document_path: PathBuf,
    href: String,
) -> Result<EpubChapterDto, String> {
    validate_epub_path(&document_path)?;

    let mut archive = open_epub_archive(&document_path)?;
    let package = read_epub_package(&mut archive)?;
    let requested_href = normalize_epub_href(&href);
    let chapter = package
        .chapters
        .iter()
        .find(|chapter| normalize_epub_href(&chapter.href) == requested_href)
        .ok_or_else(|| "Invalid EPUB: missing chapter".to_string())?;
    let raw = read_zip_text(&mut archive, &chapter.href)
        .map_err(|_| "Invalid EPUB: missing chapter".to_string())?;
    let resources = chapter_resource_metadata(&chapter.href, &raw, &package.resources);
    let sanitized_html = sanitize_epub_html(&raw);
    let text = text_from_sanitized_html(&sanitized_html);

    Ok(EpubChapterDto {
        id: chapter.id.clone(),
        href: chapter.href.clone(),
        label: chapter.label.clone(),
        index: chapter.index,
        sanitized_html,
        text,
        resources,
    })
}

fn search_epub_document_from_path(
    document_path: PathBuf,
    query: String,
) -> Result<Vec<EpubSearchResultDto>, String> {
    validate_epub_path(&document_path)?;

    let query = normalize_whitespace(&query);
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let mut archive = open_epub_archive(&document_path)?;
    let package = read_epub_package(&mut archive)?;
    let lower_query = query.to_lowercase();
    let chapter_count = package.chapters.len();
    let mut results = Vec::new();

    for chapter in &package.chapters {
        let Ok(raw) = read_zip_text(&mut archive, &chapter.href) else {
            continue;
        };
        let sanitized_html = sanitize_epub_html(&raw);
        let text = text_from_sanitized_html(&sanitized_html);
        let lower_text = text.to_lowercase();
        let mut search_start = 0;

        while let Some(relative_index) = lower_text[search_start..].find(&lower_query) {
            let match_index = search_start + relative_index;
            results.push(EpubSearchResultDto {
                id: format!("epub-search-{}-{}", chapter.id, match_index),
                label: chapter.label.clone(),
                snippet: snippet_around(&text, match_index, query.len()),
                href: chapter.href.clone(),
                index: chapter.index,
                progress: if chapter_count > 1 {
                    chapter.index as f64 / (chapter_count - 1) as f64
                } else {
                    0.0
                },
            });
            search_start = match_index + lower_query.len();
        }
    }

    Ok(results)
}

fn create_epub_anchor_from_path(
    document_path: PathBuf,
    request: EpubAnchorCreateRequest,
) -> Result<EpubTextAnchorDto, String> {
    let text = read_epub_canonical_chapter_text(&document_path, &request.chapter_href)?;

    create_epub_text_anchor(
        &request.chapter_href,
        &text,
        &request.selected_text,
        request.occurrence_index,
        request.cfi_hint,
    )
}

fn resolve_epub_anchor_from_path(
    document_path: PathBuf,
    request: EpubAnchorResolveRequest,
) -> Result<EpubAnchorResolveDto, String> {
    let text = read_epub_canonical_chapter_text(&document_path, &request.anchor.chapter_href)?;

    resolve_epub_text_anchor(&request.anchor, &text)
}

fn rebind_epub_anchor_from_path(
    document_path: PathBuf,
    request: EpubAnchorResolveRequest,
) -> Result<EpubAnchorResolveDto, String> {
    let text = read_epub_canonical_chapter_text(&document_path, &request.anchor.chapter_href)?;

    rebind_epub_text_anchor(&request.anchor, &text)
}

fn read_epub_canonical_chapter_text(document_path: &Path, href: &str) -> Result<String, String> {
    validate_epub_path(document_path)?;
    let mut archive = open_epub_archive(document_path)?;
    let package = read_epub_package(&mut archive)?;
    let requested_href = normalize_epub_href(href);
    let chapter = package
        .chapters
        .iter()
        .find(|chapter| normalize_epub_href(&chapter.href) == requested_href)
        .ok_or_else(|| "Invalid EPUB: missing chapter".to_string())?;
    let raw = read_zip_text(&mut archive, &chapter.href)
        .map_err(|_| "Invalid EPUB: missing chapter".to_string())?;
    let sanitized_html = sanitize_epub_html(&raw);

    Ok(text_from_sanitized_html(&sanitized_html))
}

fn create_epub_text_anchor(
    chapter_href: &str,
    canonical_text: &str,
    selected_text: &str,
    occurrence_index: Option<usize>,
    cfi_hint: Option<String>,
) -> Result<EpubTextAnchorDto, String> {
    let selected_text = normalize_whitespace(selected_text);
    if selected_text.is_empty() {
        return Err("Invalid EPUB anchor text".to_string());
    }

    let occurrences = text_occurrences(canonical_text, &selected_text);
    let occurrence_index = occurrence_index.unwrap_or(0);
    let Some(start_byte) = occurrences.get(occurrence_index).copied() else {
        return Err("EPUB anchor text not found".to_string());
    };
    let end_byte = start_byte + selected_text.len();

    Ok(build_epub_text_anchor(
        chapter_href,
        canonical_text,
        selected_text,
        occurrence_index,
        start_byte,
        end_byte,
        cfi_hint,
    ))
}

fn resolve_epub_text_anchor(
    anchor: &EpubTextAnchorDto,
    canonical_text: &str,
) -> Result<EpubAnchorResolveDto, String> {
    let text_hash = deterministic_hash(canonical_text);
    if anchor.text_hash != text_hash {
        return rebind_epub_text_anchor(anchor, canonical_text);
    }

    let occurrences = text_occurrences(canonical_text, &anchor.selected_text);
    let Some(start_byte) = occurrences.get(anchor.occurrence_index).copied() else {
        return rebind_epub_text_anchor(anchor, canonical_text);
    };
    let end_byte = start_byte + anchor.selected_text.len();
    let resolved = build_epub_text_anchor(
        &anchor.chapter_href,
        canonical_text,
        anchor.selected_text.clone(),
        anchor.occurrence_index,
        start_byte,
        end_byte,
        anchor.cfi_hint.clone(),
    );

    if resolved.anchor_hash != anchor.anchor_hash {
        return rebind_epub_text_anchor(anchor, canonical_text);
    }

    Ok(epub_anchor_resolution("resolved", resolved))
}

fn rebind_epub_text_anchor(
    anchor: &EpubTextAnchorDto,
    canonical_text: &str,
) -> Result<EpubAnchorResolveDto, String> {
    let occurrences = text_occurrences(canonical_text, &anchor.selected_text);
    for (occurrence_index, start_byte) in occurrences.iter().copied().enumerate() {
        let end_byte = start_byte + anchor.selected_text.len();
        if anchor_context_matches(canonical_text, start_byte, end_byte, anchor) {
            let rebound = build_epub_text_anchor(
                &anchor.chapter_href,
                canonical_text,
                anchor.selected_text.clone(),
                occurrence_index,
                start_byte,
                end_byte,
                anchor.cfi_hint.clone(),
            );
            return Ok(epub_anchor_resolution("rebound", rebound));
        }
    }

    let Some(start_byte) = occurrences.get(anchor.occurrence_index).copied() else {
        return Err("EPUB anchor text not found".to_string());
    };
    let end_byte = start_byte + anchor.selected_text.len();
    let rebound = build_epub_text_anchor(
        &anchor.chapter_href,
        canonical_text,
        anchor.selected_text.clone(),
        anchor.occurrence_index,
        start_byte,
        end_byte,
        anchor.cfi_hint.clone(),
    );

    Ok(epub_anchor_resolution("rebound", rebound))
}

fn build_epub_text_anchor(
    chapter_href: &str,
    canonical_text: &str,
    selected_text: String,
    occurrence_index: usize,
    start_byte: usize,
    end_byte: usize,
    cfi_hint: Option<String>,
) -> EpubTextAnchorDto {
    let prefix = anchor_prefix(canonical_text, start_byte);
    let suffix = anchor_suffix(canonical_text, end_byte);
    let text_hash = deterministic_hash(canonical_text);
    let anchor_hash = deterministic_hash(&format!(
        "{chapter_href}\n{selected_text}\n{occurrence_index}\n{prefix}\n{suffix}\n{text_hash}"
    ));

    EpubTextAnchorDto {
        chapter_href: chapter_href.to_string(),
        selected_text,
        occurrence_index,
        start_offset: char_offset(canonical_text, start_byte),
        end_offset: char_offset(canonical_text, end_byte),
        prefix,
        suffix,
        text_hash,
        anchor_hash,
        cfi_hint,
    }
}

fn epub_anchor_resolution(status: &str, anchor: EpubTextAnchorDto) -> EpubAnchorResolveDto {
    EpubAnchorResolveDto {
        status: status.to_string(),
        selected_text: anchor.selected_text.clone(),
        occurrence_index: anchor.occurrence_index,
        start_offset: anchor.start_offset,
        end_offset: anchor.end_offset,
        anchor,
    }
}

fn text_occurrences(text: &str, needle: &str) -> Vec<usize> {
    let mut occurrences = Vec::new();
    let mut search_start = 0;

    while let Some(relative_index) = text[search_start..].find(needle) {
        let start = search_start + relative_index;
        occurrences.push(start);
        search_start = start + needle.len();
    }

    occurrences
}

fn anchor_context_matches(
    canonical_text: &str,
    start_byte: usize,
    end_byte: usize,
    anchor: &EpubTextAnchorDto,
) -> bool {
    canonical_text[..start_byte].ends_with(&anchor.prefix)
        && canonical_text[end_byte..].starts_with(&anchor.suffix)
}

fn anchor_prefix(text: &str, end_byte: usize) -> String {
    text[..end_byte]
        .chars()
        .rev()
        .take(32)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect()
}

fn anchor_suffix(text: &str, start_byte: usize) -> String {
    text[start_byte..].chars().take(32).collect()
}

fn char_offset(text: &str, byte_offset: usize) -> usize {
    text[..byte_offset].chars().count()
}

fn deterministic_hash(value: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    format!("fnv1a64:{hash:016x}")
}

fn validate_epub_path(document_path: &Path) -> Result<(), String> {
    if !is_supported_epub_path(document_path) {
        return Err(UNSUPPORTED_DOCUMENT_ERROR.to_string());
    }

    Ok(())
}

fn open_epub_archive(document_path: &Path) -> Result<ZipArchive<fs::File>, String> {
    let file = fs::File::open(document_path).map_err(|_| DOCUMENT_ACCESS_ERROR.to_string())?;
    let metadata = file
        .metadata()
        .map_err(|_| DOCUMENT_ACCESS_ERROR.to_string())?;

    if !metadata.is_file() {
        return Err(DOCUMENT_ACCESS_ERROR.to_string());
    }

    ZipArchive::new(file).map_err(|_| INVALID_EPUB_CONTAINER_ERROR.to_string())
}

fn read_epub_package(archive: &mut ZipArchive<fs::File>) -> Result<EpubPackage, String> {
    let container = read_zip_text(archive, "META-INF/container.xml")
        .map_err(|_| INVALID_EPUB_CONTAINER_ERROR.to_string())?;
    let package_path = parse_container_package_path(&container)
        .ok_or_else(|| INVALID_EPUB_CONTAINER_ERROR.to_string())?;
    let encrypted_paths = read_epub_encrypted_paths(archive)?;
    if encrypted_paths.contains(&package_path) {
        return Err(ENCRYPTED_DOCUMENT_ERROR.to_string());
    }
    let package_text = read_zip_text(archive, &package_path)
        .map_err(|_| INVALID_EPUB_PACKAGE_ERROR.to_string())?;

    parse_epub_package(archive, &package_path, &package_text, &encrypted_paths)
}

fn read_zip_text(archive: &mut ZipArchive<fs::File>, path: &str) -> io::Result<String> {
    let mut file = archive.by_name(path)?;
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    Ok(text)
}

fn read_epub_encrypted_paths(archive: &mut ZipArchive<fs::File>) -> Result<Vec<String>, String> {
    if archive.by_name("META-INF/rights.xml").is_ok() {
        return Err(ENCRYPTED_DOCUMENT_ERROR.to_string());
    }

    if archive.by_name("META-INF/encryption.xml").is_err() {
        return Ok(Vec::new());
    }

    let encryption_text = read_zip_text(archive, "META-INF/encryption.xml")
        .map_err(|_| ENCRYPTED_DOCUMENT_ERROR.to_string())?;
    let encrypted_paths = parse_epub_encryption_paths(&encryption_text);

    if encrypted_paths.is_empty() {
        Err(ENCRYPTED_DOCUMENT_ERROR.to_string())
    } else {
        Ok(encrypted_paths)
    }
}

fn parse_epub_encryption_paths(encryption_text: &str) -> Vec<String> {
    let mut reader = xml_reader(encryption_text);
    let mut paths = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) | Ok(Event::Empty(start))
                if tag_matches(start.name().as_ref(), "CipherReference") =>
            {
                if let Some(uri) = xml_attr(&start, "URI") {
                    let path = normalize_epub_href(&uri);
                    if !path.is_empty() && !paths.contains(&path) {
                        paths.push(path);
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    paths
}

fn parse_container_package_path(container: &str) -> Option<String> {
    let mut reader = xml_reader(container);

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) | Ok(Event::Empty(start))
                if tag_matches(start.name().as_ref(), "rootfile") =>
            {
                return xml_attr(&start, "full-path").map(|path| normalize_epub_href(&path));
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
    }
}

fn parse_epub_package(
    archive: &mut ZipArchive<fs::File>,
    package_path: &str,
    package_text: &str,
    encrypted_paths: &[String],
) -> Result<EpubPackage, String> {
    let base_path = epub_base_path(package_path);
    let mut reader = xml_reader(package_text);
    let mut title = None;
    let mut in_title = false;
    let mut manifest: HashMap<String, ManifestItem> = HashMap::new();
    let mut spine_ids = Vec::new();
    let mut nav_path = None;
    let mut spine_toc_id = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) | Ok(Event::Empty(start))
                if tag_matches(start.name().as_ref(), "item") =>
            {
                if let (Some(id), Some(href)) = (xml_attr(&start, "id"), xml_attr(&start, "href")) {
                    let resolved_href = resolve_epub_path(&base_path, &href);
                    let properties = xml_attr(&start, "properties")
                        .map(|properties| split_epub_properties(&properties))
                        .unwrap_or_default();
                    let media_type = xml_attr(&start, "media-type");
                    if properties.iter().any(|property| property == "nav") {
                        nav_path = Some(resolved_href.clone());
                    }
                    manifest.insert(
                        id.clone(),
                        ManifestItem {
                            id,
                            href: resolved_href,
                            media_type,
                            properties,
                        },
                    );
                }
            }
            Ok(Event::Start(start)) | Ok(Event::Empty(start))
                if tag_matches(start.name().as_ref(), "spine") =>
            {
                spine_toc_id = xml_attr(&start, "toc");
            }
            Ok(Event::Start(start)) | Ok(Event::Empty(start))
                if tag_matches(start.name().as_ref(), "itemref") =>
            {
                if let Some(idref) = xml_attr(&start, "idref") {
                    spine_ids.push(idref);
                }
            }
            Ok(Event::Start(start)) if tag_matches(start.name().as_ref(), "title") => {
                in_title = true;
            }
            Ok(Event::Text(text_event)) if in_title => {
                if title.is_none() {
                    let value = text_event.decode().unwrap_or_default().trim().to_string();
                    if !value.is_empty() {
                        title = Some(value);
                    }
                }
            }
            Ok(Event::End(end)) if tag_matches(end.name().as_ref(), "title") => {
                in_title = false;
            }
            Ok(Event::Eof) => break,
            Err(_) => return Err(INVALID_EPUB_PACKAGE_ERROR.to_string()),
            _ => {}
        }
    }

    if nav_path
        .as_ref()
        .map(|path| encrypted_paths.contains(path))
        .unwrap_or(false)
    {
        return Err(ENCRYPTED_DOCUMENT_ERROR.to_string());
    }

    let ncx_path = spine_toc_id
        .and_then(|id| manifest.get(&id).map(|item| item.href.clone()))
        .or_else(|| {
            manifest
                .values()
                .find(|item| item.media_type.as_deref() == Some("application/x-dtbncx+xml"))
                .map(|item| item.href.clone())
        });
    if ncx_path
        .as_ref()
        .map(|path| encrypted_paths.contains(path))
        .unwrap_or(false)
    {
        return Err(ENCRYPTED_DOCUMENT_ERROR.to_string());
    }

    let nav_labels = read_epub_nav_items(archive, nav_path.as_deref(), ncx_path.as_deref())?;
    let mut nav_label_by_href = HashMap::new();
    for item in &nav_labels {
        nav_label_by_href
            .entry(normalize_epub_href(&item.href))
            .or_insert_with(|| item.title.clone());
    }
    let mut chapters = Vec::new();

    for (index, idref) in spine_ids.iter().enumerate() {
        let Some(item) = manifest.get(idref) else {
            continue;
        };
        if encrypted_paths.contains(&item.href) {
            return Err(ENCRYPTED_DOCUMENT_ERROR.to_string());
        }
        let href = item.href.clone();
        let label = nav_label_by_href
            .get(&href)
            .cloned()
            .unwrap_or_else(|| format!("Chapter {}", index + 1));

        chapters.push(EpubChapterMetadataDto {
            id: idref.clone(),
            href,
            label,
            index,
        });
    }

    let chapter_indexes: HashMap<String, usize> = chapters
        .iter()
        .map(|chapter| (chapter.href.clone(), chapter.index))
        .collect();
    let outline = nav_labels
        .into_iter()
        .enumerate()
        .map(|(index, item)| EpubOutlineItemDto {
            id: format!("outline-{}-{}", index, item.href),
            title: item.title,
            index: chapter_indexes
                .get(&normalize_epub_href(&item.href))
                .copied(),
            href: item.href,
            level: item.level,
        })
        .collect();
    let resources = manifest
        .values()
        .map(|item| EpubManifestResourceDto {
            id: item.id.clone(),
            href: item.href.clone(),
            media_type: item.media_type.clone(),
            properties: item.properties.clone(),
            spine: spine_ids.iter().any(|idref| idref == &item.id),
            encrypted: encrypted_paths.contains(&item.href),
        })
        .collect();

    Ok(EpubPackage {
        title,
        chapters,
        outline,
        resources,
    })
}

fn read_epub_nav_items(
    archive: &mut ZipArchive<fs::File>,
    nav_path: Option<&str>,
    ncx_path: Option<&str>,
) -> Result<Vec<NavItem>, String> {
    if let Some(path) = nav_path {
        if let Ok(nav) = read_zip_text(archive, path) {
            let nav_items = parse_epub_nav(path, &nav);
            if !nav_items.is_empty() {
                return Ok(nav_items);
            }
        }
    }

    if let Some(path) = ncx_path {
        if let Ok(ncx) = read_zip_text(archive, path) {
            return Ok(parse_epub_ncx(path, &ncx));
        }
    }

    Ok(Vec::new())
}

fn split_epub_properties(properties: &str) -> Vec<String> {
    properties
        .split_whitespace()
        .filter(|property| !property.is_empty())
        .map(ToString::to_string)
        .collect()
}

fn chapter_resource_metadata(
    chapter_href: &str,
    chapter_html: &str,
    resources: &[EpubManifestResourceDto],
) -> Vec<EpubManifestResourceDto> {
    let referenced_hrefs = referenced_epub_resource_hrefs(chapter_href, chapter_html);

    resources
        .iter()
        .filter(|resource| !resource.spine && referenced_hrefs.contains(&resource.href))
        .cloned()
        .collect()
}

fn referenced_epub_resource_hrefs(chapter_href: &str, chapter_html: &str) -> Vec<String> {
    let base_path = epub_base_path(chapter_href);
    let mut reader = xml_reader(chapter_html);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;
    let mut hrefs = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) | Ok(Event::Empty(start)) => {
                collect_epub_resource_attrs(&base_path, &start, &mut hrefs);
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    hrefs
}

fn collect_epub_resource_attrs(base_path: &str, start: &BytesStart<'_>, hrefs: &mut Vec<String>) {
    for attribute in start.attributes().with_checks(false).flatten() {
        let name = xml_name(attribute.key.as_ref());
        let Ok(value) = attribute.unescape_value() else {
            continue;
        };
        let value = value.trim();

        match name {
            "href" | "poster" | "src" => push_epub_resource_href(base_path, value, hrefs),
            "srcset" => {
                for candidate in value.split(',') {
                    let candidate = candidate.split_whitespace().next().unwrap_or("");
                    push_epub_resource_href(base_path, candidate, hrefs);
                }
            }
            _ => {}
        }
    }
}

fn push_epub_resource_href(base_path: &str, href: &str, hrefs: &mut Vec<String>) {
    let href = href.trim();
    if href.is_empty() || href.starts_with('#') || has_epub_href_scheme(href) {
        return;
    }

    let path = resolve_epub_path(base_path, href.split('#').next().unwrap_or(""));
    if !path.is_empty() && !hrefs.contains(&path) {
        hrefs.push(path);
    }
}

fn has_epub_href_scheme(href: &str) -> bool {
    let scheme_end = href.find(':');
    let path_start = match (href.find('/'), href.find('#')) {
        (Some(slash), Some(fragment)) => Some(slash.min(fragment)),
        (Some(slash), None) => Some(slash),
        (None, Some(fragment)) => Some(fragment),
        (None, None) => None,
    };

    match (scheme_end, path_start) {
        (Some(scheme_end), Some(path_start)) => scheme_end < path_start,
        (Some(_), None) => true,
        _ => false,
    }
}

fn parse_epub_nav(nav_path: &str, nav_text: &str) -> Vec<NavItem> {
    let base_path = epub_base_path(nav_path);
    let mut reader = xml_reader(nav_text);
    let mut nav_items = Vec::new();
    let mut active_href: Option<String> = None;
    let mut active_text = String::new();
    let mut list_depth = 0usize;

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) if tag_matches(start.name().as_ref(), "ol") => {
                list_depth += 1;
            }
            Ok(Event::End(end)) if tag_matches(end.name().as_ref(), "ol") => {
                list_depth = list_depth.saturating_sub(1);
            }
            Ok(Event::Start(start)) if tag_matches(start.name().as_ref(), "a") => {
                active_href = xml_attr(&start, "href")
                    .map(|href| resolve_epub_href(&base_path, &href))
                    .filter(|href| !href.is_empty());
                active_text.clear();
            }
            Ok(Event::Text(text)) if active_href.is_some() => {
                active_text.push_str(text.decode().unwrap_or_default().as_ref());
            }
            Ok(Event::End(end)) if tag_matches(end.name().as_ref(), "a") => {
                if let Some(href) = active_href.take() {
                    let title = normalize_whitespace(&active_text);
                    if !title.is_empty() {
                        nav_items.push(NavItem {
                            href,
                            title,
                            level: list_depth.saturating_sub(1),
                        });
                    }
                }
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    nav_items
}

fn parse_epub_ncx(ncx_path: &str, ncx_text: &str) -> Vec<NavItem> {
    let base_path = epub_base_path(ncx_path);
    let mut reader = xml_reader(ncx_text);
    let mut nav_items = Vec::new();
    let mut points = Vec::<NcxPoint>::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) if tag_matches(start.name().as_ref(), "navPoint") => {
                let level = points.len().saturating_sub(1);
                emit_ncx_point(points.last_mut(), level, &mut nav_items);
                points.push(NcxPoint::default());
            }
            Ok(Event::Start(start)) | Ok(Event::Empty(start))
                if tag_matches(start.name().as_ref(), "content") =>
            {
                let level = points.len().saturating_sub(1);
                if let Some(point) = points.last_mut() {
                    point.href = xml_attr(&start, "src")
                        .map(|href| resolve_epub_href(&base_path, &href))
                        .filter(|href| !href.is_empty());
                    emit_ncx_point(Some(point), level, &mut nav_items);
                }
            }
            Ok(Event::Start(start)) if tag_matches(start.name().as_ref(), "text") => {
                if let Some(point) = points.last_mut() {
                    point.in_label = true;
                    point.title.clear();
                }
            }
            Ok(Event::Text(text)) => {
                if let Some(point) = points.last_mut() {
                    if point.in_label {
                        point
                            .title
                            .push_str(text.decode().unwrap_or_default().as_ref());
                    }
                }
            }
            Ok(Event::End(end)) if tag_matches(end.name().as_ref(), "text") => {
                let level = points.len().saturating_sub(1);
                if let Some(point) = points.last_mut() {
                    point.in_label = false;
                    emit_ncx_point(Some(point), level, &mut nav_items);
                }
            }
            Ok(Event::End(end)) if tag_matches(end.name().as_ref(), "navPoint") => {
                let level = points.len().saturating_sub(1);
                if let Some(point) = points.last_mut() {
                    emit_ncx_point(Some(point), level, &mut nav_items);
                }
                points.pop();
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    nav_items
}

// NCX navPoints can nest; emit each point as soon as its own href and label are complete.
fn emit_ncx_point(point: Option<&mut NcxPoint>, level: usize, nav_items: &mut Vec<NavItem>) {
    let Some(point) = point else {
        return;
    };
    if point.emitted {
        return;
    }
    let Some(href) = point.href.clone() else {
        return;
    };
    let title = normalize_whitespace(&point.title);
    if title.is_empty() {
        return;
    }

    point.emitted = true;
    nav_items.push(NavItem { href, title, level });
}

fn sanitize_epub_html(html: &str) -> String {
    let mut reader = xml_reader(html);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = false;
    let mut sanitized = String::new();
    let mut skip_depth = 0usize;
    let mut emitted_tags = Vec::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) => {
                let name = start.name();
                let tag = xml_name(name.as_ref());
                if should_remove_tag_only(tag) {
                    continue;
                }
                if should_remove_with_contents(tag) {
                    skip_depth += 1;
                    continue;
                }
                if skip_depth > 0 {
                    continue;
                }
                if is_allowed_epub_tag(tag) {
                    push_start_tag(&mut sanitized, tag, &start);
                    emitted_tags.push(tag.to_string());
                }
            }
            Ok(Event::Empty(start)) => {
                let name = start.name();
                let tag = xml_name(name.as_ref());
                if skip_depth == 0 && is_allowed_epub_tag(tag) {
                    push_start_tag(&mut sanitized, tag, &start);
                    sanitized.push_str("</");
                    sanitized.push_str(tag);
                    sanitized.push('>');
                }
            }
            Ok(Event::End(end)) => {
                let name = end.name();
                let tag = xml_name(name.as_ref());
                if skip_depth > 0 {
                    if should_remove_with_contents(tag) {
                        skip_depth -= 1;
                    }
                    continue;
                }
                if emitted_tags.last().map(|last| last == tag).unwrap_or(false) {
                    emitted_tags.pop();
                    sanitized.push_str("</");
                    sanitized.push_str(tag);
                    sanitized.push('>');
                }
            }
            Ok(Event::Text(text)) if skip_depth == 0 => {
                sanitized.push_str(&escape_html(text.decode().unwrap_or_default().as_ref()));
            }
            Ok(Event::CData(text)) if skip_depth == 0 => {
                sanitized.push_str(&escape_html(text.decode().unwrap_or_default().as_ref()));
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    sanitized
}

fn push_start_tag(output: &mut String, tag: &str, start: &BytesStart<'_>) {
    output.push('<');
    output.push_str(tag);

    for attribute in start.attributes().with_checks(false).flatten() {
        let name = xml_name(attribute.key.as_ref());
        let Ok(value) = attribute.unescape_value() else {
            continue;
        };
        let value = value.trim();

        if name.starts_with("on") || name == "style" || name == "src" || name == "srcset" {
            continue;
        }

        if tag == "a" && name == "href" {
            if is_safe_epub_href(value) {
                output.push_str(" href=\"");
                output.push_str(&escape_html_attr(value));
                output.push_str("\" rel=\"noreferrer noopener\"");
            }
            continue;
        }

        if is_allowed_global_attr(name) {
            output.push(' ');
            output.push_str(name);
            output.push_str("=\"");
            output.push_str(&escape_html_attr(value));
            output.push('"');
        }
    }

    output.push('>');
}

fn text_from_sanitized_html(html: &str) -> String {
    let mut reader = xml_reader(html);
    let mut text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Text(value)) => {
                text.push_str(value.decode().unwrap_or_default().as_ref());
                text.push(' ');
            }
            Ok(Event::CData(value)) => {
                text.push_str(value.decode().unwrap_or_default().as_ref());
                text.push(' ');
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    normalize_whitespace(&text)
}

fn xml_reader(content: &str) -> Reader<&[u8]> {
    let mut reader = Reader::from_str(content);
    reader.config_mut().trim_text(true);
    reader.config_mut().allow_dangling_amp = true;
    reader
}

fn xml_attr(start: &BytesStart<'_>, name: &str) -> Option<String> {
    start
        .attributes()
        .with_checks(false)
        .flatten()
        .find(|attribute| tag_matches(attribute.key.as_ref(), name))
        .and_then(|attribute| {
            attribute
                .unescape_value()
                .ok()
                .map(|value| value.into_owned())
        })
}

fn tag_matches(name: &[u8], expected: &str) -> bool {
    xml_name(name) == expected
}

fn xml_name(name: &[u8]) -> &str {
    std::str::from_utf8(name)
        .unwrap_or("")
        .rsplit(':')
        .next()
        .unwrap_or("")
}

fn epub_base_path(path: &str) -> String {
    path.rsplit_once('/')
        .map(|(base, _)| format!("{base}/"))
        .unwrap_or_default()
}

fn resolve_epub_path(base_path: &str, href: &str) -> String {
    let parts = format!("{base_path}{href}");
    let mut resolved = Vec::new();

    for part in parts.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }

        if part == ".." {
            resolved.pop();
            continue;
        }

        resolved.push(part);
    }

    resolved.join("/")
}

// Outline hrefs keep anchors, while chapter lookup normalizes back to the base file path.
fn resolve_epub_href(base_path: &str, href: &str) -> String {
    let (path, fragment) = href.split_once('#').unwrap_or((href, ""));
    let resolved = resolve_epub_path(base_path, path);
    if resolved.is_empty() {
        return resolved;
    }
    if fragment.is_empty() {
        resolved
    } else {
        format!("{resolved}#{fragment}")
    }
}

fn normalize_epub_href(href: &str) -> String {
    resolve_epub_path("", href.split('#').next().unwrap_or(""))
}

fn is_safe_epub_href(value: &str) -> bool {
    value.trim().starts_with('#')
}

fn is_allowed_global_attr(name: &str) -> bool {
    matches!(
        name,
        "aria-label" | "aria-hidden" | "dir" | "id" | "lang" | "title"
    )
}

fn is_allowed_epub_tag(tag: &str) -> bool {
    matches!(
        tag,
        "a" | "abbr"
            | "article"
            | "aside"
            | "b"
            | "blockquote"
            | "br"
            | "caption"
            | "cite"
            | "code"
            | "dd"
            | "del"
            | "dfn"
            | "div"
            | "dl"
            | "dt"
            | "em"
            | "figcaption"
            | "figure"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "hr"
            | "i"
            | "ins"
            | "li"
            | "main"
            | "mark"
            | "ol"
            | "p"
            | "pre"
            | "q"
            | "s"
            | "section"
            | "small"
            | "span"
            | "strong"
            | "sub"
            | "sup"
            | "table"
            | "tbody"
            | "td"
            | "tfoot"
            | "th"
            | "thead"
            | "tr"
            | "u"
            | "ul"
    )
}

fn should_remove_with_contents(tag: &str) -> bool {
    matches!(
        tag,
        "applet"
            | "audio"
            | "canvas"
            | "embed"
            | "form"
            | "frame"
            | "frameset"
            | "head"
            | "iframe"
            | "noscript"
            | "object"
            | "picture"
            | "script"
            | "select"
            | "style"
            | "svg"
            | "textarea"
            | "title"
            | "video"
    )
}

fn should_remove_tag_only(tag: &str) -> bool {
    matches!(tag, "img" | "input" | "link" | "meta" | "source")
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn escape_html_attr(value: &str) -> String {
    escape_html(value).replace('\'', "&#39;")
}

fn normalize_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn snippet_around(text: &str, match_index: usize, query_len: usize) -> String {
    let start = previous_char_boundary(text, match_index.saturating_sub(40));
    let end = next_char_boundary(text, (match_index + query_len + 60).min(text.len()));

    text[start..end].to_string()
}

fn previous_char_boundary(text: &str, mut index: usize) -> usize {
    while index > 0 && !text.is_char_boundary(index) {
        index -= 1;
    }

    index
}

fn next_char_boundary(text: &str, mut index: usize) -> usize {
    while index < text.len() && !text.is_char_boundary(index) {
        index += 1;
    }

    index
}

#[derive(Clone)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: Option<String>,
    properties: Vec<String>,
}

#[derive(Clone)]
struct NavItem {
    href: String,
    title: String,
    level: usize,
}

#[derive(Default)]
struct NcxPoint {
    href: Option<String>,
    title: String,
    in_label: bool,
    emitted: bool,
}

pub fn run() {
    let startup_files = PendingOpenFiles::new(startup_open_files());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(startup_files)
        .invoke_handler(tauri::generate_handler![
            pending_open_files,
            read_document,
            open_pdf_document,
            get_pdfkit_annotation_capabilities,
            sync_pdfkit_annotations,
            open_epub_document,
            read_epub_chapter,
            search_epub_document,
            create_epub_anchor,
            resolve_epub_anchor,
            rebind_epub_anchor,
            get_cache_info,
            load_smartreader_cache,
            save_smartreader_cache,
            set_cache_location,
            export_smartreader_cache,
            import_smartreader_cache
        ])
        .build(tauri::generate_context!())
        .expect("error while building SmartReader")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = opened_urls_to_paths(&urls);

                if paths.is_empty() {
                    return;
                }

                if let Some(state) = app_handle.try_state::<PendingOpenFiles>() {
                    state.push_all(&paths);
                }

                for path in paths {
                    let _ = app_handle.emit(OPEN_FILE_EVENT, path);
                }
            }
        });
}

fn startup_open_files() -> Vec<String> {
    env::args()
        .skip(1)
        .filter_map(|path| open_arg_to_path(&path))
        .collect()
}

fn open_arg_to_path(path: &str) -> Option<String> {
    if let Ok(url) = tauri::Url::parse(path) {
        return opened_url_to_path(&url);
    }

    let document_path = PathBuf::from(path);

    if is_supported_document_path(&document_path) {
        Some(document_path.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn opened_urls_to_paths(urls: &[tauri::Url]) -> Vec<String> {
    urls.iter().filter_map(opened_url_to_path).collect()
}

fn opened_url_to_path(url: &tauri::Url) -> Option<String> {
    if url.scheme() != "file" {
        return None;
    }

    let path = url.to_file_path().ok()?;

    if is_supported_document_path(&path) {
        Some(path.to_string_lossy().into_owned())
    } else {
        None
    }
}

fn is_supported_document_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };

    extension.eq_ignore_ascii_case("pdf") || extension.eq_ignore_ascii_case("epub")
}

fn is_supported_epub_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };

    extension.eq_ignore_ascii_case("epub")
}

fn is_supported_pdf_path(path: &Path) -> bool {
    let Some(extension) = path.extension().and_then(|extension| extension.to_str()) else {
        return false;
    };

    extension.eq_ignore_ascii_case("pdf")
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{
        content::{Content, Operation},
        dictionary, Bookmark, Document as TestPdfDocument, Stream,
    };
    use std::io::Write;

    #[test]
    fn opened_urls_to_paths_accepts_supported_file_urls() {
        let urls = vec![
            tauri::Url::parse("file:///Users/mario/Books/Guide.pdf").unwrap(),
            tauri::Url::parse("file:///Users/mario/Books/Story.epub").unwrap(),
            tauri::Url::parse("file:///Users/mario/book/%E7%BC%96%E7%A8%8B%E4%B9%A6%E7%B1%8D&%E5%90%8E%E5%8F%B0%E5%BC%80%E5%8F%91/DevOpsAndOS/vSphere/vmware_vsphere_7_0%E8%99%9A%E6%8B%9F%E5%8C%96%E6%9E%B6%E6%9E%84%E5%AE%9E%E6%88%98%E6%8C%87%E5%8D%97_%E6%93%8D%E4%BD%9C%E7%B3%BB%E7%BB%9F_%E4%BD%95%E5%9D%A4%E6%BA%90_Z_Library.pdf").unwrap(),
        ];

        assert_eq!(
            opened_urls_to_paths(&urls),
            vec![
                "/Users/mario/Books/Guide.pdf".to_string(),
                "/Users/mario/Books/Story.epub".to_string(),
                "/Users/mario/book/编程书籍&后台开发/DevOpsAndOS/vSphere/vmware_vsphere_7_0虚拟化架构实战指南_操作系统_何坤源_Z_Library.pdf".to_string()
            ]
        );
    }

    #[test]
    fn opened_urls_to_paths_skips_unsupported_or_non_file_urls() {
        let urls = vec![
            tauri::Url::parse("https://example.com/Guide.pdf").unwrap(),
            tauri::Url::parse("file:///Users/mario/Books/notes.txt").unwrap(),
        ];

        assert!(opened_urls_to_paths(&urls).is_empty());
    }

    #[test]
    fn read_supported_document_reads_document_bytes() {
        let path = test_path("guide.pdf");
        fs::write(&path, b"%PDF-1.7\nbody").unwrap();

        let result = read_supported_document(path.clone()).unwrap();

        assert_eq!(result, b"%PDF-1.7\nbody");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_supported_document_rejects_unsupported_extensions_before_opening() {
        let path = test_path("guide.txt");

        let result = read_supported_document(path);

        assert_eq!(result, Err("Unsupported document format".to_string()));
    }

    #[test]
    fn read_supported_document_rejects_directory_paths() {
        let path = test_path("folder.pdf");
        fs::create_dir_all(&path).unwrap();

        let result = read_supported_document(path.clone());

        assert_eq!(
            result,
            Err(
                "SmartReader cannot access this file path. Choose the file again to reopen it."
                    .to_string()
            )
        );
        fs::remove_dir(path).unwrap();
    }

    #[test]
    fn open_pdf_document_extracts_page_count_and_full_outline() {
        let path = test_path("outline.pdf");
        write_test_pdf(&path, &["Intro body", "Later body"], true).unwrap();

        let document = open_pdf_document_from_path(path.clone()).unwrap();

        assert_eq!(document.page_count, 2);
        assert_eq!(document.outline.len(), 2);
        assert_eq!(document.outline[0].title, "Intro");
        assert_eq!(document.outline[0].page, 1);
        assert_eq!(document.outline[1].title, "Later chapter");
        assert_eq!(document.outline[1].page, 2);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_pdf_document_returns_access_error_for_malformed_pdf() {
        let path = test_path("malformed.pdf");
        fs::write(&path, b"not a pdf").unwrap();

        let result = open_pdf_document_from_path(path.clone());

        assert_eq!(result.unwrap_err(), DOCUMENT_ACCESS_ERROR);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn pdfkit_annotation_capabilities_reports_native_support_matrix() {
        let capabilities = pdfkit_annotation_capabilities();

        assert_eq!(capabilities.write_modes, vec!["copy"]);
        assert!(capabilities
            .annotations
            .iter()
            .any(|item| item.kind == PdfAnnotationKind::Area && item.supported));
        assert!(capabilities
            .annotations
            .iter()
            .any(|item| item.kind == PdfAnnotationKind::Note && item.supported));
        assert!(capabilities.annotations.iter().any(|item| {
            item.kind == PdfAnnotationKind::Highlight && item.supported && item.multi_rect
        }));
        assert!(capabilities.annotations.iter().any(|item| {
            item.kind == PdfAnnotationKind::Underline && item.supported && item.multi_rect
        }));
        assert!(capabilities.annotations.iter().any(|item| {
            item.kind == PdfAnnotationKind::Strike && item.supported && item.multi_rect
        }));
        assert!(capabilities.annotations.iter().any(|item| {
            item.kind == PdfAnnotationKind::Wavy
                && !item.supported
                && item.reason.as_deref() == Some("unsupported-native-mapping")
        }));
        assert!(capabilities.annotations.iter().any(|item| {
            item.kind == PdfAnnotationKind::RedText
                && !item.supported
                && item.reason.as_deref() == Some("unsupported-native-mapping")
        }));
    }

    #[test]
    fn sync_pdfkit_annotations_rejects_unsupported_native_styles_explicitly() {
        let result = validate_pdfkit_annotation_sync_request(&PdfKitAnnotationSyncRequest {
            write_mode: PdfAnnotationWriteMode::Copy,
            managed_copy_path: None,
            annotations: vec![PdfKitAnnotationSyncItem {
                id: "annotation-wavy".to_string(),
                operation: PdfKitAnnotationOperation::Upsert,
                page: 1,
                kind: PdfAnnotationKind::Wavy,
                color: "#ff0000".to_string(),
                thickness: Some(2.0),
                note: None,
                rects: vec![valid_pdf_annotation_rect()],
            }],
        });

        assert_eq!(result.unwrap_err(), "Unsupported PDFKit annotation kind");
    }

    #[test]
    fn sync_pdfkit_annotations_accepts_multirect_markup_contract() {
        let result = validate_pdfkit_annotation_sync_request(&PdfKitAnnotationSyncRequest {
            write_mode: PdfAnnotationWriteMode::Copy,
            managed_copy_path: None,
            annotations: vec![PdfKitAnnotationSyncItem {
                id: "annotation-highlight".to_string(),
                operation: PdfKitAnnotationOperation::Upsert,
                page: 1,
                kind: PdfAnnotationKind::Highlight,
                color: "#ffcc00".to_string(),
                thickness: Some(2.0),
                note: Some("markup note".to_string()),
                rects: vec![
                    valid_pdf_annotation_rect(),
                    PdfAnnotationRect {
                        x: 10.0,
                        y: 60.0,
                        width: 80.0,
                        height: 20.0,
                    },
                ],
            }],
        });

        assert!(result.is_ok());
    }

    #[test]
    fn sync_pdfkit_annotations_reports_managed_copy_result_without_touching_source() {
        let path = test_path("annotation-sync.pdf");
        write_test_pdf(&path, &["Annotation body"], false).unwrap();
        let source_bytes = fs::read(&path).unwrap();

        let result = sync_pdfkit_annotations_from_path(
            path.clone(),
            PdfKitAnnotationSyncRequest {
                write_mode: PdfAnnotationWriteMode::Copy,
                managed_copy_path: None,
                annotations: vec![PdfKitAnnotationSyncItem {
                    id: "annotation-area".to_string(),
                    operation: PdfKitAnnotationOperation::Upsert,
                    page: 1,
                    kind: PdfAnnotationKind::Area,
                    color: "#ffcc00".to_string(),
                    thickness: Some(2.0),
                    note: Some("Review".to_string()),
                    rects: vec![valid_pdf_annotation_rect()],
                }],
            },
        )
        .unwrap();

        if cfg!(target_os = "macos") {
            assert!(result.supported);
            assert_eq!(result.status, "synced");
            assert_ne!(result.managed_copy_path, path.to_string_lossy());
            assert_eq!(result.annotations[0].id, "annotation-area");
            assert_eq!(result.annotations[0].status, "upserted");
            fs::remove_file(&result.managed_copy_path).unwrap();
        } else {
            assert!(!result.supported);
            assert_eq!(result.status, "unsupported-platform");
        }

        assert_eq!(fs::read(&path).unwrap(), source_bytes);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn sync_pdfkit_annotations_ignores_unsafe_managed_copy_path() {
        let path = test_path("annotation-sync-source.pdf");
        let hostile_path = test_path("annotation-sync-victim.pdf");
        let managed_copy_dir = test_path("annotation-sync-managed-root");
        write_test_pdf(&path, &["Annotation body"], false).unwrap();
        write_test_pdf(&hostile_path, &["Victim body"], false).unwrap();
        let hostile_bytes = fs::read(&hostile_path).unwrap();

        let result = sync_pdfkit_annotations_from_path_with_managed_copy_dir(
            path.clone(),
            PdfKitAnnotationSyncRequest {
                write_mode: PdfAnnotationWriteMode::Copy,
                managed_copy_path: Some(hostile_path.to_string_lossy().into_owned()),
                annotations: vec![PdfKitAnnotationSyncItem {
                    id: "annotation-area".to_string(),
                    operation: PdfKitAnnotationOperation::Upsert,
                    page: 1,
                    kind: PdfAnnotationKind::Area,
                    color: "#ffcc00".to_string(),
                    thickness: Some(2.0),
                    note: Some("Review".to_string()),
                    rects: vec![valid_pdf_annotation_rect()],
                }],
            },
            managed_copy_dir.clone(),
        )
        .unwrap();

        assert_ne!(result.managed_copy_path, hostile_path.to_string_lossy());
        assert!(Path::new(&result.managed_copy_path).starts_with(&managed_copy_dir));
        assert_eq!(fs::read(&hostile_path).unwrap(), hostile_bytes);

        fs::remove_file(path).unwrap();
        fs::remove_file(hostile_path).unwrap();
        let _ = fs::remove_file(result.managed_copy_path);
        let _ = fs::remove_dir_all(managed_copy_dir);
    }

    #[test]
    fn open_epub_document_extracts_manifest_spine_and_nav() {
        let path = test_path("book.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        let document = open_epub_document_from_path(path.clone()).unwrap();

        assert_eq!(document.title, Some("Rust Reader".to_string()));
        assert_eq!(document.chapters.len(), 2);
        assert_eq!(document.chapters[0].href, "OPS/chapter-one.xhtml");
        assert_eq!(document.chapters[0].label, "Opening");
        assert_eq!(document.chapters[1].href, "OPS/chapter-two.xhtml");
        assert_eq!(document.chapters[1].label, "Chapter 2");
        assert_eq!(document.outline.len(), 2);
        assert_eq!(document.outline[0].title, "Opening");
        assert_eq!(document.outline[0].href, "OPS/chapter-one.xhtml");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_epub_document_returns_manifest_resource_metadata() {
        let path = test_path("resources.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                include_extra_resource: true,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let document = open_epub_document_from_path(path.clone()).unwrap();

        let cover = document
            .resources
            .iter()
            .find(|resource| resource.id == "cover-image")
            .unwrap();
        assert_eq!(cover.href, "OPS/images/cover.png");
        assert_eq!(cover.media_type.as_deref(), Some("image/png"));
        assert!(!cover.spine);
        assert!(!cover.encrypted);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_epub_document_uses_ncx_when_epub3_nav_missing() {
        let path = test_path("ncx.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                include_nav: false,
                include_ncx: true,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let document = open_epub_document_from_path(path.clone()).unwrap();

        assert_eq!(document.chapters[0].label, "NCX Opening");
        assert_eq!(document.outline.len(), 2);
        assert_eq!(document.outline[0].title, "NCX Opening");
        assert_eq!(document.outline[0].href, "OPS/chapter-one.xhtml");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_epub_document_preserves_nav_fragments_and_outline_order() {
        let path = test_path("fragment-nav.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                fragmented_nav: true,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let document = open_epub_document_from_path(path.clone()).unwrap();

        assert_eq!(document.chapters[0].label, "Opening");
        assert_eq!(document.outline.len(), 3);
        assert_eq!(document.outline[0].title, "Opening");
        assert_eq!(document.outline[0].href, "OPS/chapter-one.xhtml#opening");
        assert_eq!(document.outline[0].index, Some(0));
        assert_eq!(document.outline[0].level, 0);
        assert_eq!(document.outline[1].title, "Opening detail");
        assert_eq!(document.outline[1].href, "OPS/chapter-one.xhtml#detail");
        assert_eq!(document.outline[1].index, Some(0));
        assert_eq!(document.outline[1].level, 1);
        assert_eq!(
            document.outline[2].href,
            "OPS/chapter-two.xhtml#chapter-two"
        );
        assert_eq!(document.outline[2].index, Some(1));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_epub_document_preserves_ncx_fragments_and_parent_before_child() {
        let path = test_path("fragment-ncx.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                include_nav: false,
                include_ncx: true,
                fragmented_ncx: true,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let document = open_epub_document_from_path(path.clone()).unwrap();

        assert_eq!(document.chapters[0].label, "NCX Opening");
        assert_eq!(document.outline.len(), 3);
        assert_eq!(document.outline[0].title, "NCX Opening");
        assert_eq!(document.outline[0].href, "OPS/chapter-one.xhtml#opening");
        assert_eq!(document.outline[0].index, Some(0));
        assert_eq!(document.outline[0].level, 0);
        assert_eq!(document.outline[1].title, "NCX Opening detail");
        assert_eq!(document.outline[1].href, "OPS/chapter-one.xhtml#detail");
        assert_eq!(document.outline[1].index, Some(0));
        assert_eq!(document.outline[1].level, 1);
        assert_eq!(
            document.outline[2].href,
            "OPS/chapter-two.xhtml#chapter-two"
        );
        assert_eq!(document.outline[2].index, Some(1));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_epub_document_rejects_rights_xml_as_encrypted_document() {
        let path = test_path("rights.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                include_rights: true,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let result = open_epub_document_from_path(path.clone());

        assert_eq!(result.unwrap_err(), ENCRYPTED_DOCUMENT_ERROR);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_epub_document_rejects_encrypted_spine_resource() {
        let path = test_path("encrypted-spine.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                encrypted_resources: vec!["OPS/chapter-one.xhtml"],
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let result = open_epub_document_from_path(path.clone());

        assert_eq!(result.unwrap_err(), ENCRYPTED_DOCUMENT_ERROR);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_epub_chapter_rejects_encrypted_chapter_resource() {
        let path = test_path("encrypted-chapter.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                encrypted_resources: vec!["OPS/chapter-two.xhtml"],
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let result = read_epub_chapter_from_path(path.clone(), "OPS/chapter-two.xhtml".to_string());

        assert_eq!(result.unwrap_err(), ENCRYPTED_DOCUMENT_ERROR);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_epub_chapter_reads_and_sanitizes_one_requested_chapter() {
        let path = test_path("chapter.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        let chapter =
            read_epub_chapter_from_path(path.clone(), "OPS/chapter-two.xhtml".to_string()).unwrap();

        assert_eq!(chapter.index, 1);
        assert_eq!(chapter.label, "Chapter 2");
        assert!(chapter.sanitized_html.contains("Second chapter"));
        assert!(!chapter.sanitized_html.contains("First chapter"));
        assert!(chapter.text.contains("Second chapter"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_epub_chapter_accepts_fragment_href() {
        let path = test_path("chapter-fragment.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        let chapter = read_epub_chapter_from_path(
            path.clone(),
            "OPS/chapter-two.xhtml#chapter-two".to_string(),
        )
        .unwrap();

        assert_eq!(chapter.href, "OPS/chapter-two.xhtml");
        assert_eq!(chapter.index, 1);
        assert!(chapter.text.contains("Second chapter"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_epub_chapter_returns_missing_chapter_error_when_archive_entry_is_unreadable() {
        let path = test_path("missing-chapter.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                omitted_chapters: vec!["OPS/chapter-two.xhtml"],
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let result = read_epub_chapter_from_path(path.clone(), "OPS/chapter-two.xhtml".to_string());

        assert_eq!(result.unwrap_err(), "Invalid EPUB: missing chapter");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn read_epub_chapter_returns_safe_resource_metadata() {
        let path = test_path("chapter-resources.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                include_extra_resource: true,
                include_chapter_resource_reference: true,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let chapter =
            read_epub_chapter_from_path(path.clone(), "OPS/chapter-one.xhtml".to_string()).unwrap();

        assert_eq!(chapter.resources.len(), 1);
        assert_eq!(chapter.resources[0].id, "cover-image");
        assert_eq!(chapter.resources[0].href, "OPS/images/cover.png");
        assert_eq!(
            chapter.resources[0].media_type.as_deref(),
            Some("image/png")
        );
        assert!(!chapter.resources[0].spine);
        assert!(!chapter.resources[0].encrypted);
        let chapter_json = serde_json::to_value(&chapter).unwrap();
        let resource = &chapter_json["resources"][0];
        assert!(resource.get("bytes").is_none());
        assert!(resource.get("payload").is_none());
        assert!(resource.get("rawPayload").is_none());
        assert!(resource.get("data").is_none());
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn search_epub_document_finds_text_in_later_chapter() {
        let path = test_path("search.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        let results =
            search_epub_document_from_path(path.clone(), "Second chapter".to_string()).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].label, "Chapter 2");
        assert_eq!(results[0].href, "OPS/chapter-two.xhtml");
        assert_eq!(results[0].index, 1);
        assert!(results[0].snippet.contains("Second chapter"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn search_epub_document_returns_all_matches_without_limit() {
        let path = test_path("search-all.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                chapter_count: 120,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let results = search_epub_document_from_path(path.clone(), "chapter".to_string()).unwrap();

        assert!(results.len() > 120);
        assert_eq!(results[0].href, "OPS/chapter-1.xhtml");
        assert_eq!(results.last().unwrap().href, "OPS/chapter-120.xhtml");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn search_epub_document_skips_unreadable_chapters() {
        let path = test_path("search-missing-chapter.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                omitted_chapters: vec!["OPS/chapter-two.xhtml"],
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let results = search_epub_document_from_path(path.clone(), "chapter".to_string()).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].href, "OPS/chapter-one.xhtml");
        assert!(results[0].snippet.contains("First chapter"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn search_epub_document_rejects_empty_query_without_reading_chapters() {
        let path = test_path("search-empty.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        assert!(
            search_epub_document_from_path(path.clone(), "   ".to_string())
                .unwrap()
                .is_empty()
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn create_epub_anchor_uses_occurrence_context_and_deterministic_hashes() {
        let path = test_path("anchor-duplicates.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                custom_chapter_texts: vec![
                    "Alpha repeat beta repeat gamma repeat delta".to_string(),
                    "Second chapter".to_string(),
                ],
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let first = create_epub_anchor_from_path(
            path.clone(),
            EpubAnchorCreateRequest {
                chapter_href: "OPS/chapter-one.xhtml".to_string(),
                selected_text: "repeat".to_string(),
                occurrence_index: Some(1),
                cfi_hint: Some("epubcfi(/6/2[legacy])".to_string()),
            },
        )
        .unwrap();
        let second = create_epub_anchor_from_path(
            path.clone(),
            EpubAnchorCreateRequest {
                chapter_href: "OPS/chapter-one.xhtml".to_string(),
                selected_text: "repeat".to_string(),
                occurrence_index: Some(1),
                cfi_hint: Some("epubcfi(/6/2[legacy])".to_string()),
            },
        )
        .unwrap();

        assert_eq!(first, second);
        assert_eq!(first.chapter_href, "OPS/chapter-one.xhtml");
        assert_eq!(first.selected_text, "repeat");
        assert_eq!(first.occurrence_index, 1);
        assert_eq!(first.prefix, "Opening Alpha repeat beta ");
        assert_eq!(first.suffix, " gamma repeat delta");
        assert!(first.text_hash.starts_with("fnv1a64:"));
        assert!(first.anchor_hash.starts_with("fnv1a64:"));
        assert_eq!(first.cfi_hint.as_deref(), Some("epubcfi(/6/2[legacy])"));

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn resolve_epub_anchor_is_authoritative_over_legacy_cfi_hint() {
        let path = test_path("anchor-resolve.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                custom_chapter_texts: vec![
                    "Alpha repeat beta repeat gamma repeat delta".to_string(),
                    "Second chapter".to_string(),
                ],
                ..TestEpubOptions::default()
            },
        )
        .unwrap();
        let anchor = create_epub_anchor_from_path(
            path.clone(),
            EpubAnchorCreateRequest {
                chapter_href: "OPS/chapter-one.xhtml".to_string(),
                selected_text: "repeat".to_string(),
                occurrence_index: Some(2),
                cfi_hint: Some("epubcfi(/wrong/legacy/hint)".to_string()),
            },
        )
        .unwrap();

        let resolved = resolve_epub_anchor_from_path(
            path.clone(),
            EpubAnchorResolveRequest {
                anchor: anchor.clone(),
            },
        )
        .unwrap();

        assert_eq!(resolved.status, "resolved");
        assert_eq!(resolved.anchor, anchor);
        assert_eq!(resolved.selected_text, "repeat");
        assert_eq!(resolved.occurrence_index, 2);

        fs::remove_file(path).unwrap();
    }

    #[test]
    fn rebind_epub_anchor_uses_context_when_occurrence_shifts() {
        let original = "Alpha repeat beta repeat gamma repeat delta";
        let changed = "Inserted repeat Alpha repeat beta repeat gamma repeat delta";
        let anchor =
            create_epub_text_anchor("OPS/chapter-one.xhtml", original, "repeat", Some(1), None)
                .unwrap();

        let rebound = rebind_epub_text_anchor(&anchor, changed).unwrap();

        assert_eq!(rebound.status, "rebound");
        assert_eq!(rebound.anchor.occurrence_index, 2);
        assert_eq!(rebound.selected_text, "repeat");
        assert!(rebound.anchor.prefix.ends_with("Alpha repeat beta "));
        assert_eq!(rebound.anchor.suffix, " gamma repeat delta");
    }

    #[test]
    fn validate_cache_envelope_rejects_non_object_or_wrong_schema() {
        assert!(validate_cache_envelope(&serde_json::json!(null)).is_err());
        assert!(validate_cache_envelope(&serde_json::json!({"schemaVersion": 2})).is_err());
        assert!(validate_cache_envelope(&serde_json::json!({"schemaVersion": 1})).is_err());
        assert!(validate_cache_envelope(&serde_json::json!({
            "schemaVersion": 1,
            "pdfBytes": []
        }))
        .is_err());
        assert!(validate_cache_envelope(&valid_test_cache()).is_ok());
    }

    #[test]
    fn validate_cache_envelope_rejects_dangerous_nested_payloads() {
        let mut object_url_cache = valid_test_cache();
        object_url_cache["session"]["tabs"][0]["objectUrl"] = serde_json::json!("blob:document");
        assert!(validate_cache_envelope(&object_url_cache).is_err());

        let mut raw_text_cache = valid_test_cache();
        raw_text_cache["adapterCache"]["searchIndexes"][0]["rawText"] =
            serde_json::json!("full extracted document body");
        assert!(validate_cache_envelope(&raw_text_cache).is_err());

        let mut pdf_proxy_cache = valid_test_cache();
        pdf_proxy_cache["adapterCache"]["pdfProxy"] = serde_json::json!({"pages": []});
        assert!(validate_cache_envelope(&pdf_proxy_cache).is_err());
    }

    #[test]
    fn validate_cache_envelope_rejects_invalid_required_field_shapes() {
        let mut missing_tabs_cache = valid_test_cache();
        missing_tabs_cache["session"] = serde_json::json!({});
        assert!(validate_cache_envelope(&missing_tabs_cache).is_err());

        let mut invalid_progress_cache = valid_test_cache();
        invalid_progress_cache["readingProgress"] = serde_json::json!({});
        assert!(validate_cache_envelope(&invalid_progress_cache).is_err());

        let mut invalid_indexes_cache = valid_test_cache();
        invalid_indexes_cache["adapterCache"] = serde_json::json!({});
        assert!(validate_cache_envelope(&invalid_indexes_cache).is_err());
    }

    #[test]
    fn validate_cache_directory_rejects_file_paths() {
        let path = test_path("cache-file");
        fs::write(&path, b"not a directory").unwrap();

        let result = ensure_writable_directory(&path);

        assert_eq!(
            result.unwrap_err(),
            "SmartReader cache path must be a directory"
        );
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn save_and_load_cache_round_trip_valid_schema() {
        let root = test_path("cache-round-trip");
        let paths = test_cache_paths(&root);
        let cache = valid_test_cache();

        let saved = save_cache_to_paths(&paths, cache.clone()).unwrap();
        let loaded = load_cache_from_paths(&paths).unwrap();

        assert!(saved.saved_at > 0);
        assert_eq!(loaded.cache, Some(cache));
        assert_eq!(loaded.info.schema_version, 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_and_import_cache_validate_schema_and_apply_when_requested() {
        let root = test_path("cache-import-export");
        let paths = test_cache_paths(&root);
        let source_cache = valid_test_cache();
        save_cache_to_paths(&paths, source_cache.clone()).unwrap();
        let export_path = root.join("backup").join("smartreader-cache.json");

        let exported = export_cache_from_paths(&paths, export_path.clone(), None).unwrap();
        let imported = import_cache_from_paths(&paths, export_path, true).unwrap();

        assert!(exported.bytes_written > 0);
        assert_eq!(imported.cache, source_cache);
        assert!(imported.applied);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn export_and_import_cache_preserves_annotations_payload() {
        let root = test_path("cache-annotations");
        let paths = test_cache_paths(&root);
        let mut source_cache = valid_test_cache();
        source_cache["session"]["tabs"][0]["annotations"] = serde_json::json!([
            {
                "id": "annotation-1",
                "type": "highlight",
                "tag": "重点",
                "color": "#ffd166",
                "thickness": 2,
                "location": {
                    "href": "OPS/chapter-one.xhtml#detail",
                    "start": 12,
                    "end": 20
                },
                "selectedText": "important text",
                "note": "reader note",
                "hidden": false,
                "createdAt": "2026-05-26T00:00:00Z",
                "updatedAt": "2026-05-26T00:00:00Z"
            }
        ]);
        save_cache_to_paths(&paths, source_cache.clone()).unwrap();
        let export_path = root.join("backup").join("smartreader-cache.json");

        export_cache_from_paths(&paths, export_path.clone(), None).unwrap();
        let imported = import_cache_from_paths(&paths, export_path, true).unwrap();

        assert_eq!(
            imported.cache["session"]["tabs"][0]["annotations"],
            source_cache["session"]["tabs"][0]["annotations"]
        );
        assert_eq!(
            read_cache_file(&paths.default_dir.join(CACHE_FILE_NAME)).unwrap(),
            source_cache
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_import_does_not_overwrite_existing_cache() {
        let root = test_path("cache-invalid-import");
        let paths = test_cache_paths(&root);
        let existing_cache = valid_test_cache();
        save_cache_to_paths(&paths, existing_cache.clone()).unwrap();
        let source_path = root.join("invalid-cache.json");
        fs::write(&source_path, r#"{"schemaVersion":1}"#).unwrap();

        let result = import_cache_from_paths(&paths, source_path, true);

        assert_eq!(result.unwrap_err(), CACHE_SCHEMA_ERROR);
        assert_eq!(
            read_cache_file(&paths.default_dir.join(CACHE_FILE_NAME)).unwrap(),
            existing_cache
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn set_cache_location_copies_existing_cache_without_removing_source() {
        let root = test_path("cache-move");
        let paths = test_cache_paths(&root);
        let cache = valid_test_cache();
        save_cache_to_paths(&paths, cache.clone()).unwrap();
        let new_dir = root.join("custom-cache");

        let result = set_cache_location_for_paths(&paths, new_dir.clone(), true).unwrap();

        assert!(result.moved);
        assert_eq!(result.active_path, new_dir.to_string_lossy());
        assert!(paths.default_dir.join(CACHE_FILE_NAME).exists());
        assert_eq!(
            read_cache_file(&new_dir.join(CACHE_FILE_NAME)).unwrap(),
            cache
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn set_cache_location_preserves_source_cache_when_move_fails() {
        let root = test_path("cache-move-fails");
        let paths = test_cache_paths(&root);
        let cache = valid_test_cache();
        save_cache_to_paths(&paths, cache.clone()).unwrap();
        let new_dir = root.join("blocked-cache");
        fs::create_dir_all(new_dir.join(CACHE_FILE_NAME)).unwrap();

        let result = set_cache_location_for_paths(&paths, new_dir, true);

        assert_eq!(result.unwrap_err(), CACHE_ACCESS_ERROR);
        assert_eq!(
            read_cache_file(&paths.default_dir.join(CACHE_FILE_NAME)).unwrap(),
            cache
        );
        assert!(read_custom_cache_location(&paths).unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn open_epub_document_rejects_unsupported_extensions_before_reading() {
        let path = test_path("book.txt");

        let result = open_epub_document_from_path(path);

        assert_eq!(result.unwrap_err(), "Unsupported document format");
    }

    #[test]
    fn open_epub_document_rejects_missing_container() {
        let path = test_path("missing-container.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                include_container: false,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let result = open_epub_document_from_path(path.clone());

        assert_eq!(result.unwrap_err(), "Invalid EPUB: missing container");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn open_epub_document_rejects_missing_package() {
        let path = test_path("missing-package.epub");
        write_test_epub(
            &path,
            TestEpubOptions {
                include_package: false,
                ..TestEpubOptions::default()
            },
        )
        .unwrap();

        let result = open_epub_document_from_path(path.clone());

        assert_eq!(result.unwrap_err(), "Invalid EPUB: missing package");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn sanitize_epub_html_strips_active_content() {
        let html = r##"
            <body onload="bad()">
                <script>alert(1)</script>
                <form><input value="x"></form>
                <iframe src="https://example.com"></iframe>
                <img src="cover.png" onerror="bad()">
                <a href="javascript:bad()">bad</a>
                <a href="#safe" onclick="bad()">safe</a>
                <p style="color:red" data-x="1">Text <strong>allowed</strong></p>
            </body>
        "##;

        let sanitized = sanitize_epub_html(html);

        assert!(!sanitized.contains("script"));
        assert!(!sanitized.contains("form"));
        assert!(!sanitized.contains("iframe"));
        assert!(!sanitized.contains("img"));
        assert!(!sanitized.contains("javascript:"));
        assert!(!sanitized.contains("onclick"));
        assert!(!sanitized.contains("style="));
        assert!(sanitized.contains("<a href=\"#safe\" rel=\"noreferrer noopener\">safe</a>"));
        assert!(sanitized.contains("<p>Text <strong>allowed</strong></p>"));
    }

    fn test_path(file_name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "smartreader-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            file_name
        ))
    }

    fn valid_pdf_annotation_rect() -> PdfAnnotationRect {
        PdfAnnotationRect {
            x: 10.0,
            y: 20.0,
            width: 120.0,
            height: 32.0,
        }
    }

    fn test_cache_paths(root: &Path) -> CachePaths {
        CachePaths {
            default_dir: root.join("default-cache"),
            state_dir: root.join("state"),
        }
    }

    fn valid_test_cache() -> serde_json::Value {
        serde_json::json!({
            "schemaVersion": 1,
            "appVersion": "0.1.0",
            "savedAt": "2026-05-23T00:00:00Z",
            "settings": {
                "theme": "dark"
            },
            "preferences": {
                "sidebarOpen": true
            },
            "recentFiles": [
                {
                    "path": "/tmp/book.pdf",
                    "title": "book.pdf"
                }
            ],
            "readingProgress": [
                {
                    "path": "/tmp/book.pdf",
                    "page": 2
                }
            ],
            "session": {
                "tabs": [
                    {
                        "path": "/tmp/book.pdf",
                        "title": "book.pdf"
                    }
                ],
                "activeTabId": "tab-1"
            },
            "adapterCache": {
                "searchIndexes": [
                    {
                        "path": "/tmp/book.pdf",
                        "pageCount": 3
                    }
                ]
            }
        })
    }

    struct TestEpubOptions {
        include_container: bool,
        include_package: bool,
        include_nav: bool,
        include_ncx: bool,
        include_rights: bool,
        include_extra_resource: bool,
        include_chapter_resource_reference: bool,
        encrypted_resources: Vec<&'static str>,
        omitted_chapters: Vec<&'static str>,
        chapter_count: usize,
        custom_chapter_texts: Vec<String>,
        fragmented_nav: bool,
        fragmented_ncx: bool,
    }

    impl Default for TestEpubOptions {
        fn default() -> Self {
            Self {
                include_container: true,
                include_package: true,
                include_nav: true,
                include_ncx: false,
                include_rights: false,
                include_extra_resource: false,
                include_chapter_resource_reference: false,
                encrypted_resources: Vec::new(),
                omitted_chapters: Vec::new(),
                chapter_count: 2,
                custom_chapter_texts: Vec::new(),
                fragmented_nav: false,
                fragmented_ncx: false,
            }
        }
    }

    fn write_test_epub(path: &Path, options: TestEpubOptions) -> io::Result<()> {
        let file = fs::File::create(path)?;
        let mut zip = zip::ZipWriter::new(file);
        let file_options = zip::write::SimpleFileOptions::default();

        if options.include_container {
            zip.start_file("META-INF/container.xml", file_options)?;
            zip.write_all(
                br#"<?xml version="1.0"?>
                <container version="1.0">
                    <rootfiles>
                        <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/>
                    </rootfiles>
                </container>"#,
            )?;
        }

        if options.include_package {
            zip.start_file("OPS/package.opf", file_options)?;
            let mut package = r#"<?xml version="1.0"?>
                <package>
                    <metadata><dc:title>Rust Reader</dc:title></metadata>
                    <manifest>"#
                .to_string();
            if options.include_nav {
                package.push_str(
                    r#"<item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>"#,
                );
            }
            if options.include_ncx {
                package.push_str(
                    r#"<item id="toc" href="toc.ncx" media-type="application/x-dtbncx+xml"/>"#,
                );
            }
            if options.include_extra_resource {
                package.push_str(
                    r#"<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>"#,
                );
            }
            for index in 0..options.chapter_count {
                package.push_str(&format!(
                    r#"<item id="{}" href="{}" media-type="application/xhtml+xml"/>"#,
                    test_epub_chapter_id(index, options.chapter_count),
                    test_epub_chapter_file(index, options.chapter_count)
                ));
            }
            if options.include_ncx {
                package.push_str(r#"</manifest><spine toc="toc">"#);
            } else {
                package.push_str("</manifest><spine>");
            }
            for index in 0..options.chapter_count {
                package.push_str(&format!(
                    r#"<itemref idref="{}"/>"#,
                    test_epub_chapter_id(index, options.chapter_count)
                ));
            }
            package.push_str("</spine></package>");
            zip.write_all(package.as_bytes())?;
        }

        if options.include_rights {
            zip.start_file("META-INF/rights.xml", file_options)?;
            zip.write_all(br#"<?xml version="1.0"?><rights/>"#)?;
        }

        if !options.encrypted_resources.is_empty() {
            zip.start_file("META-INF/encryption.xml", file_options)?;
            let mut encryption = r#"<?xml version="1.0"?><encryption>"#.to_string();
            for resource in &options.encrypted_resources {
                encryption.push_str(&format!(
                    r#"<EncryptedData><CipherData><CipherReference URI="{resource}"/></CipherData></EncryptedData>"#
                ));
            }
            encryption.push_str("</encryption>");
            zip.write_all(encryption.as_bytes())?;
        }

        if options.include_nav {
            zip.start_file("OPS/nav.xhtml", file_options)?;
            let mut nav = "<html><body><nav><ol>".to_string();
            if options.fragmented_nav {
                nav.push_str(
                    r##"<li><a href="chapter-one.xhtml#opening">Opening</a><ol><li><a href="chapter-one.xhtml#detail">Opening detail</a></li></ol></li><li><a href="chapter-two.xhtml#chapter-two">Chapter 2</a></li>"##,
                );
            } else {
                for index in 0..options.chapter_count {
                    nav.push_str(&format!(
                        r#"<li><a href="{}">{}</a></li>"#,
                        test_epub_chapter_file(index, options.chapter_count),
                        test_epub_chapter_label(index, options.chapter_count)
                    ));
                }
            }
            nav.push_str("</ol></nav></body></html>");
            zip.write_all(nav.as_bytes())?;
        }

        if options.include_ncx {
            zip.start_file("OPS/toc.ncx", file_options)?;
            let mut ncx = r#"<?xml version="1.0"?><ncx><navMap>"#.to_string();
            if options.fragmented_ncx {
                ncx.push_str(
                    r##"<navPoint><navLabel><text>NCX Opening</text></navLabel><content src="chapter-one.xhtml#opening"/><navPoint><navLabel><text>NCX Opening detail</text></navLabel><content src="chapter-one.xhtml#detail"/></navPoint></navPoint><navPoint><navLabel><text>NCX Chapter 2</text></navLabel><content src="chapter-two.xhtml#chapter-two"/></navPoint>"##,
                );
            } else {
                for index in 0..options.chapter_count {
                    ncx.push_str(&format!(
                        r#"<navPoint><navLabel><text>{}</text></navLabel><content src="{}"/></navPoint>"#,
                        test_epub_ncx_chapter_label(index, options.chapter_count),
                        test_epub_chapter_file(index, options.chapter_count)
                    ));
                }
            }
            ncx.push_str("</navMap></ncx>");
            zip.write_all(ncx.as_bytes())?;
        }

        if options.include_extra_resource {
            zip.start_file("OPS/images/cover.png", file_options)?;
            zip.write_all(b"png-placeholder")?;
        }

        for index in 0..options.chapter_count {
            let chapter_path = format!(
                "OPS/{}",
                test_epub_chapter_file(index, options.chapter_count)
            );
            if options
                .omitted_chapters
                .iter()
                .any(|omitted_chapter| *omitted_chapter == chapter_path)
            {
                continue;
            }

            zip.start_file(chapter_path, file_options)?;
            let label = test_epub_chapter_label(index, options.chapter_count);
            let text = options
                .custom_chapter_texts
                .get(index)
                .cloned()
                .unwrap_or_else(|| test_epub_chapter_text(index, options.chapter_count));
            let resource_html = if options.include_chapter_resource_reference && index == 0 {
                r#"<img src="images/cover.png" alt="cover"/>"#
            } else {
                ""
            };
            zip.write_all(
                format!(
                    "<html><body><h1>{label}</h1><p>{text}</p>{resource_html}<script>bad()</script></body></html>"
                )
                .as_bytes(),
            )?;
        }

        zip.finish()?;
        Ok(())
    }

    fn test_epub_chapter_id(index: usize, total: usize) -> String {
        if total == 2 {
            match index {
                0 => "chapter-one".to_string(),
                1 => "chapter-two".to_string(),
                _ => format!("chapter-{}", index + 1),
            }
        } else {
            format!("chapter-{}", index + 1)
        }
    }

    fn test_epub_chapter_file(index: usize, total: usize) -> String {
        if total == 2 {
            match index {
                0 => "chapter-one.xhtml".to_string(),
                1 => "chapter-two.xhtml".to_string(),
                _ => format!("chapter-{}.xhtml", index + 1),
            }
        } else {
            format!("chapter-{}.xhtml", index + 1)
        }
    }

    fn test_epub_chapter_label(index: usize, total: usize) -> String {
        if total == 2 && index == 0 {
            "Opening".to_string()
        } else {
            format!("Chapter {}", index + 1)
        }
    }

    fn test_epub_ncx_chapter_label(index: usize, total: usize) -> String {
        if total == 2 && index == 0 {
            "NCX Opening".to_string()
        } else {
            format!("NCX Chapter {}", index + 1)
        }
    }

    fn test_epub_chapter_text(index: usize, total: usize) -> String {
        if total == 2 {
            match index {
                0 => "First chapter".to_string(),
                1 => "Second chapter".to_string(),
                _ => format!("Chapter {} body", index + 1),
            }
        } else {
            format!("Chapter {} chapter body", index + 1)
        }
    }

    fn write_test_pdf(path: &Path, page_texts: &[&str], include_outline: bool) -> io::Result<()> {
        let mut document = TestPdfDocument::with_version("1.5");
        let pages_id = document.new_object_id();
        let font_id = document.add_object(dictionary! {
            "Type" => "Font",
            "Subtype" => "Type1",
            "BaseFont" => "Courier",
        });
        let resources_id = document.add_object(dictionary! {
            "Font" => dictionary! {
                "F1" => font_id,
            },
        });
        let pages = page_texts
            .iter()
            .map(|text| {
                let content = Content {
                    operations: vec![
                        Operation::new("BT", vec![]),
                        Operation::new("Tf", vec!["F1".into(), 48.into()]),
                        Operation::new("Td", vec![100.into(), 600.into()]),
                        Operation::new("Tj", vec![Object::string_literal(*text)]),
                        Operation::new("ET", vec![]),
                    ],
                };
                let content_id =
                    document.add_object(Stream::new(dictionary! {}, content.encode().unwrap()));
                Object::Reference(document.add_object(dictionary! {
                    "Type" => "Page",
                    "Parent" => pages_id,
                    "Contents" => content_id,
                }))
            })
            .collect::<Vec<_>>();
        document.objects.insert(
            pages_id,
            Object::Dictionary(dictionary! {
                "Type" => "Pages",
                "Kids" => pages,
                "Count" => page_texts.len() as i64,
                "Resources" => resources_id,
                "MediaBox" => vec![0.into(), 0.into(), 595.into(), 842.into()],
            }),
        );
        let catalog_id = document.add_object(dictionary! {
            "Type" => "Catalog",
            "Pages" => pages_id,
        });
        document.trailer.set("Root", catalog_id);

        if include_outline {
            let pages: Vec<_> = document.get_pages().values().copied().collect();
            if let Some(page) = pages.first() {
                document.add_bookmark(
                    Bookmark::new("Intro".to_string(), [0.0, 0.0, 0.0], 0, *page),
                    None,
                );
            }
            if let Some(page) = pages.get(1) {
                document.add_bookmark(
                    Bookmark::new("Later chapter".to_string(), [0.0, 0.0, 0.0], 0, *page),
                    None,
                );
            }
            if let Some(outline_id) = document.build_outline() {
                let root_id = document
                    .trailer
                    .get(b"Root")
                    .and_then(Object::as_reference)
                    .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))?;
                if let Ok(Object::Dictionary(catalog)) = document.get_object_mut(root_id) {
                    catalog.set("Outlines", Object::Reference(outline_id));
                }
            }
        }

        document
            .save(path)
            .map(|_| ())
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidData, error))
    }
}
