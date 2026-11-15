import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OverlayVisibility,
  StatePublisher,
  buildSnapshotInput,
  type PublisherState,
  type SnapshotInput,
} from '../../src/services/overlaySync.ts';
import { SnapshotReceiver, type SyncSnapshot } from '../../src/services/windowSync.ts';

function state(overrides: Partial<PublisherState> = {}): PublisherState {
  return {
    feedbackState: {
      currentMetric: 40,
      smoothedMetric: 42,
      deficit: 0.3,
      overlayOpacity: 0.4,
      blurRadius: 5,
      audioVolume: 0,
      isDimmingActive: true,
      isContactOk: true,
      isArtifactFrozen: false,
    },
    settings: { mode: 'concentration', deviceSource: 'simulator', threshold: 60 },
    deviceStatus: { connected: true },
    telemetry: null,
    isPaused: false,
    activePreset: 'attention_drift',
    ...overrides,
  };
}

function clear(s: PublisherState): PublisherState {
  return {
    ...s,
    feedbackState: { ...s.feedbackState, overlayOpacity: 0, isDimmingActive: false },
  };
}

interface Harness {
  publisher: StatePublisher;
  emitted: SyncSnapshot[];
  visibleCalls: boolean[];
  setState(next: PublisherState): void;
  setNow(ms: number): void;
  setNativeOk(ok: boolean): void;
}

function harness(initial: PublisherState = state()): Harness {
  let current = initial;
  let now = 0;
  let nativeOk = true;
  const emitted: SyncSnapshot[] = [];
  const visibleCalls: boolean[] = [];
  const publisher = new StatePublisher(
    {
      read: (): SnapshotInput => buildSnapshotInput(current),
      emit: (snapshot) => emitted.push(snapshot),
      setOverlayVisible: async (visible) => {
        visibleCalls.push(visible);
        return nativeOk;
      },
      now: () => now,
    },
    { startSeq: 100, minIntervalMs: 50, holdMs: 800 }
  );
  return {
    publisher,
    emitted,
    visibleCalls,
    setState: (next) => {
      current = next;
    },
    setNow: (ms) => {
      now = ms;
    },
    setNativeOk: (ok) => {
      nativeOk = ok;
    },
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('Overlay snapshot: streamActive is true for the simulator and for a connected device only', () => {
  assert.strictEqual(buildSnapshotInput(state()).streamActive, true);

  const bleDown = state({
    settings: { mode: 'concentration', deviceSource: 'bluetooth', threshold: 60 },
    deviceStatus: { connected: false },
  });
  assert.strictEqual(buildSnapshotInput(bleDown).streamActive, false);

  const bleUp = { ...bleDown, deviceStatus: { connected: true } };
  assert.strictEqual(buildSnapshotInput(bleUp).streamActive, true);
});

test('Overlay snapshot: electrode quality defaults to all-good until telemetry arrives, then follows it', () => {
  assert.deepStrictEqual(buildSnapshotInput(state()).signalQuality, {
    t3: true,
    t4: true,
    o1: true,
    o2: true,
  });

  const withTelemetry = state({
    telemetry: { signalQuality: { t3: true, t4: false, o1: true, o2: true } },
  });
  assert.strictEqual(buildSnapshotInput(withTelemetry).signalQuality.t4, false);
});

test('Overlay visibility: shows immediately, hides only after the fade-out has been invisible for the hold time', () => {
  const v = new OverlayVisibility(800);
  assert.strictEqual(v.update(0, 0), null, 'nothing to hide while hidden');
  assert.strictEqual(v.update(0.3, 10), 'show');
  assert.strictEqual(v.update(0.4, 20), null, 'already visible');

  assert.strictEqual(v.update(0, 100), null, 'fade just ended: start the hold timer');
  assert.strictEqual(v.update(0, 899), null, 'still inside the hold time');
  assert.strictEqual(v.update(0, 900), 'hide');
  assert.strictEqual(v.update(0, 2000), null, 'stays hidden');
});

test('Overlay visibility: dimming returning during the hold time cancels the hide', () => {
  const v = new OverlayVisibility(800);
  v.update(0.5, 0);
  v.update(0, 100);
  assert.strictEqual(v.update(0.5, 500), null, 'still visible, no second show');
  assert.strictEqual(v.update(0, 600), null, 'hold timer restarts from here');
  assert.strictEqual(v.update(0, 1399), null);
  assert.strictEqual(v.update(0, 1400), 'hide');
});

test('Overlay visibility: a failed native call is retried on the next update', () => {
  const v = new OverlayVisibility(800);
  assert.strictEqual(v.update(0.5, 0), 'show');
  v.markFailed('show');
  assert.strictEqual(v.update(0.5, 10), 'show', 'show must be retried');

  v.update(0, 20);
  assert.strictEqual(v.update(0, 820), 'hide');
  v.markFailed('hide');
  assert.strictEqual(v.update(0, 830), null, 'hold timer restarts after a failed hide');
  assert.strictEqual(v.update(0, 1630), 'hide', 'hide is retried');
});

test('Publisher: first publish emits a snapshot that survives validation, sequence numbers only grow', () => {
  const h = harness();
  h.publisher.publish();
  assert.strictEqual(h.emitted.length, 1);

  const receiver = new SnapshotReceiver();
  assert.ok(receiver.accept(JSON.parse(JSON.stringify(h.emitted[0]))), 'must pass strict validation');

  h.setNow(60);
  h.publisher.publish();
  h.setNow(120);
  h.publisher.publish();
  const seqs = h.emitted.map((s) => s.seq);
  assert.deepStrictEqual([...seqs].sort((a, b) => a - b), seqs);
  assert.strictEqual(new Set(seqs).size, seqs.length);
});

test('Publisher: engine ticks are rate limited, and tick() delivers the newest held-back state', () => {
  const h = harness();
  h.publisher.publish();
  for (let t = 5; t < 50; t += 5) {
    h.setNow(t);
    h.publisher.publish();
  }
  assert.strictEqual(h.emitted.length, 1, 'everything inside 50 ms is held back');

  h.setNow(55);
  h.publisher.tick();
  assert.strictEqual(h.emitted.length, 2, 'tick flushes the pending snapshot');
  assert.strictEqual(h.emitted[1].seq, 100 + 10, 'the newest one: publish was called ten times');
});

test('Publisher: shows the overlay when dimming starts and hides it after the hold time, driven by tick()', async () => {
  const h = harness(state());
  h.publisher.publish();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, [true]);

  h.setState(clear(state()));
  h.setNow(100);
  h.publisher.publish();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, [true], 'not hidden yet: the fade-out is still on screen');

  h.setNow(500);
  h.publisher.tick();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, [true]);

  h.setNow(950);
  h.publisher.tick();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, [true, false], 'the timer alone hides it, no new engine data needed');
});

test('Publisher: no live stream means no window is ever shown, even when the engine reports dimming', async () => {
  const h = harness(
    state({
      settings: { mode: 'concentration', deviceSource: 'bluetooth', threshold: 60 },
      deviceStatus: { connected: false },
    })
  );
  h.publisher.publish();
  h.setNow(100);
  h.publisher.tick();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, []);
});

test('Publisher: a failed native show is retried instead of leaving the screen undimmed', async () => {
  const h = harness();
  h.setNativeOk(false);
  h.publisher.publish();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, [true]);

  h.setNativeOk(true);
  h.setNow(60);
  h.publisher.tick();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, [true, true], 'second attempt on the next tick');

  h.setNow(120);
  h.publisher.tick();
  await settle();
  assert.deepStrictEqual(h.visibleCalls, [true, true], 'and no third once it succeeded');
});

test('Publisher: resend() replays the latest state for a window that just opened', () => {
  const h = harness();
  h.publisher.resend();
  assert.strictEqual(h.emitted.length, 0, 'nothing to replay before the first publish');

  h.publisher.publish();
  h.setNow(10);
  h.publisher.publish();
  const before = h.emitted.length;
  h.publisher.resend();
  assert.strictEqual(h.emitted.length, before + 1);
  assert.strictEqual(h.emitted[h.emitted.length - 1].seq, 102, 'the latest generated snapshot');
});

test('Publisher: a restarted publisher is newer than the previous one, so receivers need no reset', () => {
  const receiver = new SnapshotReceiver();
  const first: SyncSnapshot[] = [];
  const second: SyncSnapshot[] = [];
  let clock = 0;
  const make = (sink: SyncSnapshot[], startSeq: number) =>
    new StatePublisher(
      {
        read: () => buildSnapshotInput(state()),
        emit: (s) => sink.push(s),
        setOverlayVisible: async () => true,
        now: () => clock,
      },
      { startSeq }
    );

  // The engine ticks at ~62 Hz for ten seconds, then the page reloads one second later.
  const startedAt = 1_000_000;
  const old = make(first, startedAt);
  for (let i = 0; i < 620; i++) {
    clock += 16;
    old.publish();
  }
  assert.ok(first.length > 100, 'the old publisher streamed for a while');
  for (const snapshot of first) assert.ok(receiver.accept(snapshot));

  const reloaded = make(second, startedAt + 11_000);
  reloaded.publish();
  assert.ok(receiver.accept(second[0]), 'the reloaded publisher must not be dropped as stale');
});
