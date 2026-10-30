use serde::Serialize;
use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};
use time::OffsetDateTime;

#[derive(Debug, thiserror::Error)]
pub enum FileCommandError {
    #[error("file does not exist")]
    Missing,
    #[error("path is not a file")]
    NotAFile,
    #[error("file is not a PDF")]
    InvalidPdf,
    #[error("path is not a directory")]
    NotADirectory,
    #[error("folder import supports at most 2000 PDFs and 20 directory levels")]
    FolderLimit,
    #[error("文件路径无效，无法定位文件")]
    InvalidRevealPath,
    #[error("无法在文件管理器中定位文件：{0}")]
    Reveal(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
}

impl serde::Serialize for FileCommandError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

#[tauri::command]
pub async fn reveal_desktop_file(path: String) -> Result<(), FileCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut command = reveal_file_command(Path::new(&path))?;
        #[cfg(target_os = "windows")]
        {
            // Explorer may keep running after opening its window.
            command
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .map_err(|error| FileCommandError::Reveal(error.to_string()))?;
            Ok(())
        }
        #[cfg(not(target_os = "windows"))]
        {
            let output = command
                .output()
                .map_err(|error| FileCommandError::Reveal(error.to_string()))?;
            if output.status.success() {
                Ok(())
            } else {
                let detail = String::from_utf8_lossy(&output.stderr).trim().to_string();
                Err(FileCommandError::Reveal(if detail.is_empty() {
                    output.status.to_string()
                } else {
                    detail
                }))
            }
        }
    })
    .await
    .map_err(|error| FileCommandError::Reveal(error.to_string()))?
}

fn reveal_file_command(path: &Path) -> Result<Command, FileCommandError> {
    if !path.is_absolute() {
        return Err(FileCommandError::InvalidRevealPath);
    }
    let metadata = fs::metadata(path).map_err(|error| match error.kind() {
        std::io::ErrorKind::NotFound => FileCommandError::Missing,
        _ => FileCommandError::Io(error),
    })?;
    if !metadata.is_file() {
        return Err(FileCommandError::NotAFile);
    }

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("/usr/bin/open");
        command.arg("-R").arg(path);
        command
    };
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer.exe");
        command.arg("/select,").arg(path);
        command
    };
    #[cfg(target_os = "linux")]
    let mut command = file_manager_show_items_command(path)?;
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    return Err(FileCommandError::Reveal("当前系统不支持文件定位".into()));

    #[cfg(any(target_os = "macos", target_os = "windows", target_os = "linux"))]
    {
        command.stdin(Stdio::null());
        Ok(command)
    }
}

#[cfg(any(target_os = "linux", test))]
fn file_manager_show_items_command(path: &Path) -> Result<Command, FileCommandError> {
    let uri =
        reqwest::Url::from_file_path(path).map_err(|_| FileCommandError::InvalidRevealPath)?;
    let items = serde_json::to_string(&[uri.as_str()])
        .map_err(|error| FileCommandError::Reveal(error.to_string()))?;
    let mut command = Command::new("gdbus");
    command.args([
        "call",
        "--session",
        "--timeout",
        "5",
        "--dest",
        "org.freedesktop.FileManager1",
        "--object-path",
        "/org/freedesktop/FileManager1",
        "--method",
        "org.freedesktop.FileManager1.ShowItems",
        &items,
        "''",
    ]);
    Ok(command)
}

/// Everything about a local PDF except its contents.
///
/// Kept separate from the bytes on purpose: serde encodes `Vec<u8>` as a JSON
/// array of numbers, so returning the two together turned a 50 MB document into
/// a ~150 MB JSON string that the webview then parsed into a 50-million element
/// array before a single page could render.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPdfMetadata {
    pub path: String,
    pub name: String,
    pub file_size: u64,
    pub modified_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedPdfFile {
    pub cache_path: String,
    pub bytes: Vec<u8>,
}

/// Describes a local PDF without reading it. Only the header is inspected, so
/// this stays cheap enough to use as a freshness check before deciding whether
/// cached bytes can be reused.
#[tauri::command]
pub fn stat_desktop_pdf(path: String) -> Result<DesktopPdfMetadata, FileCommandError> {
    let path_ref = Path::new(&path);

    if !path_ref.exists() {
        return Err(FileCommandError::Missing);
    }

    if !path_ref.is_file() {
        return Err(FileCommandError::NotAFile);
    }

    validate_pdf_header(path_ref)?;

    let metadata = fs::metadata(path_ref)?;
    let modified_at = metadata.modified().ok().and_then(|modified| {
        OffsetDateTime::from(modified)
            .format(&time::format_description::well_known::Rfc3339)
            .ok()
    });

    Ok(DesktopPdfMetadata {
        path: path_ref.to_string_lossy().to_string(),
        name: path_ref
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.pdf")
            .to_string(),
        file_size: metadata.len(),
        modified_at,
    })
}

/// Returns the raw PDF as a binary IPC payload rather than JSON.
#[tauri::command]
pub fn read_desktop_pdf_bytes(path: String) -> Result<tauri::ipc::Response, FileCommandError> {
    let path_ref = Path::new(&path);

    if !path_ref.exists() {
        return Err(FileCommandError::Missing);
    }

    if !path_ref.is_file() {
        return Err(FileCommandError::NotAFile);
    }

    let bytes = fs::read(path_ref)?;
    validate_pdf_bytes(&bytes)?;

    Ok(tauri::ipc::Response::new(bytes))
}

/// Reads just enough of the file to confirm the PDF magic number.
fn validate_pdf_header(path: &Path) -> Result<(), FileCommandError> {
    use std::io::Read;

    let mut file = fs::File::open(path)?;
    let mut header = [0u8; 5];
    let read = file.read(&mut header)?;

    validate_pdf_bytes(&header[..read])
}

#[tauri::command]
pub fn read_cached_pdf(cache_path: String) -> Result<CachedPdfFile, FileCommandError> {
    let bytes = fs::read(&cache_path)?;
    validate_pdf_bytes(&bytes)?;
    Ok(CachedPdfFile { cache_path, bytes })
}

#[tauri::command]
pub fn list_desktop_pdfs(directory: String) -> Result<Vec<String>, FileCommandError> {
    let root = fs::canonicalize(directory)?;
    if !root.is_dir() {
        return Err(FileCommandError::NotADirectory);
    }
    let mut pending = vec![(root, 0usize)];
    let mut files = Vec::new();
    while let Some((directory, depth)) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            // Do not follow links outside the selected tree or recurse through cycles.
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                if depth >= 20 {
                    return Err(FileCommandError::FolderLimit);
                }
                pending.push((entry.path(), depth + 1));
            } else if file_type.is_file()
                && entry
                    .path()
                    .extension()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.eq_ignore_ascii_case("pdf"))
            {
                files.push(entry.path().to_string_lossy().into_owned());
                if files.len() > 2000 {
                    return Err(FileCommandError::FolderLimit);
                }
            }
        }
    }
    files.sort();
    Ok(files)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedPdfPaths {
    pub pdf_paths: Vec<String>,
    pub has_directories: bool,
}

#[tauri::command]
pub fn resolve_dropped_pdf_paths(paths: Vec<String>) -> Result<DroppedPdfPaths, FileCommandError> {
    let mut pdf_paths = std::collections::BTreeSet::new();
    let mut has_directories = false;
    for path in paths {
        let path = fs::canonicalize(path)?;
        if path.is_dir() {
            has_directories = true;
            pdf_paths.extend(list_desktop_pdfs(path.to_string_lossy().into_owned())?);
        } else if path.is_file()
            && path
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|value| value.eq_ignore_ascii_case("pdf"))
        {
            pdf_paths.insert(path.to_string_lossy().into_owned());
        }
        if pdf_paths.len() > 2000 {
            return Err(FileCommandError::FolderLimit);
        }
    }
    Ok(DroppedPdfPaths {
        pdf_paths: pdf_paths.into_iter().collect(),
        has_directories,
    })
}

pub fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), FileCommandError> {
    if bytes.starts_with(b"%PDF-") {
        Ok(())
    } else {
        Err(FileCommandError::InvalidPdf)
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn cache_file_name(document_key: &str) -> String {
    let mut name = String::new();

    for byte in document_key.as_bytes() {
        name.push_str(&format!("{byte:02x}"));
    }

    format!("{name}.pdf")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reveal_validates_paths_without_launching_a_file_manager() {
        let directory =
            std::env::temp_dir().join(format!("smartreader-reveal-{}", std::process::id()));
        fs::create_dir_all(&directory).expect("create fixture");
        assert!(matches!(
            reveal_file_command(Path::new("relative.pdf")),
            Err(FileCommandError::InvalidRevealPath)
        ));
        assert!(matches!(
            reveal_file_command(&directory),
            Err(FileCommandError::NotAFile)
        ));
        assert!(matches!(
            reveal_file_command(&directory.join("missing.pdf")),
            Err(FileCommandError::Missing)
        ));
        let path = directory.join("研究 notes, % #1.pdf");
        fs::write(&path, b"%PDF-1.7").expect("write fixture");
        let command = reveal_file_command(&path).expect("build command");
        #[cfg(target_os = "macos")]
        {
            assert_eq!(command.get_program(), "/usr/bin/open");
            assert_eq!(
                command.get_args().collect::<Vec<_>>(),
                vec![std::ffi::OsStr::new("-R"), path.as_os_str()]
            );
        }
        #[cfg(target_os = "windows")]
        {
            assert_eq!(command.get_program(), "explorer.exe");
            assert_eq!(
                command.get_args().collect::<Vec<_>>(),
                vec![std::ffi::OsStr::new("/select,"), path.as_os_str()]
            );
        }
        #[cfg(target_os = "linux")]
        assert_eq!(command.get_program(), "gdbus");
        fs::remove_dir_all(&directory).expect("remove fixture");
    }

    #[test]
    fn linux_file_manager_receives_a_single_encoded_uri_with_selection_semantics() {
        let path = std::env::temp_dir().join("研究 O'Reilly, % #1.pdf");
        let command = file_manager_show_items_command(&path).expect("build D-Bus command");
        let args = command
            .get_args()
            .map(|value| value.to_str().unwrap())
            .collect::<Vec<_>>();
        assert!(args.contains(&"org.freedesktop.FileManager1.ShowItems"));
        let items: Vec<String> = serde_json::from_str(args[10]).expect("URI array");
        assert_eq!(items.len(), 1);
        assert!(items[0].contains("%20"));
        assert!(items[0].contains("%23"));
        assert!(items[0].contains("%25"));
        assert_eq!(
            reqwest::Url::parse(&items[0])
                .unwrap()
                .to_file_path()
                .unwrap(),
            path
        );
        assert_eq!(args.last(), Some(&"''"));
    }

    #[test]
    fn resolves_dropped_folders_and_files_without_duplicates() {
        let dir = std::env::temp_dir().join(format!("smartreader-drop-{}", std::process::id()));
        fs::create_dir_all(dir.join("nested")).expect("create folder");
        fs::write(dir.join("a.PDF"), b"%PDF-1.7").expect("write pdf");
        fs::write(dir.join("nested/b.pdf"), b"%PDF-1.7").expect("write nested pdf");
        fs::write(dir.join("notes.txt"), b"notes").expect("write text");
        let paths = vec![
            dir.to_string_lossy().into_owned(),
            dir.join("a.PDF").to_string_lossy().into_owned(),
        ];
        let result = resolve_dropped_pdf_paths(paths).expect("resolve mixed drop");
        assert!(result.has_directories);
        assert_eq!(result.pdf_paths.len(), 2);
        let single =
            resolve_dropped_pdf_paths(vec![dir.join("a.PDF").to_string_lossy().into_owned()])
                .expect("resolve single pdf");
        assert!(!single.has_directories);
        assert_eq!(single.pdf_paths.len(), 1);
        fs::remove_dir_all(dir).expect("remove fixture");
    }

    #[test]
    fn distinguishes_empty_dropped_folders_from_unsupported_files() {
        let dir =
            std::env::temp_dir().join(format!("smartreader-empty-drop-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("create folder");
        fs::write(dir.join("notes.txt"), b"notes").expect("write text");
        let folder = resolve_dropped_pdf_paths(vec![dir.to_string_lossy().into_owned()])
            .expect("resolve folder");
        assert!(folder.has_directories);
        assert!(folder.pdf_paths.is_empty());
        let file =
            resolve_dropped_pdf_paths(vec![dir.join("notes.txt").to_string_lossy().into_owned()])
                .expect("resolve text");
        assert!(!file.has_directories);
        assert!(file.pdf_paths.is_empty());
        fs::remove_dir_all(dir).expect("remove fixture");
    }

    #[test]
    fn lists_nested_pdfs_without_following_links() {
        let dir = std::env::temp_dir().join(format!("smartreader-folder-{}", std::process::id()));
        fs::create_dir_all(dir.join("nested")).expect("create folder");
        fs::write(dir.join("a.PDF"), b"%PDF-1.7").expect("write pdf");
        fs::write(dir.join("notes.txt"), b"notes").expect("write text");
        fs::write(dir.join("nested/b.pdf"), b"%PDF-1.7").expect("write nested pdf");
        #[cfg(unix)]
        std::os::unix::fs::symlink(&dir, dir.join("nested/loop")).expect("create link");
        let paths = list_desktop_pdfs(dir.to_string_lossy().into_owned()).expect("enumerate");
        assert_eq!(paths.len(), 2);
        assert!(paths[0].ends_with("a.PDF"));
        assert!(paths[1].ends_with("nested/b.pdf"));
        fs::remove_dir_all(dir).expect("remove fixture");
    }

    #[test]
    fn accepts_pdf_header() {
        assert!(validate_pdf_bytes(b"%PDF-1.7\nbody").is_ok());
    }

    #[test]
    fn rejects_non_pdf_header() {
        let error = validate_pdf_bytes(b"not a pdf").expect_err("invalid");
        assert!(matches!(error, FileCommandError::InvalidPdf));
    }

    #[test]
    fn header_validation_reads_only_the_magic_number() {
        let dir = std::env::temp_dir().join("smartreader-header-test");
        fs::create_dir_all(&dir).expect("temp dir");
        let file = dir.join("book.pdf");
        fs::write(&file, b"%PDF-1.7\nplenty more content").expect("write");

        assert!(validate_pdf_header(&file).is_ok());

        fs::write(&file, b"nope").expect("write");
        assert!(matches!(
            validate_pdf_header(&file).expect_err("invalid"),
            FileCommandError::InvalidPdf
        ));

        fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn cache_file_name_is_stable() {
        let name = cache_file_name("desktop:/tmp/book.pdf");
        assert!(name.ends_with(".pdf"));
        assert!(name
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.'));
    }
}
