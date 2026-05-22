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
use serde::Serialize;
use tauri::{Emitter, Manager};
use zip::ZipArchive;

const OPEN_FILE_EVENT: &str = "smartreader://open-file";
const UNSUPPORTED_DOCUMENT_ERROR: &str = "Unsupported document format";
const DOCUMENT_ACCESS_ERROR: &str =
    "SmartReader cannot access this file path. Choose the file again to reopen it.";
const DOCUMENT_READ_CANCELLED_ERROR: &str =
    "SmartReader could not finish reading this document. Try reopening it.";
const INVALID_EPUB_CONTAINER_ERROR: &str = "Invalid EPUB: missing container";
const INVALID_EPUB_PACKAGE_ERROR: &str = "Invalid EPUB: missing package";
const DEFAULT_EPUB_SEARCH_LIMIT: usize = 50;
const MAX_EPUB_SEARCH_LIMIT: usize = 100;

#[derive(Clone, Debug, PartialEq, Serialize)]
struct EpubDocumentDto {
    id: String,
    title: Option<String>,
    chapters: Vec<EpubChapterMetadataDto>,
    outline: Vec<EpubOutlineItemDto>,
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
struct EpubChapterDto {
    id: String,
    href: String,
    label: String,
    index: usize,
    sanitized_html: String,
    text: String,
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

struct EpubPackage {
    title: Option<String>,
    chapters: Vec<EpubChapterMetadataDto>,
    outline: Vec<EpubOutlineItemDto>,
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
    limit: Option<usize>,
) -> Result<Vec<EpubSearchResultDto>, String> {
    let document_path = PathBuf::from(path);

    tauri::async_runtime::spawn_blocking(move || {
        search_epub_document_from_path(document_path, query, limit)
    })
    .await
    .map_err(|_| DOCUMENT_READ_CANCELLED_ERROR.to_string())?
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
    let sanitized_html = sanitize_epub_html(&raw);
    let text = text_from_sanitized_html(&sanitized_html);

    Ok(EpubChapterDto {
        id: chapter.id.clone(),
        href: chapter.href.clone(),
        label: chapter.label.clone(),
        index: chapter.index,
        sanitized_html,
        text,
    })
}

fn search_epub_document_from_path(
    document_path: PathBuf,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<EpubSearchResultDto>, String> {
    validate_epub_path(&document_path)?;

    let query = normalize_whitespace(&query);
    if query.is_empty() {
        return Ok(Vec::new());
    }

    let limit = limit
        .unwrap_or(DEFAULT_EPUB_SEARCH_LIMIT)
        .min(MAX_EPUB_SEARCH_LIMIT);
    if limit == 0 {
        return Ok(Vec::new());
    }

    let mut archive = open_epub_archive(&document_path)?;
    let package = read_epub_package(&mut archive)?;
    let lower_query = query.to_lowercase();
    let chapter_count = package.chapters.len();
    let mut results = Vec::new();

    for chapter in &package.chapters {
        if results.len() >= limit {
            break;
        }

        let raw = read_zip_text(&mut archive, &chapter.href)
            .map_err(|_| "Invalid EPUB: missing chapter".to_string())?;
        let sanitized_html = sanitize_epub_html(&raw);
        let text = text_from_sanitized_html(&sanitized_html);
        let lower_text = text.to_lowercase();
        let Some(match_index) = lower_text.find(&lower_query) else {
            continue;
        };

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
    }

    Ok(results)
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
    let package_text = read_zip_text(archive, &package_path)
        .map_err(|_| INVALID_EPUB_PACKAGE_ERROR.to_string())?;

    parse_epub_package(archive, &package_path, &package_text)
}

fn read_zip_text(archive: &mut ZipArchive<fs::File>, path: &str) -> io::Result<String> {
    let mut file = archive.by_name(path)?;
    let mut text = String::new();
    file.read_to_string(&mut text)?;
    Ok(text)
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
) -> Result<EpubPackage, String> {
    let base_path = epub_base_path(package_path);
    let mut reader = xml_reader(package_text);
    let mut title = None;
    let mut in_title = false;
    let mut manifest: HashMap<String, ManifestItem> = HashMap::new();
    let mut spine_ids = Vec::new();
    let mut nav_path = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(start)) | Ok(Event::Empty(start))
                if tag_matches(start.name().as_ref(), "item") =>
            {
                if let (Some(id), Some(href)) = (xml_attr(&start, "id"), xml_attr(&start, "href")) {
                    let resolved_href = resolve_epub_path(&base_path, &href);
                    if xml_attr(&start, "properties")
                        .map(|properties| {
                            properties
                                .split_whitespace()
                                .any(|property| property == "nav")
                        })
                        .unwrap_or(false)
                    {
                        nav_path = Some(resolved_href.clone());
                    }
                    manifest.insert(
                        id,
                        ManifestItem {
                            href: resolved_href,
                        },
                    );
                }
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

    let nav_labels = nav_path
        .as_deref()
        .and_then(|path| {
            read_zip_text(archive, path)
                .ok()
                .map(|nav| (path.to_string(), nav))
        })
        .map(|(path, nav)| parse_epub_nav(&path, &nav))
        .unwrap_or_default();
    let mut chapters = Vec::new();

    for (index, idref) in spine_ids.iter().enumerate() {
        let Some(item) = manifest.get(idref) else {
            continue;
        };
        let href = item.href.clone();
        let label = nav_labels
            .iter()
            .find(|item| item.href == href)
            .map(|item| item.title.clone())
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
            index: chapter_indexes.get(&item.href).copied(),
            href: item.href,
            level: item.level,
        })
        .collect();

    Ok(EpubPackage {
        title,
        chapters,
        outline,
    })
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
                    .map(|href| href.split('#').next().unwrap_or("").to_string())
                    .filter(|href| !href.is_empty())
                    .map(|href| resolve_epub_path(&base_path, &href));
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

struct ManifestItem {
    href: String,
}

#[derive(Clone)]
struct NavItem {
    href: String,
    title: String,
    level: usize,
}

pub fn run() {
    let startup_files = PendingOpenFiles::new(startup_open_files());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(startup_files)
        .invoke_handler(tauri::generate_handler![
            pending_open_files,
            read_document,
            open_epub_document,
            read_epub_chapter,
            search_epub_document
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn opened_urls_to_paths_accepts_supported_file_urls() {
        let urls = vec![
            tauri::Url::parse("file:///Users/mario/Books/Guide.pdf").unwrap(),
            tauri::Url::parse("file:///Users/mario/Books/Story.epub").unwrap(),
        ];

        assert_eq!(
            opened_urls_to_paths(&urls),
            vec![
                "/Users/mario/Books/Guide.pdf".to_string(),
                "/Users/mario/Books/Story.epub".to_string()
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
    fn search_epub_document_finds_text_in_later_chapter() {
        let path = test_path("search.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        let results =
            search_epub_document_from_path(path.clone(), "Second chapter".to_string(), Some(10))
                .unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].label, "Chapter 2");
        assert_eq!(results[0].href, "OPS/chapter-two.xhtml");
        assert_eq!(results[0].index, 1);
        assert!(results[0].snippet.contains("Second chapter"));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn search_epub_document_respects_limit() {
        let path = test_path("search-limit.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        let results =
            search_epub_document_from_path(path.clone(), "chapter".to_string(), Some(1)).unwrap();

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].href, "OPS/chapter-one.xhtml");
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn search_epub_document_rejects_empty_query_and_zero_limit_without_reading_chapters() {
        let path = test_path("search-empty.epub");
        write_test_epub(&path, TestEpubOptions::default()).unwrap();

        assert!(
            search_epub_document_from_path(path.clone(), "   ".to_string(), Some(10))
                .unwrap()
                .is_empty()
        );
        assert!(
            search_epub_document_from_path(path.clone(), "chapter".to_string(), Some(0))
                .unwrap()
                .is_empty()
        );
        fs::remove_file(path).unwrap();
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

    struct TestEpubOptions {
        include_container: bool,
        include_package: bool,
    }

    impl Default for TestEpubOptions {
        fn default() -> Self {
            Self {
                include_container: true,
                include_package: true,
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
            zip.write_all(
                br#"<?xml version="1.0"?>
                <package>
                    <metadata><dc:title>Rust Reader</dc:title></metadata>
                    <manifest>
                        <item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/>
                        <item id="chapter-one" href="chapter-one.xhtml" media-type="application/xhtml+xml"/>
                        <item id="chapter-two" href="chapter-two.xhtml" media-type="application/xhtml+xml"/>
                    </manifest>
                    <spine>
                        <itemref idref="chapter-one"/>
                        <itemref idref="chapter-two"/>
                    </spine>
                </package>"#,
            )?;
        }

        zip.start_file("OPS/nav.xhtml", file_options)?;
        zip.write_all(
            br##"<html><body><nav>
                <ol>
                    <li><a href="chapter-one.xhtml">Opening</a></li>
                    <li><a href="chapter-two.xhtml">Chapter 2</a></li>
                </ol>
            </nav></body></html>"##,
        )?;

        zip.start_file("OPS/chapter-one.xhtml", file_options)?;
        zip.write_all(br#"<html><body><h1>Opening</h1><p>First chapter</p></body></html>"#)?;

        zip.start_file("OPS/chapter-two.xhtml", file_options)?;
        zip.write_all(
            br#"<html><body><h1>Chapter 2</h1><p>Second chapter</p><script>bad()</script></body></html>"#,
        )?;

        zip.finish()?;
        Ok(())
    }
}
