import React from 'react';
import { OverlayLayer } from '../components/overlay/OverlayLayer';
import { tauriBridge } from '../services/tauriBridge';
import { SnapshotReceiver, effectiveDimming, type SyncSnapshot } from '../services/windowSync';

/** Render-only overlay window: shows whatever dimming the engine window publishes. */
export const OverlayApp: React.FC = () => {
  const [snapshot, setSnapshot] = React.useState<SyncSnapshot | null>(null);

  React.useEffect(() => {
    const receiver = new SnapshotReceiver();
    let cancelled = false;
    let unlisten: (() => void) | undefined;

    void tauriBridge
      .onSnapshot((payload) => {
        const accepted = receiver.accept(payload);
        if (accepted) setSnapshot(accepted);
      })
      .then((stop) => {
        if (cancelled) {
          stop();
          return;
        }
        unlisten = stop;
        // The engine window only publishes on change; ask for the state we missed.
        void tauriBridge.requestState();
      });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  if (!snapshot) return null;

  const { opacity, blurPx } = effectiveDimming(snapshot);
  return (
    <OverlayLayer
      opacity={opacity}
      blurPx={blurPx}
      cue={{
        isConcentration: snapshot.mode === 'concentration',
        smoothedMetric: snapshot.feedback.smoothedMetric,
        threshold: snapshot.threshold,
      }}
    />
  );
};
