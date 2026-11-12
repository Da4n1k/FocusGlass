use crate::error::AppError;
use crate::overlay::Rect;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{PhysicalPosition, PhysicalSize, State, Window};

/// Whether the global Ctrl+Shift+G "restore window" shortcut is registered.
/// It is the only way out of click-through mode, so click-through requires it.
#[derive(Default)]
pub struct RestoreShortcutState(pub AtomicBool);

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
        }
    }

    pub fn bluetooth_pending() -> Self {
        Self {
            connected: false,
            device_source: "bluetooth".to_string(),
            connection_state: "sdk_unavailable".to_string(),
            battery_percentage: 0,
            device_name: "BrainBit BLE (not connected)".to_string(),
            sampling_rate_hz: 250,
            status_message:
                "NeuroSDK2 adapter is not linked in this build yet. Switch to Simulator to test biofeedback."
                    .to_string(),
        }
    }

    /// Maps a frontend device-source name to its status; unknown names are an error
    /// rather than a silent fallback to the simulator.
    pub fn for_source(source: &str) -> Result<Self, AppError> {
        match source {
            "simulator" => Ok(Self::simulator()),
            "bluetooth" => Ok(Self::bluetooth_pending()),
            other => Err(AppError::UnknownDeviceSource(other.to_string())),
        }
    }
}

pub struct DeviceManagerState(pub Mutex<DeviceStatusResponse>);

impl Default for DeviceManagerState {
    fn default() -> Self {
        Self(Mutex::new(DeviceStatusResponse::simulator()))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredBrainBitDevice {
    pub name: String,
    pub address: String,
    pub rssi: Option<i16>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainBitScanResponse {
    pub sdk_available: bool,
    pub devices: Vec<DiscoveredBrainBitDevice>,
    pub message: String,
}

/// Click-through may only be switched on while the emergency exit shortcut is registered.
fn ensure_click_through_allowed(enabled: bool, shortcut_registered: bool) -> Result<(), AppError> {
    if enabled && !shortcut_registered {
        return Err(AppError::ClickThroughUnavailable);
    }
    Ok(())
}

#[tauri::command]
pub fn set_click_through(
    window: Window,
    enabled: bool,
    shortcut: State<'_, RestoreShortcutState>,
) -> Result<bool, AppError> {
    ensure_click_through_allowed(enabled, shortcut.0.load(Ordering::SeqCst))?;
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| AppError::window("set ignore cursor events", e))?;
    Ok(enabled)
}

#[tauri::command]
pub fn get_device_status(
    state: State<'_, DeviceManagerState>,
) -> Result<DeviceStatusResponse, AppError> {
    let guard = state
        .0
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("Device"))?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn set_device_source(
    source: String,
    state: State<'_, DeviceManagerState>,
) -> Result<DeviceStatusResponse, AppError> {
    let next = DeviceStatusResponse::for_source(&source)?;
    let mut guard = state
        .0
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("Device"))?;
    *guard = next;
    Ok(guard.clone())
}

#[tauri::command]
pub fn scan_brainbit_devices() -> Result<BrainBitScanResponse, AppError> {
    // Placeholder IPC boundary for NeuroSDK2 BLE scanner (BrainBit / BrainBitBlack / BrainBit 2).
    // Returns empty list instead of fake devices until neurosdk2 FFI is linked.
    Ok(BrainBitScanResponse {
        sdk_available: false,
        devices: Vec::new(),
        message: "NeuroSDK2 BLE transport is not linked in src-tauri yet.".to_string(),
    })
}

/// Logical size of the floating HUD window: the 320 px card plus its margins and glow.
const HUD_WIDTH: f64 = 380.0;
const HUD_HEIGHT: f64 = 300.0;
/// Gap between the HUD window and the screen edge, in logical pixels.
const HUD_MARGIN: f64 = 12.0;

/// Where the HUD window goes: the top-right corner of the monitor it is on.
/// Takes the monitor's physical origin and width and the display scale factor.
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
        // A monitor narrower than the HUD must not push the window off its left edge.
        x: x.max(monitor_x),
        y: monitor_y + margin,
        width,
        height,
    }
}

const HUD_MIN_SIZE: (u32, u32) = (200, 120);
const HUD_MAX_SIZE: (u32, u32) = (1200, 900);

/// The webview reports its content size; it is untrusted input for a native window resize.
pub fn clamp_hud_size(width: u32, height: u32) -> (u32, u32) {
    (
        width.clamp(HUD_MIN_SIZE.0, HUD_MAX_SIZE.0),
        height.clamp(HUD_MIN_SIZE.1, HUD_MAX_SIZE.1),
    )
}

/// New x for a window that changes width while its right edge stays where it is.
pub fn anchor_right_edge(x: i32, old_width: u32, new_width: u32) -> i32 {
    x + old_width as i32 - new_width as i32
}

/// Geometry of the dashboard window, remembered while the window is shrunk to the HUD.
#[derive(Default)]
pub struct HudRestoreState(pub Mutex<Option<Rect>>);

fn apply_geometry(window: &Window, rect: Rect) -> Result<(), AppError> {
    window
        .set_size(PhysicalSize::new(rect.width, rect.height))
        .map_err(|e| AppError::window("resize window", e))?;
    window
        .set_position(PhysicalPosition::new(rect.x, rect.y))
        .map_err(|e| AppError::window("move window", e))
}

/// Switches the app window between the dashboard and the floating HUD. The HUD is a small
/// window in the screen corner, never a full-screen one: a full-screen window would swallow
/// every mouse click meant for the desktop and for other applications.
#[tauri::command]
pub fn set_overlay_mode(
    window: Window,
    restore: State<'_, HudRestoreState>,
    enabled: bool,
) -> Result<bool, AppError> {
    let mut saved = restore
        .0
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("HUD"))?;

    if enabled {
        // A maximized window ignores resizing.
        let _ = window.unmaximize();

        if saved.is_none() {
            let position = window
                .outer_position()
                .map_err(|e| AppError::window("read window position", e))?;
            let size = window
                .outer_size()
                .map_err(|e| AppError::window("read window size", e))?;
            *saved = Some(Rect {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            });
        }

        let scale = window
            .scale_factor()
            .map_err(|e| AppError::window("read display scale", e))?;
        let monitor = window
            .current_monitor()
            .map_err(|e| AppError::window("find current monitor", e))?;
        let placement = match monitor {
            Some(m) => hud_placement(m.position().x, m.position().y, m.size().width, scale),
            None => hud_placement(0, 0, 1920, scale),
        };
        apply_geometry(&window, placement)?;
    } else if let Some(previous) = saved.take() {
        apply_geometry(&window, previous)?;
    }
    Ok(enabled)
}

/// Fits the floating HUD to its content, keeping its top-right corner where it currently is
/// (wherever the window manager or the user put it). Does nothing in dashboard mode.
#[tauri::command]
pub fn fit_hud_window(
    window: Window,
    restore: State<'_, HudRestoreState>,
    width: u32,
    height: u32,
) -> Result<bool, AppError> {
    let in_hud = restore
        .0
        .lock()
        .map_err(|_| AppError::StateLockPoisoned("HUD"))?
        .is_some();
    if !in_hud {
        return Ok(false);
    }

    let (width, height) = clamp_hud_size(width, height);
    let position = window
        .outer_position()
        .map_err(|e| AppError::window("read window position", e))?;
    let size = window
        .outer_size()
        .map_err(|e| AppError::window("read window size", e))?;
    if size.width == width && size.height == height {
        return Ok(true);
    }

    window
        .set_size(PhysicalSize::new(width, height))
        .map_err(|e| AppError::window("resize window", e))?;
    window
        .set_position(PhysicalPosition::new(
            anchor_right_edge(position.x, size.width, width),
            position.y,
        ))
        .map_err(|e| AppError::window("move window", e))?;
    Ok(true)
}

#[tauri::command]
pub fn toggle_always_on_top(window: Window, enabled: bool) -> Result<bool, AppError> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| AppError::window("set always on top", e))?;
    Ok(enabled)
}

#[tauri::command]
pub fn minimize_window(window: Window) -> Result<(), AppError> {
    window
        .minimize()
        .map_err(|e| AppError::window("minimize window", e))
}

#[tauri::command]
pub fn close_window(window: Window) -> Result<(), AppError> {
    window
        .close()
        .map_err(|e| AppError::window("close window", e))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_through_requires_the_emergency_shortcut() {
        assert_eq!(
            ensure_click_through_allowed(true, false),
            Err(AppError::ClickThroughUnavailable)
        );
        assert_eq!(ensure_click_through_allowed(true, true), Ok(()));
    }

    #[test]
    fn leaving_click_through_is_always_allowed() {
        // Releasing the window must work even when the shortcut could not be registered.
        assert_eq!(ensure_click_through_allowed(false, false), Ok(()));
        assert_eq!(ensure_click_through_allowed(false, true), Ok(()));
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
        assert_eq!(err, AppError::UnknownDeviceSource("usb".to_string()));
    }

    #[test]
    fn device_status_serialises_with_camel_case_keys() {
        let json = serde_json::to_value(DeviceStatusResponse::simulator()).expect("serialise");
        assert_eq!(json["deviceSource"], "simulator");
        assert_eq!(json["samplingRateHz"], 250);
        assert!(json.get("device_source").is_none());
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
        // Second monitor to the right, and one above the origin.
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
        // 380 wide at x=1528 ends at 1908; a 450 wide window must still end there.
        let x = anchor_right_edge(1528, 380, 450);
        assert_eq!(x + 450, 1528 + 380);
        assert_eq!(anchor_right_edge(1000, 500, 300) + 300, 1500);
        assert_eq!(anchor_right_edge(1000, 400, 400), 1000);
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
