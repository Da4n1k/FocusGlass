import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  PresetState,
  ElectrodeSignalQuality,
} from './eegTypes';

export class SimulationEngine {
  private sampleRateHz: number = 250;
  private timerId: number | null = null;
  private isPaused: boolean = false;
  private currentPreset: PresetState = 'calm_flow';
  private manualArtifactPending: boolean = false;

  private phaseAlpha: number = 0;
  private phaseBeta: number = 0;
  private phaseTheta: number = 0;
  private currentTimestamp: number = Date.now();

  private signalQuality: ElectrodeSignalQuality = {
    t3: true,
    t4: true,
    o1: true,
    o2: true,
  };

  private metricBuffer: number[] = [];
  private maxBufferSize: number = 500; // 2.0s * 250Hz

  private lastFeedbackState: BiofeedbackFeedbackState = {
    currentMetric: 78,
    smoothedMetric: 78,
    deficit: 0,
    overlayOpacity: 0,
    blurRadius: 0,
    audioVolume: 0,
    isDimmingActive: false,
    isContactOk: true,
    isArtifactFrozen: false,
  };

  private sessionStats: SessionStatistics = {
    durationSeconds: 0,
    timeInFocusSeconds: 0,
    timeInDimmingSeconds: 0,
    distractionEventsCount: 0,
    averageFocusScore: 78,
    minFocusScore: 78,
    maxFocusScore: 78,
    artifactCount: 0,
  };

  private isCurrentlyDimmed: boolean = false;
  private subscribers: Set<(telemetry: EEGTelemetry, state: BiofeedbackFeedbackState, stats: SessionStatistics) => void> = new Set();
  private rawBatchBuffer: EEGTelemetry[] = [];

  constructor() {
    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts() {
    if (typeof window === 'undefined') return;

    window.addEventListener('keydown', (e) => {
      // Don't trigger if user is typing in an input or textarea
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

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

  public subscribe(
    callback: (telemetry: EEGTelemetry, state: BiofeedbackFeedbackState, stats: SessionStatistics) => void
  ): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  public start(settings: FocusGlassSettings) {
    if (this.timerId !== null) return;
    this.updateBufferSize(settings.sensitivitySeconds);

    // Run at ~60 FPS (every 16ms), generating ~4 raw samples (250 Hz) per tick
    const intervalMs = 16;
    const samplesPerTick = Math.round((this.sampleRateHz * intervalMs) / 1000); // ~4 samples

    this.timerId = window.setInterval(() => {
      if (this.isPaused) return;

      let latestTelemetry: EEGTelemetry | null = null;
      let latestFeedback: BiofeedbackFeedbackState = this.lastFeedbackState;

      for (let i = 0; i < samplesPerTick; i++) {
        const injectArtifact = this.manualArtifactPending;
        if (injectArtifact) {
          this.manualArtifactPending = false;
        }

        const telemetry = this.generateSample(injectArtifact);
        latestFeedback = this.computeFeedback(telemetry, settings);
        latestTelemetry = telemetry;
        this.rawBatchBuffer.push(telemetry);
      }

      // Keep raw batch buffer capped for oscilloscope
      if (this.rawBatchBuffer.length > 500) {
        this.rawBatchBuffer = this.rawBatchBuffer.slice(-500);
      }

      if (latestTelemetry) {
        this.notify(latestTelemetry, latestFeedback, this.sessionStats);
      }
    }, intervalMs);
  }

  public stop() {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  public setPreset(preset: PresetState) {
    this.currentPreset = preset;
  }

  public getPreset(): PresetState {
    return this.currentPreset;
  }

  public injectArtifact() {
    this.manualArtifactPending = true;
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

  public updateBufferSize(sensitivitySeconds: number) {
    this.maxBufferSize = Math.max(1, Math.round(sensitivitySeconds * this.sampleRateHz));
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer = this.metricBuffer.slice(-this.maxBufferSize);
    }
  }

  private generateSample(injectArtifact: boolean): EEGTelemetry {
    const dt = 1 / this.sampleRateHz;
    this.currentTimestamp += Math.round(dt * 1000);

    // Fundamental brain wave frequencies:
    // Alpha: 10.2 Hz
    // Beta: 21.5 Hz
    // Theta: 6.0 Hz
    this.phaseAlpha += 2 * Math.PI * 10.2 * dt;
    this.phaseBeta += 2 * Math.PI * 21.5 * dt;
    this.phaseTheta += 2 * Math.PI * 6.0 * dt;

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

    // Natural sinusoidal jitter
    const noise = Math.sin(this.phaseTheta * 2.8) * 2.5 + Math.cos(this.phaseBeta * 0.4) * 1.5;
    const finalConcentration = Math.max(0, Math.min(100, targetConcentration + noise));
    const finalRelaxation = Math.max(0, Math.min(100, targetRelaxation - noise));

    let t3 = Math.sin(this.phaseBeta) * betaAmp + Math.cos(this.phaseAlpha) * alphaAmp;
    let t4 = Math.sin(this.phaseBeta + 0.35) * betaAmp + Math.cos(this.phaseAlpha + 0.35) * alphaAmp;
    let o1 = Math.sin(this.phaseAlpha) * (alphaAmp * 1.6) + Math.cos(this.phaseBeta) * (betaAmp * 0.6);
    let o2 = Math.sin(this.phaseAlpha + 0.25) * (alphaAmp * 1.6) + Math.cos(this.phaseBeta + 0.25) * (betaAmp * 0.6);

    if (injectArtifact) {
      // High-amplitude spike mimicking blink or jaw clench (200+ uV)
      t3 += 190;
      t4 += 205;
      o1 += 85;
      o2 += 90;
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
      isArtifact: injectArtifact,
    };
  }

  private computeFeedback(
    telemetry: EEGTelemetry,
    settings: FocusGlassSettings
  ): BiofeedbackFeedbackState {
    const isContactOk =
      telemetry.signalQuality.t3 &&
      telemetry.signalQuality.t4 &&
      telemetry.signalQuality.o1 &&
      telemetry.signalQuality.o2;

    if (telemetry.isArtifact) {
      this.sessionStats.artifactCount++;
      // Freeze opacity updates to avoid sudden visual flashing
      this.lastFeedbackState = {
        ...this.lastFeedbackState,
        isArtifactFrozen: true,
        isContactOk,
      };
      return this.lastFeedbackState;
    }

    const rawMetric =
      settings.mode === 'concentration' ? telemetry.concentration : telemetry.relaxation;

    this.metricBuffer.push(rawMetric);
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer.shift();
    }

    const sum = this.metricBuffer.reduce((acc, v) => acc + v, 0);
    const smoothedMetric = sum / this.metricBuffer.length;

    let deficit = 0;
    let overlayOpacity = 0;
    let blurRadius = 0;
    let audioVolume = 0;
    let isDimmingActive = false;

    if (smoothedMetric < settings.threshold) {
      deficit = (settings.threshold - smoothedMetric) / settings.threshold;
      deficit = Math.max(0, Math.min(1, deficit));

      overlayOpacity = deficit * settings.dimmingMaxOpacity;
      blurRadius = deficit * settings.blurRadius;
      isDimmingActive = overlayOpacity > 0.01;

      if (settings.audioFeedbackEnabled) {
        audioVolume = deficit;
      }
    }

    // Accumulate stats (dt = 1 / 250s)
    const dtSeconds = 1 / this.sampleRateHz;
    this.sessionStats.durationSeconds += dtSeconds;

    if (isDimmingActive) {
      this.sessionStats.timeInDimmingSeconds += dtSeconds;
      if (!this.isCurrentlyDimmed) {
        this.sessionStats.distractionEventsCount++;
        this.isCurrentlyDimmed = true;
      }
    } else {
      this.sessionStats.timeInFocusSeconds += dtSeconds;
      this.isCurrentlyDimmed = false;
    }

    this.sessionStats.minFocusScore = Math.min(this.sessionStats.minFocusScore, rawMetric);
    this.sessionStats.maxFocusScore = Math.max(this.sessionStats.maxFocusScore, rawMetric);

    const prevDuration = this.sessionStats.durationSeconds - dtSeconds;
    this.sessionStats.averageFocusScore =
      prevDuration > 0
        ? (this.sessionStats.averageFocusScore * prevDuration + rawMetric * dtSeconds) /
          this.sessionStats.durationSeconds
        : rawMetric;

    this.lastFeedbackState = {
      currentMetric: rawMetric,
      smoothedMetric: Number(smoothedMetric.toFixed(2)),
      deficit: Number(deficit.toFixed(4)),
      overlayOpacity: Number(overlayOpacity.toFixed(4)),
      blurRadius: Number(blurRadius.toFixed(2)),
      audioVolume: Number(audioVolume.toFixed(4)),
      isDimmingActive,
      isContactOk,
      isArtifactFrozen: false,
    };

    return this.lastFeedbackState;
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

// Global simulation engine singleton
export const simulationEngine = new SimulationEngine();
