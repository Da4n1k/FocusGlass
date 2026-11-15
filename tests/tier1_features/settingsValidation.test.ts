import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine, DEFAULT_SETTINGS } from '../harness/biofeedbackEngine.ts';
import { sanitizeSettings, SETTING_RANGES } from '../../src/services/settingsSchema.ts';
import type { EEGTelemetry } from '../contracts/telemetry.ts';

function frame(concentration: number, relaxation: number = 50): EEGTelemetry {
  return {
    timestamp: 0,
    rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    concentration,
    relaxation,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };
}

test('Settings: undefined / null / array / primitive input falls back to the base settings', () => {
  for (const bad of [undefined, null, [], 'x', 42, true]) {
    assert.deepStrictEqual(sanitizeSettings(bad), DEFAULT_SETTINGS, `input: ${String(bad)}`);
  }
});

test('Settings: numbers outside the allowed range are clamped to the range edges', () => {
  const low = sanitizeSettings({ threshold: -5, dimmingMaxOpacity: -1, blurRadius: -9, audioVolume: -3 });
  assert.strictEqual(low.threshold, SETTING_RANGES.threshold[0]);
  assert.strictEqual(low.dimmingMaxOpacity, SETTING_RANGES.dimmingMaxOpacity[0]);
  assert.strictEqual(low.blurRadius, SETTING_RANGES.blurRadius[0]);
  assert.strictEqual(low.audioVolume, SETTING_RANGES.audioVolume[0]);

  const high = sanitizeSettings({ threshold: 500, sensitivitySeconds: 99, blurRadius: 900, audioVolume: 7 });
  assert.strictEqual(high.threshold, SETTING_RANGES.threshold[1]);
  assert.strictEqual(high.sensitivitySeconds, SETTING_RANGES.sensitivitySeconds[1]);
  assert.strictEqual(high.blurRadius, SETTING_RANGES.blurRadius[1]);
  assert.strictEqual(high.audioVolume, SETTING_RANGES.audioVolume[1]);
});

test('Settings: NaN, Infinity and numeric strings never reach the settings (fallback to base)', () => {
  const base = { ...DEFAULT_SETTINGS, threshold: 70, sensitivitySeconds: 3 };
  const result = sanitizeSettings(
    { threshold: NaN, sensitivitySeconds: '5', blurRadius: Infinity, glassOpacity: null },
    base
  );
  assert.strictEqual(result.threshold, 70);
  assert.strictEqual(result.sensitivitySeconds, 3);
  assert.strictEqual(result.blurRadius, base.blurRadius);
  assert.strictEqual(result.glassOpacity, base.glassOpacity);
  for (const value of Object.values(result)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value));
  }
});

test('Settings: unknown enum members and wrong boolean types are rejected per field', () => {
  const result = sanitizeSettings({
    mode: 'turbo',
    deviceSource: 'usb',
    audioFeedbackEnabled: 'yes',
    invertReaction: 1,
    threshold: 80,
  });
  assert.strictEqual(result.mode, DEFAULT_SETTINGS.mode);
  assert.strictEqual(result.deviceSource, DEFAULT_SETTINGS.deviceSource);
  assert.strictEqual(result.audioFeedbackEnabled, DEFAULT_SETTINGS.audioFeedbackEnabled);
  assert.strictEqual(result.invertReaction, DEFAULT_SETTINGS.invertReaction);
  assert.strictEqual(result.threshold, 80, 'valid fields next to invalid ones must survive');
});

test('Settings: a legacy persisted record without audioVolume / invertReaction gets defaults', () => {
  const legacy = { mode: 'relaxation', threshold: 65, audioFeedbackEnabled: true };
  const result = sanitizeSettings(legacy);
  assert.strictEqual(result.mode, 'relaxation');
  assert.strictEqual(result.threshold, 65);
  assert.strictEqual(result.audioVolume, DEFAULT_SETTINGS.audioVolume);
  assert.strictEqual(result.invertReaction, DEFAULT_SETTINGS.invertReaction);
});

test('Settings: engine ignores NaN updates instead of poisoning dimming math', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, dimmingMaxOpacity: 0.8, sensitivitySeconds: 0.001 });
  engine.updateSettings({ threshold: NaN, dimmingMaxOpacity: NaN });

  assert.strictEqual(engine.getSettings().threshold, 60);
  const state = engine.processTelemetry(frame(30));
  assert.ok(Number.isFinite(state.overlayOpacity));
  assert.strictEqual(state.overlayOpacity, 0.4);
});

test('Invert Reaction: dims above the threshold and stays clear below it', () => {
  const engine = new BiofeedbackEngine({
    threshold: 60,
    dimmingMaxOpacity: 0.8,
    sensitivitySeconds: 0.001,
    invertReaction: true,
  });

  // Metric 80, threshold 60 -> excess = (80 - 60) / (100 - 60) = 0.5
  const high = engine.processTelemetry(frame(80));
  assert.strictEqual(high.deficit, 0.5);
  assert.strictEqual(high.overlayOpacity, 0.4);
  assert.strictEqual(high.isDimmingActive, true);

  const low = engine.processTelemetry(frame(30));
  assert.strictEqual(low.deficit, 0);
  assert.strictEqual(low.overlayOpacity, 0);
  assert.strictEqual(low.isDimmingActive, false);
});

test('Invert Reaction: toggling mid-session flips the response without a reset', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, dimmingMaxOpacity: 0.8, sensitivitySeconds: 0.001 });
  assert.strictEqual(engine.processTelemetry(frame(90)).overlayOpacity, 0);

  engine.updateSettings({ invertReaction: true });
  assert.ok(engine.processTelemetry(frame(90)).overlayOpacity > 0);
});

test('Audio Volume: master volume scales audio output proportionally to the deficit', () => {
  const half = new BiofeedbackEngine({
    threshold: 60,
    sensitivitySeconds: 0.001,
    audioFeedbackEnabled: true,
    audioVolume: 0.5,
  });
  // Deficit (60 - 30) / 60 = 0.5, master 0.5 -> 0.25
  assert.strictEqual(half.processTelemetry(frame(30)).audioVolume, 0.25);

  const mute = new BiofeedbackEngine({
    threshold: 60,
    sensitivitySeconds: 0.001,
    audioFeedbackEnabled: true,
    audioVolume: 0,
  });
  const state = mute.processTelemetry(frame(30));
  assert.strictEqual(state.audioVolume, 0);
  assert.strictEqual(state.overlayOpacity > 0, true, 'volume 0 must not disable the visual dimming');
});
