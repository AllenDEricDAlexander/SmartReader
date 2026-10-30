mod ai_http;
mod app_lifecycle;
mod db;
mod file_commands;
mod knowledge_vectors;
mod library_storage;
mod notes_export;
mod window_appearance;

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
            app.manage(ai_http::AiHttpState::new());
            app.manage(app_lifecycle::ShutdownState::default());
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if app_lifecycle::request_shutdown(window.app_handle(), "close") {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_lifecycle::enable_shutdown_handler,
            app_lifecycle::complete_shutdown,
            window_appearance::set_window_background_color,
            window_appearance::show_main_window,
            db::save_document,
            db::get_document,
            db::list_recent_documents,
            db::remove_recent_document,
            db::clear_recent_documents,
            db::save_reader_session,
            db::load_reader_session,
            db::save_preferences,
            db::load_preferences,
            db::load_cache_stats,
            db::save_bookmark,
            db::list_bookmarks,
            db::list_all_bookmarks,
            db::load_bookmark_dashboard,
            db::delete_bookmark,
            db::save_annotation,
            db::list_annotations,
            db::list_all_annotations,
            db::delete_annotation,
            db::set_document_favorite,
            db::list_favorite_documents,
            db::create_tag,
            db::rename_tag,
            db::delete_tag,
            db::merge_tags,
            db::list_tags,
            db::load_tag_dashboard,
            db::attach_document_tag,
            db::detach_document_tag,
            db::attach_annotation_tag,
            db::detach_annotation_tag,
            file_commands::stat_desktop_pdf,
            file_commands::read_desktop_pdf_bytes,
            file_commands::read_cached_pdf,
            file_commands::list_desktop_pdfs,
            file_commands::resolve_dropped_pdf_paths,
            notes_export::begin_notes_export,
            notes_export::write_notes_export,
            notes_export::flush_notes_export,
            notes_export::finish_notes_export,
            notes_export::release_notes_export,
            notes_export::abort_notes_export,
            library_storage::read_library_storage,
            library_storage::write_library_storage,
            library_storage::write_library_storage_binary,
            library_storage::read_library_file,
            ai_http::ai_http_request,
            ai_http::ai_http_stream,
            ai_http::cancel_ai_request,
            knowledge_vectors::knowledge_cache_status,
            knowledge_vectors::read_knowledge_cache,
            knowledge_vectors::write_knowledge_cache,
            knowledge_vectors::search_knowledge_scope,
        ])
        .build(tauri::generate_context!())
        .expect("error while building SmartReader")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app_lifecycle::request_shutdown(app, "exit") {
                    api.prevent_exit();
                }
            }
        });
}
