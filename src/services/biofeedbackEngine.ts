import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  CalibrationResult,
} from './eegTypes';
import { areAllElectrodesUsable, isTelemetryUsable } from './signalQuality';

export interface PersonalScore {
  /** Signed deviation from the personal norm, clamped to -100…+100. */
  deviation: number;
  /** 0…100 display score; personal baseline (deviation 0) maps to 50%. */
  percentage: number;
}

export function mapMetricToPersonalScore(
  value: number,
  baseline: number,
  variability: number
): PersonalScore {
  const robustScale = Math.max(4, Number.isFinite(variability) ? variability : 0);
  const deviation = Math.max(-100, Math.min(100, ((value - baseline) / (2.5 * robustScale)) * 100));
  return {
    deviation: Number(deviation.toFixed(2)),
    percentage: Number(((deviation + 100) / 2).toFixed(2)),
  };
}

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
  private personalCalibration: CalibrationResult | null = null;

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
      effectiveThreshold: this.settings.threshold,
      personalDeviation: 0,
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

  public setPersonalCalibration(calibration: CalibrationResult | null): void {
    this.personalCalibration = calibration && (calibration.sampleCount ?? 0) > 0
      ? { ...calibration }
      : null;
    this.metricBuffer = [];
    this.lastState = {
      ...this.lastState,
      effectiveThreshold: this.getEffectiveThreshold(),
      personalDeviation: 0,
    };
  }

  public getPersonalCalibration(): CalibrationResult | null {
    return this.personalCalibration ? { ...this.personalCalibration } : null;
  }

  private getEffectiveThreshold(): number {
    const calibration = this.personalCalibration;
    if (!calibration) return this.settings.threshold;
    const baseline = this.settings.mode === 'concentration'
      ? calibration.baselineFocus
      : calibration.baselineRelaxation;
    const variability = this.settings.mode === 'concentration'
      ? calibration.variabilityFocus
      : calibration.variabilityRelaxation;
    return mapMetricToPersonalScore(this.settings.threshold, baseline, variability).percentage;
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
    this.lastState = { ...this.lastState, effectiveThreshold: this.getEffectiveThreshold() };
  }

  private recomputeBufferSize(): void {
    this.maxBufferSize = Math.max(1, Math.round(this.settings.sensitivitySeconds * this.sampleRateHz));
    if (this.metricBuffer.length > this.maxBufferSize) {
      this.metricBuffer = this.metricBuffer.slice(-this.maxBufferSize);
    }
  }

  public clearSmoothingWindow(): void {
    this.metricBuffer = [];
    this.isCurrentlyDimmed = false;
    this.lastState = {
      ...this.lastState,
      smoothedMetric: this.lastState.currentMetric,
      deficit: 0,
      overlayOpacity: 0,
      blurRadius: 0,
      audioVolume: 0,
      isDimmingActive: false,
      isArtifactFrozen: false,
    };
  }

  public resetSession(): void {
    this.metricBuffer = [];
    this.isCurrentlyDimmed = false;
    this.lastState = this.createInitialState();
    this.sessionStats = this.createInitialStats();
  }

  public processTelemetry(telemetry: EEGTelemetry): BiofeedbackFeedbackState {
    const isContactOk = areAllElectrodesUsable(
      telemetry.signalQuality,
      telemetry.resistanceKOhm
    );

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

    const sourceMetric =
      this.settings.mode === 'concentration' ? telemetry.concentration : telemetry.relaxation;
    const sourceThreshold = this.settings.threshold;
    const calibration = this.personalCalibration;
    const baseline = calibration
      ? this.settings.mode === 'concentration'
        ? calibration.baselineFocus
        : calibration.baselineRelaxation
      : null;
    const variability = calibration
      ? this.settings.mode === 'concentration'
        ? calibration.variabilityFocus
        : calibration.variabilityRelaxation
      : 0;
    const personalScore = baseline === null
      ? null
      : mapMetricToPersonalScore(sourceMetric, baseline, variability);
    const rawMetric = personalScore?.percentage ?? sourceMetric;
    const activeThreshold = baseline === null
      ? sourceThreshold
      : mapMetricToPersonalScore(sourceThreshold, baseline, variability).percentage;

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

    if (smoothedMetric < activeThreshold) {
      deficit = (activeThreshold - smoothedMetric) / Math.max(1, activeThreshold);
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
      effectiveThreshold: Number(activeThreshold.toFixed(2)),
      ...(personalScore ? { personalDeviation: personalScore.deviation } : { personalDeviation: 0 }),
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
    const validFrames = frames.filter((frame) =>
      isTelemetryUsable(frame) &&
      Number.isFinite(frame.concentration) && frame.concentration >= 0 && frame.concentration <= 100 &&
      Number.isFinite(frame.relaxation) && frame.relaxation >= 0 && frame.relaxation <= 100
    );
    const validSampleRatio = frames.length === 0 ? 0 : validFrames.length / frames.length;
    const minimumSamples = Math.max(20, Math.ceil(frames.length * 0.5));

    if (validFrames.length < minimumSamples || validSampleRatio < 0.5) {
      return {
        baselineFocus: 60,
        baselineRelaxation: 60,
        variabilityFocus: 0,
        variabilityRelaxation: 0,
        fatigueDrift: 0,
        recommendedThreshold: 50,
        confidence: 0,
        validSampleRatio: Number(validSampleRatio.toFixed(3)),
        mode,
        sampleCount: validFrames.length,
      };
    }

    const median = (values: number[]): number => {
      const ordered = [...values].sort((a, b) => a - b);
      const middle = Math.floor(ordered.length / 2);
      return ordered.length % 2 === 0
        ? (ordered[middle - 1] + ordered[middle]) / 2
        : ordered[middle];
    };
    const summarize = (values: number[]) => {
      const split = Math.max(1, Math.floor(values.length / 2));
      const firstHalf = values.slice(0, split);
      const secondHalf = values.slice(split);
      const firstMedian = median(firstHalf);
      const secondMedian = median(secondHalf.length > 0 ? secondHalf : firstHalf);
      // Slightly weight the later half so the norm reflects current fatigue,
      // while retaining enough early data to resist a transient end-of-trial dip.
      const baseline = firstMedian * 0.35 + secondMedian * 0.65;
      const center = median(values);
      const mad = median(values.map((value) => Math.abs(value - center)));
      const variability = 1.4826 * mad;
      return {
        baseline: Math.max(0, Math.min(100, baseline)),
        variability,
        drift: secondMedian - firstMedian,
      };
    };

    const focus = summarize(validFrames.map((frame) => frame.concentration));
    const relaxation = summarize(validFrames.map((frame) => frame.relaxation));
    const selected = mode === 'concentration' ? focus : relaxation;
    const recommendedThreshold = Math.max(
      10,
      Math.min(95, Math.round(selected.baseline - 0.5 * selected.variability))
    );
    const coverage = Math.min(1, validSampleRatio);
    const stability = Math.max(0.35, 1 - selected.variability / 50);
    const confidence = Math.max(0, Math.min(1, coverage * stability));

    return {
      baselineFocus: Number(focus.baseline.toFixed(2)),
      baselineRelaxation: Number(relaxation.baseline.toFixed(2)),
      variabilityFocus: Number(focus.variability.toFixed(2)),
      variabilityRelaxation: Number(relaxation.variability.toFixed(2)),
      fatigueDrift: Number(focus.drift.toFixed(2)),
      recommendedThreshold,
      confidence: Number(confidence.toFixed(2)),
      validSampleRatio: Number(validSampleRatio.toFixed(3)),
      mode,
      sampleCount: validFrames.length,
    };
  }

}
