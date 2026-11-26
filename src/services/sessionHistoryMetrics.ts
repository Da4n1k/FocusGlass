import type { FocusTimelinePoint, SessionRecord } from './eegTypes';

export interface WeeklyBarDay {
  label: string;
  minutes: number;
}

export interface WeeklyFocusSummary {
  averageFocusPct: number;
  deltaText: string;
  deltaTone: 'positive' | 'negative' | 'neutral';
  deltaPct: number | null;
}

export interface TotalFocusSummary {
  totalFormatted: string;
  sessionCountLabel: string;
}

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

const MONTHS_GENITIVE_RU = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
] as const;

/**
 * Returns local Monday 00:00:00.000 of the week containing `date`.
 */
export function getMondayStart(date: Date): Date {
  const d = new Date(date);
  const diffToMon = (d.getDay() + 6) % 7;
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - diffToMon);
  return d;
}

function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Russian pluralization for sessions ("1 сессия", "2 сессии", "5 сессий").
 */
export function pluralizeSessionsRu(count: number): string {
  const abs = Math.abs(Math.floor(count));
  const mod100 = abs % 100;
  const mod10 = abs % 10;
  if (mod100 >= 11 && mod100 <= 14) {
    return `${abs} сессий`;
  }
  if (mod10 === 1) {
    return `${abs} сессия`;
  }
  if (mod10 >= 2 && mod10 <= 4) {
    return `${abs} сессии`;
  }
  return `${abs} сессий`;
}

/**
 * Computes Mon..Sun minutes spent in focus during the current calendar week.
 */
export function getWeeklyBarDays(
  sessionHistory: SessionRecord[],
  now: Date = new Date()
): WeeklyBarDay[] {
  const weekStart = getMondayStart(now);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const secondsPerDay = [0, 0, 0, 0, 0, 0, 0];

  for (const session of sessionHistory) {
    if (!session.startedAt) continue;
    const started = new Date(session.startedAt);
    const ms = started.getTime();
    if (Number.isNaN(ms) || ms < weekStart.getTime() || ms >= weekEnd.getTime()) {
      continue;
    }
    const dayIdx = (started.getDay() + 6) % 7;
    const focusSec = Math.max(0, session.timeInFocusSeconds ?? 0);
    secondsPerDay[dayIdx] += focusSec;
  }

  return WEEKDAY_LABELS.map((label, idx) => {
    const sec = secondsPerDay[idx];
    const minutes = sec > 0 ? Math.max(1, Math.round(sec / 60)) : 0;
    return { label, minutes };
  });
}

/**
 * Computes weekly average focus % and delta compared to previous calendar week.
 */
export function getWeeklyFocusSummary(
  sessionHistory: SessionRecord[],
  now: Date = new Date()
): WeeklyFocusSummary {
  const thisWeekStart = getMondayStart(now).getTime();
  const nextWeekStart = thisWeekStart + 7 * 24 * 60 * 60 * 1000;
  const prevWeekStart = thisWeekStart - 7 * 24 * 60 * 60 * 1000;

  const thisWeek: SessionRecord[] = [];
  const prevWeek: SessionRecord[] = [];

  for (const s of sessionHistory) {
    if (!s.startedAt || s.durationSeconds <= 0) continue;
    const ms = new Date(s.startedAt).getTime();
    if (Number.isNaN(ms)) continue;
    if (ms >= thisWeekStart && ms < nextWeekStart) {
      thisWeek.push(s);
    } else if (ms >= prevWeekStart && ms < thisWeekStart) {
      prevWeek.push(s);
    }
  }

  if (thisWeek.length === 0) {
    return {
      averageFocusPct: 0,
      deltaText: 'нет сессий за неделю',
      deltaTone: 'neutral',
      deltaPct: null,
    };
  }

  const avg = Math.round(
    thisWeek.reduce((acc, s) => acc + s.averageFocusScore, 0) / thisWeek.length
  );

  if (prevWeek.length === 0) {
    return {
      averageFocusPct: avg,
      deltaText: 'первая неделя',
      deltaTone: 'neutral',
      deltaPct: null,
    };
  }

  const prevAvg = Math.round(
    prevWeek.reduce((acc, s) => acc + s.averageFocusScore, 0) / prevWeek.length
  );
  const delta = avg - prevAvg;

  if (delta > 0) {
    return {
      averageFocusPct: avg,
      deltaText: `+${delta}% к прошлой неделе`,
      deltaTone: 'positive',
      deltaPct: delta,
    };
  }
  if (delta < 0) {
    return {
      averageFocusPct: avg,
      deltaText: `${delta}% к прошлой неделе`,
      deltaTone: 'negative',
      deltaPct: delta,
    };
  }
  return {
    averageFocusPct: avg,
    deltaText: '0% к прошлой неделе',
    deltaTone: 'neutral',
    deltaPct: 0,
  };
}

/**
 * Formats total focus duration ("3 ч 18 мин", "42 мин", "35 сек") and session count label.
 */
export function formatTotalFocusDurationRu(totalSeconds: number): string {
  const safe = Math.max(0, totalSeconds);
  if (safe === 0) return '0 мин';
  if (safe < 60) return `${Math.max(1, Math.round(safe))} сек`;

  const totalMins = Math.round(safe / 60);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours} ч ${String(mins).padStart(2, '0')} мин` : `${hours} ч`;
  }
  return `${totalMins} мин`;
}

/**
 * Computes total focus time across all recorded sessions.
 */
export function getTotalFocusSummary(sessionHistory: SessionRecord[]): TotalFocusSummary {
  const totalSeconds = sessionHistory.reduce(
    (acc, s) => acc + Math.max(0, s.timeInFocusSeconds ?? 0),
    0
  );
  return {
    totalFormatted: formatTotalFocusDurationRu(totalSeconds),
    sessionCountLabel: pluralizeSessionsRu(sessionHistory.length),
  };
}

/**
 * Lightbar color tier matching Figma 10_history.svg (66%-81% orange, 58% amber, <45% coral-red).
 */
export function getLightbarColorHex(avgFocusPct: number): string {
  if (avgFocusPct >= 65) return '#FF7A2F';
  if (avgFocusPct >= 45) return '#FBBF24';
  return '#F87171';
}

/**
 * Formats session duration for table rows ("52 мин", "1 ч 20 мин", "1 ч 05 мин").
 */
export function formatTableDurationRu(seconds: number): string {
  const totalMins = Math.max(1, Math.round(Math.max(0, seconds) / 60));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) {
    return mins > 0 ? `${hours} ч ${String(mins).padStart(2, '0')} мин` : `${hours} ч`;
  }
  return `${totalMins} мин`;
}

/**
 * Formats session start timestamp ("Сегодня, 13:40", "Вчера, 10:15", "17 ноября, 16:05").
 */
export function formatHistoryDateRu(isoString: string, now: Date = new Date()): string {
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return '—';

  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${mm}`;

  if (isSameLocalDay(d, now)) {
    return `Сегодня, ${timeStr}`;
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameLocalDay(d, yesterday)) {
    return `Вчера, ${timeStr}`;
  }

  const month = MONTHS_GENITIVE_RU[d.getMonth()] || '';
  return `${d.getDate()} ${month}, ${timeStr}`;
}

/**
 * Formats Screen 09 header date label ("СЕГОДНЯ · 13:40–14:32", "ВЧЕРА · 10:15–11:35", "17 НОЯБРЯ · ...").
 */
export function formatSummaryDateRangeRu(
  startedAt: string,
  endedAt: string,
  now: Date = new Date()
): string {
  if (!startedAt || !endedAt) {
    return 'СЕГОДНЯ · 13:40–14:32';
  }
  const s = new Date(startedAt);
  const e = new Date(endedAt);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
    return 'СЕГОДНЯ · 13:40–14:32';
  }

  const fmt = (d: Date) =>
    `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

  let dayLabel: string;
  if (isSameLocalDay(s, now)) {
    dayLabel = 'СЕГОДНЯ';
  } else {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (isSameLocalDay(s, yesterday)) {
      dayLabel = 'ВЧЕРА';
    } else {
      const month = (MONTHS_GENITIVE_RU[s.getMonth()] || '').toUpperCase();
      dayLabel = `${s.getDate()} ${month}`;
    }
  }

  return `${dayLabel} · ${fmt(s)}–${fmt(e)}`;
}

/**
 * Synthesizes a deterministic curve matching record metrics when an older session has no saved timeline points.
 */
export function buildFallbackTimelineForRecord(
  record: SessionRecord,
  threshold: number
): FocusTimelinePoint[] {
  const count = 16;
  const avg = Math.max(10, Math.min(95, Math.round(record.averageFocusScore || 70)));
  const minVal = Math.max(5, Math.round(record.minFocusScore || Math.max(15, avg - 25)));
  const maxVal = Math.min(98, Math.round(record.maxFocusScore || Math.min(95, avg + 15)));
  const dipTargetCount = Math.min(5, Math.max(0, Math.round(record.distractionEventsCount ?? 0)));

  // Evenly place dips inside interior indices
  const dipIndices = new Set<number>();
  if (dipTargetCount > 0) {
    for (let k = 0; k < dipTargetCount; k++) {
      const idx = Math.min(
        count - 2,
        Math.max(1, Math.round(((k + 1) * (count - 1)) / (dipTargetCount + 1)))
      );
      dipIndices.add(idx);
    }
  }

  const startMs = record.startedAt ? new Date(record.startedAt).getTime() : Date.now() - 52 * 60 * 1000;
  const endMs = record.endedAt ? new Date(record.endedAt).getTime() : Date.now();
  const spanMs = Math.max(1000, endMs - startMs);

  const points: FocusTimelinePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = startMs + (spanMs * i) / (count - 1);
    const d = new Date(t);
    const isDip = dipIndices.has(i);
    let val: number;
    if (isDip) {
      val = Math.min(threshold - 4, minVal + ((i * 3) % 7));
    } else {
      const wave = Math.sin(i * 0.95) * ((maxVal - avg) * 0.55);
      val = Math.round(Math.max(threshold + 2, Math.min(maxVal, avg + wave)));
    }
    val = Math.max(0, Math.min(100, val));

    points.push({
      time: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      timestamp: t,
      focus: val,
      isDip: isDip || val < threshold,
    });
  }
  return points;
}
