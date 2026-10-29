import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';
import { TauriIPCMock } from '../harness/ipcMock.ts';
import { SyntheticEEGGenerator } from '../fixtures/eegGenerator.ts';

test('Tier 3 - Mode Switching: switching device source from simulator to bluetooth updates status', async () => {
  const ipc = new TauriIPCMock();
  let status = await ipc.invoke('get_device_status');
  assert.strictEqual(status.deviceSource, 'simulator');
  assert.strictEqual(status.deviceName, 'BrainBit Headband (Simulated)');

  const switchRes = await ipc.invoke('set_device_source', { source: 'bluetooth' });
  assert.strictEqual(switchRes.success, true);
  assert.strictEqual(switchRes.source, 'bluetooth');

  status = await ipc.invoke('get_device_status');
  assert.strictEqual(status.deviceSource, 'bluetooth');
  assert.strictEqual(status.deviceName, 'BrainBit-BLE-7A4F');
});

test('Tier 3 - Mode Switching: switching device source does not wipe accumulated session stats', async () => {
  const engine = new BiofeedbackEngine({ threshold: 60 });
  const ipc = new TauriIPCMock();
  const gen = new SyntheticEEGGenerator();

  // Stream 1.0 second of simulator data (250 frames)
  const simFrames = gen.generateBatch(1.0, 'high_focus');
  for (const f of simFrames) {
    engine.processTelemetry(f);
  }

  const preStats = engine.getSessionStats();
  assert.strictEqual(preStats.durationSeconds, 1.0);
  assert.ok(preStats.timeInFocusSeconds > 0.9);

  // Switch to bluetooth
  await ipc.invoke('set_device_source', { source: 'bluetooth' });
  engine.updateSettings({ deviceSource: 'bluetooth' });

  // Stream another 1.0 second of data
  const bleFrames = gen.generateBatch(1.0, 'high_focus');
  for (const f of bleFrames) {
    engine.processTelemetry(f);
  }

  const postStats = engine.getSessionStats();
  assert.strictEqual(postStats.durationSeconds, 2.0, 'Session duration should accumulate seamlessly to 2.0s');
});

test('Tier 3 - Mode Switching: switching training mode preserves active session duration and distraction count', () => {
  const engine = new BiofeedbackEngine({ mode: 'concentration', threshold: 60, sensitivitySeconds: 0.001 });

  // 1 frame high focus
  engine.processTelemetry({
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: 90,
    relaxation: 30,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });

  // 1 frame distracted -> triggers distraction event
  engine.processTelemetry({
    timestamp: Date.now() + 4,
    rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    concentration: 30,
    relaxation: 30,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  });

  assert.strictEqual(engine.getSessionStats().distractionEventsCount, 1);

  // Switch mode to relaxation
  engine.updateSettings({ mode: 'relaxation' });

  // Distraction count and elapsed duration must persist
  const statsAfterSwitch = engine.getSessionStats();
  assert.strictEqual(statsAfterSwitch.distractionEventsCount, 1);
  assert.strictEqual(statsAfterSwitch.durationSeconds, 0.01);
});
