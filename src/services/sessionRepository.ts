import type {
  SavedSessionRecord,
  SessionStatistics,
  TelemetryOrigin,
} from './eegTypes.ts';
import { exportSessionsJournalToCSV } from './spectralMath.ts';

const STORAGE_KEY = 'focusglass_sessions_v1';
const MAX_SAVED_SESSIONS = 50;

export class SessionRepository {
  private memoryFallback: SavedSessionRecord[] = [];

  private hasLocalStorage(): boolean {
    try {
      return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
    } catch {
      return false;
    }
  }

  public getAllSessions(): SavedSessionRecord[] {
    if (!this.hasLocalStorage()) {
      return [...this.memoryFallback];
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as SavedSessionRecord[]) : [];
    } catch {
      return [];
    }
  }

  public saveSession(params: {
    startedAt: Date;
    endedAt?: Date;
    deviceSource: TelemetryOrigin;
    mode: 'concentration' | 'relaxation';
    threshold: number;
    stats: SessionStatistics;
  }): SavedSessionRecord {
    const ended = params.endedAt ?? new Date();
    const record: SavedSessionRecord = {
      id: `sess_${ended.getTime()}_${Math.random().toString(36).slice(2, 7)}`,
      startedAt: params.startedAt.toISOString(),
      endedAt: ended.toISOString(),
      deviceSource: params.deviceSource,
      isSimulated: params.deviceSource !== 'bluetooth',
      mode: params.mode,
      threshold: params.threshold,
      stats: { ...params.stats },
    };

    const existing = this.getAllSessions();
    const updated = [record, ...existing].slice(0, MAX_SAVED_SESSIONS);

    if (this.hasLocalStorage()) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        this.memoryFallback = updated;
      }
    } else {
      this.memoryFallback = updated;
    }

    return record;
  }

  public clearSessions(): void {
    this.memoryFallback = [];
    if (this.hasLocalStorage()) {
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    }
  }

  public exportAllToCSV(): string {
    return exportSessionsJournalToCSV(this.getAllSessions());
  }
}

export const sessionRepository = new SessionRepository();

/**
 * Triggers browser download of a text file (CSV or JSON)
 */
export function downloadTextFile(filename: string, content: string, mimeType: string = 'text/csv;charset=utf-8'): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
