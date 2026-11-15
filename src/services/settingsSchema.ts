import type { FocusGlassSettings } from './eegTypes';

export const DEFAULT_SETTINGS: FocusGlassSettings = {
  mode: 'concentration',
  deviceSource: 'simulator',
  threshold: 60,
  sensitivitySeconds: 2.0,
  dimmingMaxOpacity: 0.7,
  blurRadius: 16,
  audioFeedbackEnabled: false,
  audioVolume: 1.0,
  invertReaction: false,
  glassOpacity: 0.85,
};

type NumericSettingKey =
  | 'threshold'
  | 'sensitivitySeconds'
  | 'dimmingMaxOpacity'
  | 'blurRadius'
  | 'audioVolume'
  | 'glassOpacity';

/** Inclusive [min, max] limits, the single source of truth for every numeric setting. */
export const SETTING_RANGES: Readonly<Record<NumericSettingKey, readonly [number, number]>> = {
  threshold: [10, 95],
  sensitivitySeconds: [0.001, 10.0],
  dimmingMaxOpacity: [0.05, 0.95],
  blurRadius: [0, 32],
  audioVolume: [0, 1],
  glassOpacity: [0.1, 1.0],
};

const NUMERIC_KEYS = Object.keys(SETTING_RANGES) as NumericSettingKey[];

function pickNumber(value: unknown, key: NumericSettingKey, fallback: number): number {
  // typeof check first: Number('50') or Number(null) would silently coerce garbage.
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const [min, max] = SETTING_RANGES[key];
  return Math.max(min, Math.min(max, value));
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Builds a valid FocusGlassSettings from untrusted input (localStorage, IPC, partial updates).
 * Every field is validated independently: out-of-range numbers are clamped, while values of
 * the wrong type, NaN/Infinity or unknown enum members fall back to the matching field of `base`.
 */
export function sanitizeSettings(
  input: unknown,
  base: FocusGlassSettings = DEFAULT_SETTINGS
): FocusGlassSettings {
  const src: Record<string, unknown> =
    typeof input === 'object' && input !== null && !Array.isArray(input)
      ? (input as Record<string, unknown>)
      : {};

  const result: FocusGlassSettings = {
    ...base,
    mode: pickEnum(src.mode, ['concentration', 'relaxation'] as const, base.mode),
    deviceSource: pickEnum(src.deviceSource, ['simulator', 'bluetooth'] as const, base.deviceSource),
    audioFeedbackEnabled:
      typeof src.audioFeedbackEnabled === 'boolean'
        ? src.audioFeedbackEnabled
        : base.audioFeedbackEnabled,
    invertReaction:
      typeof src.invertReaction === 'boolean' ? src.invertReaction : base.invertReaction,
  };

  for (const key of NUMERIC_KEYS) {
    result[key] = pickNumber(src[key], key, base[key]);
  }

  return result;
}
