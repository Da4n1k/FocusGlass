import React from 'react';
import {
  MousePointerClick,
  Minimize2,
  X,
  Minus,
  Pin,
  Activity,
  Sliders,
  Clapperboard,
  Square,
  Globe,
} from 'lucide-react';
import { useFocusStore } from './stores/useFocusStore';
import { GlassPanel } from './components/glass/GlassPanel';
import { GlassButton } from './components/glass/GlassButton';
import { GlassBadge } from './components/glass/GlassBadge';
import { BentoMetricGrid } from './components/dashboard/BentoMetricGrid';
import { FocusBarHUD } from './components/hud/FocusBarHUD';
import { BiofeedbackOverlay } from './components/overlay/BiofeedbackOverlay';
import { WorkspacePreviewBackdrop } from './components/overlay/WorkspacePreviewBackdrop';
import { SettingsModal } from './components/settings/SettingsModal';
import { tauriBridge } from './services/tauriBridge';

import neurotechLogo from './assets/neurotech-logo.png';
import brainbitIcon from './assets/brainbit-icon.png';

export const App: React.FC = () => {
  const {
    viewMode,
    setViewMode,
    showWorkspacePreview,
    isClickThrough,
    toggleClickThrough,
    isAlwaysOnTop,
    toggleAlwaysOnTop,
    setIsSettingsOpen,
    openSettingsTab,
    settings,
    updateSettings,
    demoStatus,
    startGuidedDemo,
    stopGuidedDemo,
  } = useFocusStore();

  const isTauri = tauriBridge.isTauriRuntime();
  const lang = settings.language ?? 'ru';
  const isRu = lang === 'ru';

  // Ctrl+Shift+G (глобальный хоткей в Rust) выключает click-through — синхронизируем состояние
  React.useEffect(() => {
    if (!isTauri) return;
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('click-through-disabled', () => useFocusStore.setState({ isClickThrough: false }))
      )
      .then((fn) => {
        unlisten = fn;
      });
    return () => unlisten?.();
  }, [isTauri]);

  const sourceBadge =
    settings.deviceSource === 'simulator'
      ? {
          variant: 'orange' as const,
          text: isRu ? 'СИМУЛЯЦИЯ · 250 Гц' : 'SIMULATION · 250 Hz',
          pulse: true,
        }
      : settings.deviceSource === 'csv_replay'
      ? {
          variant: 'violet' as const,
          text: isRu ? 'CSV-ЗАПИСЬ ЭЭГ · 250 Гц' : 'CSV EEG REPLAY · 250 Hz',
          pulse: true,
        }
      : {
          variant: 'cyan' as const,
          text: isRu ? 'BRAINBIT BLE · ОЖИДАЕТ SDK' : 'BRAINBIT BLE · AWAITING SDK',
          pulse: false,
        };

  return (
    <div
      className={`min-h-screen w-full relative flex flex-col font-sans overflow-x-hidden ${
        !isTauri && viewMode === 'dashboard' ? 'bg-[#060A14]' : 'bg-transparent'
      }`}
    >
      {/* In browser HUD mode, render interactive simulated workspace behind the transparent overlay */}
      {!isTauri && viewMode === 'hud' && showWorkspacePreview && (
        <WorkspacePreviewBackdrop lang={lang} />
      )}

      {/* Ambient Biofeedback Screen Overlay (sits over workspace, under HUD) */}
      <BiofeedbackOverlay />

      {/* Floating HUD View ("Шкала-столбик" поверх всех окон) */}
      {viewMode === 'hud' ? (
        <FocusBarHUD />
      ) : (
        /* Full Dashboard View */
        <div className="relative z-40 flex flex-col flex-1 max-w-7xl mx-auto w-full p-4 md:p-6 space-y-4">
          {/* Top Liquid Glass App Bar */}
          <GlassPanel
            variant="primary"
            className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 shadow-xl border-white/20"
            data-tauri-drag-region
          >
            {/* Left: Branding & Logos */}
            <div className="flex items-center gap-3.5" data-tauri-drag-region>
              <div className="flex items-center gap-2.5">
                <img
                  src={brainbitIcon}
                  alt="BrainBit"
                  className="w-8 h-8 rounded-xl object-contain shadow-md"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-base font-extrabold tracking-tight text-white">
                      FocusGlass
                    </h1>
                    <span className="text-[10px] text-slate-400 font-medium hidden sm:inline">
                      / MindTint
                    </span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-[#FF6600] font-mono font-semibold">
                      MVP
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <span>{isRu ? 'Кейс ООО НМФ «Нейротех»' : 'Case: Neurotech LLC'}</span>
                    <span>•</span>
                    <span className="text-slate-300 font-medium">ЮФУ.Про П5</span>
                  </div>
                </div>
              </div>

              <div className="hidden lg:flex items-center pl-3.5 border-l border-white/10">
                <img
                  src={neurotechLogo}
                  alt="Нейротех"
                  className="h-5 object-contain opacity-85 hover:opacity-100 transition-opacity"
                />
              </div>
            </div>

            {/* Center: Honest Signal Source & Active Mode Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => openSettingsTab('device')}
                className="cursor-pointer"
                title={isRu ? 'Нажмите для выбора источника сигнала' : 'Click to switch signal source'}
              >
                <GlassBadge variant={sourceBadge.variant} pulse={sourceBadge.pulse}>
                  {sourceBadge.text}
                </GlassBadge>
              </button>

              <GlassBadge variant="neutral">
                {settings.mode === 'concentration'
                  ? isRu ? 'Концентрация (β)' : 'Focus (Beta)'
                  : isRu ? 'Релаксация (α)' : 'Calm (Alpha)'}
              </GlassBadge>
            </div>

            {/* Right: Guided Demo, HUD, Language & Window Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* Hands-free Guided Demo Button */}
              <GlassButton
                size="sm"
                variant={demoStatus.active ? 'danger' : 'secondary'}
                onClick={() => (demoStatus.active ? stopGuidedDemo() : startGuidedDemo())}
                icon={
                  demoStatus.active ? (
                    <Square className="w-3.5 h-3.5" />
                  ) : (
                    <Clapperboard className="w-3.5 h-3.5 text-[#FF6600]" />
                  )
                }
                title={
                  isRu
                    ? 'Автоматический 40-секундный сценарий показа всех режимов БОС без нажатия клавиш'
                    : 'Hands-free 40-second guided walkthrough of all biofeedback states'
                }
              >
                {demoStatus.active
                  ? isRu
                    ? `Стоп демо (${demoStatus.remainingSeconds}с)`
                    : `Stop (${demoStatus.remainingSeconds}s)`
                  : isRu
                  ? 'Авто-демо 40с'
                  : 'Auto-Demo 40s'}
              </GlassButton>

              {/* Switch to Minimal Floating HUD */}
              <GlassButton
                size="sm"
                variant="primary"
                onClick={() => setViewMode('hud')}
                icon={<Minimize2 className="w-3.5 h-3.5" />}
                title={
                  isRu
                    ? 'Свернуть в компактный сквозной оверлей («шкалу-столбик»)'
                    : 'Switch to Floating Screen Overlay HUD'
                }
              >
                {isRu ? 'Сквозной HUD' : 'Floating HUD'}
              </GlassButton>

              {/* Click-Through Toggle (meaningful in Tauri desktop) */}
              {isTauri && (
                <GlassButton
                  size="sm"
                  variant={isClickThrough ? 'cyan' : 'secondary'}
                  onClick={() => toggleClickThrough()}
                  icon={<MousePointerClick className="w-3.5 h-3.5" />}
                  title={
                    isRu
                      ? 'Пропускать клики сквозь окно (возврат: Ctrl+Shift+G)'
                      : 'Toggle Click-Through (restore: Ctrl+Shift+G)'
                  }
                >
                  {isClickThrough
                    ? isRu ? 'Сквозной' : 'Click-Thru'
                    : isRu ? 'Окно' : 'Interactive'}
                </GlassButton>
              )}

              {/* Language Switcher RU / EN */}
              <button
                onClick={() => updateSettings({ language: isRu ? 'en' : 'ru' })}
                className="px-2 py-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 text-xs font-mono flex items-center gap-1 transition-colors cursor-pointer"
                title="Переключить язык интерфейса RU / EN"
              >
                <Globe className="w-3.5 h-3.5 text-cyan-400" />
                <span>{isRu ? 'RU' : 'EN'}</span>
              </button>

              {/* Pin Window Always On Top (Tauri) */}
              {isTauri && (
                <button
                  onClick={() => toggleAlwaysOnTop()}
                  className={`p-2 rounded-xl border transition-all cursor-pointer ${
                    isAlwaysOnTop
                      ? 'bg-[#00D2FF]/20 text-[#00D2FF] border-[#00D2FF]/40 shadow-sm'
                      : 'bg-white/5 text-slate-400 border-white/10 hover:text-white hover:bg-white/10'
                  }`}
                  title={isRu ? 'Поверх всех окон' : 'Always on Top'}
                >
                  <Pin className="w-3.5 h-3.5" />
                </button>
              )}

              {/* Settings Trigger */}
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-2 rounded-xl bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white border border-white/10 transition-colors cursor-pointer"
                title={isRu ? 'Открыть настройки БОС и калибровку' : 'Open Settings'}
              >
                <Sliders className="w-3.5 h-3.5" />
              </button>

              {/* Window Minimize & Close (only inside Tauri desktop shell) */}
              {isTauri && (
                <div className="flex items-center pl-2 ml-1 border-l border-white/10 gap-1">
                  <button
                    onClick={() => tauriBridge.minimizeWindow()}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 cursor-pointer"
                    title="Minimize"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => tauriBridge.closeWindow()}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 cursor-pointer"
                    title="Close"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>
          </GlassPanel>

          {/* Guided Auto-Demo Live Stage Banner */}
          {demoStatus.active && (
            <div className="px-4 py-2.5 rounded-xl bg-orange-500/15 border border-orange-500/40 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 text-xs text-orange-100">
              <div className="flex items-center gap-2 font-medium">
                <Clapperboard className="w-4 h-4 text-[#FF6600] shrink-0" />
                <span>{isRu ? demoStatus.captionRu : demoStatus.captionEn}</span>
              </div>
              <span className="font-mono text-[11px] text-orange-300">
                {isRu
                  ? `Осталось ~${demoStatus.remainingSeconds} с`
                  : `~${demoStatus.remainingSeconds}s left`}
              </span>
            </div>
          )}

          {/* Main Dashboard Bento Grid */}
          <main className="flex-1">
            <BentoMetricGrid />
          </main>

          {/* Bottom Status Ribbon */}
          <footer className="py-2 px-4 rounded-xl bg-slate-950/60 border border-white/10 backdrop-blur-md flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-1.5 text-emerald-400 font-mono">
                <Activity className="w-3 h-3" />
                {settings.deviceSource === 'bluetooth'
                  ? isRu ? 'Ожидание BrainBit SDK' : 'Awaiting BrainBit SDK'
                  : isRu ? '250 Гц · 4 канала (T3, T4, O1, O2)' : '250 Hz · 4 Channels (T3, T4, O1, O2)'}
              </span>
              <span>•</span>
              <span>
                {settings.deviceSource === 'simulator'
                  ? isRu
                    ? 'Данные: математический симулятор (не физический обруч)'
                    : 'Data: synthetic simulator (no physical headband)'
                  : settings.deviceSource === 'csv_replay'
                  ? isRu
                    ? 'Данные: офлайн-запись CSV + ДПФ спектра'
                    : 'Data: offline CSV + DFT spectrum'
                  : isRu
                  ? 'Аппаратный слот neurosdk2'
                  : 'Hardware neurosdk2 slot'}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span>
                {isRu
                  ? 'Клавиши 1–5: состояния · Пробел: пауза'
                  : 'Keys 1–5: presets · Space: pause'}
              </span>
              <span>•</span>
              <button
                onClick={() => openSettingsTab('calibration')}
                className="text-[#FF6600] hover:underline cursor-pointer font-medium"
              >
                {isRu ? 'Калибровка и настройки БОС' : 'Calibrate & Configure'}
              </button>
            </div>
          </footer>
        </div>
      )}

      {/* Settings Modal */}
      <SettingsModal />
    </div>
  );
};

export default App;
