import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../harness/biofeedbackEngine.ts';
import { SyntheticEEGGenerator } from '../fixtures/eegGenerator.ts';

test('Tier 3 - Calibration: 30-second baseline recording calculates individual baseline and recommended threshold', () => {
  const gen = new SyntheticEEGGenerator();
  // 30 seconds of high_focus calibration (7500 frames at 250Hz)
  const calibrationFrames = gen.generateBatch(30, 'calm_flow');

  const result = BiofeedbackEngine.calibrateBaseline(calibrationFrames);

  assert.ok(result.baselineFocus > 70 && result.baselineFocus < 85, `Unexpected baseline: ${result.baselineFocus}`);
  assert.ok(result.recommendedThreshold >= 40 && result.recommendedThreshold <= 85);
  assert.ok(result.confidence > 0.8, `Confidence should be high: ${result.confidence}`);
});

test('Tier 3 - Calibration: applying personalized recommended threshold dynamically adapts biofeedback engine', () => {
  const gen = new SyntheticEEGGenerator();
  const calibrationFrames = gen.generateBatch(10, 'high_focus');
  const calibration = BiofeedbackEngine.calibrateBaseline(calibrationFrames);

  // Initialize engine with default threshold (60)
  const engine = new BiofeedbackEngine({ threshold: 60 });

  // Apply calibrated personalized threshold
  engine.updateSettings({ threshold: calibration.recommendedThreshold });
  assert.strictEqual(engine.getSettings().threshold, calibration.recommendedThreshold);

  // Verify behavior with the new threshold
  const testFrame = {
    timestamp: Date.now(),
    rawChannels: { t3: 20, t4: 20, o1: 20, o2: 20 },
    concentration: calibration.recommendedThreshold + 5,
    relaxation: 50,
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    isArtifact: false,
  };

  const state = engine.processTelemetry(testFrame);
  assert.strictEqual(state.overlayOpacity, 0, 'Score above personalized threshold should not dim');
});

test('Tier 3 - Calibration: artifact frames are automatically excluded from baseline calculations', () => {
  const gen = new SyntheticEEGGenerator();
  const cleanFrames = gen.generateBatch(5, 'calm_flow');
  const cleanResult = BiofeedbackEngine.calibrateBaseline(cleanFrames);

  // Add 100 noisy artifact frames with 0% focus
  const contaminatedFrames = cleanFrames.map(f => ({ ...f }));
  for (let i = 0; i < 100; i++) {
    contaminatedFrames.push({
      timestamp: Date.now() + i * 4,
      rawChannels: { t3: 500, t4: 500, o1: 500, o2: 500 },
      concentration: 0,
      relaxation: 0,
      signalQuality: { t3: false, t4: false, o1: false, o2: false },
      isArtifact: true, // Flagged artifact
    });
  }

  const filteredResult = BiofeedbackEngine.calibrateBaseline(contaminatedFrames);

  assert.strictEqual(
    filteredResult.baselineFocus,
    cleanResult.baselineFocus,
    'Artifacts must not pull down baseline focus'
  );
});
