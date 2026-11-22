import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLinuxBlurInput, linuxBlurTarget, type LinuxBlurInput } from '../../src/services/linuxBlurPolicy.ts';
import { BiofeedbackEngine } from '../../src/services/biofeedbackEngine.ts';
import { resolveOverlayVisuals } from '../../src/services/overlayVisualPolicy.ts';
import { buildSnapshotInput } from '../../src/services/overlaySync.ts';

const active: LinuxBlurInput = {
  enabled: true,
  streamActive: true,
  contactOk: true,
  paused: false,
  isDimmingActive: true,
  visualStyle: 'threshold_blur',
  opacity: 0.7,
  blurPx: 20,
};
const clear = { opacity: 0, blurPx: 0 };

test('native takeover clears only legacy visuals and restores them on backend failure', () => {
  const engine = new BiofeedbackEngine();
  const feedback = { ...engine.getLastState(), overlayOpacity: 0.5, blurRadius: 16,
    isDimmingActive: true, audioVolume: 0.3 };
  const state = { settings: engine.getSettings(), feedbackState: feedback,
    deviceStatus: { connected: true }, telemetry: null, isPaused: false,
    activePreset: 'distracted' as const };
  const native = buildSnapshotInput(state, true);
  assert.equal(native.feedback.overlayOpacity, 0);
  assert.equal(native.feedback.blurRadius, 0);
  assert.equal(native.feedback.audioVolume, 0.3);
  assert.equal(state.feedbackState.overlayOpacity, 0.5, 'must not mutate the live engine');
  const fallback = buildSnapshotInput(state, false);
  assert.equal(fallback.feedback.overlayOpacity, 0.5);
  assert.equal(fallback.feedback.blurRadius, 16);
});

test('native blur follows the engine threshold without a 45% deficit gate', () => {
  assert.deepEqual(linuxBlurTarget(active), { opacity: 0.7, blurPx: 20 });
  assert.deepEqual(linuxBlurTarget({ ...active, blurPx: 0 }), { opacity: 0.7, blurPx: 0 });
  assert.deepEqual(linuxBlurTarget({ ...active, opacity: 0.02, blurPx: 16 }), { opacity: 0.02, blurPx: 16 });
});

test('regression: 55% focus against a 60% threshold blurs even when legacy visual blur is zero', () => {
  const engine = new BiofeedbackEngine({
    threshold: 60, sensitivitySeconds: 0.001, overlayMode: 'threshold_blur',
  });
  const packet = {
    timestamp: 0, rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    concentration: 55, relaxation: 40,
    signalQuality: { t3: true, t4: true, o1: true, o2: true }, isArtifact: false,
  };
  const feedback = engine.processTelemetry(packet);
  const legacyVisuals = resolveOverlayVisuals({
    visualMode: 'threshold_blur', canDim: true, deficit: feedback.deficit,
    rawOpacity: feedback.overlayOpacity, maxOpacity: 0.7,
    blurRadiusSetting: 16, prevThresholdBlurActive: false,
  });
  assert.equal(legacyVisuals.blurPx, 0, 'legacy dimming policy must remain unchanged');
  const state = {
    overlayEnabled: true, isPaused: false,
    settings: engine.getSettings(), deviceStatus: { connected: true },
    feedbackState: feedback, overlayVisuals: legacyVisuals,
  };
  const target = linuxBlurTarget(buildLinuxBlurInput(state));
  assert.ok(target.opacity > 0);
  assert.equal(target.blurPx, 16);

  engine.updateSettings({ threshold: 10 });
  const recovered = engine.processTelemetry({ ...packet, timestamp: 4 });
  assert.deepEqual(linuxBlurTarget(buildLinuxBlurInput({ ...state, feedbackState: recovered })), clear,
    'lowering the threshold below current focus must not activate blur');
});

test('fit-check resistance mode is not treated as a live EEG stream', () => {
  const feedbackState = new BiofeedbackEngine().getLastState();
  const input = buildLinuxBlurInput({
    overlayEnabled: true, isPaused: false,
    settings: { deviceSource: 'bluetooth', overlayMode: 'threshold_blur', blurRadius: 16, threshold: 60, invertReaction: false },
    deviceStatus: { connected: true, streamMode: 'resist' },
    feedbackState: { ...feedbackState, isDimmingActive: true, overlayOpacity: 0.5 },
  });
  assert.deepEqual(linuxBlurTarget(input), clear);
});

test('native threshold blur activates immediately across either threshold direction, not the dimmer dead zone', () => {
  for (const invertReaction of [false,true]) {
    const engine = new BiofeedbackEngine({
      threshold: 60, sensitivitySeconds: 0.001, overlayMode: 'threshold_blur',
      invertReaction, dimmingMaxOpacity: 0.05,
    });
    const metric = invertReaction ? 60.1 : 59.9;
    const packet = {
      timestamp: 0, rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
      concentration: metric, relaxation: 40,
      signalQuality: { t3: true, t4: true, o1: true, o2: true }, isArtifact: false,
    };
    const feedbackState = engine.processTelemetry(packet);
    assert.equal(feedbackState.isDimmingActive,false,'fixture must exercise the old hidden opacity gate');
    const state = {
      overlayEnabled: true,isPaused: false,settings: engine.getSettings(),
      deviceStatus: { connected: true },feedbackState,
    };
    assert.deepEqual(linuxBlurTarget(buildLinuxBlurInput(state)),{opacity:0.95,blurPx:16});
    const equal = engine.processTelemetry({...packet,timestamp:4,concentration:60});
    assert.deepEqual(linuxBlurTarget(buildLinuxBlurInput({...state,feedbackState:equal})),clear);
  }
});

test('native threshold uses the calibrated effective threshold, and zero strength stays explicitly disabled', () => {
  const engine = new BiofeedbackEngine({threshold:80,overlayMode:'threshold_blur'});
  const state = {
    overlayEnabled:true,isPaused:false,settings:engine.getSettings(),
    deviceStatus:{connected:true},
    feedbackState:{...engine.getLastState(),smoothedMetric:55,effectiveThreshold:50},
  };
  assert.deepEqual(linuxBlurTarget(buildLinuxBlurInput(state)),clear);
  state.feedbackState.smoothedMetric=45;
  assert.equal(linuxBlurTarget(buildLinuxBlurInput(state)).opacity,0.95);
  const disabled = linuxBlurTarget(buildLinuxBlurInput({...state,settings:{...state.settings,blurRadius:0}}));
  assert.equal(disabled.blurPx,0);
});
test('existing dimming, sharp-center vignette and distractor modes are not replaced', () => {
  for (const visualStyle of ['fullscreen_dim', 'vignette_blur', 'distractors'] as const) {
    assert.deepEqual(linuxBlurTarget({ ...active, visualStyle }), clear);
  }
});

test('pause, lost contact, disabled overlay and disconnected stream clear blur', () => {
  for (const change of [
    { enabled: false }, { streamActive: false }, { contactOk: false }, { paused: true },
    { isDimmingActive: false },
  ]) {
    assert.deepEqual(linuxBlurTarget({ ...active, ...change }), clear);
  }
});

test('nonfinite visual values are rejected and finite values are bounded', () => {
  assert.deepEqual(linuxBlurTarget({ ...active, opacity: Number.NaN }), clear);
  assert.deepEqual(linuxBlurTarget({ ...active, blurPx: Infinity }), clear);
  assert.deepEqual(linuxBlurTarget({ ...active, opacity: 5, blurPx: 99 }), { opacity: 0.95, blurPx: 32 });
  assert.deepEqual(linuxBlurTarget({ ...active, opacity: -5, blurPx: -3 }), clear);
});
