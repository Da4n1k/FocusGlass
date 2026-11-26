import React from 'react';
import { Eye } from 'lucide-react';
import type { OverlayVisualMode, PixelRect } from '../../services/eegTypes';
import { OverlayLayer } from './OverlayLayer';

export interface DimRegionTarget {
  rect: PixelRect;
  label?: string;
}

export interface DimLayerProps {
  /** Плотность затемнения 0..1 (0 — слой полностью прозрачен). */
  opacity: number;
  /** Радиус CSS-размытия содержимого страницы под слоем, px (0 — без размытия). */
  cssBlurPx: number;
  mode: 'concentration' | 'relaxation';
  metric: number;
  threshold: number;
  visualStyle?: OverlayVisualMode;
  showPauseCard?: boolean;
  /** Time-stabilized visibility for «Внимание рассеивается» / status pills. */
  showCueCard?: boolean;
  /**
   * Список видимых (незаслонённых) прямоугольников окон-отвлекателей.
   * Если задан и не пуст — затемняются только эти области.
   */
  regions?: DimRegionTarget[];
  /** Обратная совместимость для одного прямоугольника. */
  region?: PixelRect | null;
  regionLabel?: string;
}

/**
 * БОС-светофильтр: затемнение экрана (3 «не навреди» режима) или прямоугольников окон-отвлекателей.
 * Чистый презентационный компонент (без импорта стора): используется и в едином окне `overlay`
 * (Windows), и в браузерном предпросмотре.
 */
export const DimLayer: React.FC<DimLayerProps> = ({
  opacity,
  cssBlurPx,
  mode,
  metric,
  threshold,
  visualStyle = 'fullscreen_dim',
  showPauseCard = false,
  showCueCard,
  regions,
  region,
  regionLabel,
}) => {
  const isConcentration = mode === 'concentration';

  const resolvedRegions: DimRegionTarget[] | null =
    regions !== undefined
      ? regions
      : region
      ? [{ rect: region, label: regionLabel }]
      : null;

  if (resolvedRegions !== null) {
    if (resolvedRegions.length === 0 || opacity <= 0) {
      return null;
    }
    const showRegionPill = showCueCard ?? opacity > 0.18;
    return (
      <div className="fixed inset-0 pointer-events-none z-40 overflow-hidden">
        {resolvedRegions.map((item, idx) => (
          <div
            key={`${item.label ?? 'r'}-${idx}`}
            className="absolute rounded-[10px] transition-[background-color] duration-700 ease-out flex items-start justify-center border border-orange-500/20"
            style={{
              left: item.rect.x,
              top: item.rect.y,
              width: item.rect.width,
              height: item.rect.height,
              backgroundColor: `rgba(6, 9, 18, ${opacity})`,
            }}
          >
            {item.rect.width >= 180 && item.rect.height >= 80 && (
              <div
                aria-hidden={!showRegionPill}
                className={`mt-4 px-3 py-1.5 rounded-full bg-slate-950/85 border border-orange-500/40 text-[11px] text-orange-200 flex items-center gap-1.5 shadow-lg select-none transition-opacity duration-500 ease-out ${
                  showRegionPill ? 'opacity-100' : 'opacity-0'
                }`}
              >
                <Eye className="w-3.5 h-3.5 text-[#FF6600] shrink-0" />
                <span className="truncate max-w-[260px]">
                  {item.label ? `${item.label}: ` : ''}
                  {isConcentration ? 'фокус' : 'релакс'} {Math.round(metric)}% &lt; {threshold}%
                </span>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <OverlayLayer
      opacity={opacity}
      blurPx={cssBlurPx}
      visualStyle={visualStyle}
      showPauseCard={showPauseCard}
      showCueCard={showCueCard}
      cue={{
        isConcentration,
        smoothedMetric: metric,
        threshold: Math.round(threshold),
      }}
    />
  );
};
