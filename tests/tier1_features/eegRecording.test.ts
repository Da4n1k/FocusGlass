import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEEGRecording, EEGRecordingParseError } from '../../src/services/eegRecording.ts';
import { BiofeedbackEngine, mapMetricToPersonalScore } from '../../src/services/biofeedbackEngine.ts';
import { RecordingPlayback } from '../../src/services/recordingPlayback.ts';
import { SimulationEngine } from '../../src/services/simulationEngine.ts';
import type { EEGTelemetry } from '../../src/services/eegTypes.ts';

const validQuality = { t3: true, t4: true, o1: true, o2: true };

function telemetry(value: number, timestamp: number, extra: Partial<EEGTelemetry> = {}): EEGTelemetry {
  return {
    timestamp,
    rawChannels: { t3: 10, t4: 10, o1: 10, o2: 10 },
    concentration: value,
    relaxation: value,
    signalQuality: { ...validQuality },
    isArtifact: false,
    ...extra,
  };
}

test('EEG recordings: parses CSV channels, kOhm resistance, artifact flags and timestamps', () => {
  const csv = [
    'timestamp_ms,T3_uV,T4_uV,O1_uV,O2_uV,T3_kOhm,T4_kOhm,O1_kOhm,O2_kOhm,artifact',
    '1000,1,2,3,4,120,130,140,150,false',
    '1004,5,6,7,8,900,130,140,150,true',
  ].join('\n');
  const recording = parseEEGRecording(csv, 'neurotech.csv');
  assert.equal(recording.name, 'neurotech.csv');
  assert.equal(recording.format, 'csv');
  assert.equal(recording.sampleRateHz, 250);
  assert.equal(recording.frames.length, 2);
  assert.deepEqual(recording.frames[0].rawChannels, { t3: 1, t4: 2, o1: 3, o2: 4 });
  assert.equal(recording.frames[0].timestamp, 0);
  assert.equal(recording.frames[1].isArtifact, true);
  assert.equal(recording.frames[1].signalQuality?.t3, false, 'Resistance above 800 kOhm fails channel quality');
});

test('EEG recordings: parses JSON NeuroSDK-style packets with nested channels and quality', () => {
  const json = JSON.stringify({
    sampleRateHz: 250,
    samples: [
      { timestamp: 0, rawChannels: { T3: 0.01, T4: 0.02, O1: 0.03, O2: 0.04 }, signalQuality: validQuality, resistanceKOhm: { t3: 120, t4: 130, o1: 140, o2: 150 } },
      { timestamp: 0.004, channels: { t3: 1, t4: 2, o1: 3, o2: 4 }, isArtifact: true },
    ],
  });
  const recording = parseEEGRecording(json);
  assert.equal(recording.sampleRateHz, 250);
  assert.equal(recording.frames[0].rawChannels.t3, 0.01);
  assert.equal(recording.frames[0].resistanceKOhm?.o2, 150);
  assert.equal(recording.frames[1].timestamp, 4);
  assert.equal(recording.frames[1].isArtifact, true);

  const inferred = parseEEGRecording(JSON.stringify([
    { timestamp: 0, channels: { t3: 1, t4: 1, o1: 1, o2: 1 } },
    { timestamp: 0.004, channels: { t3: 1, t4: 1, o1: 1, o2: 1 } },
  ]));
  assert.equal(inferred.sampleRateHz, 250, 'Seconds-based timestamps should infer 250 Hz');
  assert.equal(inferred.frames[1].timestamp, 4, 'Replay timestamps are normalized to milliseconds');
});

test('EEG recordings: converts millivolt columns and rejects missing required channels', () => {
  const csv = 'T3_mV,T4_mV,O1_mV,O2_mV\n0.01,0.02,0.03,0.04';
  const recording = parseEEGRecording(csv);
  assert.equal(recording.frames[0].rawChannels.t3, 10);
  assert.throws(() => parseEEGRecording('timestamp,T3,T4,O1\n0,1,2,3'), EEGRecordingParseError);
});

test('EEG recordings: replay emits samples in order at the selected rate', async () => {
  const recording = parseEEGRecording([
    'timestamp_ms,T3,T4,O1,O2',
    '0,1,1,1,1',
    '4,2,2,2,2',
    '8,3,3,3,3',
  ].join('\n'));
  const playback = new RecordingPlayback();
  playback.load(recording);
  const emitted: number[] = [];
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Playback did not finish')), 1000);
    const started = playback.play(
      0.25,
      (batch) => emitted.push(...batch.map((frame) => frame.rawChannels.t3)),
      () => undefined,
      () => { clearTimeout(timeout); resolve(); }
    );
    assert.equal(started, true);
  });
  assert.deepEqual(emitted, [1, 2, 3]);
  assert.equal(playback.getProgress(), 1);
});

test('EEG recordings: recorded artifact flags freeze biofeedback through the production engine', () => {
  const engine = new SimulationEngine();
  const state = engine.ingestRecordedFrames([{
    timestamp: 1,
    rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 },
    signalQuality: { ...validQuality },
    isArtifact: true,
  }]);
  assert.equal(state.isArtifactFrozen, true);
  engine.stop();
});

test('Calibration: stable personal baseline maps to zero deviation and 50 percent', () => {
  const result = mapMetricToPersonalScore(72, 72, 3);
  assert.deepEqual(result, { deviation: 0, percentage: 50 });
  assert.equal(mapMetricToPersonalScore(100, 72, 3).deviation, 100);
  assert.equal(mapMetricToPersonalScore(0, 72, 3).deviation, -100);
});

test('Calibration: later half weights current fatigue; artifact and poor-contact frames are rejected', () => {
  const frames: EEGTelemetry[] = [];
  for (let i = 0; i < 100; i++) frames.push(telemetry(i < 50 ? 80 : 60, i));
  frames.push(telemetry(0, 101, { isArtifact: true }));
  frames.push(telemetry(0, 102, {
    signalQuality: { t3: true, t4: true, o1: true, o2: true },
    resistanceKOhm: { t3: 801, t4: 100, o1: 100, o2: 100 },
  }));
  const result = BiofeedbackEngine.calibrateBaseline(frames);
  assert.equal(result.sampleCount, 100);
  assert.equal(result.fatigueDrift, -20);
  assert.equal(result.baselineFocus, 67);
  assert.equal(result.validSampleRatio, 0.98);
});

test('Calibration: biofeedback uses the personal score and compares a cutoff in the same mapped scale', () => {
  const engine = new BiofeedbackEngine({ sensitivitySeconds: 0.001, threshold: 75 });
  engine.setPersonalCalibration({
    baselineFocus: 75,
    baselineRelaxation: 65,
    variabilityFocus: 10,
    variabilityRelaxation: 8,
    fatigueDrift: -2,
    recommendedThreshold: 75,
    confidence: 0.95,
    validSampleRatio: 1,
    mode: 'concentration',
    sampleCount: 250,
  });
  const baselineState = engine.processTelemetry(telemetry(75, 1));
  assert.equal(baselineState.personalDeviation, 0);
  assert.equal(baselineState.smoothedMetric, 50);
  assert.equal(baselineState.effectiveThreshold, 50);
  assert.equal(baselineState.overlayOpacity, 0);

  const lowState = engine.processTelemetry(telemetry(55, 2));
  assert.equal(lowState.personalDeviation, -80);
  assert.equal(lowState.smoothedMetric, 10);
  assert.ok(lowState.overlayOpacity > 0);
});

test('Calibration: explicit null or excessive resistance prevents contact and baseline inclusion', () => {
  const engine = new BiofeedbackEngine();
  const badResistance = telemetry(80, 1, {
    resistanceKOhm: { t3: 800.01, t4: 100, o1: 100, o2: 100 },
  });
  assert.equal(engine.processTelemetry(badResistance).isContactOk, false);
  const noContact = telemetry(80, 2, {
    resistanceKOhm: { t3: null, t4: 100, o1: 100, o2: 100 },
  });
  assert.equal(BiofeedbackEngine.calibrateBaseline(Array.from({ length: 25 }, (_, i) => ({ ...noContact, timestamp: i }))).sampleCount, 0);
});
