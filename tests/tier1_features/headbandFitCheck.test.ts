import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyElectrodeImpedance,
  diagnoseHeadbandFit,
  FitStabilityTracker,
  FIT_HOLD_REQUIRED_MS,
} from '../../src/services/headbandFitCheck.ts';
import { SimulationEngine } from '../../src/services/simulationEngine.ts';
import type { BiofeedbackFeedbackState, EEGTelemetry, RawBrainBitPacket } from '../../src/services/eegTypes.ts';

test('Fit Check: classifies electrode impedances into good/acceptable/poor/open/unmeasured', () => {
  assert.strictEqual(classifyElectrodeImpedance(120), 'good');
  assert.strictEqual(classifyElectrodeImpedance(500), 'good');
  assert.strictEqual(classifyElectrodeImpedance(650), 'acceptable');
  assert.strictEqual(classifyElectrodeImpedance(800), 'acceptable');
  assert.strictEqual(classifyElectrodeImpedance(801), 'poor');
  assert.strictEqual(classifyElectrodeImpedance(null), 'open');
  assert.strictEqual(classifyElectrodeImpedance(Infinity), 'open');
  assert.strictEqual(classifyElectrodeImpedance(-10), 'open');
  assert.strictEqual(classifyElectrodeImpedance(undefined), 'unmeasured');
  assert.strictEqual(classifyElectrodeImpedance(undefined, false), 'open');
  assert.strictEqual(classifyElectrodeImpedance(250, false), 'poor');
});

test('Fit Check: diagnoses forehead reference, occipital hair, temporal fit, and stability progression', () => {
  const unmeasured = diagnoseHeadbandFit(undefined, undefined, 0);
  assert.strictEqual(unmeasured.status, 'unmeasured');
  assert.strictEqual(unmeasured.usableCount, 0);

  const foreheadFault = diagnoseHeadbandFit(
    { t3: null, t4: null, o1: null, o2: null },
    { t3: false, t4: false, o1: false, o2: false },
    0
  );
  assert.strictEqual(foreheadFault.status, 'adjust_forehead');

  const occipitalHair = diagnoseHeadbandFit(
    { t3: 180, t4: 210, o1: 1450, o2: null },
    { t3: true, t4: true, o1: false, o2: false },
    0
  );
  assert.strictEqual(occipitalHair.status, 'adjust_occipital');
  assert.strictEqual(occipitalHair.usableCount, 2);

  const temporalFit = diagnoseHeadbandFit(
    { t3: 1100, t4: 240, o1: 190, o2: 220 },
    { t3: false, t4: true, o1: true, o2: true },
    0
  );
  assert.strictEqual(temporalFit.status, 'adjust_temporal');

  const stabilizing = diagnoseHeadbandFit(
    { t3: 180, t4: 190, o1: 620, o2: 210 },
    { t3: true, t4: true, o1: true, o2: true },
    1500
  );
  assert.strictEqual(stabilizing.status, 'stabilizing');
  assert.strictEqual(stabilizing.progress, 0.5);

  const verified = diagnoseHeadbandFit(
    { t3: 180, t4: 190, o1: 310, o2: 210 },
    { t3: true, t4: true, o1: true, o2: true },
    FIT_HOLD_REQUIRED_MS
  );
  assert.strictEqual(verified.status, 'verified');
  assert.strictEqual(verified.progress, 1);
});

test('Fit Check: stability tracker accumulates 3s hold and resets on momentary contact drop', () => {
  const tracker = new FitStabilityTracker();
  assert.deepStrictEqual(tracker.update(true, 1000), { holdMs: 0, verified: false });
  assert.deepStrictEqual(tracker.update(true, 2500), { holdMs: 1500, verified: false });
  // Momentary hair slip resets continuous hold timer
  assert.deepStrictEqual(tracker.update(false, 3000), { holdMs: 0, verified: false });
  assert.deepStrictEqual(tracker.update(true, 3500), { holdMs: 0, verified: false });
  assert.deepStrictEqual(tracker.update(true, 6500), { holdMs: 3000, verified: true });
});

test('Live Engine: ingestRawBrainBitBatch matches packet-by-packet DSP and applyBrainBitResistUpdate suspends dimming', () => {
  const singleEngine = new SimulationEngine();
  const batchEngine = new SimulationEngine();
  singleEngine.updateSettings({ deviceSource: 'bluetooth', threshold: 60, sensitivitySeconds: 0.05 });
  batchEngine.updateSettings({ deviceSource: 'bluetooth', threshold: 60, sensitivitySeconds: 0.05 });

  const packets: RawBrainBitPacket[] = Array.from({ length: 12 }, (_, idx) => {
    const t = idx / 250;
    const wave = Math.sin(2 * Math.PI * 18 * t) * 28;
    return {
      timestamp: 1000 + idx * 4,
      rawChannels: { t3: wave, t4: wave * 0.9, o1: wave * 0.5, o2: wave * 0.5 },
      signalQuality: { t3: true, t4: true, o1: true, o2: true },
      resistanceKOhm: { t3: 180, t4: 195, o1: 210, o2: 205 },
    };
  });

  let singleLast: BiofeedbackFeedbackState | null = null;
  for (const pkt of packets) {
    singleLast = singleEngine.ingestRawBrainBitPacket(pkt);
  }

  let notifyCount = 0;
  let batchTelemetry: EEGTelemetry | null = null;
  let batchLast: BiofeedbackFeedbackState | null = null;
  const unsub = batchEngine.subscribe((tel, state) => {
    notifyCount += 1;
    batchTelemetry = tel;
    batchLast = state;
  });

  batchEngine.ingestRawBrainBitBatch(packets);
  assert.strictEqual(notifyCount, 1, 'batch should notify subscribers once');
  assert.ok(singleLast && batchLast);
  assert.strictEqual(batchLast.smoothedMetric, singleLast.smoothedMetric);
  assert.deepStrictEqual(batchTelemetry?.resistanceKOhm, packets[0].resistanceKOhm);

  batchEngine.applyBrainBitResistUpdate({
    timestamp: 2000,
    resistanceKOhm: { t3: 180, t4: 195, o1: 950, o2: null },
    signalQuality: { t3: true, t4: true, o1: false, o2: false },
  });
  assert.ok(batchLast);
  assert.strictEqual(batchLast.overlayOpacity, 0);
  assert.strictEqual(batchLast.isDimmingActive, false);
  assert.strictEqual(batchLast.isContactOk, false);
  unsub();
});
