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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPdfFile {
    pub path: String,
    pub name: String,
    pub bytes: Vec<u8>,
    pub file_size: u64,
    pub modified_at: Option<String>,
}

#[tauri::command]
pub fn read_desktop_pdf(path: String) -> Result<DesktopPdfFile, FileCommandError> {
    let path_ref = Path::new(&path);

    if !path_ref.exists() {
        return Err(FileCommandError::Missing);
    }

    if !path_ref.is_file() {
        return Err(FileCommandError::NotAFile);
    }

    let bytes = fs::read(path_ref)?;
    validate_pdf_bytes(&bytes)?;

    let metadata = fs::metadata(path_ref)?;
    let modified_at = metadata.modified().ok().and_then(|modified| {
        OffsetDateTime::from(modified)
            .format(&time::format_description::well_known::Rfc3339)
            .ok()
    });

    Ok(DesktopPdfFile {
        path: path_ref.to_string_lossy().to_string(),
        name: path_ref
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Untitled.pdf")
            .to_string(),
        bytes,
        file_size: metadata.len(),
        modified_at,
    })
}

pub fn validate_pdf_bytes(bytes: &[u8]) -> Result<(), FileCommandError> {
    if bytes.starts_with(b"%PDF-") {
        Ok(())
    } else {
        Err(FileCommandError::InvalidPdf)
    }
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
}
