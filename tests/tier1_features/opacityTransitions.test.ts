import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';
import { SyntheticEEGGenerator } from '../fixtures/eegGenerator.ts';

test('Tier 1 - Opacity: zero dimming when focus is strictly above threshold', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, dimmingMaxOpacity: 0.8 });
  const gen = new SyntheticEEGGenerator();

  // Feed 100 high-focus frames (focus ~90%)
  for (let i = 0; i < 100; i++) {
    const frame = gen.nextFrame('high_focus');
    const state = engine.processTelemetry(frame);
    assert.strictEqual(state.overlayOpacity, 0, 'Opacity should be 0 during high focus');
    assert.strictEqual(state.isDimmingActive, false, 'Dimming should not be active');
    assert.strictEqual(state.deficit, 0, 'Deficit must be 0');
  }
});

test('Tier 1 - Opacity: zero dimming when focus equals threshold boundary', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, sensitivitySeconds: 0.001 });
  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 15, o2: 15 },
    concentration: 60.0,
    relaxation: 50.0,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.overlayOpacity, 0, 'Overlay opacity must be 0 at threshold boundary');
  assert.strictEqual(state.isDimmingActive, false);
});

test('Tier 1 - Opacity: proportional opacity scaling when focus drops to 50% of threshold', () => {
  // Threshold = 60, maxOpacity = 0.8. Metric = 30 (half of threshold).
  // Deficit = (60 - 30) / 60 = 0.5. Expected opacity = 0.5 * 0.8 = 0.40.
  const engine = new BiofeedbackEngine({
    threshold: 60,
    dimmingMaxOpacity: 0.8,
    sensitivitySeconds: 0.001, // single-sample buffer
  });

  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    concentration: 30.0,
    relaxation: 40.0,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.deficit, 0.5, 'Deficit must be exactly 0.5');
  assert.strictEqual(state.overlayOpacity, 0.4, 'Opacity should scale to 0.40');
  assert.strictEqual(state.isDimmingActive, true);
});

test('Tier 1 - Opacity: maximum configured opacity reached when focus drops to 0%', () => {
  const maxOpacity = 0.85;
  const engine = new BiofeedbackEngine({
    threshold: 70,
    dimmingMaxOpacity: maxOpacity,
    sensitivitySeconds: 0.001,
  });

  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 },
    concentration: 0.0,
    relaxation: 10.0,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.deficit, 1.0, 'Deficit must be 1.0 at 0 focus');
  assert.strictEqual(state.overlayOpacity, maxOpacity, 'Opacity must match configured maxOpacity');
});

test('Tier 1 - Opacity: smooth moving-average transition when focus suddenly plunges', () => {
  const engine = new BiofeedbackEngine({
    threshold: 60,
    dimmingMaxOpacity: 0.8,
    sensitivitySeconds: 0.2, // 50 samples at 250Hz
  });

  // Prime buffer with 50 frames of 80% focus
  for (let i = 0; i < 50; i++) {
    engine.processTelemetry({
      timestamp: Date.now() + i * 4,
      rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
      concentration: 80,
      relaxation: 50,
      signalQuality: { t3: true, t4: true, o1: true, o2: true },
      isArtifact: false,
    });
  }
  assert.strictEqual(engine.getLastState().overlayOpacity, 0);

  // Plunge focus to 0 for single frame: smoothed metric should be ~78.4, NOT 0
  const stateSinglePlunge = engine.processTelemetry({
    timestamp: Date.now() + 200,
    rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 },
    concentration: 0,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });

  assert.ok(stateSinglePlunge.smoothedMetric > 70, 'Single drop should be smoothed out');
  assert.strictEqual(stateSinglePlunge.overlayOpacity, 0, 'No instant jarring dimming');
});

test('Tier 1 - Opacity: blur radius scales monotonically with opacity deficit up to configured max', () => {
  const maxBlur = 24;
  const engine = new BiofeedbackEngine({
    threshold: 80,
    blurRadius: maxBlur,
    dimmingMaxOpacity: 0.9,
    sensitivitySeconds: 0.001,
  });

  const frameHalf = {
    timestamp: Date.now(),
    rawChannels: { t3: 15, t4: 15, o1: 15, o2: 15 },
    concentration: 40, // 50% deficit
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };
  const stateHalf = engine.processTelemetry(frameHalf);
  assert.strictEqual(stateHalf.blurRadius, 12, 'Blur should be 50% of 24 = 12px');

  const engineZero = new BiofeedbackEngine({
    threshold: 80,
    blurRadius: maxBlur,
    dimmingMaxOpacity: 0.9,
    sensitivitySeconds: 0.001,
  });
  const frameZero = {
    timestamp: Date.now(),
    rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 },
    concentration: 0, // 100% deficit
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };
  const stateZero = engineZero.processTelemetry(frameZero);
  assert.strictEqual(stateZero.blurRadius, maxBlur, 'Blur should reach 24px at 0 focus');
});
