import { useFocusStore } from '../stores/useFocusStore';
import { tauriBridge } from './tauriBridge';
import { StatePublisher, buildSnapshotInput } from './overlaySync';

const TICK_INTERVAL_MS = 50;

/**
 * Starts publishing the engine state from the engine window (`main`) to the overlay windows.
 * Returns a function that stops everything.
 */
export function startOverlayPublisher(): () => void {
  const publisher = new StatePublisher({
    read: () => buildSnapshotInput(useFocusStore.getState()),
    emit: (snapshot) => {
      void tauriBridge.emitSnapshot(snapshot);
    },
    setOverlayVisible: (visible) => tauriBridge.setOverlayVisible(visible),
    now: () => performance.now(),
  });

  const unsubscribeStore = useFocusStore.subscribe(() => publisher.publish());
  const timer = setInterval(() => publisher.tick(), TICK_INTERVAL_MS);

  let stopped = false;
  let unlistenRequests: (() => void) | undefined;
  void tauriBridge.onStateRequest(() => publisher.resend()).then((stop) => {
    if (stopped) stop();
    else unlistenRequests = stop;
  });

  publisher.publish();

  return () => {
    stopped = true;
    unsubscribeStore();
    clearInterval(timer);
    unlistenRequests?.();
  };
}
