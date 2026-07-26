use serde::Serialize;
use std::fs;
use std::path::Path;
use time::OffsetDateTime;

#[derive(Debug, thiserror::Error)]
pub enum FileCommandError {
    #[error("file does not exist")]
    Missing,
    #[error("path is not a file")]
    NotAFile,
    #[error("file is not a PDF")]
    InvalidPdf,
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
