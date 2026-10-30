import test from 'node:test';
import assert from 'node:assert/strict';
import { BiofeedbackEngine } from '../../src/services/biofeedbackEngine.ts';
import { SimulationEngine } from '../../src/services/simulationEngine.ts';
import {
  computeBipolarSpectrum,
  parseEEGFromCSV,
  exportTimelineToCSV,
} from '../../src/services/spectralMath.ts';
import { SessionRepository } from '../../src/services/sessionRepository.ts';
import { tauriBridge } from '../../src/services/tauriBridge.ts';
import type { RawEEGChannels } from '../../src/services/eegTypes.ts';

test('Production Engine - Live settings update immediately propagates threshold, maxOpacity, and mode', () => {
  const sim = new SimulationEngine();
  sim.updateSettings({
    mode: 'concentration',
    threshold: 60,
    dimmingMaxOpacity: 0.8,
    sensitivitySeconds: 0.02, // 5 samples
  });

  // Stream 10 samples of 'calm_flow' (~78% concentration) -> clear screen
  sim.setPreset('calm_flow');
  let last = sim.stepSingleSyntheticSample();
  for (let i = 0; i < 10; i++) {
    last = sim.stepSingleSyntheticSample();
  }
  assert.strictEqual(last.feedback.overlayOpacity, 0, '78% focus should not dim at 60% threshold');

  // Raise threshold live to 90% -> must immediately trigger dimming on calm_flow (~78%)!
  const updatedFeedback = sim.updateSettings({ threshold: 90 });
  assert.ok(
    updatedFeedback.overlayOpacity > 0.05,
    `Raising threshold to 90% must trigger dimming immediately, got ${updatedFeedback.overlayOpacity}`
  );

  // Switch preset to meditation (concentration ~35%, relaxation ~94%) while in concentration mode -> deep dimming
  sim.setPreset('meditation');
  for (let i = 0; i < 10; i++) {
    last = sim.stepSingleSyntheticSample();
  }
  assert.ok(last.feedback.overlayOpacity > 0.3, 'Meditation has low Beta concentration, should dim in Focus mode');

  // Switch mode live to 'relaxation' -> meditation has ~94% Alpha relaxation -> must clear dimming!
  sim.updateSettings({ mode: 'relaxation', threshold: 70 });
  for (let i = 0; i < 10; i++) {
    last = sim.stepSingleSyntheticSample();
  }
  assert.strictEqual(
    last.feedback.overlayOpacity,
    0,
    'Switching to Relaxation mode during 94% Alpha meditation must clear dimming to 0'
  );
});

test('Production Engine - Multi-frame 240ms EOG blink artifact sustains isArtifactFrozen across batch', () => {
  const sim = new SimulationEngine();
  sim.updateSettings({ threshold: 60, sensitivitySeconds: 0.1 });
  sim.setPreset('high_focus');

  for (let i = 0; i < 30; i++) {
    sim.stepSingleSyntheticSample();
  }

  sim.injectArtifact('blink');

  let artifactFrameCount = 0;
  let peakT3 = 0;
  for (let i = 0; i < 60; i++) {
    const step = sim.stepSingleSyntheticSample();
    if (step.telemetry.isArtifact) {
      artifactFrameCount++;
      assert.strictEqual(step.feedback.isArtifactFrozen, true);
      assert.strictEqual(step.feedback.overlayOpacity, 0, 'Blink spike must not cause false dimming');
      peakT3 = Math.max(peakT3, Math.abs(step.telemetry.rawChannels.t3));
    }
  }

  assert.strictEqual(artifactFrameCount, 60, 'Blink burst should span full 60 samples (240ms @ 250Hz)');
  assert.ok(peakT3 > 150, `Expected realistic EOG spike >150 uV on T3, got ${peakT3}`);

  // 61st frame returns to normal
  const postStep = sim.stepSingleSyntheticSample();
  assert.strictEqual(postStep.telemetry.isArtifact, false);
  assert.strictEqual(postStep.feedback.isArtifactFrozen, false);
});

test('Production Engine - Dry electrode contact loss pauses dimming adaptation and reports >2000 kOhm', () => {
  const sim = new SimulationEngine();
  sim.updateSettings({
    mode: 'concentration',
    threshold: 70,
    dimmingMaxOpacity: 0.75,
    sensitivitySeconds: 0.04,
    pauseOnContactLoss: true,
  });

  // Trigger dimming via attention_drift (~42%)
  sim.setPreset('attention_drift');
  let step = sim.stepSingleSyntheticSample();
  for (let i = 0; i < 15; i++) {
    step = sim.stepSingleSyntheticSample();
  }
  assert.ok(step.feedback.overlayOpacity > 0.2, 'Screen should be dimmed during attention drift');
  assert.ok((step.telemetry.impedanceKOhm?.o1 ?? 0) < 200, 'Connected dry electrode should be ~115 kOhm');

  // Detach O1 dry electrode -> must pause adaptation and clear false dimming
  sim.setElectrodeQuality('o1', false);
  step = sim.stepSingleSyntheticSample();
  assert.strictEqual(step.feedback.isContactOk, false);
  assert.strictEqual(step.feedback.isContactPaused, true);
  assert.strictEqual(step.feedback.overlayOpacity, 0, 'Detached electrode must safely pause dimming');
  assert.ok((step.telemetry.impedanceKOhm?.o1 ?? 0) >= 2000, 'Detached electrode must report >=2000 kOhm');
});

test('Production Spectral Math - Hann-windowed 250Hz bipolar DFT separates 10Hz Alpha vs 20Hz Beta', () => {
  const alphaWindow: RawEEGChannels[] = [];
  const betaWindow: RawEEGChannels[] = [];

  for (let n = 0; n < 250; n++) {
    const t = n / 250;
    // Pure 10 Hz differential wave on O1/O2 vs T3/T4
    alphaWindow.push({
      t3: 5,
      t4: 5,
      o1: 5 + 40 * Math.sin(2 * Math.PI * 10 * t),
      o2: 5 + 40 * Math.sin(2 * Math.PI * 10 * t),
    });

    // Pure 20 Hz differential wave on T3/T4
    betaWindow.push({
      t3: 35 * Math.sin(2 * Math.PI * 20 * t),
      t4: 35 * Math.sin(2 * Math.PI * 20 * t),
      o1: 0,
      o2: 0,
    });
  }

  const alphaSpec = computeBipolarSpectrum(alphaWindow);
  const betaSpec = computeBipolarSpectrum(betaWindow);

  assert.ok(alphaSpec.alpha > 85, `Expected >85% Alpha power for 10Hz signal, got ${alphaSpec.alpha}%`);
  assert.ok(betaSpec.beta > 85, `Expected >85% Beta power for 20Hz signal, got ${betaSpec.beta}%`);
});

test('Production CSV Pipeline - Parses raw 4-channel uV CSV, computes spectral indices, and detects >150uV spikes', () => {
  const rows = ['timestamp,t3,t4,o1,o2'];
  for (let i = 0; i < 300; i++) {
    const t = i / 250;
    const spike = i === 280 ? 220 : 0;
    const t3 = (30 * Math.sin(2 * Math.PI * 22 * t) + spike).toFixed(2);
    const t4 = (30 * Math.sin(2 * Math.PI * 22 * t) + spike).toFixed(2);
    const o1 = (8 * Math.sin(2 * Math.PI * 10 * t)).toFixed(2);
    const o2 = (8 * Math.sin(2 * Math.PI * 10 * t)).toFixed(2);
    rows.push(`${1761800000000 + i * 4},${t3},${t4},${o1},${o2}`);
  }

  const parsed = parseEEGFromCSV(rows.join('\n'));
  assert.strictEqual(parsed.length, 300);
  assert.strictEqual(parsed[280].isArtifact, true, '220 uV spike should be flagged as amplitude artifact');
  assert.ok(
    parsed[299].concentration > parsed[299].relaxation,
    `Dominant 22Hz Beta wave should yield concentration (${parsed[299].concentration}) > relaxation (${parsed[299].relaxation})`
  );
});

test('Production Calibration & Honest Hardware Bridge - No fake BLE connection when SDK is unlinked', async () => {
  const bleStatus = await tauriBridge.getDeviceStatus('bluetooth');
  assert.strictEqual(bleStatus.connected, false, 'Must NOT claim BLE connected without neurosdk2');
  assert.strictEqual(bleStatus.sdkIntegrated, false);
  assert.strictEqual(bleStatus.isSimulated, false);

  const simStatus = await tauriBridge.getDeviceStatus('simulator');
  assert.strictEqual(simStatus.connected, true);
  assert.strictEqual(simStatus.isSimulated, true);

  const scanRes = await tauriBridge.scanBrainBitDevices();
  assert.strictEqual(scanRes.devices.length, 0, 'Must NOT invent fake BrainBit BLE device IDs');

  // Verify mode-aware calibration excludes disconnected-electrode frames
  const frames = Array.from({ length: 100 }, (_, i) => ({
    timestamp: i * 4,
    rawChannels: { t3: 10, t4: 10, o1: 20, o2: 20 },
    concentration: 45,
    relaxation: 88,
    signalQuality: { t3: true, t4: true, o1: i >= 10, o2: true }, // first 10 frames bad contact
    isArtifact: false,
  }));

  const calmCalib = BiofeedbackEngine.calibrateBaseline(frames, 'relaxation');
  assert.strictEqual(calmCalib.sampleCount, 90);
  assert.strictEqual(calmCalib.baselineRelaxation, 88);
  assert.strictEqual(calmCalib.recommendedThreshold, 80); // 88 - 8 margin

  // Verify SessionRepository & CSV export
  const repo = new SessionRepository();
  const saved = repo.saveSession({
    startedAt: new Date(1761800000000),
    endedAt: new Date(1761800060000),
    deviceSource: 'simulator',
    mode: 'concentration',
    threshold: 60,
    stats: {
      durationSeconds: 60,
      timeInFocusSeconds: 48,
      timeInDimmingSeconds: 12,
      distractionEventsCount: 2,
      averageFocusScore: 74.5,
      minFocusScore: 41,
      maxFocusScore: 92,
      artifactCount: 3,
    },
  });
  assert.strictEqual(saved.isSimulated, true);

  const timelineCsv = exportTimelineToCSV([
    {
      elapsedSec: 1.0,
      concentration: 78,
      relaxation: 65,
      smoothedMetric: 78,
      overlayOpacityPct: 0,
      threshold: 60,
      isArtifact: false,
      isContactOk: true,
    },
  ]);
  assert.ok(timelineCsv.includes('elapsed_sec,concentration_pct'));
});
