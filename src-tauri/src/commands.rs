use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Window};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceStatusResponse {
    pub connected: bool,
    #[serde(rename = "deviceSource")]
    pub device_source: String,
    #[serde(rename = "batteryPercentage")]
    pub battery_percentage: u8,
    #[serde(rename = "deviceName")]
    pub device_name: String,
    #[serde(rename = "samplingRateHz")]
    pub sampling_rate_hz: u32,
}

#[tauri::command]
pub fn set_click_through(window: Window, enabled: bool) -> Result<bool, String> {
    window
        .set_ignore_cursor_events(enabled)
        .map_err(|e| format!("Failed to set ignore cursor events: {}", e))?;
    Ok(enabled)
}

#[tauri::command]
pub fn get_device_status() -> DeviceStatusResponse {
    DeviceStatusResponse {
        connected: true,
        device_source: "simulator".to_string(),
        battery_percentage: 95,
        device_name: "BrainBit Virtual Headband".to_string(),
        sampling_rate_hz: 250,
    }
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
