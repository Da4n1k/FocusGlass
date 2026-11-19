import React from 'react';
import { useFocusStore } from '../../stores/useFocusStore';
import { FocusBarHUDView } from './FocusBarHUDView';
import { useFitHudWindow } from './useFitHudWindow';

export { FocusBarHUDView, type FocusBarHUDViewProps } from './FocusBarHUDView';

/** Подключённая обёртка HUD для Linux-режима (где HUD живёт в уменьшенном окне `main`). */
export const FocusBarHUD: React.FC = () => {
  const {
    feedbackState,
    telemetry,
    settings,
    deviceStatus,
    isClickThrough,
    toggleClickThrough,
    setIsSettingsOpen,
    setViewMode,
    isPaused,
    togglePause,
    activePreset,
    setPreset,
    injectArtifact,
  } = useFocusStore();

  const isSimulator = settings.deviceSource === 'simulator';
  const streamActive = isSimulator || deviceStatus.connected;
  const threshold = Math.round(feedbackState.effectiveThreshold ?? settings.threshold);

  const rootRef = React.useRef<HTMLDivElement>(null);
  useFitHudWindow(rootRef);

  return (
    <FocusBarHUDView
      ref={rootRef}
      dragRegion={true}
      mode={settings.mode}
      isSimulator={isSimulator}
      streamActive={streamActive}
      contactOk={feedbackState.isContactOk}
      artifactFrozen={feedbackState.isArtifactFrozen}
      metric={feedbackState.smoothedMetric}
      threshold={threshold}
      sensors={telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true }}
      isPaused={isPaused}
      activePreset={activePreset}
      isClickThrough={isClickThrough}
      onTogglePause={togglePause}
      onOpenDashboard={() => setViewMode('dashboard')}
      onOpenSettings={() => setIsSettingsOpen(true)}
      onToggleClickThrough={() => void toggleClickThrough()}
      onSetPreset={setPreset}
      onInjectArtifact={injectArtifact}
    />
  );
};
