import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';
import { SyntheticEEGGenerator } from '../fixtures/eegGenerator.ts';
import { ARTIFACT_PRESETS, injectArtifactBurst } from '../fixtures/artifactBurst.ts';

test('Tier 2 - Artifacts: eye blink burst (EOG) freezes opacity and flags isArtifactFrozen = true', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, dimmingMaxOpacity: 0.8 });
  const gen = new SyntheticEEGGenerator();

  // Baseline 50 frames of high focus
  const baseFrames = gen.generateBatch(0.2, 'high_focus');
  for (const f of baseFrames) {
    engine.processTelemetry(f);
  }
  const preArtifactOpacity = engine.getLastState().overlayOpacity;
  assert.strictEqual(preArtifactOpacity, 0);

  // Inject 50 frames of eye blink burst
  const blinkFrames = gen.generateBatch(0.2, 'distracted'); // Even with bad concentration!
  const burstFrames = injectArtifactBurst(blinkFrames, 0, ARTIFACT_PRESETS.eyeBlink);

  for (const f of burstFrames) {
    const state = engine.processTelemetry(f);
    assert.strictEqual(state.isArtifactFrozen, true, 'State must flag isArtifactFrozen during blink');
    assert.strictEqual(state.overlayOpacity, preArtifactOpacity, 'Opacity must remain frozen');
  }
});

test('Tier 2 - Artifacts: jaw clench (EMG) high-amplitude spikes do not pollute moving average buffer', () => {
  const engine = new BiofeedbackEngine({ threshold: 60, sensitivitySeconds: 0.5 });
  const gen = new SyntheticEEGGenerator();

  // 100 frames of high focus (85%)
  const highFocusFrames = gen.generateBatch(0.4, 'high_focus');
  for (const f of highFocusFrames) {
    engine.processTelemetry(f);
  }
  const preAvg = engine.getLastState().smoothedMetric;
  assert.ok(preAvg > 80);

  // Inject heavy jaw clench burst with distorted 0% concentration
  const distortedFrames = gen.generateBatch(0.5, 'distracted');
  const burstFrames = injectArtifactBurst(distortedFrames, 0, ARTIFACT_PRESETS.jawClench);

  for (const f of burstFrames) {
    engine.processTelemetry(f);
  }

  // Next clean high focus frame
  const postFrame = gen.nextFrame('high_focus');
  const postState = engine.processTelemetry(postFrame);

  // The smoothed metric must NOT have been contaminated by the jaw clench frames
  assert.ok(postState.smoothedMetric > 80, 'Moving average buffer was corrupted by artifact frames');
  assert.strictEqual(postState.overlayOpacity, 0, 'No dimming should occur after artifact clears');
});

test('Tier 2 - Artifacts: headband physical shift flags both artifact and electrode contact loss', () => {
  const engine = new BiofeedbackEngine();
  const gen = new SyntheticEEGGenerator();

  const frames = gen.generateBatch(1.0, 'calm_flow');
  const shiftFrames = injectArtifactBurst(frames, 0, ARTIFACT_PRESETS.headbandShift);

  let contactLossDetected = false;
  let artifactDetected = false;

  for (const f of shiftFrames) {
    const state = engine.processTelemetry(f);
    if (!state.isContactOk) contactLossDetected = true;
    if (state.isArtifactFrozen) artifactDetected = true;
  }

  assert.strictEqual(contactLossDetected, true, 'Electrode contact loss was not detected during headband shift');
  assert.strictEqual(artifactDetected, true, 'Artifact was not flagged during headband shift');
});
