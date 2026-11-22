import { useFocusStore } from '../stores/useFocusStore';
import { buildLinuxBlurInput, linuxBlurTarget } from './linuxBlurPolicy';
import { tauriBridge } from './tauriBridge';

/** Owns native heartbeats; tells the legacy publisher when GPU feedback takes over. */
export function startLinuxBlurPublisher(onNativeAvailable?: (available: boolean) => void): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let inFlight = false;
  let statusInFlight = false;
  let lastStatusAt = Number.NEGATIVE_INFINITY;

  const publish = (): void => {
    if (stopped || inFlight) return;
    const state = useFocusStore.getState();
    if (!statusInFlight && performance.now() - lastStatusAt > 1000) {
      statusInFlight = true;
      lastStatusAt = performance.now();
      void tauriBridge.getLinuxBlurStatus().then((native) => {
        if (!stopped) onNativeAvailable?.(native.available && native.adjustableRadius);
      }).catch((error: unknown) => {
        if (!stopped) onNativeAvailable?.(false);
        console.warn('[FocusGlass] Native effect status:', error);
      }).finally(() => { statusInFlight = false; });
    }
    const target = linuxBlurTarget(buildLinuxBlurInput(state));
    inFlight = true;
    void tauriBridge.updateLinuxBlur({ ...target, frozen: state.feedbackState.isArtifactFrozen }).catch((error: unknown) => {
      // Stop heartbeats: the native watchdog clears any remaining blur.
      if (timer !== undefined) clearInterval(timer);
      console.warn('[FocusGlass] Wayland blur publisher stopped:', error);
    }).finally(() => {
      inFlight = false;
      if (stopped) void tauriBridge.updateLinuxBlur({ opacity: 0, blurPx: 0 }).catch(() => {});
    });
  };

  void tauriBridge.getLinuxBlurStatus().then((status) => {
    if (stopped || !status.enabled) return;
    console.info('[FocusGlass] Wayland blur:', status.message);
    // Heartbeats continue even if telemetry is frozen; absent heartbeats fail clear.
    timer = setInterval(publish, 50);
    publish();
  }).catch((error: unknown) => {
    console.warn('[FocusGlass] Wayland blur unavailable:', error);
  });

  return () => {
    stopped = true;
    if (timer !== undefined) clearInterval(timer);
    // Avoid racing the final clear against an older in-flight update.
    if (!inFlight) void tauriBridge.updateLinuxBlur({ opacity: 0, blurPx: 0 }).catch(() => {});
  };
}
