import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';
import { SyntheticEEGGenerator } from '../fixtures/eegGenerator.ts';

test('Tier 2 - Rapid Sliders: sweeping threshold 100 times between 10% and 90% during 250Hz streaming', () => {
  const engine = new BiofeedbackEngine({ threshold: 50, sensitivitySeconds: 0.2 });
  const gen = new SyntheticEEGGenerator();

  for (let i = 0; i < 250; i++) {
    const frame = gen.nextFrame('attention_drift'); // concentration ~48%

    // Rapidly toggle threshold every few frames
    if (i % 2 === 0) {
      const newThreshold = 10 + (i % 85);
      engine.updateSettings({ threshold: newThreshold });
    }

    const state = engine.processTelemetry(frame);
    assert.strictEqual(isNaN(state.overlayOpacity), false, `NaN opacity at frame ${i}`);
    assert.strictEqual(isNaN(state.smoothedMetric), false, `NaN metric at frame ${i}`);
    assert.ok(state.overlayOpacity >= 0 && state.overlayOpacity <= 1.0);
  }
});

test('Tier 2 - Rapid Sliders: rapid sensitivity switching dynamic buffer resize without loss or corruption', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, sensitivitySeconds: 1.0 });
  const gen = new SyntheticEEGGenerator();

  const sensitivities = [0.1, 0.5, 2.0, 0.05, 1.5, 3.0, 0.2];

  for (let i = 0; i < 200; i++) {
    const frame = gen.nextFrame('high_focus');

    if (i % 25 === 0) {
      const s = sensitivities[(i / 25) % sensitivities.length];
      engine.updateSettings({ sensitivitySeconds: s });
      assert.strictEqual(engine.getSettings().sensitivitySeconds, s);
    }

    const state = engine.processTelemetry(frame);
    assert.strictEqual(isNaN(state.smoothedMetric), false);
    assert.ok(state.smoothedMetric > 0);
  }
});

test('Tier 2 - Rapid Sliders: maxOpacity slider sweep across range [0.1, 0.95] does not cause opacity overshoots', () => {
  const engine = new BiofeedbackEngine({ threshold: 80, sensitivitySeconds: 0.001 });

  const lowFocusFrame = {
    timestamp: Date.now(),
    rawChannels: { t3: 5, t4: 5, o1: 5, o2: 5 },
    concentration: 20, // Deficit = (80 - 20) / 80 = 0.75
    relaxation: 30,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  for (let op = 0.1; op <= 0.95; op += 0.05) {
    engine.updateSettings({ dimmingMaxOpacity: op });
    const state = engine.processTelemetry(lowFocusFrame);
    assert.ok(
      state.overlayOpacity <= op + 0.0001,
      `Overlay opacity ${state.overlayOpacity} exceeded configured maxOpacity ${op}`
    );
  }
});
