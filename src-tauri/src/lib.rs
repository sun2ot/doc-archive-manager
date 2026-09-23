mod database;
mod model;
mod service;
mod vault;

use service::AppState;
use tauri::{menu::{MenuBuilder, MenuItemBuilder}, tray::{MouseButton, MouseButtonState, TrayIconBuilder}};
use std::sync::{Arc, Mutex};
use tauri::Manager;

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

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
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(Arc::new(Mutex::new(AppState::new(dir.join("archive.dag")))));
            let open = MenuItemBuilder::with_id("tray-open", "打开笺藏").build(app)?;
            let quit = MenuItemBuilder::with_id("tray-quit", "退出程序").build(app)?;
            let menu = MenuBuilder::new(app).items(&[&open, &quit]).build()?;
            let icon = app.default_window_icon().cloned().ok_or("缺少系统托盘图标")?;
            TrayIconBuilder::with_id("jiancang-tray")
                .icon(icon)
                .tooltip("笺藏 · 文档归档管家")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "tray-open" => restore_main_window(app),
                    "tray-quit" => app.exit(0),
                    _ => (),
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event {
                        restore_main_window(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![dispatch, quit_app])
        .run(tauri::generate_context!())
        .expect("无法启动笺藏");
}

#[cfg(test)]
mod tests;

fn restore_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
