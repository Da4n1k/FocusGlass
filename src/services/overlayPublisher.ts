import { useFocusStore } from '../stores/useFocusStore';
import { tauriBridge } from './tauriBridge';
import { StatePublisher, buildSnapshotInput } from './overlaySync';

const TICK_INTERVAL_MS = 50;

/**
 * Запускает публикацию состояния в покомпонентные окна `overlay-*` (Linux).
 * Если используется единое окно `overlay` (Windows) или окон оверлея нет (uncomposited X11),
 * публикатор не запускается.
 */
export function startOverlayPublisher(): () => void {
  let stopped = false;
  let cleanupInner: (() => void) | undefined;

  void tauriBridge.getOverlayInfo().then((info) => {
    if (stopped || info.unifiedHud || info.count === 0) {
      return;
    }

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

    let unlistenRequests: (() => void) | undefined;
    void tauriBridge.onStateRequest(() => publisher.resend()).then((stop) => {
      if (stopped) stop();
      else unlistenRequests = stop;
    });

    publisher.publish();

    cleanupInner = () => {
      unsubscribeStore();
      clearInterval(timer);
      unlistenRequests?.();
    };
  });

  return () => {
    stopped = true;
    cleanupInner?.();
  };
}
