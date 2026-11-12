import React from 'react';
import { useFocusStore } from '../../stores/useFocusStore';
import { OverlayLayer } from './OverlayLayer';

/**
 * In-page dimming layer. It is the fallback when no native overlay windows exist
 * (plain browser during development, or a display server without compositing).
 */
export const BiofeedbackOverlay: React.FC = () => {
  const { feedbackState, settings, deviceStatus } = useFocusStore();

  const { overlayOpacity, blurRadius, isDimmingActive, isContactOk, smoothedMetric } =
    feedbackState;
  const isStreamActive = settings.deviceSource === 'simulator' || deviceStatus.connected;

  const canDim = isStreamActive && isContactOk && isDimmingActive;

  return (
    <OverlayLayer
      opacity={canDim ? overlayOpacity : 0}
      blurPx={canDim ? blurRadius : 0}
      cue={{
        isConcentration: settings.mode === 'concentration',
        smoothedMetric,
        threshold: settings.threshold,
      }}
    />
  );
};
