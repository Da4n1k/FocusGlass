import test from 'node:test';
import assert from 'node:assert/strict';
import { SimulationEngine, simulationEngine } from '../../src/services/simulationEngine.ts';
import { BiofeedbackEngine } from '../../src/services/biofeedbackEngine.ts';
import { useFocusStore } from '../../src/stores/useFocusStore.ts';
import type { BiofeedbackFeedbackState, EEGTelemetry } from '../../src/services/eegTypes.ts';

test.after(() => {
  simulationEngine.stop();
});

test('Live Engine: updating threshold, maxOpacity, blurRadius, and audio dynamically changes emitted feedback', () => {
  const sim = new SimulationEngine();
  sim.setPreset('attention_drift'); // ~42% concentration
  sim.updateSettings({
    mode: 'concentration',
    threshold: 60,
    sensitivitySeconds: 0.02,
    dimmingMaxOpacity: 0.8,
    blurRadius: 20,
    audioFeedbackEnabled: false,
  });

  let emittedState: BiofeedbackFeedbackState | null = null;
  const unsub = sim.subscribe((_t, state) => {
    emittedState = state;
  });

  sim.stepSamples(10);
  assert.ok(emittedState !== null);
  assert.ok((emittedState as BiofeedbackFeedbackState).overlayOpacity > 0.15, 'Should dim when preset ~42% < threshold 60%');
  assert.strictEqual((emittedState as BiofeedbackFeedbackState).audioVolume, 0);

  // Lower threshold below 42% -> dimming must clear immediately on next samples
  sim.updateSettings({ threshold: 30 });
  sim.stepSamples(10);
  assert.strictEqual((emittedState as BiofeedbackFeedbackState).overlayOpacity, 0, 'Lowering threshold to 30% must clear dimming');

  // Raise threshold to 80% and enable audio -> both dimming and audioVolume must engage
  sim.updateSettings({ threshold: 80, dimmingMaxOpacity: 0.5, blurRadius: 10, audioFeedbackEnabled: true });
  sim.stepSamples(10);
  assert.ok((emittedState as BiofeedbackFeedbackState).overlayOpacity > 0.2);
  assert.ok((emittedState as BiofeedbackFeedbackState).overlayOpacity <= 0.5);
  assert.ok((emittedState as BiofeedbackFeedbackState).blurRadius > 4);
  assert.ok((emittedState as BiofeedbackFeedbackState).audioVolume > 0.4);

  unsub();
});

test('Live Engine: switching training mode clears smoothing buffer and evaluates target rhythm', () => {
  const sim = new SimulationEngine();
  // meditation preset: concentration ~35%, relaxation ~94%
  sim.setPreset('meditation');
  sim.updateSettings({
    mode: 'concentration',
    threshold: 70,
    sensitivitySeconds: 2.0, // large 500-sample smoothing buffer
  });

  // Fill buffer in concentration mode -> concentration ~35% < 70% -> dimmed
  const focusState = sim.stepSamples(250);
  assert.ok(focusState.overlayOpacity > 0.25, 'Meditation preset has low beta concentration -> dims in Focus mode');

  // Switch to relaxation mode -> relaxation ~94% >= 70% -> buffer cleared, immediately clears screen
  sim.updateSettings({ mode: 'relaxation' });
  const calmState = sim.stepSamples(4);
  assert.strictEqual(calmState.overlayOpacity, 0, 'Meditation preset has high alpha relaxation -> clear in Calm mode');
  assert.ok(calmState.smoothedMetric > 85);
});

test('Live Engine: electrode contact loss pauses optical dimming and emits realistic dry kOhm resistance', () => {
  const sim = new SimulationEngine();
  sim.setPreset('distracted'); // ~22% concentration
  sim.updateSettings({ mode: 'concentration', threshold: 65, sensitivitySeconds: 0.05 });

  let lastTelemetry: EEGTelemetry | null = null;
  const unsub = sim.subscribe((t) => {
    lastTelemetry = t;
  });

  const activeDimState = sim.stepSamples(20);
  assert.ok(activeDimState.overlayOpacity > 0.3);
  assert.strictEqual(activeDimState.isContactOk, true);
  assert.ok(
    (lastTelemetry as EEGTelemetry | null)?.resistanceKOhm?.o1 !== null &&
      ((lastTelemetry as EEGTelemetry).resistanceKOhm?.o1 ?? 0) >= 90,
    'Connected dry electrode resistance should be in realistic ~100-150 kOhm range'
  );

  // Detach O1 occipital electrode -> adaptation pauses, screen clears so user is not blinded
  sim.setElectrodeQuality('o1', false);
  const preDistractions = sim.getSessionStats().distractionEventsCount;
  const lostState = sim.stepSamples(20);

  assert.strictEqual(lostState.isContactOk, false);
  assert.strictEqual(lostState.overlayOpacity, 0, 'Detached sensor must not darken user screen');
  assert.strictEqual((lastTelemetry as EEGTelemetry).resistanceKOhm?.o1, null, 'Detached sensor resistance is open-circuit null');
  assert.strictEqual(
    sim.getSessionStats().distractionEventsCount,
    preDistractions,
    'Detached sensor noise must not increment distraction count'
  );

  unsub();
});

test('Live Engine: injectArtifact creates a multi-tick 240ms burst that freezes opacity across ticks', () => {
  const sim = new SimulationEngine();
  sim.setPreset('high_focus');
  sim.updateSettings({ threshold: 60, sensitivitySeconds: 0.5 });
  sim.stepSamples(50);

  // Trigger default 60-sample (240ms) artifact burst and switch preset to distracted during burst
  sim.injectArtifact(60);
  sim.setPreset('distracted');

  // Tick 1 (4 samples), Tick 2 (4 samples), Tick 3 (4 samples) -> all inside the 60-sample burst
  const tick1 = sim.stepSamples(4);
  const tick2 = sim.stepSamples(4);
  const tick3 = sim.stepSamples(4);

  assert.strictEqual(tick1.isArtifactFrozen, true, 'Tick 1 must report isArtifactFrozen = true');
  assert.strictEqual(tick2.isArtifactFrozen, true, 'Tick 2 must still be inside 240ms artifact window');
  assert.strictEqual(tick3.isArtifactFrozen, true, 'Tick 3 must still be inside 240ms artifact window');
  assert.strictEqual(tick3.overlayOpacity, 0, 'Opacity remains frozen at pre-artifact level');
});

test('Live Engine: switching source to bluetooth clears synthetic buffer and accepts external BrainBit packets', () => {
  const sim = new SimulationEngine();
  sim.setPreset('attention_drift');
  sim.stepSamples(20);
  assert.ok(sim.getRawBuffer().length > 0);

  sim.updateSettings({ deviceSource: 'bluetooth', threshold: 60, sensitivitySeconds: 0.01 });
  assert.strictEqual(sim.getRawBuffer().length, 0, 'Synthetic buffer cleared upon switching to BLE');

  const externalState = sim.ingestExternalTelemetry({
    timestamp: Date.now(),
    rawChannels: { t3: 14.2, t4: 15.1, o1: 22.4, o2: 21.8 },
    concentration: 30,
    relaxation: 65,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    resistanceKOhm: { t3: 180, t4: 195, o1: 140, o2: 150 },
    isArtifact: false,
  });

  assert.strictEqual(sim.getRawBuffer().length, 1);
  assert.strictEqual(externalState.deficit, 0.5);
  assert.ok(externalState.overlayOpacity > 0);
});

test('Calibration: mode-aware baseline computes relaxation threshold and excludes detached-sensor frames', () => {
  const cleanRelaxFrames: EEGTelemetry[] = Array.from({ length: 100 }, (_, i) => ({
    timestamp: 1000 + i * 4,
    rawChannels: { t3: 10, t4: 10, o1: 30, o2: 30 },
    concentration: 35,
    relaxation: 82,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  }));

  // Add frames with detached electrode (isArtifact = false, but o2 = false) with bogus 0 values
  const detachedFrames: EEGTelemetry[] = Array.from({ length: 50 }, (_, i) => ({
    timestamp: 2000 + i * 4,
    rawChannels: { t3: 95, t4: 95, o1: 95, o2: 95 },
    concentration: 0,
    relaxation: 0,
    signalQuality: { t3: true, t4: true, o1: true, o2: false },
    isArtifact: false,
  }));

  const res = BiofeedbackEngine.calibrateBaseline(
    [...cleanRelaxFrames, ...detachedFrames],
    'relaxation'
  );

  assert.strictEqual(res.sampleCount, 100, 'Detached-electrode frames must be excluded');
  assert.strictEqual(res.baselineFocus, 35);
  assert.strictEqual(res.baselineRelaxation, 82);
  assert.strictEqual(res.recommendedThreshold, 82, 'Relaxation mode threshold must be based on relaxation baseline');
});

test('Store Integration: useFocusStore propagates settings to live engine and reports honest BLE status', async () => {
  simulationEngine.stop();
  const store = useFocusStore;

  store.getState().setPreset('attention_drift'); // ~42%
  store.getState().updateSettings({
    deviceSource: 'simulator',
    mode: 'concentration',
    threshold: 65,
    sensitivitySeconds: 0.02,
    dimmingMaxOpacity: 0.75,
  });

  simulationEngine.stepSamples(12);
  assert.ok(store.getState().feedbackState.overlayOpacity > 0.2, 'Store reflects active dimming');

  // Lower threshold via store -> must update live engine state
  store.getState().updateSettings({ threshold: 25 });
  simulationEngine.stepSamples(12);
  assert.strictEqual(store.getState().feedbackState.overlayOpacity, 0, 'Store threshold update reached engine');

  // Switch to bluetooth without hardware -> deviceStatus must report connected = false
  store.getState().updateSettings({ deviceSource: 'bluetooth' });
  await new Promise((r) => setTimeout(r, 15));
  assert.strictEqual(store.getState().deviceStatus.deviceSource, 'bluetooth');
  assert.strictEqual(store.getState().deviceStatus.connected, false, 'Unlinked BLE must not fake connected=true');
  assert.strictEqual(store.getState().feedbackState.overlayOpacity, 0, 'Overlay cleared when BLE disconnected');

  // Return to simulator and verify session reset
  store.getState().updateSettings({ deviceSource: 'simulator' });
  simulationEngine.stepSamples(250);
  assert.ok(store.getState().sessionStats.durationSeconds >= 0.9);
  store.getState().resetSession(false);
  assert.strictEqual(store.getState().sessionStats.durationSeconds, 0);
});
