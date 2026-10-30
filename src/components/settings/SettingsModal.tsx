import React, { useEffect, useState } from 'react';
import {
  X,
  Sliders,
  Bluetooth,
  Gauge,
  Sparkles,
  Play,
  CheckCircle,
  Keyboard,
  Info,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassButton } from '../glass/GlassButton';
import { BiofeedbackConfig } from './BiofeedbackConfig';
import { DeviceSelector } from './DeviceSelector';

export const SettingsModal: React.FC = () => {
  const {
    settings,
    isSettingsOpen,
    setIsSettingsOpen,
    settingsInitialTab,
    isCalibrating,
    calibrationDurationSec,
    calibrationProgress,
    calibrationResult,
    startCalibration,
    cancelCalibration,
    applyCalibration,
  } = useFocusStore();

  const isRu = (settings.language ?? 'ru') === 'ru';
  const [activeTab, setActiveTab] = useState<'bci' | 'device' | 'calibration' | 'hotkeys'>(
    settingsInitialTab
  );

  useEffect(() => {
    if (isSettingsOpen) {
      setActiveTab(settingsInitialTab);
    }
  }, [isSettingsOpen, settingsInitialTab]);

  if (!isSettingsOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/65 backdrop-blur-md">
      <GlassPanel
        variant="primary"
        className="w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden shadow-2xl border-white/20"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-orange-500/20 text-[#FF6600]">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">
                {isRu ? 'Центр управления FocusGlass · MindTint' : 'FocusGlass Control Center'}
              </h2>
              <p className="text-xs text-slate-400">
                {isRu
                  ? 'Параметры БОС, источник данных, калибровка и горячие клавиши'
                  : 'Biofeedback Configuration, Signal Source & Calibration'}
              </p>
            </div>
          </div>

          <button
            onClick={() => setIsSettingsOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex flex-wrap border-b border-white/10 px-6 gap-1 bg-slate-950/30 shrink-0">
          {[
            {
              id: 'bci' as const,
              label: isRu ? 'Параметры БОС' : 'Biofeedback',
              icon: <Sliders className="w-3.5 h-3.5" />,
            },
            {
              id: 'device' as const,
              label: isRu ? 'Источник / BrainBit' : 'Source / BrainBit',
              icon: <Bluetooth className="w-3.5 h-3.5" />,
            },
            {
              id: 'calibration' as const,
              label: isRu ? 'Калибровка' : 'Calibration',
              icon: <Gauge className="w-3.5 h-3.5" />,
            },
            {
              id: 'hotkeys' as const,
              label: isRu ? 'Управление демо' : 'Demo Shortcuts',
              icon: <Keyboard className="w-3.5 h-3.5" />,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
                activeTab === tab.id
                  ? 'border-[#FF6600] text-[#FF6600] bg-orange-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 grow">
          {activeTab === 'bci' && <BiofeedbackConfig />}

          {activeTab === 'device' && <DeviceSelector />}

          {activeTab === 'calibration' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                <div className="flex items-center gap-2 mb-2 text-white font-semibold text-xs">
                  <Info className="w-4 h-4 text-[#00D2FF]" />
                  <span>
                    {isRu
                      ? 'Персональная калибровка базовой линии ЭЭГ'
                      : 'Individual EEG Baseline Calibration'}
                  </span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {isRu
                    ? 'Базовая мощность α- и β-ритмов индивидуальна. Во время калибровки алгоритм собирает чистые отсчёты (автоматически отбрасывая артефакты моргания и обрывы контакта) и рассчитывает персональный порог для активного режима (' +
                      (settings.mode === 'concentration' ? 'Концентрация' : 'Релаксация') +
                      ').'
                    : 'Baseline Alpha and Beta powers vary across individuals. Calibration excludes blink artifacts and computes an optimal threshold for the active mode.'}
                </p>

                {settings.deviceSource === 'bluetooth' && (
                  <p className="mt-3 text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg p-2.5">
                    {isRu
                      ? 'Сейчас выбран режим физического BrainBit BLE без подключённого SDK. Для проверки калибровки переключитесь на Симулятор или CSV-запись.'
                      : 'Physical BLE mode has no active stream yet. Switch to Simulator or CSV Replay to test calibration.'}
                  </p>
                )}

                {isCalibrating ? (
                  <div className="mt-4 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-center space-y-2.5">
                    <span className="text-xs text-orange-200 font-medium block">
                      {isRu
                        ? `Запись базовой линии (${calibrationDurationSec} сек)... Смотрите спокойно на экран.`
                        : `Recording baseline (${calibrationDurationSec}s)... Stay relaxed and look at the screen.`}
                    </span>
                    <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden border border-white/10">
                      <div
                        className="h-full bg-gradient-to-r from-[#FF6600] to-[#00D2FF] transition-all duration-150"
                        style={{ width: `${calibrationProgress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                      <span>{calibrationProgress}%</span>
                      <button
                        onClick={() => cancelCalibration()}
                        className="text-rose-300 hover:underline cursor-pointer"
                      >
                        {isRu ? 'Отменить' : 'Cancel'}
                      </button>
                    </div>
                  </div>
                ) : calibrationResult ? (
                  <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                    <div className="flex items-center justify-between text-emerald-400 text-xs font-semibold">
                      <span className="flex items-center gap-1.5">
                        <CheckCircle className="w-4 h-4" />
                        {isRu ? 'Калибровка завершена' : 'Calibration Complete'}
                      </span>
                      <span className="text-[11px] font-mono text-slate-300">
                        {isRu
                          ? `Чистых отсчётов: ${calibrationResult.sampleCount ?? 0} · Доверие: ${Math.round(calibrationResult.confidence * 100)}%`
                          : `Clean samples: ${calibrationResult.sampleCount ?? 0} · Confidence: ${Math.round(calibrationResult.confidence * 100)}%`}
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">
                          {isRu ? 'База фокуса (β)' : 'Baseline Focus'}
                        </span>
                        <span className="font-mono text-white font-bold">
                          {calibrationResult.baselineFocus}%
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">
                          {isRu ? 'База покоя (α)' : 'Baseline Calm'}
                        </span>
                        <span className="font-mono text-white font-bold">
                          {calibrationResult.baselineRelaxation}%
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">
                          {isRu ? 'Реком. порог' : 'Recommended'}
                        </span>
                        <span className="font-mono text-[#FF6600] font-bold">
                          {calibrationResult.recommendedThreshold}%
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                      <GlassButton size="sm" variant="secondary" onClick={() => startCalibration(6)}>
                        {isRu ? 'Повторить (6 с)' : 'Retry (6s)'}
                      </GlassButton>
                      <GlassButton
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          applyCalibration();
                          setIsSettingsOpen(false);
                        }}
                      >
                        {isRu
                          ? `Применить порог (${calibrationResult.recommendedThreshold}%)`
                          : `Apply Threshold (${calibrationResult.recommendedThreshold}%)`}
                      </GlassButton>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
                    <GlassButton
                      variant="primary"
                      disabled={settings.deviceSource === 'bluetooth'}
                      onClick={() => startCalibration(6)}
                      icon={<Play className="w-4 h-4 fill-white" />}
                    >
                      {isRu ? 'Экспресс-калибровка (6 сек · для демо)' : 'Quick Demo Calibration (6s)'}
                    </GlassButton>
                    <GlassButton
                      variant="secondary"
                      disabled={settings.deviceSource === 'bluetooth'}
                      onClick={() => startCalibration(30)}
                    >
                      {isRu ? 'Полный протокол БОС (30 сек)' : 'Full Protocol (30s)'}
                    </GlassButton>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'hotkeys' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                <h3 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  {isRu
                    ? 'Управление интерактивным демо (на «Вертушке» и защите)'
                    : 'Interactive Presentation Shortcuts'}
                </h3>
                <p className="text-xs text-slate-300">
                  {isRu
                    ? 'В режиме симулятора работают клавиши быстрого переключения состояний (или кнопка «Авто-демо 40с» в верхней панели для полностью автоматического показа без рук):'
                    : 'In Simulator mode, use keys 1–5 or click "Auto-Demo 40s" in the top bar for a hands-free walkthrough:'}
                </p>

                <div className="space-y-2 pt-1 text-xs">
                  {[
                    {
                      key: '1',
                      color: 'text-[#FF6600]',
                      title: isRu ? 'Высокая концентрация (92%)' : 'High Focus State (92%)',
                      desc: isRu ? 'Кристальная чёткость экрана, высокий β-ритм' : 'Clear screen, high Beta',
                    },
                    {
                      key: '2',
                      color: 'text-[#00D2FF]',
                      title: isRu ? 'Рабочий поток (78%)' : 'Flow State (78%)',
                      desc: isRu ? 'Сбалансированный α/β сигнал' : 'Balanced Alpha & Beta',
                    },
                    {
                      key: '3',
                      color: 'text-rose-400',
                      title: isRu ? 'Потеря фокуса / усталость (42%)' : 'Attention Drift (42%)',
                      desc: isRu ? 'Плавное затемнение и размытие оверлея!' : 'Smooth optical dimming!',
                    },
                    {
                      key: '4',
                      color: 'text-amber-400',
                      title: isRu ? 'Артефакт моргания / мимики (240 мс)' : 'Blink / EMG Artifact (240 ms)',
                      desc: isRu ? 'Всплеск ЭОГ на осциллографе + заморозка прозрачности' : 'EOG spike + anti-flicker freeze',
                    },
                    {
                      key: '5',
                      color: 'text-purple-400',
                      title: isRu ? 'Глубокая релаксация (94% α)' : 'Calm / Meditation (94% α)',
                      desc: isRu ? 'Доминирующий α-ритм для режима «Релаксация»' : 'Synchronous Alpha for Calm mode',
                    },
                    {
                      key: 'Space',
                      color: 'text-white',
                      title: isRu ? 'Пауза / Продолжить поток' : 'Pause / Resume Stream',
                      desc: isRu ? 'Остановка генератора для разбора графика' : 'Freeze generator on screen',
                    },
                    {
                      key: 'Ctrl+Shift+G',
                      color: 'text-cyan-300',
                      title: isRu ? 'Выход из сквозного клика (Windows Tauri)' : 'Exit Click-Through (Windows Tauri)',
                      desc: isRu ? 'Возвращает перехват мыши окну приложения' : 'Restores mouse interaction',
                    },
                  ].map((item) => (
                    <div
                      key={item.key}
                      className="flex items-center justify-between gap-2 p-2 rounded-lg bg-white/5 border border-white/10"
                    >
                      <div className="flex items-center gap-2">
                        <kbd
                          className={`px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold ${item.color}`}
                        >
                          {item.key}
                        </kbd>
                        <span className="text-white font-medium">{item.title}</span>
                      </div>
                      <span className="text-slate-400 text-[11px] text-right">{item.desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-white/10 bg-slate-950/40 shrink-0">
          <GlassButton variant="secondary" size="sm" onClick={() => setIsSettingsOpen(false)}>
            {isRu ? 'Закрыть' : 'Close'}
          </GlassButton>
        </div>
      </GlassPanel>
    </div>
  );
};
