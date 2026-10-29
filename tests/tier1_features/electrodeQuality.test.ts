import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';
import type { EEGTelemetry } from '../contracts/telemetry.ts';

function createMockFrame(quality: { t3: boolean; t4: boolean; o1: boolean; o2: boolean }): EEGTelemetry {
  return {
    timestamp: Date.now(),
    rawChannels: { t3: 15, t4: 15, o1: 15, o2: 15 },
    concentration: 75,
    relaxation: 60,
    signalQuality: { ...quality },
    isArtifact: false,
  };
}

test('Tier 1 - Electrodes: all 4 electrodes connected reports isContactOk = true', () => {
  const engine = new BiofeedbackEngine();
  const frame = createMockFrame({ t3: true, t4: true, o1: true, o2: true });

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.isContactOk, true, 'All 4 channels good must yield isContactOk = true');
});

test('Tier 1 - Electrodes: temporal electrode loss (T3 = false) triggers isContactOk = false', () => {
  const engine = new BiofeedbackEngine();
  const frame = createMockFrame({ t3: false, t4: true, o1: true, o2: true });

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.isContactOk, false, 'T3 disconnected must yield isContactOk = false');
});

test('Tier 1 - Electrodes: occipital electrode loss (O1 and O2 = false) triggers isContactOk = false', () => {
  const engine = new BiofeedbackEngine();
  const frame = createMockFrame({ t3: true, t4: true, o1: false, o2: false });

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.isContactOk, false, 'O1/O2 disconnected must yield isContactOk = false');
});

test('Tier 1 - Electrodes: re-establishing skin contact restores isContactOk = true dynamically', () => {
  const engine = new BiofeedbackEngine();

  // Loss
  let state = engine.processTelemetry(createMockFrame({ t3: true, t4: false, o1: true, o2: true }));
  assert.strictEqual(state.isContactOk, false);

  // Recovery
  state = engine.processTelemetry(createMockFrame({ t3: true, t4: true, o1: true, o2: true }));
  assert.strictEqual(state.isContactOk, true, 'Contact restoration must immediately update state');
});

test('Tier 1 - Electrodes: total headband disconnection (all 4 false) flags degraded status', () => {
  const engine = new BiofeedbackEngine();
  const frame = createMockFrame({ t3: false, t4: false, o1: false, o2: false });

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.isContactOk, false);
});

test('Tier 1 - Electrodes: electrode quality updates synchronously on every single frame without latency', () => {
  const engine = new BiofeedbackEngine({ sensitivitySeconds: 5.0 }); // Even with long smoothing window!

  // Frame with broken contact
  const stateBroken = engine.processTelemetry(createMockFrame({ t3: true, t4: true, o1: true, o2: false }));
  assert.strictEqual(stateBroken.isContactOk, false, 'Contact status must NOT be delayed by moving-average window');

  // Frame with restored contact
  const stateRestored = engine.processTelemetry(createMockFrame({ t3: true, t4: true, o1: true, o2: true }));
  assert.strictEqual(stateRestored.isContactOk, true);
});
