import type {
  ChannelResistanceKOhm,
  ElectrodeSignalQuality,
} from './eegTypes';
import {
  ELECTRODE_RESISTANCE_LIMITS_KOHM,
  type EEGChannel,
} from './signalQuality';

export const GOOD_RESISTANCE_MAX_KOHM = 500;
export const ACCEPTABLE_RESISTANCE_MAX_KOHM = ELECTRODE_RESISTANCE_LIMITS_KOHM.t3.maxUsable;
export const FIT_HOLD_REQUIRED_MS = 3000;

export type ElectrodeFitTier = 'good' | 'acceptable' | 'poor' | 'open' | 'unmeasured';

export interface ChannelFitAssessment {
  channel: EEGChannel;
  tier: ElectrodeFitTier;
  kOhm: number | null;
  usable: boolean;
}

export type FitDiagnosticStatus =
  | 'unmeasured'
  | 'adjust_forehead'
  | 'adjust_occipital'
  | 'adjust_temporal'
  | 'adjust_all'
  | 'stabilizing'
  | 'verified';

export interface HeadbandFitDiagnostic {
  status: FitDiagnosticStatus;
  headline: string;
  guidance: string;
  channels: Record<EEGChannel, ChannelFitAssessment>;
  usableCount: number;
  progress: number;
}

const CHANNEL_ORDER: readonly EEGChannel[] = ['t3', 't4', 'o1', 'o2'];
const CHANNEL_LABELS: Record<EEGChannel, string> = {
  t3: 'T3',
  t4: 'T4',
  o1: 'O1',
  o2: 'O2',
};

export function classifyElectrodeImpedance(
  kOhm: number | null | undefined,
  signalOk?: boolean
): ElectrodeFitTier {
  if (kOhm === undefined) {
    return signalOk === false ? 'open' : 'unmeasured';
  }
  if (kOhm === null || !Number.isFinite(kOhm) || kOhm < 0) {
    return 'open';
  }
  if (signalOk === false) {
    return 'poor';
  }
  if (kOhm <= GOOD_RESISTANCE_MAX_KOHM) {
    return 'good';
  }
  if (kOhm <= ACCEPTABLE_RESISTANCE_MAX_KOHM) {
    return 'acceptable';
  }
  return 'poor';
}

export function diagnoseHeadbandFit(
  resistance: ChannelResistanceKOhm | undefined,
  signalQuality: ElectrodeSignalQuality | undefined,
  holdMs: number = 0
): HeadbandFitDiagnostic {
  const assessments = {} as Record<EEGChannel, ChannelFitAssessment>;
  let usableCount = 0;

  for (const ch of CHANNEL_ORDER) {
    const rawKOhm = resistance ? resistance[ch] : undefined;
    const tier = classifyElectrodeImpedance(rawKOhm, signalQuality?.[ch]);
    const usable = tier === 'good' || tier === 'acceptable';
    if (usable) usableCount += 1;
    assessments[ch] = {
      channel: ch,
      tier,
      kOhm: rawKOhm === undefined ? null : rawKOhm,
      usable,
    };
  }

  const allUnmeasured =
    !resistance || CHANNEL_ORDER.every((ch) => assessments[ch].tier === 'unmeasured');
  if (allUnmeasured) {
    return {
      status: 'unmeasured',
      headline: 'Проверка посадки не выполнена',
      guidance:
        'Нажмите «Проверить посадку», чтобы измерить контактное сопротивление сухих электродов T3, T4, O1, O2.',
      channels: assessments,
      usableCount: 0,
      progress: 0,
    };
  }

  const severeOpenAll = CHANNEL_ORDER.every((ch) => {
    const item = assessments[ch];
    return item.tier === 'open' || (item.kOhm !== null && item.kOhm > 2000);
  });
  if (severeOpenAll) {
    return {
      status: 'adjust_forehead',
      headline: 'Нет базового контакта на лбу (референт / GND)',
      guidance:
        'Все 4 канала в обрыве: проверьте, что ободок надет правильной стороной (блок сбоку), аккумулятор вставлен, а плоские лобные пластины плотно прижаты к чистой коже лба.',
      channels: assessments,
      usableCount,
      progress: 0,
    };
  }

  const temporalOk = assessments.t3.usable && assessments.t4.usable;
  const occipitalOk = assessments.o1.usable && assessments.o2.usable;

  if (!occipitalOk && temporalOk) {
    return {
      status: 'adjust_occipital',
      headline: 'Затылочные электроды (O1/O2) на волосах',
      guidance:
        'Пружинные зубцы O1/O2 упираются в волосы: слегка покачайте заднюю часть ободка вверх-вниз и прижмите, чтобы ножки прошли сквозь волосы к коже.',
      channels: assessments,
      usableCount,
      progress: usableCount / CHANNEL_ORDER.length * 0.25,
    };
  }

  if (!temporalOk && occipitalOk) {
    return {
      status: 'adjust_temporal',
      headline: 'Ослаблен прижим на висках (T3/T4)',
      guidance:
        'Височные электроды T3/T4 отходят от кожи: поправьте дужки над ушами и подтяните прилегание ремешка.',
      channels: assessments,
      usableCount,
      progress: usableCount / CHANNEL_ORDER.length * 0.25,
    };
  }

  if (usableCount < CHANNEL_ORDER.length) {
    const badLabels = CHANNEL_ORDER.filter((ch) => !assessments[ch].usable).map(
      (ch) => CHANNEL_LABELS[ch]
    );
    return {
      status: 'adjust_all',
      headline: `Поправьте электроды: ${badLabels.join(', ')}`,
      guidance: `Сопротивление выше ${ACCEPTABLE_RESISTANCE_MAX_KOHM} кОм на каналах ${badLabels.join(', ')}. Прижмите сухие электроды через волосы и убедитесь, что лобные пластины касаются кожи.`,
      channels: assessments,
      usableCount,
      progress: (usableCount / CHANNEL_ORDER.length) * 0.25,
    };
  }

  const clampedHold = Math.max(0, holdMs);
  const progress = Math.max(0, Math.min(1, clampedHold / FIT_HOLD_REQUIRED_MS));
  if (clampedHold < FIT_HOLD_REQUIRED_MS) {
    const remainingSec = ((FIT_HOLD_REQUIRED_MS - clampedHold) / 1000).toFixed(1);
    return {
      status: 'stabilizing',
      headline: 'Контакт найден — удерживайте посадку',
      guidance: `Все 4 канала ≤ ${ACCEPTABLE_RESISTANCE_MAX_KOHM} кОм. Осталось ${remainingSec} с для подтверждения стабильности.`,
      channels: assessments,
      usableCount,
      progress,
    };
  }

  const hasAcceptableOnly = CHANNEL_ORDER.some((ch) => assessments[ch].tier === 'acceptable');
  return {
    status: 'verified',
    headline: 'Ободок надет правильно ✓',
    guidance: hasAcceptableOnly
      ? 'Все 4 канала стабильны (рабочий контакт). Можно запускать поток ЭЭГ 250 Гц или слегка дожать каналы 500–800 кОм.'
      : 'Отличный контакт по всем 4 каналам и лобному референту — можно начинать БОС-сессию 250 Гц.',
    channels: assessments,
    usableCount,
    progress: 1,
  };
}

export class FitStabilityTracker {
  private startedAtMs: number | null = null;
  private holdMs: number = 0;
  private verified: boolean = false;

  public reset(): void {
    this.startedAtMs = null;
    this.holdMs = 0;
    this.verified = false;
  }

  public update(usableAllFour: boolean, nowMs: number = Date.now()): {
    holdMs: number;
    verified: boolean;
  } {
    if (!usableAllFour) {
      this.reset();
      return { holdMs: 0, verified: false };
    }
    if (this.startedAtMs === null) {
      this.startedAtMs = nowMs;
      this.holdMs = 0;
      this.verified = false;
      return { holdMs: 0, verified: false };
    }
    this.holdMs = Math.max(0, nowMs - this.startedAtMs);
    this.verified = this.holdMs >= FIT_HOLD_REQUIRED_MS;
    return { holdMs: this.holdMs, verified: this.verified };
  }

  public snapshot(): { holdMs: number; verified: boolean } {
    return { holdMs: this.holdMs, verified: this.verified };
  }
}
