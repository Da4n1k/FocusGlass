import React from 'react';
import { useFocusStore } from '../../stores/useFocusStore';
import { OverlayLayer } from './OverlayLayer';

export { DimLayer, type DimLayerProps, type DimRegionTarget } from './DimLayer';

/**
 * Внутристраничный светофильтр для браузерного предпросмотра и некомпозитного Linux.
 */
export const BiofeedbackOverlay: React.FC = () => {
  const { feedbackState, settings, overlayVisuals } = useFocusStore();
  const effectiveThreshold = feedbackState.effectiveThreshold ?? settings.threshold;

  return (
    <OverlayLayer
      opacity={overlayVisuals.opacity}
      blurPx={overlayVisuals.blurPx}
      visualStyle={settings.overlayMode}
      showPauseCard={overlayVisuals.showPauseCard}
      showCueCard={overlayVisuals.showCueCard}
      cue={{
        isConcentration: settings.mode === 'concentration',
        smoothedMetric: feedbackState.smoothedMetric,
        threshold: Math.round(effectiveThreshold),
      }}
    />
  );
};
