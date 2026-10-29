// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            commands::set_click_through,
            commands::get_device_status,
            commands::toggle_always_on_top,
            commands::minimize_window,
            commands::close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusGlass tauri application");
}
