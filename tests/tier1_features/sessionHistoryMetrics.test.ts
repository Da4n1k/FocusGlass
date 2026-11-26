import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFallbackTimelineForRecord,
  formatHistoryDateRu,
  formatSummaryDateRangeRu,
  formatTableDurationRu,
  getLightbarColorHex,
  getTotalFocusSummary,
  getWeeklyBarDays,
  getWeeklyFocusSummary,
  pluralizeSessionsRu,
} from '../../src/services/sessionHistoryMetrics.ts';
import { getFocusDeltaSummary } from '../../src/services/sessionSummaryMetrics.ts';
import { useFocusStore } from '../../src/stores/useFocusStore.ts';
import { simulationEngine } from '../../src/services/simulationEngine.ts';
import type { SessionRecord } from '../../src/services/eegTypes.ts';

function makeSession(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: 's-1',
    startedAt: '2026-11-26T10:00:00.000Z',
    endedAt: '2026-11-26T10:52:00.000Z',
    mode: 'concentration',
    deviceSource: 'simulator',
    threshold: 55,
    durationSeconds: 52 * 60,
    timeInFocusSeconds: Math.round(52 * 60 * 0.78),
    timeInDimmingSeconds: Math.round(52 * 60 * 0.22),
    distractionEventsCount: 5,
    averageFocusScore: 78,
    minFocusScore: 42,
    maxFocusScore: 92,
    artifactCount: 2,
    ...overrides,
  };
}

test('History Metrics: weekly bars group focus minutes Mon-Sun for current calendar week', () => {
  // Thu Nov 26, 2026 local midday reference
  const now = new Date(2026, 10, 26, 12, 0, 0);
  const monSession = makeSession({
    id: 'mon',
    startedAt: new Date(2026, 10, 23, 14, 0, 0).toISOString(),
    timeInFocusSeconds: 35 * 60,
  });
  const thuSessionA = makeSession({
    id: 'thu-a',
    startedAt: new Date(2026, 10, 26, 9, 0, 0).toISOString(),
    timeInFocusSeconds: 50 * 60,
  });
  const thuSessionB = makeSession({
    id: 'thu-b',
    startedAt: new Date(2026, 10, 26, 11, 0, 0).toISOString(),
    timeInFocusSeconds: 30 * 60,
  });
  const prevWeekSession = makeSession({
    id: 'prev-sun',
    startedAt: new Date(2026, 10, 22, 16, 0, 0).toISOString(),
    timeInFocusSeconds: 99 * 60,
  });

  const bars = getWeeklyBarDays([thuSessionB, thuSessionA, monSession, prevWeekSession], now);
  assert.deepStrictEqual(bars, [
    { label: 'Пн', minutes: 35 },
    { label: 'Вт', minutes: 0 },
    { label: 'Ср', minutes: 0 },
    { label: 'Чт', minutes: 80 },
    { label: 'Пт', minutes: 0 },
    { label: 'Сб', minutes: 0 },
    { label: 'Вс', minutes: 0 },
  ]);
});

test('History Metrics: weekly average focus compares current week against previous week', () => {
  const now = new Date(2026, 10, 26, 12, 0, 0);
  const curr1 = makeSession({
    id: 'c1',
    startedAt: new Date(2026, 10, 26, 10, 0, 0).toISOString(),
    averageFocusScore: 80,
  });
  const curr2 = makeSession({
    id: 'c2',
    startedAt: new Date(2026, 10, 24, 10, 0, 0).toISOString(),
    averageFocusScore: 70,
  });
  const prev1 = makeSession({
    id: 'p1',
    startedAt: new Date(2026, 10, 19, 10, 0, 0).toISOString(),
    averageFocusScore: 71,
  });

  const withPrev = getWeeklyFocusSummary([curr1, curr2, prev1], now);
  assert.deepStrictEqual(withPrev, {
    averageFocusPct: 75,
    deltaText: '+4% к прошлой неделе',
    deltaTone: 'positive',
    deltaPct: 4,
  });

  const onlyThisWeek = getWeeklyFocusSummary([curr1, curr2], now);
  assert.deepStrictEqual(onlyThisWeek, {
    averageFocusPct: 75,
    deltaText: 'первая неделя',
    deltaTone: 'neutral',
    deltaPct: null,
  });

  const empty = getWeeklyFocusSummary([], now);
  assert.deepStrictEqual(empty, {
    averageFocusPct: 0,
    deltaText: 'нет сессий за неделю',
    deltaTone: 'neutral',
    deltaPct: null,
  });
});

test('History Metrics: total focus formatting, Russian pluralization, and lightbar color tiers', () => {
  const s1 = makeSession({ id: '1', timeInFocusSeconds: 65 * 60 });
  const s2 = makeSession({ id: '2', timeInFocusSeconds: 50 * 60 });
  const total = getTotalFocusSummary([s1, s2]);
  assert.deepStrictEqual(total, {
    totalFormatted: '1 ч 55 мин',
    sessionCountLabel: '2 сессии',
  });

  assert.strictEqual(pluralizeSessionsRu(1), '1 сессия');
  assert.strictEqual(pluralizeSessionsRu(3), '3 сессии');
  assert.strictEqual(pluralizeSessionsRu(5), '5 сессий');
  assert.strictEqual(pluralizeSessionsRu(11), '11 сессий');
  assert.strictEqual(pluralizeSessionsRu(21), '21 сессия');

  assert.strictEqual(formatTableDurationRu(80 * 60), '1 ч 20 мин');
  assert.strictEqual(formatTableDurationRu(65 * 60), '1 ч 05 мин');
  assert.strictEqual(formatTableDurationRu(52 * 60), '52 мин');

  assert.strictEqual(getLightbarColorHex(81), '#FF7A2F');
  assert.strictEqual(getLightbarColorHex(65), '#FF7A2F');
  assert.strictEqual(getLightbarColorHex(58), '#FBBF24');
  assert.strictEqual(getLightbarColorHex(45), '#FBBF24');
  assert.strictEqual(getLightbarColorHex(39), '#F87171');
});

test('History Navigation & Formatting: opening middle historical record compares strictly to older session', () => {
  simulationEngine.stop();
  const now = new Date(2026, 10, 26, 12, 0, 0);
  const newest = makeSession({
    id: 'newest',
    startedAt: new Date(2026, 10, 26, 11, 0, 0).toISOString(),
    endedAt: new Date(2026, 10, 26, 11, 45, 0).toISOString(),
    durationSeconds: 1000,
    timeInFocusSeconds: 900, // 90%
  });
  const middle = makeSession({
    id: 'middle',
    startedAt: new Date(2026, 10, 25, 10, 15, 0).toISOString(),
    endedAt: new Date(2026, 10, 25, 11, 35, 0).toISOString(),
    durationSeconds: 1000,
    timeInFocusSeconds: 740, // 74%
  });
  const oldest = makeSession({
    id: 'oldest',
    startedAt: new Date(2026, 10, 17, 16, 5, 0).toISOString(),
    endedAt: new Date(2026, 10, 17, 16, 50, 0).toISOString(),
    durationSeconds: 1000,
    timeInFocusSeconds: 660, // 66%
  });

  const history = [newest, middle, oldest];
  const deltaForMiddle = getFocusDeltaSummary(74, middle.id, history, true);
  assert.deepStrictEqual(deltaForMiddle, {
    text: '+8% к прошлой',
    tone: 'positive',
    deltaPct: 8,
  });

  const deltaForOldest = getFocusDeltaSummary(66, oldest.id, history, true);
  assert.deepStrictEqual(deltaForOldest, {
    text: 'первая сессия',
    tone: 'neutral',
    deltaPct: null,
  });

  assert.strictEqual(formatHistoryDateRu(newest.startedAt, now), 'Сегодня, 11:00');
  assert.strictEqual(formatHistoryDateRu(middle.startedAt, now), 'Вчера, 10:15');
  assert.strictEqual(formatHistoryDateRu(oldest.startedAt, now), '17 ноября, 16:05');

  assert.strictEqual(
    formatSummaryDateRangeRu(middle.startedAt, middle.endedAt, now),
    'ВЧЕРА · 10:15–11:35'
  );
  assert.strictEqual(
    formatSummaryDateRangeRu(oldest.startedAt, oldest.endedAt, now),
    '17 НОЯБРЯ · 16:05–16:50'
  );

  const fallbackCurve = buildFallbackTimelineForRecord(middle, 55);
  assert.strictEqual(fallbackCurve.length, 16);
  assert.ok(fallbackCurve.some((p) => p.isDip), 'Historical fallback curve marks dips below threshold');

  useFocusStore.getState().openSessionSummary(middle);
  assert.strictEqual(useFocusStore.getState().activeNav, 'summary');
  assert.strictEqual(useFocusStore.getState().lastCompletedSession?.id, 'middle');

  // Switching from opened summary to 'session' resets session cleanly instead of continuing old progress
  simulationEngine.stepSamples(250);
  assert.ok(useFocusStore.getState().sessionStats.durationSeconds > 0);
  useFocusStore.getState().openSessionSummary(middle);
  useFocusStore.getState().setActiveNav('session');
  assert.strictEqual(useFocusStore.getState().activeNav, 'session');
  assert.strictEqual(useFocusStore.getState().sessionStats.durationSeconds, 0);
  assert.strictEqual(useFocusStore.getState().lastCompletedSession, null);
  assert.strictEqual(useFocusStore.getState().isSessionEnded, false);

  // Normal tab switching session -> history -> session preserves running session
  simulationEngine.stepSamples(250);
  const runningDuration = useFocusStore.getState().sessionStats.durationSeconds;
  assert.ok(runningDuration >= 1);
  useFocusStore.getState().setActiveNav('history');
  useFocusStore.getState().setActiveNav('session');
  assert.strictEqual(useFocusStore.getState().sessionStats.durationSeconds, runningDuration);

  // Finishing session -> history -> session starts fresh without continuing ended session
  useFocusStore.getState().finishSession();
  assert.strictEqual(useFocusStore.getState().isSessionEnded, true);
  assert.strictEqual(useFocusStore.getState().activeNav, 'summary');
  useFocusStore.getState().setActiveNav('history');
  simulationEngine.stepSamples(100);
  assert.strictEqual(useFocusStore.getState().sessionStats.durationSeconds, 0);
  useFocusStore.getState().setActiveNav('session');
  assert.strictEqual(useFocusStore.getState().isSessionEnded, false);
  assert.strictEqual(useFocusStore.getState().sessionStats.durationSeconds, 0);
});
