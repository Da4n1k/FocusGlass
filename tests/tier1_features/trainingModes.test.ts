import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';

test('Tier 1 - Training Modes: concentration mode evaluates concentration and ignores relaxation', () => {
  const engine = new BiofeedbackEngine({
    mode: 'concentration',
    threshold: 60,
    sensitivitySeconds: 0.01,
  });

  // Concentration high (85), Relaxation low (20)
  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 85,
    relaxation: 20,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.currentMetric, 85);
  assert.strictEqual(state.overlayOpacity, 0, 'High concentration must not dim in concentration mode');
});

test('Tier 1 - Training Modes: relaxation mode evaluates relaxation and ignores concentration', () => {
  const engine = new BiofeedbackEngine({
    mode: 'relaxation',
    threshold: 60,
    sensitivitySeconds: 0.01,
  });

  // Concentration low (20), Relaxation high (85)
  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 20,
    relaxation: 85,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.currentMetric, 85);
  assert.strictEqual(state.overlayOpacity, 0, 'High relaxation must not dim in relaxation mode');
});

test('Tier 1 - Training Modes: switching mode immediately flips active metric evaluation', () => {
  const engine = new BiofeedbackEngine({
    mode: 'concentration',
    threshold: 60,
    sensitivitySeconds: 0.01,
    dimmingMaxOpacity: 0.8,
  });

  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 80, // > 60
    relaxation: 30,    // < 60
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  let state = engine.processTelemetry(frame);
  assert.strictEqual(state.overlayOpacity, 0, 'Concentration mode: no dimming');

  // Switch to relaxation mode
  engine.updateSettings({ mode: 'relaxation' });
  state = engine.processTelemetry(frame);
  assert.strictEqual(state.currentMetric, 30);
  assert.ok(state.overlayOpacity > 0, 'Relaxation mode: dimming activated for relaxation deficit');
});

test('Tier 1 - Training Modes: settings store reflects active mode update correctly', () => {
  const engine = new BiofeedbackEngine();
  assert.strictEqual(engine.getSettings().mode, 'concentration');

  engine.updateSettings({ mode: 'relaxation' });
  assert.strictEqual(engine.getSettings().mode, 'relaxation');

  engine.updateSettings({ mode: 'concentration' });
  assert.strictEqual(engine.getSettings().mode, 'concentration');
});

test('Tier 1 - Training Modes: relaxation mode dims screen when stress rises (relaxation drops below threshold)', () => {
  const engine = new BiofeedbackEngine({
    mode: 'relaxation',
    threshold: 50,
    sensitivitySeconds: 0.01,
    dimmingMaxOpacity: 0.7,
  });

  // Relaxation drops to 25 (50% deficit: (50 - 25) / 50 = 0.5)
  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 15, t4: 15, o1: 15, o2: 15 },
    concentration: 50,
    relaxation: 25,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.deficit, 0.5);
  assert.strictEqual(state.overlayOpacity, 0.35); // 0.5 * 0.7
  assert.strictEqual(state.isDimmingActive, true);
});

test('Tier 1 - Training Modes: relaxation mode maintains 0 opacity when relaxation is 100% even if focus is 0%', () => {
  const engine = new BiofeedbackEngine({
    mode: 'relaxation',
    threshold: 70,
    sensitivitySeconds: 0.01,
  });

  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 5, t4: 5, o1: 30, o2: 30 },
    concentration: 0,
    relaxation: 100,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.overlayOpacity, 0);
  assert.strictEqual(state.isDimmingActive, false);
});
