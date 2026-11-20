import type { BiofeedbackFeedbackState, DeviceStatus, FocusGlassSettings, OverlayVisualMode } from './eegTypes';

export interface LinuxBlurSource {
  overlayEnabled: boolean;
  isPaused: boolean;
  settings: Pick<FocusGlassSettings, 'deviceSource' | 'overlayMode' | 'blurRadius'>;
  deviceStatus: Pick<DeviceStatus, 'connected' | 'streamMode'>;
  feedbackState: BiofeedbackFeedbackState;
}

export function buildLinuxBlurInput(state: LinuxBlurSource): LinuxBlurInput {
  return {
    enabled: state.overlayEnabled,
    streamActive: state.settings.deviceSource === 'simulator' ||
      (state.deviceStatus.connected && state.deviceStatus.streamMode !== 'resist'),
    contactOk: state.feedbackState.isContactOk,
    paused: state.isPaused,
    isDimmingActive: state.feedbackState.isDimmingActive,
    visualStyle: state.settings.overlayMode,
    // Binary compositor effect: no legacy pause-card/45%-deficit gate here.
    opacity: state.feedbackState.overlayOpacity,
    blurPx: state.settings.blurRadius,
  };
}

export interface LinuxBlurInput {
  enabled: boolean;
  streamActive: boolean;
  contactOk: boolean;
  paused: boolean;
  isDimmingActive: boolean;
  visualStyle: OverlayVisualMode;
  opacity: number;
  blurPx: number;
}

/** This backend currently supports fullscreen blur only, never the baseline dim-only mode. */
export function linuxBlurTarget(input: LinuxBlurInput): { opacity: number; blurPx: number } {
  const canBlur =
    input.enabled && input.streamActive && input.contactOk && !input.paused && input.isDimmingActive &&
    input.visualStyle === 'threshold_blur' &&
    Number.isFinite(input.opacity) && Number.isFinite(input.blurPx);
  return canBlur
    ? { opacity: Math.max(0, Math.min(0.95, input.opacity)), blurPx: Math.max(0, Math.min(32, input.blurPx)) }
    : { opacity: 0, blurPx: 0 };
}
