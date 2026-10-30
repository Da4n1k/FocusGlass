// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn main() {
    // Ctrl+Shift+G — аварийный выход из режима click-through и показ окна
    let restore = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyG);
    let restore_handler = restore.clone();

    tauri::Builder::default()
        .manage(commands::DeviceManagerState::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &restore_handler && event.state() == ShortcutState::Pressed {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.set_ignore_cursor_events(false);
                            let _ = w.unminimize();
                            let _ = w.show();
                            let _ = w.set_focus();
                            let _ = w.emit("click-through-disabled", ());
                        }
                    }
                })
                .build(),
        )
        .setup(move |app| {
            app.global_shortcut().register(restore)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_click_through,
            commands::set_overlay_mode,
            commands::get_device_status,
            commands::set_device_source,
            commands::scan_brainbit_devices,
            commands::toggle_always_on_top,
            commands::minimize_window,
            commands::close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusGlass tauri application");
}
