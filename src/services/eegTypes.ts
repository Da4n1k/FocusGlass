/**
 * FocusGlass Canonical BCI Telemetry & Settings Types
 * Strictly aligned with PROJECT.md and BrainBit SDK Specifications
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

export interface EEGTelemetry {
  timestamp: number;
  rawChannels: RawEEGChannels;
  concentration: number; // Beta-based index: 0 - 100%
  relaxation: number;    // Alpha-based index: 0 - 100%
  signalQuality: ElectrodeSignalQuality;
  isArtifact: boolean;   // EMG / EOG artifact flag
}

export interface FocusGlassSettings {
  mode: 'concentration' | 'relaxation';
  deviceSource: 'simulator' | 'bluetooth';
  threshold: number;          // Target threshold % [10, 95] (default: 60)
  sensitivitySeconds: number; // Moving average buffer window [0.1, 10.0]s (default: 2.0)
  dimmingMaxOpacity: number;  // Maximum screen dimming opacity [0.1, 0.95] (default: 0.70)
  blurRadius: number;         // Maximum optical vignette blur [0, 32]px (default: 16)
  audioFeedbackEnabled: boolean; // Nature/pink-noise biofeedback sound
  glassOpacity: number;       // UI panel translucency [0.1, 1.0] (default: 0.85)
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
}

export interface DeviceStatus {
  connected: boolean;
  deviceSource: 'simulator' | 'bluetooth';
  batteryPercentage: number;
  deviceName: string;
  samplingRateHz: number;
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
}

export type PresetState =
  | 'high_focus'      // 90-95% Beta dominant
  | 'calm_flow'       // 75-80% Balanced Alpha/Beta
  | 'attention_drift' // 45-50% Theta rising, dips below threshold
  | 'distracted'      // 20-30% Mind wandering, deep dimming
  | 'meditation';     // 90-95% Alpha dominant
