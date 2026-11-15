import React from 'react';
import { Eye } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import type { PixelRect } from '../../services/eegTypes';
import { OverlayLayer } from './OverlayLayer';

export interface DimLayerProps {
  /** Плотность затемнения 0..1 (0 — слой полностью прозрачен). */
  opacity: number;
  /** Радиус CSS-размытия содержимого страницы под слоем, px (0 — без размытия). */
  cssBlurPx: number;
  mode: 'concentration' | 'relaxation';
  metric: number;
  threshold: number;
  /**
   * Если задан — затемняется только этот прямоугольник (CSS-пиксели окна),
   * иначе весь экран с периферийной виньеткой.
   */
  region?: PixelRect | null;
  regionLabel?: string;
}

/**
 * БОС-светофильтр: затемнение экрана или прямоугольника отвлекающего окна.
 * Используется и в едином окне `overlay` (Windows), и в браузерном предпросмотре.
 */
export const DimLayer: React.FC<DimLayerProps> = ({
  opacity,
  cssBlurPx,
  mode,
  metric,
  threshold,
  region,
  regionLabel,
}) => {
  const isConcentration = mode === 'concentration';

  if (region) {
    return (
      <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
        <div
          className="absolute rounded-lg transition-[background-color] duration-500 ease-out flex items-start justify-center"
          style={{
            left: region.x,
            top: region.y,
            width: region.width,
            height: region.height,
            backgroundColor: `rgba(6, 9, 18, ${opacity})`,
          }}
        >
          {opacity > 0.2 && (
            <div className="mt-4 px-3 py-1.5 rounded-full bg-slate-950/80 border border-orange-500/40 text-[11px] text-orange-200 flex items-center gap-1.5 shadow-lg">
              <Eye className="w-3.5 h-3.5 text-[#FF6600]" />
              <span>
                {regionLabel ? `${regionLabel}: ` : ''}
                {isConcentration ? 'focus' : 'calm'} {Math.round(metric)}% &lt; {threshold}%
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <OverlayLayer
      opacity={opacity}
      blurPx={cssBlurPx}
      cue={{
        isConcentration,
        smoothedMetric: metric,
        threshold: Math.round(threshold),
      }}
    />
  );
};

/**
 * Внутристраничный светофильтр для некомпозитных окружений Linux (без окон `overlay-*`).
 */
export const BiofeedbackOverlay: React.FC = () => {
  const { feedbackState, settings, deviceStatus } = useFocusStore();

  const { overlayOpacity, blurRadius, isDimmingActive, isContactOk, smoothedMetric } =
    feedbackState;
  const effectiveThreshold = feedbackState.effectiveThreshold ?? settings.threshold;
  const isStreamActive = settings.deviceSource === 'simulator' || deviceStatus.connected;

  const canDim = isStreamActive && isContactOk && isDimmingActive;

  return (
    <OverlayLayer
      opacity={canDim ? overlayOpacity : 0}
      blurPx={canDim ? blurRadius : 0}
      cue={{
        isConcentration: settings.mode === 'concentration',
        smoothedMetric,
        threshold: Math.round(effectiveThreshold),
      }}
    />
  );
};
