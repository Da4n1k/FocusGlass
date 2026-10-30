import React from 'react';
import { Target, Wind, Volume2, VolumeX, ShieldCheck } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassSlider } from '../glass/GlassSlider';

export const BiofeedbackConfig: React.FC = () => {
  const { settings, updateSettings } = useFocusStore();
  const isRu = (settings.language ?? 'ru') === 'ru';
  const pauseOnLoss = settings.pauseOnContactLoss !== false;

  return (
    <div className="space-y-4">
      {/* Mode Selector */}
      <div>
        <label className="text-xs font-semibold text-slate-300 block mb-1.5">
          {isRu ? 'Целевой режим БОС-тренировки' : 'Training Mode & Target Cognitive Metric'}
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            onClick={() => updateSettings({ mode: 'concentration' })}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              settings.mode === 'concentration'
                ? 'bg-[#FF6600]/20 border-[#FF6600]/50 shadow-[0_0_16px_rgba(255,102,0,0.25)]'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-[#FF6600]" />
              <span className="text-xs font-bold text-white">
                {isRu ? 'Концентрация (Фокус · β)' : 'Concentration (Focus · β)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {isRu
                ? 'Отслеживает β-ритм (14–30 Гц). Экран мягко темнеет при рассеивании внимания.'
                : 'Tracks Beta (14–30 Hz) rhythm. Screen dims when attention wanders.'}
            </p>
          </button>

          <button
            onClick={() => updateSettings({ mode: 'relaxation' })}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              settings.mode === 'relaxation'
                ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 shadow-[0_0_16px_rgba(139,92,246,0.25)]'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Wind className="w-4 h-4 text-[#8B5CF6]" />
              <span className="text-xs font-bold text-white">
                {isRu ? 'Релаксация (Покой · α)' : 'Relaxation (Calm · α)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {isRu
                ? 'Отслеживает α-ритм (8–13 Гц). Экран темнеет при росте напряжения и стресса.'
                : 'Tracks Alpha (8–13 Hz) rhythm. Screen dims when stress rises.'}
            </p>
          </button>
        </div>
      </div>

      {/* Threshold Slider */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
        <GlassSlider
          label={isRu ? 'Порог срабатывания БОС' : 'Target Biofeedback Threshold'}
          value={settings.threshold}
          min={20}
          max={90}
          step={5}
          unit="%"
          accentColor={settings.mode === 'concentration' ? 'orange' : 'violet'}
          description={
            isRu
              ? 'Граница целевой зоны. Снижение индекса ниже порога включает пропорциональное затемнение.'
              : 'Scores below this cutoff trigger proportional screen darkening.'
          }
          onChange={(val) => updateSettings({ threshold: val })}
        />
      </div>

      {/* Sensitivity & Smoothing */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
        <GlassSlider
          label={
            isRu
              ? 'Окно сглаживания (скользящее среднее)'
              : 'Sensitivity & Moving Average Window'
          }
          value={settings.sensitivitySeconds}
          min={0.5}
          max={5.0}
          step={0.5}
          unit="s"
          accentColor="cyan"
          description={
            isRu
              ? 'Защита от резких скачков: 0.5 с — быстрый отклик, 2–5 с — плавная фоновая адаптация.'
              : 'Lower = instant reaction; Higher = gentle smooth transitions.'
          }
          onChange={(val) => updateSettings({ sensitivitySeconds: val })}
        />
      </div>

      {/* Visual Dimming & Blur Settings */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 space-y-3">
        <GlassSlider
          label={isRu ? 'Максимальная плотность затемнения' : 'Maximum Screen Dimming Opacity'}
          value={Math.round(settings.dimmingMaxOpacity * 100)}
          min={10}
          max={95}
          step={5}
          unit="%"
          accentColor="orange"
          description={
            isRu
              ? 'Максимальная непрозрачность фильтра при падении индекса до нуля.'
              : 'Maximum filter opacity when metric drops to zero.'
          }
          onChange={(val) => updateSettings({ dimmingMaxOpacity: val / 100 })}
        />

        <GlassSlider
          label={isRu ? 'Радиус виньеточного размытия (HUD)' : 'Vignette Optical Blur Radius (HUD)'}
          value={settings.blurRadius}
          min={0}
          max={32}
          step={2}
          unit="px"
          accentColor="cyan"
          description={
            isRu
              ? 'Размытие фона в сквозном HUD-режиме при потере концентрации.'
              : 'Backdrop blur applied in Floating HUD overlay mode.'
          }
          onChange={(val) => updateSettings({ blurRadius: val })}
        />
      </div>

      {/* Electrode Contact Loss Pause Toggle */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${pauseOnLoss ? 'bg-emerald-500/20 text-emerald-400' : 'bg-white/5 text-slate-400'}`}>
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xs font-semibold text-white block">
              {isRu
                ? 'Безопасная пауза при потере контакта электрода'
                : 'Pause Adaptation on Electrode Contact Loss'}
            </span>
            <span className="text-[11px] text-slate-400">
              {isRu
                ? 'Не затемнять экран ложно, если сухой электрод отошёл от кожи (>2000 кОм).'
                : 'Prevents false screen darkening when a dry electrode loses skin contact.'}
            </span>
          </div>
        </div>

        <button
          onClick={() => updateSettings({ pauseOnContactLoss: !pauseOnLoss })}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border shrink-0 ${
            pauseOnLoss ? 'bg-emerald-500 border-emerald-500' : 'bg-slate-800 border-white/20'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform transform ${
              pauseOnLoss ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Audio Biofeedback Toggle */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${settings.audioFeedbackEnabled ? 'bg-orange-500/20 text-[#FF6600]' : 'bg-white/5 text-slate-400'}`}>
            {settings.audioFeedbackEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </div>
          <div>
            <span className="text-xs font-semibold text-white block">
              {isRu
                ? 'Аудио-БОС (модуляция мягкого розового шума Web Audio)'
                : 'Audio-БОС (Web Audio Pink Noise Modulation)'}
            </span>
            <span className="text-[11px] text-slate-400">
              {isRu
                ? 'Реальный синтез шума дождя/ветра (фильтр 420 Гц): громкость плавно растёт при спаде фокуса.'
                : 'Real 1/f pink noise (420 Hz lowpass): volume scales gently with focus deficit.'}
            </span>
          </div>
        </div>

        <button
          onClick={() => updateSettings({ audioFeedbackEnabled: !settings.audioFeedbackEnabled })}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border shrink-0 ${
            settings.audioFeedbackEnabled ? 'bg-[#FF6600] border-[#FF6600]' : 'bg-slate-800 border-white/20'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform transform ${
              settings.audioFeedbackEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </div>
  );
};
