import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DENSE_BLUR_MIN_PX,
  OverlayVisualStabilizer,
  THRESHOLD_BLUR_OFF_DEFICIT,
  THRESHOLD_BLUR_ON_DEFICIT,
  resolveOverlayVisuals,
} from '../../src/services/overlayVisualPolicy.ts';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/services/settingsSchema.ts';

test('Overlay Visual Policy: fullscreen_dim strictly keeps blur at 0 px (eye-safe baseline TZ)', () => {
  const res = resolveOverlayVisuals({
    visualMode: 'fullscreen_dim',
    canDim: true,
    deficit: 0.85,
    rawOpacity: 0.6,
    maxOpacity: 0.7,
    blurRadiusSetting: 24,
    prevThresholdBlurActive: false,
  });

  assert.strictEqual(res.opacity, 0.6);
  assert.strictEqual(res.blurPx, 0, 'fullscreen_dim must never produce mild squinting blur');
  assert.strictEqual(res.showPauseCard, false);
  assert.strictEqual(res.vignetteBlurMask, false);
});

test('Overlay Visual Policy: vignette_blur enables radial edge mask without center pause card', () => {
  const res = resolveOverlayVisuals({
    visualMode: 'vignette_blur',
    canDim: true,
    deficit: 0.5,
    rawOpacity: 0.35,
    maxOpacity: 0.7,
    blurRadiusSetting: 20,
    prevThresholdBlurActive: false,
  });

  assert.strictEqual(res.opacity, 0.35);
  assert.strictEqual(res.blurPx, 10);
  assert.strictEqual(res.vignetteBlurMask, true);
  assert.strictEqual(res.showPauseCard, false);
});

test('Overlay Visual Policy: threshold_blur avoids half-readable blur and uses hysteresis for dense pause', () => {
  // Mild dip below 45% trigger -> soft dimming only, strictly 0 px blur (no squinting!)
  const mild = resolveOverlayVisuals({
    visualMode: 'threshold_blur',
    canDim: true,
    deficit: THRESHOLD_BLUR_ON_DEFICIT - 0.05,
    rawOpacity: 0.28,
    maxOpacity: 0.7,
    blurRadiusSetting: 16,
    prevThresholdBlurActive: false,
  });
  assert.strictEqual(mild.blurPx, 0);
  assert.strictEqual(mild.thresholdBlurActive, false);
  assert.strictEqual(mild.showPauseCard, false);
  assert.ok(mild.opacity > 0 && mild.opacity < 0.28);

  // Crossing trigger -> jumps directly to unreadable dense blur >= 20 px + pause card
  const triggered = resolveOverlayVisuals({
    visualMode: 'threshold_blur',
    canDim: true,
    deficit: THRESHOLD_BLUR_ON_DEFICIT,
    rawOpacity: 0.32,
    maxOpacity: 0.7,
    blurRadiusSetting: 12,
    prevThresholdBlurActive: false,
  });
  assert.strictEqual(triggered.thresholdBlurActive, true);
  assert.strictEqual(triggered.showPauseCard, true);
  assert.ok(triggered.blurPx >= DENSE_BLUR_MIN_PX);
  assert.ok(triggered.opacity >= 0.68);

  // Inside hysteresis deadband (between 35% and 45%) -> remains active without flicker
  const held = resolveOverlayVisuals({
    visualMode: 'threshold_blur',
    canDim: true,
    deficit: 0.4,
    rawOpacity: 0.28,
    maxOpacity: 0.7,
    blurRadiusSetting: 24,
    prevThresholdBlurActive: true,
  });
  assert.strictEqual(held.thresholdBlurActive, true);
  assert.strictEqual(held.blurPx, 24);

  // Below release threshold (35%) -> cleanly releases back to 0 px blur
  const released = resolveOverlayVisuals({
    visualMode: 'threshold_blur',
    canDim: true,
    deficit: THRESHOLD_BLUR_OFF_DEFICIT - 0.05,
    rawOpacity: 0.21,
    maxOpacity: 0.7,
    blurRadiusSetting: 24,
    prevThresholdBlurActive: true,
  });
  assert.strictEqual(released.thresholdBlurActive, false);
  assert.strictEqual(released.blurPx, 0);
  assert.strictEqual(released.showPauseCard, false);
});

test('Overlay Visual Policy: distractors scales both opacity and optional window blur', () => {
  const withBlur = resolveOverlayVisuals({
    visualMode: 'distractors',
    canDim: true,
    deficit: 0.5,
    rawOpacity: 0.35,
    maxOpacity: 0.7,
    blurRadiusSetting: 16,
    prevThresholdBlurActive: false,
  });
  assert.strictEqual(withBlur.opacity, 0.35);
  assert.strictEqual(withBlur.blurPx, 8);
  assert.strictEqual(withBlur.vignetteBlurMask, false);

  const dimOnly = resolveOverlayVisuals({
    visualMode: 'distractors',
    canDim: true,
    deficit: 0.5,
    rawOpacity: 0.35,
    maxOpacity: 0.7,
    blurRadiusSetting: 0,
    prevThresholdBlurActive: false,
  });
  assert.strictEqual(dimOnly.blurPx, 0);
});

test('Settings: overlayMode and dimmingScope stay synchronized including legacy persisted configs', () => {
  assert.strictEqual(DEFAULT_SETTINGS.overlayMode, 'fullscreen_dim');
  assert.strictEqual(DEFAULT_SETTINGS.dimmingScope, 'fullscreen');

  const fromLegacyDistractors = sanitizeSettings({ dimmingScope: 'distractors' });
  assert.strictEqual(fromLegacyDistractors.overlayMode, 'distractors');
  assert.strictEqual(fromLegacyDistractors.dimmingScope, 'distractors');

  const switchToThreshold = sanitizeSettings(
    { overlayMode: 'threshold_blur' },
    fromLegacyDistractors
  );
  assert.strictEqual(switchToThreshold.overlayMode, 'threshold_blur');
  assert.strictEqual(switchToThreshold.dimmingScope, 'fullscreen');

  const switchBackToDistractors = sanitizeSettings(
    { overlayMode: 'distractors' },
    switchToThreshold
  );
  assert.strictEqual(switchBackToDistractors.overlayMode, 'distractors');
  assert.strictEqual(switchBackToDistractors.dimmingScope, 'distractors');
});

test('Overlay Visual Stabilizer: 10 Hz boundary jitter never flickers «Внимание рассеивается» card', () => {
  const stabilizer = new OverlayVisualStabilizer();
  let transitions = 0;
  let prevShow = false;

  // Alternate rawOpacity 0.30 <-> 0.45 at 10 Hz (every 50 ms) for 6 full seconds
  for (let t = 0; t <= 6000; t += 50) {
    const high = Math.floor(t / 50) % 2 === 0;
    const res = stabilizer.update(
      {
        visualMode: 'fullscreen_dim',
        canDim: true,
        deficit: high ? 0.64 : 0.43,
        rawOpacity: high ? 0.45 : 0.30,
        maxOpacity: 0.7,
        blurRadiusSetting: 16,
      },
      t
    );
    if (res.showCueCard !== prevShow) {
      transitions += 1;
      prevShow = res.showCueCard;
    }
  }

  assert.ok(
    transitions <= 1,
    `Expected at most 1 smooth transition under 10 Hz jitter, got ${transitions}`
  );
});

test('Overlay Visual Stabilizer: flaky dry-electrode contact strobe does not spam cue card or strobe screen', () => {
  const stabilizer = new OverlayVisualStabilizer();
  let maxFrameDelta = 0;
  let prevOpacity = 0;

  // Simulate broken T3/T4 contact flipping true <-> false every 100 ms while focus is low
  for (let t = 0; t <= 6000; t += 50) {
    const contactOk = Math.floor(t / 100) % 2 === 0;
    const res = stabilizer.update(
      {
        visualMode: 'fullscreen_dim',
        canDim: contactOk,
        deficit: contactOk ? 0.75 : 0,
        rawOpacity: contactOk ? 0.52 : 0,
        maxOpacity: 0.7,
        blurRadiusSetting: 16,
      },
      t
    );
    maxFrameDelta = Math.max(maxFrameDelta, Math.abs(res.opacity - prevOpacity));
    prevOpacity = res.opacity;
    assert.strictEqual(
      res.showCueCard,
      false,
      `Broken 50/50 contact strobe must not pop cue card at t=${t}ms`
    );
  }

  assert.ok(
    maxFrameDelta < 0.08,
    `Opacity should smooth out contact strobing instead of jumping wildly (maxDelta=${maxFrameDelta})`
  );
});

test('Overlay Visual Stabilizer: sustained dip shows cue card, ignores brief 250 ms dropout, then hides cleanly on recovery', () => {
  const stabilizer = new OverlayVisualStabilizer();
  let last = stabilizer.update(
    {
      visualMode: 'fullscreen_dim',
      canDim: true,
      deficit: 0.8,
      rawOpacity: 0.56,
      maxOpacity: 0.7,
      blurRadiusSetting: 16,
    },
    0
  );
  assert.strictEqual(last.showCueCard, false, 'Cue card must not pop immediately on frame 0');

  // Step 300 ms: still ramping, card still hidden
  for (let t = 50; t <= 300; t += 50) {
    last = stabilizer.update(
      {
        visualMode: 'fullscreen_dim',
        canDim: true,
        deficit: 0.8,
        rawOpacity: 0.56,
        maxOpacity: 0.7,
        blurRadiusSetting: 16,
      },
      t
    );
  }
  assert.strictEqual(last.showCueCard, false, 'Cue card must wait for sustained distraction');

  // Continue sustained low focus through 3000 ms -> card smoothly activates
  for (let t = 350; t <= 3000; t += 50) {
    last = stabilizer.update(
      {
        visualMode: 'fullscreen_dim',
        canDim: true,
        deficit: 0.8,
        rawOpacity: 0.56,
        maxOpacity: 0.7,
        blurRadiusSetting: 16,
      },
      t
    );
  }
  assert.strictEqual(last.showCueCard, true, 'Sustained distraction must show cue card');
  assert.ok(last.opacity > 0.5);

  // Brief 250 ms contact dropout -> card must stay rock-solid ON without flickering
  for (let t = 3050; t <= 3300; t += 50) {
    last = stabilizer.update(
      {
        visualMode: 'fullscreen_dim',
        canDim: false,
        deficit: 0,
        rawOpacity: 0,
        maxOpacity: 0.7,
        blurRadiusSetting: 16,
      },
      t
    );
    assert.strictEqual(last.showCueCard, true, `250 ms dropout at t=${t}ms must not hide card`);
  }

  // Sustained focus recovery for 4000 ms -> smoothly clears both opacity and cue card
  for (let t = 3350; t <= 7350; t += 50) {
    last = stabilizer.update(
      {
        visualMode: 'fullscreen_dim',
        canDim: false,
        deficit: 0,
        rawOpacity: 0,
        maxOpacity: 0.7,
        blurRadiusSetting: 16,
      },
      t
    );
  }
  assert.strictEqual(last.opacity, 0);
  assert.strictEqual(last.showCueCard, false);
});

test('Overlay Visual Stabilizer: threshold_blur debounces brief spikes and hardClear zeroes immediately', () => {
  const stabilizer = new OverlayVisualStabilizer();

  // Brief 300 ms deep spike -> must NOT flash dense blur / pause card
  let last = stabilizer.update(
    {
      visualMode: 'threshold_blur',
      canDim: true,
      deficit: 0.7,
      rawOpacity: 0.5,
      maxOpacity: 0.75,
      blurRadiusSetting: 18,
    },
    0
  );
  for (let t = 50; t <= 300; t += 50) {
    last = stabilizer.update(
      {
        visualMode: 'threshold_blur',
        canDim: true,
        deficit: 0.7,
        rawOpacity: 0.5,
        maxOpacity: 0.75,
        blurRadiusSetting: 18,
      },
      t
    );
  }
  assert.strictEqual(last.thresholdBlurActive, false);
  assert.strictEqual(last.showPauseCard, false);
  assert.strictEqual(last.blurPx, 0, 'Must never show mild squinting blur before dwell completes');

  // Sustained deep dip through 1600 ms -> snaps cleanly to >= 20 px dense blur + pause card
  for (let t = 350; t <= 1600; t += 50) {
    last = stabilizer.update(
      {
        visualMode: 'threshold_blur',
        canDim: true,
        deficit: 0.7,
        rawOpacity: 0.5,
        maxOpacity: 0.75,
        blurRadiusSetting: 18,
      },
      t
    );
  }
  assert.strictEqual(last.thresholdBlurActive, true);
  assert.strictEqual(last.showPauseCard, true);
  assert.strictEqual(last.showCueCard, true);
  assert.ok(last.blurPx >= DENSE_BLUR_MIN_PX);

  // hardClear (e.g. headband disconnected or Fit Check started) clears immediately
  const cleared = stabilizer.update(
    {
      visualMode: 'threshold_blur',
      canDim: false,
      hardClear: true,
      deficit: 0,
      rawOpacity: 0,
      maxOpacity: 0.75,
      blurRadiusSetting: 18,
    },
    1650
  );
  assert.strictEqual(cleared.opacity, 0);
  assert.strictEqual(cleared.blurPx, 0);
  assert.strictEqual(cleared.thresholdBlurActive, false);
  assert.strictEqual(cleared.showPauseCard, false);
  assert.strictEqual(cleared.showCueCard, false);
});
