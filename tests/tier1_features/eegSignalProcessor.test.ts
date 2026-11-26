import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EEGSignalProcessor } from '../../src/services/eegSignalProcessor.ts';
import { SimulationEngine } from '../../src/services/simulationEngine.ts';

const ALL_OK = { t3: true, t4: true, o1: true, o2: true };

describe('EEGSignalProcessor — Bipolar Montage, 50 Hz Notch & Spectral Powers', () => {
  it('suppresses 50 Hz power-line interference while preserving 10 Hz occipital Alpha', () => {
    const dsp = new EEGSignalProcessor(250);
    const fs = 250;
    let lastSnap = dsp.processSample({ t3: 0, t4: 0, o1: 0, o2: 0 }, ALL_OK);

    // 1.5 seconds (375 samples): 25 uV 10 Hz Alpha + 95 uV 50 Hz mains interference
    // Raw sum reaches 120 uV (> 110 uV border), but after 50 Hz notch steady-state amplitude is ~25 uV
    for (let n = 0; n < 375; n++) {
      const t = n / fs;
      const alpha10 = 25 * Math.sin(2 * Math.PI * 10 * t);
      const hum50 = 95 * Math.sin(2 * Math.PI * 50 * t);
      lastSnap = dsp.processSample(
        {
          t3: 0,
          t4: 0,
          o1: alpha10 + hum50,
          o2: alpha10 + hum50,
        },
        ALL_OK
      );
    }

    assert.equal(lastSnap.bothSidesArtifacted, false);
    assert.ok(
      Math.abs(lastSnap.bipolarLeftUv) <= 28,
      `Expected filtered amplitude <= 28 uV after 50 Hz notch, got ${lastSnap.bipolarLeftUv}`
    );
    assert.ok(
      lastSnap.spectrum.alpha > 90,
      `Expected Alpha relative power > 90%, got ${lastSnap.spectrum.alpha}%`
    );
    assert.ok(
      lastSnap.estimatedRelaxation > 70,
      `Expected high estimated relaxation from dominant Alpha, got ${lastSnap.estimatedRelaxation}`
    );
  });

  it('distinguishes 6 Hz Theta, 10 Hz Alpha, and 20 Hz Beta rhythms', () => {
    const fs = 250;

    const runPureSine = (freqHz: number) => {
      const dsp = new EEGSignalProcessor(fs);
      let snap = dsp.processSample({ t3: 0, t4: 0, o1: 0, o2: 0 }, ALL_OK);
      for (let n = 0; n < 300; n++) {
        const val = 22 * Math.sin((2 * Math.PI * freqHz * n) / fs);
        snap = dsp.processSample({ t3: -val * 0.5, t4: -val * 0.5, o1: val * 0.5, o2: val * 0.5 }, ALL_OK);
      }
      return snap;
    };

    const thetaSnap = runPureSine(6);
    assert.ok(thetaSnap.spectrum.theta > 85, `Expected dominant Theta, got ${JSON.stringify(thetaSnap.spectrum)}`);
    assert.ok(thetaSnap.estimatedConcentration < 20);

    const alphaSnap = runPureSine(10);
    assert.ok(alphaSnap.spectrum.alpha > 85, `Expected dominant Alpha, got ${JSON.stringify(alphaSnap.spectrum)}`);

    const betaSnap = runPureSine(20);
    assert.ok(betaSnap.spectrum.beta > 85, `Expected dominant Beta, got ${JSON.stringify(betaSnap.spectrum)}`);
    assert.ok(betaSnap.estimatedConcentration > 80);
  });

  it('falls back to clean hemisphere on unilateral contact loss and flags bilateral >110 uV artifacts', () => {
    const dsp = new EEGSignalProcessor(250);
    const fs = 250;
    let snap = dsp.processSample({ t3: 0, t4: 0, o1: 0, o2: 0 }, ALL_OK);

    // Left T3 detached, Right O2-T4 carries clean 20 Hz Beta
    for (let n = 0; n < 300; n++) {
      const beta20 = 24 * Math.sin((2 * Math.PI * 20 * n) / fs);
      snap = dsp.processSample(
        { t3: 90, t4: 0, o1: 0, o2: beta20 },
        { t3: false, t4: true, o1: true, o2: true }
      );
    }

    assert.equal(snap.leftArtifact, true);
    assert.equal(snap.rightArtifact, false);
    assert.equal(snap.bothSidesArtifacted, false);
    assert.ok(snap.spectrum.beta > 85);

    // Bilateral EOG blink pulse > 110 uV (realistic 24 ms sustained rise through 1.5–35 Hz bandpass)
    let spikeSnap = snap;
    for (let n = 0; n < 6; n++) {
      spikeSnap = dsp.processSample(
        { t3: -95, t4: -95, o1: 95, o2: 95 },
        ALL_OK
      );
    }
    assert.equal(spikeSnap.leftArtifact, true);
    assert.equal(spikeSnap.rightArtifact, true);
    assert.equal(spikeSnap.bothSidesArtifacted, true);
  });

  it('drives SimulationEngine.ingestRawBrainBitPacket without EmotionalMath indices', () => {
    const engine = new SimulationEngine();
    engine.updateSettings({
      deviceSource: 'bluetooth',
      mode: 'concentration',
      threshold: 65,
      sensitivitySeconds: 1.0,
    });

    let lastFeedback = engine.ingestRawBrainBitPacket({
      timestamp: 1000,
      rawChannels: { t3: 0, t4: 0, o1: 0, o2: 0 },
    });

    // Feed 1.5 seconds of dominant 6 Hz Theta (attention drift) -> estimated concentration drops below 65%
    for (let n = 1; n <= 375; n++) {
      const theta6 = 25 * Math.sin((2 * Math.PI * 6 * n) / 250);
      lastFeedback = engine.ingestRawBrainBitPacket({
        timestamp: 1000 + n * 4,
        rawChannels: { t3: 0, t4: 0, o1: theta6, o2: theta6 },
        signalQuality: ALL_OK,
      });
    }

    assert.equal(lastFeedback.isContactOk, true);
    assert.equal(lastFeedback.isDimmingActive, true);
    assert.ok(lastFeedback.overlayOpacity > 0.15);
  });

  it('removes realistic ±120 mV BrainBit dry-electrode DC offset without false artifact freeze', () => {
    const dsp = new EEGSignalProcessor(250);
    const fs = 250;
    let lastSnap = dsp.processSample({ t3: -35_000, t4: 42_000, o1: 85_000, o2: -60_000 }, ALL_OK);

    // 120 mV differential DC offset (O1 - T3 = +120,000 uV, O2 - T4 = -102,000 uV) + 25 uV 10 Hz Alpha
    for (let n = 1; n < 375; n++) {
      const t = n / fs;
      const alpha10 = 25 * Math.sin(2 * Math.PI * 10 * t);
      lastSnap = dsp.processSample(
        {
          t3: -35_000,
          t4: 42_000,
          o1: 85_000 + alpha10,
          o2: -60_000 + alpha10,
        },
        ALL_OK
      );
    }

    assert.equal(lastSnap.bothSidesArtifacted, false);
    assert.ok(
      Math.abs(lastSnap.bipolarLeftUv) <= 28,
      `Expected DC-removed Alpha <= 28 uV, got ${lastSnap.bipolarLeftUv}`
    );
    assert.ok(
      lastSnap.spectrum.alpha > 90,
      `Expected Alpha relative power > 90% despite 120 mV DC offset, got ${lastSnap.spectrum.alpha}%`
    );
  });

  it('rejects out-of-band switching-PSU EMI (66.75 Hz + 116.5 Hz + 50.25 Hz) without false artifact freeze', () => {
    const dsp = new EEGSignalProcessor(250);
    const fs = 250;
    let lastSnap = dsp.processSample({ t3: 0, t4: 0, o1: 0, o2: 0 }, ALL_OK);
    let postSettleArtifacts = 0;

    // 2.0 s of 22 uV 20 Hz Beta overlaid with severe EMI seen on real dry BrainBit T4
    for (let n = 1; n < 500; n++) {
      const t = n / fs;
      const beta20 = 22 * Math.sin(2 * Math.PI * 20 * t);
      const emi =
        90 * Math.sin(2 * Math.PI * 50.25 * t) +
        90 * Math.sin(2 * Math.PI * 66.75 * t) +
        60 * Math.sin(2 * Math.PI * 116.5 * t);
      lastSnap = dsp.processSample(
        { t3: 0, t4: -emi, o1: beta20, o2: beta20 },
        ALL_OK
      );
      if (n >= 100 && lastSnap.rightArtifact) {
        postSettleArtifacts += 1;
      }
    }

    assert.equal(
      postSettleArtifacts,
      0,
      `Out-of-band EMI must not trigger false artifacts after settle (got ${postSettleArtifacts})`
    );
    assert.ok(
      Math.abs(lastSnap.bipolarRightUv) <= 32,
      `Expected heavily attenuated EMI on right hemisphere <= 32 uV, got ${lastSnap.bipolarRightUv}`
    );
    assert.ok(
      lastSnap.spectrum.beta > 85,
      `Expected 20 Hz Beta passband preserved (> 85%), got ${lastSnap.spectrum.beta}%`
    );
  });
});
