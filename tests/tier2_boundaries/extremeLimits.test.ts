import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';

test('Tier 2 - Boundary: 0% focus evaluates cleanly without NaN or division by zero', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, dimmingMaxOpacity: 0.8, sensitivitySeconds: 0.001 });
  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 },
    concentration: 0,
    relaxation: 0,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(isNaN(state.overlayOpacity), false, 'Opacity must not be NaN');
  assert.strictEqual(isNaN(state.deficit), false, 'Deficit must not be NaN');
  assert.strictEqual(state.deficit, 1.0);
  assert.strictEqual(state.overlayOpacity, 0.8);
});

test('Tier 2 - Boundary: 100% focus evaluates cleanly with zero deficit and zero opacity', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, sensitivitySeconds: 0.001 });
  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 50, t4: 50, o1: 50, o2: 50 },
    concentration: 100,
    relaxation: 100,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.deficit, 0);
  assert.strictEqual(state.overlayOpacity, 0);
  assert.strictEqual(state.isDimmingActive, false);
});

test('Tier 2 - Boundary: out-of-range sensor noise (<0 or >100) is gracefully handled', () => {
  const engine = new BiofeedbackEngine({ threshold: 50, dimmingMaxOpacity: 0.7, sensitivitySeconds: 0.001 });

  // Negative concentration spike
  const stateNegative = engine.processTelemetry({
    timestamp: Date.now(),
    rawChannels: { t3: -200, t4: -200, o1: -200, o2: -200 },
    concentration: -40,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });
  assert.ok(stateNegative.deficit <= 1.0, 'Deficit must be capped at 1.0');
  assert.ok(stateNegative.overlayOpacity <= 0.7, 'Opacity must be capped at dimmingMaxOpacity');

  // Extreme >100 concentration
  const stateSuper = engine.processTelemetry({
    timestamp: Date.now() + 10,
    rawChannels: { t3: 300, t4: 300, o1: 300, o2: 300 },
    concentration: 150,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });
  assert.strictEqual(stateSuper.deficit, 0);
  assert.strictEqual(stateSuper.overlayOpacity, 0);
});

test('Tier 2 - Boundary: near-zero sensitivity (single-sample buffer) operates with zero buffer underflow', () => {
  const engine = new BiofeedbackEngine({ sensitivitySeconds: 0.001 }); // 1 sample buffer

  for (let i = 0; i < 50; i++) {
    const state = engine.processTelemetry({
      timestamp: Date.now() + i * 4,
      rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
      concentration: (i % 2 === 0) ? 80 : 20,
      relaxation: 50,
      signalQuality: { t3: true, t4: true, o1: true, o2: true },
      isArtifact: false,
    });
    assert.ok(!isNaN(state.overlayOpacity));
    assert.ok(!isNaN(state.smoothedMetric));
  }
});

test('Tier 2 - Boundary: maximum sensitivity (10.0 seconds / 2500 samples) handles large sliding window', () => {
  const engine = new BiofeedbackEngine({ sensitivitySeconds: 10.0 }); // 2500 samples

  // Stream 3000 samples
  for (let i = 0; i < 3000; i++) {
    engine.processTelemetry({
      timestamp: Date.now() + i * 4,
      rawChannels: { t3: 15, t4: 15, o1: 15, o2: 15 },
      concentration: 70,
      relaxation: 50,
      signalQuality: { t3: true, t4: true, o1: true, o2: true },
      isArtifact: false,
    });
  }

  const lastState = engine.getLastState();
  assert.strictEqual(lastState.smoothedMetric, 70);
  assert.strictEqual(lastState.overlayOpacity, 0);
});
