import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  CalibrationResult,
} from './eegTypes.ts';

export const DEFAULT_APP_SETTINGS: FocusGlassSettings = {
  mode: 'concentration',
  deviceSource: 'simulator',
  threshold: 60,
  sensitivitySeconds: 2.0,
  dimmingMaxOpacity: 0.70,
  blurRadius: 16,
  audioFeedbackEnabled: false,
  glassOpacity: 0.85,
  pauseOnContactLoss: true,
  language: 'ru',
};

export class BiofeedbackEngine {
  private settings: FocusGlassSettings;
  private sampleRateHz: number;
  private metricBuffer: number[] = [];
  private maxBufferSize: number = 500;
  private lastTelemetry: EEGTelemetry | null = null;
  private lastState: BiofeedbackFeedbackState;
  private sessionStats: SessionStatistics;
  private isCurrentlyDimmed: boolean = false;

  constructor(customSettings?: Partial<FocusGlassSettings>, sampleRateHz: number = 250) {
    this.sampleRateHz = Math.max(1, sampleRateHz);
    this.settings = { ...DEFAULT_APP_SETTINGS, ...customSettings };
    this.recomputeBufferSize();

    this.lastState = {
      currentMetric: 78,
      smoothedMetric: 78,
      deficit: 0,
      overlayOpacity: 0,
      blurRadius: 0,
      audioVolume: 0,
      isDimmingActive: false,
      isContactOk: true,
      isArtifactFrozen: false,
      isContactPaused: false,
    };

    this.sessionStats = this.createEmptyStats();
  }

  private createEmptyStats(): SessionStatistics {
    return {
      durationSeconds: 0,
      timeInFocusSeconds: 0,
      timeInDimmingSeconds: 0,
      distractionEventsCount: 0,
      averageFocusScore: 0,
      minFocusScore: 100,
      maxFocusScore: 0,
      artifactCount: 0,
    };
  }

  public getSettings(): Readonly<FocusGlassSettings> {
    return { ...this.settings };
  }

  public updateSettings(newSettings: Partial<FocusGlassSettings>): BiofeedbackFeedbackState {
    const sanitized: Partial<FocusGlassSettings> = { ...newSettings };

    if (sanitized.threshold !== undefined) {
      sanitized.threshold = Math.max(10, Math.min(95, sanitized.threshold));
    }
    if (sanitized.dimmingMaxOpacity !== undefined) {
      sanitized.dimmingMaxOpacity = Math.max(0.1, Math.min(0.95, sanitized.dimmingMaxOpacity));
    }
    if (sanitized.sensitivitySeconds !== undefined) {
      sanitized.sensitivitySeconds = Math.max(0.01, Math.min(10.0, sanitized.sensitivitySeconds));
    }
    if (sanitized.blurRadius !== undefined) {
      sanitized.blurRadius = Math.max(0, Math.min(32, sanitized.blurRadius));
    }

    const modeChanged =
      sanitized.mode !== undefined && sanitized.mode !== this.settings.mode;

    this.settings = { ...this.settings, ...sanitized };
    this.recomputeBufferSize();

    if (modeChanged) {
      // Prevent previous metric (e.g. Concentration) from polluting Relaxation moving average
      this.metricBuffer = [];
      if (this.lastTelemetry && !this.lastTelemetry.isArtifact) {
        const nextMetric =
          this.settings.mode === 'concentration'
            ? this.lastTelemetry.concentration
            : this.lastTelemetry.relaxation;
        this.metricBuffer.push(nextMetric);
      }
    }

    return this.recomputeStateFromBuffer();
  }

  private recomputeBufferSize(): void {
    this.maxBufferSize = Math.max(
      1,
      Math.round(this.settings.sensitivitySeconds * this.sampleRateHz)
    );
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer = this.metricBuffer.slice(-this.maxBufferSize);
    }
  }

  private computeDeficitOutputs(smoothedMetric: number): {
    deficit: number;
    overlayOpacity: number;
    blurRadius: number;
    audioVolume: number;
    isDimmingActive: boolean;
  } {
    let deficit = 0;
    let overlayOpacity = 0;
    let blurRadius = 0;
    let audioVolume = 0;
    let isDimmingActive = false;

    if (smoothedMetric < this.settings.threshold && this.settings.threshold > 0) {
      deficit = (this.settings.threshold - smoothedMetric) / this.settings.threshold;
      deficit = Math.max(0, Math.min(1, deficit));

      overlayOpacity = deficit * this.settings.dimmingMaxOpacity;
      blurRadius = deficit * this.settings.blurRadius;
      isDimmingActive = overlayOpacity > 0.01;

      if (this.settings.audioFeedbackEnabled) {
        audioVolume = deficit;
      }
    }

    return {
      deficit: Number(deficit.toFixed(4)),
      overlayOpacity: Number(overlayOpacity.toFixed(4)),
      blurRadius: Number(blurRadius.toFixed(2)),
      audioVolume: Number(audioVolume.toFixed(4)),
      isDimmingActive,
    };
  }

  /**
   * Immediately updates feedback state when settings change (even if stream is paused)
   */
  public recomputeStateFromBuffer(): BiofeedbackFeedbackState {
    if (this.metricBuffer.length === 0) {
      return { ...this.lastState };
    }

    if (this.lastState.isContactPaused) {
      return { ...this.lastState };
    }

    const sum = this.metricBuffer.reduce((acc, v) => acc + v, 0);
    const smoothedMetric = sum / this.metricBuffer.length;
    const outputs = this.computeDeficitOutputs(smoothedMetric);

    this.lastState = {
      ...this.lastState,
      smoothedMetric: Number(smoothedMetric.toFixed(2)),
      ...outputs,
    };

    return { ...this.lastState };
  }

  /**
   * Processes one incoming EEG telemetry frame (at 250 Hz)
   */
  public processTelemetry(telemetry: EEGTelemetry): BiofeedbackFeedbackState {
    this.lastTelemetry = telemetry;

    const isContactOk =
      telemetry.signalQuality.t3 &&
      telemetry.signalQuality.t4 &&
      telemetry.signalQuality.o1 &&
      telemetry.signalQuality.o2;

    // 1. Contact loss guard: when dry electrode loses contact, pause dimming adaptation
    // so we don't falsely punish the user with a dark screen while adjusting the headband.
    if (!isContactOk && this.settings.pauseOnContactLoss !== false) {
      this.isCurrentlyDimmed = false;
      this.lastState = {
        ...this.lastState,
        overlayOpacity: 0,
        blurRadius: 0,
        audioVolume: 0,
        isDimmingActive: false,
        isContactOk: false,
        isArtifactFrozen: false,
        isContactPaused: true,
      };
      return { ...this.lastState };
    }

    // 2. Artifact freeze: eye blinks (EOG) and jaw clenches (EMG) freeze opacity updates
    if (telemetry.isArtifact) {
      this.sessionStats.artifactCount++;
      this.lastState = {
        ...this.lastState,
        isArtifactFrozen: true,
        isContactOk,
        isContactPaused: false,
      };
      return { ...this.lastState };
    }

    // 3. Clamp incoming raw metric to valid [0, 100] range
    const rawUnclamped =
      this.settings.mode === 'concentration' ? telemetry.concentration : telemetry.relaxation;
    const rawMetric = Math.max(0, Math.min(100, Number.isFinite(rawUnclamped) ? rawUnclamped : 0));

    this.metricBuffer.push(rawMetric);
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer.shift();
    }

    const sum = this.metricBuffer.reduce((acc, v) => acc + v, 0);
    const smoothedMetric = sum / this.metricBuffer.length;
    const outputs = this.computeDeficitOutputs(smoothedMetric);

    // 4. Accumulate session statistics
    const dtSeconds = 1 / this.sampleRateHz;
    const prevDuration = this.sessionStats.durationSeconds;
    this.sessionStats.durationSeconds += dtSeconds;

    if (outputs.isDimmingActive) {
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

    this.sessionStats.averageFocusScore =
      prevDuration > 0
        ? (this.sessionStats.averageFocusScore * prevDuration + rawMetric * dtSeconds) /
          this.sessionStats.durationSeconds
        : rawMetric;

    this.lastState = {
      currentMetric: rawMetric,
      smoothedMetric: Number(smoothedMetric.toFixed(2)),
      ...outputs,
      isContactOk,
      isArtifactFrozen: false,
      isContactPaused: false,
    };

    return { ...this.lastState };
  }

  public getLastState(): Readonly<BiofeedbackFeedbackState> {
    return { ...this.lastState };
  }

  public getSessionStats(): SessionStatistics {
    const hasFrames = this.sessionStats.durationSeconds > 0;
    return {
      durationSeconds: Number(this.sessionStats.durationSeconds.toFixed(2)),
      timeInFocusSeconds: Number(this.sessionStats.timeInFocusSeconds.toFixed(2)),
      timeInDimmingSeconds: Number(this.sessionStats.timeInDimmingSeconds.toFixed(2)),
      distractionEventsCount: this.sessionStats.distractionEventsCount,
      averageFocusScore: Number(this.sessionStats.averageFocusScore.toFixed(2)),
      minFocusScore: hasFrames ? Number(this.sessionStats.minFocusScore.toFixed(2)) : 0,
      maxFocusScore: hasFrames ? Number(this.sessionStats.maxFocusScore.toFixed(2)) : 0,
      artifactCount: this.sessionStats.artifactCount,
    };
  }

  public resetSession(): void {
    this.metricBuffer = [];
    this.isCurrentlyDimmed = false;
    this.sessionStats = this.createEmptyStats();
  }

  /**
   * Computes personalized baseline and recommended threshold from clean EEG frames.
   * Excludes EOG/EMG artifacts and frames with broken electrode contact.
   */
  public static calibrateBaseline(
    frames: EEGTelemetry[],
    mode: 'concentration' | 'relaxation' = 'concentration'
  ): CalibrationResult {
    const validFrames = frames.filter(
      (f) =>
        !f.isArtifact &&
        f.signalQuality.t3 &&
        f.signalQuality.t4 &&
        f.signalQuality.o1 &&
        f.signalQuality.o2
    );

    if (validFrames.length === 0) {
      return {
        baselineFocus: 60,
        baselineRelaxation: 60,
        recommendedThreshold: 50,
        confidence: 0,
        sampleCount: 0,
        calibratedMode: mode,
      };
    }

    const avgFocus =
      validFrames.reduce((acc, f) => acc + f.concentration, 0) / validFrames.length;
    const avgRelax =
      validFrames.reduce((acc, f) => acc + f.relaxation, 0) / validFrames.length;

    const targetValues = validFrames.map((f) =>
      mode === 'concentration' ? f.concentration : f.relaxation
    );
    const targetMean = mode === 'concentration' ? avgFocus : avgRelax;

    const variance =
      targetValues.reduce((acc, val) => acc + Math.pow(val - targetMean, 2), 0) /
      validFrames.length;
    const stdDev = Math.sqrt(variance);

    // Leave a comfortable physiological margin below mean (~8% minimum or 1.2 * SD)
    // so normal breathing/micro-fluctuations do not trigger false dimming.
    const margin = Math.max(8, 1.2 * stdDev);
    const recommendedThreshold = Math.max(40, Math.min(85, Math.round(targetMean - margin)));
    const sampleFactor = Math.min(1.0, validFrames.length / 500);
    const stabilityFactor = Math.max(0.15, Math.min(1.0, 1 - stdDev / 40));
    const confidence = Number((0.35 * sampleFactor + 0.65 * stabilityFactor).toFixed(2));

    return {
      baselineFocus: Number(avgFocus.toFixed(1)),
      baselineRelaxation: Number(avgRelax.toFixed(1)),
      recommendedThreshold,
      confidence,
      sampleCount: validFrames.length,
      calibratedMode: mode,
    };
  }
}
