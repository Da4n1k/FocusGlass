import type {
  BiofeedbackFeedbackState,
  ElectrodeSignalQuality,
  PresetState,
} from './eegTypes';

/**
 * Protocol between the window that owns the engine (`main`) and the render-only windows
 * (`overlay-*`, `hud`). `main` publishes state snapshots, the other windows send commands back.
 * Everything crossing a window boundary is untrusted and validated here.
 */
export const SYNC_STATE_EVENT = 'fg://state';
export const SYNC_COMMAND_EVENT = 'fg://command';
/** A render-only window that just opened asks the engine window to re-send its latest snapshot. */
export const SYNC_REQUEST_EVENT = 'fg://request-state';

export type TrainingMode = 'concentration' | 'relaxation';
export type DeviceSourceName = 'simulator' | 'bluetooth';

export interface SyncSnapshot {
  /** Strictly increasing per publisher; receivers drop anything that is not newer. */
  seq: number;
  feedback: BiofeedbackFeedbackState;
  mode: TrainingMode;
  deviceSource: DeviceSourceName;
  threshold: number;
  /** Simulator, or a connected physical device. Dimming is suppressed when false. */
  streamActive: boolean;
  signalQuality: ElectrodeSignalQuality;
  isPaused: boolean;
  activePreset: PresetState;
}

export type SyncCommand =
  | { type: 'togglePause' }
  | { type: 'setPreset'; preset: PresetState }
  | { type: 'injectArtifact' }
  | { type: 'openDashboard' }
  | { type: 'openSettings' };

// Record<PresetState, true> makes the compiler fail here when a preset is added to eegTypes.
const PRESET_LOOKUP: Record<PresetState, true> = {
  high_focus: true,
  calm_flow: true,
  attention_drift: true,
  distracted: true,
  meditation: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBool(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

export function isPresetState(value: unknown): value is PresetState {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PRESET_LOOKUP, value);
}

function isFeedbackState(value: unknown): value is BiofeedbackFeedbackState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.currentMetric) &&
    isFiniteNumber(value.smoothedMetric) &&
    isFiniteNumber(value.deficit) &&
    isFiniteNumber(value.overlayOpacity) &&
    value.overlayOpacity >= 0 &&
    value.overlayOpacity <= 1 &&
    isFiniteNumber(value.blurRadius) &&
    value.blurRadius >= 0 &&
    isFiniteNumber(value.audioVolume) &&
    isBool(value.isDimmingActive) &&
    isBool(value.isContactOk) &&
    isBool(value.isArtifactFrozen)
  );
}

function isSignalQuality(value: unknown): value is ElectrodeSignalQuality {
  return (
    isRecord(value) &&
    isBool(value.t3) &&
    isBool(value.t4) &&
    isBool(value.o1) &&
    isBool(value.o2)
  );
}

export function isSyncSnapshot(value: unknown): value is SyncSnapshot {
  return (
    isRecord(value) &&
    isFiniteNumber(value.seq) &&
    isFeedbackState(value.feedback) &&
    (value.mode === 'concentration' || value.mode === 'relaxation') &&
    (value.deviceSource === 'simulator' || value.deviceSource === 'bluetooth') &&
    isFiniteNumber(value.threshold) &&
    isBool(value.streamActive) &&
    isSignalQuality(value.signalQuality) &&
    isBool(value.isPaused) &&
    isPresetState(value.activePreset)
  );
}

/** Returns a well-formed command or null; unknown types and malformed payloads are dropped. */
export function parseSyncCommand(value: unknown): SyncCommand | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null;
  switch (value.type) {
    case 'togglePause':
    case 'injectArtifact':
    case 'openDashboard':
    case 'openSettings':
      return { type: value.type };
    case 'setPreset':
      return isPresetState(value.preset) ? { type: 'setPreset', preset: value.preset } : null;
    default:
      return null;
  }
}

/** The opacity a render-only window should actually show for a snapshot. */
export function effectiveDimming(snapshot: SyncSnapshot): { opacity: number; blurPx: number } {
  const { feedback } = snapshot;
  const canDim = snapshot.streamActive && feedback.isContactOk && feedback.isDimmingActive;
  return canDim
    ? { opacity: feedback.overlayOpacity, blurPx: feedback.blurRadius }
    : { opacity: 0, blurPx: 0 };
}

/** True when a flag changes that receivers must see immediately, not at the next tick. */
function isEdge(prev: SyncSnapshot, next: SyncSnapshot): boolean {
  return (
    prev.feedback.isDimmingActive !== next.feedback.isDimmingActive ||
    prev.feedback.isContactOk !== next.feedback.isContactOk ||
    prev.feedback.isArtifactFrozen !== next.feedback.isArtifactFrozen ||
    prev.streamActive !== next.streamActive ||
    prev.isPaused !== next.isPaused ||
    prev.mode !== next.mode ||
    prev.deviceSource !== next.deviceSource ||
    prev.activePreset !== next.activePreset ||
    prev.threshold !== next.threshold
  );
}

/**
 * Rate limiter for the publisher. The engine ticks at ~60 Hz but other windows only need
 * ~20 Hz; flag changes (edges) bypass the limit. `takePending` returns the newest snapshot
 * that was held back, so the last value is never lost when the stream goes quiet.
 */
export class SnapshotThrottle {
  private lastEmitted: SyncSnapshot | null = null;
  private lastEmitAt = Number.NEGATIVE_INFINITY;
  private pending: SyncSnapshot | null = null;

  constructor(private readonly minIntervalMs: number = 50) {}

  public offer(snapshot: SyncSnapshot, nowMs: number): SyncSnapshot | null {
    const due = nowMs - this.lastEmitAt >= this.minIntervalMs;
    if (this.lastEmitted === null || due || isEdge(this.lastEmitted, snapshot)) {
      return this.emit(snapshot, nowMs);
    }
    this.pending = snapshot;
    return null;
  }

  public takePending(nowMs: number): SyncSnapshot | null {
    if (this.pending === null) return null;
    return this.emit(this.pending, nowMs);
  }

  private emit(snapshot: SyncSnapshot, nowMs: number): SyncSnapshot {
    this.lastEmitted = snapshot;
    this.lastEmitAt = nowMs;
    this.pending = null;
    return snapshot;
  }
}

/** Drops duplicated or reordered snapshots on the receiving side. */
export class SnapshotReceiver {
  private lastSeq = Number.NEGATIVE_INFINITY;

  /** Returns the snapshot when it is valid and newer than the last accepted one. */
  public accept(payload: unknown): SyncSnapshot | null {
    if (!isSyncSnapshot(payload) || payload.seq <= this.lastSeq) return null;
    this.lastSeq = payload.seq;
    return payload;
  }

  /** A restarted publisher starts counting from zero again. */
  public reset(): void {
    this.lastSeq = Number.NEGATIVE_INFINITY;
  }
}
