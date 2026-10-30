import React from 'react';
import { Target, Zap, Sparkles, Wind, AlertCircle, Bluetooth, Radio } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';
import { GlassSlider } from '../glass/GlassSlider';
import { GlassButton } from '../glass/GlassButton';
import { EEGOscilloscope } from './EEGOscilloscope';
import { ElectrodeCard } from './ElectrodeCard';
import { SessionStatsCard } from './SessionStatsCard';
import { ResponseTimelineCard } from './ResponseTimelineCard';

export const BentoMetricGrid: React.FC = () => {
  const {
    telemetry,
    feedbackState,
    settings,
    updateSettings,
    activePreset,
    setPreset,
    injectArtifact,
    openSettingsTab,
  } = useFocusStore();

  const isRu = (settings.language ?? 'ru') === 'ru';
  const isConcentration = settings.mode === 'concentration';

  const rawFocus = telemetry?.concentration ?? 78;
  const rawCalm = telemetry?.relaxation ?? 72;
  // Smoothed active metric is what actually drives screen opacity
  const focusDisplay = isConcentration ? feedbackState.smoothedMetric : rawFocus;
  const calmDisplay = !isConcentration ? feedbackState.smoothedMetric : rawCalm;
  const threshold = settings.threshold;

  return (
    <div className="space-y-4">
      {/* Honest Hardware Mode Notice when Physical BLE is selected without NeuroSDK2 */}
      {settings.deviceSource === 'bluetooth' && (
        <GlassPanel variant="card" className="p-4 border-cyan-500/35 bg-cyan-950/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="p-2 rounded-xl bg-cyan-500/20 text-[#00D2FF] mt-0.5">
              <Bluetooth className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-bold text-white">
                {isRu
                  ? 'Выбран режим физического BrainBit BLE — синтетический поток отключён'
                  : 'Physical BrainBit BLE Mode Selected — Synthetic Stream Stopped'}
              </h3>
              <p className="text-[11px] text-slate-300 mt-0.5 max-w-3xl">
                {isRu
                  ? 'В текущей сборке библиотека neurosdk2 + EmotionalMath ещё не слинкована, поэтому приложение честно не выдаёт симуляцию за реальный обруч. Переключитесь в Симулятор (250 Гц) или загрузите CSV-запись ЭЭГ.'
                  : 'neurosdk2 + EmotionalMath is not linked in this build, so FocusGlass honestly stops synthetic waves instead of faking a BLE connection. Switch back to Simulator or load an EEG CSV.'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <GlassButton
              size="sm"
              variant="primary"
              icon={<Radio className="w-3.5 h-3.5" />}
              onClick={() => updateSettings({ deviceSource: 'simulator' })}
            >
              {isRu ? 'Включить Симулятор' : 'Use Simulator'}
            </GlassButton>
            <GlassButton
              size="sm"
              variant="secondary"
              onClick={() => openSettingsTab('device')}
            >
              {isRu ? 'Загрузить CSV' : 'Load CSV'}
            </GlassButton>
          </div>
        </GlassPanel>
      )}

      {/* Top Bento Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Main Hero Card: Focus & Calm Gauges (7 cols) */}
        <GlassPanel variant="card" className="lg:col-span-7 p-5 flex flex-col justify-between">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#FF6600] to-[#FFA347] flex items-center justify-center shadow-lg">
                  <Target className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-wide">
                    {isConcentration
                      ? isRu ? 'Концентрация внимания (β-ритм)' : 'Concentration & Beta Rhythm'
                      : isRu ? 'Релаксация и снятие стресса (α-ритм)' : 'Relaxation & Alpha Rhythm'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {isRu
                      ? `Затемнение оверлея сейчас: ${Math.round(feedbackState.overlayOpacity * 100)}% · Окно сглаживания: ${settings.sensitivitySeconds} с`
                      : `Current overlay dimming: ${Math.round(feedbackState.overlayOpacity * 100)}% · Smoothing: ${settings.sensitivitySeconds}s`}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                {feedbackState.isArtifactFrozen && (
                  <GlassBadge variant="orange">
                    <AlertCircle className="w-3 h-3 mr-0.5 inline" />
                    {isRu ? 'Артефакт: анти-фликер' : 'Artifact Freeze'}
                  </GlassBadge>
                )}
                <button
                  onClick={() =>
                    updateSettings({
                      mode: isConcentration ? 'relaxation' : 'concentration',
                    })
                  }
                  className="cursor-pointer"
                  title={isRu ? 'Нажмите для быстрого переключения режима Концентрация / Релаксация' : 'Click to switch Focus / Calm mode'}
                >
                  <GlassBadge variant={isConcentration ? 'orange' : 'violet'}>
                    {isConcentration
                      ? isRu ? 'Режим: Концентрация ⇄' : 'Focus Mode ⇄'
                      : isRu ? 'Режим: Релаксация ⇄' : 'Calm Mode ⇄'}
                  </GlassBadge>
                </button>
              </div>
            </div>

            {/* Dual Metric Cards (Clickable to switch active mode!) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
              {/* Focus Metric Box */}
              <div
                onClick={() => updateSettings({ mode: 'concentration' })}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  isConcentration
                    ? 'bg-gradient-to-br from-orange-500/15 to-transparent border-orange-500/40 shadow-[0_0_20px_rgba(255,102,0,0.12)]'
                    : 'bg-white/5 border-white/10 hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[#FF6600]" />
                    {isRu ? 'Индекс концентрации (β)' : 'Focus Index (Beta)'}
                  </span>
                  {isConcentration && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-[#FF6600] font-mono">
                      {isRu ? 'ЦЕЛЕВОЙ' : 'ACTIVE'}
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-4xl font-black font-mono tracking-tight text-white">
                    {Math.round(focusDisplay)}%
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    {isRu ? `Порог ≥ ${threshold}%` : `Target ≥ ${threshold}%`}
                  </span>
                </div>

                <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-white/10 p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      focusDisplay >= threshold
                        ? 'bg-gradient-to-r from-orange-500 to-amber-300'
                        : 'bg-gradient-to-r from-red-600 to-orange-500'
                    }`}
                    style={{ width: `${Math.max(4, Math.min(100, focusDisplay))}%` }}
                  />
                </div>

                <p className="text-[11px] text-slate-400 mt-2">
                  {isRu
                    ? 'Активность β-ритма (14–30 Гц) относительно медленных волн (α+θ).'
                    : 'High-frequency Beta (14–30 Hz) power relative to slow waves.'}
                </p>
              </div>

              {/* Relaxation Metric Box */}
              <div
                onClick={() => updateSettings({ mode: 'relaxation' })}
                className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                  !isConcentration
                    ? 'bg-gradient-to-br from-purple-500/15 to-transparent border-purple-500/40 shadow-[0_0_20px_rgba(139,92,246,0.15)]'
                    : 'bg-white/5 border-white/10 hover:border-white/25'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                    <Wind className="w-3.5 h-3.5 text-[#A78BFA]" />
                    {isRu ? 'Индекс релаксации (α)' : 'Calm Index (Alpha)'}
                  </span>
                  {!isConcentration && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-[#A78BFA] font-mono">
                      {isRu ? 'ЦЕЛЕВОЙ' : 'ACTIVE'}
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-4xl font-black font-mono tracking-tight text-white">
                    {Math.round(calmDisplay)}%
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    {isRu ? `Порог ≥ ${threshold}%` : `Target ≥ ${threshold}%`}
                  </span>
                </div>

                <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-white/10 p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      calmDisplay >= threshold || isConcentration
                        ? 'bg-gradient-to-r from-purple-600 via-[#8B5CF6] to-cyan-400'
                        : 'bg-gradient-to-r from-red-600 to-purple-500'
                    }`}
                    style={{ width: `${Math.max(4, Math.min(100, calmDisplay))}%` }}
                  />
                </div>

                <p className="text-[11px] text-slate-400 mt-2">
                  {isRu
                    ? 'Синхронизация α-ритма (8–13 Гц) спокойного бодрствования.'
                    : 'Synchronous Alpha rhythm (8–13 Hz) of calm alertness.'}
                </p>
              </div>
            </div>

            {/* Quick Interactive Threshold Slider */}
            <div className="mt-4 pt-3 border-t border-white/10">
              <GlassSlider
                label={
                  isRu
                    ? 'Целевой порог срабатывания БОС'
                    : 'Dynamic Biofeedback Target Threshold'
                }
                value={settings.threshold}
                min={20}
                max={90}
                step={5}
                unit="%"
                accentColor={isConcentration ? 'orange' : 'violet'}
                description={
                  isRu
                    ? 'Когда выбранный индекс опускается ниже порога, прозрачность экрана плавно снижается пропорционально дефициту.'
                    : 'When the active metric falls below threshold, screen opacity smoothly dims.'
                }
                onChange={(val) => updateSettings({ threshold: val })}
              />
            </div>
          </div>

          {/* Preset Buttons Bar (only in Simulator mode) */}
          {settings.deviceSource === 'simulator' && (
            <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-400 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                {isRu ? 'Пресеты симулятора (клавиши):' : 'Simulator Presets:'}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {[
                  { label: isRu ? 'Фокус (92%)' : 'Focus (92%)', preset: 'high_focus' as const, key: '1' },
                  { label: isRu ? 'Поток (78%)' : 'Flow (78%)', preset: 'calm_flow' as const, key: '2' },
                  { label: isRu ? 'Спад (42%)' : 'Drift (42%)', preset: 'attention_drift' as const, key: '3' },
                  { label: isRu ? 'Моргание' : 'Blink', preset: 'artifact' as const, key: '4' },
                  { label: isRu ? 'Релакс (94%)' : 'Calm (94%)', preset: 'meditation' as const, key: '5' },
                ].map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      if (p.preset === 'artifact') {
                        injectArtifact('blink');
                      } else {
                        setPreset(p.preset);
                      }
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all cursor-pointer ${
                      activePreset === p.preset
                        ? 'bg-[#FF6600]/30 text-[#FF6600] border-[#FF6600]/60 shadow-[0_0_12px_rgba(255,102,0,0.3)]'
                        : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
                    }`}
                  >
                    <kbd className="font-mono text-white/70 mr-1">[{p.key}]</kbd>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </GlassPanel>

        {/* Right Column: Session & Electrode Cards (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <SessionStatsCard />
          <ElectrodeCard />
        </div>
      </div>

      {/* Middle Row: Real-Time Response Timeline, Bipolar Spectrum & Session Journal */}
      <ResponseTimelineCard />

      {/* Bottom Row: Full 60 FPS Canvas Oscilloscope */}
      <EEGOscilloscope />
    </div>
  );
};
