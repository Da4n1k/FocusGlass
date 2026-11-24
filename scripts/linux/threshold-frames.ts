/** Production engine/policy fixtures consumed by the real Rust/GPU integration test. */
import { BiofeedbackEngine } from '../../src/services/biofeedbackEngine.ts';
import { buildLinuxBlurInput, linuxBlurTarget } from '../../src/services/linuxBlurPolicy.ts';

const cases = [
  { name: 'below threshold', metric: 59.9, invert: false, active: true },
  { name: 'equal threshold', metric: 60, invert: false, active: false },
  { name: 'above threshold', metric: 60.1, invert: false, active: false },
  { name: 'inverted above threshold', metric: 60.1, invert: true, active: true },
  { name: 'inverted below threshold', metric: 59.9, invert: true, active: false },
];
console.log(JSON.stringify(cases.map((fixture) => {
  const engine = new BiofeedbackEngine({
    threshold: 60, sensitivitySeconds: 0.001, invertReaction: fixture.invert,
    overlayMode: 'threshold_blur', blurRadius: 16, dimmingMaxOpacity: 0.05,
  });
  const feedbackState = engine.processTelemetry({
    timestamp: 0, concentration: fixture.metric, relaxation: 40,
    rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    signalQuality: { t3: true, t4: true, o1: true, o2: true }, isArtifact: false,
  });
  return { name: fixture.name, active: fixture.active,
    ...linuxBlurTarget(buildLinuxBlurInput({
      overlayEnabled: true, isPaused: false, settings: engine.getSettings(),
      deviceStatus: { connected: true }, feedbackState,
    })),
  };
})));
