# EEG calibration and signal-quality method

Owner: Anna Nikolaevna Sokolova — EEG/БОС systems analyst and developer (ZyntZ)  
Scope: FocusGlass software screening and replay of prerecorded four-channel BrainBit/Neurotech EEG. This is an engineering method, not a clinical protocol or medical claim.

## Personal baseline and normalized score

Calibration accepts only frames marked clean, with all four quality bits true and (when supplied) usable electrode resistance. Values must be finite and within the source index range 0–100. A 10- or 30-second trial collects an ordered series of valid frames.

For Focus and Calm independently:

1. Divide the valid sequence into an earlier and a later half. Compute each half's median.
2. Set the personal baseline to `0.35 × earlier median + 0.65 × later median`. The later half receives greater weight so a sustained within-trial decline/rise is reflected in the current personal norm rather than being mistaken for a universal value.
3. Estimate robust spread as `1.4826 × median(|x − median(x)|)` (MAD). Report the Focus-index trend (`later-half median − earlier-half median`) as a fatigue proxy regardless of selected training mode; it is not interpreted as a diagnosis.
4. Reject application when fewer than 20 clean frames or less than half of all frames are usable. Confidence also decreases with poor coverage and variability.

For a selected metric `x`, baseline `b` and robust spread `s` (minimum scale 4 index points), the runtime score is:

```text
signedDeviation = clamp(100 × (x − b) / (2.5 × s), −100, +100)
percentScore    = (signedDeviation + 100) / 2
```

Thus the personal baseline is exactly deviation `0`, or `50%` on the display scale. Values beyond ±2.5 robust spread saturate at the endpoints. The configured/recommended cutoff remains in the original source-index scale; it is transformed with the same calibration before the comparison. This avoids comparing a normalized score to an unnormalized threshold. Until a calibration is explicitly applied, the engine retains the existing raw 0–100 metric behavior.

The recommended source-space cutoff is the selected baseline minus half its robust spread, rounded and clamped to 10–95. Calibration data is stored locally in the browser profile; it is not uploaded.

## Electrode resistance screening

All readings below are kΩ. The 800 kΩ limit is an operational project default, not a manufacturer-certified threshold or universal BrainBit limit. BrainBit SDK/export units and valid ranges depend on the specific device and SDK version; verify them against the actual source before interpreting contact quality.

| Channel | Position | Maximum usable | Reject |
| --- | --- | ---: | --- |
| T3 | Left temporal | 800 kΩ | >800, null, non-finite, negative, or quality=false |
| T4 | Right temporal | 800 kΩ | >800, null, non-finite, negative, or quality=false |
| O1 | Left occipital | 800 kΩ | >800, null, non-finite, negative, or quality=false |
| O2 | Right occipital | 800 kΩ | >800, null, non-finite, negative, or quality=false |

For operator guidance, 0–500 kΩ is shown as good contact and 500–800 kΩ as usable but worth rechecking. A packet with no resistance field uses the SDK quality bits for backward compatibility. If a resistance field is present, a null reading is treated as no contact. Loss on any one electrode pauses the full four-channel feedback and excludes the frame from calibration.

## Artifact and frame rejection

The real-time processor first forms bipolar leads `O1 − T3` and `O2 − T4`, then applies a second-order 50 Hz IIR notch. On each filtered lead it rejects a sample when absolute amplitude exceeds 110 µV or the difference from the prior filtered sample exceeds 75 µV. A bad side is excluded while the clean side can still contribute to spectral analysis; if both sides are rejected, the spectral estimate is held and the artifact frame does not update the baseline. An explicit artifact/artefact flag in a recording also freezes feedback for that frame.

This is a conservative threshold detector, not a validated EOG/EMG classifier: blink, movement, muscle and poor-contact artifacts can overlap. Inspect the raw recording and electrode contact before interpreting results. Clean baselines should be collected with a stable headband, relaxed jaw/face and minimal movement.

## Prerecorded EEG player

The local player accepts CSV/TSV/TXT with a header containing T3, T4, O1, O2 (µV by default; an `mV` channel suffix is converted to µV) and JSON arrays or objects with `samples`, `frames`, `data` or `records`. Optional timestamps, sample rate, per-channel quality, resistance and artifact flags are accepted. Resistance fields explicitly labelled `Ω`/`Ohm` are converted to kΩ; `kΩ`/`kOhm` fields are retained as kΩ. A recording-level `resistanceUnit`/`impedanceUnit` (or CSV comment metadata such as `# resistance_unit=Ohm`) applies to unlabelled resistance fields. For backward compatibility, unlabelled fields without metadata are interpreted as kΩ; confirm this assumption for the recording source before use. Unknown explicitly declared resistance units are rejected rather than guessed. `Infinity`, null and other non-finite resistance values are treated as unavailable contact and fail the contact check. If no sample rate is declared, timestamps are used to infer it; otherwise 250 Hz is assumed. Replays use the production signal processor and biofeedback engine; the simulator is paused while replay is active, and replay cannot be mixed with a Bluetooth stream.

Use known clean and artifact-contaminated Neurotech recordings to verify filter and rejection behavior. The parser expects raw channel samples; it does not claim compatibility with proprietary binary/EDF files. Convert those to the documented CSV/JSON layout first.

## Verification notes

Automated tests cover robust calibration, baseline-zero mapping, electrode resistance boundaries and unit normalization, CSV/JSON parsing, replay timing and artifact flags, alongside the existing signal-processing and app regression suites. Hardware impedance values and Neurotech-specific export variations should still be verified against the actual NeuroSDK/export version before release.
