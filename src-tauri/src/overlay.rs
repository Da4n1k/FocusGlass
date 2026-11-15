//! Native screen-dimming overlay: one transparent, click-through, non-focusable window per monitor.
//!
//! The windows stay hidden until the frontend asks to show them (only while dimming is visible),
//! and are never created when the display server does not composite windows: without compositing
//! a "transparent" window is painted opaque and would black the screen out. In that case the
//! frontend falls back to its in-page overlay.

use crate::error::AppError;
use serde::Serialize;
use std::sync::Mutex;
use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, State, WebviewUrl, WebviewWindowBuilder,
};

pub const OVERLAY_LABEL_PREFIX: &str = "overlay-";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OverlaySpec {
    pub label: String,
    pub rect: Rect,
}

/// One overlay per usable monitor. Monitors reporting a zero-sized area are skipped.
pub fn plan_overlays(monitors: &[Rect]) -> Vec<OverlaySpec> {
    monitors
        .iter()
        .filter(|rect| rect.width > 0 && rect.height > 0)
        .enumerate()
        .map(|(index, rect)| OverlaySpec {
            label: format!("{OVERLAY_LABEL_PREFIX}{index}"),
            rect: *rect,
        })
        .collect()
}

#[derive(Debug, Clone, Default)]
pub struct OverlayRegistry {
    pub labels: Vec<String>,
    pub composited: bool,
}

#[derive(Default)]
pub struct OverlayState(pub Mutex<OverlayRegistry>);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayInfo {
    pub count: usize,
    pub composited: bool,
}

impl From<&OverlayRegistry> for OverlayInfo {
    fn from(registry: &OverlayRegistry) -> Self {
        Self {
            count: registry.labels.len(),
            composited: registry.composited,
        }
    }
}

/// Whether windows are composited, i.e. whether real window transparency is possible.
#[cfg(target_os = "linux")]
fn display_is_composited() -> bool {
    // Must run on the main thread after GTK is initialised; `setup` guarantees both.
    gtk::gdk::Screen::default()
        .map(|screen| screen.is_composited())
        .unwrap_or(false)
}

#[cfg(not(target_os = "linux"))]
fn display_is_composited() -> bool {
    true
}

fn build_overlay(app: &AppHandle, spec: &OverlaySpec) -> Result<(), AppError> {
    let window = WebviewWindowBuilder::new(
        app,
        &spec.label,
        WebviewUrl::App("overlay.html".into()),
    )
    .title("FocusGlass Overlay")
    .transparent(true)
    .decorations(false)
    .shadow(false)
    .resizable(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focusable(false)
    .focused(false)
    // Created visible on purpose: on Linux the toolkit only creates the native window when it is
    // first shown, and making a never-shown window click-through panics inside the event loop
    // (which aborts the whole app). The window is hidden again right after it is configured.
    .visible(true)
    .build()
    .map_err(|e| AppError::window("create overlay window", e))?;

    window
        .set_position(PhysicalPosition::new(spec.rect.x, spec.rect.y))
        .map_err(|e| AppError::window("position overlay window", e))?;
    window
        .set_size(PhysicalSize::new(spec.rect.width, spec.rect.height))
        .map_err(|e| AppError::window("size overlay window", e))?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| AppError::window("make overlay click-through", e))?;
    window
        .hide()
        .map_err(|e| AppError::window("hide overlay window", e))
}

fn destroy_overlays(app: &AppHandle) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(OVERLAY_LABEL_PREFIX) {
            let _ = window.destroy();
        }
    }
}

fn create_overlays(app: &AppHandle) -> Result<Vec<String>, AppError> {
    let monitors = app
        .available_monitors()
        .map_err(|e| AppError::window("list monitors", e))?;
    let rects: Vec<Rect> = monitors
        .iter()
        .map(|monitor| Rect {
            x: monitor.position().x,
            y: monitor.position().y,
            width: monitor.size().width,
            height: monitor.size().height,
        })
        .collect();

    let mut labels = Vec::new();
    for spec in plan_overlays(&rects) {
        build_overlay(app, &spec)?;
        labels.push(spec.label);
    }
    Ok(labels)
}

/// Creates the overlay windows. Never fails the application: on any problem it logs the reason
/// and returns an empty registry, which makes the frontend use its in-page overlay instead.
pub fn init(app: &AppHandle) -> OverlayRegistry {
    if !display_is_composited() {
        eprintln!("FocusGlass: display is not composited, using the in-page overlay fallback");
        return OverlayRegistry {
            labels: Vec::new(),
            composited: false,
        };
    }

    match create_overlays(app) {
        Ok(labels) => OverlayRegistry {
            labels,
            composited: true,
        },
        Err(err) => {
            eprintln!(
                "FocusGlass: cannot create overlay windows ({err}), using the in-page overlay fallback"
            );
            destroy_overlays(app);
            OverlayRegistry {
                labels: Vec::new(),
                composited: true,
            }
        }
    }
}

#[tauri::command]
pub fn get_overlay_info(state: State<'_, OverlayState>) -> Result<OverlayInfo, AppError> {
    let guard = state
        .0
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("Overlay"))?;
    Ok(OverlayInfo::from(&*guard))
}

#[tauri::command]
pub fn set_overlay_visible(
    app: AppHandle,
    state: State<'_, OverlayState>,
    visible: bool,
) -> Result<(), AppError> {
    let labels = state
        .0
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("Overlay"))?
        .labels
        .clone();

    for label in labels {
        let Some(window) = app.get_webview_window(&label) else {
            continue;
        };
        if visible {
            window
                .show()
                .map_err(|e| AppError::window("show overlay window", e))?;
            // Window managers may reset these when a window is mapped again.
            window
                .set_always_on_top(true)
                .map_err(|e| AppError::window("raise overlay window", e))?;
            window
                .set_ignore_cursor_events(true)
                .map_err(|e| AppError::window("make overlay click-through", e))?;
        } else {
            window
                .hide()
                .map_err(|e| AppError::window("hide overlay window", e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    #[test]
    fn one_overlay_per_monitor_with_stable_labels() {
        let specs = plan_overlays(&[monitor(0, 0, 1920, 1080), monitor(1920, 0, 2560, 1440)]);
        assert_eq!(specs.len(), 2);
        assert_eq!(specs[0].label, "overlay-0");
        assert_eq!(specs[1].label, "overlay-1");
        assert_eq!(specs[1].rect, monitor(1920, 0, 2560, 1440));
    }

    #[test]
    fn monitors_left_of_or_above_the_origin_keep_their_negative_position() {
        let specs = plan_overlays(&[monitor(0, 0, 1920, 1080), monitor(-1280, -200, 1280, 1024)]);
        assert_eq!(specs[1].rect.x, -1280);
        assert_eq!(specs[1].rect.y, -200);
    }

    #[test]
    fn degenerate_monitors_are_skipped_without_leaving_label_gaps() {
        let specs = plan_overlays(&[
            monitor(0, 0, 0, 1080),
            monitor(0, 0, 1920, 1080),
            monitor(1920, 0, 1920, 0),
            monitor(1920, 0, 1280, 720),
        ]);
        let labels: Vec<&str> = specs.iter().map(|s| s.label.as_str()).collect();
        assert_eq!(labels, vec!["overlay-0", "overlay-1"]);
        assert_eq!(specs[1].rect, monitor(1920, 0, 1280, 720));
    }

    #[test]
    fn no_monitors_means_no_overlays() {
        assert!(plan_overlays(&[]).is_empty());
    }

    #[test]
    fn every_planned_label_matches_the_overlay_prefix() {
        for spec in plan_overlays(&[monitor(0, 0, 10, 10), monitor(10, 0, 10, 10)]) {
            assert!(spec.label.starts_with(OVERLAY_LABEL_PREFIX));
        }
    }

    #[test]
    fn overlay_info_reports_window_count_and_compositing() {
        let registry = OverlayRegistry {
            labels: vec!["overlay-0".to_string(), "overlay-1".to_string()],
            composited: true,
        };
        let info = OverlayInfo::from(&registry);
        assert_eq!(
            info,
            OverlayInfo {
                count: 2,
                composited: true
            }
        );

        let json = serde_json::to_value(&info).expect("serialise");
        assert_eq!(json["count"], 2);
        assert_eq!(json["composited"], true);
    }

    #[test]
    fn an_uncomposited_display_reports_zero_windows() {
        let info = OverlayInfo::from(&OverlayRegistry::default());
        assert_eq!(
            info,
            OverlayInfo {
                count: 0,
                composited: false
            }
        );
    }
}
