//! Runtime dynamic FFI bindings for BrainBit NeuroSDK2 (`cmn_type.h` / `sdk_api.h`).
#![allow(dead_code)]

use std::env;
use std::mem::size_of;
use std::os::raw::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};

use libloading::Library;

use crate::error::{AppError, AppResult};

pub const ERR_MSG_LEN: usize = 512;
pub const SENSOR_NAME_LEN: usize = 256;
pub const SENSOR_ADR_LEN: usize = 128;
pub const SENSOR_SN_LEN: usize = 128;
pub const SENSOR_CHANNEL_NAME_LEN: usize = 8;

pub const SENSOR_LE_BRAINBIT: u8 = 3;
pub const SENSOR_LE_BRAINBIT_BLACK: u8 = 4;
pub const SENSOR_LE_HEADBAND: u8 = 11;
pub const SENSOR_LE_BRAINBIT2: u8 = 18;
pub const SENSOR_LE_BRAINBIT_PRO: u8 = 19;
pub const SENSOR_LE_BRAINBIT_FLEX: u8 = 20;

pub const BRAINBIT_SCAN_FILTERS: [u8; 6] = [
    SENSOR_LE_BRAINBIT,
    SENSOR_LE_BRAINBIT_BLACK,
    SENSOR_LE_HEADBAND,
    SENSOR_LE_BRAINBIT2,
    SENSOR_LE_BRAINBIT_PRO,
    SENSOR_LE_BRAINBIT_FLEX,
];

pub const COMMAND_START_SIGNAL: i8 = 0;
pub const COMMAND_STOP_SIGNAL: i8 = 1;
pub const COMMAND_START_RESIST: i8 = 2;
pub const COMMAND_STOP_RESIST: i8 = 3;

pub const STATE_IN_RANGE: i8 = 0;
pub const STATE_OUT_OF_RANGE: i8 = 1;

pub const EEG_CH_ID_O1: u8 = 1;
pub const EEG_CH_ID_T3: u8 = 7;
pub const EEG_CH_ID_T4: u8 = 10;
pub const EEG_CH_ID_O2: u8 = 16;

pub enum SensorScanner {}
pub enum Sensor {}
pub type ListenerHandle = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct OpStatus {
    pub success: u8,
    pub error: u32,
    pub error_msg: [c_char; ERR_MSG_LEN],
}

impl Default for OpStatus {
    fn default() -> Self {
        Self {
            success: 0,
            error: 0,
            error_msg: [0; ERR_MSG_LEN],
        }
    }
}

impl OpStatus {
    pub fn check(&self, context: &str) -> AppResult<()> {
        if self.success != 0 {
            return Ok(());
        }
        let msg = c_char_array_to_string(&self.error_msg);
        let detail = if msg.is_empty() {
            format!("{context} failed (NeuroSDK2 error code {})", self.error)
        } else {
            format!("{context}: {msg} (code {})", self.error)
        };
        Err(AppError::Bci(detail))
    }
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct SensorInfo {
    pub sens_family: u8,
    pub sens_model: u8,
    pub name: [c_char; SENSOR_NAME_LEN],
    pub address: [c_char; SENSOR_ADR_LEN],
    pub serial_number: [c_char; SENSOR_SN_LEN],
    pub pairing_required: u8,
    pub rssi: i16,
}

impl Default for SensorInfo {
    fn default() -> Self {
        Self {
            sens_family: 0,
            sens_model: 0,
            name: [0; SENSOR_NAME_LEN],
            address: [0; SENSOR_ADR_LEN],
            serial_number: [0; SENSOR_SN_LEN],
            pairing_required: 0,
            rssi: 0,
        }
    }
}

impl SensorInfo {
    pub fn name_string(&self) -> String {
        let s = c_char_array_to_string(&self.name);
        if s.is_empty() {
            family_display_name(self.sens_family).to_string()
        } else {
            s
        }
    }

    pub fn address_string(&self) -> String {
        c_char_array_to_string(&self.address)
    }

    pub fn serial_string(&self) -> String {
        c_char_array_to_string(&self.serial_number)
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct BrainBitSignalData {
    pub pack_num: u32,
    pub marker: u8,
    pub o1: f64,
    pub o2: f64,
    pub t3: f64,
    pub t4: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct BrainBitResistData {
    pub o1: f64,
    pub o2: f64,
    pub t3: f64,
    pub t4: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct HeadbandSignalData {
    pub pack_num: u32,
    pub marker: u8,
    pub o1: f64,
    pub o2: f64,
    pub t3: f64,
    pub t4: f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct HeadbandResistData {
    pub pack_num: u32,
    pub o1: f64,
    pub o2: f64,
    pub t3: f64,
    pub t4: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct EEGChannelInfo {
    pub id: u8,
    pub ch_type: u8,
    pub name: [c_char; SENSOR_CHANNEL_NAME_LEN],
    pub num: u8,
}

impl Default for EEGChannelInfo {
    fn default() -> Self {
        Self {
            id: 0,
            ch_type: 0,
            name: [0; SENSOR_CHANNEL_NAME_LEN],
            num: 0,
        }
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct SignalChannelsData {
    pub pack_num: u32,
    pub marker: u8,
    pub sz_samples: u32,
    pub samples: *mut f64,
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct ResistRefChannelsData {
    pub pack_num: u32,
    pub sz_samples: u32,
    pub sz_referents: u32,
    pub samples: *mut f64,
    pub referents: *mut f64,
}

pub fn family_display_name(family: u8) -> &'static str {
    match family {
        SENSOR_LE_BRAINBIT => "BrainBit",
        SENSOR_LE_BRAINBIT_BLACK => "BrainBit Black",
        SENSOR_LE_HEADBAND => "Headband",
        SENSOR_LE_BRAINBIT2 => "BrainBit 2",
        SENSOR_LE_BRAINBIT_PRO => "BrainBit Pro",
        SENSOR_LE_BRAINBIT_FLEX => "BrainBit Flex",
        _ => "BrainBit BLE",
    }
}

/// Converts a raw NeuroSDK2 signal sample in Volts to microvolts (`uV`).
#[inline]
pub fn volts_to_microvolts(volts: f64) -> f64 {
    volts * 1_000_000.0
}

pub fn c_char_array_to_string(buf: &[c_char]) -> String {
    let bytes: &[u8] =
        unsafe { std::slice::from_raw_parts(buf.as_ptr().cast::<u8>(), buf.len()) };
    let nul_pos = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..nul_pos]).trim().to_string()
}

type FnCreateScanner = unsafe extern "C" fn(*const u8, i32, *mut OpStatus) -> *mut SensorScanner;
type FnFreeScanner = unsafe extern "C" fn(*mut SensorScanner);
type FnStartScanner = unsafe extern "C" fn(*mut SensorScanner, *mut OpStatus, c_int) -> u8;
type FnStopScanner = unsafe extern "C" fn(*mut SensorScanner, *mut OpStatus) -> u8;
type FnSensorsScanner =
    unsafe extern "C" fn(*mut SensorScanner, *mut SensorInfo, *mut i32, *mut OpStatus) -> u8;
type FnCreateSensor =
    unsafe extern "C" fn(*mut SensorScanner, SensorInfo, *mut OpStatus) -> *mut Sensor;
type FnFreeSensor = unsafe extern "C" fn(*mut Sensor);
type FnConnectSensor = unsafe extern "C" fn(*mut Sensor, *mut OpStatus) -> u8;
type FnDisconnectSensor = unsafe extern "C" fn(*mut Sensor, *mut OpStatus) -> u8;
type FnReadStateSensor = unsafe extern "C" fn(*mut Sensor, *mut i8, *mut OpStatus) -> u8;
type FnIsSupportedCommandSensor = unsafe extern "C" fn(*mut Sensor, i8) -> i8;
type FnExecCommandSensor = unsafe extern "C" fn(*mut Sensor, i8, *mut OpStatus) -> u8;
type FnGetFamilySensor = unsafe extern "C" fn(*mut Sensor) -> u8;
type FnReadBattPowerSensor = unsafe extern "C" fn(*mut Sensor, *mut i32, *mut OpStatus) -> u8;

type BatteryCallback = unsafe extern "C" fn(*mut Sensor, i32, *mut c_void);
type ConnectionStateCallback = unsafe extern "C" fn(*mut Sensor, i8, *mut c_void);
type BrainBitSignalCallback =
    unsafe extern "C" fn(*mut Sensor, *mut BrainBitSignalData, i32, *mut c_void);
type BrainBitResistCallback = unsafe extern "C" fn(*mut Sensor, BrainBitResistData, *mut c_void);
type HeadbandSignalCallback =
    unsafe extern "C" fn(*mut Sensor, *mut HeadbandSignalData, i32, *mut c_void);
type HeadbandResistCallback = unsafe extern "C" fn(*mut Sensor, HeadbandResistData, *mut c_void);
type BrainBit2SignalCallback =
    unsafe extern "C" fn(*mut Sensor, *mut SignalChannelsData, i32, *mut c_void);
type BrainBit2ResistCallback =
    unsafe extern "C" fn(*mut Sensor, *mut ResistRefChannelsData, i32, *mut c_void);

type FnAddBatteryCallback = unsafe extern "C" fn(
    *mut Sensor,
    BatteryCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnAddConnectionStateCallback = unsafe extern "C" fn(
    *mut Sensor,
    ConnectionStateCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnAddBrainBitSignalCallback = unsafe extern "C" fn(
    *mut Sensor,
    BrainBitSignalCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnAddBrainBitResistCallback = unsafe extern "C" fn(
    *mut Sensor,
    BrainBitResistCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnAddHeadbandSignalCallback = unsafe extern "C" fn(
    *mut Sensor,
    HeadbandSignalCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnAddHeadbandResistCallback = unsafe extern "C" fn(
    *mut Sensor,
    HeadbandResistCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnReadSupportedChannelsBrainBit2 =
    unsafe extern "C" fn(*mut Sensor, *mut EEGChannelInfo, *mut i32, *mut OpStatus) -> u8;
type FnAddBrainBit2SignalCallback = unsafe extern "C" fn(
    *mut Sensor,
    BrainBit2SignalCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnAddBrainBit2ResistCallback = unsafe extern "C" fn(
    *mut Sensor,
    BrainBit2ResistCallback,
    *mut ListenerHandle,
    *mut c_void,
    *mut OpStatus,
) -> u8;
type FnRemoveListener = unsafe extern "C" fn(ListenerHandle);

/// Dynamically loaded NeuroSDK2 C symbol table.
pub struct NeuroSdkApi {
    _library: Library,
    pub create_scanner: FnCreateScanner,
    pub free_scanner: FnFreeScanner,
    pub start_scanner: FnStartScanner,
    pub stop_scanner: FnStopScanner,
    pub sensors_scanner: FnSensorsScanner,
    pub create_sensor: FnCreateSensor,
    pub free_sensor: FnFreeSensor,
    pub connect_sensor: FnConnectSensor,
    pub disconnect_sensor: FnDisconnectSensor,
    pub read_state_sensor: FnReadStateSensor,
    pub is_supported_command_sensor: FnIsSupportedCommandSensor,
    pub exec_command_sensor: FnExecCommandSensor,
    pub get_family_sensor: FnGetFamilySensor,
    pub read_batt_power_sensor: FnReadBattPowerSensor,
    pub add_battery_callback: FnAddBatteryCallback,
    pub remove_battery_callback: FnRemoveListener,
    pub add_connection_state_callback: FnAddConnectionStateCallback,
    pub remove_connection_state_callback: FnRemoveListener,
    pub add_signal_data_callback_brainbit: FnAddBrainBitSignalCallback,
    pub remove_signal_data_callback_brainbit: FnRemoveListener,
    pub add_resist_callback_brainbit: FnAddBrainBitResistCallback,
    pub remove_resist_callback_brainbit: FnRemoveListener,
    pub add_signal_data_callback_headband: FnAddHeadbandSignalCallback,
    pub remove_signal_data_callback_headband: FnRemoveListener,
    pub add_resist_callback_headband: FnAddHeadbandResistCallback,
    pub remove_resist_callback_headband: FnRemoveListener,
    pub read_supported_channels_brainbit2: FnReadSupportedChannelsBrainBit2,
    pub add_signal_callback_brainbit2: FnAddBrainBit2SignalCallback,
    pub remove_signal_callback_brainbit2: FnRemoveListener,
    pub add_resist_callback_brainbit2: FnAddBrainBit2ResistCallback,
    pub remove_resist_callback_brainbit2: FnRemoveListener,
}

unsafe fn load_symbol<T: Copy>(lib: &Library, name: &[u8]) -> Result<T, String> {
    assert_eq!(size_of::<T>(), size_of::<*const ()>());
    let sym = unsafe { lib.get::<T>(name) }
        .map_err(|e| format!("missing symbol {}: {e}", String::from_utf8_lossy(name)))?;
    Ok(*sym)
}

fn platform_library_names() -> &'static [&'static str] {
    #[cfg(target_os = "windows")]
    {
        &["neurosdk2-x64.dll", "neurosdk2.dll"]
    }
    #[cfg(target_os = "macos")]
    {
        &["libneurosdk2.dylib", "neurosdk2.dylib"]
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        &["libneurosdk2.so", "neurosdk2.so"]
    }
}

pub fn candidate_library_paths(
    app_data_dir: Option<&Path>,
    resource_dir: Option<&Path>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let names = platform_library_names();

    if let Ok(explicit) = env::var("NEUROSDK2_LIB_PATH") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            candidates.push(PathBuf::from(trimmed));
        }
    }

    if let Some(dir) = app_data_dir {
        for name in names {
            candidates.push(dir.join("sdk").join(name));
            candidates.push(dir.join(name));
        }
    }

    if let Some(dir) = resource_dir {
        for name in names {
            candidates.push(dir.join(name));
            candidates.push(dir.join("vendor").join(name));
        }
    }

    if let Ok(exe) = env::current_exe() {
        if let Some(exe_dir) = exe.parent() {
            for name in names {
                candidates.push(exe_dir.join(name));
                candidates.push(exe_dir.join("vendor").join(name));
            }
            for ancestor in exe_dir.ancestors().take(5) {
                for name in names {
                    candidates.push(ancestor.join("src-tauri").join("vendor").join(name));
                    candidates.push(ancestor.join("vendor").join(name));
                }
            }
        }
    }

    if let Ok(cwd) = env::current_dir() {
        for ancestor in cwd.ancestors().take(4) {
            for name in names {
                candidates.push(ancestor.join("src-tauri").join("vendor").join(name));
                candidates.push(ancestor.join("vendor").join(name));
            }
        }
    }

    for name in names {
        candidates.push(PathBuf::from(name));
    }

    // Deduplicate while preserving lookup priority.
    let mut unique = Vec::new();
    for path in candidates {
        if !unique.contains(&path) {
            unique.push(path);
        }
    }
    unique
}

impl NeuroSdkApi {
    pub fn load(
        app_data_dir: Option<&Path>,
        resource_dir: Option<&Path>,
    ) -> Result<(Self, PathBuf), String> {
        let candidates = candidate_library_paths(app_data_dir, resource_dir);
        let mut last_error = String::new();

        for path in candidates {
            let is_bare_name = path.components().count() == 1;
            if !is_bare_name && !path.is_file() {
                continue;
            }
            match Self::load_from_path(&path) {
                Ok(api) => return Ok((api, path)),
                Err(err) => {
                    last_error = format!("{} ({err})", path.display());
                }
            }
        }

        if last_error.is_empty() {
            Err(
                "NeuroSDK2 library not found (expected src-tauri/vendor/neurosdk2-x64.dll; run scripts/fetch-neurosdk2.ps1)."
                    .to_string(),
            )
        } else {
            Err(format!("Failed to load NeuroSDK2 library: {last_error}"))
        }
    }

    pub fn load_from_path(path: &Path) -> Result<Self, String> {
        let lib = unsafe { Library::new(path) }
            .map_err(|e| format!("Library::new failed: {e}"))?;

        unsafe {
            Ok(Self {
                create_scanner: load_symbol(&lib, b"createScanner\0")?,
                free_scanner: load_symbol(&lib, b"freeScanner\0")?,
                start_scanner: load_symbol(&lib, b"startScanner\0")?,
                stop_scanner: load_symbol(&lib, b"stopScanner\0")?,
                sensors_scanner: load_symbol(&lib, b"sensorsScanner\0")?,
                create_sensor: load_symbol(&lib, b"createSensor\0")?,
                free_sensor: load_symbol(&lib, b"freeSensor\0")?,
                connect_sensor: load_symbol(&lib, b"connectSensor\0")?,
                disconnect_sensor: load_symbol(&lib, b"disconnectSensor\0")?,
                read_state_sensor: load_symbol(&lib, b"readStateSensor\0")?,
                is_supported_command_sensor: load_symbol(&lib, b"isSupportedCommandSensor\0")?,
                exec_command_sensor: load_symbol(&lib, b"execCommandSensor\0")?,
                get_family_sensor: load_symbol(&lib, b"getFamilySensor\0")?,
                read_batt_power_sensor: load_symbol(&lib, b"readBattPowerSensor\0")?,
                add_battery_callback: load_symbol(&lib, b"addBatteryCallback\0")?,
                remove_battery_callback: load_symbol(&lib, b"removeBatteryCallback\0")?,
                add_connection_state_callback: load_symbol(&lib, b"addConnectionStateCallback\0")?,
                remove_connection_state_callback: load_symbol(
                    &lib,
                    b"removeConnectionStateCallback\0",
                )?,
                add_signal_data_callback_brainbit: load_symbol(
                    &lib,
                    b"addSignalDataCallbackBrainBit\0",
                )?,
                remove_signal_data_callback_brainbit: load_symbol(
                    &lib,
                    b"removeSignalDataCallbackBrainBit\0",
                )?,
                add_resist_callback_brainbit: load_symbol(&lib, b"addResistCallbackBrainBit\0")?,
                remove_resist_callback_brainbit: load_symbol(
                    &lib,
                    b"removeResistCallbackBrainBit\0",
                )?,
                add_signal_data_callback_headband: load_symbol(
                    &lib,
                    b"addSignalDataCallbackHeadband\0",
                )?,
                remove_signal_data_callback_headband: load_symbol(
                    &lib,
                    b"removeSignalDataCallbackHeadband\0",
                )?,
                add_resist_callback_headband: load_symbol(&lib, b"addResistCallbackHeadband\0")?,
                remove_resist_callback_headband: load_symbol(
                    &lib,
                    b"removeResistCallbackHeadband\0",
                )?,
                read_supported_channels_brainbit2: load_symbol(
                    &lib,
                    b"readSupportedChannelsBrainBit2\0",
                )?,
                add_signal_callback_brainbit2: load_symbol(&lib, b"addSignalCallbackBrainBit2\0")?,
                remove_signal_callback_brainbit2: load_symbol(
                    &lib,
                    b"removeSignalCallbackBrainBit2\0",
                )?,
                add_resist_callback_brainbit2: load_symbol(&lib, b"addResistCallbackBrainBit2\0")?,
                remove_resist_callback_brainbit2: load_symbol(
                    &lib,
                    b"removeResistCallbackBrainBit2\0",
                )?,
                _library: lib,
            })
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::mem::{align_of, offset_of};

    #[test]
    fn c_abi_struct_layouts_match_cmn_type_h() {
        assert_eq!(size_of::<OpStatus>(), 520);
        assert_eq!(offset_of!(OpStatus, success), 0);
        assert_eq!(offset_of!(OpStatus, error), 4);
        assert_eq!(offset_of!(OpStatus, error_msg), 8);

        assert_eq!(size_of::<SensorInfo>(), 518);
        assert_eq!(align_of::<SensorInfo>(), 2);
        assert_eq!(offset_of!(SensorInfo, sens_family), 0);
        assert_eq!(offset_of!(SensorInfo, sens_model), 1);
        assert_eq!(offset_of!(SensorInfo, name), 2);
        assert_eq!(offset_of!(SensorInfo, address), 258);
        assert_eq!(offset_of!(SensorInfo, serial_number), 386);
        assert_eq!(offset_of!(SensorInfo, pairing_required), 514);
        assert_eq!(offset_of!(SensorInfo, rssi), 516);

        assert_eq!(size_of::<BrainBitSignalData>(), 40);
        assert_eq!(size_of::<BrainBitResistData>(), 32);
        assert_eq!(size_of::<HeadbandSignalData>(), 40);
        assert_eq!(size_of::<HeadbandResistData>(), 40);
        assert_eq!(offset_of!(HeadbandResistData, pack_num), 0);
        assert_eq!(offset_of!(HeadbandResistData, o1), 8);
        assert_eq!(size_of::<EEGChannelInfo>(), 11);
    }

    #[test]
    fn converts_volts_and_c_strings() {
        assert!((volts_to_microvolts(0.000_045) - 45.0).abs() < 1e-9);
        assert!((volts_to_microvolts(-0.000_120) + 120.0).abs() < 1e-9);

        let mut buf = [0 as c_char; SENSOR_NAME_LEN];
        for (i, b) in b"BrainBit #42".iter().enumerate() {
            buf[i] = *b as c_char;
        }
        assert_eq!(c_char_array_to_string(&buf), "BrainBit #42");
    }

    #[test]
    fn resolves_all_exported_symbols_when_vendor_dll_is_present() {
        let vendor_dll = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("vendor")
            .join("neurosdk2-x64.dll");
        if cfg!(target_os = "windows") && vendor_dll.is_file() {
            let api = NeuroSdkApi::load_from_path(&vendor_dll)
                .expect("vendor neurosdk2-x64.dll must resolve all symbols");
            let mut status = OpStatus::default();
            let scanner = unsafe {
                (api.create_scanner)(
                    BRAINBIT_SCAN_FILTERS.as_ptr(),
                    BRAINBIT_SCAN_FILTERS.len() as i32,
                    &mut status,
                )
            };
            assert!(
                !scanner.is_null() && status.success != 0,
                "createScanner must succeed: {}",
                c_char_array_to_string(&status.error_msg)
            );
            unsafe { (api.free_scanner)(scanner) };
        }
    }
}
