import React from 'react';
import {
  Brain,
  Sliders,
  MousePointerClick,
  Maximize2,
  Zap,
  Play,
  Pause,
  AlertCircle,
  ShieldAlert,
  Clapperboard,
  Square,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';

export const FocusBarHUD: React.FC = () => {
  const {
    feedbackState,
    telemetry,
    settings,
    isClickThrough,
    toggleClickThrough,
    setIsSettingsOpen,
    setViewMode,
    isPaused,
    togglePause,
    activePreset,
    setPreset,
    injectArtifact,
    demoStatus,
    startGuidedDemo,
    stopGuidedDemo,
  } = useFocusStore();

  const isConcentration = settings.mode === 'concentration';
  const isRu = (settings.language ?? 'ru') === 'ru';
  const score = feedbackState.smoothedMetric;
  const threshold = settings.threshold;
  const isBelowThreshold = score < threshold && !feedbackState.isContactPaused;

  const sourceTag =
    settings.deviceSource === 'simulator'
      ? isRu ? 'СИМ' : 'SIM'
      : settings.deviceSource === 'csv_replay'
      ? 'CSV'
      : 'BLE';

  return (
    <div className="fixed top-5 right-5 z-50 select-none">
      <GlassPanel
        variant="primary"
        glow={isBelowThreshold ? 'orange' : 'cyan'}
        className="p-3.5 w-84 shadow-2xl backdrop-blur-2xl border-white/20"
      >
        {/* Top Draggable Header */}
        <div
          className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FF6600] to-[#E64A00] flex items-center justify-center shadow-md">
              <Brain className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-bold tracking-wide text-white">FocusGlass</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-[#FF6600] font-mono font-semibold">
                  {sourceTag}
                </span>
              </div>
              <p className="text-[10px] text-slate-400">
                {isConcentration
                  ? isRu ? 'Концентрация (β)' : 'Beta Focus Mode'
                  : isRu ? 'Релаксация (α)' : 'Alpha Calm Mode'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => (demoStatus.active ? stopGuidedDemo() : startGuidedDemo())}
              title={isRu ? 'Авто-сценарий демонстрации (40 сек)' : '40s Guided Auto-Demo'}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                demoStatus.active
                  ? 'bg-[#FF6600]/25 text-[#FF6600]'
                  : 'text-slate-400 hover:text-white hover:bg-white/10'
              }`}
            >
              {demoStatus.active ? <Square className="w-3.5 h-3.5" /> : <Clapperboard className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => togglePause()}
              title={isPaused ? 'Resume (Space)' : 'Pause (Space)'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              {isPaused ? <Play className="w-3.5 h-3.5 text-emerald-400" /> : <Pause className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => setViewMode('dashboard')}
              title={isRu ? 'Развернуть панель мониторинга' : 'Open Full Dashboard'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setIsSettingsOpen(true)}
              title={isRu ? 'Настройки БОС' : 'Settings'}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
            >
              <Sliders className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Guided Demo Stage Caption */}
        {demoStatus.active && (
          <div className="mb-2.5 px-2.5 py-1.5 rounded-lg bg-orange-500/15 border border-orange-500/30 text-[10px] text-orange-200 leading-snug">
            {isRu ? demoStatus.captionRu : demoStatus.captionEn}
          </div>
        )}

        {/* Live Score Display */}
        <div className="flex items-baseline justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-300 font-medium">
              {isConcentration
                ? isRu ? 'Индекс фокуса' : 'Focus Index'
                : isRu ? 'Индекс покоя' : 'Calm Index'}
            </span>
            {feedbackState.isArtifactFrozen && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 flex items-center gap-0.5 font-medium">
                <AlertCircle className="w-2.5 h-2.5" />
                {isRu ? 'Артефакт (заморозка)' : 'Artifact Freeze'}
              </span>
            )}
            {feedbackState.isContactPaused && (
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 flex items-center gap-0.5 font-medium">
                <ShieldAlert className="w-2.5 h-2.5" />
                {isRu ? 'Обрыв контакта' : 'Contact Loss'}
              </span>
            )}
          </div>
          <div className="flex items-baseline gap-1">
            <span
              className={`text-2xl font-black font-mono tracking-tight ${
                isBelowThreshold ? 'text-[#FF6600]' : 'text-[#00D2FF]'
              }`}
            >
              {Math.round(score)}%
            </span>
            <span className="text-xs text-slate-400 font-mono">/ {threshold}%</span>
          </div>
        </div>

        {/* The Liquid Glass Focus Bar ("Шкала-столбик") */}
        <div className="relative h-6 bg-slate-900/80 rounded-full border border-white/15 p-0.5 shadow-inner overflow-hidden mb-3">
          {/* Threshold target marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-white/80 z-20 shadow-[0_0_8px_white]"
            style={{ left: `${threshold}%` }}
            title={`${isRu ? 'Порог' : 'Threshold'}: ${threshold}%`}
          >
            <div className="w-1.5 h-1.5 bg-white rounded-full -ml-0.5 -mt-0.5 shadow-sm" />
          </div>

          {/* Liquid Fill */}
          <div
            className={`h-full rounded-full transition-all duration-300 relative overflow-hidden ${
              isBelowThreshold
                ? 'bg-gradient-to-r from-red-600 via-[#FF6600] to-[#FFA347]'
                : 'bg-gradient-to-r from-cyan-600 via-[#00D2FF] to-emerald-400'
            }`}
            style={{ width: `${Math.max(4, Math.min(100, score))}%` }}
          >
            <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent" />
          </div>
        </div>

        {/* Electrode Micro Contact Indicator & Click-Through Button */}
        <div className="flex items-center justify-between text-xs pt-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-slate-400">
              {isRu ? 'Электроды:' : 'Sensors:'}
            </span>
            {(['t3', 't4', 'o1', 'o2'] as const).map((ch) => {
              const ok = telemetry?.signalQuality[ch] ?? true;
              const kOhm = telemetry?.impedanceKOhm?.[ch];
              return (
                <span
                  key={ch}
                  className={`w-2.5 h-2.5 rounded-full border ${
                    ok
                      ? 'bg-emerald-400 border-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
                      : 'bg-rose-500 border-rose-400'
                  }`}
                  title={`${ch.toUpperCase()}: ${ok ? `${kOhm ?? 120} кОм (норма)` : '> 2000 кОм (нет контакта)'}`}
                />
              );
            })}
          </div>

          <button
            onClick={() => toggleClickThrough()}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
              isClickThrough
                ? 'bg-[#00D2FF]/20 text-[#00D2FF] border-[#00D2FF]/40 shadow-[0_0_12px_rgba(0,210,255,0.3)]'
                : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
            }`}
            title={
              isRu
                ? 'Пропускать клики мыши сквозь окно (возврат: Ctrl+Shift+G)'
                : 'Pass clicks through overlay (restore: Ctrl+Shift+G)'
            }
          >
            <MousePointerClick className="w-3 h-3" />
            <span>
              {isClickThrough
                ? isRu ? 'Сквозной ВКЛ' : 'Click-Thru ON'
                : isRu ? 'Интерактивно' : 'Interactive'}
            </span>
          </button>
        </div>

        {isClickThrough && (
          <div className="mt-2 text-[10px] text-cyan-300/90 font-mono text-center bg-cyan-500/10 rounded-md py-1 border border-cyan-500/20">
            {isRu ? 'Возврат управления в Windows: Ctrl+Shift+G' : 'Restore control on Windows: Ctrl+Shift+G'}
          </div>
        )}

        {/* Quick Simulator Shortcuts Helper */}
        {settings.deviceSource === 'simulator' && (
          <div className="mt-2.5 pt-2 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-400" />
              {isRu ? 'Симуляция:' : 'Sim:'}
            </span>
            <div className="flex items-center gap-1">
              {(
                [
                  { key: '1', name: isRu ? 'Фокус' : 'Focus', preset: 'high_focus' },
                  { key: '2', name: isRu ? 'Поток' : 'Flow', preset: 'calm_flow' },
                  { key: '3', name: isRu ? 'Спад' : 'Drop', preset: 'attention_drift' },
                  { key: '4', name: isRu ? 'Морг.' : 'Blink', preset: 'artifact' },
                ] as const
              ).map((p) => (
                <button
                  key={p.key}
                  onClick={() => {
                    if (p.preset === 'artifact') {
                      injectArtifact('blink');
                    } else {
                      setPreset(p.preset);
                    }
                  }}
                  className={`px-1.5 py-0.5 rounded border text-[10px] transition-colors cursor-pointer ${
                    activePreset === p.preset
                      ? 'bg-[#FF6600]/30 text-[#FF6600] border-[#FF6600]/50'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                  }`}
                >
                  <kbd className="font-mono font-bold text-white/90">{p.key}</kbd>:{p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </GlassPanel>
    </div>
  );
};
