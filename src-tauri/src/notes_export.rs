use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{Manager, Resource, ResourceId, Runtime, Webview};
use tauri_plugin_fs::FsExt;

const MAX_CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum NotesExportError {
    #[error("请选择保存对话框中指定的本地路径。")]
    InvalidPath,
    #[error("无法创建笔记 PDF；请确认目标文件不存在并且目录可写：{0}")]
    Create(io::Error),
    #[error("笔记 PDF 写入失败：{0}")]
    Io(#[from] io::Error),
    #[error("导出文件句柄无效或已关闭。")]
    InvalidHandle,
    #[error("导出数据无效或单次写入过大。")]
    InvalidData,
    #[error("导出已取消，但无法安全清理新建文件：{0}")]
    Cleanup(String),
}

impl serde::Serialize for NotesExportError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

struct ExportFile {
    path: PathBuf,
    file: Option<File>,
    flushed: bool,
}

impl ExportFile {
    fn create(path: &Path) -> Result<Self, NotesExportError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path).map_err(NotesExportError::Create)?;
        Ok(Self {
            path: path.to_owned(),
            file: Some(file),
            flushed: false,
        })
    }

    fn write(&mut self, bytes: &[u8]) -> Result<(), NotesExportError> {
        if bytes.len() > MAX_CHUNK_BYTES {
            return Err(NotesExportError::InvalidData);
        }
        self.file
            .as_mut()
            .ok_or(NotesExportError::InvalidHandle)?
            .write_all(bytes)?;
        self.flushed = false;
        Ok(())
    }

    fn flush(&mut self) -> Result<(), NotesExportError> {
        let file = self.file.as_mut().ok_or(NotesExportError::InvalidHandle)?;
        file.flush()?;
        file.sync_all()?;
        self.flushed = true;
        Ok(())
    }

    fn finish(&mut self) -> Result<(), NotesExportError> {
        self.prepare()?;
        self.file.take().ok_or(NotesExportError::InvalidHandle)?;
        Ok(())
    }

    fn prepare(&self) -> Result<(), NotesExportError> {
        self.file.as_ref().ok_or(NotesExportError::InvalidHandle)?;
        if !self.flushed {
            return Err(NotesExportError::InvalidData);
        }
        Ok(())
    }

    fn discard(&mut self) -> Result<(), NotesExportError> {
        let Some(file) = self.file.as_mut() else {
            return Ok(());
        };
        // Wipe only the file this export created, even if its path was replaced.
        file.set_len(0).map_err(|error| {
            NotesExportError::Cleanup(format!("{}：{error}", self.path.display()))
        })?;
        let original = same_file::Handle::from_file(file.try_clone()?)?;
        let current = match same_file::Handle::from_path(&self.path) {
            Ok(handle) => handle,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                self.file.take();
                return Ok(());
            }
            Err(error) => {
                return Err(NotesExportError::Cleanup(format!(
                    "{}：{error}",
                    self.path.display()
                )))
            }
        };
        let same = original == current;
        drop(original);
        drop(current);
        self.file.take();
        if !same {
            return Err(NotesExportError::Cleanup(format!(
                "{} 的路径已变化，未删除该路径",
                self.path.display()
            )));
        }
        fs::remove_file(&self.path)
            .map_err(|error| NotesExportError::Cleanup(format!("{}：{error}", self.path.display())))
    }
}

impl Drop for ExportFile {
    fn drop(&mut self) {
        // Explicit cancellation reports failures; teardown can only attempt cleanup.
        if self.file.is_some() {
            let _ = self.discard();
        }
    }
}

struct ExportResource(Mutex<ExportFile>);
impl Resource for ExportResource {}

#[tauri::command]
pub fn begin_notes_export<R: Runtime>(
    webview: Webview<R>,
    path: String,
) -> Result<ResourceId, NotesExportError> {
    let path = Path::new(&path);
    if !path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        || !webview.fs_scope().is_allowed(path)
    {
        return Err(NotesExportError::InvalidPath);
    }
    let file = ExportFile::create(path)?;
    Ok(webview
        .resources_table()
        .add(ExportResource(Mutex::new(file))))
}

#[tauri::command]
pub fn write_notes_export<R: Runtime>(
    webview: Webview<R>,
    request: tauri::ipc::Request<'_>,
) -> Result<(), NotesExportError> {
    let id: ResourceId = request
        .headers()
        .get("x-smartreader-export")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or(NotesExportError::InvalidHandle)?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.as_slice(),
        _ => return Err(NotesExportError::InvalidData),
    };
    let resource = webview
        .resources_table()
        .get::<ExportResource>(id)
        .map_err(|_| NotesExportError::InvalidHandle)?;
    let mut file = resource
        .0
        .lock()
        .map_err(|_| NotesExportError::InvalidHandle)?;
    file.write(bytes)
}

#[tauri::command]
pub fn flush_notes_export<R: Runtime>(
    webview: Webview<R>,
    id: ResourceId,
) -> Result<(), NotesExportError> {
    let resource = webview
        .resources_table()
        .get::<ExportResource>(id)
        .map_err(|_| NotesExportError::InvalidHandle)?;
    let mut file = resource
        .0
        .lock()
        .map_err(|_| NotesExportError::InvalidHandle)?;
    file.flush()
}

#[tauri::command]
pub fn finish_notes_export<R: Runtime>(
    webview: Webview<R>,
    id: ResourceId,
) -> Result<(), NotesExportError> {
    let resource = webview
        .resources_table()
        .get::<ExportResource>(id)
        .map_err(|_| NotesExportError::InvalidHandle)?;
    let file = resource
        .0
        .lock()
        .map_err(|_| NotesExportError::InvalidHandle)?;
    file.prepare()
}

#[tauri::command]
pub fn release_notes_export<R: Runtime>(
    webview: Webview<R>,
    id: ResourceId,
) -> Result<(), NotesExportError> {
    let resource = webview
        .resources_table()
        .take::<ExportResource>(id)
        .map_err(|_| NotesExportError::InvalidHandle)?;
    let mut file = resource
        .0
        .lock()
        .map_err(|_| NotesExportError::InvalidHandle)?;
    file.finish()
}

#[tauri::command]
pub fn abort_notes_export<R: Runtime>(
    webview: Webview<R>,
    id: ResourceId,
) -> Result<(), NotesExportError> {
    let resource = webview
        .resources_table()
        .take::<ExportResource>(id)
        .map_err(|_| NotesExportError::InvalidHandle)?;
    let mut file = resource
        .0
        .lock()
        .map_err(|_| NotesExportError::InvalidHandle)?;
    file.discard()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);

    fn directory() -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "smartreader-notes-export-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&path).expect("create fixture directory");
        path
    }

    #[test]
    fn existing_source_is_not_overwritten() {
        let dir = directory();
        let path = dir.join("original.pdf");
        fs::write(&path, b"original").expect("source");
        assert!(ExportFile::create(&path).is_err());
        assert_eq!(fs::read(&path).expect("source intact"), b"original");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[cfg(unix)]
    #[test]
    fn existing_symlink_cannot_overwrite_a_source_file() {
        use std::os::unix::fs::symlink;
        let dir = directory();
        let source = dir.join("source.pdf");
        let link = dir.join("output.pdf");
        fs::write(&source, b"original").expect("source");
        symlink(&source, &link).expect("symlink");
        assert!(ExportFile::create(&link).is_err());
        assert_eq!(fs::read(&source).expect("source intact"), b"original");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn unfinished_output_is_removed_and_successful_output_is_preserved() {
        let dir = directory();
        let cancelled = dir.join("cancelled.pdf");
        let completed = dir.join("completed.pdf");
        let mut output = ExportFile::create(&cancelled).expect("create");
        output.write(b"private notes").expect("write");
        output.discard().expect("discard");
        assert!(!cancelled.exists());
        let mut output = ExportFile::create(&completed).expect("create");
        output.write(b"finished notes").expect("write");
        output.flush().expect("flush");
        output.finish().expect("finish");
        drop(output);
        assert_eq!(
            fs::read(&completed).expect("finished output"),
            b"finished notes"
        );
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn discard_never_deletes_a_replacement_file() {
        let dir = directory();
        let path = dir.join("output.pdf");
        let moved = dir.join("moved.pdf");
        let mut output = ExportFile::create(&path).expect("create");
        output.write(b"private notes").expect("write");
        fs::rename(&path, &moved).expect("move original output");
        fs::write(&path, b"user replacement").expect("replacement");
        assert!(output.discard().is_err());
        assert_eq!(
            fs::read(&path).expect("replacement intact"),
            b"user replacement"
        );
        assert_eq!(fs::read(&moved).expect("original cleared"), b"");
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn dropping_an_unfinished_export_cleans_up_its_output() {
        let dir = directory();
        let path = dir.join("unfinished.pdf");
        let mut output = ExportFile::create(&path).expect("create");
        output.write(b"partial private notes").expect("write");
        drop(output);
        assert!(!path.exists());
        fs::remove_dir_all(dir).expect("cleanup");
    }

    #[test]
    fn unflushed_output_cannot_be_committed() {
        let dir = directory();
        let path = dir.join("unfinished.pdf");
        let mut output = ExportFile::create(&path).expect("create");
        output.write(b"partial private notes").expect("write");
        assert!(output.prepare().is_err());
        assert!(output.finish().is_err());
        drop(output);
        assert!(!path.exists());
        fs::remove_dir_all(dir).expect("cleanup");
    }
}
