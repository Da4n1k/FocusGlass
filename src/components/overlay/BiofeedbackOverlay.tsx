import React from 'react';
import { Eye, Wind, Sparkles, ShieldAlert } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';

export const BiofeedbackOverlay: React.FC = () => {
  const { feedbackState, settings, viewMode } = useFocusStore();

  const {
    overlayOpacity,
    blurRadius,
    isDimmingActive,
    smoothedMetric,
    isContactPaused,
  } = feedbackState;

  const isConcentration = settings.mode === 'concentration';
  const isRu = (settings.language ?? 'ru') === 'ru';

  const displayOpacity = isDimmingActive ? overlayOpacity : 0;
  // Full backdrop blur in HUD overlay mode (over desktop/workspace); subtle blur in Dashboard so telemetry stays crisp
  const displayBlur =
    isDimmingActive && blurRadius > 0
      ? viewMode === 'hud'
        ? blurRadius
        : Math.min(3, blurRadius * 0.2)
      : 0;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-30 transition-all duration-500 ease-out flex flex-col items-center justify-center overflow-hidden"
      style={{
        backgroundColor: `rgba(6, 9, 18, ${displayOpacity})`,
        backdropFilter: displayBlur > 0 ? `blur(${displayBlur}px)` : 'none',
        WebkitBackdropFilter: displayBlur > 0 ? `blur(${displayBlur}px)` : 'none',
      }}
    >
      {/* Peripheral Vignette Gradient (Focus Funnel) */}
      <div
        className="absolute inset-0 transition-opacity duration-700 pointer-events-none"
        style={{
          opacity: displayOpacity > 0 ? Math.min(1, displayOpacity * 1.35) : 0,
          background:
            'radial-gradient(circle at center, transparent 35%, rgba(10, 15, 30, 0.45) 68%, rgba(0, 0, 0, 0.92) 100%)',
        }}
      />

      {/* Contact-loss non-intrusive notice in HUD mode */}
      {isContactPaused && viewMode === 'hud' && (
        <div className="relative z-10 flex items-center gap-2.5 px-4 py-2.5 rounded-2xl bg-slate-950/80 border border-amber-500/40 backdrop-blur-xl shadow-xl text-xs text-amber-200">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0" />
          <span>
            {isRu
              ? 'Контакт электрода нарушен — затемнение БОС временно приостановлено'
              : 'Electrode contact lost — biofeedback dimming safely paused'}
          </span>
        </div>
      )}

      {/* Gentle Biofeedback Mindful Cue (appears in HUD mode or deep dimming) */}
      {displayOpacity > 0.32 && viewMode === 'hud' && (
        <div className="relative z-10 flex flex-col items-center gap-2 p-5 rounded-3xl bg-slate-950/75 border border-white/15 backdrop-blur-xl shadow-2xl max-w-sm text-center">
          <div className="w-11 h-11 rounded-2xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-[#FF6600] shadow-[0_0_20px_rgba(255,102,0,0.3)]">
            {isConcentration ? <Eye className="w-5 h-5 animate-pulse" /> : <Wind className="w-5 h-5 animate-pulse" />}
          </div>
          <div>
            <h4 className="text-sm font-bold text-white tracking-wide">
              {isConcentration
                ? isRu ? 'Снижение концентрации' : 'Attention Drifting'
                : isRu ? 'Повышенное напряжение' : 'Tension Detected'}
            </h4>
            <p className="text-xs text-slate-300 mt-1">
              {isConcentration
                ? isRu
                  ? `Сглаженный индекс фокуса: ${Math.round(smoothedMetric)}% (ниже порога ${settings.threshold}%). Сделайте спокойный вдох и верните внимание к задаче.`
                  : `Smoothed focus dropped to ${Math.round(smoothedMetric)}% (below ${settings.threshold}%). Take a steady breath and return to your task.`
                : isRu
                  ? `Индекс релаксации: ${Math.round(smoothedMetric)}% (ниже порога ${settings.threshold}%). Замедлите дыхание для восстановления α-ритма.`
                  : `Relaxation index at ${Math.round(smoothedMetric)}%. Slow down breathing to restore Alpha calm state.`}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-orange-300 font-medium mt-0.5">
            <Sparkles className="w-3.5 h-3.5" />
            <span>
              {isRu
                ? 'Экран прояснится автоматически при возврате в целевую зону'
                : 'Screen clears automatically as your state recovers'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
