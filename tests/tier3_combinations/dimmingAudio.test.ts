import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';

test('Tier 3 - Dimming + Audio: audio volume tracks deficit concurrently with screen opacity when enabled', () => {
  const engine = new BiofeedbackEngine({
    threshold: 60,
    dimmingMaxOpacity: 0.8,
    audioFeedbackEnabled: true,
    sensitivitySeconds: 0.001,
  });

  // Focus drops to 30 -> Deficit = (60 - 30) / 60 = 0.5
  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    concentration: 30,
    relaxation: 40,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.strictEqual(state.deficit, 0.5);
  assert.strictEqual(state.overlayOpacity, 0.4); // 0.5 * 0.8
  assert.strictEqual(state.audioVolume, 0.5, 'Audio volume must track deficit ratio 1:1');
});

test('Tier 3 - Dimming + Audio: audio volume remains 0 when audioFeedbackEnabled is false despite dimming', () => {
  const engine = new BiofeedbackEngine({
    threshold: 60,
    dimmingMaxOpacity: 0.8,
    audioFeedbackEnabled: false, // Disabled
    sensitivitySeconds: 0.001,
  });

  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    concentration: 30,
    relaxation: 40,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(frame);
  assert.ok(state.overlayOpacity > 0, 'Visual dimming must still be active');
  assert.strictEqual(state.audioVolume, 0, 'Audio volume must remain 0 when disabled');
});

test('Tier 3 - Dimming + Audio: toggling audio mid-session enables sound immediately without resetting opacity', () => {
  const engine = new BiofeedbackEngine({
    threshold: 70,
    dimmingMaxOpacity: 0.6,
    audioFeedbackEnabled: false,
    sensitivitySeconds: 0.001,
  });

  const frame = {
    timestamp: Date.now(),
    rawChannels: { t3: 5, t4: 5, o1: 5, o2: 5 },
    concentration: 35, // Deficit = 0.5
    relaxation: 40,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  let state = engine.processTelemetry(frame);
  assert.strictEqual(state.overlayOpacity, 0.3);
  assert.strictEqual(state.audioVolume, 0);

  // User toggles audio feedback ON in settings
  engine.updateSettings({ audioFeedbackEnabled: true });
  state = engine.processTelemetry(frame);
  assert.strictEqual(state.overlayOpacity, 0.3, 'Visual opacity preserved');
  assert.strictEqual(state.audioVolume, 0.5, 'Audio immediately engages');
});

test('Tier 3 - Dimming + Audio: focus recovery simultaneously silences audio and clears opacity', () => {
  const engine = new BiofeedbackEngine({
    threshold: 60,
    audioFeedbackEnabled: true,
    sensitivitySeconds: 0.001,
  });

  // Distraction
  let state = engine.processTelemetry({
    timestamp: Date.now(),
    rawChannels: { t3: 5, t4: 5, o1: 5, o2: 5 },
    concentration: 25,
    relaxation: 30,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });
  assert.ok(state.overlayOpacity > 0);
  assert.ok(state.audioVolume > 0);

  // Recovery
  state = engine.processTelemetry({
    timestamp: Date.now() + 10,
    rawChannels: { t3: 30, t4: 30, o1: 30, o2: 30 },
    concentration: 85,
    relaxation: 60,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });
  assert.strictEqual(state.overlayOpacity, 0);
  assert.strictEqual(state.audioVolume, 0);
  assert.strictEqual(state.isDimmingActive, false);
});
