mod db;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
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
        ])
        .run(tauri::generate_context!())
        .expect("error while running SmartReader");
}
