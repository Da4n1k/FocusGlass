import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  CalibrationResult,
} from '../contracts/telemetry.ts';

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
  private metricBuffer: number[] = [];
  private maxBufferSize: number = 500; // at 250Hz, 2.0s = 500 samples
  private lastState: BiofeedbackFeedbackState;
  private sessionStats: SessionStatistics;
  private isCurrentlyDimmed: boolean = false;

  constructor(customSettings?: Partial<FocusGlassSettings>) {
    this.settings = { ...DEFAULT_SETTINGS, ...customSettings };
    this.recomputeBufferSize();

    this.lastState = {
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

    this.sessionStats = {
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

  public updateSettings(newSettings: Partial<FocusGlassSettings>): void {
    if (newSettings.threshold !== undefined) {
      // Clamp threshold within safe operational range [10, 95]
      newSettings.threshold = Math.max(10, Math.min(95, newSettings.threshold));
    }
    if (newSettings.dimmingMaxOpacity !== undefined) {
      newSettings.dimmingMaxOpacity = Math.max(0.1, Math.min(0.95, newSettings.dimmingMaxOpacity));
    }
    if (newSettings.sensitivitySeconds !== undefined) {
      newSettings.sensitivitySeconds = Math.max(0.01, Math.min(10.0, newSettings.sensitivitySeconds));
    }

    this.settings = { ...this.settings, ...newSettings };
    this.recomputeBufferSize();
  }

  private recomputeBufferSize(): void {
    // Assuming 250 Hz sample rate
    this.maxBufferSize = Math.max(1, Math.round(this.settings.sensitivitySeconds * 250));
    // Trim buffer if sensitivity was decreased
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer = this.metricBuffer.slice(-this.maxBufferSize);
    }
  }

  /**
   * Ingests a single EEG telemetry packet and computes the biofeedback state
   */
  public processTelemetry(telemetry: EEGTelemetry): BiofeedbackFeedbackState {
    const isContactOk =
      telemetry.signalQuality.t3 &&
      telemetry.signalQuality.t4 &&
      telemetry.signalQuality.o1 &&
      telemetry.signalQuality.o2;

    if (telemetry.isArtifact) {
      this.sessionStats.artifactCount++;
      // Freeze opacity updates during artifact to avoid false optical flickering
      return {
        ...this.lastState,
        isArtifactFrozen: true,
        isContactOk,
      };
    }

    // Determine target metric based on active training mode
    const rawMetric =
      this.settings.mode === 'concentration' ? telemetry.concentration : telemetry.relaxation;

    // Push into moving average smoothing buffer
    this.metricBuffer.push(rawMetric);
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer.shift();
    }

    // Compute moving average
    const sum = this.metricBuffer.reduce((acc, v) => acc + v, 0);
    const smoothedMetric = sum / this.metricBuffer.length;

    // Calculate deficit below target threshold
    let deficit = 0;
    let overlayOpacity = 0;
    let blurRadius = 0;
    let audioVolume = 0;
    let isDimmingActive = false;

    if (smoothedMetric < this.settings.threshold) {
      // Deficit ratio: 0 at threshold, 1 at metric = 0
      deficit = (this.settings.threshold - smoothedMetric) / this.settings.threshold;
      deficit = Math.max(0, Math.min(1, deficit));

      overlayOpacity = deficit * this.settings.dimmingMaxOpacity;
      blurRadius = deficit * this.settings.blurRadius;
      isDimmingActive = overlayOpacity > 0.01;

      if (this.settings.audioFeedbackEnabled) {
        audioVolume = deficit;
      }
    }

    // Update session statistics
    const dtSeconds = 1 / 250;
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

    // Update min/max/average focus
    this.sessionStats.minFocusScore = Math.min(this.sessionStats.minFocusScore, rawMetric);
    this.sessionStats.maxFocusScore = Math.max(this.sessionStats.maxFocusScore, rawMetric);

    const prevDuration = this.sessionStats.durationSeconds - dtSeconds;
    const currentAvg = this.sessionStats.averageFocusScore;
    this.sessionStats.averageFocusScore =
      (currentAvg * prevDuration + rawMetric * dtSeconds) / this.sessionStats.durationSeconds;

    this.lastState = {
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

    return this.lastState;
  }

  public getLastState(): Readonly<BiofeedbackFeedbackState> {
    return { ...this.lastState };
  }

  public getSessionStats(): Readonly<SessionStatistics> {
    return {
      durationSeconds: Number(this.sessionStats.durationSeconds.toFixed(2)),
      timeInFocusSeconds: Number(this.sessionStats.timeInFocusSeconds.toFixed(2)),
      timeInDimmingSeconds: Number(this.sessionStats.timeInDimmingSeconds.toFixed(2)),
      distractionEventsCount: this.sessionStats.distractionEventsCount,
      averageFocusScore: Number(this.sessionStats.averageFocusScore.toFixed(2)),
      minFocusScore: Number(this.sessionStats.minFocusScore.toFixed(2)),
      maxFocusScore: Number(this.sessionStats.maxFocusScore.toFixed(2)),
      artifactCount: this.sessionStats.artifactCount,
    };
  }

  /**
   * Computes a calibration baseline from a series of telemetry frames
   */
  public static calibrateBaseline(frames: EEGTelemetry[]): CalibrationResult {
    const validFrames = frames.filter(f => !f.isArtifact);
    if (validFrames.length === 0) {
      return {
        baselineFocus: 60,
        baselineRelaxation: 60,
        recommendedThreshold: 50,
        confidence: 0,
      };
    }

    const avgFocus = validFrames.reduce((acc, f) => acc + f.concentration, 0) / validFrames.length;
    const avgRelax = validFrames.reduce((acc, f) => acc + f.relaxation, 0) / validFrames.length;

    // Standard deviation of focus
    const variance =
      validFrames.reduce((acc, f) => acc + Math.pow(f.concentration - avgFocus, 2), 0) /
      validFrames.length;
    const stdDev = Math.sqrt(variance);

    // Recommended threshold is 1 standard deviation below baseline focus, clamped to [40, 85]
    const recommendedThreshold = Math.max(40, Math.min(85, Math.round(avgFocus - 0.5 * stdDev)));
    const confidence = Math.max(0.1, Math.min(1.0, 1 - stdDev / 50));

    return {
      baselineFocus: Number(avgFocus.toFixed(2)),
      baselineRelaxation: Number(avgRelax.toFixed(2)),
      recommendedThreshold,
      confidence: Number(confidence.toFixed(2)),
    };
  }
}
