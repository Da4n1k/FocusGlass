import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SnapshotReceiver,
  SnapshotThrottle,
  effectiveDimming,
  isSyncSnapshot,
  parseSyncCommand,
  type SyncSnapshot,
} from '../../src/services/windowSync.ts';

function snapshot(seq: number, overrides: Partial<SyncSnapshot> = {}): SyncSnapshot {
  return {
    seq,
    feedback: {
      currentMetric: 40,
      smoothedMetric: 42,
      deficit: 0.3,
      overlayOpacity: 0.21,
      blurRadius: 4.8,
      audioVolume: 0,
      isDimmingActive: true,
      isContactOk: true,
      isArtifactFrozen: false,
    },
    mode: 'concentration',
    deviceSource: 'simulator',
    threshold: 60,
    streamActive: true,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isPaused: false,
    activePreset: 'attention_drift',
    ...overrides,
  };
}

test('Sync: a well-formed snapshot passes validation and survives a JSON round trip', () => {
  const original = snapshot(7);
  assert.strictEqual(isSyncSnapshot(original), true);
  assert.strictEqual(isSyncSnapshot(JSON.parse(JSON.stringify(original))), true);
});

test('Sync: malformed snapshots are rejected (wrong types, NaN, out-of-range opacity, unknown enums)', () => {
  const good = snapshot(1);
  const bad: unknown[] = [
    null,
    'x',
    [],
    {},
    { ...good, seq: NaN },
    { ...good, seq: '1' },
    { ...good, mode: 'turbo' },
    { ...good, deviceSource: 'usb' },
    { ...good, activePreset: 'nope' },
    { ...good, threshold: Infinity },
    { ...good, feedback: { ...good.feedback, overlayOpacity: 1.5 } },
    { ...good, feedback: { ...good.feedback, overlayOpacity: -0.1 } },
    { ...good, feedback: { ...good.feedback, blurRadius: -1 } },
    { ...good, feedback: { ...good.feedback, isDimmingActive: 'yes' } },
    { ...good, feedback: null },
    { ...good, signalQuality: { t3: true, t4: true, o1: true } },
  ];
  for (const candidate of bad) {
    assert.strictEqual(isSyncSnapshot(candidate), false, JSON.stringify(candidate));
  }
});

test('Sync: commands are whitelisted and their payloads validated', () => {
  assert.deepStrictEqual(parseSyncCommand({ type: 'togglePause' }), { type: 'togglePause' });
  assert.deepStrictEqual(parseSyncCommand({ type: 'openDashboard', junk: 1 }), {
    type: 'openDashboard',
  });
  assert.deepStrictEqual(parseSyncCommand({ type: 'setPreset', preset: 'high_focus' }), {
    type: 'setPreset',
    preset: 'high_focus',
  });

  for (const bad of [
    null,
    42,
    {},
    { type: 42 },
    { type: 'rm -rf' },
    { type: 'setPreset' },
    { type: 'setPreset', preset: 'turbo' },
    { type: 'setPreset', preset: '__proto__' },
    { type: 'toString' },
  ]) {
    assert.strictEqual(parseSyncCommand(bad), null, JSON.stringify(bad));
  }
});

test('Sync: effectiveDimming shows nothing without a live stream or contact, otherwise the engine values', () => {
  assert.deepStrictEqual(effectiveDimming(snapshot(1)), { opacity: 0.21, blurPx: 4.8 });

  assert.deepStrictEqual(effectiveDimming(snapshot(2, { streamActive: false })), {
    opacity: 0,
    blurPx: 0,
  });

  const noContact = snapshot(3);
  noContact.feedback = { ...noContact.feedback, isContactOk: false };
  assert.deepStrictEqual(effectiveDimming(noContact), { opacity: 0, blurPx: 0 });

  const notDimming = snapshot(4);
  notDimming.feedback = { ...notDimming.feedback, isDimmingActive: false };
  assert.deepStrictEqual(effectiveDimming(notDimming), { opacity: 0, blurPx: 0 });
});

test('Sync: throttle caps the rate but always lets the first snapshot through', () => {
  const throttle = new SnapshotThrottle(50);
  assert.ok(throttle.offer(snapshot(1), 0), 'first snapshot must be emitted');
  assert.strictEqual(throttle.offer(snapshot(2), 10), null);
  assert.strictEqual(throttle.offer(snapshot(3), 49), null);
  assert.strictEqual(throttle.offer(snapshot(4), 50)?.seq, 4);
});

test('Sync: a flag change bypasses the rate limit so dimming never lags behind', () => {
  const throttle = new SnapshotThrottle(50);
  throttle.offer(snapshot(1), 0);

  const cleared = snapshot(2);
  cleared.feedback = { ...cleared.feedback, isDimmingActive: false, overlayOpacity: 0 };
  assert.strictEqual(throttle.offer(cleared, 5)?.seq, 2, 'dimming off must go out immediately');

  assert.strictEqual(throttle.offer(snapshot(3, { isPaused: true }), 6)?.seq, 3);
  assert.strictEqual(throttle.offer(snapshot(4, { threshold: 70, isPaused: true }), 7)?.seq, 4);
});

test('Sync: the newest held-back snapshot is delivered by takePending, never lost', () => {
  const throttle = new SnapshotThrottle(50);
  throttle.offer(snapshot(1), 0);
  assert.strictEqual(throttle.offer(snapshot(2), 10), null);
  assert.strictEqual(throttle.offer(snapshot(3), 20), null);

  assert.strictEqual(throttle.takePending(30)?.seq, 3, 'must be the newest, not the first held back');
  assert.strictEqual(throttle.takePending(31), null, 'nothing pending after delivery');
});

test('Sync: receiver drops stale, duplicate and malformed snapshots, and accepts a restarted publisher after reset', () => {
  const receiver = new SnapshotReceiver();
  assert.strictEqual(receiver.accept(snapshot(5))?.seq, 5);
  assert.strictEqual(receiver.accept(snapshot(5)), null, 'duplicate');
  assert.strictEqual(receiver.accept(snapshot(4)), null, 'reordered');
  assert.strictEqual(receiver.accept({ seq: 99 }), null, 'malformed');
  assert.strictEqual(receiver.accept(snapshot(6))?.seq, 6);

  receiver.reset();
  assert.strictEqual(receiver.accept(snapshot(1))?.seq, 1, 'publisher restarted from zero');
});
