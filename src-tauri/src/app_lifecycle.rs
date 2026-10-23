use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

#[derive(Default)]
pub struct ShutdownState {
    ready: AtomicBool,
    allowed: AtomicBool,
}

#[tauri::command]
pub fn enable_shutdown_handler(state: tauri::State<'_, ShutdownState>) {
    state.ready.store(true, Ordering::SeqCst);
}

pub fn request_shutdown(app: &tauri::AppHandle, kind: &str) -> bool {
    let state = app.state::<ShutdownState>();
    if !state.ready.load(Ordering::SeqCst) || state.allowed.load(Ordering::SeqCst) {
        return false;
    }
    if let Err(error) = app.emit("smartreader://shutdown-requested", kind) {
        eprintln!("Could not request pending chat saves before shutdown: {error}");
    }
    true
}

#[tauri::command]
pub fn complete_shutdown(
    window: tauri::Window,
    state: tauri::State<'_, ShutdownState>,
    exit: bool,
) -> Result<(), String> {
    state.allowed.store(true, Ordering::SeqCst);
    if exit {
        window.app_handle().exit(0);
        Ok(())
    } else {
        window.destroy().map_err(|error| {
            state.allowed.store(false, Ordering::SeqCst);
            error.to_string()
        })
    }
}
