import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ForegroundWindowInfo, OverlayFrame, PixelRect } from './services/eegTypes';
import { tauriBridge } from './services/tauriBridge';
import { DimLayer } from './components/overlay/BiofeedbackOverlay';
import { FocusBarHUDView } from './components/hud/FocusBarHUD';

function reportError(context: string, err: unknown): void {
  console.error(`[Overlay] ${context}:`, err);
}

/** Переводит прямоугольник из физических пикселей окна в CSS-пиксели. */
function toCssRect(rect: PixelRect): PixelRect {
  const ratio = window.devicePixelRatio || 1;
  return {
    x: rect.x / ratio,
    y: rect.y / ratio,
    width: rect.width / ratio,
    height: rect.height / ratio,
  };
}

/** Адрес снимка экрана под оверлеем (схема `fgcap`, см. `screen_blur.rs`). */
const CAPTURE_URL = 'http://fgcap.localhost/frame';
const CAPTURE_INTERVAL_MS = 200;

/** Доля размытой копии экрана поверх резкого оригинала: 0 при 2 px, 1 начиная с 5 px. */
export function blurLayerOpacity(blurPx: number): number {
  return Math.max(0, Math.min(1, (blurPx - 2) / 3));
}

/**
 * Размытие окон других программ: уменьшенный снимок экрана от Rust-ядра
 * растягивается на весь оверлей и размывается CSS-фильтром нужного радиуса.
 */
const BlurBackdrop: React.FC<{ blurPx: number }> = ({ blurPx }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let disposed = false;
    let loading = false;
    let counter = 0;
    let errorLogged = false;

    const refresh = () => {
      if (loading) return; // предыдущий снимок ещё грузится — не копим очередь
      loading = true;
      const image = new Image();
      image.onload = () => {
        loading = false;
        if (disposed) return;
        if (canvas.width !== image.naturalWidth || canvas.height !== image.naturalHeight) {
          canvas.width = image.naturalWidth;
          canvas.height = image.naturalHeight;
        }
        ctx.drawImage(image, 0, 0);
        canvas.dataset.frames = String(counter);
      };
      image.onerror = () => {
        loading = false;
        if (!errorLogged) {
          errorLogged = true;
          reportError('screen capture', new Error('capture frame failed to load'));
        }
      };
      counter += 1;
      image.src = `${CAPTURE_URL}?n=${counter}`;
    };

    refresh();
    const timer = window.setInterval(refresh, CAPTURE_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed pointer-events-none z-30 transition-opacity duration-500"
      style={{
        // Запас по краям скрывает прозрачную кайму, которую даёт blur() у границ.
        inset: -blurPx * 2,
        width: `calc(100% + ${blurPx * 4}px)`,
        height: `calc(100% + ${blurPx * 4}px)`,
        filter: `blur(${blurPx}px)`,
        opacity: blurLayerOpacity(blurPx),
      }}
    />
  );
};

/**
 * Корень окна `overlay`: сквозной полноэкранный БОС-светофильтр и плавающий HUD.
 * Собственного движка здесь нет — состояние приходит кадрами `overlay-frame`
 * из окна панели через Rust-ядро.
 */
export const OverlayApp: React.FC = () => {
  const [frame, setFrame] = useState<OverlayFrame | null>(null);
  const [foreground, setForeground] = useState<ForegroundWindowInfo | null>(null);
  const [isClickThrough, setIsClickThrough] = useState(false);
  const hudRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let disposed = false;
    const unlisteners: Array<() => void> = [];
    const track = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => {
        if (disposed) unlisten();
        else unlisteners.push(unlisten);
      });
    };

    track(tauriBridge.on<OverlayFrame>('overlay-frame', setFrame));
    track(tauriBridge.on<ForegroundWindowInfo | null>('foreground-window', setForeground));
    track(tauriBridge.on<boolean>('click-through-changed', setIsClickThrough));

    // Окно могло загрузиться позже первых кадров — забираем актуальное состояние.
    Promise.all([
      tauriBridge.getOverlayFrame(),
      tauriBridge.getForegroundWindow(),
      tauriBridge.getWindowState(),
    ]).then(
      ([lastFrame, lastForeground, windowState]) => {
        if (disposed) return;
        setFrame((current) => current ?? lastFrame);
        setForeground((current) => current ?? lastForeground);
        if (windowState) setIsClickThrough(windowState.clickThrough);
      },
      (err: unknown) => reportError('initial state', err)
    );

    return () => {
      disposed = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);

  const hudVisible = frame?.hudVisible ?? false;

  // Сообщаем Rust, где нарисован HUD: вне этой области оверлей пропускает мышь.
  useLayoutEffect(() => {
    const element = hudRef.current;
    if (!hudVisible || !element) {
      tauriBridge.setOverlayHitRegion(null).catch((err: unknown) => reportError('hit region', err));
      return;
    }

    const publish = () => {
      const box = element.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      tauriBridge
        .setOverlayHitRegion({
          x: box.left * ratio,
          y: box.top * ratio,
          width: box.width * ratio,
          height: box.height * ratio,
        })
        .catch((err: unknown) => reportError('hit region', err));
    };

    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(element);
    window.addEventListener('resize', publish);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', publish);
    };
  }, [hudVisible]);

  if (!frame) return null;

  const distractorScope = frame.scope === 'distractors';
  const distractorRect =
    distractorScope && foreground?.isDistractor && foreground.overlayRect
      ? toCssRect(foreground.overlayRect)
      : null;
  // В режиме «только отвлекатели» без отвлекающего окна на переднем плане экран чист.
  const opacity = distractorScope && !distractorRect ? 0 : frame.opacity;

  const act = (context: string, promise: Promise<unknown>) => {
    promise.catch((err: unknown) => reportError(context, err));
  };

  return (
    <div className="fixed inset-0 overflow-hidden font-sans">
      {frame.blurActive && <BlurBackdrop blurPx={frame.blurPx} />}
      <DimLayer
        opacity={opacity}
        cssBlurPx={0}
        mode={frame.mode}
        metric={frame.metric}
        threshold={frame.threshold}
        region={distractorRect}
        regionLabel={foreground?.matchedPattern ?? undefined}
      />

      {hudVisible && (
        <FocusBarHUDView
          ref={hudRef}
          mode={frame.mode}
          isSimulator={frame.isSimulator}
          streamActive={frame.streamActive}
          contactOk={frame.contactOk}
          artifactFrozen={frame.artifactFrozen}
          metric={frame.metric}
          threshold={frame.threshold}
          sensors={frame.sensors}
          isPaused={frame.paused}
          activePreset={frame.activePreset}
          isClickThrough={isClickThrough}
          onTogglePause={() => act('pause', tauriBridge.sendHudAction({ type: 'toggle_pause' }))}
          onOpenDashboard={() => act('dashboard', tauriBridge.showDashboard())}
          onToggleClickThrough={() =>
            act('click-through', tauriBridge.setClickThrough(!isClickThrough))
          }
          onSetPreset={(preset) =>
            act('preset', tauriBridge.sendHudAction({ type: 'set_preset', preset }))
          }
          onInjectArtifact={() =>
            act('artifact', tauriBridge.sendHudAction({ type: 'inject_artifact' }))
          }
        />
      )}
    </div>
  );
};

export default OverlayApp;
