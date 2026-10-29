import test from 'node:test';
import assert from 'node:assert/strict';
import { TauriIPCMock } from '../harness/ipcMock.ts';

test('Tier 1 - Click-Through: set_click_through(true) enables cursor event pass-through', async () => {
  const ipc = new TauriIPCMock();
  assert.strictEqual(ipc.isClickThrough(), false, 'Default should be interactive');

  const result = await ipc.invoke('set_click_through', { enabled: true });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.clickThrough, true);
  assert.strictEqual(ipc.isClickThrough(), true, 'Overlay should now be pass-through');
});

test('Tier 1 - Click-Through: set_click_through(false) re-enables HUD interaction', async () => {
  const ipc = new TauriIPCMock();
  await ipc.invoke('set_click_through', { enabled: true });
  assert.strictEqual(ipc.isClickThrough(), true);

  const result = await ipc.invoke('set_click_through', { enabled: false });
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.clickThrough, false);
  assert.strictEqual(ipc.isClickThrough(), false, 'Overlay should capture mouse clicks');
});

test('Tier 1 - Click-Through: toggling maintains chronological call history', async () => {
  const ipc = new TauriIPCMock();

  await ipc.invoke('set_click_through', { enabled: true });
  await ipc.invoke('set_click_through', { enabled: false });
  await ipc.invoke('set_click_through', { enabled: true });

  const calls = ipc.getCallsFor('set_click_through');
  assert.strictEqual(calls.length, 3);
  assert.strictEqual(calls[0].args.enabled, true);
  assert.strictEqual(calls[1].args.enabled, false);
  assert.strictEqual(calls[2].args.enabled, true);
});

test('Tier 1 - Click-Through: idempotent calls remain stable and return identical state', async () => {
  const ipc = new TauriIPCMock();

  for (let i = 0; i < 5; i++) {
    const res = await ipc.invoke('set_click_through', { enabled: true });
    assert.strictEqual(res.clickThrough, true);
    assert.strictEqual(ipc.isClickThrough(), true);
  }
});

test('Tier 1 - Click-Through: querying get_device_status while in click-through returns valid status', async () => {
  const ipc = new TauriIPCMock({ batteryPercentage: 88, connected: true });
  await ipc.invoke('set_click_through', { enabled: true });

  const status = await ipc.invoke('get_device_status');
  assert.strictEqual(status.connected, true);
  assert.strictEqual(status.batteryPercentage, 88);
  assert.strictEqual(status.samplingRateHz, 250);
});
