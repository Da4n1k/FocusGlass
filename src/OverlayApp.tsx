import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ForegroundWindowInfo, OverlayFrame, PixelRect } from './services/eegTypes';
import { tauriBridge } from './services/tauriBridge';
import { DimLayer } from './components/overlay/DimLayer';
import { FocusBarHUDView } from './components/hud/FocusBarHUDView';

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

/** Адрес снимка экрана под оверлеем (асинхронная схема `fgcap`, см. `screen_blur.rs`). */
const CAPTURE_URL = 'http://fgcap.localhost/frame';
/** Целевой интервал опроса DXGI/Async-GDI кадров (~30 FPS; при статичном экране приходит 204 без декодирования). */
const CAPTURE_INTERVAL_MS = 33;
/** Фиксированный запас краёв для максимального blur (32 px): исключает layout reflow при смене blurPx. */
const BLUR_OVERSCAN_PX = 64;

/** Доля размытой копии экрана поверх резкого оригинала: 0 при 2 px, 1 начиная с 5 px. */
export function blurLayerOpacity(blurPx: number): number {
  return Math.max(0, Math.min(1, (blurPx - 2) / 3));
}

/**
 * Размытие окон других программ: уменьшенный снимок экрана от DXGI/Async-GDI
 * фонового сервиса декодируется вне главного потока (`createImageBitmap`) и рисуется
 * на `<canvas>` с фиксированным overscan (0 reflow, 0 работы при `204 No Content`).
 */
const BlurBackdrop: React.FC<{ blurPx: number; maskMode: 'full' | 'vignette' }> = ({
  blurPx,
  maskMode,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;

    let disposed = false;
    let inFlight = false;
    let lastSeq = 0;
    let counter = 0;
    let errorLogged = false;
    let rafId: number | null = null;
    let pendingBitmap: ImageBitmap | null = null;
    let pendingBackend = '';
    const controller = new AbortController();

    const paintPending = () => {
      rafId = null;
      const bitmap = pendingBitmap;
      pendingBitmap = null;
      if (!bitmap) return;
      if (disposed) {
        bitmap.close();
        return;
      }
      if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
      }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      canvas.dataset.frames = String(counter);
      if (pendingBackend) {
        canvas.dataset.backend = pendingBackend;
      }
    };

    const refresh = async () => {
      if (disposed || inFlight) return;
      inFlight = true;
      try {
        const query = lastSeq > 0 ? `?after=${lastSeq}&n=${++counter}` : `?n=${++counter}`;
        const res = await fetch(`${CAPTURE_URL}${query}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (disposed) return;

        if (res.status === 204) {
          // Экран не изменился — пропускаем декодирование и перерисовку (0% нагрузки).
          return;
        }
        if (!res.ok) {
          if (res.status !== 409 && !errorLogged) {
            errorLogged = true;
            reportError('screen capture', new Error(`HTTP ${res.status}`));
          }
          return;
        }

        const seqHeader = Number(res.headers.get('X-Frame-Seq'));
        if (Number.isFinite(seqHeader) && seqHeader > 0) {
          lastSeq = seqHeader;
        }
        pendingBackend = res.headers.get('X-Capture-Backend') ?? '';

        const blob = await res.blob();
        if (disposed) return;
        const bitmap = await createImageBitmap(blob);
        if (disposed) {
          bitmap.close();
          return;
        }

        if (pendingBitmap) {
          pendingBitmap.close();
        }
        pendingBitmap = bitmap;
        errorLogged = false;
        if (rafId === null) {
          rafId = window.requestAnimationFrame(paintPending);
        }
      } catch (err: unknown) {
        if (!disposed && !errorLogged) {
          errorLogged = true;
          reportError('screen capture', err);
        }
      } finally {
        inFlight = false;
      }
    };

    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, CAPTURE_INTERVAL_MS);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(timer);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (pendingBitmap) {
        pendingBitmap.close();
        pendingBitmap = null;
      }
    };
  }, []);

  const vignetteMask =
    maskMode === 'vignette'
      ? 'radial-gradient(ellipse 62% 62% at 50% 50%, transparent 45%, rgba(0, 0, 0, 0.45) 70%, black 92%)'
      : undefined;

  // Квантуем до 0.5 px, чтобы GPU-фильтр не пересобирался от субпиксельного шума.
  const quantizedBlur = Math.round(Math.max(0, Math.min(32, blurPx)) * 2) / 2;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-30 overflow-hidden"
      style={
        vignetteMask
          ? { maskImage: vignetteMask, WebkitMaskImage: vignetteMask }
          : undefined
      }
    >
      <canvas
        ref={canvasRef}
        className="fixed pointer-events-none transition-opacity duration-300 ease-out will-change-[filter,opacity]"
        style={{
          inset: -BLUR_OVERSCAN_PX,
          width: `calc(100% + ${BLUR_OVERSCAN_PX * 2}px)`,
          height: `calc(100% + ${BLUR_OVERSCAN_PX * 2}px)`,
          filter: quantizedBlur > 0 ? `blur(${quantizedBlur}px)` : 'none',
          opacity: blurLayerOpacity(blurPx),
        }}
      />
    </div>
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

  const distractorScope = frame.scope === 'distractors' || frame.visualStyle === 'distractors';
  const distractorTargets: Array<{ rect: PixelRect; label?: string }> = distractorScope
    ? foreground?.distractorRegions && foreground.distractorRegions.length > 0
      ? foreground.distractorRegions
          .filter((r): r is typeof r & { overlayRect: PixelRect } => r.overlayRect !== null)
          .map((r) => ({ rect: toCssRect(r.overlayRect), label: r.matchedPattern }))
      : foreground?.isDistractor && foreground.overlayRect
      ? [{ rect: toCssRect(foreground.overlayRect), label: foreground.matchedPattern ?? undefined }]
      : []
    : [];

  // В режиме «только отвлекатели» без видимых отвлекающих окон экран полностью чист.
  const opacity = distractorScope && distractorTargets.length === 0 ? 0 : frame.opacity;
  const showBlur =
    Boolean(frame.blurActive) &&
    frame.blurPx > 0 &&
    (!distractorScope || distractorTargets.length > 0);

  const act = (context: string, promise: Promise<unknown>) => {
    promise.catch((err: unknown) => reportError(context, err));
  };

  return (
    <div className="fixed inset-0 overflow-hidden font-sans">
      {showBlur && distractorScope ? (
        <>
          <svg className="fixed inset-0 w-0 h-0 pointer-events-none" aria-hidden="true">
            <defs>
              <clipPath id="fg-distractor-clip" clipPathUnits="userSpaceOnUse">
                {distractorTargets.map((item, idx) => (
                  <rect
                    key={idx}
                    x={item.rect.x}
                    y={item.rect.y}
                    width={item.rect.width}
                    height={item.rect.height}
                    rx={10}
                    ry={10}
                  />
                ))}
              </clipPath>
            </defs>
          </svg>
          <div
            className="fixed inset-0 pointer-events-none z-30"
            style={{ clipPath: 'url(#fg-distractor-clip)' }}
          >
            <BlurBackdrop blurPx={frame.blurPx} maskMode="full" />
          </div>
        </>
      ) : showBlur ? (
        <BlurBackdrop
          blurPx={frame.blurPx}
          maskMode={frame.visualStyle === 'vignette_blur' ? 'vignette' : 'full'}
        />
      ) : null}

      <DimLayer
        opacity={opacity}
        cssBlurPx={0}
        mode={frame.mode}
        metric={frame.metric}
        threshold={frame.threshold}
        visualStyle={frame.visualStyle}
        showPauseCard={frame.showPauseCard}
        showCueCard={frame.showCueCard}
        regions={distractorScope ? distractorTargets : undefined}
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
