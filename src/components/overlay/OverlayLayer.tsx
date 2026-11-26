import React from 'react';
import { Eye, Wind, Sparkles, PauseCircle } from 'lucide-react';
import type { OverlayVisualMode } from '../../services/eegTypes';

export interface OverlayCue {
  isConcentration: boolean;
  smoothedMetric: number;
  threshold: number;
}

interface OverlayLayerProps {
  /** Dimming opacity actually to show, already zeroed when dimming must be suppressed. */
  opacity: number;
  blurPx: number;
  cue: OverlayCue;
  visualStyle?: OverlayVisualMode;
  showPauseCard?: boolean;
  /** Time-stabilized visibility for «Внимание рассеивается» / vignette pill (prevents rapid flicker). */
  showCueCard?: boolean;
  /**
   * True inside the native, transparent overlay window. There `backdrop-filter` has nothing to
   * blur (it cannot reach the desktop behind the window) and WebKit paints opaque black
   * rectangles instead, so it is not used.
   */
  nativeWindow?: boolean;
}

const VIGNETTE_MASK =
  'radial-gradient(ellipse 62% 62% at 50% 50%, transparent 45%, rgba(0, 0, 0, 0.45) 70%, black 92%)';

/** Pure presentation of the dimming layer; shared by the in-page overlay and the overlay window. */
export const OverlayLayer: React.FC<OverlayLayerProps> = ({
  opacity,
  blurPx,
  cue,
  visualStyle = 'fullscreen_dim',
  showPauseCard = false,
  showCueCard,
  nativeWindow = false,
}) => {
  const { isConcentration, smoothedMetric, threshold } = cue;
  const isVignette = visualStyle === 'vignette_blur';
  const isThresholdBlur = visualStyle === 'threshold_blur';
  const blurry = !nativeWindow && blurPx > 0 && visualStyle !== 'fullscreen_dim';

  if (isVignette) {
    const centerTint = Number((opacity * 0.08).toFixed(4));
    const midTint = Number((opacity * 0.14).toFixed(4));
    const edgeTint = Number(Math.min(0.92, opacity * 1.15).toFixed(4));
    const showVignettePill = showCueCard ?? opacity > 0.25;

    return (
      <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
        {blurry && (
          <div
            className="absolute inset-0 transition-all duration-700 ease-out"
            style={{
              backdropFilter: `blur(${blurPx}px)`,
              WebkitBackdropFilter: `blur(${blurPx}px)`,
              maskImage: VIGNETTE_MASK,
              WebkitMaskImage: VIGNETTE_MASK,
            }}
          />
        )}
        <div
          className="absolute inset-0 transition-opacity duration-700 ease-out"
          style={{
            opacity: opacity > 0 ? 1 : 0,
            background: `radial-gradient(ellipse 62% 62% at 50% 50%, rgba(6, 9, 18, ${centerTint}) 0%, rgba(6, 9, 18, ${midTint}) 46%, rgba(6, 9, 18, ${edgeTint}) 92%)`,
          }}
        />
        <div
          aria-hidden={!showVignettePill}
          className={`absolute top-4 left-1/2 -translate-x-1/2 px-3.5 py-1.5 rounded-full bg-slate-950/85 border border-orange-500/40 text-[11px] text-orange-200 flex items-center gap-2 shadow-lg select-none transition-[opacity,transform] duration-700 ease-out will-change-[opacity,transform] ${
            showVignettePill ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2'
          }`}
        >
          {isConcentration ? (
            <Eye className="w-3.5 h-3.5 text-[#FF6600]" />
          ) : (
            <Wind className="w-3.5 h-3.5 text-[#A78BFA]" />
          )}
          <span>
            {isConcentration ? 'Фокус' : 'Релакс'} {Math.round(smoothedMetric)}% &lt; {threshold}% · центр чёткий
          </span>
        </div>
      </div>
    );
  }

  const showCenterCard = isThresholdBlur ? showPauseCard : showCueCard ?? opacity > 0.35;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-40 transition-[background-color,backdrop-filter] duration-700 ease-out flex flex-col items-center justify-center overflow-hidden"
      style={{
        backgroundColor: `rgba(6, 9, 18, ${opacity})`,
        backdropFilter: blurry ? `blur(${blurPx}px)` : 'none',
        WebkitBackdropFilter: blurry ? `blur(${blurPx}px)` : 'none',
      }}
    >
      {/* Peripheral Vignette Gradient */}
      <div
        className="absolute inset-0 transition-opacity duration-700 pointer-events-none"
        style={{
          opacity: opacity > 0 ? Math.min(1, opacity * 1.35) : 0,
          background:
            'radial-gradient(circle at center, transparent 35%, rgba(10, 15, 30, 0.38) 65%, rgba(0, 0, 0, 0.92) 100%)',
        }}
      />

      {/* Biofeedback Cue or Mandatory Eye-Safe Pause Card (kept mounted for silky CSS fade-in/out) */}
      <div
        aria-hidden={!showCenterCard}
        className={`relative z-10 flex flex-col items-center gap-2.5 p-6 rounded-3xl border shadow-2xl max-w-md text-center select-none transition-[opacity,transform] duration-700 ease-out will-change-[opacity,transform] ${
          showCenterCard
            ? 'opacity-100 scale-100 translate-y-0'
            : 'opacity-0 scale-95 translate-y-2'
        } ${
          isThresholdBlur
            ? 'bg-slate-950/92 border-orange-500/35'
            : nativeWindow
            ? 'bg-slate-950/85 border-white/10'
            : 'bg-slate-950/65 border-white/10 backdrop-blur-xl'
        }`}
      >
        <div className="w-12 h-12 rounded-2xl bg-orange-500/20 border border-orange-500/35 flex items-center justify-center text-[#FF6600] shadow-[0_0_24px_rgba(255,102,0,0.35)]">
          {isThresholdBlur ? (
            <PauseCircle className={`w-6 h-6 ${showCenterCard ? 'animate-pulse' : ''}`} />
          ) : isConcentration ? (
            <Eye className={`w-6 h-6 ${showCenterCard ? 'animate-pulse' : ''}`} />
          ) : (
            <Wind className={`w-6 h-6 ${showCenterCard ? 'animate-pulse' : ''}`} />
          )}
        </div>
        <div>
          <h4 className="text-base font-bold text-white tracking-wide">
            {isThresholdBlur
              ? 'Сделай паузу'
              : isConcentration
              ? 'Внимание рассеивается'
              : 'Зафиксировано напряжение'}
          </h4>
          <p className="text-xs text-slate-300 mt-1 leading-relaxed">
            {isThresholdBlur
              ? isConcentration
                ? `Концентрация упала до ${Math.round(smoothedMetric)}% (цель ≥ ${threshold}%). Не вглядывайтесь в экран — отведите взгляд на пару секунд, расслабьте глаза и соберите внимание.`
                : `Спокойствие упало до ${Math.round(smoothedMetric)}% (цель ≥ ${threshold}%). Отведите взгляд от экрана и сделайте пару глубоких выдохов для восстановления Альфа-ритма.`
              : isConcentration
              ? `Фокус снизился до ${Math.round(smoothedMetric)}% (порог ≥ ${threshold}%). Верните внимание к основной задаче.`
              : `Индекс спокойствия снизился до ${Math.round(smoothedMetric)}% (порог ≥ ${threshold}%). Замедлите дыхание.`}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-orange-400/90 font-medium mt-1">
          <Sparkles className="w-3.5 h-3.5" />
          <span>Экран прояснится автоматически при восстановлении ритма</span>
        </div>
      </div>
    </div>
  );
};
