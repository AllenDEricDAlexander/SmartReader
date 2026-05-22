use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use tauri::{Emitter, Manager};

const OPEN_FILE_EVENT: &str = "smartreader://open-file";

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
fn read_document(path: String) -> Result<Vec<u8>, String> {
    let document_path = PathBuf::from(path);

    if !is_supported_document_path(&document_path) {
        return Err("Unsupported document format".to_string());
    }

    fs::read(document_path)
        .map_err(|_| "SmartReader cannot access this file path. Choose the file again to reopen it.".to_string())
}

pub fn run() {
    let startup_files = PendingOpenFiles::new(startup_open_files());

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(startup_files)
        .invoke_handler(tauri::generate_handler![pending_open_files, read_document])
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
    env::args().skip(1).filter_map(|path| open_arg_to_path(&path)).collect()
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

#[cfg(test)]
mod tests {
    use super::*;

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
}
