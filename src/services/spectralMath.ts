import type {
  EEGTelemetry,
  RawEEGChannels,
  RelativeSpectrum,
  SavedSessionRecord,
  TimelineSample,
} from './eegTypes.ts';

const SAMPLE_RATE_HZ = 250;
const WINDOW_SIZE = 250; // 1.0s window -> exact 1.0 Hz frequency resolution
const MAX_BIN_HZ = 45;   // Below 50 Hz powerline hum

// Precompute Hann window and trigonometric tables for N = 250, k = 1..45
const HANN_WINDOW = new Float64Array(WINDOW_SIZE);
for (let n = 0; n < WINDOW_SIZE; n++) {
  HANN_WINDOW[n] = 0.5 * (1 - Math.cos((2 * Math.PI * n) / (WINDOW_SIZE - 1)));
}

const COS_TABLE: Float64Array[] = [];
const SIN_TABLE: Float64Array[] = [];
for (let k = 0; k <= MAX_BIN_HZ; k++) {
  const cosRow = new Float64Array(WINDOW_SIZE);
  const sinRow = new Float64Array(WINDOW_SIZE);
  for (let n = 0; n < WINDOW_SIZE; n++) {
    const angle = (2 * Math.PI * k * n) / WINDOW_SIZE;
    cosRow[n] = Math.cos(angle);
    sinRow[n] = Math.sin(angle);
  }
  COS_TABLE.push(cosRow);
  SIN_TABLE.push(sinRow);
}

/**
 * Computes relative EEG spectral band power (%) on BrainBit bipolar derivations:
 * Left bipolar = T3 - O1, Right bipolar = T4 - O2 (matching BrainBit EmotionalMath montage).
 */
export function computeBipolarSpectrum(windowSamples: RawEEGChannels[]): RelativeSpectrum {
  if (windowSamples.length < 32) {
    return { delta: 10, theta: 18, alpha: 32, beta: 34, gamma: 6 };
  }

  const samples =
    windowSamples.length >= WINDOW_SIZE
      ? windowSamples.slice(-WINDOW_SIZE)
      : windowSamples;
  const N = samples.length;

  // Build DC-removed bipolar channels
  let meanL = 0;
  let meanR = 0;
  const left = new Float64Array(N);
  const right = new Float64Array(N);

  for (let i = 0; i < N; i++) {
    const bL = samples[i].t3 - samples[i].o1;
    const bR = samples[i].t4 - samples[i].o2;
    left[i] = bL;
    right[i] = bR;
    meanL += bL;
    meanR += bR;
  }
  meanL /= N;
  meanR /= N;

  for (let i = 0; i < N; i++) {
    const w = N === WINDOW_SIZE ? HANN_WINDOW[i] : 0.5 * (1 - Math.cos((2 * Math.PI * i) / Math.max(1, N - 1)));
    left[i] = (left[i] - meanL) * w;
    right[i] = (right[i] - meanR) * w;
  }

  let deltaPower = 0;
  let thetaPower = 0;
  let alphaPower = 0;
  let betaPower = 0;
  let gammaPower = 0;

  for (let hz = 1; hz <= MAX_BIN_HZ; hz++) {
    let reL = 0;
    let imL = 0;
    let reR = 0;
    let imR = 0;

    if (N === WINDOW_SIZE) {
      const cosRow = COS_TABLE[hz];
      const sinRow = SIN_TABLE[hz];
      for (let n = 0; n < WINDOW_SIZE; n++) {
        const c = cosRow[n];
        const s = sinRow[n];
        reL += left[n] * c;
        imL -= left[n] * s;
        reR += right[n] * c;
        imR -= right[n] * s;
      }
    } else {
      const freqScale = (2 * Math.PI * hz) / SAMPLE_RATE_HZ;
      for (let n = 0; n < N; n++) {
        const angle = freqScale * n;
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        reL += left[n] * c;
        imL -= left[n] * s;
        reR += right[n] * c;
        imR -= right[n] * s;
      }
    }

    const binPower = 0.5 * (reL * reL + imL * imL + reR * reR + imR * imR);

    if (hz >= 1 && hz <= 3) deltaPower += binPower;
    else if (hz >= 4 && hz <= 7) thetaPower += binPower;
    else if (hz >= 8 && hz <= 13) alphaPower += binPower;
    else if (hz >= 14 && hz <= 30) betaPower += binPower;
    else if (hz >= 31 && hz <= 45) gammaPower += binPower;
  }

  const totalPower = deltaPower + thetaPower + alphaPower + betaPower + gammaPower;
  if (totalPower <= 1e-9 || !Number.isFinite(totalPower)) {
    return { delta: 20, theta: 20, alpha: 25, beta: 25, gamma: 10 };
  }

  return {
    delta: Number(((deltaPower / totalPower) * 100).toFixed(1)),
    theta: Number(((thetaPower / totalPower) * 100).toFixed(1)),
    alpha: Number(((alphaPower / totalPower) * 100).toFixed(1)),
    beta: Number(((betaPower / totalPower) * 100).toFixed(1)),
    gamma: Number(((gammaPower / totalPower) * 100).toFixed(1)),
  };
}

/**
 * Estimates Concentration (Beta engagement) and Relaxation (Alpha calmness) indices [0..100]
 * from relative spectral band powers when EmotionalMath indices are not precomputed (e.g. raw CSV replay).
 */
export function estimateIndicesFromSpectrum(spectrum: RelativeSpectrum): {
  concentration: number;
  relaxation: number;
} {
  // Engagement index beta / (alpha + theta), mapped smoothly via rational saturation to [0, 100]
  const slowWave = Math.max(1.0, spectrum.alpha + spectrum.theta);
  const engagementRatio = spectrum.beta / slowWave;
  const concentration = Math.max(
    0,
    Math.min(100, Number(((engagementRatio / (engagementRatio + 0.55)) * 100).toFixed(2)))
  );

  // Alpha relaxation index alpha / (beta + theta)
  const activeAndTheta = Math.max(1.0, spectrum.beta + 0.8 * spectrum.theta);
  const calmRatio = spectrum.alpha / activeAndTheta;
  const relaxation = Math.max(
    0,
    Math.min(100, Number(((calmRatio / (calmRatio + 0.6)) * 100).toFixed(2)))
  );

  return { concentration, relaxation };
}

/**
 * Simple amplitude threshold detector for gross EOG/EMG spikes (>150 uV) in raw recordings.
 */
export function detectAmplitudeArtifact(channels: RawEEGChannels, thresholdUv: number = 150): boolean {
  return (
    Math.abs(channels.t3) > thresholdUv ||
    Math.abs(channels.t4) > thresholdUv ||
    Math.abs(channels.o1) > thresholdUv ||
    Math.abs(channels.o2) > thresholdUv
  );
}

/**
 * Parses CSV EEG recordings (either full FocusGlass telemetry CSV or 4-channel MNE/BrainBit uV CSV).
 * Supported headers (case-insensitive):
 * - t3, t4, o1, o2 (required if concentration/relaxation absent)
 * - timestamp / time (optional)
 * - concentration / focus, relaxation / calm (optional; computed spectrally if omitted!)
 * - is_artifact / artifact (optional)
 */
export function parseEEGFromCSV(csvContent: string): EEGTelemetry[] {
  const lines = csvContent
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length < 2) {
    throw new Error('CSV-файл пуст или не содержит строк данных.');
  }

  const delimiter = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0]
    .split(delimiter)
    .map((h) => h.trim().toLowerCase().replace(/^["']|["']$/g, ''));

  const findCol = (aliases: string[]): number =>
    headers.findIndex((h) => aliases.includes(h));

  const idxTs = findCol(['timestamp', 'time', 'time_ms', 't']);
  const idxT3 = findCol(['t3', 'eeg_t3', 'ch_t3']);
  const idxT4 = findCol(['t4', 'eeg_t4', 'ch_t4']);
  const idxO1 = findCol(['o1', 'eeg_o1', 'ch_o1']);
  const idxO2 = findCol(['o2', 'eeg_o2', 'ch_o2']);
  const idxConc = findCol(['concentration', 'focus', 'rel_attention', 'attention']);
  const idxRelax = findCol(['relaxation', 'calm', 'rel_relaxation']);
  const idxArt = findCol(['isartifact', 'is_artifact', 'artifact']);

  const hasRawChannels = idxT3 !== -1 && idxT4 !== -1 && idxO1 !== -1 && idxO2 !== -1;
  const hasPrecomputedMetrics = idxConc !== -1 || idxRelax !== -1;

  if (!hasRawChannels && !hasPrecomputedMetrics) {
    throw new Error(
      'Не найдены обязательные столбцы CSV: укажите каналы (t3,t4,o1,o2) и/или метрики (concentration,relaxation).'
    );
  }

  const parsed: EEGTelemetry[] = [];
  const rollingRaw: RawEEGChannels[] = [];
  let cachedSpectrum: RelativeSpectrum = { delta: 10, theta: 18, alpha: 32, beta: 34, gamma: 6 };
  let cachedDerived = { concentration: 65, relaxation: 65 };
  const baseTimestamp = Date.now();

  for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
    const cols = lines[rowIdx].split(delimiter).map((c) => c.trim());
    if (cols.length < 2) continue;

    const num = (colIdx: number, fallback: number): number => {
      if (colIdx === -1 || colIdx >= cols.length) return fallback;
      const val = Number(cols[colIdx]);
      return Number.isFinite(val) ? val : fallback;
    };

    const rawChannels: RawEEGChannels = hasRawChannels
      ? {
          t3: num(idxT3, 0),
          t4: num(idxT4, 0),
          o1: num(idxO1, 0),
          o2: num(idxO2, 0),
        }
      : { t3: 0, t4: 0, o1: 0, o2: 0 };

    rollingRaw.push(rawChannels);
    if (rollingRaw.length > WINDOW_SIZE) {
      rollingRaw.shift();
    }

    // Recompute spectrum every 25 samples (10 Hz) once enough data is buffered
    if (hasRawChannels && (rowIdx % 25 === 0 || rowIdx === lines.length - 1) && rollingRaw.length >= 32) {
      cachedSpectrum = computeBipolarSpectrum(rollingRaw);
      cachedDerived = estimateIndicesFromSpectrum(cachedSpectrum);
    }

    const concentration =
      idxConc !== -1
        ? Math.max(0, Math.min(100, num(idxConc, cachedDerived.concentration)))
        : cachedDerived.concentration;
    const relaxation =
      idxRelax !== -1
        ? Math.max(0, Math.min(100, num(idxRelax, cachedDerived.relaxation)))
        : cachedDerived.relaxation;

    const isArtifact =
      idxArt !== -1
        ? cols[idxArt] === '1' || cols[idxArt]?.toLowerCase() === 'true'
        : hasRawChannels
        ? detectAmplitudeArtifact(rawChannels)
        : false;

    const rawTs = idxTs !== -1 ? num(idxTs, baseTimestamp + rowIdx * 4) : baseTimestamp + rowIdx * 4;
    // Convert seconds to ms if timestamps look like small float seconds (e.g., MNE-Python time column)
    const timestamp = rawTs < 1e9 ? Math.round(baseTimestamp + rawTs * 1000) : Math.round(rawTs);

    parsed.push({
      timestamp,
      rawChannels,
      concentration,
      relaxation,
      signalQuality: { t3: true, t4: true, o1: true, o2: true },
      isArtifact,
      spectrum: { ...cachedSpectrum },
      origin: 'csv_replay',
    });
  }

  if (parsed.length === 0) {
    throw new Error('В CSV-файле не удалось прочитать ни одного валидного отсчёта ЭЭГ.');
  }

  return parsed;
}

/**
 * Formats recorded session timeline into CSV suitable for Python (pandas / MNE / statsmodels) or Excel.
 */
export function exportTimelineToCSV(samples: TimelineSample[]): string {
  const header =
    'elapsed_sec,concentration_pct,relaxation_pct,smoothed_metric_pct,overlay_opacity_pct,threshold_pct,is_artifact,is_contact_ok';
  const rows = samples.map((s) =>
    [
      s.elapsedSec.toFixed(1),
      s.concentration.toFixed(2),
      s.relaxation.toFixed(2),
      s.smoothedMetric.toFixed(2),
      s.overlayOpacityPct.toFixed(2),
      s.threshold,
      s.isArtifact ? 1 : 0,
      s.isContactOk ? 1 : 0,
    ].join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Formats saved session history journal into CSV.
 */
export function exportSessionsJournalToCSV(records: SavedSessionRecord[]): string {
  const header =
    'id,started_at,ended_at,device_source,is_simulated,mode,threshold_pct,duration_sec,time_in_focus_sec,time_in_dimming_sec,distraction_events,avg_score_pct,min_score_pct,max_score_pct,artifact_count';
  const rows = records.map((r) =>
    [
      r.id,
      r.startedAt,
      r.endedAt,
      r.deviceSource,
      r.isSimulated ? 1 : 0,
      r.mode,
      r.threshold,
      r.stats.durationSeconds.toFixed(1),
      r.stats.timeInFocusSeconds.toFixed(1),
      r.stats.timeInDimmingSeconds.toFixed(1),
      r.stats.distractionEventsCount,
      r.stats.averageFocusScore.toFixed(2),
      r.stats.minFocusScore.toFixed(2),
      r.stats.maxFocusScore.toFixed(2),
      r.stats.artifactCount,
    ].join(',')
  );
  return [header, ...rows].join('\n');
}
