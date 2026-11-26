import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeInFocusPct,
  getDistractionIntervalLabel,
  getFocusDeltaSummary,
} from '../../src/services/sessionSummaryMetrics.ts';
import type { SessionRecord } from '../../src/services/eegTypes.ts';

function makeRecord(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    id: 'rec-1',
    startedAt: '2026-11-26T10:00:00.000Z',
    endedAt: '2026-11-26T10:52:00.000Z',
    mode: 'concentration',
    deviceSource: 'simulator',
    threshold: 55,
    durationSeconds: 52 * 60,
    timeInFocusSeconds: Math.round(52 * 60 * 0.78),
    timeInDimmingSeconds: Math.round(52 * 60 * 0.22),
    distractionEventsCount: 5,
    averageFocusScore: 69,
    minFocusScore: 42,
    maxFocusScore: 91,
    artifactCount: 2,
    ...overrides,
  };
}

test('Summary Metrics: focus percentage delta against previous valid session', () => {
  const prev72 = makeRecord({
    id: 'prev',
    durationSeconds: 1000,
    timeInFocusSeconds: 720,
  });
  const curr78 = makeRecord({
    id: 'curr',
    durationSeconds: 1000,
    timeInFocusSeconds: 780,
  });

  const positive = getFocusDeltaSummary(78, curr78.id, [curr78, prev72], true);
  assert.deepStrictEqual(positive, {
    text: '+6% к прошлой',
    tone: 'positive',
    deltaPct: 6,
  });

  const negative = getFocusDeltaSummary(64, curr78.id, [curr78, prev72], true);
  assert.deepStrictEqual(negative, {
    text: '-8% к прошлой',
    tone: 'negative',
    deltaPct: -8,
  });

  const equal = getFocusDeltaSummary(72, curr78.id, [curr78, prev72], true);
  assert.deepStrictEqual(equal, {
    text: '0% к прошлой',
    tone: 'neutral',
    deltaPct: 0,
  });

  const firstSession = getFocusDeltaSummary(78, curr78.id, [curr78], true);
  assert.deepStrictEqual(firstSession, {
    text: 'первая сессия',
    tone: 'neutral',
    deltaPct: null,
  });
});

test('Summary Metrics: skips corrupted zero-duration sessions when computing delta', () => {
  const curr = makeRecord({ id: 'curr', durationSeconds: 600, timeInFocusSeconds: 540 }); // 90%
  const brokenPrev = makeRecord({ id: 'broken', durationSeconds: 0, timeInFocusSeconds: 0 });
  const validPrev = makeRecord({ id: 'valid-prev', durationSeconds: 1000, timeInFocusSeconds: 750 }); // 75%

  const result = getFocusDeltaSummary(90, curr.id, [curr, brokenPrev, validPrev], true);
  assert.deepStrictEqual(result, {
    text: '+15% к прошлой',
    tone: 'positive',
    deltaPct: 15,
  });

  assert.strictEqual(computeInFocusPct(0, 0), 0);
  assert.strictEqual(computeInFocusPct(120, 100), 100);
});

test('Summary Metrics: distraction interval adapts cleanly across zero, seconds, minutes, and hours', () => {
  assert.strictEqual(getDistractionIntervalLabel(0, 3120), 'без отвлечений');
  assert.strictEqual(getDistractionIntervalLabel(0, 0), 'без отвлечений');
  assert.strictEqual(getDistractionIntervalLabel(4, 60), 'в среднем раз в 15 сек');
  assert.strictEqual(getDistractionIntervalLabel(5, 52 * 60), 'в среднем раз в 10 мин');
  assert.strictEqual(getDistractionIntervalLabel(1, 30 * 60), 'в среднем раз в 30 мин');
  assert.strictEqual(getDistractionIntervalLabel(1, 90 * 60), 'в среднем раз в 2 ч');
});
