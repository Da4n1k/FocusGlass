import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';

test('Tier 1 - Threshold: adjusting threshold shifts the dimming boundary', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, sensitivitySeconds: 0.01 });

  const frameFocus50 = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 50,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  // At threshold 60, 50 focus is below threshold -> dimming active
  let state = engine.processTelemetry(frameFocus50);
  assert.ok(state.overlayOpacity > 0);

  // Lower threshold to 40 -> 50 focus is now above threshold -> no dimming
  engine.updateSettings({ threshold: 40 });
  state = engine.processTelemetry(frameFocus50);
  assert.strictEqual(state.overlayOpacity, 0);
  assert.strictEqual(state.isDimmingActive, false);
});

test('Tier 1 - Threshold: lowering threshold clears dimming for borderline focus scores', () => {
  const engine = new BiofeedbackEngine({ threshold: 75, sensitivitySeconds: 0.01, dimmingMaxOpacity: 0.8 });

  const frameFocus70 = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 70,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  let state = engine.processTelemetry(frameFocus70);
  assert.ok(state.overlayOpacity > 0, 'Should dim when focus (70) < threshold (75)');

  // Lower threshold to 65
  engine.updateSettings({ threshold: 65 });
  state = engine.processTelemetry(frameFocus70);
  assert.strictEqual(state.overlayOpacity, 0, 'Should clear when focus (70) >= threshold (65)');
});

test('Tier 1 - Threshold: raising threshold triggers dimming for previously tolerated scores', () => {
  const engine = new BiofeedbackEngine({ threshold: 50, sensitivitySeconds: 0.01 });

  const frameFocus55 = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 55,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  let state = engine.processTelemetry(frameFocus55);
  assert.strictEqual(state.overlayOpacity, 0);

  // Raise threshold to 70
  engine.updateSettings({ threshold: 70 });
  state = engine.processTelemetry(frameFocus55);
  assert.ok(state.overlayOpacity > 0, 'Now below raised threshold');
});

test('Tier 1 - Threshold: threshold values are clamped within safe range [10, 95]', () => {
  const engine = new BiofeedbackEngine();

  // Try setting below 10
  engine.updateSettings({ threshold: -15 });
  assert.strictEqual(engine.getSettings().threshold, 10, 'Should clamp to min 10');

  // Try setting above 95
  engine.updateSettings({ threshold: 120 });
  assert.strictEqual(engine.getSettings().threshold, 95, 'Should clamp to max 95');
});

test('Tier 1 - Threshold: dynamic threshold update takes effect immediately during continuous streaming', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, sensitivitySeconds: 0.05 });

  for (let i = 0; i < 20; i++) {
    engine.processTelemetry({
      timestamp: Date.now() + i * 4,
      rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
      concentration: 55,
      relaxation: 50,
      signalQuality: { t3: true, t4: true, o1: true, o2: true },
      isArtifact: false,
    });
  }
  assert.ok(engine.getLastState().overlayOpacity > 0);

  // Instantly relax threshold to 50
  engine.updateSettings({ threshold: 50 });

  const nextState = engine.processTelemetry({
    timestamp: Date.now() + 100,
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 55,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });

  assert.strictEqual(nextState.overlayOpacity, 0);
  assert.strictEqual(nextState.isDimmingActive, false);
});
