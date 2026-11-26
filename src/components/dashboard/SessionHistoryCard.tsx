import React, { useState } from 'react';
import { Database, FileSpreadsheet, Trash2 } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';
import { GlassButton } from '../glass/GlassButton';

const BACKEND_LABELS = {
  sqlite: 'SQLite',
  localStorage: 'localStorage',
  memory: 'In-memory',
} as const;

function formatDuration(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.floor(totalSeconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatStart(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

/** История тренировок (SQLite в десктопной сборке) и экспорт в CSV. */
export const SessionHistoryCard: React.FC = () => {
  const {
    sessionHistory,
    sessionStorageBackend,
    sessionStats,
    exportSessionsCsv,
    clearSessionHistory,
  } = useFocusStore();
  const [confirmClear, setConfirmClear] = useState(false);

  const canExportCsv = sessionStats.durationSeconds >= 3 || sessionHistory.length > 0;

  return (
    <GlassPanel variant="card" className="p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-violet-500/20 text-[#A78BFA]">
            <Database className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Training History</h3>
            <p className="text-[11px] text-slate-400">
              {sessionHistory.length} saved · active session autosaves every 5 s
            </p>
          </div>
        </div>
        <GlassBadge variant={sessionStorageBackend === 'sqlite' ? 'green' : 'neutral'}>
          {BACKEND_LABELS[sessionStorageBackend]}
        </GlassBadge>
      </div>

      <div className="flex-1 min-h-28 max-h-44 overflow-y-auto rounded-xl bg-slate-950/40 border border-white/10">
        {sessionHistory.length === 0 ? (
          <p className="p-4 text-center text-[11px] text-slate-500">
            No saved sessions yet. A session is stored once it lasts 3 seconds.
          </p>
        ) : (
          <table className="w-full text-[11px] text-slate-300">
            <thead className="sticky top-0 bg-slate-900/95 text-slate-400">
              <tr>
                <th className="text-left font-medium px-2.5 py-1.5">Started</th>
                <th className="text-left font-medium px-2 py-1.5">Mode</th>
                <th className="text-right font-medium px-2 py-1.5">Length</th>
                <th className="text-right font-medium px-2 py-1.5">Avg</th>
                <th className="text-right font-medium px-2.5 py-1.5">Dips</th>
              </tr>
            </thead>
            <tbody>
              {sessionHistory.map((record) => (
                <tr key={record.id} className="border-t border-white/5">
                  <td className="px-2.5 py-1.5 font-mono">{formatStart(record.startedAt)}</td>
                  <td className="px-2 py-1.5">
                    {record.mode === 'concentration' ? 'Focus' : 'Calm'}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono">
                    {formatDuration(record.durationSeconds)}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-[#00D2FF]">
                    {Math.round(record.averageFocusScore)}%
                  </td>
                  <td className="px-2.5 py-1.5 text-right font-mono text-[#FF6600]">
                    {record.distractionEventsCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
        <div className="flex items-center gap-2">
          <GlassButton
            size="sm"
            variant="secondary"
            disabled={!canExportCsv}
            onClick={() => exportSessionsCsv()}
            icon={<FileSpreadsheet className="w-3.5 h-3.5" />}
            title="Session summaries (history + active session) as CSV"
          >
            CSV
          </GlassButton>
        </div>

        {confirmClear ? (
          <div className="flex items-center gap-1.5 text-[11px] text-rose-300">
            <span>Delete all saved sessions?</span>
            <GlassButton
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmClear(false);
                void clearSessionHistory();
              }}
            >
              Delete
            </GlassButton>
            <GlassButton size="sm" variant="ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </GlassButton>
          </div>
        ) : (
          <GlassButton
            size="sm"
            variant="ghost"
            disabled={sessionHistory.length === 0}
            onClick={() => setConfirmClear(true)}
            icon={<Trash2 className="w-3.5 h-3.5" />}
          >
            Clear
          </GlassButton>
        )}
      </div>
    </GlassPanel>
  );
};
