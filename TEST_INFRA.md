# FocusGlass E2E Testing Infrastructure (Dual Track)

## 1. Overview & Philosophy
FocusGlass is a desktop biological feedback (БОС) ambient system for **ООО НМФ «Нейротех»** powered by the **BrainBit** EEG headband. Because FocusGlass operates as an ambient, non-intrusive screen overlay that continuously monitors cognitive metrics (Concentration and Relaxation) and dynamically alters screen opacity to train focus, the software demands strict behavioral fidelity, mathematical stability, and zero false-positive flickering.

This document establishes the architecture, test harness contracts, verification rules, and execution methodology for the **4-Tier E2E Testing Suite**.

---

## 2. 4-Tier Testing Methodology

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Tier 4: Scenarios                              │
│   Full 25-min Pomodoro session: baseline -> drift -> dim -> recovery  │
├────────────────────────────────────────────────────────────────────────┤
│                   Tier 3: Cross-Feature Integration                    │
│   Dimming + Audio БОС, Calibration + Dynamic Thresholds, Sim Switching │
├────────────────────────────────────────────────────────────────────────┤
│                     Tier 2: Boundary & Corner Cases                    │
│   0%/100% limits, zero sensitivity, rapid slider sweeps, artifact suppression│
├────────────────────────────────────────────────────────────────────────┤
│                       Tier 1: Feature Coverage                         │
│   >=5 tests per core feature: Opacity, Click-Through, Modes,           │
│   Thresholds, Telemetry Stream, 4-Channel Electrode Quality           │
└────────────────────────────────────────────────────────────────────────┘
```

### Tier 1: Feature Coverage (Core Functionality)
Each core feature has at least 5 isolated, deterministic test cases verifying specification adherence:
1. **Overlay Opacity Transitions** (>=5 tests):
   - Linear dimming response when focus drops below threshold.
   - Zero dimming (opacity = 0) when focus is at or above threshold.
   - Proportional scaling up to configured `dimmingMaxOpacity`.
   - Smooth interpolation between consecutive telemetry frames.
   - Respect for `blurRadius` visual parameter mapping.
2. **Click-Through Toggles** (>=5 tests):
   - Tauri IPC `set_click_through(true)` passes events through window (`WS_EX_TRANSPARENT`).
   - `set_click_through(false)` captures cursor events for HUD interactions.
   - Hotkey / IPC toggle state reflection.
   - Idempotency when setting identical click-through states repeatedly.
   - Preserves underlying focus indicator readability during click-through.
3. **Training Modes** (>=5 tests):
   - `concentration` mode: Dims screen when focus < threshold (Beta rhythm power).
   - `relaxation` mode: Dims screen when calmness < threshold (Alpha rhythm power).
   - Instant mode switching updates active metric evaluation.
   - Mode persistence in settings store.
   - Distinct visual state cues for active training mode.
4. **Threshold Adjustment** (>=5 tests):
   - Threshold value modification dynamically shifts the dimming boundary.
   - Lowering threshold clears dimming for borderline focus scores.
   - Raising threshold triggers dimming for previously tolerated scores.
   - Clamping within safe range `[10, 95]`.
   - Dynamic threshold adjustments during active biofeedback streaming.
5. **Telemetry Stream (250Hz)** (>=5 tests):
   - 250Hz sample processing rate (4ms interval).
   - Correct parsing of 4 EEG channels (T3, T4, O1, O2).
   - Concentration and Relaxation indices valid range `[0, 100]`.
   - Moving average buffer computes correct smoothing over `sensitivitySeconds`.
   - Signal quality metadata propagated with every telemetry packet.
6. **4-Channel Electrode Quality Display** (>=5 tests):
   - Individual monitoring of T3, T4, O1, O2 contact impedance.
   - Degraded signal status triggered if any electrode loses contact.
   - Fully intact status when all 4 electrodes report true.
   - Dynamic recovery when lost electrode re-establishes contact.
   - Contact loss prevents erroneous high-concentration classification.

### Tier 2: Boundary & Corner Cases
Adversarial and extreme conditions:
- **0% and 100% Focus Limits**: Boundary stability without NaN or division by zero.
- **Zero Sensitivity (Near-Zero smoothing)**: Instantaneous response without numeric underflow or infinite oscillation.
- **Rapid Threshold Sweeps**: Rapidly toggling threshold between 10% and 90% at 100Hz while telemetry is streaming.
- **Artifact Burst Filtering**: Rapid muscle contraction (EMG) or eye blink (EOG) bursts (`isArtifact: true`) freeze opacity updates to prevent optical flashing.

### Tier 3: Cross-Feature Combinations
Interaction verification across subsystems:
- **Dimming + Audio БОС**: Visual dimming combined with pink noise audio modulation. Volume scales proportionally with visual deficit.
- **Calibration + Dynamic Thresholding**: 30-second baseline recording computes personalized threshold, dynamically applied to active session.
- **Simulation Mode Switching**: Hot-swapping between `simulator` and `bluetooth` sources without dropping active session state.

### Tier 4: Real-World Application Scenarios
End-to-end user journeys:
- **Full 25-Minute Pomodoro Focus Session Simulation**:
  - Phase 1 (0-3 min): Baseline calibration & initial high focus (85-90%, 0% dimming).
  - Phase 2 (3-12 min): Deep work flow (70-80%, clear screen).
  - Phase 3 (12-16 min): Gradual attention dip (focus drifts down to 42%, crossing 60% threshold -> progressive dimming to 65% opacity).
  - Phase 4 (16-19 min): Biofeedback awareness & conscious refocusing (focus recovers to 75% -> overlay smoothly clears).
  - Phase 5 (19-24 min): Stable end-of-session work with minor blink artifacts.
  - Phase 6 (25 min): Session complete -> Summary stats: Time in Focus, Distraction Count, Average Focus Score.

---

## 3. Directory Layout

```
tests/
├── contracts/
│   └── telemetry.ts           # Canonical TypeScript interfaces matching PROJECT.md
├── fixtures/
│   ├── eegGenerator.ts        # 250Hz synthetic 4-channel EEG waveform generator
│   └── artifactBurst.ts       # EMG/EOG artifact burst patterns
├── harness/
│   ├── biofeedbackEngine.ts   # Reference mathematical biofeedback engine
│   └── ipcMock.ts             # Mock Tauri IPC command dispatcher
├── tier1_features/
│   ├── opacityTransitions.test.ts  # >=5 tests
│   ├── clickThrough.test.ts        # >=5 tests
│   ├── trainingModes.test.ts       # >=5 tests
│   ├── thresholdAdjustment.test.ts # >=5 tests
│   ├── telemetryStream.test.ts     # >=5 tests
│   └── electrodeQuality.test.ts    # >=5 tests
├── tier2_boundaries/
│   ├── extremeLimits.test.ts
│   ├── rapidSliders.test.ts
│   └── artifactSuppression.test.ts
├── tier3_combinations/
│   ├── dimmingAudio.test.ts
│   ├── calibrationThreshold.test.ts
│   └── modeSwitching.test.ts
├── tier4_scenarios/
│   └── pomodoroSession.test.ts
├── runner.ts                  # Master runner and test orchestrator
└── package.json               # Test workspace definition & scripts
```

---

## 4. Test Execution & Verification

### Running with Node.js Native Test Runner (Node 25+)
Node 25 natively executes TypeScript files with `--experimental-strip-types`.

```bash
# Run all tiers via master test runner
node --experimental-strip-types tests/runner.ts

# Or run individual tier test files using node:test
node --experimental-strip-types --test tests/tier1_features/*.test.ts
node --experimental-strip-types --test tests/tier2_boundaries/*.test.ts
node --experimental-strip-types --test tests/tier3_combinations/*.test.ts
node --experimental-strip-types --test tests/tier4_scenarios/*.test.ts
```

---

## 5. Pass/Fail Gates
- **Tier 1**: All 6 core features must achieve 100% pass across >=30 individual tests.
- **Tier 2**: 0 mathematical exceptions, zero NaN values, strict artifact freezing.
- **Tier 3**: Cross-feature state changes propagate without race conditions.
- **Tier 4**: The 25-minute Pomodoro simulation completes with exact metric reconciliation.
