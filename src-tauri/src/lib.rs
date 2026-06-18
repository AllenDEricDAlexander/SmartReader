mod db;
mod file_commands;

use tauri::{Emitter, Manager};

pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.set_focus();
            }

            let pdf_paths: Vec<String> = args
                .into_iter()
                .filter(|arg| arg.to_lowercase().ends_with(".pdf"))
                .collect();

            if !pdf_paths.is_empty() {
                let _ = app.emit("smartreader://open-pdfs", pdf_paths);
            }
        }));
    }

    builder
        .setup(|app| {
            let database = db::setup_database(app.handle())?;
            app.manage(database);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            db::save_document,
            db::list_recent_documents,
            db::save_reader_session,
            db::load_reader_session,
            db::save_preferences,
            db::load_preferences,
            db::save_bookmark,
            db::list_bookmarks,
            db::delete_bookmark,
            db::save_annotation,
            db::list_annotations,
            db::delete_annotation,
            file_commands::read_desktop_pdf,
            file_commands::read_cached_pdf,
        ])
        .run(tauri::generate_context!())
        .expect("error while running SmartReader");
}
