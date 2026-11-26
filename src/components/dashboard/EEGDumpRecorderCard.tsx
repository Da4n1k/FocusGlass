import React, { useState } from 'react';
import { Circle, Square, FolderOpen, Tag, HardDrive, Sparkles } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';
import { GlassButton } from '../glass/GlassButton';

const PHASE_TAGS = [
  { id: 'eyes_open', label: 'Глаза открыты' },
  { id: 'eyes_closed', label: 'Глаза закрыты (α)' },
  { id: 'focus_task', label: 'Фокус / счёт (β)' },
  { id: 'relax', label: 'Релаксация' },
] as const;

const ONE_SHOT_MARKERS = [
  { id: 'blink', label: '+ Моргание' },
  { id: 'jaw_clench', label: '+ Сжатие челюсти' },
  { id: 'head_move', label: '+ Движение' },
] as const;

function formatDumpDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/** Потоковая запись сырых дампов ЭЭГ 250 Гц в CSV с разметкой состояний и событий. */
export const EEGDumpRecorderCard: React.FC = () => {
  const {
    isTauri,
    settings,
    deviceStatus,
    dumpStatus,
    startEegDump,
    stopEegDump,
    setEegDumpLabel,
    openEegDumpsFolder,
  } = useFocusStore();

  const [sessionTag, setSessionTag] = useState('');
  const [customMarker, setCustomMarker] = useState('');
  const [busy, setBusy] = useState(false);

  const isSimulator = settings.deviceSource === 'simulator';
  const canStart = isTauri && (isSimulator || deviceStatus.connected);
  const isRecording = dumpStatus.recording;

  const handleStart = async () => {
    setBusy(true);
    try {
      await startEegDump(sessionTag);
    } finally {
      setBusy(false);
    }
  };

  const handleStop = async () => {
    setBusy(true);
    try {
      await stopEegDump();
    } finally {
      setBusy(false);
    }
  };

  const handleCustomMarker = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customMarker.trim();
    if (!trimmed || !isRecording) return;
    await setEegDumpLabel(trimmed, true);
    setCustomMarker('');
  };

  return (
    <GlassPanel variant="card" className="p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div
            className={`p-1.5 rounded-lg ${
              isRecording ? 'bg-rose-500/20 text-rose-400' : 'bg-orange-500/20 text-[#FF6600]'
            }`}
          >
            <HardDrive className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">Запись сырого дампа ЭЭГ (CSV, 250 Гц)</h3>
            <p className="text-[11px] text-slate-400">
              Сырые мкВ (T3, T4, O1, O2) + pack_num + статус контакта + метки · совместимо с EEG Recording Player и Python
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRecording ? (
            <GlassBadge variant="red" pulse={true}>
              REC · {formatDumpDuration(dumpStatus.durationSeconds)}
            </GlassBadge>
          ) : (
            <GlassBadge variant={canStart ? 'cyan' : 'neutral'}>
              {isSimulator ? 'Источник: Симулятор' : deviceStatus.connected ? 'Источник: BrainBit BLE' : 'Нет BLE'}
            </GlassBadge>
          )}
          <GlassButton
            size="sm"
            variant="ghost"
            disabled={!isTauri}
            onClick={() => void openEegDumpsFolder()}
            icon={<FolderOpen className="w-3.5 h-3.5" />}
            title={dumpStatus.dumpsDir || 'Открыть папку с дампами CSV'}
          >
            Папка дампов
          </GlassButton>
        </div>
      </div>

      {/* Main Controls Row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {!isRecording ? (
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[240px]">
            <input
              type="text"
              value={sessionTag}
              onChange={(e) => setSessionTag(e.target.value)}
              placeholder="Тег файла (напр. test_alpha)"
              maxLength={32}
              disabled={!canStart || busy}
              className="flex-1 min-w-[180px] max-w-xs px-3 py-1.5 rounded-lg bg-slate-950/60 border border-white/15 text-xs text-white placeholder:text-slate-500 outline-none focus:border-[#FF6600]/60 disabled:opacity-50"
            />
            <GlassButton
              size="sm"
              variant="primary"
              disabled={!canStart || busy}
              onClick={() => void handleStart()}
              icon={<Circle className="w-3.5 h-3.5 fill-current" />}
            >
              {busy
                ? 'Запуск...'
                : !isSimulator && deviceStatus.streamMode === 'resist'
                ? 'Запустить ЭЭГ и писать CSV'
                : 'Начать запись CSV'}
            </GlassButton>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3 w-full">
            <div className="flex flex-wrap items-center gap-3 text-xs font-mono">
              <span className="text-white font-semibold">{dumpStatus.fileName}</span>
              <span className="text-cyan-300">{dumpStatus.sampleCount.toLocaleString()} отсч.</span>
              <span className="text-slate-400">
                Метки: <strong className="text-white">{dumpStatus.markerCount}</strong>
              </span>
              {dumpStatus.activeLabel && (
                <span className="px-2 py-0.5 rounded bg-orange-500/20 border border-orange-500/40 text-orange-200">
                  фаза: {dumpStatus.activeLabel}
                </span>
              )}
            </div>

            <GlassButton
              size="sm"
              variant="danger"
              disabled={busy}
              onClick={() => void handleStop()}
              icon={<Square className="w-3.5 h-3.5 fill-current" />}
            >
              {busy ? 'Сохранение...' : 'Остановить и сохранить'}
            </GlassButton>
          </div>
        )}
      </div>

      {/* Live Annotation Controls (visible while recording) */}
      {isRecording && (
        <div className="pt-2.5 border-t border-white/10 space-y-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
              <Tag className="w-3 h-3 text-cyan-400" /> Фаза (пишется на каждую строку):
            </span>
            {PHASE_TAGS.map((tag) => {
              const active = dumpStatus.activeLabel === tag.id;
              return (
                <button
                  key={tag.id}
                  onClick={() => void setEegDumpLabel(active ? '' : tag.id, false)}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer ${
                    active
                      ? 'bg-cyan-500/25 text-cyan-200 border-cyan-400/60'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                  }`}
                >
                  {tag.label}
                </button>
              );
            })}
            {dumpStatus.activeLabel && (
              <button
                onClick={() => void setEegDumpLabel('', false)}
                className="px-2 py-1 rounded-lg text-[11px] text-slate-400 hover:text-white bg-white/5 border border-white/10 cursor-pointer"
              >
                Снять тег
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] text-slate-400 flex items-center gap-1 mr-1">
              <Sparkles className="w-3 h-3 text-amber-400" /> Событие (разовая метка):
            </span>
            {ONE_SHOT_MARKERS.map((m) => (
              <button
                key={m.id}
                onClick={() => void setEegDumpLabel(m.id, true)}
                className="px-2.5 py-1 rounded-lg text-[11px] font-medium bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border border-amber-500/35 transition-colors cursor-pointer"
              >
                {m.label}
              </button>
            ))}

            <form onSubmit={(e) => void handleCustomMarker(e)} className="flex items-center gap-1.5 ml-auto">
              <input
                type="text"
                value={customMarker}
                onChange={(e) => setCustomMarker(e.target.value)}
                placeholder="Своя метка + Enter"
                maxLength={48}
                className="w-40 px-2.5 py-1 rounded-lg bg-slate-950/60 border border-white/15 text-[11px] text-white placeholder:text-slate-500 outline-none focus:border-amber-400/50"
              />
              <GlassButton size="sm" variant="secondary" type="submit" disabled={!customMarker.trim()}>
                Метка
              </GlassButton>
            </form>
          </div>
        </div>
      )}

      {/* Footer Info: Last Saved Dump / Folder Hint */}
      {!isRecording && dumpStatus.lastSavedPath && (
        <div className="pt-2 border-t border-white/10 text-[11px] text-emerald-300/90 flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono truncate" title={dumpStatus.lastSavedPath}>
            Последний дамп ({(dumpStatus.lastSavedSamples ?? 0).toLocaleString()} отсч.):{' '}
            {dumpStatus.lastSavedPath}
          </span>
          <span className="text-slate-400 text-[10px]">
            Можно проиграть в Settings → EEG Recording Player
          </span>
        </div>
      )}

      {!isTauri && (
        <p className="text-[11px] text-slate-400">
          Запись сырых CSV-дампов на диск доступна в десктопной сборке FocusGlass (.exe).
        </p>
      )}
    </GlassPanel>
  );
};
