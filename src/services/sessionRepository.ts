import type { SessionRecord } from './eegTypes';
import { tauriBridge } from './tauriBridge';

export const SESSIONS_STORAGE_KEY = 'focusglass.sessions.v1';
export const MAX_STORED_SESSIONS = 200;

export type SessionStorageBackend = 'sqlite' | 'localStorage' | 'memory';

/** Минимальный интерфейс key-value хранилища (подмножество `Storage`). */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SessionRepository {
  readonly backend: SessionStorageBackend;
  list(): Promise<SessionRecord[]>;
  /** Вставка или обновление по `id` (используется автосохранением). */
  upsert(record: SessionRecord): Promise<void>;
  /** Синхронное сохранение для обработчиков выгрузки страницы; `false`, если недоступно. */
  upsertSync(record: SessionRecord): boolean;
  clear(): Promise<void>;
}

function isSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.startedAt === 'string' &&
    typeof r.endedAt === 'string' &&
    (r.mode === 'concentration' || r.mode === 'relaxation') &&
    (r.deviceSource === 'simulator' || r.deviceSource === 'bluetooth') &&
    typeof r.durationSeconds === 'number'
  );
}

export function mergeSession(records: SessionRecord[], record: SessionRecord): SessionRecord[] {
  return [record, ...records.filter((r) => r.id !== record.id)]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_STORED_SESSIONS);
}

/** История в `localStorage` (режим браузера) или в памяти, если хранилища нет. */
export class LocalSessionRepository implements SessionRepository {
  public readonly backend: SessionStorageBackend;
  private memory: SessionRecord[] = [];

  constructor(private readonly storage: KeyValueStorage | null) {
    this.backend = storage ? 'localStorage' : 'memory';
  }

  public readAll(): SessionRecord[] {
    if (!this.storage) return [...this.memory];
    try {
      const raw = this.storage.getItem(SESSIONS_STORAGE_KEY);
      if (!raw) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter(isSessionRecord) : [];
    } catch {
      return [];
    }
  }

  private writeAll(records: SessionRecord[]): boolean {
    if (!this.storage) {
      this.memory = records;
      return true;
    }
    try {
      this.storage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(records));
      return true;
    } catch {
      return false;
    }
  }

  public async list(): Promise<SessionRecord[]> {
    return this.readAll();
  }

  public async upsert(record: SessionRecord): Promise<void> {
    if (!this.upsertSync(record)) {
      throw new Error('localStorage is full or unavailable');
    }
  }

  public upsertSync(record: SessionRecord): boolean {
    return this.writeAll(mergeSession(this.readAll(), record));
  }

  public async clear(): Promise<void> {
    this.memory = [];
    this.storage?.removeItem(SESSIONS_STORAGE_KEY);
  }
}

/** История в SQLite через команды Rust-ядра. */
class SqliteSessionRepository implements SessionRepository {
  public readonly backend: SessionStorageBackend = 'sqlite';
  private migration: Promise<void> | null = null;

  constructor(private readonly legacy: LocalSessionRepository) {}

  /** Однократный перенос истории из `localStorage` прежних версий. */
  private migrateLegacy(): Promise<void> {
    this.migration ??= (async () => {
      const legacyRecords = this.legacy.readAll();
      if (legacyRecords.length === 0) return;
      await tauriBridge.sessionsImport(legacyRecords);
      // Удаляем старую копию только после успешного импорта.
      await this.legacy.clear();
    })().catch((err) => {
      this.migration = null;
      throw err;
    });
    return this.migration;
  }

  public async list(): Promise<SessionRecord[]> {
    await this.migrateLegacy();
    return tauriBridge.sessionsList(MAX_STORED_SESSIONS);
  }

  public upsert(record: SessionRecord): Promise<void> {
    return tauriBridge.sessionsUpsert(record);
  }

  public upsertSync(): boolean {
    return false;
  }

  public async clear(): Promise<void> {
    await tauriBridge.sessionsClear();
  }
}

function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function createSessionRepository(): SessionRepository {
  const local = new LocalSessionRepository(browserStorage());
  return tauriBridge.isTauri() ? new SqliteSessionRepository(local) : local;
}
