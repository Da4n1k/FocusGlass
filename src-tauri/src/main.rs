// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod error;
mod overlay;

use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn main() {
    // Ctrl+Shift+G — аварийный выход из режима click-through и показ окна
    let restore = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyG);
    let restore_handler = restore;

    tauri::Builder::default()
        .manage(commands::DeviceManagerState::default())
        .manage(commands::RestoreShortcutState::default())
        .manage(overlay::OverlayState::default())
        .manage(commands::HudRestoreState::default())
        .on_window_event(|window, event| {
            // Hidden overlay windows would keep the process alive after the dashboard is closed.
            if window.label() == "main" {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    window.app_handle().exit(0);
                }
            }
        })
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
            // Another app may already own Ctrl+Shift+G. That must not abort startup;
            // instead remember the outcome so click-through (which needs this
            // shortcut as its emergency exit) can be refused.
            let registered = match app.global_shortcut().register(restore) {
                Ok(()) => true,
                Err(err) => {
                    eprintln!("FocusGlass: cannot register Ctrl+Shift+G: {err}");
                    false
                }
            };
            app.state::<commands::RestoreShortcutState>()
                .0
                .store(registered, std::sync::atomic::Ordering::SeqCst);

            let registry = overlay::init(app.handle());
            match app.state::<overlay::OverlayState>().0.lock() {
                Ok(mut guard) => *guard = registry,
                Err(_) => eprintln!("FocusGlass: overlay state lock poisoned during startup"),
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::set_click_through,
            commands::set_overlay_mode,
            commands::fit_hud_window,
            commands::get_device_status,
            commands::set_device_source,
            commands::scan_brainbit_devices,
            commands::toggle_always_on_top,
            commands::minimize_window,
            commands::close_window,
            overlay::get_overlay_info,
            overlay::set_overlay_visible
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusGlass tauri application");
}
