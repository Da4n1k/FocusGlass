import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalSessionRepository,
  MAX_STORED_SESSIONS,
  SESSIONS_STORAGE_KEY,
  mergeSession,
  type KeyValueStorage,
} from '../../src/services/sessionRepository.ts';
import { simulationEngine } from '../../src/services/simulationEngine.ts';
import { useFocusStore } from '../../src/stores/useFocusStore.ts';
import type { SessionRecord } from '../../src/services/eegTypes.ts';

class MemoryStorage implements KeyValueStorage {
  public readonly data = new Map<string, string>();
  public failWrites = false;

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function record(id: string, startedAt: string, durationSeconds = 60): SessionRecord {
  return {
    id,
    startedAt,
    endedAt: '2026-11-10T12:00:00.000Z',
    mode: 'concentration',
    deviceSource: 'simulator',
    threshold: 60,
    durationSeconds,
    timeInFocusSeconds: durationSeconds * 0.75,
    timeInDimmingSeconds: durationSeconds * 0.25,
    distractionEventsCount: 2,
    averageFocusScore: 70,
    minFocusScore: 30,
    maxFocusScore: 95,
    artifactCount: 1,
  };
}

test('Session repository: upsert with the same id updates the autosaved session in place', async () => {
  const storage = new MemoryStorage();
  const repo = new LocalSessionRepository(storage);

  await repo.upsert(record('live', '2026-11-10T10:00:00.000Z', 5));
  await repo.upsert(record('live', '2026-11-10T10:00:00.000Z', 125));
  await repo.upsert(record('older', '2026-11-09T10:00:00.000Z', 30));

  const all = await repo.list();
  assert.strictEqual(all.length, 2);
  assert.strictEqual(all[0].id, 'live', 'newest session first');
  assert.strictEqual(all[0].durationSeconds, 125, 'autosave overwrote the earlier snapshot');
});

test('Session repository: data survives a "restart" (new repository over the same storage)', async () => {
  const storage = new MemoryStorage();
  await new LocalSessionRepository(storage).upsert(record('a', '2026-11-10T10:00:00.000Z'));

  const reopened = new LocalSessionRepository(storage);
  assert.deepStrictEqual(await reopened.list(), [record('a', '2026-11-10T10:00:00.000Z')]);

  await reopened.clear();
  assert.strictEqual(storage.getItem(SESSIONS_STORAGE_KEY), null);
  assert.deepStrictEqual(await reopened.list(), []);
});

test('Session repository: corrupted or foreign storage content is ignored, not thrown', async () => {
  const storage = new MemoryStorage();
  storage.setItem(SESSIONS_STORAGE_KEY, '{not json');
  assert.deepStrictEqual(await new LocalSessionRepository(storage).list(), []);

  storage.setItem(
    SESSIONS_STORAGE_KEY,
    JSON.stringify([record('ok', '2026-11-10T10:00:00.000Z'), { id: 42 }, null, 'junk'])
  );
  const list = await new LocalSessionRepository(storage).list();
  assert.deepStrictEqual(
    list.map((r) => r.id),
    ['ok']
  );
});

test('Session repository: a failed write is reported instead of being silently lost', async () => {
  const storage = new MemoryStorage();
  const repo = new LocalSessionRepository(storage);
  storage.failWrites = true;

  assert.strictEqual(repo.upsertSync(record('x', '2026-11-10T10:00:00.000Z')), false);
  await assert.rejects(() => repo.upsert(record('x', '2026-11-10T10:00:00.000Z')));
});

test('Session repository: history is capped and keeps the most recent sessions', () => {
  let list: SessionRecord[] = [];
  for (let i = 0; i < MAX_STORED_SESSIONS + 25; i++) {
    const minute = String(i % 60).padStart(2, '0');
    const hour = String(Math.floor(i / 60)).padStart(2, '0');
    list = mergeSession(list, record(`s${i}`, `2026-11-10T${hour}:${minute}:00.000Z`));
  }
  assert.strictEqual(list.length, MAX_STORED_SESSIONS);
  assert.strictEqual(list[0].id, `s${MAX_STORED_SESSIONS + 24}`);
  assert.ok(!list.some((r) => r.id === 's0'), 'oldest sessions are evicted first');
});

test('Store: the active session is persisted without pressing reset (close-safe autosave)', async () => {
  simulationEngine.stop();
  const store = useFocusStore;
  store.getState().updateSettings({ deviceSource: 'simulator', mode: 'relaxation', threshold: 55 });
  store.getState().resetSession(false);
  assert.strictEqual(store.getState().sessionHistory.length, 0);

  // 2 с сессии: слишком коротко, сохранять нечего
  simulationEngine.stepSamples(500);
  await store.getState().persistActiveSession();
  store.getState().resetSession(false);
  assert.strictEqual(store.getState().sessionHistory.length, 0);

  // 4 с сессии -> автосохранение пишет запись, сброс не нужен
  simulationEngine.stepSamples(1000);
  const sessionId = store.getState().sessionId;
  await store.getState().persistActiveSession();

  // Имитация перезапуска: «свежий» список из хранилища при сбросе без сохранения
  simulationEngine.stepSamples(250);
  await store.getState().persistActiveSession();
  store.getState().resetSession(true);

  const history = store.getState().sessionHistory;
  assert.strictEqual(history.length, 1, 'autosaves of one session never duplicate it');
  assert.strictEqual(history[0].id, sessionId);
  assert.strictEqual(history[0].mode, 'relaxation');
  assert.strictEqual(history[0].threshold, 55);
  assert.ok(history[0].durationSeconds >= 4.9, `duration ${history[0].durationSeconds}`);
  assert.notStrictEqual(store.getState().sessionId, sessionId, 'a new session gets a new id');
});
