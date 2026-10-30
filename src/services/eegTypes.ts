/**
 * FocusGlass / MindTint Canonical BCI Telemetry & Settings Types
 * Aligned with ООО НМФ «Нейротех» BrainBit SDK (neurosdk2 + EmotionalMath)
 */

export interface RawEEGChannels {
  t3: number; // Left Temporal channel (uV)
  t4: number; // Right Temporal channel (uV)
  o1: number; // Left Occipital channel (uV)
  o2: number; // Right Occipital channel (uV)
}

export interface ElectrodeSignalQuality {
  t3: boolean;
  t4: boolean;
  o1: boolean;
  o2: boolean;
}

/** Dry-electrode contact resistance in kOhm (BrainBit ResistData) */
export interface ElectrodeImpedanceKOhm {
  t3: number;
  t4: number;
  o1: number;
  o2: number;
}

/** Relative EEG spectral band powers in % (sums to ~100%, matches EmotionalMath SpectralDataPercents) */
export interface RelativeSpectrum {
  delta: number; // 1 - 3 Hz
  theta: number; // 4 - 7 Hz
  alpha: number; // 8 - 13 Hz
  beta: number;  // 14 - 30 Hz
  gamma: number; // 31 - 45 Hz
}

export type TelemetryOrigin = 'simulator' | 'csv_replay' | 'bluetooth';

export interface EEGTelemetry {
  timestamp: number;
  rawChannels: RawEEGChannels;
  concentration: number; // Beta-based index: 0 - 100%
  relaxation: number;    // Alpha-based index: 0 - 100%
  signalQuality: ElectrodeSignalQuality;
  isArtifact: boolean;   // EMG / EOG artifact flag
  impedanceKOhm?: ElectrodeImpedanceKOhm;
  spectrum?: RelativeSpectrum;
  origin?: TelemetryOrigin;
}

export interface FocusGlassSettings {
  mode: 'concentration' | 'relaxation';
  deviceSource: TelemetryOrigin;
  threshold: number;             // Target threshold % [10, 95] (default: 60)
  sensitivitySeconds: number;    // Moving average buffer window [0.1, 10.0]s (default: 2.0)
  dimmingMaxOpacity: number;     // Maximum screen dimming opacity [0.1, 0.95] (default: 0.70)
  blurRadius: number;            // Maximum optical vignette blur [0, 32]px (default: 16)
  audioFeedbackEnabled: boolean; // Pink-noise biofeedback sound
  glassOpacity: number;          // UI panel translucency [0.1, 1.0] (default: 0.85)
  pauseOnContactLoss?: boolean;  // Pause dimming adaptation when dry electrode loses contact (default: true)
  language?: 'ru' | 'en';        // Interface language (default: 'ru')
}

export interface BiofeedbackFeedbackState {
  currentMetric: number;     // Raw active metric (concentration or relaxation)
  smoothedMetric: number;    // Moving average smoothed value
  deficit: number;           // Deficit below threshold in [0.0, 1.0]
  overlayOpacity: number;    // Screen dimmer opacity [0.0, dimmingMaxOpacity]
  blurRadius: number;        // Screen vignette blur radius in px
  audioVolume: number;       // Audio biofeedback volume [0.0, 1.0]
  isDimmingActive: boolean;  // True when overlayOpacity > 0.01
  isContactOk: boolean;      // True when all 4 electrodes have good contact
  isArtifactFrozen: boolean; // True when EMG/EOG burst suspends opacity updates
  isContactPaused?: boolean; // True when poor electrode contact pauses adaptation
}

export interface DeviceStatus {
  connected: boolean;
  deviceSource: TelemetryOrigin;
  batteryPercentage: number | null;
  deviceName: string;
  samplingRateHz: number;
  isSimulated: boolean;
  sdkIntegrated: boolean;
  statusNote: string;
}

export interface SessionStatistics {
  durationSeconds: number;
  timeInFocusSeconds: number;
  timeInDimmingSeconds: number;
  distractionEventsCount: number;
  averageFocusScore: number;
  minFocusScore: number;
  maxFocusScore: number;
  artifactCount: number;
}

export interface CalibrationResult {
  baselineFocus: number;
  baselineRelaxation: number;
  recommendedThreshold: number;
  confidence: number;
  sampleCount?: number;
  calibratedMode?: 'concentration' | 'relaxation';
}

export interface TimelineSample {
  elapsedSec: number;
  concentration: number;
  relaxation: number;
  smoothedMetric: number;
  overlayOpacityPct: number;
  threshold: number;
  isArtifact: boolean;
  isContactOk: boolean;
}

export interface SavedSessionRecord {
  id: string;
  startedAt: string;
  endedAt: string;
  deviceSource: TelemetryOrigin;
  isSimulated: boolean;
  mode: 'concentration' | 'relaxation';
  threshold: number;
  stats: SessionStatistics;
}

export type PresetState =
  | 'high_focus'      // 90-95% Beta dominant
  | 'calm_flow'       // 75-80% Balanced Alpha/Beta
  | 'attention_drift' // 40-45% Theta rising, dips below threshold
  | 'distracted'      // 20-30% Mind wandering, deep dimming
  | 'meditation';     // 90-95% Alpha dominant
