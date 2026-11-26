// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bci;
mod commands;
mod distraction;
mod error;
#[cfg(target_os = "linux")]
mod linux_blur;
mod overlay;
mod screen_blur;
mod storage;
mod tray;
#[cfg(target_os = "linux")]
mod webkit_background;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, WindowEvent};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

use crate::distraction::{DistractionState, ForegroundWindowInfo, EVENT_FOREGROUND_WINDOW};
use crate::error::AppResult;
use crate::overlay::OverlayController;
use crate::storage::SessionStore;

/// Сколько ждать, пока фронтенд сохранит активную сессию перед выходом.
const QUIT_GRACE_PERIOD: Duration = Duration::from_millis(1500);

static QUIT_IN_PROGRESS: AtomicBool = AtomicBool::new(false);

/// Корректное завершение: просим окно `main` сохранить активную сессию и вызвать
/// `quit_app`; если фронтенд не ответил за `QUIT_GRACE_PERIOD` — выходим сами
/// (сессия при этом уже лежит в БД благодаря автосохранению).
pub fn request_quit(app: &AppHandle) {
    if QUIT_IN_PROGRESS.swap(true, Ordering::SeqCst) {
        return;
    }
    #[cfg(target_os = "linux")]
    if let Some(blur) = app.try_state::<linux_blur::LinuxBlur>() {
        let _ = blur.stop();
    }
    if let Some(blur_svc) = app.try_state::<Arc<screen_blur::ScreenBlurService>>() {
        blur_svc.set_active(false, None);
    }
    if app
        .emit_to(overlay::MAIN_LABEL, overlay::EVENT_QUIT_REQUESTED, ())
        .is_err()
    {
        if let Some(recorder) = app.try_state::<Arc<bci::EegDumpRecorder>>() {
            let _ = recorder.stop();
        }
        if let Some(driver) = app.try_state::<bci::BrainBitDriver>() {
            driver.shutdown();
        }
        app.exit(0);
        return;
    }
    let handle = app.clone();
    let spawned = thread::Builder::new()
        .name("focusglass-quit-watchdog".to_string())
        .spawn(move || {
            thread::sleep(QUIT_GRACE_PERIOD);
            if let Some(recorder) = handle.try_state::<Arc<bci::EegDumpRecorder>>() {
                let _ = recorder.stop();
            }
            if let Some(driver) = handle.try_state::<bci::BrainBitDriver>() {
                driver.shutdown();
            }
            handle.exit(0);
        });
    if spawned.is_err() {
        if let Some(recorder) = app.try_state::<Arc<bci::EegDumpRecorder>>() {
            let _ = recorder.stop();
        }
        if let Some(driver) = app.try_state::<bci::BrainBitDriver>() {
            driver.shutdown();
        }
        app.exit(0);
    }
}

/// Ctrl+Shift+G: вернуть управление — выключить click-through и показать панель.
fn restore_control(app: &AppHandle) {
    let result = overlay::set_click_through(app, false).and_then(|_| overlay::show_dashboard(app));
    if let Err(error) = result {
        overlay::report_error(app, &error);
    } else if let Some(main) = app.get_webview_window(overlay::MAIN_LABEL) {
        let _ = main.emit("click-through-disabled", ());
    }
}

fn setup(app: &AppHandle, restore_shortcut: Shortcut) -> AppResult<()> {
    #[cfg(target_os = "linux")]
    {
        app.manage(linux_blur::LinuxBlur::start());
        let main = app.get_webview_window(overlay::MAIN_LABEL)
            .ok_or(crate::error::AppError::WindowNotFound(overlay::MAIN_LABEL))?;
        main.with_webview(|platform| {
            match webkit_background::keep_processing(&platform.inner()) {
                Ok(features) => eprintln!("[FocusGlass] Background EEG/IPC enabled: {}",features.join(", ")),
                Err(error) => eprintln!("[FocusGlass] {error}; minimized EEG/IPC may be throttled"),
            }
        })?;
    }
    let app_data_dir = app.path().app_data_dir()?;
    let resource_dir = app.path().resource_dir().ok();
    let dumps_dir = app
        .path()
        .document_dir()
        .map(|d| d.join("FocusGlass-Dumps"))
        .unwrap_or_else(|_| app_data_dir.join("dumps"));
    let dump_recorder = Arc::new(bci::EegDumpRecorder::new(dumps_dir));
    let db_path = app_data_dir.join("focusglass.sqlite3");
    app.manage(SessionStore::open(&db_path)?);
    app.manage(Arc::clone(&dump_recorder));
    app.manage(bci::BrainBitDriver::start(
        app.clone(),
        Some(app_data_dir.as_path()),
        resource_dir.as_deref(),
        dump_recorder,
    ));

    // Регистрируем трей до глобального хоткея, чтобы проверка click-through знала,
    // есть ли резервный способ вернуть управление помимо Ctrl+Shift+G.
    if let Err(error) = tray::build(app) {
        eprintln!("[FocusGlass] system tray unavailable: {error}");
    }

    #[cfg(windows)]
    {
        overlay::create_overlay_window(app)?;
        overlay::spawn_hit_test_thread(app.clone())?;
        if let Ok(mut guard) = app.state::<overlay::OverlayState>().0.lock() {
            *guard = overlay::OverlayRegistry {
                labels: vec![overlay::OVERLAY_LABEL.to_string()],
                composited: true,
                unified_hud: true,
            };
        }
    }

    #[cfg(not(windows))]
    {
        let registry = overlay::init_linux_overlays(app);
        match app.state::<overlay::OverlayState>().0.lock() {
            Ok(mut guard) => *guard = registry,
            Err(_) => eprintln!("[FocusGlass] overlay state lock poisoned during startup"),
        }
    }

    let distraction_state = Arc::new(DistractionState::default());
    app.manage(Arc::clone(&distraction_state));
    let emitter = app.clone();
    distraction::spawn_monitor(distraction_state, move |info| {
        if let Err(error) = emit_foreground_window(&emitter, info) {
            eprintln!("[FocusGlass] foreground window emit failed: {error}");
        }
    })?;

    let registered = match app.global_shortcut().register(restore_shortcut) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("[FocusGlass] failed to register Ctrl+Shift+G: {error}");
            false
        }
    };
    app.state::<commands::RestoreShortcutState>()
        .0
        .store(registered, Ordering::SeqCst);

    Ok(())
}

fn emit_foreground_window(app: &AppHandle, info: Option<ForegroundWindowInfo>) -> AppResult<()> {
    let info = match info {
        Some(mut info) => {
            let origin = overlay::overlay_window(app)?.outer_position()?;
            let dx = -f64::from(origin.x);
            let dy = -f64::from(origin.y);
            info.overlay_rect = info.screen_rect.map(|r| r.translated(dx, dy));
            for region in &mut info.distractor_regions {
                region.overlay_rect = Some(region.screen_rect.translated(dx, dy));
            }
            Some(info)
        }
        None => None,
    };
    app.emit(EVENT_FOREGROUND_WINDOW, info)?;
    Ok(())
}

fn main() {
    let restore_shortcut = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyG);

    let result = tauri::Builder::default()
        .manage(commands::DeviceManagerState::default())
        .manage(commands::RestoreShortcutState::default())
        .manage(overlay::OverlayState::default())
        .manage(commands::HudRestoreState::default())
        .manage(OverlayController::default())
        .manage(Arc::new(screen_blur::ScreenBlurService::new()))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &restore_shortcut && event.state() == ShortcutState::Pressed {
                        restore_control(app);
                    }
                })
                .build(),
        )
        .register_asynchronous_uri_scheme_protocol(
            screen_blur::CAPTURE_SCHEME,
            |ctx, request, responder| {
                screen_blur::handle_capture_request_async(
                    ctx.app_handle().clone(),
                    ctx.webview_label(),
                    request,
                    responder,
                );
            },
        )
        .setup(move |app| {
            setup(app.handle(), restore_shortcut)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // Закрытие панели (Alt+F4, крестик) = выход с сохранением сессии;
            // скрытые окна оверлея иначе удержали бы процесс живым.
            if window.label() == overlay::MAIN_LABEL
                && let WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                request_quit(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_device_status,
            commands::set_device_source,
            commands::scan_brainbit_devices,
            commands::connect_brainbit,
            commands::disconnect_brainbit,
            commands::set_brainbit_mode,
            commands::get_eeg_dump_status,
            commands::start_eeg_dump,
            commands::stop_eeg_dump,
            commands::set_eeg_dump_label,
            commands::append_eeg_dump_samples,
            commands::open_eeg_dumps_folder,
            commands::get_window_state,
            commands::set_click_through,
            commands::set_overlay_enabled,
            commands::set_hud_mode,
            commands::show_dashboard,
            commands::update_overlay,
            commands::get_overlay_frame,
            commands::get_linux_blur_status,
            commands::update_linux_blur,
            commands::preview_linux_blur,
            commands::set_overlay_hit_region,
            commands::set_overlay_mode,
            commands::fit_hud_window,
            commands::toggle_always_on_top,
            commands::minimize_window,
            commands::close_window,
            commands::quit_app,
            commands::sessions_upsert,
            commands::sessions_list,
            commands::sessions_import,
            commands::sessions_delete,
            commands::sessions_clear,
            commands::set_distraction_config,
            commands::get_foreground_window,
            commands::list_running_windows,
            overlay::get_overlay_info,
            overlay::set_overlay_visible,
        ])
        .run(tauri::generate_context!());

    if let Err(error) = result {
        eprintln!("[FocusGlass] fatal: {error}");
        std::process::exit(1);
    }
}
