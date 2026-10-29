import type { EEGTelemetry } from '../contracts/telemetry.ts';

export interface ArtifactPattern {
  name: 'eye_blink_eog' | 'jaw_clench_emg' | 'headband_shift';
  durationFrames: number;
  peakAmplitudeMicrovolts: number;
  channelsAffected: ('t3' | 't4' | 'o1' | 'o2')[];
}

export const ARTIFACT_PRESETS: Record<string, ArtifactPattern> = {
  eyeBlink: {
    name: 'eye_blink_eog',
    durationFrames: 50, // ~200ms at 250Hz
    peakAmplitudeMicrovolts: 180,
    channelsAffected: ['t3', 't4'],
  },
  jawClench: {
    name: 'jaw_clench_emg',
    durationFrames: 125, // ~500ms at 250Hz
    peakAmplitudeMicrovolts: 320,
    channelsAffected: ['t3', 't4', 'o1', 'o2'],
  },
  headbandShift: {
    name: 'headband_shift',
    durationFrames: 250, // 1000ms
    peakAmplitudeMicrovolts: 450,
    channelsAffected: ['o1', 'o2'],
  },
};

/**
 * Injects an artifact burst sequence into an existing stream of EEG telemetry frames
 */
export function injectArtifactBurst(
  frames: EEGTelemetry[],
  startFrameIndex: number,
  pattern: ArtifactPattern
): EEGTelemetry[] {
  const result = frames.map(f => ({ ...f, rawChannels: { ...f.rawChannels }, signalQuality: { ...f.signalQuality } }));

  for (let i = 0; i < pattern.durationFrames; i++) {
    const targetIdx = startFrameIndex + i;
    if (targetIdx >= result.length) break;

    // Bell-shaped amplitude envelope
    const envelope = Math.sin((Math.PI * i) / pattern.durationFrames);
    const addedUv = pattern.peakAmplitudeMicrovolts * envelope;

    const frame = result[targetIdx];
    frame.isArtifact = true;

    for (const ch of pattern.channelsAffected) {
      frame.rawChannels[ch] += Number(addedUv.toFixed(1));
    }

    if (pattern.name === 'headband_shift' && i > 50 && i < 200) {
      // Simulate momentary impedance loss on occipital sensors
      frame.signalQuality.o1 = false;
      frame.signalQuality.o2 = false;
    }
  }

  return result;
}
