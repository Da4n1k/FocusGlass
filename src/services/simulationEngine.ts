import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  PresetState,
  ElectrodeSignalQuality,
  RelativeSpectrum,
  TimelineSample,
} from './eegTypes.ts';
import { BiofeedbackEngine, DEFAULT_APP_SETTINGS } from './biofeedbackEngine.ts';
import { computeBipolarSpectrum } from './spectralMath.ts';

export interface GuidedDemoStatus {
  active: boolean;
  stepIndex: number;
  totalSteps: number;
  captionRu: string;
  captionEn: string;
  remainingSeconds: number;
}

interface DemoStageSpec {
  durationSec: number;
  preset?: PresetState;
  triggerArtifactAtSec?: number;
  disconnectO1?: boolean;
  captionRu: string;
  captionEn: string;
}

const GUIDED_DEMO_STAGES: DemoStageSpec[] = [
  {
    durationSec: 8,
    preset: 'calm_flow',
    captionRu: 'Этап 1/5 · Рабочий поток (78%): чистый сигнал 4 каналов, оверлей 100% прозрачен',
    captionEn: 'Stage 1/5 · Work Flow (78%): clean 4-ch EEG, overlay 100% transparent',
  },
  {
    durationSec: 10,
    preset: 'attention_drift',
    captionRu: 'Этап 2/5 · Рассеивание внимания (42% < порога): плавное затемнение и размытие краёв',
    captionEn: 'Stage 2/5 · Attention Drift (42% < threshold): smooth screen dimming & vignette',
  },
  {
    durationSec: 7,
    preset: 'attention_drift',
    triggerArtifactAtSec: 1.5,
    captionRu: 'Этап 3/5 · Моргание / мимика (ЭОГ-артефакт): заморозка прозрачности без мигания экрана',
    captionEn: 'Stage 3/5 · Eye Blink (EOG Artifact): anti-flicker opacity freeze active',
  },
  {
    durationSec: 8,
    preset: 'high_focus',
    captionRu: 'Этап 4/5 · Возврат концентрации (92%): рост β-ритма, экран плавно проясняется',
    captionEn: 'Stage 4/5 · Focus Recovery (92%): Beta power rises, screen clears smoothly',
  },
  {
    durationSec: 7,
    preset: 'high_focus',
    disconnectO1: true,
    captionRu: 'Этап 5/5 · Потеря контакта O1 (>2000 кОм): безопасная пауза БОС до поправки обруча',
    captionEn: 'Stage 5/5 · O1 Contact Loss (>2000 kΩ): safe biofeedback pause until sensor recovers',
  },
];

export type EngineSubscriber = (
  telemetry: EEGTelemetry,
  state: BiofeedbackFeedbackState,
  stats: SessionStatistics,
  timeline: TimelineSample[],
  demoStatus: GuidedDemoStatus
) => void;

export class SimulationEngine {
  private sampleRateHz: number = 250;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private isPaused: boolean = false;
  private currentPreset: PresetState = 'calm_flow';

  // Realistic multi-frame artifact generator (e.g. 60 frames = 240 ms EOG blink)
  private artifactFramesRemaining: number = 0;
  private artifactTotalFrames: number = 60;

  private phaseAlpha: number = 0;
  private phaseBeta: number = 0;
  private phaseTheta: number = 0;
  private phaseMains50Hz: number = 0;
  private currentTimestamp: number = Date.now();
  private totalSamplesGenerated: number = 0;

  private signalQuality: ElectrodeSignalQuality = {
    t3: true,
    t4: true,
    o1: true,
    o2: true,
  };

  private settings: FocusGlassSettings = { ...DEFAULT_APP_SETTINGS };
  private biofeedback: BiofeedbackEngine = new BiofeedbackEngine(DEFAULT_APP_SETTINGS, 250);

  private subscribers: Set<EngineSubscriber> = new Set();
  private rawBatchBuffer: EEGTelemetry[] = [];
  private latestSpectrum: RelativeSpectrum = {
    delta: 8,
    theta: 15,
    alpha: 34,
    beta: 37,
    gamma: 6,
  };

  // Timeline history sampled at 1 Hz for analytics chart & CSV export
  private timelineBuffer: TimelineSample[] = [];
  private maxTimelinePoints: number = 900; // 15 minutes at 1 Hz

  // CSV Replay buffer
  private replayFrames: EEGTelemetry[] = [];
  private replayCursor: number = 0;
  private replayLabel: string = '';

  // Guided auto-demo state
  private demoActive: boolean = false;
  private demoElapsedSec: number = 0;
  private demoArtifactTriggeredInStage: number = -1;
  private savedO1BeforeDemo: boolean = true;

  constructor() {
    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts() {
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;

    window.addEventListener('keydown', (e) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement
      ) {
        return;
      }

      // Only handle simulator preset keys when simulator is active
      if (this.settings.deviceSource === 'simulator') {
        switch (e.key) {
          case '1':
            this.stopGuidedDemo();
            this.setPreset('high_focus');
            break;
          case '2':
            this.stopGuidedDemo();
            this.setPreset('calm_flow');
            break;
          case '3':
            this.stopGuidedDemo();
            this.setPreset('attention_drift');
            break;
          case '4':
            this.injectArtifact('blink');
            break;
          case '5':
            this.stopGuidedDemo();
            this.setPreset('meditation');
            break;
          case ' ':
            e.preventDefault();
            this.togglePause();
            break;
        }
      }
    });
  }

  public subscribe(callback: EngineSubscriber): () => void {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  public start(initialSettings: FocusGlassSettings) {
    this.settings = { ...this.settings, ...initialSettings };
    this.biofeedback.updateSettings(this.settings);

    if (this.timerId !== null) return;

    const intervalMs = 16;
    const samplesPerTick = Math.round((this.sampleRateHz * intervalMs) / 1000); // 4 samples @ 250Hz

    this.timerId = setInterval(() => {
      if (this.isPaused) return;

      // Honest hardware separation: do NOT stream synthetic waves when physical BLE mode is selected
      if (this.settings.deviceSource === 'bluetooth') {
        return;
      }

      if (this.settings.deviceSource === 'csv_replay' && this.replayFrames.length === 0) {
        return;
      }

      if (this.demoActive && this.settings.deviceSource === 'simulator') {
        this.advanceGuidedDemo((samplesPerTick * 1.0) / this.sampleRateHz);
      }

      let latestTelemetry: EEGTelemetry | null = null;
      let latestFeedback: BiofeedbackFeedbackState = this.biofeedback.getLastState();

      for (let i = 0; i < samplesPerTick; i++) {
        const telemetry =
          this.settings.deviceSource === 'csv_replay'
            ? this.nextReplaySample()
            : this.generateSyntheticSample();

        latestFeedback = this.biofeedback.processTelemetry(telemetry);
        latestTelemetry = telemetry;
        this.rawBatchBuffer.push(telemetry);
        this.totalSamplesGenerated++;

        // Recompute real Hann-windowed bipolar spectrum at 10 Hz (every 25 samples)
        if (this.totalSamplesGenerated % 25 === 0 && this.rawBatchBuffer.length >= 64) {
          const rawWindow = this.rawBatchBuffer.slice(-250).map((p) => p.rawChannels);
          this.latestSpectrum = computeBipolarSpectrum(rawWindow);
          latestTelemetry = {
            ...telemetry,
            spectrum: { ...this.latestSpectrum },
          };
          this.rawBatchBuffer[this.rawBatchBuffer.length - 1] = latestTelemetry;
        }

        // Record 1 Hz timeline point (every 250 samples)
        if (this.totalSamplesGenerated % this.sampleRateHz === 0) {
          const stats = this.biofeedback.getSessionStats();
          this.timelineBuffer.push({
            elapsedSec: Number(stats.durationSeconds.toFixed(1)),
            concentration: telemetry.concentration,
            relaxation: telemetry.relaxation,
            smoothedMetric: latestFeedback.smoothedMetric,
            overlayOpacityPct: Number((latestFeedback.overlayOpacity * 100).toFixed(1)),
            threshold: this.settings.threshold,
            isArtifact: telemetry.isArtifact,
            isContactOk: latestFeedback.isContactOk,
          });
          if (this.timelineBuffer.length > this.maxTimelinePoints) {
            this.timelineBuffer.shift();
          }
        }
      }

      if (this.rawBatchBuffer.length > 1000) {
        this.rawBatchBuffer = this.rawBatchBuffer.slice(-1000);
      }

      if (latestTelemetry) {
        this.notify(
          latestTelemetry,
          latestFeedback,
          this.biofeedback.getSessionStats()
        );
      }
    }, intervalMs);
  }

  public stop() {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  /**
   * Live settings update — fixes the original bug where threshold/mode/opacity changes
   * did not propagate into the running biofeedback calculation!
   */
  public updateSettings(partial: Partial<FocusGlassSettings>): BiofeedbackFeedbackState {
    const prevSource = this.settings.deviceSource;
    this.settings = { ...this.settings, ...partial };
    const updatedFeedback = this.biofeedback.updateSettings(partial);

    // If switched to physical bluetooth (without SDK connected), clear dimming immediately
    if (this.settings.deviceSource === 'bluetooth' && prevSource !== 'bluetooth') {
      this.stopGuidedDemo();
      const idleFeedback: BiofeedbackFeedbackState = {
        ...updatedFeedback,
        overlayOpacity: 0,
        blurRadius: 0,
        audioVolume: 0,
        isDimmingActive: false,
      };
      const lastTel = this.rawBatchBuffer[this.rawBatchBuffer.length - 1];
      if (lastTel) {
        this.notify(lastTel, idleFeedback, this.biofeedback.getSessionStats());
      }
      return idleFeedback;
    }

    const lastTel = this.rawBatchBuffer[this.rawBatchBuffer.length - 1];
    if (lastTel) {
      this.notify(lastTel, updatedFeedback, this.biofeedback.getSessionStats());
    }
    return updatedFeedback;
  }

  public updateBufferSize(sensitivitySeconds: number) {
    this.updateSettings({ sensitivitySeconds });
  }

  public setPreset(preset: PresetState) {
    this.currentPreset = preset;
  }

  public getPreset(): PresetState {
    return this.currentPreset;
  }

  /**
   * Injects a realistic multi-frame physiological artifact burst:
   * - 'blink': 240 ms (60 samples @ 250 Hz) EOG eye blink
   * - 'jaw': 440 ms (110 samples @ 250 Hz) EMG jaw clench
   */
  public injectArtifact(kind: 'blink' | 'jaw' = 'blink') {
    const frames = kind === 'jaw' ? 110 : 60;
    this.artifactTotalFrames = frames;
    this.artifactFramesRemaining = frames;
  }

  public togglePause(): boolean {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

  public setPaused(paused: boolean) {
    this.isPaused = paused;
  }

  public getIsPaused(): boolean {
    return this.isPaused;
  }

  public setElectrodeQuality(channel: keyof ElectrodeSignalQuality, isOk: boolean) {
    this.signalQuality[channel] = isOk;
  }

  public getElectrodeQuality(): ElectrodeSignalQuality {
    return { ...this.signalQuality };
  }

  public getRawBuffer(): EEGTelemetry[] {
    return this.rawBatchBuffer;
  }

  public getTimelineBuffer(): TimelineSample[] {
    return [...this.timelineBuffer];
  }

  public getSessionStats(): SessionStatistics {
    return this.biofeedback.getSessionStats();
  }

  public resetSession() {
    this.biofeedback.resetSession();
    this.timelineBuffer = [];
  }

  /**
   * Loads parsed CSV telemetry frames for offline EEG replay
   */
  public loadReplayFrames(frames: EEGTelemetry[], label: string = 'EEG.csv') {
    this.replayFrames = frames;
    this.replayCursor = 0;
    this.replayLabel = label;
    this.rawBatchBuffer = [];
  }

  public getReplayInfo(): { count: number; label: string } {
    return { count: this.replayFrames.length, label: this.replayLabel };
  }

  /**
   * Entry point for external real-time hardware packets (e.g., Tauri neurosdk2 event / Python bridge)
   */
  public ingestHardwarePacket(packet: EEGTelemetry) {
    const feedback = this.biofeedback.processTelemetry(packet);
    this.rawBatchBuffer.push(packet);
    if (this.rawBatchBuffer.length > 1000) {
      this.rawBatchBuffer = this.rawBatchBuffer.slice(-1000);
    }
    this.notify(packet, feedback, this.biofeedback.getSessionStats());
  }

  /**
   * Hands-free 40-second guided presentation scenario (for "Вертушка" & silent demos)
   */
  public startGuidedDemo() {
    this.savedO1BeforeDemo = this.signalQuality.o1;
    this.signalQuality = { t3: true, t4: true, o1: true, o2: true };
    this.isPaused = false;
    this.demoElapsedSec = 0;
    this.demoArtifactTriggeredInStage = -1;
    this.demoActive = true;
    this.setPreset(GUIDED_DEMO_STAGES[0].preset ?? 'calm_flow');
  }

  public stopGuidedDemo() {
    if (!this.demoActive) return;
    this.demoActive = false;
    this.demoElapsedSec = 0;
    this.demoArtifactTriggeredInStage = -1;
    this.signalQuality.o1 = this.savedO1BeforeDemo;
  }

  public getGuidedDemoStatus(): GuidedDemoStatus {
    const totalSec = GUIDED_DEMO_STAGES.reduce((acc, s) => acc + s.durationSec, 0);
    if (!this.demoActive) {
      return {
        active: false,
        stepIndex: 0,
        totalSteps: GUIDED_DEMO_STAGES.length,
        captionRu: '',
        captionEn: '',
        remainingSeconds: 0,
      };
    }

    let acc = 0;
    for (let idx = 0; idx < GUIDED_DEMO_STAGES.length; idx++) {
      const stage = GUIDED_DEMO_STAGES[idx];
      if (this.demoElapsedSec < acc + stage.durationSec) {
        return {
          active: true,
          stepIndex: idx + 1,
          totalSteps: GUIDED_DEMO_STAGES.length,
          captionRu: stage.captionRu,
          captionEn: stage.captionEn,
          remainingSeconds: Math.max(0, Math.ceil(totalSec - this.demoElapsedSec)),
        };
      }
      acc += stage.durationSec;
    }

    return {
      active: false,
      stepIndex: GUIDED_DEMO_STAGES.length,
      totalSteps: GUIDED_DEMO_STAGES.length,
      captionRu: '',
      captionEn: '',
      remainingSeconds: 0,
    };
  }

  private advanceGuidedDemo(dtSec: number) {
    this.demoElapsedSec += dtSec;
    const totalSec = GUIDED_DEMO_STAGES.reduce((acc, s) => acc + s.durationSec, 0);

    if (this.demoElapsedSec >= totalSec) {
      this.stopGuidedDemo();
      this.setPreset('calm_flow');
      return;
    }

    let acc = 0;
    for (let idx = 0; idx < GUIDED_DEMO_STAGES.length; idx++) {
      const stage = GUIDED_DEMO_STAGES[idx];
      if (this.demoElapsedSec < acc + stage.durationSec) {
        const inStageSec = this.demoElapsedSec - acc;
        if (stage.preset && this.currentPreset !== stage.preset) {
          this.currentPreset = stage.preset;
        }
        if (
          stage.triggerArtifactAtSec !== undefined &&
          inStageSec >= stage.triggerArtifactAtSec &&
          this.demoArtifactTriggeredInStage !== idx
        ) {
          this.demoArtifactTriggeredInStage = idx;
          this.injectArtifact('blink');
        }
        if (stage.disconnectO1) {
          this.signalQuality.o1 = inStageSec < stage.durationSec - 2.0 ? false : true;
        } else {
          this.signalQuality.o1 = true;
        }
        break;
      }
      acc += stage.durationSec;
    }
  }

  private nextReplaySample(): EEGTelemetry {
    const base = this.replayFrames[this.replayCursor % this.replayFrames.length];
    this.replayCursor = (this.replayCursor + 1) % this.replayFrames.length;
    this.currentTimestamp += 4;

    const injectArt = this.artifactFramesRemaining > 0;
    if (injectArt) {
      this.artifactFramesRemaining--;
    }

    return {
      ...base,
      timestamp: this.currentTimestamp,
      signalQuality: { ...this.signalQuality },
      isArtifact: base.isArtifact || injectArt,
      spectrum: base.spectrum ?? { ...this.latestSpectrum },
      origin: 'csv_replay',
    };
  }

  /**
   * Generates a single synthetic 250 Hz sample ( testable synchronously too )
   */
  public stepSingleSyntheticSample(): {
    telemetry: EEGTelemetry;
    feedback: BiofeedbackFeedbackState;
    stats: SessionStatistics;
  } {
    const telemetry = this.generateSyntheticSample();
    const feedback = this.biofeedback.processTelemetry(telemetry);
    return {
      telemetry,
      feedback,
      stats: this.biofeedback.getSessionStats(),
    };
  }

  private generateSyntheticSample(): EEGTelemetry {
    const dt = 1 / this.sampleRateHz;
    this.currentTimestamp += Math.round(dt * 1000);

    // Physiological frequencies: Theta 6.0 Hz, Alpha 10.2 Hz, Beta 21.5 Hz + 50 Hz mains hum
    this.phaseAlpha += 2 * Math.PI * 10.2 * dt;
    this.phaseBeta += 2 * Math.PI * 21.5 * dt;
    this.phaseTheta += 2 * Math.PI * 6.0 * dt;
    this.phaseMains50Hz += 2 * Math.PI * 50.0 * dt;

    let targetConcentration = 78;
    let targetRelaxation = 65;
    let alphaAmp = 18;
    let betaAmp = 22;
    let thetaAmp = 10;

    switch (this.currentPreset) {
      case 'high_focus':
        targetConcentration = 92;
        targetRelaxation = 42;
        alphaAmp = 8;
        betaAmp = 38;
        thetaAmp = 6;
        break;
      case 'calm_flow':
        targetConcentration = 78;
        targetRelaxation = 72;
        alphaAmp = 24;
        betaAmp = 24;
        thetaAmp = 9;
        break;
      case 'attention_drift':
        targetConcentration = 42;
        targetRelaxation = 48;
        alphaAmp = 18;
        betaAmp = 10;
        thetaAmp = 26;
        break;
      case 'distracted':
        targetConcentration = 22;
        targetRelaxation = 28;
        alphaAmp = 13;
        betaAmp = 7;
        thetaAmp = 32;
        break;
      case 'meditation':
        targetConcentration = 35;
        targetRelaxation = 94;
        alphaAmp = 46;
        betaAmp = 6;
        thetaAmp = 12;
        break;
    }

    const noise =
      Math.sin(this.phaseTheta * 2.8) * 2.5 + Math.cos(this.phaseBeta * 0.4) * 1.5;
    const finalConcentration = Math.max(0, Math.min(100, targetConcentration + noise));
    const finalRelaxation = Math.max(0, Math.min(100, targetRelaxation - noise));

    let t3 =
      Math.sin(this.phaseBeta) * betaAmp +
      Math.cos(this.phaseAlpha) * alphaAmp +
      Math.sin(this.phaseTheta) * thetaAmp;
    let t4 =
      Math.sin(this.phaseBeta + 0.35) * betaAmp +
      Math.cos(this.phaseAlpha + 0.35) * alphaAmp +
      Math.sin(this.phaseTheta + 0.2) * thetaAmp;
    let o1 =
      Math.sin(this.phaseAlpha) * (alphaAmp * 1.6) +
      Math.cos(this.phaseBeta) * (betaAmp * 0.55) +
      Math.cos(this.phaseTheta) * (thetaAmp * 0.8);
    let o2 =
      Math.sin(this.phaseAlpha + 0.25) * (alphaAmp * 1.6) +
      Math.cos(this.phaseBeta + 0.25) * (betaAmp * 0.55) +
      Math.cos(this.phaseTheta + 0.25) * (thetaAmp * 0.8);

    // Multi-frame bell-shaped EOG/EMG artifact envelope
    const isArtifact = this.artifactFramesRemaining > 0;
    if (isArtifact) {
      const idx = this.artifactTotalFrames - this.artifactFramesRemaining;
      const envelope = Math.sin((Math.PI * (idx + 0.5)) / this.artifactTotalFrames);
      t3 += 195 * envelope;
      t4 += 210 * envelope;
      o1 += 82 * envelope;
      o2 += 88 * envelope;
      this.artifactFramesRemaining--;
    }

    // Realistic BrainBit dry-electrode contact resistance (in kOhm) & open-pin 50Hz hum on contact loss
    const drift = Math.sin(this.phaseTheta * 0.15) * 2.2;
    const impedanceKOhm = {
      t3: this.signalQuality.t3 ? Number((134 + drift).toFixed(0)) : 2500,
      t4: this.signalQuality.t4 ? Number((128 - drift).toFixed(0)) : 2500,
      o1: this.signalQuality.o1 ? Number((115 + drift * 0.8).toFixed(0)) : 2500,
      o2: this.signalQuality.o2 ? Number((121 - drift * 0.8).toFixed(0)) : 2500,
    };

    const hum50 = Math.sin(this.phaseMains50Hz) * 140;
    if (!this.signalQuality.t3) t3 = hum50 + 60;
    if (!this.signalQuality.t4) t4 = hum50 - 60;
    if (!this.signalQuality.o1) o1 = hum50 + 45;
    if (!this.signalQuality.o2) o2 = hum50 - 45;

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
      isArtifact,
      impedanceKOhm,
      spectrum: { ...this.latestSpectrum },
      origin: 'simulator',
    };
  }

  private notify(
    telemetry: EEGTelemetry,
    state: BiofeedbackFeedbackState,
    stats: SessionStatistics
  ) {
    const timeline = this.timelineBuffer;
    const demoStatus = this.getGuidedDemoStatus();
    for (const sub of this.subscribers) {
      sub(telemetry, state, stats, timeline, demoStatus);
    }
  }
}

export const simulationEngine = new SimulationEngine();
