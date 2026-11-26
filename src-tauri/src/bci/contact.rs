//! Electrode resistance normalization (`Ohm -> kOhm`) and live 250 Hz contact detachment guard.

use std::collections::VecDeque;

/// Maximum resistance accepted as usable skin contact for FocusGlass Fit Check / BOF screening.
pub const MAX_USABLE_RESISTANCE_KOHM: f64 = 800.0;
/// Raw resistances above 10 MOhm (or non-finite / negative) represent an open lead.
const MAX_FINITE_OHM: f64 = 10_000_000.0;
/// Sliding window for live signal detachment monitoring (1.0 s at 250 Hz).
const WINDOW_SAMPLES: usize = 250;
const MIN_SAMPLES_FOR_SIGNAL_CHECK: usize = 64;
/// Physical BrainBit 24-bit ADC input range is ±375 mV (±375,000 uV).
/// Good dry electrodes commonly carry ±10..200 mV electrochemical DC offset,
/// so absolute rail detection must only trigger near actual ADC saturation.
const ADC_RAIL_THRESHOLD_UV: f64 = 340_000.0;
/// Open dry electrodes pick up huge 50/60 Hz mains hum (> 8 mV peak-to-peak in 1 s),
/// which is DC-invariant (`max - min`) and unaffected by steady half-cell DC offset.
const MAX_PEAK_TO_PEAK_UV: f64 = 8_000.0;
/// Dead flatline (< 0.05 uV across a full 1s window) indicates a disconnected/zeroed stream.
const FLATLINE_PEAK_TO_PEAK_UV: f64 = 0.05;

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelResistancePayload {
    pub t3: Option<f64>,
    pub t4: Option<f64>,
    pub o1: Option<f64>,
    pub o2: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElectrodeQualityPayload {
    pub t3: bool,
    pub t4: bool,
    pub o1: bool,
    pub o2: bool,
}

impl ElectrodeQualityPayload {
    #[cfg(test)]
    pub fn all_true() -> Self {
        Self {
            t3: true,
            t4: true,
            o1: true,
            o2: true,
        }
    }

    pub fn from_resistances(res: ChannelResistancePayload) -> Self {
        Self {
            t3: resistance_is_usable(res.t3),
            t4: resistance_is_usable(res.t4),
            o1: resistance_is_usable(res.o1),
            o2: resistance_is_usable(res.o2),
        }
    }
}

/// Converts NeuroSDK2 resistance in Ohms into kOhm (`None` for infinity / open lead).
pub fn ohm_to_kohm(ohm: f64) -> Option<f64> {
    if !ohm.is_finite() || ohm < 0.0 || ohm > MAX_FINITE_OHM {
        return None;
    }
    Some((ohm / 1000.0 * 10.0).round() / 10.0)
}

pub fn resist_ohms_to_payload(o1: f64, o2: f64, t3: f64, t4: f64) -> ChannelResistancePayload {
    ChannelResistancePayload {
        t3: ohm_to_kohm(t3),
        t4: ohm_to_kohm(t4),
        o1: ohm_to_kohm(o1),
        o2: ohm_to_kohm(o2),
    }
}

pub fn resistance_is_usable(kohm: Option<f64>) -> bool {
    matches!(kohm, Some(v) if v.is_finite() && (0.0..=MAX_USABLE_RESISTANCE_KOHM).contains(&v))
}

#[derive(Default)]
struct ChannelWindow {
    samples: VecDeque<f64>,
    last_good: bool,
}

impl ChannelWindow {
    fn new() -> Self {
        Self {
            samples: VecDeque::with_capacity(WINDOW_SAMPLES + 1),
            last_good: true,
        }
    }

    fn push(&mut self, uv: f64) -> bool {
        if !uv.is_finite() {
            self.samples.clear();
            self.last_good = false;
            return false;
        }
        if self.samples.len() >= WINDOW_SAMPLES {
            self.samples.pop_front();
        }
        self.samples.push_back(uv);

        let len = self.samples.len();
        let mut min_v = f64::INFINITY;
        let mut max_v = f64::NEG_INFINITY;
        let mut rail_count = 0usize;
        for &s in &self.samples {
            if s < min_v {
                min_v = s;
            }
            if s > max_v {
                max_v = s;
            }
            if s.abs() > ADC_RAIL_THRESHOLD_UV {
                rail_count += 1;
            }
        }
        let p2p = max_v - min_v;

        if len < MIN_SAMPLES_FOR_SIGNAL_CHECK {
            self.last_good = uv.abs() <= ADC_RAIL_THRESHOLD_UV && p2p <= MAX_PEAK_TO_PEAK_UV;
            return self.last_good;
        }

        let too_many_railed = rail_count * 10 > len;
        let saturated = p2p > MAX_PEAK_TO_PEAK_UV;
        let flatlined = len >= WINDOW_SAMPLES && p2p < FLATLINE_PEAK_TO_PEAK_UV;

        self.last_good = !too_many_railed && !saturated && !flatlined;
        self.last_good
    }
}

/// Detects mid-session electrode detachment (open-lead saturation or dead flatline)
/// while in `CommandStartSignal` mode where impedance polling is not active.
pub struct SignalContactMonitor {
    t3: ChannelWindow,
    t4: ChannelWindow,
    o1: ChannelWindow,
    o2: ChannelWindow,
}

impl Default for SignalContactMonitor {
    fn default() -> Self {
        Self::new()
    }
}

impl SignalContactMonitor {
    pub fn new() -> Self {
        Self {
            t3: ChannelWindow::new(),
            t4: ChannelWindow::new(),
            o1: ChannelWindow::new(),
            o2: ChannelWindow::new(),
        }
    }

    pub fn reset(&mut self) {
        self.t3 = ChannelWindow::new();
        self.t4 = ChannelWindow::new();
        self.o1 = ChannelWindow::new();
        self.o2 = ChannelWindow::new();
    }

    pub fn update(&mut self, t3_uv: f64, t4_uv: f64, o1_uv: f64, o2_uv: f64) -> ElectrodeQualityPayload {
        ElectrodeQualityPayload {
            t3: self.t3.push(t3_uv),
            t4: self.t4.push(t4_uv),
            o1: self.o1.push(o1_uv),
            o2: self.o2.push(o2_uv),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_ohm_to_kohm_and_marks_infinity_as_open() {
        assert_eq!(ohm_to_kohm(145_000.0), Some(145.0));
        assert_eq!(ohm_to_kohm(799_400.0), Some(799.4));
        assert_eq!(ohm_to_kohm(f64::INFINITY), None);
        assert_eq!(ohm_to_kohm(-100.0), None);
        assert_eq!(ohm_to_kohm(15_000_000.0), None);

        assert!(resistance_is_usable(Some(500.0)));
        assert!(resistance_is_usable(Some(800.0)));
        assert!(!resistance_is_usable(Some(801.0)));
        assert!(!resistance_is_usable(None));
    }

    #[test]
    fn contact_monitor_accepts_normal_eeg_and_rejects_rail_and_flatline() {
        let mut monitor = SignalContactMonitor::new();
        let mut last = ElectrodeQualityPayload::all_true();
        for i in 0..250 {
            let eeg = (i as f64 * 0.25).sin() * 35.0;
            last = monitor.update(eeg, eeg * 0.9, eeg * 1.1, eeg * 0.8);
        }
        assert_eq!(last, ElectrodeQualityPayload::all_true());

        // Simulate open-lead rail on O1 (> 5 mV hum) while other channels stay valid.
        for i in 0..80 {
            let eeg = (i as f64 * 0.25).sin() * 30.0;
            let o1_rail = if i % 2 == 0 { 12_000.0 } else { -12_000.0 };
            last = monitor.update(eeg, eeg, o1_rail, eeg);
        }
        assert!(last.t3);
        assert!(last.t4);
        assert!(!last.o1);
        assert!(last.o2);

        // Simulate completely flatlined O2 across 250 samples.
        monitor.reset();
        for i in 0..250 {
            let eeg = (i as f64 * 0.25).sin() * 30.0;
            last = monitor.update(eeg, eeg, eeg, 0.0);
        }
        assert!(last.t3);
        assert!(last.t4);
        assert!(last.o1);
        assert!(!last.o2);
    }

    #[test]
    fn contact_monitor_tolerates_large_dry_electrode_dc_offset_and_rejects_adc_rail() {
        let mut monitor = SignalContactMonitor::new();
        let mut last = ElectrodeQualityPayload::all_true();
        // Realistic dry BrainBit half-cell DC offsets: -45 mV .. +130 mV with 35 uV AC EEG
        for i in 0..250 {
            let eeg = (i as f64 * 0.25).sin() * 35.0;
            last = monitor.update(
                -45_000.0 + eeg,
                82_000.0 + eeg * 0.9,
                130_000.0 + eeg * 1.1,
                -115_000.0 + eeg * 0.8,
            );
        }
        assert_eq!(last, ElectrodeQualityPayload::all_true());

        // Actual ADC rail saturation (> ±340 mV) on T4 must fail contact
        for i in 0..80 {
            let eeg = (i as f64 * 0.25).sin() * 30.0;
            last = monitor.update(-45_000.0 + eeg, 365_000.0, 130_000.0 + eeg, -115_000.0 + eeg);
        }
        assert!(last.t3);
        assert!(!last.t4);
        assert!(last.o1);
        assert!(last.o2);
    }
}
