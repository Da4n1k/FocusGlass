import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  CalibrationResult,
} from './eegTypes';

export const DEFAULT_SETTINGS: FocusGlassSettings = {
  mode: 'concentration',
  deviceSource: 'simulator',
  threshold: 60,
  sensitivitySeconds: 2.0,
  dimmingMaxOpacity: 0.7,
  blurRadius: 16,
  audioFeedbackEnabled: false,
  glassOpacity: 0.85,
};

export class BiofeedbackEngine {
  private settings: FocusGlassSettings;
  private sampleRateHz: number;
  private metricBuffer: number[] = [];
  private maxBufferSize: number = 500;
  private lastState: BiofeedbackFeedbackState;
  private sessionStats: SessionStatistics;
  private isCurrentlyDimmed: boolean = false;

  constructor(customSettings?: Partial<FocusGlassSettings>, sampleRateHz: number = 250) {
    this.sampleRateHz = Math.max(1, sampleRateHz);
    this.settings = this.sanitizeSettings({ ...DEFAULT_SETTINGS, ...customSettings });
    this.recomputeBufferSize();
    this.lastState = this.createInitialState();
    this.sessionStats = this.createInitialStats();
  }

  private createInitialState(): BiofeedbackFeedbackState {
    return {
      currentMetric: 100,
      smoothedMetric: 100,
      deficit: 0,
      overlayOpacity: 0,
      blurRadius: 0,
      audioVolume: 0,
      isDimmingActive: false,
      isContactOk: true,
      isArtifactFrozen: false,
    };
  }

  private createInitialStats(): SessionStatistics {
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

  private sanitizeSettings(next: FocusGlassSettings): FocusGlassSettings {
    return {
      ...next,
      threshold: Math.max(10, Math.min(95, next.threshold)),
      sensitivitySeconds: Math.max(0.001, Math.min(10.0, next.sensitivitySeconds)),
      dimmingMaxOpacity: Math.max(0.05, Math.min(0.95, next.dimmingMaxOpacity)),
      blurRadius: Math.max(0, Math.min(32, next.blurRadius)),
      glassOpacity: Math.max(0.1, Math.min(1.0, next.glassOpacity)),
    };
  }

  public getSettings(): Readonly<FocusGlassSettings> {
    return { ...this.settings };
  }

  public updateSettings(newSettings: Partial<FocusGlassSettings>): void {
    const prevMode = this.settings.mode;
    const prevSource = this.settings.deviceSource;
    this.settings = this.sanitizeSettings({ ...this.settings, ...newSettings });

    if (
      (newSettings.mode !== undefined && newSettings.mode !== prevMode) ||
      (newSettings.deviceSource !== undefined && newSettings.deviceSource !== prevSource)
    ) {
      // Clear smoothing window when switching target rhythm or switching Simulator <-> BLE
      this.metricBuffer = [];
    }

    this.recomputeBufferSize();
  }

  private recomputeBufferSize(): void {
    this.maxBufferSize = Math.max(1, Math.round(this.settings.sensitivitySeconds * this.sampleRateHz));
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer = this.metricBuffer.slice(-this.maxBufferSize);
    }
  }

  public resetSession(): void {
    this.metricBuffer = [];
    this.isCurrentlyDimmed = false;
    this.lastState = this.createInitialState();
    this.sessionStats = this.createInitialStats();
  }

  public processTelemetry(telemetry: EEGTelemetry): BiofeedbackFeedbackState {
    const isContactOk =
      telemetry.signalQuality.t3 &&
      telemetry.signalQuality.t4 &&
      telemetry.signalQuality.o1 &&
      telemetry.signalQuality.o2;

    if (telemetry.isArtifact) {
      this.sessionStats.artifactCount++;
      this.lastState = {
        ...this.lastState,
        isArtifactFrozen: true,
        isContactOk,
      };
      return this.lastState;
    }

    if (!isContactOk) {
      // Pause biofeedback dimming on skin contact loss so a slipped headband
      // neither darkens the screen nor pollutes the moving-average buffer.
      this.isCurrentlyDimmed = false;
      this.lastState = {
        ...this.lastState,
        deficit: 0,
        overlayOpacity: 0,
        blurRadius: 0,
        audioVolume: 0,
        isDimmingActive: false,
        isContactOk: false,
        isArtifactFrozen: false,
      };
      return this.lastState;
    }

    const rawMetric =
      this.settings.mode === 'concentration' ? telemetry.concentration : telemetry.relaxation;

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

    if (smoothedMetric < this.settings.threshold) {
      deficit = (this.settings.threshold - smoothedMetric) / this.settings.threshold;
      deficit = Math.max(0, Math.min(1, deficit));

      overlayOpacity = deficit * this.settings.dimmingMaxOpacity;
      blurRadius = deficit * this.settings.blurRadius;
      isDimmingActive = overlayOpacity > 0.01;

      if (this.settings.audioFeedbackEnabled) {
        audioVolume = deficit;
      }
    }

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

    const clampedMetric = Math.max(0, Math.min(100, rawMetric));
    this.sessionStats.minFocusScore = Math.min(this.sessionStats.minFocusScore, clampedMetric);
    this.sessionStats.maxFocusScore = Math.max(this.sessionStats.maxFocusScore, clampedMetric);

    const prevDuration = this.sessionStats.durationSeconds - dtSeconds;
    const currentAvg = this.sessionStats.averageFocusScore;
    this.sessionStats.averageFocusScore =
      prevDuration > 0
        ? (currentAvg * prevDuration + clampedMetric * dtSeconds) / this.sessionStats.durationSeconds
        : clampedMetric;

    this.lastState = {
      currentMetric: rawMetric,
      smoothedMetric: Number(smoothedMetric.toFixed(2)),
      deficit: Number(deficit.toFixed(4)),
      overlayOpacity: Number(overlayOpacity.toFixed(4)),
      blurRadius: Number(blurRadius.toFixed(2)),
      audioVolume: Number(audioVolume.toFixed(4)),
      isDimmingActive,
      isContactOk: true,
      isArtifactFrozen: false,
    };

    return this.lastState;
  }

  public getLastState(): Readonly<BiofeedbackFeedbackState> {
    return { ...this.lastState };
  }

  public getSessionStats(): Readonly<SessionStatistics> {
    const hasSamples = this.sessionStats.durationSeconds > 0;
    return {
      durationSeconds: Number(this.sessionStats.durationSeconds.toFixed(2)),
      timeInFocusSeconds: Number(this.sessionStats.timeInFocusSeconds.toFixed(2)),
      timeInDimmingSeconds: Number(this.sessionStats.timeInDimmingSeconds.toFixed(2)),
      distractionEventsCount: this.sessionStats.distractionEventsCount,
      averageFocusScore: Number(this.sessionStats.averageFocusScore.toFixed(2)),
      minFocusScore: hasSamples ? Number(this.sessionStats.minFocusScore.toFixed(2)) : 0,
      maxFocusScore: hasSamples ? Number(this.sessionStats.maxFocusScore.toFixed(2)) : 0,
      artifactCount: this.sessionStats.artifactCount,
    };
  }

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
        mode,
        sampleCount: 0,
      };
    }

    const avgFocus =
      validFrames.reduce((acc, f) => acc + f.concentration, 0) / validFrames.length;
    const avgRelax =
      validFrames.reduce((acc, f) => acc + f.relaxation, 0) / validFrames.length;

    const targetBaseline = mode === 'concentration' ? avgFocus : avgRelax;
    const variance =
      validFrames.reduce((acc, f) => {
        const val = mode === 'concentration' ? f.concentration : f.relaxation;
        return acc + Math.pow(val - targetBaseline, 2);
      }, 0) / validFrames.length;
    const stdDev = Math.sqrt(variance);

    const recommendedThreshold = Math.max(
      40,
      Math.min(85, Math.round(targetBaseline - 0.5 * stdDev))
    );
    const confidence = Math.max(0.1, Math.min(1.0, 1 - stdDev / 50));

    return {
      baselineFocus: Number(avgFocus.toFixed(2)),
      baselineRelaxation: Number(avgRelax.toFixed(2)),
      recommendedThreshold,
      confidence: Number(confidence.toFixed(2)),
      mode,
      sampleCount: validFrames.length,
    };
  }
}
