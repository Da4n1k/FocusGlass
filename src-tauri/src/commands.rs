use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{State, Window};

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

#[tauri::command]
pub fn set_click_through(window: Window, enabled: bool) -> Result<bool, String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| format!("Failed to set ignore cursor events: {}", e))?;
    Ok(enabled)
}

#[tauri::command]
pub fn get_device_status(
    state: State<'_, DeviceManagerState>,
) -> Result<DeviceStatusResponse, String> {
    let guard = state
        .0
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?;
    Ok(guard.clone())
}

#[tauri::command]
pub fn set_device_source(
    source: String,
    state: State<'_, DeviceManagerState>,
) -> Result<DeviceStatusResponse, String> {
    let mut guard = state
        .0
        .lock()
        .map_err(|_| "Device state lock poisoned".to_string())?;

    *guard = if source == "bluetooth" {
        DeviceStatusResponse::bluetooth_pending()
    } else {
        DeviceStatusResponse::simulator()
    };

    Ok(guard.clone())
}

#[tauri::command]
pub fn scan_brainbit_devices() -> Result<BrainBitScanResponse, String> {
    // Placeholder IPC boundary for NeuroSDK2 BLE scanner (BrainBit / BrainBitBlack / BrainBit 2).
    // Returns empty list instead of fake devices until neurosdk2 FFI is linked.
    Ok(BrainBitScanResponse {
        sdk_available: false,
        devices: Vec::new(),
        message: "NeuroSDK2 BLE transport is not linked in src-tauri yet.".to_string(),
    })
}

#[tauri::command]
pub fn toggle_always_on_top(window: Window, enabled: bool) -> Result<bool, String> {
    window
        .set_always_on_top(enabled)
        .map_err(|e| format!("Failed to set always on top: {}", e))?;
    Ok(enabled)
}

#[tauri::command]
pub fn minimize_window(window: Window) -> Result<(), String> {
    window
        .minimize()
        .map_err(|e| format!("Failed to minimize window: {}", e))
}

#[tauri::command]
pub fn close_window(window: Window) -> Result<(), String> {
    window
        .close()
        .map_err(|e| format!("Failed to close window: {}", e))
}
