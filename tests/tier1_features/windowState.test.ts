import test from 'node:test';
import assert from 'node:assert/strict';
import { useFocusStore } from '../../src/stores/useFocusStore.ts';
import { simulationEngine } from '../../src/services/simulationEngine.ts';
import { tauriBridge } from '../../src/services/tauriBridge.ts';

type BridgeReply = Promise<boolean | null>;

test.after(() => {
  simulationEngine.stop();
});

test.beforeEach(() => {
  useFocusStore.setState({ isClickThrough: false, isAlwaysOnTop: true });
});

/** Replaces one bridge method for the duration of `body`, restoring it afterwards. */
async function withBridge(
  method: 'setClickThrough' | 'toggleAlwaysOnTop',
  reply: (enabled: boolean) => BridgeReply,
  body: () => Promise<void>
): Promise<void> {
  const original = tauriBridge[method];
  tauriBridge[method] = reply;
  try {
    await body();
  } finally {
    tauriBridge[method] = original;
  }
}

test('Window state: click-through is NOT mirrored in the store when the native call fails', async () => {
  await withBridge('setClickThrough', async () => null, async () => {
    await useFocusStore.getState().setClickThrough(true);
    assert.strictEqual(useFocusStore.getState().isClickThrough, false);

    await useFocusStore.getState().toggleClickThrough();
    assert.strictEqual(useFocusStore.getState().isClickThrough, false);
  });
});

test('Window state: click-through follows the state the native window reports', async () => {
  await withBridge('setClickThrough', async (enabled) => enabled, async () => {
    await useFocusStore.getState().toggleClickThrough();
    assert.strictEqual(useFocusStore.getState().isClickThrough, true);

    await useFocusStore.getState().toggleClickThrough();
    assert.strictEqual(useFocusStore.getState().isClickThrough, false);
  });
});

test('Window state: always-on-top keeps its previous value when the native call fails', async () => {
  await withBridge('toggleAlwaysOnTop', async () => null, async () => {
    await useFocusStore.getState().toggleAlwaysOnTop();
    assert.strictEqual(useFocusStore.getState().isAlwaysOnTop, true);
  });

  await withBridge('toggleAlwaysOnTop', async (enabled) => enabled, async () => {
    await useFocusStore.getState().toggleAlwaysOnTop();
    assert.strictEqual(useFocusStore.getState().isAlwaysOnTop, false);
  });
});

test('Window state: opening settings releases click-through only through the native call', async () => {
  const requested: boolean[] = [];
  await withBridge(
    'setClickThrough',
    async (enabled) => {
      requested.push(enabled);
      return enabled;
    },
    async () => {
      useFocusStore.setState({ isClickThrough: true });
      useFocusStore.getState().setIsSettingsOpen(true);
      // let the fire-and-forget promise settle
      await new Promise((resolve) => setImmediate(resolve));

      assert.deepStrictEqual(requested, [false]);
      assert.strictEqual(useFocusStore.getState().isSettingsOpen, true);
      assert.strictEqual(useFocusStore.getState().isClickThrough, false);
      useFocusStore.getState().setIsSettingsOpen(false);
    }
  );
});
