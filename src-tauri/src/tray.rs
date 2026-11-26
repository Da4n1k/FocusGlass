//! Иконка в системном трее: показать панель, включить/выключить оверлей,
//! переключить click-through HUD, выйти.

use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

use crate::error::{AppError, AppResult};
use crate::overlay::{self, OverlayController};

const ID_SHOW: &str = "show_dashboard";
const ID_OVERLAY: &str = "overlay_enabled";
const ID_CLICK_THROUGH: &str = "click_through";
const ID_QUIT: &str = "quit";

/// Пункты меню с галочками — храним, чтобы синхронизировать их с состоянием.
pub struct TrayItems {
    overlay_enabled: CheckMenuItem<Wry>,
    click_through: CheckMenuItem<Wry>,
}

pub fn build(app: &AppHandle) -> AppResult<()> {
    let show = MenuItem::with_id(app, ID_SHOW, "Открыть панель управления", true, None::<&str>)?;
    let overlay_enabled =
        CheckMenuItem::with_id(app, ID_OVERLAY, "Оверлей включён", true, true, None::<&str>)?;
    let click_through = CheckMenuItem::with_id(
        app,
        ID_CLICK_THROUGH,
        "HUD пропускает клики (click-through)",
        true,
        false,
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, ID_QUIT, "Выход", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &show,
            &PredefinedMenuItem::separator(app)?,
            &overlay_enabled,
            &click_through,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| AppError::InvalidArgument("application icon is missing".to_string()))?;

    TrayIconBuilder::with_id("focusglass-tray")
        .icon(icon)
        .tooltip("FocusGlass — БОС-оверлей")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let result = match event.id().as_ref() {
                ID_SHOW => overlay::show_dashboard(app),
                ID_OVERLAY => toggle_overlay(app),
                ID_CLICK_THROUGH => toggle_click_through(app),
                ID_QUIT => {
                    crate::request_quit(app);
                    Ok(())
                }
                _ => Ok(()),
            };
            if let Err(error) = result {
                overlay::report_error(app, &error);
                // Галочка могла переключиться, а действие — нет: возвращаем правду.
                sync(app);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Err(error) = overlay::show_dashboard(app) {
                    overlay::report_error(app, &error);
                }
            }
        })
        .build(app)?;

    app.manage(TrayItems {
        overlay_enabled,
        click_through,
    });
    Ok(())
}

fn toggle_overlay(app: &AppHandle) -> AppResult<()> {
    let enabled = app.state::<OverlayController>().with(|s| s.enabled)?;
    overlay::set_overlay_enabled(app, !enabled)?;
    Ok(())
}

fn toggle_click_through(app: &AppHandle) -> AppResult<()> {
    let enabled = app.state::<OverlayController>().with(|s| s.click_through)?;
    overlay::set_click_through(app, !enabled)?;
    Ok(())
}

/// Приводит галочки меню в соответствие с фактическим состоянием оверлея.
pub fn sync(app: &AppHandle) {
    let (Some(items), Some(controller)) = (
        app.try_state::<TrayItems>(),
        app.try_state::<OverlayController>(),
    ) else {
        return;
    };
    let Ok((enabled, click_through)) = controller.with(|s| (s.enabled, s.click_through)) else {
        return;
    };
    // Сбой обновления галочки не влияет на работу оверлея — только логируем.
    if let Err(error) = items.overlay_enabled.set_checked(enabled) {
        eprintln!("[FocusGlass] tray sync failed: {error}");
    }
    if let Err(error) = items.click_through.set_checked(click_through) {
        eprintln!("[FocusGlass] tray sync failed: {error}");
    }
}
