import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHudWindowSize } from '../../src/components/hud/useFitHudWindow.ts';

test('HUD fit: the window is the card plus its margin on both sides', () => {
  // 320 x 223 px card with 20 px edges at 96 dpi.
  assert.deepStrictEqual(computeHudWindowSize(320, 223, 20, 20, 1), { width: 360, height: 263 });
});

test('HUD fit: a card enlarged by a 120 dpi rem is NOT clipped by the window (regression)', () => {
  // Xft.dpi = 120: rem = 20 px, so w-80 = 400 px and top-5 / right-5 = 25 px.
  const size = computeHudWindowSize(400, 279, 25, 25, 1);
  assert.deepStrictEqual(size, { width: 450, height: 329 });
  assert.ok(size.width >= 400, 'window must be at least as wide as the card');
});

test('HUD fit: the size is converted to physical pixels with the device pixel ratio and rounded up', () => {
  assert.deepStrictEqual(computeHudWindowSize(320, 223, 20, 20, 2), { width: 720, height: 526 });
  assert.deepStrictEqual(computeHudWindowSize(320.2, 223.1, 20, 20, 1.25), { width: 451, height: 329 });
});

test('HUD fit: unusable measurements fall back instead of producing NaN or negative sizes', () => {
  for (const dpr of [0, -1, NaN, Infinity]) {
    const size = computeHudWindowSize(320, 223, 20, 20, dpr);
    assert.deepStrictEqual(size, { width: 360, height: 263 }, `dpr ${dpr}`);
  }
  // A computed style that is not a pixel value parses to NaN.
  assert.deepStrictEqual(computeHudWindowSize(320, 223, NaN, NaN, 1), { width: 320, height: 223 });
  assert.deepStrictEqual(computeHudWindowSize(-5, -5, 20, 20, 1), { width: 40, height: 40 });
});
