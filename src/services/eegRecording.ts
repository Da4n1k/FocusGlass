import type {
  ChannelResistanceKOhm,
  ElectrodeSignalQuality,
  RawBrainBitPacket,
  RawEEGChannels,
} from './eegTypes';
import { ELECTRODE_RESISTANCE_LIMITS_KOHM } from './signalQuality';

export interface EEGRecordingFrame extends RawBrainBitPacket {
  timestamp: number;
  isArtifact: boolean;
}

export interface EEGRecording {
  name: string;
  sampleRateHz: number;
  durationSeconds: number;
  frames: EEGRecordingFrame[];
  format: 'csv' | 'json';
}

export class EEGRecordingParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EEGRecordingParseError';
  }
}

const CHANNELS = ['t3', 't4', 'o1', 'o2'] as const;
type Channel = (typeof CHANNELS)[number];

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[µμ]/g, 'u').replace(/[^a-z0-9]/g, '');
}

function numeric(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function truthy(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'ok', 'good', 'connected', 'pass'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'bad', 'lost', 'disconnected', 'fail'].includes(normalized)) return false;
  }
  return fallback;
}

function findKey(record: Record<string, unknown>, predicate: (normalized: string) => boolean): string | undefined {
  return Object.keys(record).find((key) => predicate(normalizeHeader(key)));
}

function channelKey(record: Record<string, unknown>, channel: Channel): string | undefined {
  return findKey(record, (key) =>
    new RegExp(`^(?:eeg|raw|channel\\d*)?${channel}(?:uv|mv)?$`).test(key)
  );
}

function timestampOf(value: unknown, fallback: number): number {
  if (typeof value === 'string' && !Number.isFinite(Number(value))) {
    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate)) return parsedDate;
  }
  return numeric(value) ?? fallback;
}

function parseFrame(
  record: Record<string, unknown>,
  index: number,
  defaultTimestamp: number
): EEGRecordingFrame {
  const rawChannels = {} as RawEEGChannels;
  for (const channel of CHANNELS) {
    const key = channelKey(record, channel);
    if (!key) {
      throw new EEGRecordingParseError(`Missing channel ${channel.toUpperCase()} in row ${index + 1}.`);
    }
    const value = numeric(record[key]);
    if (value === null) {
      throw new EEGRecordingParseError(`Invalid value for channel ${channel.toUpperCase()} in row ${index + 1}.`);
    }
    const normalized = normalizeHeader(key);
    rawChannels[channel] = normalized.endsWith('mv') ? value * 1000 : value;
  }

  const quality = {} as ElectrodeSignalQuality;
  const resistance = {} as ChannelResistanceKOhm;
  let hasResistance = false;
  let hasQuality = false;
  for (const channel of CHANNELS) {
    const qualityField = findKey(record, (key) =>
      key === `${channel}ok` || key === `quality${channel}` || key === `${channel}quality` ||
      key === `contact${channel}` || key === `${channel}contactok`
    );
    const resistanceField = findKey(record, (key) =>
      key === `${channel}kohm` || key === `${channel}k` || key === `${channel}resistance` ||
      key === `resistance${channel}` || key === `${channel}impedance` ||
      (key.includes(channel) && (key.includes('kohm') || key.includes('resistance') || key.includes('impedance')))
    );
    const resistanceValue = resistanceField ? numeric(record[resistanceField]) : null;
    if (resistanceField) hasResistance = true;
    if (qualityField) hasQuality = true;
    resistance[channel] = resistanceValue;
    const resistanceAcceptable = resistanceValue !== null && resistanceValue >= 0 &&
      resistanceValue <= ELECTRODE_RESISTANCE_LIMITS_KOHM[channel].maxUsable;
    quality[channel] = qualityField
      ? truthy(record[qualityField], false)
      : resistanceField
        ? resistanceAcceptable
        : true;
  }

  const timestampKey = findKey(record, (key) =>
    ['timestamp', 'timestampms', 'time', 'times', 'datetime', 'date', 'ts'].includes(key)
  );
  const artifactKey = findKey(record, (key) =>
    ['artifact', 'isartifact', 'artefact', 'isartefact'].includes(key) ||
    key.startsWith('artifact') || key.startsWith('artefact')
  );
  const packet: EEGRecordingFrame = {
    timestamp: timestampOf(timestampKey ? record[timestampKey] : undefined, defaultTimestamp),
    rawChannels,
    signalQuality: hasQuality || hasResistance ? quality : { t3: true, t4: true, o1: true, o2: true },
    ...(hasResistance ? { resistanceKOhm: resistance } : {}),
    isArtifact: artifactKey ? truthy(record[artifactKey], false) : false,
  };
  return packet;
}

function parseCsvRows(text: string): string[][] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const dataLines = lines.filter((line) => line.trim() && !line.trimStart().startsWith('#'));
  if (dataLines.length < 2) throw new EEGRecordingParseError('CSV must include a header and at least one data row.');
  const headerLine = dataLines[0];
  const candidates = [',', ';', '\t'];
  const delimiter = candidates.sort((a, b) =>
    (dataLines[0].split(b).length - 1) - (dataLines[0].split(a).length - 1)
  )[0];
  const split = (line: string): string[] => {
    const cells: string[] = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        cells.push(cell.trim()); cell = '';
      } else {
        cell += char;
      }
    }
    cells.push(cell.trim());
    return cells;
  };
  const headers = split(headerLine);
  const rows = dataLines.slice(1).map(split).filter((row) => row.some((cell) => cell !== ''));
  return [headers, ...rows];
}

function inferSampleRate(frames: EEGRecordingFrame[], declared: unknown): number {
  const declaredRate = numeric(declared);
  if (declaredRate !== null && declaredRate >= 1 && declaredRate <= 2000) return declaredRate;
  const deltas: number[] = [];
  for (let i = 1; i < Math.min(frames.length, 100); i++) {
    const delta = frames[i].timestamp - frames[i - 1].timestamp;
    if (delta > 0 && Number.isFinite(delta)) deltas.push(delta);
  }
  if (!deltas.length) return 250;
  deltas.sort((a, b) => a - b);
  const medianDelta = deltas[Math.floor(deltas.length / 2)];
  const samplesPerSecond = medianDelta < 1 ? 1 / medianDelta : 1000 / medianDelta;
  return Math.max(1, Math.min(2000, Math.round(samplesPerSecond)));
}

function normalizeFrameTimestamps(frames: EEGRecordingFrame[], sampleRateHz: number): void {
  const first = frames[0]?.timestamp ?? 0;
  const deltas = frames.slice(1, 100).map((frame, index) => frame.timestamp - frames[index].timestamp).filter((value) => value > 0);
  const medianDelta = deltas.length ? [...deltas].sort((a, b) => a - b)[Math.floor(deltas.length / 2)] : 0;
  const timestampsAreSeconds = medianDelta > 0 && medianDelta < 1;
  for (let i = 0; i < frames.length; i++) {
    const relative = frames[i].timestamp - first;
    const normalized = timestampsAreSeconds ? relative * 1000 : relative;
    frames[i].timestamp = Number.isFinite(normalized) && normalized >= 0
      ? normalized
      : (i * 1000) / sampleRateHz;
  }
}

export function parseEEGRecording(text: string, name = 'EEG recording'): EEGRecording {
  const trimmed = text.trim();
  if (!trimmed) throw new EEGRecordingParseError('The file is empty.');

  let frames: EEGRecordingFrame[];
  let declaredRate: unknown;
  let format: EEGRecording['format'];
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    format = 'json';
    let parsed: unknown;
    try { parsed = JSON.parse(trimmed); }
    catch { throw new EEGRecordingParseError('Could not parse JSON. Check the file format.'); }
    const root = Array.isArray(parsed) ? null : parsed as Record<string, unknown>;
    const samples = Array.isArray(parsed)
      ? parsed
      : root && (root.samples ?? root.frames ?? root.data ?? root.records);
    if (!Array.isArray(samples)) {
      throw new EEGRecordingParseError('JSON must contain a samples, frames, data or records array.');
    }
    declaredRate = root?.sampleRateHz ?? root?.samplingRateHz ?? root?.sample_rate_hz ?? root?.sampling_rate;
    frames = samples.map((sample, index) => {
      if (!sample || typeof sample !== 'object' || Array.isArray(sample)) {
        throw new EEGRecordingParseError(`JSON row ${index + 1} must be an object.`);
      }
      const row = sample as Record<string, unknown>;
      const nestedChannels = row.rawChannels ?? row.channels ?? row.eeg;
      const nestedQuality = row.signalQuality ?? row.quality;
      const nestedResistance = row.resistanceKOhm ?? row.resistance ?? row.impedanceKOhm;
      const source: Record<string, unknown> = {
        ...row,
        ...(nestedChannels && typeof nestedChannels === 'object' ? nestedChannels as Record<string, unknown> : {}),
      };
      if (nestedQuality && typeof nestedQuality === 'object') {
        for (const channel of CHANNELS) source[`${channel}Quality`] = (nestedQuality as Record<string, unknown>)[channel];
      }
      if (nestedResistance && typeof nestedResistance === 'object') {
        for (const channel of CHANNELS) source[`${channel}Resistance`] = (nestedResistance as Record<string, unknown>)[channel];
      }
      return parseFrame(source, index, index * 4);
    });
  } else {
    format = 'csv';
    const rows = parseCsvRows(trimmed);
    const headers = rows[0];
    const headerRecord: Record<string, unknown> = Object.fromEntries(headers.map((header) => [header, '']));
    if (!CHANNELS.every((channel) => channelKey(headerRecord, channel))) {
      throw new EEGRecordingParseError('CSV header must include T3, T4, O1 and O2 (values in µV; an mV suffix is supported).');
    }
    frames = rows.slice(1).map((row, index) => {
      const record = Object.fromEntries(headers.map((header, column) => [header, row[column] ?? '']));
      return parseFrame(record, index + 1, index * 4);
    });
    const metadata = trimmed.match(/(?:sample[_ ]?rate|sampling[_ ]?rate|частота)[^\d]{0,16}(\d+(?:[.,]\d+)?)/i);
    declaredRate = metadata?.[1]?.replace(',', '.');
  }

  if (!frames.length) throw new EEGRecordingParseError('The recording contains no EEG data rows.');
  const sampleRateHz = inferSampleRate(frames, declaredRate);
  normalizeFrameTimestamps(frames, sampleRateHz);
  const durationSeconds = frames.length > 1
    ? Math.max(0, (frames[frames.length - 1].timestamp - frames[0].timestamp) / 1000)
    : 1 / sampleRateHz;
  return { name, sampleRateHz, durationSeconds, frames, format };
}
