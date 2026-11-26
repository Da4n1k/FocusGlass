//! Streaming 250 Hz raw EEG CSV dump recorder for BrainBit BLE & Simulator validation.
//!
//! Writes unfiltered raw microvolt samples (`T3_uV, T4_uV, O1_uV, O2_uV`) along with
//! hardware `pack_num`, `marker`, live contact quality flags (`T3_ok..O2_ok`), and
//! user-annotated state/event labels directly to disk via a buffered writer.
//! Output CSV files are directly compatible with FocusGlass `EEGRecordingPlayer` and `pandas.read_csv(..., comment='#')`.

use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

use super::contact::ChannelResistancePayload;

pub const EVENT_EEG_DUMP_STATUS: &str = "eeg-dump-status";
const FLUSH_EVERY_SAMPLES: u64 = 250;
const WRITER_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EegDumpStatusResponse {
    pub recording: bool,
    pub dumps_dir: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    pub sample_count: u64,
    pub duration_seconds: f64,
    pub marker_count: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub active_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_saved_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_saved_samples: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DumpSampleInput {
    pub timestamp: u64,
    #[serde(default)]
    pub pack_num: u32,
    #[serde(default)]
    pub marker: u8,
    pub t3: f64,
    pub t4: f64,
    pub o1: f64,
    pub o2: f64,
    #[serde(default = "default_true")]
    pub t3_ok: bool,
    #[serde(default = "default_true")]
    pub t4_ok: bool,
    #[serde(default = "default_true")]
    pub o1_ok: bool,
    #[serde(default = "default_true")]
    pub o2_ok: bool,
}

fn default_true() -> bool {
    true
}

struct ActiveDump {
    writer: BufWriter<File>,
    path: PathBuf,
    file_name: String,
    source: String,
    sample_rate_hz: u32,
    sample_count: u64,
    marker_count: u64,
    active_label: String,
    pending_one_shot: Option<String>,
}

impl ActiveDump {
    fn write_sample(&mut self, sample: &DumpSampleInput) -> AppResult<()> {
        let label_owned = self.pending_one_shot.take();
        let label = match label_owned.as_deref() {
            Some(one_shot) if !self.active_label.is_empty() => {
                format!("{};{}", self.active_label, one_shot)
            }
            Some(one_shot) => one_shot.to_string(),
            None => self.active_label.clone(),
        };

        writeln!(
            self.writer,
            "{},{},{},{:.3},{:.3},{:.3},{:.3},{},{},{},{},{}",
            sample.timestamp,
            sample.pack_num,
            sample.marker,
            sanitize_f64(sample.t3),
            sanitize_f64(sample.t4),
            sanitize_f64(sample.o1),
            sanitize_f64(sample.o2),
            u8::from(sample.t3_ok),
            u8::from(sample.t4_ok),
            u8::from(sample.o1_ok),
            u8::from(sample.o2_ok),
            label
        )?;

        self.sample_count += 1;
        if self.sample_count % FLUSH_EVERY_SAMPLES == 0 {
            self.writer.flush()?;
        }
        Ok(())
    }

    fn finish(mut self) -> AppResult<(PathBuf, u64)> {
        self.writer.flush()?;
        Ok((self.path, self.sample_count))
    }
}

struct RecorderState {
    active: Option<ActiveDump>,
    last_saved_path: Option<String>,
    last_saved_samples: Option<u64>,
}

pub struct EegDumpRecorder {
    dumps_dir: PathBuf,
    recording_flag: AtomicBool,
    state: Mutex<RecorderState>,
}

impl EegDumpRecorder {
    pub fn new(dumps_dir: PathBuf) -> Self {
        Self {
            dumps_dir,
            recording_flag: AtomicBool::new(false),
            state: Mutex::new(RecorderState {
                active: None,
                last_saved_path: None,
                last_saved_samples: None,
            }),
        }
    }

    pub fn dumps_dir(&self) -> &Path {
        &self.dumps_dir
    }

    #[inline]
    pub fn is_recording(&self) -> bool {
        self.recording_flag.load(Ordering::Relaxed)
    }

    pub fn status(&self) -> AppResult<EegDumpStatusResponse> {
        let guard = self
            .state
            .lock()
            .map_err(|_| AppError::LockPoisoned("eeg dump recorder"))?;
        Ok(self.build_status(&guard))
    }

    pub fn start(
        &self,
        source: &str,
        device_name: &str,
        serial_number: Option<&str>,
        sample_rate_hz: u32,
        pre_session_resist: Option<ChannelResistancePayload>,
        session_tag: Option<&str>,
    ) -> AppResult<EegDumpStatusResponse> {
        if source != "bluetooth" && source != "simulator" {
            return Err(AppError::InvalidArgument(format!(
                "unsupported dump source {source:?} (expected 'bluetooth' or 'simulator')"
            )));
        }

        fs::create_dir_all(&self.dumps_dir)?;

        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::LockPoisoned("eeg dump recorder"))?;

        if let Some(prev) = guard.active.take() {
            self.recording_flag.store(false, Ordering::Release);
            if let Ok((saved_path, saved_samples)) = prev.finish() {
                guard.last_saved_path = Some(saved_path.display().to_string());
                guard.last_saved_samples = Some(saved_samples);
            }
        }

        let now_ms = epoch_ms();
        let stamp = format_utc_filename_stamp(now_ms / 1000);
        let prefix = if source == "bluetooth" {
            "brainbit"
        } else {
            "simulator"
        };
        let clean_tag = session_tag.map(sanitize_filename_segment).unwrap_or_default();
        let base_name = if clean_tag.is_empty() {
            format!("{prefix}_{stamp}")
        } else {
            format!("{prefix}_{stamp}_{clean_tag}")
        };
        let path = unique_csv_path(&self.dumps_dir, &base_name);
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| format!("{base_name}.csv"));

        let file = File::create(&path)?;
        let mut writer = BufWriter::with_capacity(WRITER_BUFFER_BYTES, file);

        writeln!(writer, "# FocusGlass Raw EEG Dump v1")?;
        writeln!(writer, "# source={source}")?;
        writeln!(
            writer,
            "# device={}",
            sanitize_csv_field(device_name)
        )?;
        if let Some(sn) = serial_number.filter(|s| !s.trim().is_empty()) {
            writeln!(writer, "# serial_number={}", sanitize_csv_field(sn))?;
        }
        writeln!(writer, "# sample_rate_hz={}", sample_rate_hz.max(1))?;
        writeln!(writer, "# started_at_unix_ms={now_ms}")?;
        if let Some(res) = pre_session_resist {
            writeln!(
                writer,
                "# pre_session_resist_kOhm=T3:{},T4:{},O1:{},O2:{}",
                fmt_opt_kohm(res.t3),
                fmt_opt_kohm(res.t4),
                fmt_opt_kohm(res.o1),
                fmt_opt_kohm(res.o2)
            )?;
        }
        writeln!(
            writer,
            "timestamp_ms,pack_num,marker,T3_uV,T4_uV,O1_uV,O2_uV,T3_ok,T4_ok,O1_ok,O2_ok,event_label"
        )?;
        writer.flush()?;

        guard.active = Some(ActiveDump {
            writer,
            path,
            file_name,
            source: source.to_string(),
            sample_rate_hz: sample_rate_hz.max(1),
            sample_count: 0,
            marker_count: 0,
            active_label: String::new(),
            pending_one_shot: None,
        });
        self.recording_flag.store(true, Ordering::Release);

        Ok(self.build_status(&guard))
    }

    pub fn stop(&self) -> AppResult<EegDumpStatusResponse> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::LockPoisoned("eeg dump recorder"))?;
        self.recording_flag.store(false, Ordering::Release);

        if let Some(active) = guard.active.take() {
            let (saved_path, saved_samples) = active.finish()?;
            guard.last_saved_path = Some(saved_path.display().to_string());
            guard.last_saved_samples = Some(saved_samples);
        }
        Ok(self.build_status(&guard))
    }

    /// Stops recording only if the active dump belongs to `source` (used on BLE disconnect/mode change).
    pub fn stop_if_source(&self, source: &str) -> AppResult<Option<EegDumpStatusResponse>> {
        if !self.is_recording() {
            return Ok(None);
        }
        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::LockPoisoned("eeg dump recorder"))?;
        let matches = guard
            .active
            .as_ref()
            .is_some_and(|dump| dump.source == source);
        if !matches {
            return Ok(None);
        }
        self.recording_flag.store(false, Ordering::Release);
        if let Some(active) = guard.active.take() {
            let (saved_path, saved_samples) = active.finish()?;
            guard.last_saved_path = Some(saved_path.display().to_string());
            guard.last_saved_samples = Some(saved_samples);
        }
        Ok(Some(self.build_status(&guard)))
    }

    /// Sets either a continuous phase label (`one_shot == false`) or a one-shot event marker
    /// stamped onto the next recorded sample (`one_shot == true`).
    pub fn set_label(&self, raw_label: &str, one_shot: bool) -> AppResult<EegDumpStatusResponse> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::LockPoisoned("eeg dump recorder"))?;
        let active = guard.active.as_mut().ok_or_else(|| {
            AppError::InvalidArgument("No active EEG dump recording to annotate.".to_string())
        })?;
        let clean = sanitize_csv_field(raw_label);
        if one_shot {
            if clean.is_empty() {
                return Err(AppError::InvalidArgument(
                    "One-shot event label must not be empty.".to_string(),
                ));
            }
            active.pending_one_shot = Some(clean);
            active.marker_count += 1;
        } else {
            if !clean.is_empty() && active.active_label != clean {
                active.marker_count += 1;
            }
            active.active_label = clean;
        }
        Ok(self.build_status(&guard))
    }

    /// Appends a single live hardware sample directly from `BrainBitDriver::telemetry_loop`.
    /// Returns `Some(status)` whenever sample count crosses a 1-second boundary (250 samples).
    pub fn record_bluetooth_sample(
        &self,
        sample: &DumpSampleInput,
    ) -> AppResult<Option<EegDumpStatusResponse>> {
        if !self.is_recording() {
            return Ok(None);
        }
        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::LockPoisoned("eeg dump recorder"))?;
        let Some(active) = guard.active.as_mut() else {
            self.recording_flag.store(false, Ordering::Release);
            return Ok(None);
        };
        if active.source != "bluetooth" {
            return Ok(None);
        }
        active.write_sample(sample)?;
        if active.sample_count % FLUSH_EVERY_SAMPLES == 0 {
            Ok(Some(self.build_status(&guard)))
        } else {
            Ok(None)
        }
    }

    /// Appends a batch of samples from the Simulator frontend (never allowed into a BLE dump).
    pub fn append_simulator_samples(
        &self,
        samples: &[DumpSampleInput],
    ) -> AppResult<Option<EegDumpStatusResponse>> {
        if !self.is_recording() || samples.is_empty() {
            return Ok(None);
        }
        let mut guard = self
            .state
            .lock()
            .map_err(|_| AppError::LockPoisoned("eeg dump recorder"))?;
        let Some(active) = guard.active.as_mut() else {
            self.recording_flag.store(false, Ordering::Release);
            return Ok(None);
        };
        if active.source != "simulator" {
            return Ok(None);
        }
        let prev_bucket = active.sample_count / FLUSH_EVERY_SAMPLES;
        for sample in samples {
            active.write_sample(sample)?;
        }
        let next_bucket = active.sample_count / FLUSH_EVERY_SAMPLES;
        if next_bucket > prev_bucket {
            Ok(Some(self.build_status(&guard)))
        } else {
            Ok(None)
        }
    }

    fn build_status(&self, state: &RecorderState) -> EegDumpStatusResponse {
        match &state.active {
            Some(active) => EegDumpStatusResponse {
                recording: true,
                dumps_dir: self.dumps_dir.display().to_string(),
                file_path: Some(active.path.display().to_string()),
                file_name: Some(active.file_name.clone()),
                source: Some(active.source.clone()),
                sample_count: active.sample_count,
                duration_seconds: (active.sample_count as f64)
                    / f64::from(active.sample_rate_hz.max(1)),
                marker_count: active.marker_count,
                active_label: if active.active_label.is_empty() {
                    None
                } else {
                    Some(active.active_label.clone())
                },
                last_saved_path: state.last_saved_path.clone(),
                last_saved_samples: state.last_saved_samples,
            },
            None => EegDumpStatusResponse {
                recording: false,
                dumps_dir: self.dumps_dir.display().to_string(),
                file_path: None,
                file_name: None,
                source: None,
                sample_count: 0,
                duration_seconds: 0.0,
                marker_count: 0,
                active_label: None,
                last_saved_path: state.last_saved_path.clone(),
                last_saved_samples: state.last_saved_samples,
            },
        }
    }
}

impl Drop for EegDumpRecorder {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn sanitize_f64(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

fn fmt_opt_kohm(val: Option<f64>) -> String {
    match val {
        Some(v) if v.is_finite() => format!("{v:.1}"),
        _ => "inf".to_string(),
    }
}

fn sanitize_csv_field(raw: &str) -> String {
    raw.trim()
        .chars()
        .filter(|&c| c != ',' && c != '\r' && c != '\n' && c != '"')
        .take(64)
        .collect()
}

fn sanitize_filename_segment(raw: &str) -> String {
    raw.trim()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .take(32)
        .collect::<String>()
        .trim_matches('_')
        .to_string()
}

fn unique_csv_path(dir: &Path, base_name: &str) -> PathBuf {
    let primary = dir.join(format!("{base_name}.csv"));
    if !primary.exists() {
        return primary;
    }
    for n in 1u32..10_000 {
        let candidate = dir.join(format!("{base_name}_{n}.csv"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!("{base_name}_{}.csv", epoch_ms()))
}

fn epoch_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Pure-Rust UTC `YYYY-MM-DD_HH-MM-SS` timestamp using Howard Hinnant's civil-from-days algorithm.
fn format_utc_filename_stamp(unix_secs: u64) -> String {
    let days = (unix_secs / 86_400) as i64;
    let secs_of_day = unix_secs % 86_400;
    let hour = secs_of_day / 3_600;
    let minute = (secs_of_day % 3_600) / 60;
    let second = secs_of_day % 60;

    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = y + i64::from(m <= 2);

    format!("{year:04}-{m:02}-{d:02}_{hour:02}-{minute:02}-{second:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "focusglass_dump_test_{name}_{}",
            epoch_ms()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn formats_utc_calendar_timestamps_accurately() {
        assert_eq!(format_utc_filename_stamp(0), "1970-01-01_00-00-00");
        assert_eq!(
            format_utc_filename_stamp(1_700_000_000),
            "2023-11-14_22-13-20"
        );
        // Leap day 2024-02-29 12:30:45 UTC
        assert_eq!(
            format_utc_filename_stamp(1_709_209_845),
            "2024-02-29_12-30-45"
        );
    }

    #[test]
    fn records_raw_bluetooth_csv_with_metadata_and_labels() {
        let dir = temp_dir("ble");
        let rec = EegDumpRecorder::new(dir.clone());
        let resist = ChannelResistancePayload {
            t3: Some(140.5),
            t4: Some(210.0),
            o1: Some(320.2),
            o2: None,
        };

        let started = rec
            .start(
                "bluetooth",
                "BrainBit #42",
                Some("SN123"),
                250,
                Some(resist),
                Some("eyes closed test"),
            )
            .expect("start dump");
        assert!(started.recording);
        let file_path = PathBuf::from(started.file_path.as_deref().expect("path"));
        assert!(file_path.to_string_lossy().contains("eyes_closed_test"));

        rec.set_label("eyes_closed", false).expect("set phase");
        rec.record_bluetooth_sample(&DumpSampleInput {
            timestamp: 1_000,
            pack_num: 7,
            marker: 0,
            t3: -42_000.125,
            t4: 35_000.5,
            o1: 81_234.0,
            o2: -12_345.75,
            t3_ok: true,
            t4_ok: true,
            o1_ok: true,
            o2_ok: true,
        })
        .expect("write 1");

        rec.set_label("blink", true).expect("one shot");
        rec.record_bluetooth_sample(&DumpSampleInput {
            timestamp: 1_004,
            pack_num: 8,
            marker: 1,
            t3: -41_990.0,
            t4: 35_010.0,
            o1: 81_240.0,
            o2: -12_340.0,
            t3_ok: true,
            t4_ok: true,
            o1_ok: false,
            o2_ok: true,
        })
        .expect("write 2");

        // Simulator batch must be ignored while recording Bluetooth
        let ignored = rec
            .append_simulator_samples(&[DumpSampleInput {
                timestamp: 2000,
                pack_num: 1,
                marker: 0,
                t3: 0.0,
                t4: 0.0,
                o1: 0.0,
                o2: 0.0,
                t3_ok: true,
                t4_ok: true,
                o1_ok: true,
                o2_ok: true,
            }])
            .expect("ignore sim");
        assert!(ignored.is_none());

        let stopped = rec.stop().expect("stop dump");
        assert!(!stopped.recording);
        assert_eq!(stopped.last_saved_samples, Some(2));

        let csv = fs::read_to_string(&file_path).expect("read csv");
        assert!(csv.contains("# sample_rate_hz=250"));
        assert!(csv.contains("# pre_session_resist_kOhm=T3:140.5,T4:210.0,O1:320.2,O2:inf"));
        assert!(csv.contains("timestamp_ms,pack_num,marker,T3_uV,T4_uV,O1_uV,O2_uV,T3_ok,T4_ok,O1_ok,O2_ok,event_label"));
        assert!(csv.contains("1000,7,0,-42000.125,35000.500,81234.000,-12345.750,1,1,1,1,eyes_closed"));
        assert!(csv.contains("1004,8,1,-41990.000,35010.000,81240.000,-12340.000,1,1,0,1,eyes_closed;blink"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn rejects_invalid_source_and_sanitizes_csv_labels() {
        let dir = temp_dir("invalid");
        let rec = EegDumpRecorder::new(dir.clone());
        assert!(rec
            .start("usb", "Unknown", None, 250, None, None)
            .is_err());

        rec.start("simulator", "Sim", None, 250, None, None)
            .expect("start sim");
        let st = rec
            .set_label("bad,label\nwith\"quotes", false)
            .expect("sanitized");
        assert_eq!(st.active_label.as_deref(), Some("badlabelwithquotes"));

        let _ = rec.stop();
        let _ = fs::remove_dir_all(&dir);
    }
}
