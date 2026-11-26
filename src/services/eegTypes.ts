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
 * Electrode contact resistance normalized to kOhm by the data source/parser.
 * null represents an unavailable or open-circuit reading. This type does not
 * imply a manufacturer threshold; project screening limits are defined separately.
 */
export interface ChannelResistanceKOhm {
  t3: number | null;
  t4: number | null;
  o1: number | null;
  o2: number | null;
}

export interface SpectralBandPowers {
  theta: number; // Relative power % (4 - 7 Hz)
  alpha: number; // Relative power % (8 - 13 Hz)
  beta: number;  // Relative power % (14 - 30 Hz)
}

export interface RawBrainBitPacket {
  timestamp?: number;
  rawChannels: RawEEGChannels;
  signalQuality?: ElectrodeSignalQuality;
  resistanceKOhm?: ChannelResistanceKOhm;
}

export interface EEGTelemetry {
  timestamp: number;
  rawChannels: RawEEGChannels;
  concentration: number; // Beta-based index: 0 - 100%
  relaxation: number;    // Alpha-based index: 0 - 100%
  signalQuality: ElectrodeSignalQuality;
  resistanceKOhm?: ChannelResistanceKOhm;
  spectrum?: SpectralBandPowers;
  isArtifact: boolean;   // EMG / EOG artifact flag
}

export type FeedbackStyle = 'dimming' | 'blur' | 'distracting_only';

/** What the overlay darkens: the whole screen or only distracting foreground windows. */
export type DimmingScope = 'fullscreen' | 'distractors';

/**
 * Visual overlay concept agreed with Neurotech («не навреди»):
 * - 'fullscreen_dim' : Smooth full-screen brightness dimming only (0 px blur, baseline TZ)
 * - 'vignette_blur'  : Crisp center + blurred/dimmed peripheral vignette around screen edges
 * - 'threshold_blur' : Gentle dim until trigger deficit, then dense unreadable blur (≥20 px) + «Сделай паузу»
 * - 'distractors'    : Work windows stay crisp; only selected distractor windows dim/blur
 */
export type OverlayVisualMode =
  | 'fullscreen_dim'
  | 'vignette_blur'
  | 'threshold_blur'
  | 'distractors';

export interface FocusGlassSettings {
  mode: 'concentration' | 'relaxation';
  deviceSource: 'simulator' | 'bluetooth';
  threshold: number;             // Target threshold % [10, 95] (default: 60)
  sensitivitySeconds: number;    // Moving average window [0.001, 10.0]s (default: 2.0)
  dimmingMaxOpacity: number;     // Maximum screen dimming opacity [0.05, 0.95] (default: 0.70)
  blurRadius: number;            // Maximum vignette / dense / distractor blur [0, 32]px (default: 16)
  overlayMode: OverlayVisualMode; // Eye-safe overlay concept selector
  dimmingScope: DimmingScope;    // Derived/legacy scope ('fullscreen' | 'distractors')
  distractorPatterns: string[];  // Substrings matched against process name / window title
  audioFeedbackEnabled: boolean; // Filtered pink-noise biofeedback modulation
  audioVolume: number;           // Master volume of audio feedback [0.0, 1.0] (default: 1.0)
  invertReaction: boolean;       // Dim when the metric rises ABOVE the threshold instead of below it
  glassOpacity: number;          // UI panel translucency [0.1, 1.0] (default: 0.85)
  feedbackStyle?: FeedbackStyle; // Visual feedback presentation mode
  artifactFilterEnabled?: boolean; // Freeze biofeedback opacity during EMG/EOG bursts
}

export interface BiofeedbackFeedbackState {
  currentMetric: number;     // Active display score (personalized 0–100 when calibrated)
  smoothedMetric: number;    // Moving average display score
  effectiveThreshold?: number; // Cutoff mapped into the same scale as currentMetric
  personalDeviation?: number;  // Signed personal-norm deviation in -100…+100
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

export type BrainBitStreamMode = 'idle' | 'resist' | 'signal';

export interface DeviceStatus {
  connected: boolean;
  deviceSource: 'simulator' | 'bluetooth';
  connectionState?: DeviceConnectionState;
  batteryPercentage: number;
  deviceName: string;
  samplingRateHz: number;
  statusMessage?: string;
  streamMode?: BrainBitStreamMode;
  deviceAddress?: string;
  serialNumber?: string;
  sdkAvailable?: boolean;
}

export interface DiscoveredBrainBitDevice {
  name: string;
  address: string;
  rssi?: number;
  serialNumber?: string;
  family?: string;
}

export interface BrainBitResistUpdate {
  timestamp: number;
  resistanceKOhm: ChannelResistanceKOhm;
  signalQuality: ElectrodeSignalQuality;
}

export interface BrainBitScanResult {
  sdkAvailable: boolean;
  devices: DiscoveredBrainBitDevice[];
  message: string;
}

export interface EegDumpStatus {
  recording: boolean;
  dumpsDir: string;
  filePath?: string;
  fileName?: string;
  source?: 'bluetooth' | 'simulator';
  sampleCount: number;
  durationSeconds: number;
  markerCount: number;
  activeLabel?: string;
  lastSavedPath?: string;
  lastSavedSamples?: number;
}

export interface DumpSampleInput {
  timestamp: number;
  packNum?: number;
  marker?: number;
  t3: number;
  t4: number;
  o1: number;
  o2: number;
  t3Ok: boolean;
  t4Ok: boolean;
  o1Ok: boolean;
  o2Ok: boolean;
}

/** What the native side managed to create for the screen-dimming overlay. */
export interface OverlayInfo {
  /** Number of overlay windows (one per monitor); 0 means the in-page fallback must be used. */
  count: number;
  /** Whether the display server composites windows (required for real transparency). */
  composited: boolean;
  /** True when the Windows unified overlay/HUD window handles dimming & HUD. */
  unifiedHud?: boolean;
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

export interface FocusTimelinePoint {
  time: string;
  timestamp: number;
  focus: number;
  isDip: boolean;
}

export interface SessionRecord extends SessionStatistics {
  id: string;
  startedAt: string;
  endedAt: string;
  mode: 'concentration' | 'relaxation';
  deviceSource: 'simulator' | 'bluetooth';
  threshold: number;
  timeline?: FocusTimelinePoint[];
}

export interface CalibrationResult {
  /** Personal reference in the original Focus/Calm index space (0–100). */
  baselineFocus: number;
  baselineRelaxation: number;
  /** Robust per-mode spread (1.4826 × MAD), in original index points. */
  variabilityFocus: number;
  variabilityRelaxation: number;
  /** Later-minus-earlier Focus index drift (a fatigue proxy, not a diagnosis). */
  fatigueDrift: number;
  /** Absolute raw-index threshold recommended for this user's calibration. */
  recommendedThreshold: number;
  confidence: number;
  validSampleRatio: number;
  mode?: 'concentration' | 'relaxation';
  sampleCount?: number;
  deviceSource?: 'simulator' | 'bluetooth';
  calibratedAt?: string;
}

/** Rectangle in physical pixels. */
export interface PixelRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Biofeedback snapshot the dashboard window publishes to the unified overlay window (~15 Hz). */
export interface OverlayFrame {
  opacity: number;
  blurPx: number;
  metric: number;
  threshold: number;
  mode: 'concentration' | 'relaxation';
  scope: DimmingScope;
  visualStyle: OverlayVisualMode;
  hasVisibleDistractors: boolean;
  showPauseCard: boolean;
  showCueCard: boolean;
  streamActive: boolean;
  contactOk: boolean;
  artifactFrozen: boolean;
  isSimulator: boolean;
  paused: boolean;
  hudVisible: boolean;
  activePreset: PresetState;
  sensors: ElectrodeSignalQuality;
  /** Set by the Rust core: screen blur is active and capture frames may be requested. */
  blurActive?: boolean;
}

/** Visible unoccluded distractor window region (supports foreground & split-screen). */
export interface DistractorRegion {
  exe: string;
  title: string;
  matchedPattern: string;
  screenRect: PixelRect;
  overlayRect: PixelRect | null;
}

/** Running desktop window entry shown in Settings for 1-click distractor selection. */
export interface RunningWindowInfo {
  exe: string;
  title: string;
  isDistractor: boolean;
  matchedPattern: string | null;
  suggestedPattern: string;
  isBrowser: boolean;
}

/** Foreground window reported by the Rust SetWinEventHook monitor. */
export interface ForegroundWindowInfo {
  exe: string;
  title: string;
  isDistractor: boolean;
  matchedPattern: string | null;
  screenRect: PixelRect | null;
  overlayRect: PixelRect | null;
  distractorRegions?: DistractorRegion[];
}

export interface DistractionStatus {
  supported: boolean;
  enabled: boolean;
  patterns: string[];
}

export interface WindowState {
  clickThrough: boolean;
  overlayEnabled: boolean;
  alwaysOnTop: boolean;
}

/** Actions the overlay HUD forwards to the dashboard window. */
export type HudAction =
  | { type: 'toggle_pause' }
  | { type: 'set_preset'; preset: PresetState }
  | { type: 'inject_artifact' };

export type PresetState =
  | 'high_focus'      // 90-95% Beta dominant
  | 'calm_flow'       // 75-80% Balanced Alpha/Beta
  | 'attention_drift' // 42-48% Theta rising, dips below threshold
  | 'distracted'      // 20-30% Mind wandering, deep dimming
  | 'meditation';     // 90-95% Alpha dominant
