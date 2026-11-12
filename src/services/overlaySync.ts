import type {
  BiofeedbackFeedbackState,
  ElectrodeSignalQuality,
  PresetState,
} from './eegTypes';
import {
  SnapshotThrottle,
  effectiveDimming,
  type DeviceSourceName,
  type SyncSnapshot,
  type TrainingMode,
} from './windowSync';

export type SnapshotInput = Omit<SyncSnapshot, 'seq'>;

/** The slice of the store the publisher reads; kept structural so it can be tested without Zustand. */
export interface PublisherState {
  feedbackState: BiofeedbackFeedbackState;
  settings: { mode: TrainingMode; deviceSource: DeviceSourceName; threshold: number };
  deviceStatus: { connected: boolean };
  telemetry: { signalQuality: ElectrodeSignalQuality } | null;
  isPaused: boolean;
  activePreset: PresetState;
}

export function buildSnapshotInput(state: PublisherState): SnapshotInput {
  const { settings } = state;
  return {
    feedback: state.feedbackState,
    mode: settings.mode,
    deviceSource: settings.deviceSource,
    threshold: settings.threshold,
    // Same rule the in-page overlay used: a simulator, or a physical device that is connected.
    streamActive: settings.deviceSource === 'simulator' || state.deviceStatus.connected,
    signalQuality: state.telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true },
    isPaused: state.isPaused,
    activePreset: state.activePreset,
  };
}

export type VisibilityAction = 'show' | 'hide' | null;

/**
 * Decides when the overlay windows are shown. A full-screen always-on-top window has a cost
 * (it can keep the compositor from unredirecting full-screen video or games), so it exists on
 * screen only while dimming is visible: it shows immediately and hides once the fade-out has
 * been invisible for `holdMs`.
 */
export class OverlayVisibility {
  private visible = false;
  private clearSince: number | null = null;

  constructor(
    private readonly holdMs: number = 800,
    private readonly epsilon: number = 0.005
  ) {}

  public update(opacity: number, nowMs: number): VisibilityAction {
    if (opacity > this.epsilon) {
      this.clearSince = null;
      if (!this.visible) {
        this.visible = true;
        return 'show';
      }
      return null;
    }

    if (!this.visible) return null;
    if (this.clearSince === null) {
      this.clearSince = nowMs;
      return null;
    }
    if (nowMs - this.clearSince >= this.holdMs) {
      this.visible = false;
      this.clearSince = null;
      return 'hide';
    }
    return null;
  }

  /** The native call for `action` failed: forget it so the next update retries. */
  public markFailed(action: 'show' | 'hide'): void {
    this.visible = action === 'hide';
    this.clearSince = null;
  }
}

export interface PublisherDeps {
  read(): SnapshotInput;
  emit(snapshot: SyncSnapshot): void;
  /** Resolves true when the native show/hide succeeded. */
  setOverlayVisible(visible: boolean): Promise<boolean>;
  now(): number;
}

/**
 * Publishes the engine state to the render-only windows and drives overlay visibility.
 * The sequence starts at the wall clock so a restarted publisher (page reload) is always
 * newer than whatever the receivers saw from its previous life, even though they never reset.
 */
export class StatePublisher {
  private seq: number;
  private readonly throttle: SnapshotThrottle;
  private readonly visibility: OverlayVisibility;
  private last: SyncSnapshot | null = null;

  constructor(
    private readonly deps: PublisherDeps,
    options: { startSeq?: number; minIntervalMs?: number; holdMs?: number } = {}
  ) {
    this.seq = options.startSeq ?? Date.now();
    this.throttle = new SnapshotThrottle(options.minIntervalMs ?? 50);
    this.visibility = new OverlayVisibility(options.holdMs ?? 800);
  }

  /** Call after every engine/store update. */
  public publish(): void {
    const now = this.deps.now();
    this.seq += 1;
    const snapshot: SyncSnapshot = { ...this.deps.read(), seq: this.seq };
    this.last = snapshot;

    const outgoing = this.throttle.offer(snapshot, now);
    if (outgoing) this.deps.emit(outgoing);
    this.applyVisibility(snapshot, now);
  }

  /** Call on a timer: flushes a held-back snapshot and lets a finished fade-out hide the windows. */
  public tick(): void {
    const now = this.deps.now();
    const pending = this.throttle.takePending(now);
    if (pending) this.deps.emit(pending);
    if (this.last) this.applyVisibility(this.last, now);
  }

  /** A window that just opened asks for the current state. */
  public resend(): void {
    if (this.last) this.deps.emit(this.last);
  }

  private applyVisibility(snapshot: SyncSnapshot, now: number): void {
    const action = this.visibility.update(effectiveDimming(snapshot).opacity, now);
    if (action === null) return;
    void this.deps
      .setOverlayVisible(action === 'show')
      .then((ok) => {
        if (!ok) this.visibility.markFailed(action);
      })
      .catch(() => this.visibility.markFailed(action));
  }
}
