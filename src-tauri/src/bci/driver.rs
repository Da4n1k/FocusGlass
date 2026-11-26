//! Thread-safe NeuroSDK2 worker thread & 250 Hz / impedance telemetry bridge.

use std::collections::HashMap;
use std::os::raw::c_void;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossbeam_channel::{bounded, Receiver, RecvTimeoutError, Sender};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::{BrainBitScanResponse, DeviceStatusResponse, DiscoveredBrainBitDevice};
use crate::error::{AppError, AppResult};

use super::contact::{
    resist_ohms_to_payload, ChannelResistancePayload, ElectrodeQualityPayload, SignalContactMonitor,
};
use super::recorder::{DumpSampleInput, EegDumpRecorder, EVENT_EEG_DUMP_STATUS};
use super::neurosdk_ffi::{
    family_display_name, volts_to_microvolts, BrainBitResistData, BrainBitSignalData,
    EEGChannelInfo, HeadbandResistData, HeadbandSignalData, ListenerHandle, NeuroSdkApi, OpStatus,
    ResistRefChannelsData, Sensor, SensorInfo, SensorScanner, SignalChannelsData,
    BRAINBIT_SCAN_FILTERS, COMMAND_START_RESIST, COMMAND_START_SIGNAL, COMMAND_STOP_RESIST,
    COMMAND_STOP_SIGNAL, EEG_CH_ID_O1, EEG_CH_ID_O2, EEG_CH_ID_T3, EEG_CH_ID_T4,
    SENSOR_LE_BRAINBIT2, SENSOR_LE_BRAINBIT_FLEX, SENSOR_LE_BRAINBIT_PRO, SENSOR_LE_HEADBAND,
    STATE_IN_RANGE, STATE_OUT_OF_RANGE,
};

pub const EVENT_BRAINBIT_RAW_BATCH: &str = "brainbit-raw-batch";
pub const EVENT_BRAINBIT_RESIST: &str = "brainbit-resist";
pub const EVENT_BRAINBIT_STATUS: &str = "brainbit-status";

const MODE_IDLE: u8 = 0;
const MODE_RESIST: u8 = 1;
const MODE_SIGNAL: u8 = 2;

const TELEMETRY_FLUSH_INTERVAL: Duration = Duration::from_millis(20);
const MAX_BATCH_SAMPLES: usize = 16;
const RESIST_EMIT_MIN_INTERVAL: Duration = Duration::from_millis(80);
const DEFAULT_SCAN_MS: u64 = 4000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamMode {
    Idle,
    Resist,
    Signal,
}

impl StreamMode {
    pub fn parse(raw: &str) -> AppResult<Self> {
        match raw {
            "idle" => Ok(Self::Idle),
            "resist" => Ok(Self::Resist),
            "signal" => Ok(Self::Signal),
            other => Err(AppError::InvalidArgument(format!(
                "unknown BrainBit stream mode {other:?} (expected 'idle', 'resist', or 'signal')"
            ))),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Resist => "resist",
            Self::Signal => "signal",
        }
    }

    fn as_u8(self) -> u8 {
        match self {
            Self::Idle => MODE_IDLE,
            Self::Resist => MODE_RESIST,
            Self::Signal => MODE_SIGNAL,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawEegChannelsPayload {
    pub t3: f64,
    pub t4: f64,
    pub o1: f64,
    pub o2: f64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawBrainBitPacketPayload {
    pub timestamp: u64,
    pub raw_channels: RawEegChannelsPayload,
    pub signal_quality: ElectrodeQualityPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resistance_k_ohm: Option<ChannelResistancePayload>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrainBitResistPayload {
    pub timestamp: u64,
    pub resistance_k_ohm: ChannelResistancePayload,
    pub signal_quality: ElectrodeQualityPayload,
}

#[derive(Clone, Copy, Default)]
struct BrainBit2ChannelMap {
    o1: Option<usize>,
    o2: Option<usize>,
    t3: Option<usize>,
    t4: Option<usize>,
}

impl BrainBit2ChannelMap {
    fn from_channels(channels: &[EEGChannelInfo]) -> Self {
        let mut map = Self::default();
        for (pos, ch) in channels.iter().enumerate() {
            let idx = if (ch.num as usize) < channels.len() {
                ch.num as usize
            } else {
                pos
            };
            match ch.id {
                EEG_CH_ID_O1 => map.o1 = Some(idx),
                EEG_CH_ID_O2 => map.o2 = Some(idx),
                EEG_CH_ID_T3 => map.t3 = Some(idx),
                EEG_CH_ID_T4 => map.t4 = Some(idx),
                _ => {}
            }
        }
        if map.o1.is_none() && map.o2.is_none() && map.t3.is_none() && map.t4.is_none() && channels.len() >= 4 {
            map = Self {
                o1: Some(0),
                o2: Some(1),
                t3: Some(2),
                t4: Some(3),
            };
        }
        map
    }
}

enum CallbackEvent {
    Signal {
        pack_num: u32,
        marker: u8,
        t3_uv: f64,
        t4_uv: f64,
        o1_uv: f64,
        o2_uv: f64,
    },
    Resist {
        o1_ohm: f64,
        o2_ohm: f64,
        t3_ohm: f64,
        t4_ohm: f64,
    },
    Battery(u8),
    ConnectionState(i8),
    StopForwarder,
}

struct CallbackContext {
    active: AtomicBool,
    tx: Sender<CallbackEvent>,
    bb2_map: BrainBit2ChannelMap,
}

unsafe extern "C" fn on_battery_callback(_sensor: *mut Sensor, batt_power: i32, user_data: *mut c_void) {
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let pct = batt_power.clamp(0, 100) as u8;
    let _ = ctx.tx.try_send(CallbackEvent::Battery(pct));
}

unsafe extern "C" fn on_connection_state_callback(
    _sensor: *mut Sensor,
    state: i8,
    user_data: *mut c_void,
) {
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let _ = ctx.tx.try_send(CallbackEvent::ConnectionState(state));
}

unsafe extern "C" fn on_bb_signal_callback(
    _sensor: *mut Sensor,
    data: *mut BrainBitSignalData,
    sz_data: i32,
    user_data: *mut c_void,
) {
    if user_data.is_null() || data.is_null() || sz_data <= 0 {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let slice = unsafe { std::slice::from_raw_parts(data, sz_data as usize) };
    for s in slice {
        let _ = ctx.tx.try_send(CallbackEvent::Signal {
            pack_num: s.pack_num,
            marker: s.marker,
            t3_uv: volts_to_microvolts(s.t3),
            t4_uv: volts_to_microvolts(s.t4),
            o1_uv: volts_to_microvolts(s.o1),
            o2_uv: volts_to_microvolts(s.o2),
        });
    }
}

unsafe extern "C" fn on_bb_resist_callback(
    _sensor: *mut Sensor,
    data: BrainBitResistData,
    user_data: *mut c_void,
) {
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let _ = ctx.tx.try_send(CallbackEvent::Resist {
        o1_ohm: data.o1,
        o2_ohm: data.o2,
        t3_ohm: data.t3,
        t4_ohm: data.t4,
    });
}

unsafe extern "C" fn on_hb_signal_callback(
    _sensor: *mut Sensor,
    data: *mut HeadbandSignalData,
    sz_data: i32,
    user_data: *mut c_void,
) {
    if user_data.is_null() || data.is_null() || sz_data <= 0 {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let slice = unsafe { std::slice::from_raw_parts(data, sz_data as usize) };
    for s in slice {
        let _ = ctx.tx.try_send(CallbackEvent::Signal {
            pack_num: s.pack_num,
            marker: s.marker,
            t3_uv: volts_to_microvolts(s.t3),
            t4_uv: volts_to_microvolts(s.t4),
            o1_uv: volts_to_microvolts(s.o1),
            o2_uv: volts_to_microvolts(s.o2),
        });
    }
}

unsafe extern "C" fn on_hb_resist_callback(
    _sensor: *mut Sensor,
    data: HeadbandResistData,
    user_data: *mut c_void,
) {
    if user_data.is_null() {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let _ = ctx.tx.try_send(CallbackEvent::Resist {
        o1_ohm: data.o1,
        o2_ohm: data.o2,
        t3_ohm: data.t3,
        t4_ohm: data.t4,
    });
}

unsafe extern "C" fn on_bb2_signal_callback(
    _sensor: *mut Sensor,
    data: *mut SignalChannelsData,
    sz_data: i32,
    user_data: *mut c_void,
) {
    if user_data.is_null() || data.is_null() || sz_data <= 0 {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let slice = unsafe { std::slice::from_raw_parts(data, sz_data as usize) };
    for pkt in slice {
        if pkt.samples.is_null() || pkt.sz_samples == 0 {
            continue;
        }
        let chs = unsafe { std::slice::from_raw_parts(pkt.samples, pkt.sz_samples as usize) };
        let read_uv = |idx: Option<usize>| idx.and_then(|i| chs.get(i).copied()).map(volts_to_microvolts).unwrap_or(0.0);
        let _ = ctx.tx.try_send(CallbackEvent::Signal {
            pack_num: pkt.pack_num,
            marker: pkt.marker,
            t3_uv: read_uv(ctx.bb2_map.t3),
            t4_uv: read_uv(ctx.bb2_map.t4),
            o1_uv: read_uv(ctx.bb2_map.o1),
            o2_uv: read_uv(ctx.bb2_map.o2),
        });
    }
}

unsafe extern "C" fn on_bb2_resist_callback(
    _sensor: *mut Sensor,
    data: *mut ResistRefChannelsData,
    sz_data: i32,
    user_data: *mut c_void,
) {
    if user_data.is_null() || data.is_null() || sz_data <= 0 {
        return;
    }
    let ctx = unsafe { &*(user_data as *const CallbackContext) };
    if !ctx.active.load(Ordering::Acquire) {
        return;
    }
    let slice = unsafe { std::slice::from_raw_parts(data, sz_data as usize) };
    for pkt in slice {
        if pkt.samples.is_null() || pkt.sz_samples == 0 {
            continue;
        }
        let res = unsafe { std::slice::from_raw_parts(pkt.samples, pkt.sz_samples as usize) };
        let read_ohm = |idx: Option<usize>| idx.and_then(|i| res.get(i).copied()).unwrap_or(f64::INFINITY);
        let _ = ctx.tx.try_send(CallbackEvent::Resist {
            o1_ohm: read_ohm(ctx.bb2_map.o1),
            o2_ohm: read_ohm(ctx.bb2_map.o2),
            t3_ohm: read_ohm(ctx.bb2_map.t3),
            t4_ohm: read_ohm(ctx.bb2_map.t4),
        });
    }
}

enum FamilyListeners {
    BrainBit {
        signal: ListenerHandle,
        resist: ListenerHandle,
    },
    Headband {
        signal: ListenerHandle,
        resist: ListenerHandle,
    },
    BrainBit2 {
        signal: ListenerHandle,
        resist: ListenerHandle,
    },
}

struct ActiveSession {
    sensor: *mut Sensor,
    ctx_ptr: *mut CallbackContext,
    batt_handle: ListenerHandle,
    state_handle: ListenerHandle,
    family_listeners: FamilyListeners,
    mode: StreamMode,
}

impl ActiveSession {
    fn stop_active_command(&mut self, api: &NeuroSdkApi) {
        let cmd = match self.mode {
            StreamMode::Resist => Some(COMMAND_STOP_RESIST),
            StreamMode::Signal => Some(COMMAND_STOP_SIGNAL),
            StreamMode::Idle => None,
        };
        if let Some(command) = cmd {
            let mut status = OpStatus::default();
            unsafe {
                let _ = (api.exec_command_sensor)(self.sensor, command, &mut status);
            }
            self.mode = StreamMode::Idle;
        }
    }

    fn close(mut self, api: &NeuroSdkApi) {
        unsafe {
            (*self.ctx_ptr).active.store(false, Ordering::Release);
        }
        self.stop_active_command(api);

        unsafe {
            match self.family_listeners {
                FamilyListeners::BrainBit { signal, resist } => {
                    if !signal.is_null() {
                        (api.remove_signal_data_callback_brainbit)(signal);
                    }
                    if !resist.is_null() {
                        (api.remove_resist_callback_brainbit)(resist);
                    }
                }
                FamilyListeners::Headband { signal, resist } => {
                    if !signal.is_null() {
                        (api.remove_signal_data_callback_headband)(signal);
                    }
                    if !resist.is_null() {
                        (api.remove_resist_callback_headband)(resist);
                    }
                }
                FamilyListeners::BrainBit2 { signal, resist } => {
                    if !signal.is_null() {
                        (api.remove_signal_callback_brainbit2)(signal);
                    }
                    if !resist.is_null() {
                        (api.remove_resist_callback_brainbit2)(resist);
                    }
                }
            }
            if !self.batt_handle.is_null() {
                (api.remove_battery_callback)(self.batt_handle);
            }
            if !self.state_handle.is_null() {
                (api.remove_connection_state_callback)(self.state_handle);
            }
            let mut status = OpStatus::default();
            let _ = (api.disconnect_sensor)(self.sensor, &mut status);
            (api.free_sensor)(self.sensor);
            // Allow any mid-flight BLE notifier thread stack frame to return before freeing ctx.
            thread::sleep(Duration::from_millis(15));
            drop(Box::from_raw(self.ctx_ptr));
        }
    }
}

enum WorkerCommand {
    Scan {
        duration_ms: u64,
        reply: Sender<AppResult<BrainBitScanResponse>>,
    },
    Connect {
        address: String,
        initial_mode: StreamMode,
        reply: Sender<AppResult<DeviceStatusResponse>>,
    },
    SetMode {
        mode: StreamMode,
        reply: Sender<AppResult<DeviceStatusResponse>>,
    },
    Disconnect {
        reply: Sender<AppResult<DeviceStatusResponse>>,
    },
    Shutdown {
        reply: Sender<()>,
    },
}

struct SharedState {
    status: Mutex<DeviceStatusResponse>,
    mode: AtomicU8,
    latest_resist: Mutex<Option<ChannelResistancePayload>>,
    sdk_error: Mutex<Option<String>>,
}

struct WorkerContext {
    api: Option<Arc<NeuroSdkApi>>,
    app: AppHandle,
    shared: Arc<SharedState>,
    recorder: Arc<EegDumpRecorder>,
    cb_tx: Sender<CallbackEvent>,
    scanner: *mut SensorScanner,
    known_sensors: HashMap<String, SensorInfo>,
    session: Option<ActiveSession>,
}

impl WorkerContext {
    fn require_api(&self) -> AppResult<&NeuroSdkApi> {
        self.api.as_deref().ok_or_else(|| {
            let reason = self
                .shared
                .sdk_error
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_else(|| "NeuroSDK2 library is not loaded.".to_string());
            AppError::Bci(reason)
        })
    }

    fn ensure_scanner(&mut self) -> AppResult<*mut SensorScanner> {
        if !self.scanner.is_null() {
            return Ok(self.scanner);
        }
        let api = self.require_api()?;
        let mut status = OpStatus::default();
        let scanner = unsafe {
            (api.create_scanner)(
                BRAINBIT_SCAN_FILTERS.as_ptr(),
                BRAINBIT_SCAN_FILTERS.len() as i32,
                &mut status,
            )
        };
        if scanner.is_null() || status.success == 0 {
            if status.success != 0 {
                return Err(AppError::Bci("createScanner returned null".to_string()));
            }
            status.check("createScanner")?;
            return Err(AppError::Bci("createScanner returned null".to_string()));
        }
        self.scanner = scanner;
        Ok(scanner)
    }

    fn run_scan(&mut self, duration_ms: u64) -> AppResult<Vec<DiscoveredBrainBitDevice>> {
        let scanner = self.ensure_scanner()?;
        let api = Arc::clone(self.api.as_ref().ok_or_else(|| AppError::Bci("SDK unavailable".into()))?);

        let mut status = OpStatus::default();
        let ok = unsafe { (api.start_scanner)(scanner, &mut status, 1) };
        if ok == 0 || status.success == 0 {
            status.check("startScanner")?;
            return Err(AppError::Bci("Failed to start BLE scanner".to_string()));
        }

        thread::sleep(Duration::from_millis(duration_ms.clamp(1500, 10_000)));

        let mut stop_status = OpStatus::default();
        unsafe {
            let _ = (api.stop_scanner)(scanner, &mut stop_status);
        }

        let mut count: i32 = 32;
        let mut raw_sensors = vec![SensorInfo::default(); count as usize];
        let mut list_status = OpStatus::default();
        let list_ok = unsafe {
            (api.sensors_scanner)(
                scanner,
                raw_sensors.as_mut_ptr(),
                &mut count,
                &mut list_status,
            )
        };
        if list_ok == 0 || list_status.success == 0 {
            list_status.check("sensorsScanner")?;
        }

        let actual_count = (count.max(0) as usize).min(raw_sensors.len());
        let mut devices = Vec::new();

        for info in raw_sensors.into_iter().take(actual_count) {
            let name = info.name_string();
            let address = info.address_string();
            let serial = info.serial_string();
            let key = normalize_address_key(&address, &name);
            if key.is_empty() {
                continue;
            }
            self.known_sensors.insert(key, info);
            devices.push(DiscoveredBrainBitDevice {
                name,
                address,
                rssi: Some(info.rssi),
                serial_number: if serial.is_empty() { None } else { Some(serial) },
                family: Some(family_display_name(info.sens_family).to_string()),
            });
        }

        devices.sort_by(|a, b| b.rssi.unwrap_or(i16::MIN).cmp(&a.rssi.unwrap_or(i16::MIN)));
        Ok(devices)
    }

    fn disconnect_active(&mut self, update_status: bool) -> DeviceStatusResponse {
        if let Ok(Some(dump_status)) = self.recorder.stop_if_source("bluetooth") {
            let _ = self.app.emit(EVENT_EEG_DUMP_STATUS, dump_status);
        }
        if let (Some(session), Some(api)) = (self.session.take(), self.api.as_ref()) {
            session.close(api);
        }
        self.shared.mode.store(MODE_IDLE, Ordering::SeqCst);
        if let Ok(mut resist) = self.shared.latest_resist.lock() {
            *resist = None;
        }
        let next = if self.api.is_some() {
            DeviceStatusResponse::bluetooth_ready()
        } else {
            let msg = self
                .shared
                .sdk_error
                .lock()
                .ok()
                .and_then(|g| g.clone());
            DeviceStatusResponse::bluetooth_pending_with_reason(msg)
        };
        if update_status {
            self.publish_status(next.clone());
        } else if let Ok(mut guard) = self.shared.status.lock() {
            *guard = next.clone();
        }
        next
    }

    fn connect(&mut self, address: String, initial_mode: StreamMode) -> AppResult<DeviceStatusResponse> {
        let key = address.trim().to_ascii_uppercase();
        if key.is_empty() {
            return Err(AppError::InvalidArgument(
                "BrainBit device address must not be empty".to_string(),
            ));
        }

        self.disconnect_active(false);

        if !self.known_sensors.contains_key(&key) {
            let _ = self.run_scan(3000)?;
        }

        let info = self.known_sensors.get(&key).copied().ok_or_else(|| {
            AppError::Bci(format!(
                "BrainBit '{address}' not found nearby. Check that the charged battery is snapped in cleanly and the LED indicator is blinking, then Scan again."
            ))
        })?;

        let scanner = self.ensure_scanner()?;
        let api = Arc::clone(
            self.api
                .as_ref()
                .ok_or_else(|| AppError::Bci("SDK unavailable".into()))?,
        );

        let mut status = OpStatus::default();
        let sensor = unsafe { (api.create_sensor)(scanner, info, &mut status) };
        if sensor.is_null() || status.success == 0 {
            if !sensor.is_null() {
                unsafe { (api.free_sensor)(sensor) };
            }
            status.check("createSensor")?;
            return Err(AppError::Bci("createSensor failed to open BrainBit".to_string()));
        }

        // Ensure GATT link is in Range if createSensor did not finish connecting immediately.
        let mut conn_state: i8 = STATE_OUT_OF_RANGE;
        let mut state_status = OpStatus::default();
        unsafe {
            let _ = (api.read_state_sensor)(sensor, &mut conn_state, &mut state_status);
        }
        if conn_state != STATE_IN_RANGE {
            let mut conn_status = OpStatus::default();
            let ok = unsafe { (api.connect_sensor)(sensor, &mut conn_status) };
            if ok == 0 || conn_status.success == 0 {
                unsafe { (api.free_sensor)(sensor) };
                conn_status.check("connectSensor")?;
                return Err(AppError::Bci("connectSensor failed".to_string()));
            }
        }

        let family = unsafe { (api.get_family_sensor)(sensor) };
        let bb2_map = if matches!(
            family,
            SENSOR_LE_BRAINBIT2 | SENSOR_LE_BRAINBIT_PRO | SENSOR_LE_BRAINBIT_FLEX
        ) {
            read_bb2_channel_map(&api, sensor)
        } else {
            BrainBit2ChannelMap::default()
        };

        let ctx_box = Box::new(CallbackContext {
            active: AtomicBool::new(true),
            tx: self.cb_tx.clone(),
            bb2_map,
        });
        let ctx_ptr = Box::into_raw(ctx_box);
        let user_data = ctx_ptr.cast::<c_void>();

        let mut batt_handle: ListenerHandle = std::ptr::null_mut();
        let mut state_handle: ListenerHandle = std::ptr::null_mut();
        let mut cb_status = OpStatus::default();
        unsafe {
            let _ = (api.add_battery_callback)(
                sensor,
                on_battery_callback,
                &mut batt_handle,
                user_data,
                &mut cb_status,
            );
            let _ = (api.add_connection_state_callback)(
                sensor,
                on_connection_state_callback,
                &mut state_handle,
                user_data,
                &mut cb_status,
            );
        }

        let family_listeners = match register_family_callbacks(&api, sensor, family, user_data) {
            Ok(listeners) => listeners,
            Err(err) => {
                unsafe {
                    (*ctx_ptr).active.store(false, Ordering::Release);
                    if !batt_handle.is_null() {
                        (api.remove_battery_callback)(batt_handle);
                    }
                    if !state_handle.is_null() {
                        (api.remove_connection_state_callback)(state_handle);
                    }
                    let mut st = OpStatus::default();
                    let _ = (api.disconnect_sensor)(sensor, &mut st);
                    (api.free_sensor)(sensor);
                    drop(Box::from_raw(ctx_ptr));
                }
                return Err(err);
            }
        };

        let mut battery_pct = 0u8;
        let mut raw_batt: i32 = 0;
        let mut batt_status = OpStatus::default();
        unsafe {
            if (api.read_batt_power_sensor)(sensor, &mut raw_batt, &mut batt_status) != 0
                && batt_status.success != 0
            {
                battery_pct = raw_batt.clamp(0, 100) as u8;
            }
        }

        let serial = info.serial_string();
        let mut session = ActiveSession {
            sensor,
            ctx_ptr,
            batt_handle,
            state_handle,
            family_listeners,
            mode: StreamMode::Idle,
        };

        // Honor requested initial mode (default Fit Check 'resist'), falling back to 'signal' if resist isn't supported.
        let target_mode = if initial_mode == StreamMode::Resist
            && unsafe { (api.is_supported_command_sensor)(sensor, COMMAND_START_RESIST) == 0 }
        {
            StreamMode::Signal
        } else {
            initial_mode
        };

        if let Err(err) = apply_session_mode(&api, &mut session, target_mode) {
            session.close(&api);
            return Err(err);
        }
        self.shared.mode.store(session.mode.as_u8(), Ordering::SeqCst);

        let connected_status = DeviceStatusResponse {
            connected: true,
            device_source: "bluetooth".to_string(),
            connection_state: "connected".to_string(),
            battery_percentage: battery_pct,
            device_name: info.name_string(),
            sampling_rate_hz: 250,
            status_message: mode_status_message(session.mode, &info.name_string()),
            stream_mode: Some(session.mode.as_str().to_string()),
            device_address: Some(info.address_string()),
            serial_number: if serial.is_empty() { None } else { Some(serial) },
            sdk_available: Some(true),
        };

        self.session = Some(session);
        self.publish_status(connected_status.clone());
        Ok(connected_status)
    }

    fn set_mode(&mut self, mode: StreamMode) -> AppResult<DeviceStatusResponse> {
        if mode != StreamMode::Signal {
            if let Ok(Some(dump_status)) = self.recorder.stop_if_source("bluetooth") {
                let _ = self.app.emit(EVENT_EEG_DUMP_STATUS, dump_status);
            }
        }
        let api = Arc::clone(
            self.api
                .as_ref()
                .ok_or_else(|| AppError::Bci("SDK unavailable".into()))?,
        );
        let session = self.session.as_mut().ok_or_else(|| {
            AppError::Bci("No active BrainBit connection. Connect a headband first.".to_string())
        })?;

        apply_session_mode(&api, session, mode)?;
        self.shared.mode.store(session.mode.as_u8(), Ordering::SeqCst);

        let next = if let Ok(mut guard) = self.shared.status.lock() {
            guard.stream_mode = Some(mode.as_str().to_string());
            guard.status_message = mode_status_message(mode, &guard.device_name);
            guard.clone()
        } else {
            return Err(AppError::LockPoisoned("brainbit status"));
        };
        let _ = self.app.emit(EVENT_BRAINBIT_STATUS, next.clone());
        Ok(next)
    }

    fn publish_status(&self, status: DeviceStatusResponse) {
        if let Ok(mut guard) = self.shared.status.lock() {
            *guard = status.clone();
        }
        let _ = self.app.emit(EVENT_BRAINBIT_STATUS, status);
    }

    fn shutdown(&mut self) {
        self.disconnect_active(false);
        if !self.scanner.is_null() {
            if let Some(api) = &self.api {
                unsafe {
                    (api.free_scanner)(self.scanner);
                }
            }
            self.scanner = std::ptr::null_mut();
        }
    }
}

fn normalize_address_key(address: &str, name: &str) -> String {
    let addr = address.trim().to_ascii_uppercase();
    if addr.is_empty() {
        name.trim().to_ascii_uppercase()
    } else {
        addr
    }
}

fn mode_status_message(mode: StreamMode, device_name: &str) -> String {
    match mode {
        StreamMode::Resist => format!(
            "{device_name}: режим проверки посадки (измерение сопротивления T3, T4, O1, O2)."
        ),
        StreamMode::Signal => format!("{device_name}: активен поток ЭЭГ 250 Гц."),
        StreamMode::Idle => format!("{device_name}: подключено (поток на паузе)."),
    }
}

fn read_bb2_channel_map(api: &NeuroSdkApi, sensor: *mut Sensor) -> BrainBit2ChannelMap {
    let mut count: i32 = 8;
    let mut channels = [EEGChannelInfo::default(); 8];
    let mut status = OpStatus::default();
    unsafe {
        if (api.read_supported_channels_brainbit2)(
            sensor,
            channels.as_mut_ptr(),
            &mut count,
            &mut status,
        ) != 0
            && status.success != 0
        {
            let actual = (count.max(0) as usize).min(channels.len());
            return BrainBit2ChannelMap::from_channels(&channels[..actual]);
        }
    }
    BrainBit2ChannelMap::default()
}

fn register_family_callbacks(
    api: &NeuroSdkApi,
    sensor: *mut Sensor,
    family: u8,
    user_data: *mut c_void,
) -> AppResult<FamilyListeners> {
    let mut status = OpStatus::default();
    if family == SENSOR_LE_HEADBAND {
        let mut signal: ListenerHandle = std::ptr::null_mut();
        let mut resist: ListenerHandle = std::ptr::null_mut();
        let ok_sig = unsafe {
            (api.add_signal_data_callback_headband)(
                sensor,
                on_hb_signal_callback,
                &mut signal,
                user_data,
                &mut status,
            )
        };
        if ok_sig == 0 || status.success == 0 {
            status.check("addSignalDataCallbackHeadband")?;
        }
        let ok_res = unsafe {
            (api.add_resist_callback_headband)(
                sensor,
                on_hb_resist_callback,
                &mut resist,
                user_data,
                &mut status,
            )
        };
        if ok_res == 0 || status.success == 0 {
            unsafe {
                if !signal.is_null() {
                    (api.remove_signal_data_callback_headband)(signal);
                }
            }
            status.check("addResistCallbackHeadband")?;
        }
        return Ok(FamilyListeners::Headband { signal, resist });
    }

    if matches!(
        family,
        SENSOR_LE_BRAINBIT2 | SENSOR_LE_BRAINBIT_PRO | SENSOR_LE_BRAINBIT_FLEX
    ) {
        let mut signal: ListenerHandle = std::ptr::null_mut();
        let mut resist: ListenerHandle = std::ptr::null_mut();
        let ok_sig = unsafe {
            (api.add_signal_callback_brainbit2)(
                sensor,
                on_bb2_signal_callback,
                &mut signal,
                user_data,
                &mut status,
            )
        };
        if ok_sig == 0 || status.success == 0 {
            status.check("addSignalCallbackBrainBit2")?;
        }
        let ok_res = unsafe {
            (api.add_resist_callback_brainbit2)(
                sensor,
                on_bb2_resist_callback,
                &mut resist,
                user_data,
                &mut status,
            )
        };
        if ok_res == 0 || status.success == 0 {
            unsafe {
                if !signal.is_null() {
                    (api.remove_signal_callback_brainbit2)(signal);
                }
            }
            status.check("addResistCallbackBrainBit2")?;
        }
        return Ok(FamilyListeners::BrainBit2 { signal, resist });
    }

    // Default: Classic BrainBit / BrainBit Black (SensorLEBrainBit = 3 / 4)
    let mut signal: ListenerHandle = std::ptr::null_mut();
    let mut resist: ListenerHandle = std::ptr::null_mut();
    let ok_sig = unsafe {
        (api.add_signal_data_callback_brainbit)(
            sensor,
            on_bb_signal_callback,
            &mut signal,
            user_data,
            &mut status,
        )
    };
    if ok_sig == 0 || status.success == 0 {
        status.check("addSignalDataCallbackBrainBit")?;
    }
    let ok_res = unsafe {
        (api.add_resist_callback_brainbit)(
            sensor,
            on_bb_resist_callback,
            &mut resist,
            user_data,
            &mut status,
        )
    };
    if ok_res == 0 || status.success == 0 {
        unsafe {
            if !signal.is_null() {
                (api.remove_signal_data_callback_brainbit)(signal);
            }
        }
        status.check("addResistCallbackBrainBit")?;
    }
    Ok(FamilyListeners::BrainBit { signal, resist })
}

fn apply_session_mode(
    api: &NeuroSdkApi,
    session: &mut ActiveSession,
    next: StreamMode,
) -> AppResult<()> {
    if session.mode == next {
        return Ok(());
    }
    session.stop_active_command(api);

    let cmd = match next {
        StreamMode::Resist => Some(COMMAND_START_RESIST),
        StreamMode::Signal => Some(COMMAND_START_SIGNAL),
        StreamMode::Idle => None,
    };

    if let Some(command) = cmd {
        let mut status = OpStatus::default();
        let ok = unsafe { (api.exec_command_sensor)(session.sensor, command, &mut status) };
        if ok == 0 || status.success == 0 {
            status.check("execCommandSensor")?;
            return Err(AppError::Bci("execCommandSensor failed".to_string()));
        }
    }
    session.mode = next;
    Ok(())
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn telemetry_loop(
    app: AppHandle,
    shared: Arc<SharedState>,
    recorder: Arc<EegDumpRecorder>,
    rx: Receiver<CallbackEvent>,
) {
    let mut monitor = SignalContactMonitor::new();
    let mut signal_batch: Vec<(u32, u8, f64, f64, f64, f64)> = Vec::with_capacity(MAX_BATCH_SAMPLES);
    let mut last_flush = Instant::now();
    let mut last_resist_emit = Instant::now() - RESIST_EMIT_MIN_INTERVAL;
    let mut last_mode = shared.mode.load(Ordering::Relaxed);

    loop {
        let current_mode = shared.mode.load(Ordering::Relaxed);
        if current_mode != last_mode {
            if current_mode == MODE_SIGNAL {
                monitor.reset();
                signal_batch.clear();
            }
            last_mode = current_mode;
        }

        let timeout = if signal_batch.is_empty() {
            Duration::from_millis(50)
        } else {
            TELEMETRY_FLUSH_INTERVAL.saturating_sub(last_flush.elapsed())
        };

        match rx.recv_timeout(timeout) {
            Ok(CallbackEvent::StopForwarder) => break,
            Ok(CallbackEvent::Battery(pct)) => {
                if let Ok(mut guard) = shared.status.lock() {
                    if guard.battery_percentage != pct {
                        guard.battery_percentage = pct;
                        let _ = app.emit(EVENT_BRAINBIT_STATUS, guard.clone());
                    }
                }
            }
            Ok(CallbackEvent::ConnectionState(state)) => {
                if let Ok(mut guard) = shared.status.lock() {
                    if state == STATE_OUT_OF_RANGE {
                        if let Ok(Some(dump_status)) = recorder.stop_if_source("bluetooth") {
                            let _ = app.emit(EVENT_EEG_DUMP_STATUS, dump_status);
                        }
                        guard.connected = false;
                        guard.connection_state = "disconnected".to_string();
                        guard.stream_mode = Some("idle".to_string());
                        guard.status_message =
                            "Потеряна связь с BrainBit (ободок выключен или вне зоны BLE)."
                                .to_string();
                        shared.mode.store(MODE_IDLE, Ordering::SeqCst);
                        signal_batch.clear();
                        let _ = app.emit(EVENT_BRAINBIT_STATUS, guard.clone());
                    } else if state == STATE_IN_RANGE && !guard.connected {
                        guard.connected = true;
                        guard.connection_state = "connected".to_string();
                        let _ = app.emit(EVENT_BRAINBIT_STATUS, guard.clone());
                    }
                }
            }
            Ok(CallbackEvent::Resist {
                o1_ohm,
                o2_ohm,
                t3_ohm,
                t4_ohm,
            }) => {
                if shared.mode.load(Ordering::Relaxed) != MODE_RESIST {
                    continue;
                }
                let res_payload = resist_ohms_to_payload(o1_ohm, o2_ohm, t3_ohm, t4_ohm);
                if let Ok(mut guard) = shared.latest_resist.lock() {
                    *guard = Some(res_payload);
                }
                if last_resist_emit.elapsed() >= RESIST_EMIT_MIN_INTERVAL {
                    let quality = ElectrodeQualityPayload::from_resistances(res_payload);
                    let _ = app.emit(
                        EVENT_BRAINBIT_RESIST,
                        BrainBitResistPayload {
                            timestamp: epoch_ms(),
                            resistance_k_ohm: res_payload,
                            signal_quality: quality,
                        },
                    );
                    last_resist_emit = Instant::now();
                }
            }
            Ok(CallbackEvent::Signal {
                pack_num,
                marker,
                t3_uv,
                t4_uv,
                o1_uv,
                o2_uv,
            }) => {
                if shared.mode.load(Ordering::Relaxed) != MODE_SIGNAL {
                    continue;
                }
                signal_batch.push((pack_num, marker, t3_uv, t4_uv, o1_uv, o2_uv));
                if signal_batch.len() >= MAX_BATCH_SAMPLES {
                    flush_signal_batch(&app, &recorder, &mut monitor, &mut signal_batch);
                    last_flush = Instant::now();
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if !signal_batch.is_empty() {
                    flush_signal_batch(&app, &recorder, &mut monitor, &mut signal_batch);
                    last_flush = Instant::now();
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn flush_signal_batch(
    app: &AppHandle,
    recorder: &EegDumpRecorder,
    monitor: &mut SignalContactMonitor,
    batch: &mut Vec<(u32, u8, f64, f64, f64, f64)>,
) {
    if batch.is_empty() {
        return;
    }
    let now = epoch_ms();
    let count = batch.len();
    let mut packets = Vec::with_capacity(count);
    for (idx, &(pack_num, marker, t3_uv, t4_uv, o1_uv, o2_uv)) in batch.iter().enumerate() {
        let quality = monitor.update(t3_uv, t4_uv, o1_uv, o2_uv);
        let ts = now.saturating_sub(((count - 1 - idx) as u64) * 4);
        if recorder.is_recording() {
            let dump_sample = DumpSampleInput {
                timestamp: ts,
                pack_num,
                marker,
                t3: t3_uv,
                t4: t4_uv,
                o1: o1_uv,
                o2: o2_uv,
                t3_ok: quality.t3,
                t4_ok: quality.t4,
                o1_ok: quality.o1,
                o2_ok: quality.o2,
            };
            if let Ok(Some(dump_status)) = recorder.record_bluetooth_sample(&dump_sample) {
                let _ = app.emit(EVENT_EEG_DUMP_STATUS, dump_status);
            }
        }
        // Live BrainBit cannot measure impedance during Signal mode: omit stale pre-session
        // resistance so live biofeedback contact is driven truthfully by SignalContactMonitor.
        packets.push(RawBrainBitPacketPayload {
            timestamp: ts,
            raw_channels: RawEegChannelsPayload {
                t3: t3_uv,
                t4: t4_uv,
                o1: o1_uv,
                o2: o2_uv,
            },
            signal_quality: quality,
            resistance_k_ohm: None,
        });
    }
    batch.clear();
    let _ = app.emit(EVENT_BRAINBIT_RAW_BATCH, packets);
}

/// Thread-safe, cheaply cloneable handle managed by Tauri for all BrainBit BLE actions.
#[derive(Clone)]
pub struct BrainBitDriver {
    inner: Arc<BrainBitDriverInner>,
}

struct BrainBitDriverInner {
    sdk_available: bool,
    shared: Arc<SharedState>,
    cmd_tx: Sender<WorkerCommand>,
    cb_tx: Sender<CallbackEvent>,
    worker_handle: Mutex<Option<JoinHandle<()>>>,
    forwarder_handle: Mutex<Option<JoinHandle<()>>>,
}

impl BrainBitDriver {
    pub fn start(
        app: AppHandle,
        app_data_dir: Option<&Path>,
        resource_dir: Option<&Path>,
        recorder: Arc<EegDumpRecorder>,
    ) -> Self {
        let (api, sdk_err) = match NeuroSdkApi::load(app_data_dir, resource_dir) {
            Ok((loaded, path)) => {
                eprintln!("[FocusGlass] Loaded NeuroSDK2 from {}", path.display());
                (Some(Arc::new(loaded)), None)
            }
            Err(err) => {
                eprintln!("[FocusGlass] NeuroSDK2 unavailable: {err}");
                (None, Some(err))
            }
        };

        let sdk_available = api.is_some();
        let initial_bt_status = if sdk_available {
            DeviceStatusResponse::bluetooth_ready()
        } else {
            DeviceStatusResponse::bluetooth_pending_with_reason(sdk_err.clone())
        };

        let shared = Arc::new(SharedState {
            status: Mutex::new(initial_bt_status),
            mode: AtomicU8::new(MODE_IDLE),
            latest_resist: Mutex::new(None),
            sdk_error: Mutex::new(sdk_err),
        });

        let (cmd_tx, cmd_rx) = bounded::<WorkerCommand>(32);
        let (cb_tx, cb_rx) = bounded::<CallbackEvent>(4096);

        let forwarder_shared = Arc::clone(&shared);
        let forwarder_recorder = Arc::clone(&recorder);
        let forwarder_app = app.clone();
        let forwarder_handle = thread::Builder::new()
            .name("focusglass-brainbit-telemetry".to_string())
            .spawn(move || telemetry_loop(forwarder_app, forwarder_shared, forwarder_recorder, cb_rx))
            .ok();

        let worker_shared = Arc::clone(&shared);
        let worker_recorder = Arc::clone(&recorder);
        let worker_cb_tx = cb_tx.clone();
        let worker_handle = thread::Builder::new()
            .name("focusglass-brainbit-worker".to_string())
            .spawn(move || {
                let mut ctx = WorkerContext {
                    api,
                    app,
                    shared: worker_shared,
                    recorder: worker_recorder,
                    cb_tx: worker_cb_tx,
                    scanner: std::ptr::null_mut(),
                    known_sensors: HashMap::new(),
                    session: None,
                };
                while let Ok(cmd) = cmd_rx.recv() {
                    match cmd {
                        WorkerCommand::Scan { duration_ms, reply } => {
                            let res = match ctx.run_scan(duration_ms) {
                                Ok(devices) => {
                                    let msg = if devices.is_empty() {
                                        "Устройства BrainBit не обнаружены. Проверьте, что аккумулятор заряжен и вставлен (мигает светодиод), а ободок не спарен в настройках Bluetooth Windows.".to_string()
                                    } else {
                                        format!("Найдено устройств BrainBit: {}.", devices.len())
                                    };
                                    Ok(BrainBitScanResponse {
                                        sdk_available: true,
                                        devices,
                                        message: msg,
                                    })
                                }
                                Err(err) if !ctx.sdk_available_flag() => Ok(BrainBitScanResponse {
                                    sdk_available: false,
                                    devices: Vec::new(),
                                    message: err.to_string(),
                                }),
                                Err(err) => Err(err),
                            };
                            let _ = reply.send(res);
                        }
                        WorkerCommand::Connect {
                            address,
                            initial_mode,
                            reply,
                        } => {
                            let _ = reply.send(ctx.connect(address, initial_mode));
                        }
                        WorkerCommand::SetMode { mode, reply } => {
                            let _ = reply.send(ctx.set_mode(mode));
                        }
                        WorkerCommand::Disconnect { reply } => {
                            let _ = reply.send(Ok(ctx.disconnect_active(true)));
                        }
                        WorkerCommand::Shutdown { reply } => {
                            ctx.shutdown();
                            let _ = reply.send(());
                            break;
                        }
                    }
                }
            })
            .ok();

        Self {
            inner: Arc::new(BrainBitDriverInner {
                sdk_available,
                shared,
                cmd_tx,
                cb_tx,
                worker_handle: Mutex::new(worker_handle),
                forwarder_handle: Mutex::new(forwarder_handle),
            }),
        }
    }

    pub fn bluetooth_status(&self) -> DeviceStatusResponse {
        self.inner
            .shared
            .status
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| DeviceStatusResponse::bluetooth_pending())
    }

    pub fn latest_resist(&self) -> Option<ChannelResistancePayload> {
        self.inner.shared.latest_resist.lock().ok().and_then(|g| *g)
    }

    pub fn scan(&self, duration_ms: Option<u64>) -> AppResult<BrainBitScanResponse> {
        if !self.inner.sdk_available {
            let reason = self
                .inner
                .shared
                .sdk_error
                .lock()
                .ok()
                .and_then(|g| g.clone())
                .unwrap_or_else(|| "NeuroSDK2 library is not loaded.".to_string());
            return Ok(BrainBitScanResponse {
                sdk_available: false,
                devices: Vec::new(),
                message: reason,
            });
        }
        let (tx, rx) = bounded(1);
        self.inner
            .cmd_tx
            .send(WorkerCommand::Scan {
                duration_ms: duration_ms.unwrap_or(DEFAULT_SCAN_MS),
                reply: tx,
            })
            .map_err(|_| AppError::Bci("BrainBit worker thread is not running".to_string()))?;
        rx.recv()
            .map_err(|_| AppError::Bci("BrainBit scan reply channel closed".to_string()))?
    }

    pub fn connect(
        &self,
        address: String,
        initial_mode: Option<String>,
    ) -> AppResult<DeviceStatusResponse> {
        let mode = match initial_mode {
            Some(ref raw) => StreamMode::parse(raw)?,
            None => StreamMode::Resist,
        };
        let (tx, rx) = bounded(1);
        self.inner
            .cmd_tx
            .send(WorkerCommand::Connect {
                address,
                initial_mode: mode,
                reply: tx,
            })
            .map_err(|_| AppError::Bci("BrainBit worker thread is not running".to_string()))?;
        rx.recv()
            .map_err(|_| AppError::Bci("BrainBit connect reply channel closed".to_string()))?
    }

    pub fn set_mode(&self, mode: String) -> AppResult<DeviceStatusResponse> {
        let parsed = StreamMode::parse(&mode)?;
        let (tx, rx) = bounded(1);
        self.inner
            .cmd_tx
            .send(WorkerCommand::SetMode {
                mode: parsed,
                reply: tx,
            })
            .map_err(|_| AppError::Bci("BrainBit worker thread is not running".to_string()))?;
        rx.recv()
            .map_err(|_| AppError::Bci("BrainBit mode reply channel closed".to_string()))?
    }

    pub fn disconnect(&self) -> AppResult<DeviceStatusResponse> {
        let (tx, rx) = bounded(1);
        self.inner
            .cmd_tx
            .send(WorkerCommand::Disconnect { reply: tx })
            .map_err(|_| AppError::Bci("BrainBit worker thread is not running".to_string()))?;
        rx.recv()
            .map_err(|_| AppError::Bci("BrainBit disconnect reply channel closed".to_string()))?
    }

    pub fn shutdown(&self) {
        self.inner.shutdown();
    }
}

impl BrainBitDriverInner {
    fn shutdown(&self) {
        let (tx, rx) = bounded(1);
        if self.cmd_tx.send(WorkerCommand::Shutdown { reply: tx }).is_ok() {
            let _ = rx.recv_timeout(Duration::from_secs(2));
        }
        let _ = self.cb_tx.try_send(CallbackEvent::StopForwarder);
        if let Ok(mut guard) = self.worker_handle.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
        if let Ok(mut guard) = self.forwarder_handle.lock() {
            if let Some(handle) = guard.take() {
                let _ = handle.join();
            }
        }
    }
}

impl Drop for BrainBitDriverInner {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl WorkerContext {
    fn sdk_available_flag(&self) -> bool {
        self.api.is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::raw::c_char;

    #[test]
    fn maps_brainbit2_channel_ids_and_falls_back_cleanly() {
        let ch = |id: u8, num: u8| EEGChannelInfo {
            id,
            ch_type: 0,
            name: [0 as c_char; 8],
            num,
        };
        let channels = [
            ch(EEG_CH_ID_T4, 3),
            ch(EEG_CH_ID_O1, 0),
            ch(EEG_CH_ID_T3, 2),
            ch(EEG_CH_ID_O2, 1),
        ];
        let map = BrainBit2ChannelMap::from_channels(&channels);
        assert_eq!(map.o1, Some(0));
        assert_eq!(map.o2, Some(1));
        assert_eq!(map.t3, Some(2));
        assert_eq!(map.t4, Some(3));
    }

    #[test]
    fn parses_valid_stream_modes_and_rejects_unknown() {
        assert_eq!(StreamMode::parse("idle").unwrap(), StreamMode::Idle);
        assert_eq!(StreamMode::parse("resist").unwrap(), StreamMode::Resist);
        assert_eq!(StreamMode::parse("signal").unwrap(), StreamMode::Signal);
        assert!(StreamMode::parse("unknown").is_err());
    }
}
