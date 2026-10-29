import type { EEGTelemetry, RawEEGChannels } from '../contracts/telemetry.ts';

export type PresetState = 'high_focus' | 'calm_flow' | 'attention_drift' | 'distracted' | 'meditation';

export class SyntheticEEGGenerator {
  private sampleRateHz: number;
  private currentTimestamp: number;
  private phaseAlpha: number = 0;
  private phaseBeta: number = 0;
  private phaseTheta: number = 0;

  constructor(sampleRateHz: number = 250, initialTimestamp: number = 1761780000000) {
    this.sampleRateHz = sampleRateHz;
    this.currentTimestamp = initialTimestamp;
  }

  /**
   * Generates a single EEG frame (interval = 1000 / sampleRateHz ms)
   */
  public nextFrame(state: PresetState, injectArtifact: boolean = false): EEGTelemetry {
    const dt = 1 / this.sampleRateHz;
    this.currentTimestamp += Math.round(dt * 1000);

    // Alpha rhythm: 10 Hz; Beta rhythm: 20 Hz; Theta rhythm: 6 Hz
    this.phaseAlpha += 2 * Math.PI * 10 * dt;
    this.phaseBeta += 2 * Math.PI * 20 * dt;
    this.phaseTheta += 2 * Math.PI * 6 * dt;

    let targetConcentration = 75;
    let targetRelaxation = 60;
    let alphaAmp = 15; // microvolts
    let betaAmp = 20;

    switch (state) {
      case 'high_focus':
        targetConcentration = 90;
        targetRelaxation = 45;
        alphaAmp = 8;
        betaAmp = 35;
        break;
      case 'calm_flow':
        targetConcentration = 78;
        targetRelaxation = 72;
        alphaAmp = 25;
        betaAmp = 22;
        break;
      case 'attention_drift':
        targetConcentration = 48;
        targetRelaxation = 50;
        alphaAmp = 18;
        betaAmp = 12;
        break;
      case 'distracted':
        targetConcentration = 25;
        targetRelaxation = 30;
        alphaAmp = 12;
        betaAmp = 8;
        break;
      case 'meditation':
        targetConcentration = 40;
        targetRelaxation = 92;
        alphaAmp = 45;
        betaAmp = 6;
        break;
    }

    // Add slight deterministic noise based on trigonometric frequencies
    const noise = Math.sin(this.phaseTheta * 3) * 2;
    const finalConcentration = Math.max(0, Math.min(100, targetConcentration + noise));
    const finalRelaxation = Math.max(0, Math.min(100, targetRelaxation - noise));

    let t3 = Math.sin(this.phaseBeta) * betaAmp + Math.cos(this.phaseAlpha) * alphaAmp;
    let t4 = Math.sin(this.phaseBeta + 0.3) * betaAmp + Math.cos(this.phaseAlpha + 0.3) * alphaAmp;
    let o1 = Math.sin(this.phaseAlpha) * (alphaAmp * 1.5) + Math.cos(this.phaseBeta) * (betaAmp * 0.7);
    let o2 = Math.sin(this.phaseAlpha + 0.2) * (alphaAmp * 1.5) + Math.cos(this.phaseBeta + 0.2) * (betaAmp * 0.7);

    if (injectArtifact) {
      // High-amplitude spike mimicking blink/muscle artifact (150-250 uV)
      t3 += 180;
      t4 += 190;
      o1 += 80;
      o2 += 85;
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
      signalQuality: { t3: true, t4: true, o1: true, o2: true },
      isArtifact: injectArtifact,
    };
  }

  /**
   * Generates a batch of frames for a specified duration in seconds
   */
  public generateBatch(durationSeconds: number, state: PresetState, artifactProbability: number = 0): EEGTelemetry[] {
    const totalFrames = Math.round(durationSeconds * this.sampleRateHz);
    const frames: EEGTelemetry[] = [];
    for (let i = 0; i < totalFrames; i++) {
      const isArtifact = artifactProbability > 0 && (i % Math.round(1 / artifactProbability) === 0);
      frames.push(this.nextFrame(state, isArtifact));
    }
    return frames;
  }
}
