import type { FocusTimelinePoint, SessionRecord } from './eegTypes';

export interface FocusDeltaSummary {
  text: string;
  tone: 'positive' | 'negative' | 'neutral';
  deltaPct: number | null;
}

/**
 * Computes percentage of session duration spent in target focus/calm state [0, 100].
 */
export function computeInFocusPct(timeInFocusSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return 0;
  }
  const rawPct = Math.round((Math.max(0, timeInFocusSeconds) / durationSeconds) * 100);
  return Math.max(0, Math.min(100, rawPct));
}

/**
 * Formats comparison sublabel under "Время в фокусе" against the most recent previous session.
 */
export function getFocusDeltaSummary(
  currentInFocusPct: number,
  currentRecordId: string,
  sessionHistory: SessionRecord[],
  hasCompletedSession: boolean
): FocusDeltaSummary {
  let previousSession: SessionRecord | undefined;
  if (hasCompletedSession) {
    const currentIndex = sessionHistory.findIndex((s) => s.id === currentRecordId);
    const searchPool = currentIndex >= 0 ? sessionHistory.slice(currentIndex + 1) : sessionHistory;
    previousSession = searchPool.find((s) => s.id !== currentRecordId && s.durationSeconds > 0);
  } else {
    previousSession =
      sessionHistory.slice(1).find((s) => s.durationSeconds > 0) ??
      sessionHistory.find((s) => s.durationSeconds > 0);
  }

  if (!previousSession) {
    return {
      text: 'первая сессия',
      tone: 'neutral',
      deltaPct: null,
    };
  }

  const prevInFocusPct = computeInFocusPct(
    previousSession.timeInFocusSeconds,
    previousSession.durationSeconds
  );
  const delta = currentInFocusPct - prevInFocusPct;

  if (delta > 0) {
    return {
      text: `+${delta}% к прошлой`,
      tone: 'positive',
      deltaPct: delta,
    };
  }
  if (delta < 0) {
    return {
      text: `${delta}% к прошлой`,
      tone: 'negative',
      deltaPct: delta,
    };
  }
  return {
    text: '0% к прошлой',
    tone: 'neutral',
    deltaPct: 0,
  };
}

/**
 * Formats average distraction frequency sublabel under "Отвлечения".
 */
export function getDistractionIntervalLabel(
  distractionEventsCount: number,
  durationSeconds: number
): string {
  const count = Math.max(0, Math.round(distractionEventsCount));
  if (count === 0) {
    return 'без отвлечений';
  }

  const safeDurationSec = Math.max(1, durationSeconds);
  const avgIntervalSec = Math.round(safeDurationSec / count);

  if (avgIntervalSec < 60) {
    return `в среднем раз в ${Math.max(1, avgIntervalSec)} сек`;
  }

  const avgMinutes = Math.round(avgIntervalSec / 60);
  if (avgMinutes < 60) {
    return `в среднем раз в ${avgMinutes} мин`;
  }

  const avgHours = Math.round(avgMinutes / 60);
  return `в среднем раз в ${avgHours} ч`;
}

/**
 * Generates a data-driven Russian insight from session metrics and timeline.
 */
export function buildSessionInsightRu(
  record: SessionRecord,
  points: FocusTimelinePoint[]
): string {
  const isCalmMode = record.mode === 'relaxation';
  const metricNoun = isCalmMode ? 'спокойствие' : 'фокус';
  const inFocusPct = computeInFocusPct(record.timeInFocusSeconds, record.durationSeconds);

  if (record.durationSeconds < 30) {
    return `Короткая сессия (${Math.max(1, Math.round(record.durationSeconds))} сек) со средним показателем ${Math.round(record.averageFocusScore)}%. Для более точной динамики попробуйте поработать от 10 минут.`;
  }

  if (points.length >= 6) {
    const mid = Math.floor(points.length / 2);
    const firstHalfAvg =
      points.slice(0, mid).reduce((acc, p) => acc + p.focus, 0) / Math.max(1, mid);
    const secondHalfAvg =
      points.slice(mid).reduce((acc, p) => acc + p.focus, 0) / Math.max(1, points.length - mid);
    const halfDiff = firstHalfAvg - secondHalfAvg;

    if (halfDiff >= 8) {
      return `лучше всего вы держали ${metricNoun} в первой половине сессии (${Math.round(firstHalfAvg)}% против ${Math.round(secondHalfAvg)}%). Короткий перерыв каждые 25–30 минут поможет избежать спада.`;
    }
    if (halfDiff <= -8) {
      return `во второй половине сессии ${metricNoun} выросло с ${Math.round(firstHalfAvg)}% до ${Math.round(secondHalfAvg)}% — вы уверенно вошли в рабочий ритм.`;
    }
  }

  if (inFocusPct >= 80 && record.distractionEventsCount <= 2) {
    return `ровная и устойчивая сессия: ${inFocusPct}% времени выше порога ${record.threshold}% при минимуме отвлечений (${record.distractionEventsCount}).`;
  }

  if (record.distractionEventsCount >= 5) {
    return `зафиксировано ${record.distractionEventsCount} просадок ниже порога ${record.threshold}%. Попробуйте снизить порог на 5–10% или увеличить сглаживание в настройках.`;
  }

  return `стабильный темп: ${inFocusPct}% времени в целевой зоне (средний балл ${Math.round(record.averageFocusScore)}%).`;
}
