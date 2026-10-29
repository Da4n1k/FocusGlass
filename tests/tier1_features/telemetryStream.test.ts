import test from 'node:test';
import assert from 'node:assert/strict';
import { SyntheticEEGGenerator } from '../fixtures/eegGenerator.ts';

test('Tier 1 - Telemetry: 250Hz sample rate produces exactly 250 frames per second with 4ms dt', () => {
  const gen = new SyntheticEEGGenerator(250, 1000000);
  const frames = gen.generateBatch(1.0, 'high_focus');

  assert.strictEqual(frames.length, 250, '1.0 second must yield exactly 250 frames');
  const dt = frames[1].timestamp - frames[0].timestamp;
  assert.strictEqual(dt, 4, 'Sampling interval must be 4 milliseconds');
});

test('Tier 1 - Telemetry: all 4 channels (T3, T4, O1, O2) contain valid microvolt signal levels', () => {
  const gen = new SyntheticEEGGenerator();
  const frame = gen.nextFrame('calm_flow');

  assert.ok(typeof frame.rawChannels.t3 === 'number' && !isNaN(frame.rawChannels.t3));
  assert.ok(typeof frame.rawChannels.t4 === 'number' && !isNaN(frame.rawChannels.t4));
  assert.ok(typeof frame.rawChannels.o1 === 'number' && !isNaN(frame.rawChannels.o1));
  assert.ok(typeof frame.rawChannels.o2 === 'number' && !isNaN(frame.rawChannels.o2));

  // BrainBit normal EEG amplitude range: [-100, 100] uV
  assert.ok(Math.abs(frame.rawChannels.t3) <= 100, 'T3 amplitude within normal physiological range');
  assert.ok(Math.abs(frame.rawChannels.o1) <= 100, 'O1 amplitude within normal physiological range');
});

test('Tier 1 - Telemetry: concentration and relaxation indices remain in valid range [0, 100]', () => {
  const gen = new SyntheticEEGGenerator();
  const presets: ('high_focus' | 'calm_flow' | 'attention_drift' | 'distracted' | 'meditation')[] = [
    'high_focus',
    'calm_flow',
    'attention_drift',
    'distracted',
    'meditation',
  ];

  for (const preset of presets) {
    const frames = gen.generateBatch(0.5, preset);
    for (const f of frames) {
      assert.ok(f.concentration >= 0 && f.concentration <= 100, `Concentration out of bounds: ${f.concentration}`);
      assert.ok(f.relaxation >= 0 && f.relaxation <= 100, `Relaxation out of bounds: ${f.relaxation}`);
    }
  }
});

test('Tier 1 - Telemetry: signal quality flags for all 4 channels are present and typed boolean', () => {
  const gen = new SyntheticEEGGenerator();
  const frame = gen.nextFrame('high_focus');

  assert.strictEqual(typeof frame.signalQuality.t3, 'boolean');
  assert.strictEqual(typeof frame.signalQuality.t4, 'boolean');
  assert.strictEqual(typeof frame.signalQuality.o1, 'boolean');
  assert.strictEqual(typeof frame.signalQuality.o2, 'boolean');
});

test('Tier 1 - Telemetry: timestamp sequencing is strictly monotonically increasing', () => {
  const gen = new SyntheticEEGGenerator(250, 5000);
  const frames = gen.generateBatch(2.0, 'high_focus');

  for (let i = 1; i < frames.length; i++) {
    assert.ok(
      frames[i].timestamp > frames[i - 1].timestamp,
      `Non-monotonic timestamp detected: ${frames[i].timestamp} <= ${frames[i - 1].timestamp}`
    );
  }
});

test('Tier 1 - Telemetry: state change from high_focus to distracted produces distinct spectral metric drop', () => {
  const gen = new SyntheticEEGGenerator();
  const focusFrames = gen.generateBatch(0.5, 'high_focus');
  const avgFocus = focusFrames.reduce((acc, f) => acc + f.concentration, 0) / focusFrames.length;

  const distractedFrames = gen.generateBatch(0.5, 'distracted');
  const avgDistracted = distractedFrames.reduce((acc, f) => acc + f.concentration, 0) / distractedFrames.length;

  assert.ok(avgFocus > 85, 'high_focus average concentration should exceed 85');
  assert.ok(avgDistracted < 35, 'distracted average concentration should be below 35');
  assert.ok(avgFocus - avgDistracted > 50, 'Contrast between states must exceed 50 points');
});
