import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  PresetState,
  ElectrodeSignalQuality,
  ChannelResistanceKOhm,
} from './eegTypes';
import { BiofeedbackEngine, DEFAULT_SETTINGS } from './biofeedbackEngine';

type TelemetrySubscriber = (
  telemetry: EEGTelemetry,
  state: BiofeedbackFeedbackState,
  stats: SessionStatistics
) => void;

export class SimulationEngine {
  private readonly sampleRateHz: number = 250;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isPaused: boolean = false;
  private currentPreset: PresetState = 'calm_flow';

  // Multi-frame physiological artifact burst (~240 ms = 60 samples at 250 Hz)
  private artifactRemainingFrames: number = 0;
  private artifactTotalFrames: number = 60;

  private phaseAlpha: number = 0;
  private phaseBeta: number = 0;
  private phaseTheta: number = 0;
  private phaseMains50Hz: number = 0;
  private currentTimestamp: number = Date.now();

  private signalQuality: ElectrodeSignalQuality = {
    t3: true,
    t4: true,
    o1: true,
    o2: true,
  };

  private settings: FocusGlassSettings = { ...DEFAULT_SETTINGS };
  private biofeedback: BiofeedbackEngine = new BiofeedbackEngine(DEFAULT_SETTINGS, 250);
  private latestTelemetry: EEGTelemetry | null = null;

  private subscribers: Set<TelemetrySubscriber> = new Set();
  private rawBatchBuffer: EEGTelemetry[] = [];

  constructor() {
    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // Simulator demo hotkeys apply only when simulator source is active
      if (this.settings.deviceSource !== 'simulator') return;

      switch (e.key) {
        case '1':
          this.setPreset('high_focus');
          break;
        case '2':
          this.setPreset('calm_flow');
          break;
        case '3':
          this.setPreset('attention_drift');
          break;
        case '4':
          this.injectArtifact();
          break;
        case '5':
          this.setPreset('meditation');
          break;
        case ' ':
          e.preventDefault();
          this.togglePause();
          break;
      }
    });
  }

  public subscribe(callback: TelemetrySubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  public start(initialSettings?: Partial<FocusGlassSettings>) {
    if (initialSettings) {
      this.updateSettings(initialSettings);
    }
    if (this.timerId !== null) return;

    const intervalMs = 16;
    const samplesPerTick = Math.round((this.sampleRateHz * intervalMs) / 1000); // 4 samples

    this.timerId = globalThis.setInterval(() => {
      if (this.isPaused || this.settings.deviceSource !== 'simulator') return;
      this.stepSamples(samplesPerTick);
    }, intervalMs);
  }

  public stop() {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Advances the synthetic 250 Hz generator by `sampleCount` samples and notifies subscribers.
   * Exposed publicly so integration tests can step deterministically without wall-clock timers.
   */
  public stepSamples(sampleCount: number = 4): BiofeedbackFeedbackState {
    let latestState = this.biofeedback.getLastState();
    const count = Math.max(1, sampleCount);

    for (let i = 0; i < count; i++) {
      const telemetry = this.generateSample();
      latestState = this.biofeedback.processTelemetry(telemetry);
      this.latestTelemetry = telemetry;
      this.rawBatchBuffer.push(telemetry);
    }

    if (this.rawBatchBuffer.length > 1000) {
      this.rawBatchBuffer = this.rawBatchBuffer.slice(-1000);
    }

    if (this.latestTelemetry) {
      this.notify(this.latestTelemetry, latestState, this.biofeedback.getSessionStats());
    }

    return latestState;
  }

  /**
   * Entry point for real BrainBit packets arriving from Tauri NeuroSDK2 / EmotionalMath IPC.
   */
  public ingestExternalTelemetry(telemetry: EEGTelemetry): BiofeedbackFeedbackState {
    const state = this.biofeedback.processTelemetry(telemetry);
    this.latestTelemetry = telemetry;
    this.rawBatchBuffer.push(telemetry);

    if (this.rawBatchBuffer.length > 1000) {
      this.rawBatchBuffer = this.rawBatchBuffer.slice(-1000);
    }

    this.notify(telemetry, state, this.biofeedback.getSessionStats());
    return state;
  }

  public updateSettings(newSettings: Partial<FocusGlassSettings>): void {
    const prevSource = this.settings.deviceSource;
    this.settings = { ...this.settings, ...newSettings };
    this.biofeedback.updateSettings(newSettings);
    this.settings = { ...this.biofeedback.getSettings() };

    if (prevSource !== this.settings.deviceSource && this.settings.deviceSource === 'bluetooth') {
      // Clear synthetic oscilloscope buffer and ensure screen is not left dimmed
      // while awaiting a physical BrainBit connection.
      this.rawBatchBuffer = [];
      if (this.latestTelemetry) {
        const safeState: BiofeedbackFeedbackState = {
          ...this.biofeedback.getLastState(),
          deficit: 0,
          overlayOpacity: 0,
          blurRadius: 0,
          audioVolume: 0,
          isDimmingActive: false,
          isContactOk: false,
          isArtifactFrozen: false,
        };
        this.notify(
          {
            ...this.latestTelemetry,
            signalQuality: { t3: false, t4: false, o1: false, o2: false },
            resistanceKOhm: { t3: null, t4: null, o1: null, o2: null },
          },
          safeState,
          this.biofeedback.getSessionStats()
        );
      }
    }
  }

  public updateBufferSize(sensitivitySeconds: number) {
    this.updateSettings({ sensitivitySeconds });
  }

  public resetSession(): void {
    this.biofeedback.resetSession();
    this.rawBatchBuffer = [];
    if (this.latestTelemetry) {
      this.notify(
        this.latestTelemetry,
        this.biofeedback.getLastState(),
        this.biofeedback.getSessionStats()
      );
    }
  }

  public setPreset(preset: PresetState) {
    this.currentPreset = preset;
  }

  public getPreset(): PresetState {
    return this.currentPreset;
  }

  public injectArtifact(durationFrames: number = 60) {
    const frames = Math.max(4, Math.round(durationFrames));
    this.artifactTotalFrames = frames;
    this.artifactRemainingFrames = frames;
  }

  public togglePause(): boolean {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public setElectrodeQuality(channel: keyof ElectrodeSignalQuality, isOk: boolean) {
    this.signalQuality[channel] = isOk;
  }

  public getRawBuffer(): EEGTelemetry[] {
    return this.rawBatchBuffer;
  }

  public getSessionStats(): SessionStatistics {
    return this.biofeedback.getSessionStats();
  }

  public getSettings(): FocusGlassSettings {
    return { ...this.settings };
  }

  private computeDryResistance(): ChannelResistanceKOhm {
    const drift = Math.sin(this.phaseTheta * 0.25) * 4;
    return {
      t3: this.signalQuality.t3 ? Math.round(134 + drift) : null,
      t4: this.signalQuality.t4 ? Math.round(128 - drift) : null,
      o1: this.signalQuality.o1 ? Math.round(115 + drift * 0.8) : null,
      o2: this.signalQuality.o2 ? Math.round(121 - drift * 0.8) : null,
    };
  }

  private generateSample(): EEGTelemetry {
    const dt = 1 / this.sampleRateHz;
    this.currentTimestamp += Math.round(dt * 1000);

    this.phaseAlpha += 2 * Math.PI * 10.2 * dt;
    this.phaseBeta += 2 * Math.PI * 21.5 * dt;
    this.phaseTheta += 2 * Math.PI * 6.0 * dt;
    this.phaseMains50Hz += 2 * Math.PI * 50.0 * dt;

    let targetConcentration = 78;
    let targetRelaxation = 65;
    let alphaAmp = 18;
    let betaAmp = 22;

    switch (this.currentPreset) {
      case 'high_focus':
        targetConcentration = 92;
        targetRelaxation = 40;
        alphaAmp = 8;
        betaAmp = 38;
        break;
      case 'calm_flow':
        targetConcentration = 78;
        targetRelaxation = 72;
        alphaAmp = 24;
        betaAmp = 24;
        break;
      case 'attention_drift':
        targetConcentration = 42;
        targetRelaxation = 48;
        alphaAmp = 20;
        betaAmp = 12;
        break;
      case 'distracted':
        targetConcentration = 22;
        targetRelaxation = 28;
        alphaAmp = 14;
        betaAmp = 8;
        break;
      case 'meditation':
        targetConcentration = 35;
        targetRelaxation = 94;
        alphaAmp = 46;
        betaAmp = 6;
        break;
    }

    const noise =
      Math.sin(this.phaseTheta * 2.8) * 2.5 + Math.cos(this.phaseBeta * 0.4) * 1.5;
    const finalConcentration = Math.max(0, Math.min(100, targetConcentration + noise));
    const finalRelaxation = Math.max(0, Math.min(100, targetRelaxation - noise));

    let t3 = Math.sin(this.phaseBeta) * betaAmp + Math.cos(this.phaseAlpha) * alphaAmp;
    let t4 =
      Math.sin(this.phaseBeta + 0.35) * betaAmp +
      Math.cos(this.phaseAlpha + 0.35) * alphaAmp;
    let o1 =
      Math.sin(this.phaseAlpha) * (alphaAmp * 1.6) +
      Math.cos(this.phaseBeta) * (betaAmp * 0.6);
    let o2 =
      Math.sin(this.phaseAlpha + 0.25) * (alphaAmp * 1.6) +
      Math.cos(this.phaseBeta + 0.25) * (betaAmp * 0.6);

    // Detached dry electrode exhibits open-lead 50 Hz mains pickup
    const hum50 = Math.sin(this.phaseMains50Hz) * 95;
    if (!this.signalQuality.t3) t3 = hum50;
    if (!this.signalQuality.t4) t4 = hum50 * 0.95;
    if (!this.signalQuality.o1) o1 = hum50 * 1.05;
    if (!this.signalQuality.o2) o2 = hum50;

    let isArtifact = false;
    if (this.artifactRemainingFrames > 0) {
      isArtifact = true;
      const progress =
        (this.artifactTotalFrames - this.artifactRemainingFrames) / this.artifactTotalFrames;
      const envelope = Math.sin(Math.PI * progress);
      this.artifactRemainingFrames--;

      t3 += 185 * envelope;
      t4 += 195 * envelope;
      o1 += 75 * envelope;
      o2 += 80 * envelope;
    }

    return {
      timestamp: this.currentTimestamp,
      rawChannels: {
        t3: Number(t3.toFixed(2)),
        t4: Number(t4.toFixed(2)),
        o1: Number(o1.toFixed(2)),
        o2: Number(o2.toFixed(2)),
      },
      concentration: Number(finalConcentration.toFixed(2)),
      relaxation: Number(finalRelaxation.toFixed(2)),
      signalQuality: { ...this.signalQuality },
      resistanceKOhm: this.computeDryResistance(),
      isArtifact,
    };
  }

  private notify(
    telemetry: EEGTelemetry,
    state: BiofeedbackFeedbackState,
    stats: SessionStatistics
  ) {
    for (const sub of this.subscribers) {
      sub(telemetry, state, stats);
    }
  }
}

export const simulationEngine = new SimulationEngine();
