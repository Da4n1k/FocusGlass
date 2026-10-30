export interface RawEEGChannels {
  t3: number; // Left temporal channel (uV)
  t4: number; // Right temporal channel (uV)
  o1: number; // Left occipital channel (uV)
  o2: number; // Right occipital channel (uV)
}

export interface ElectrodeSignalQuality {
  t3: boolean;
  t4: boolean;
  o1: boolean;
  o2: boolean;
}

/**
 * Dry-electrode contact resistance in kOhm (BrainBit normal contact: ~100-800 kOhm,
 * upper limit in NeuroSDK2: 2500 kOhm; null represents open circuit / detached sensor).
 */
export interface ChannelResistanceKOhm {
  t3: number | null;
  t4: number | null;
  o1: number | null;
  o2: number | null;
}

export interface EEGTelemetry {
  timestamp: number;
  rawChannels: RawEEGChannels;
  concentration: number; // Beta-based index: 0 - 100%
  relaxation: number;    // Alpha-based index: 0 - 100%
  signalQuality: ElectrodeSignalQuality;
  resistanceKOhm?: ChannelResistanceKOhm;
  isArtifact: boolean;   // EMG / EOG artifact flag
}

export interface FocusGlassSettings {
  mode: 'concentration' | 'relaxation';
  deviceSource: 'simulator' | 'bluetooth';
  threshold: number;             // Target threshold % [10, 95] (default: 60)
  sensitivitySeconds: number;    // Moving average window [0.001, 10.0]s (default: 2.0)
  dimmingMaxOpacity: number;     // Maximum screen dimming opacity [0.05, 0.95] (default: 0.70)
  blurRadius: number;            // Maximum vignette blur [0, 32]px (default: 16)
  audioFeedbackEnabled: boolean; // Filtered pink-noise biofeedback modulation
  glassOpacity: number;          // UI panel translucency [0.1, 1.0] (default: 0.85)
}

export interface BiofeedbackFeedbackState {
  currentMetric: number;     // Raw active metric (concentration or relaxation)
  smoothedMetric: number;    // Moving average smoothed value
  deficit: number;           // Deficit below threshold in [0.0, 1.0]
  overlayOpacity: number;    // Screen dimmer opacity [0.0, dimmingMaxOpacity]
  blurRadius: number;        // Screen vignette blur radius in px
  audioVolume: number;       // Audio biofeedback volume [0.0, 1.0]
  isDimmingActive: boolean;  // True when overlayOpacity > 0.01
  isContactOk: boolean;      // True when all 4 electrodes have skin contact
  isArtifactFrozen: boolean; // True when EMG/EOG burst suspends opacity updates
}

export type DeviceConnectionState =
  | 'simulated'
  | 'disconnected'
  | 'scanning'
  | 'connected'
  | 'sdk_unavailable';

export interface DeviceStatus {
  connected: boolean;
  deviceSource: 'simulator' | 'bluetooth';
  connectionState?: DeviceConnectionState;
  batteryPercentage: number;
  deviceName: string;
  samplingRateHz: number;
  statusMessage?: string;
}

export interface DiscoveredBrainBitDevice {
  name: string;
  address: string;
  rssi?: number;
}

export interface BrainBitScanResult {
  sdkAvailable: boolean;
  devices: DiscoveredBrainBitDevice[];
  message: string;
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

export interface SessionRecord extends SessionStatistics {
  id: string;
  startedAt: string;
  endedAt: string;
  mode: 'concentration' | 'relaxation';
  deviceSource: 'simulator' | 'bluetooth';
  threshold: number;
}

export interface CalibrationResult {
  baselineFocus: number;
  baselineRelaxation: number;
  recommendedThreshold: number;
  confidence: number;
  mode?: 'concentration' | 'relaxation';
  sampleCount?: number;
}

export type PresetState =
  | 'high_focus'      // 90-95% Beta dominant
  | 'calm_flow'       // 75-80% Balanced Alpha/Beta
  | 'attention_drift' // 42-48% Theta rising, dips below threshold
  | 'distracted'      // 20-30% Mind wandering, deep dimming
  | 'meditation';     // 90-95% Alpha dominant
