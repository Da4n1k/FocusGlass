//! Команды IPC. Все возвращают `Result<T, AppError>`.

use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, State, Window};

use crate::bci::BrainBitDriver;
use crate::distraction::{
    DistractionConfig, DistractionState, DistractionStatus, ForegroundWindowInfo,
};
use crate::error::{AppError, AppResult};
use crate::overlay::{self, OverlayController, OverlayFrame, PixelRect, Rect};
use crate::storage::{SessionRecord, SessionStore};

/// Флаг регистрации глобального хоткея Ctrl+Shift+G для выхода из click-through.
#[derive(Default)]
pub struct RestoreShortcutState(pub AtomicBool);

/// Click-through включается только при наличии способа вернуть управление (хоткей или трей).
pub fn ensure_click_through_allowed(enabled: bool, can_restore: bool) -> AppResult<()> {
    if enabled && !can_restore {
        return Err(AppError::ClickThroughUnavailable);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Устройство (BrainBit BLE через NeuroSDK2 + режим симулятора)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceStatusResponse {
    pub connected: bool,
    pub device_source: String,
    pub connection_state: String,
    pub battery_percentage: u8,
    pub device_name: String,
    pub sampling_rate_hz: u32,
    pub status_message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub device_address: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sdk_available: Option<bool>,
}

impl DeviceStatusResponse {
    pub fn simulator() -> Self {
        Self {
            connected: true,
            device_source: "simulator".to_string(),
            connection_state: "simulated".to_string(),
            battery_percentage: 100,
            device_name: "Synthetic EEG Generator (250 Hz)".to_string(),
            sampling_rate_hz: 250,
            status_message: "Synthetic 4-channel EEG stream active (demo/testing mode)."
                .to_string(),
            stream_mode: None,
            device_address: None,
            serial_number: None,
            sdk_available: None,
        }
    }

    pub fn bluetooth_pending() -> Self {
        Self::bluetooth_pending_with_reason(None)
    }

    pub fn bluetooth_pending_with_reason(reason: Option<String>) -> Self {
        let message = reason.unwrap_or_else(|| {
            "NeuroSDK2 library is unavailable in this runtime. Switch to Simulator or install neurosdk2-x64.dll."
                .to_string()
        });
        Self {
            connected: false,
            device_source: "bluetooth".to_string(),
            connection_state: "sdk_unavailable".to_string(),
            battery_percentage: 0,
            device_name: "BrainBit BLE (not connected)".to_string(),
            sampling_rate_hz: 250,
            status_message: message,
            stream_mode: Some("idle".to_string()),
            device_address: None,
            serial_number: None,
            sdk_available: Some(false),
        }
    }

    pub fn bluetooth_ready() -> Self {
        Self {
            connected: false,
            device_source: "bluetooth".to_string(),
            connection_state: "disconnected".to_string(),
            battery_percentage: 0,
            device_name: "BrainBit BLE (not connected)".to_string(),
            sampling_rate_hz: 250,
            status_message:
                "NeuroSDK2 ready. Turn on BrainBit and click «Scan BrainBit BLE» to connect."
                    .to_string(),
            stream_mode: Some("idle".to_string()),
            device_address: None,
            serial_number: None,
            sdk_available: Some(true),
        }
    }

    /// Преобразует имя источника сигнала в статус; неизвестные значения отвергаются с ошибкой.
    #[cfg(test)]
    pub fn for_source(source: &str) -> AppResult<Self> {
        match source {
            "simulator" => Ok(Self::simulator()),
            "bluetooth" => Ok(Self::bluetooth_pending()),
            other => Err(AppError::UnknownDeviceSource(other.to_string())),
        }
    }
}

pub struct DeviceManagerState(pub Mutex<String>);

impl Default for DeviceManagerState {
    fn default() -> Self {
        Self(Mutex::new("simulator".to_string()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredBrainBitDevice {
    pub name: String,
    pub address: String,
    pub rssi: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub serial_number: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub family: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainBitScanResponse {
    pub sdk_available: bool,
    pub devices: Vec<DiscoveredBrainBitDevice>,
    pub message: String,
}

#[tauri::command]
pub fn get_device_status(
    state: State<'_, DeviceManagerState>,
    driver: State<'_, BrainBitDriver>,
) -> AppResult<DeviceStatusResponse> {
    let source = state
        .0
        .lock()
        .map_err(|_| AppError::LockPoisoned("device state"))?
        .clone();
    if source == "bluetooth" {
        Ok(driver.bluetooth_status())
    } else {
        Ok(DeviceStatusResponse::simulator())
    }
}

#[tauri::command]
pub async fn set_device_source(
    source: String,
    state: State<'_, DeviceManagerState>,
    driver: State<'_, BrainBitDriver>,
) -> AppResult<DeviceStatusResponse> {
    let validated = match source.as_str() {
        "simulator" | "bluetooth" => source,
        other => return Err(AppError::UnknownDeviceSource(other.to_string())),
    };

    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| AppError::LockPoisoned("device state"))?;
        *guard = validated.clone();
    }

    if validated == "simulator" {
        let drv = driver.inner().clone();
        let _ = tauri::async_runtime::spawn_blocking(move || drv.disconnect()).await;
        Ok(DeviceStatusResponse::simulator())
    } else {
        Ok(driver.bluetooth_status())
    }
}

#[tauri::command]
pub async fn scan_brainbit_devices(
    duration_ms: Option<u64>,
    driver: State<'_, BrainBitDriver>,
) -> AppResult<BrainBitScanResponse> {
    let drv = driver.inner().clone();
    tauri::async_runtime::spawn_blocking(move || drv.scan(duration_ms))
        .await
        .map_err(|e| AppError::Bci(format!("BLE scan task panicked: {e}")))?
}

#[tauri::command]
pub async fn connect_brainbit(
    address: String,
    initial_mode: Option<String>,
    state: State<'_, DeviceManagerState>,
    driver: State<'_, BrainBitDriver>,
) -> AppResult<DeviceStatusResponse> {
    {
        let mut guard = state
            .0
            .lock()
            .map_err(|_| AppError::LockPoisoned("device state"))?;
        *guard = "bluetooth".to_string();
    }
    let drv = driver.inner().clone();
    tauri::async_runtime::spawn_blocking(move || drv.connect(address, initial_mode))
        .await
        .map_err(|e| AppError::Bci(format!("BLE connect task panicked: {e}")))?
}

#[tauri::command]
pub async fn disconnect_brainbit(
    driver: State<'_, BrainBitDriver>,
) -> AppResult<DeviceStatusResponse> {
    let drv = driver.inner().clone();
    tauri::async_runtime::spawn_blocking(move || drv.disconnect())
        .await
        .map_err(|e| AppError::Bci(format!("BLE disconnect task panicked: {e}")))?
}

#[tauri::command]
pub async fn set_brainbit_mode(
    mode: String,
    driver: State<'_, BrainBitDriver>,
) -> AppResult<DeviceStatusResponse> {
    let drv = driver.inner().clone();
    tauri::async_runtime::spawn_blocking(move || drv.set_mode(mode))
        .await
        .map_err(|e| AppError::Bci(format!("BLE mode switch task panicked: {e}")))?
}

// ---------------------------------------------------------------------------
// Окна и единый оверлей (Windows) + подгонка HUD-окна (Linux)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowState {
    pub click_through: bool,
    pub overlay_enabled: bool,
    pub always_on_top: bool,
}

#[tauri::command]
pub fn get_window_state(app: AppHandle) -> AppResult<WindowState> {
    let (click_through, overlay_enabled) = app
        .state::<OverlayController>()
        .with(|s| (s.click_through, s.enabled))?;
    Ok(WindowState {
        click_through,
        overlay_enabled,
        always_on_top: overlay::main_window(&app)?.is_always_on_top()?,
    })
}

#[tauri::command]
pub fn set_click_through(app: AppHandle, enabled: bool) -> AppResult<bool> {
    overlay::set_click_through(&app, enabled)
}

#[tauri::command]
pub fn set_overlay_enabled(app: AppHandle, enabled: bool) -> AppResult<bool> {
    overlay::set_overlay_enabled(&app, enabled)
}

/// Режим HUD для Windows: панель прячется в трей, на экране остаётся оверлей с HUD.
#[tauri::command]
pub fn set_hud_mode(app: AppHandle, enabled: bool) -> AppResult<bool> {
    if enabled {
        overlay::main_window(&app)?.hide()?;
    } else {
        overlay::show_dashboard(&app)?;
    }
    Ok(enabled)
}

#[tauri::command]
pub fn show_dashboard(app: AppHandle) -> AppResult<()> {
    overlay::show_dashboard(&app)
}

#[tauri::command]
pub fn update_overlay(app: AppHandle, frame: OverlayFrame) -> AppResult<()> {
    overlay::publish_frame(&app, frame)
}

#[tauri::command]
pub fn get_overlay_frame(state: State<'_, OverlayController>) -> AppResult<Option<OverlayFrame>> {
    state.with(|s| s.last_frame.clone())
}

/// Оверлей сообщает, где сейчас нарисован HUD (физические пиксели окна).
#[tauri::command]
pub fn set_overlay_hit_region(
    rect: Option<PixelRect>,
    state: State<'_, OverlayController>,
) -> AppResult<()> {
    if let Some(r) = rect {
        let values = [r.x, r.y, r.width, r.height];
        if values.iter().any(|v| !v.is_finite()) || r.width < 0.0 || r.height < 0.0 {
            return Err(AppError::InvalidArgument(
                "HUD hit region must be a finite rectangle".to_string(),
            ));
        }
    }
    state.with(|s| s.hud_rect = rect)
}

const HUD_WIDTH: f64 = 380.0;
const HUD_HEIGHT: f64 = 300.0;
const HUD_MARGIN: f64 = 12.0;

pub fn hud_placement(monitor_x: i32, monitor_y: i32, monitor_width: u32, scale: f64) -> Rect {
    let scale = if scale.is_finite() && scale > 0.0 {
        scale
    } else {
        1.0
    };
    let width = (HUD_WIDTH * scale).round() as u32;
    let height = (HUD_HEIGHT * scale).round() as u32;
    let margin = (HUD_MARGIN * scale).round() as i32;
    let x = monitor_x + monitor_width as i32 - width as i32 - margin;
    Rect {
        x: x.max(monitor_x),
        y: monitor_y + margin,
        width,
        height,
    }
}

const HUD_MIN_SIZE: (u32, u32) = (200, 120);
const HUD_MAX_SIZE: (u32, u32) = (1200, 900);

pub fn clamp_hud_size(width: u32, height: u32) -> (u32, u32) {
    (
        width.clamp(HUD_MIN_SIZE.0, HUD_MAX_SIZE.0),
        height.clamp(HUD_MIN_SIZE.1, HUD_MAX_SIZE.1),
    )
}

pub fn anchor_right_edge(x: i32, old_width: u32, new_width: u32) -> i32 {
    x + old_width as i32 - new_width as i32
}

pub fn clamp_into(rect: Rect, monitor: Rect) -> Rect {
    let max_x = monitor.x + monitor.width as i32 - rect.width as i32;
    let max_y = monitor.y + monitor.height as i32 - rect.height as i32;
    Rect {
        x: rect.x.min(max_x).max(monitor.x),
        y: rect.y.min(max_y).max(monitor.y),
        ..rect
    }
}

pub fn plan_fit(tracked: Rect, actual: Rect, width: u32, height: u32, monitor: Rect) -> Rect {
    let base = if actual.width == tracked.width && actual.height == tracked.height {
        actual
    } else {
        tracked
    };
    clamp_into(
        Rect {
            x: anchor_right_edge(base.x, base.width, width),
            y: base.y,
            width,
            height,
        },
        monitor,
    )
}

fn monitor_rect(monitor: &tauri::Monitor) -> Rect {
    Rect {
        x: monitor.position().x,
        y: monitor.position().y,
        width: monitor.size().width,
        height: monitor.size().height,
    }
}

#[derive(Default)]
pub struct HudGeometry {
    pub dashboard: Option<Rect>,
    pub hud: Option<Rect>,
}

#[derive(Default)]
pub struct HudRestoreState(pub Mutex<HudGeometry>);

fn apply_geometry(window: &Window, rect: Rect) -> AppResult<()> {
    window.set_size(PhysicalSize::new(rect.width, rect.height))?;
    window.set_position(PhysicalPosition::new(rect.x, rect.y))?;
    Ok(())
}

/// Переключение окна `main` в плавающий HUD (используется на Linux без единого окна `overlay`).
#[tauri::command]
pub fn set_overlay_mode(
    window: Window,
    restore: State<'_, HudRestoreState>,
    enabled: bool,
) -> AppResult<bool> {
    let mut geometry = restore
        .0
        .lock()
        .map_err(|_| AppError::LockPoisoned("HUD"))?;

    if enabled {
        let _ = window.unmaximize();
        if geometry.dashboard.is_none() {
            let position = window.outer_position()?;
            let size = window.outer_size()?;
            geometry.dashboard = Some(Rect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            });
        }
        let scale = window.scale_factor()?;
        let monitor = window.current_monitor()?;
        let placement = match monitor {
            Some(m) => clamp_into(
                hud_placement(m.position().x, m.position().y, m.size().width, scale),
                monitor_rect(&m),
            ),
            None => hud_placement(0, 0, 1920, scale),
        };
        apply_geometry(&window, placement)?;
        let _ = window.set_always_on_top(true);
        geometry.hud = Some(placement);
    } else {
        geometry.hud = None;
        if let Some(previous) = geometry.dashboard.take() {
            apply_geometry(&window, previous)?;
        }
    }
    Ok(enabled)
}

#[tauri::command]
pub fn fit_hud_window(
    window: Window,
    restore: State<'_, HudRestoreState>,
    width: u32,
    height: u32,
) -> AppResult<bool> {
    let mut geometry = restore
        .0
        .lock()
        .map_err(|_| AppError::LockPoisoned("HUD"))?;
    let Some(tracked) = geometry.hud else {
        return Ok(false);
    };

    let (width, height) = clamp_hud_size(width, height);
    if tracked.width == width && tracked.height == height {
        return Ok(true);
    }

    let position = window.outer_position()?;
    let size = window.outer_size()?;
    let actual = Rect {
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
    };
    let monitor = window
        .current_monitor()?
        .map(|m| monitor_rect(&m))
        .unwrap_or(Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        });

    let next = plan_fit(tracked, actual, width, height, monitor);
    apply_geometry(&window, next)?;
    geometry.hud = Some(next);
    Ok(true)
}

#[tauri::command]
pub fn toggle_always_on_top(app: AppHandle, enabled: bool) -> AppResult<bool> {
    overlay::main_window(&app)?.set_always_on_top(enabled)?;
    Ok(enabled)
}

#[tauri::command]
pub fn minimize_window(app: AppHandle) -> AppResult<()> {
    overlay::main_window(&app)?.minimize()?;
    Ok(())
}

#[tauri::command]
pub fn close_window(app: AppHandle) -> AppResult<()> {
    crate::request_quit(&app);
    Ok(())
}

/// Завершает приложение. Фронтенд вызывает её после сохранения активной сессии.
#[tauri::command]
pub fn quit_app(app: AppHandle, driver: State<'_, BrainBitDriver>) {
    driver.shutdown();
    app.exit(0);
}

// ---------------------------------------------------------------------------
// История сессий (SQLite)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn sessions_upsert(record: SessionRecord, store: State<'_, SessionStore>) -> AppResult<()> {
    store.upsert(&record)
}

#[tauri::command]
pub fn sessions_list(
    limit: Option<u32>,
    store: State<'_, SessionStore>,
) -> AppResult<Vec<SessionRecord>> {
    store.list(limit.unwrap_or(200))
}

#[tauri::command]
pub fn sessions_import(
    records: Vec<SessionRecord>,
    store: State<'_, SessionStore>,
) -> AppResult<usize> {
    store.import(&records)
}

#[tauri::command]
pub fn sessions_delete(id: String, store: State<'_, SessionStore>) -> AppResult<bool> {
    store.delete(&id)
}

#[tauri::command]
pub fn sessions_clear(store: State<'_, SessionStore>) -> AppResult<usize> {
    store.clear()
}

// ---------------------------------------------------------------------------
// Умная блокировка отвлекающих приложений
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn set_distraction_config(
    config: DistractionConfig,
    state: State<'_, Arc<DistractionState>>,
) -> AppResult<DistractionStatus> {
    state.set_config(config)
}

#[tauri::command]
pub fn get_foreground_window(
    state: State<'_, Arc<DistractionState>>,
) -> AppResult<Option<ForegroundWindowInfo>> {
    state.last()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::Ordering;

    #[test]
    fn click_through_requires_the_emergency_shortcut() {
        let err = ensure_click_through_allowed(true, false)
            .expect_err("click-through without restore shortcut must fail");
        assert_eq!(err.kind(), "click_through_unavailable");
        assert!(ensure_click_through_allowed(true, true).is_ok());
    }

    #[test]
    fn leaving_click_through_is_always_allowed() {
        assert!(ensure_click_through_allowed(false, false).is_ok());
        assert!(ensure_click_through_allowed(false, true).is_ok());
    }

    #[test]
    fn known_device_sources_map_to_their_status() {
        let sim = DeviceStatusResponse::for_source("simulator").expect("simulator is known");
        assert!(sim.connected);
        assert_eq!(sim.device_source, "simulator");

        let ble = DeviceStatusResponse::for_source("bluetooth").expect("bluetooth is known");
        assert!(!ble.connected);
        assert_eq!(ble.connection_state, "sdk_unavailable");
    }

    #[test]
    fn unknown_device_source_is_rejected_not_defaulted() {
        let err = DeviceStatusResponse::for_source("usb").expect_err("usb must be rejected");
        assert_eq!(err.kind(), "unknown_device_source");
    }

    #[test]
    fn device_status_uses_camel_case_contract() {
        let json = serde_json::to_value(DeviceStatusResponse::bluetooth_pending()).expect("json");
        assert_eq!(json["connected"], false);
        assert_eq!(json["connectionState"], "sdk_unavailable");
        assert_eq!(json["samplingRateHz"], 250);
    }

    #[test]
    fn device_status_serialises_with_camel_case_keys() {
        let json = serde_json::to_value(DeviceStatusResponse::simulator()).expect("serialise");
        assert_eq!(json["deviceSource"], "simulator");
        assert_eq!(json["samplingRateHz"], 250);
        assert!(json.get("device_source").is_none());

        let ready = serde_json::to_value(DeviceStatusResponse::bluetooth_ready()).expect("ready");
        assert_eq!(ready["connected"], false);
        assert_eq!(ready["connectionState"], "disconnected");
        assert_eq!(ready["sdkAvailable"], true);
        assert_eq!(ready["streamMode"], "idle");
    }

    #[test]
    fn hud_sits_in_the_top_right_corner_of_the_monitor() {
        let rect = hud_placement(0, 0, 1920, 1.0);
        assert_eq!((rect.width, rect.height), (380, 300));
        assert_eq!(rect.x, 1920 - 380 - 12);
        assert_eq!(rect.y, 12);
    }

    #[test]
    fn hud_follows_the_monitor_it_is_on() {
        let right = hud_placement(1920, 0, 2560, 1.0);
        assert_eq!(right.x, 1920 + 2560 - 380 - 12);
        let above = hud_placement(0, -1080, 1920, 1.0);
        assert_eq!(above.y, -1080 + 12);
    }

    #[test]
    fn hud_scales_with_the_display_factor() {
        let rect = hud_placement(0, 0, 2560, 1.25);
        assert_eq!((rect.width, rect.height), (475, 375));
        assert_eq!(rect.x, 2560 - 475 - 15);
        assert_eq!(rect.y, 15);
    }

    #[test]
    fn hud_never_leaves_a_monitor_narrower_than_itself() {
        let rect = hud_placement(100, 0, 300, 1.0);
        assert_eq!(rect.x, 100);
    }

    #[test]
    fn hud_size_requests_from_the_webview_are_clamped() {
        assert_eq!(clamp_hud_size(450, 329), (450, 329));
        assert_eq!(clamp_hud_size(0, 0), (200, 120));
        assert_eq!(clamp_hud_size(u32::MAX, u32::MAX), (1200, 900));
        assert_eq!(clamp_hud_size(100, 5000), (200, 900));
    }

    #[test]
    fn growing_or_shrinking_keeps_the_right_edge_fixed() {
        let x = anchor_right_edge(1528, 380, 450);
        assert_eq!(x + 450, 1528 + 380);
        assert_eq!(anchor_right_edge(1000, 500, 300) + 300, 1500);
        assert_eq!(anchor_right_edge(1000, 400, 400), 1000);
    }

    fn rect(x: i32, y: i32, width: u32, height: u32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }

    const SCREEN: Rect = Rect {
        x: 0,
        y: 0,
        width: 2560,
        height: 1600,
    };

    #[test]
    fn clamp_into_keeps_a_window_on_the_monitor() {
        assert_eq!(clamp_into(rect(2436, 12, 360, 269), SCREEN), rect(2200, 12, 360, 269));
        assert_eq!(clamp_into(rect(-50, -9, 360, 269), SCREEN), rect(0, 0, 360, 269));
        assert_eq!(clamp_into(rect(100, 1500, 360, 269), SCREEN), rect(100, 1331, 360, 269));
        assert_eq!(clamp_into(rect(100, 100, 360, 269), SCREEN), rect(100, 100, 360, 269));
        assert_eq!(clamp_into(rect(500, 500, 3000, 2000), SCREEN), rect(0, 0, 3000, 2000));
    }

    #[test]
    fn fitting_keeps_the_right_edge_where_it_was_requested() {
        let tracked = rect(2168, 12, 380, 300);
        let next = plan_fit(tracked, tracked, 360, 269, SCREEN);
        assert_eq!(next, rect(2188, 12, 360, 269));
        assert_eq!(next.x + 360, 2168 + 380);
    }

    #[test]
    fn a_stale_report_of_the_old_dashboard_geometry_is_ignored() {
        let tracked = rect(2168, 12, 380, 300);
        let stale = rect(660, 390, 1240, 820);
        let next = plan_fit(tracked, stale, 360, 269, SCREEN);
        assert_eq!(next, rect(2188, 12, 360, 269));
    }

    #[test]
    fn a_drag_is_adopted_once_the_window_has_the_requested_size() {
        let tracked = rect(2168, 12, 380, 300);
        let dragged = rect(1000, 400, 380, 300);
        let next = plan_fit(tracked, dragged, 450, 329, SCREEN);
        assert_eq!(next, rect(930, 400, 450, 329));
        assert_eq!(next.x + 450, 1000 + 380, "right edge of the dragged window is kept");
    }

    #[test]
    fn fitting_never_leaves_the_monitor_even_with_a_bad_report() {
        let tracked = rect(2400, 12, 380, 300);
        let next = plan_fit(tracked, tracked, 360, 269, SCREEN);
        assert!(next.x >= 0 && next.x + next.width as i32 <= 2560);
        assert!(next.y >= 0 && next.y + next.height as i32 <= 1600);
    }

    #[test]
    fn hud_ignores_a_nonsensical_scale_factor() {
        for bad in [0.0, -2.0, f64::NAN, f64::INFINITY] {
            let rect = hud_placement(0, 0, 1920, bad);
            assert_eq!((rect.width, rect.height), (380, 300), "scale {bad}");
        }
    }

    #[test]
    fn hud_is_much_smaller_than_a_screen_so_it_cannot_cover_the_desktop() {
        let rect = hud_placement(0, 0, 1920, 1.0);
        assert!(u64::from(rect.width) * u64::from(rect.height) < 1920 * 1080 / 10);
    }

    #[test]
    fn restore_shortcut_state_defaults_to_unregistered() {
        let state = RestoreShortcutState::default();
        assert!(!state.0.load(Ordering::SeqCst));
    }
}
