mod database;
mod model;
mod service;
mod vault;

use service::AppState;
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[tauri::command]
async fn dispatch(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
    action: String,
    payload: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state
            .lock()
            .map_err(|_| "数据服务异常，请重新启动软件".to_string())?
            .dispatch(&action, payload)
    })
    .await
    .map_err(|e| e.to_string())?
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(Arc::new(Mutex::new(AppState::new(dir.join("archive.dag")))));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch])
        .run(tauri::generate_context!())
        .expect("无法启动笺藏");
}

#[cfg(test)]
mod tests;
