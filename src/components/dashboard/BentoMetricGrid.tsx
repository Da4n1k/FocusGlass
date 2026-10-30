import React from 'react';
import { Target, Zap, Sparkles, Wind, AlertTriangle } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';
import { GlassSlider } from '../glass/GlassSlider';
import { EEGOscilloscope } from './EEGOscilloscope';
import { ElectrodeCard } from './ElectrodeCard';
import { SessionStatsCard } from './SessionStatsCard';

export const BentoMetricGrid: React.FC = () => {
  const {
    telemetry,
    feedbackState,
    settings,
    deviceStatus,
    updateSettings,
    activePreset,
    setPreset,
  } = useFocusStore();

  const isConcentration = settings.mode === 'concentration';
  const isSimulator = settings.deviceSource === 'simulator';
  const isStreamActive = isSimulator || deviceStatus.connected;

  const focusScore = isConcentration
    ? feedbackState.smoothedMetric
    : telemetry?.concentration ?? 0;
  const calmScore = !isConcentration
    ? feedbackState.smoothedMetric
    : telemetry?.relaxation ?? 0;
  const threshold = settings.threshold;

  return (
    <div className="space-y-4">
      {/* Top Bento Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Main Hero Card: Focus & Calm Gauges (7 cols) */}
        <GlassPanel variant="card" className="lg:col-span-7 p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-[#FF6600] to-[#FFA347] flex items-center justify-center shadow-lg">
                  <Target className="w-4 h-4 text-white" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-white tracking-wide">
                    {isConcentration
                      ? 'Concentration & Beta Rhythm'
                      : 'Relaxation & Alpha Rhythm'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    {isSimulator
                      ? 'Simulated BCI Stream (250 Hz · Smoothing Window Active)'
                      : 'BrainBit BLE Telemetry (EmotionalMath Indices)'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!feedbackState.isContactOk && isStreamActive && (
                  <GlassBadge variant="red">Contact Lost</GlassBadge>
                )}
                {feedbackState.isArtifactFrozen && isStreamActive && (
                  <GlassBadge variant="orange">Artifact Freeze</GlassBadge>
                )}
                <GlassBadge variant={isConcentration ? 'orange' : 'violet'}>
                  {isConcentration ? 'Focus Mode' : 'Calm Mode'}
                </GlassBadge>
              </div>
            </div>

            {!isStreamActive && (
              <div className="mb-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs text-amber-200">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>
                    BrainBit BLE is not connected (NeuroSDK2 adapter pending). Switch to Simulator to test БОС rules.
                  </span>
                </div>
                <button
                  onClick={() => updateSettings({ deviceSource: 'simulator' })}
                  className="px-2.5 py-1 rounded-lg bg-[#FF6600]/25 hover:bg-[#FF6600]/35 border border-[#FF6600]/50 text-white font-medium shrink-0 cursor-pointer"
                >
                  Use Simulator
                </button>
              </div>
            )}

            {/* Gauges */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 my-2">
              {/* Focus Metric Box */}
              <div
                className={`p-4 rounded-2xl border transition-all ${
                  isConcentration
                    ? 'bg-gradient-to-br from-orange-500/10 to-transparent border-orange-500/30'
                    : 'bg-white/5 border-white/10'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Zap className="w-3.5 h-3.5 text-[#FF6600]" /> Focus Index (Beta)
                  </span>
                  {isConcentration && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-[#FF6600] font-mono">
                      ACTIVE
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-4xl font-black font-mono tracking-tight text-white">
                    {isStreamActive ? `${Math.round(focusScore)}%` : '—'}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    Target ≥ {threshold}%
                  </span>
                </div>

                <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-white/10 p-0.5">
                  <div
                    className={`h-full rounded-full transition-all duration-300 ${
                      focusScore >= threshold
                        ? 'bg-gradient-to-r from-orange-500 to-amber-300'
                        : 'bg-gradient-to-r from-red-600 to-orange-500'
                    }`}
                    style={{
                      width: `${isStreamActive ? Math.max(4, Math.min(100, focusScore)) : 0}%`,
                    }}
                  />
                </div>

                <p className="text-[11px] text-slate-400 mt-2">
                  High-frequency Beta rhythm (14–30 Hz) power relative to slow waves.
                </p>
              </div>

              {/* Relaxation Metric Box */}
              <div
                className={`p-4 rounded-2xl border transition-all ${
                  !isConcentration
                    ? 'bg-gradient-to-br from-purple-500/10 to-transparent border-purple-500/30'
                    : 'bg-white/5 border-white/10'
                }`}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <Wind className="w-3.5 h-3.5 text-[#A78BFA]" /> Calm Index (Alpha)
                  </span>
                  {!isConcentration && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-[#A78BFA] font-mono">
                      ACTIVE
                    </span>
                  )}
                </div>

                <div className="flex items-baseline gap-2 mb-2">
                  <span className="text-4xl font-black font-mono tracking-tight text-white">
                    {isStreamActive ? `${Math.round(calmScore)}%` : '—'}
                  </span>
                  <span className="text-xs text-slate-400 font-mono">
                    Target ≥ {threshold}%
                  </span>
                </div>

                <div className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-white/10 p-0.5">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-purple-600 via-[#8B5CF6] to-cyan-400 transition-all duration-300"
                    style={{
                      width: `${isStreamActive ? Math.max(4, Math.min(100, calmScore)) : 0}%`,
                    }}
                  />
                </div>

                <p className="text-[11px] text-slate-400 mt-2">
                  Synchronous Alpha rhythm (8–13 Hz) indicating calm mental alertness.
                </p>
              </div>
            </div>

            {/* Quick Interactive Threshold Slider */}
            <div className="mt-4 pt-3 border-t border-white/10">
              <GlassSlider
                label="Dynamic Biofeedback Target Threshold"
                value={settings.threshold}
                min={20}
                max={90}
                step={5}
                unit="%"
                accentColor={isConcentration ? 'orange' : 'violet'}
                description="When the smoothed active metric falls below this threshold, screen opacity dims proportionally."
                onChange={(val) => updateSettings({ threshold: val })}
              />
            </div>
          </div>

          {/* Preset Buttons Bar (Simulator Only) */}
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs text-slate-400 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Simulator Presets:
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { label: 'Deep Focus (92%)', preset: 'high_focus' as const, key: '1' },
                { label: 'Flow State (78%)', preset: 'calm_flow' as const, key: '2' },
                { label: 'Distracted (42%)', preset: 'attention_drift' as const, key: '3' },
                { label: 'Meditation (94%)', preset: 'meditation' as const, key: '5' },
              ].map((p) => (
                <button
                  key={p.key}
                  disabled={!isSimulator}
                  onClick={() => setPreset(p.preset)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                    !isSimulator
                      ? 'opacity-40 cursor-not-allowed bg-white/5 text-slate-500 border-white/10'
                      : activePreset === p.preset
                      ? 'bg-[#FF6600]/30 text-[#FF6600] border-[#FF6600]/60 shadow-[0_0_12px_rgba(255,102,0,0.3)] cursor-pointer'
                      : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10 cursor-pointer'
                  }`}
                >
                  <kbd className="font-mono text-white/70 mr-1.5">[{p.key}]</kbd>
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        </GlassPanel>

        {/* Right Column: Electrode & Session Cards (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-4">
          <SessionStatsCard />
          <ElectrodeCard />
        </div>
      </div>

      {/* Bottom Row: Full 60 FPS Canvas Oscilloscope */}
      <EEGOscilloscope />
    </div>
  );
};
