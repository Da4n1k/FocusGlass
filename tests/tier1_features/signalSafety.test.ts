import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../../src/services/biofeedbackEngine.ts';
import { SimulationEngine, LIVE_SIGNAL_TIMEOUT_MS } from '../../src/services/simulationEngine.ts';
import type { EEGTelemetry, BiofeedbackFeedbackState } from '../../src/services/eegTypes.ts';

const frame = (changes: Partial<EEGTelemetry> = {}): EEGTelemetry => ({
  timestamp: 1,
  rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 },
  concentration: 10,
  relaxation: 90,
  signalQuality: { t3: true, t4: true, o1: true, o2: true },
  resistanceKOhm: { t3: 100, t4: 100, o1: 100, o2: 100 },
  spectrum: { alpha: 1, beta: 1, theta: 1 },
  isArtifact: false,
  ...changes,
});

const engine = () => new BiofeedbackEngine({
  threshold: 60, sensitivitySeconds: 1, audioFeedbackEnabled: true,
});

function assertClear(state: Readonly<BiofeedbackFeedbackState>) {
  assert.equal(state.overlayOpacity, 0);
  assert.equal(state.blurRadius, 0);
  assert.equal(state.audioVolume, 0);
  assert.equal(state.isDimmingActive, false);
  assert.equal(state.isContactOk, false);
}

test('Signal safety: contact loss overrides an artifact hold and clears smoothing', () => {
  const b = engine();
  for (let i = 0; i < 250; i++) b.processTelemetry(frame());
  assert.ok(b.getLastState().overlayOpacity > 0);
  const before = b.getSessionStats();
  assertClear(b.processTelemetry(frame({
    isArtifact: true,
    signalQuality: { t3: true, t4: true, o1: false, o2: true },
  })));
  assert.deepEqual(b.getSessionStats(), before);
  const recovered = b.processTelemetry(frame({ concentration: 100 }));
  assert.equal(recovered.overlayOpacity, 0, 'pre-loss low scores must not survive recovery');
});

for (const concentration of [NaN, Infinity, -1, 101]) {
  test(`Signal safety: invalid target metric ${concentration} fails open without counting a sample`, () => {
    const b = engine();
    b.processTelemetry(frame());
    const before = b.getSessionStats();
    assertClear(b.processTelemetry(frame({ concentration })));
    assert.deepEqual(b.getSessionStats(), before);
    assert.equal(b.processTelemetry(frame({ concentration: 100 })).overlayOpacity, 0);
  });
}

test('Signal safety: valid-contact artifacts still freeze the previous feedback', () => {
  const b = engine();
  const active = b.processTelemetry(frame());
  const frozen = b.processTelemetry(frame({ isArtifact: true }));
  assert.equal(frozen.overlayOpacity, active.overlayOpacity);
  assert.equal(frozen.isArtifactFrozen, true);
});

test('Signal safety: live timeout uses arrival time, emits once, and leaves statistics/raw EEG unchanged', () => {
  let now = 0;
  const sim = new SimulationEngine(() => now);
  sim.updateSettings({ deviceSource: 'bluetooth', audioFeedbackEnabled: true });
  let notifications = 0;
  let last: BiofeedbackFeedbackState | undefined;
  sim.subscribe((_t, state) => { notifications++; last = state; });
  sim.ingestExternalTelemetry(frame({ timestamp: 9999999999999 }));
  assert.ok(last!.overlayOpacity > 0);
  const before = sim.getSessionStats();
  const rawCount = sim.getRawBuffer().length;
  now = LIVE_SIGNAL_TIMEOUT_MS - 1;
  assert.equal(sim.checkLiveSignal(), false);
  now++;
  assert.equal(sim.checkLiveSignal(), true);
  assertClear(last!);
  assert.equal(sim.checkLiveSignal(), false);
  assert.equal(notifications, 2);
  assert.deepEqual(sim.getSessionStats(), before);
  assert.equal(sim.getRawBuffer().length, rawCount);
  sim.ingestExternalTelemetry(frame({ concentration: 100 }));
  assert.equal(last!.overlayOpacity, 0);
  now += LIVE_SIGNAL_TIMEOUT_MS;
  assert.equal(sim.checkLiveSignal(), true, 'a fresh arrival rearms the watchdog');
});

test('Signal safety: raw batch arrival arms timeout, empty batches do not keep it alive', () => {
  let now = 0;
  const sim = new SimulationEngine(() => now);
  sim.updateSettings({ deviceSource: 'bluetooth' });
  sim.ingestRawBrainBitBatch([{ timestamp: 0, rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 } }]);
  now = LIVE_SIGNAL_TIMEOUT_MS;
  sim.ingestRawBrainBitBatch([]);
  assert.equal(sim.checkLiveSignal(), true);
});

test('Signal safety: simulator, fit check and playback are not treated as stalled live EEG', () => {
  let now = 0;
  const sim = new SimulationEngine(() => now);
  sim.ingestExternalTelemetry(frame());
  now += LIVE_SIGNAL_TIMEOUT_MS;
  assert.equal(sim.checkLiveSignal(), false);
  sim.updateSettings({ deviceSource: 'bluetooth' });
  assert.equal(sim.checkLiveSignal(), false, 'source switch must not inherit simulator arrival');
  sim.ingestExternalTelemetry(frame());
  sim.setRecordingPlaybackActive(true);
  now += LIVE_SIGNAL_TIMEOUT_MS;
  assert.equal(sim.checkLiveSignal(), false);
  sim.setRecordingPlaybackActive(false);
  assert.equal(sim.checkLiveSignal(), false, 'ending playback waits for a new live packet');
  sim.ingestExternalTelemetry(frame());
  sim.applyBrainBitResistUpdate({ timestamp: 1,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    resistanceKOhm: { t3: 100, t4: 100, o1: 100, o2: 100 },
  });
  now += LIVE_SIGNAL_TIMEOUT_MS;
  assert.equal(sim.checkLiveSignal(), false);
});

test('Signal safety: running timer checks live stream freshness even while simulator is paused', () => {
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  let tick: (() => void) | undefined;
  let now = 0;
  globalThis.setInterval = ((callback: () => void) => { tick = callback; return 1; }) as typeof setInterval;
  globalThis.clearInterval = (() => {}) as typeof clearInterval;
  const sim = new SimulationEngine(() => now);
  try {
    sim.start({ deviceSource: 'bluetooth' });
    sim.togglePause();
    let last: BiofeedbackFeedbackState | undefined;
    sim.subscribe((_t, state) => { last = state; });
    sim.ingestExternalTelemetry(frame());
    now = LIVE_SIGNAL_TIMEOUT_MS;
    assert.ok(tick);
    tick();
    assertClear(last!);
  } finally {
    sim.stop();
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
  }
});
