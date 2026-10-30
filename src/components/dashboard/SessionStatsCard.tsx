import React from 'react';
import { Timer, Flame, RotateCcw } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';

export const SessionStatsCard: React.FC = () => {
  const { sessionStats, settings, resetSessionStats } = useFocusStore();
  const isRu = (settings.language ?? 'ru') === 'ru';

  const formatTime = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const focusRatio =
    sessionStats.durationSeconds > 0
      ? Math.round((sessionStats.timeInFocusSeconds / sessionStats.durationSeconds) * 100)
      : 100;

  return (
    <GlassPanel variant="card" className="p-4">
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-orange-500/20 text-[#FF6600]">
            <Timer className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {isRu ? 'Текущая БОС-сессия' : 'Live Biofeedback Session'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isRu
                ? `Отфильтровано артефактов: ${sessionStats.artifactCount}`
                : `Filtered artifacts: ${sessionStats.artifactCount}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-500/15 border border-orange-500/30 text-xs font-mono text-orange-300">
            <Flame className="w-3.5 h-3.5 text-[#FF6600]" />
            <span>
              {focusRatio}% {isRu ? 'в потоке' : 'flow'}
            </span>
          </div>
          <button
            onClick={() => resetSessionStats()}
            title={isRu ? 'Сбросить статистику сессии' : 'Reset session stats'}
            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 mb-3">
        <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
          <span className="text-[10px] text-slate-400 block mb-0.5">
            {isRu ? 'Длительность' : 'Duration'}
          </span>
          <span className="text-lg font-bold font-mono text-white">
            {formatTime(sessionStats.durationSeconds)}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
          <span className="text-[10px] text-slate-400 block mb-0.5">
            {isRu ? 'Время в целевой зоне' : 'Time in Target Zone'}
          </span>
          <span className="text-lg font-bold font-mono text-emerald-400">
            {formatTime(sessionStats.timeInFocusSeconds)}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
          <span className="text-[10px] text-slate-400 block mb-0.5">
            {isRu ? 'Эпизодов спада' : 'Distraction Dips'}
          </span>
          <span className="text-lg font-bold font-mono text-[#FF6600]">
            {sessionStats.distractionEventsCount}
          </span>
        </div>

        <div className="p-2.5 rounded-xl bg-white/5 border border-white/10">
          <span className="text-[10px] text-slate-400 block mb-0.5">
            {isRu ? 'Средний индекс' : 'Average Score'}
          </span>
          <span className="text-lg font-bold font-mono text-[#00D2FF]">
            {Math.round(sessionStats.averageFocusScore)}%
          </span>
        </div>
      </div>

      <div className="space-y-1">
        <div className="flex justify-between text-[10px] text-slate-400">
          <span>{isRu ? 'Баланс сессии' : 'Active Flow Balance'}</span>
          <span className="font-mono text-white">
            {focusRatio}% {isRu ? 'норма' : 'clear'} / {100 - focusRatio}% {isRu ? 'затемнение' : 'dimming'}
          </span>
        </div>
        <div className="h-2 w-full bg-slate-800 rounded-full overflow-hidden flex border border-white/10">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-300"
            style={{ width: `${focusRatio}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-orange-500 to-rose-500 transition-all duration-300"
            style={{ width: `${100 - focusRatio}%` }}
          />
        </div>
      </div>
    </GlassPanel>
  );
};
