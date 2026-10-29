/**
 * FocusGlass Canonical Interface Contracts
 * Sourced directly from PROJECT.md & Neurotech / BrainBit Specifications
 */

export const TELEMETRY_SCHEMA_VERSION = '1.0.0';

export interface RawEEGChannels {
  t3: number;
  t4: number;
  o1: number;
  o2: number;
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
  concentration: number; // 0 - 100
  relaxation: number;    // 0 - 100
  signalQuality: ElectrodeSignalQuality;
  isArtifact: boolean;
}

export interface FocusGlassSettings {
  mode: 'concentration' | 'relaxation';
  deviceSource: 'simulator' | 'bluetooth';
  threshold: number; // default 60, range [10, 95]
  sensitivitySeconds: number; // 1.0 - 5.0
  dimmingMaxOpacity: number; // 0.1 - 0.9
  blurRadius: number; // 0 - 32px
  audioFeedbackEnabled: boolean;
  glassOpacity: number; // 0.1 - 1.0
}

export interface BiofeedbackFeedbackState {
  currentMetric: number; // active metric (concentration or relaxation)
  smoothedMetric: number; // moving average smoothed metric
  deficit: number;        // deficit below threshold [0, 1]
  overlayOpacity: number; // current calculated overlay opacity [0, dimmingMaxOpacity]
  blurRadius: number;     // active blur [px]
  audioVolume: number;    // audio feedback volume [0, 1]
  isDimmingActive: boolean;
  isContactOk: boolean;
  isArtifactFrozen: boolean;
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
