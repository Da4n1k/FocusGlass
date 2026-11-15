import type {
  ChannelResistanceKOhm,
  EEGTelemetry,
  ElectrodeSignalQuality,
} from './eegTypes';

/**
 * Practical screening limits used by FocusGlass for dry BrainBit electrodes.
 * These are software acceptance limits, not a manufacturer specification or
 * clinical judgement. Resistances are in kΩ.
 */
export const ELECTRODE_RESISTANCE_LIMITS_KOHM = {
  t3: { maxUsable: 800 },
  t4: { maxUsable: 800 },
  o1: { maxUsable: 800 },
  o2: { maxUsable: 800 },
} as const;

export type EEGChannel = keyof ElectrodeSignalQuality;

export function isElectrodeContactUsable(
  channel: EEGChannel,
  quality: ElectrodeSignalQuality,
  resistance?: ChannelResistanceKOhm
): boolean {
  if (!quality[channel]) return false;
  if (!resistance) return true; // Older SDK packets may not expose impedance.
  const value = resistance[channel];
  return value !== null && Number.isFinite(value) && value >= 0 &&
    value <= ELECTRODE_RESISTANCE_LIMITS_KOHM[channel].maxUsable;
}

export function areAllElectrodesUsable(
  quality: ElectrodeSignalQuality,
  resistance?: ChannelResistanceKOhm
): boolean {
  return (['t3', 't4', 'o1', 'o2'] as const).every((channel) =>
    isElectrodeContactUsable(channel, quality, resistance)
  );
}

export function isTelemetryUsable(telemetry: EEGTelemetry): boolean {
  return !telemetry.isArtifact &&
    areAllElectrodesUsable(telemetry.signalQuality, telemetry.resistanceKOhm);
}
