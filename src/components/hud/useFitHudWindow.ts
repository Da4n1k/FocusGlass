import React from 'react';
import { tauriBridge } from '../../services/tauriBridge';

/**
 * Physical size the HUD window needs so the card and its screen-edge margins fit exactly.
 * CSS sizes depend on the display: with Xft.dpi = 120 WebKit enlarges `rem`, so a card that is
 * 320 px wide at 96 dpi is 400 px wide, and a fixed window size would clip it.
 */
export function computeHudWindowSize(
  cardWidthCss: number,
  cardHeightCss: number,
  edgeXCss: number,
  edgeYCss: number,
  devicePixelRatio: number
): { width: number; height: number } {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const edgeX = Number.isFinite(edgeXCss) && edgeXCss > 0 ? edgeXCss : 0;
  const edgeY = Number.isFinite(edgeYCss) && edgeYCss > 0 ? edgeYCss : 0;
  return {
    width: Math.ceil((Math.max(0, cardWidthCss) + 2 * edgeX) * dpr),
    height: Math.ceil((Math.max(0, cardHeightCss) + 2 * edgeY) * dpr),
  };
}

/**
 * Keeps the native HUD window exactly as large as the element it shows, also when the content
 * changes size (a badge appears, a row wraps). `ref` must point at the element that is anchored
 * to the window's top-right corner (`fixed top-* right-*`).
 */
export function useFitHudWindow(ref: React.RefObject<HTMLElement | null>): void {
  React.useEffect(() => {
    const element = ref.current;
    if (!element || !('__TAURI_INTERNALS__' in window)) return;

    let frame = 0;
    const fit = () => {
      frame = 0;
      const style = getComputedStyle(element);
      const { width, height } = computeHudWindowSize(
        element.offsetWidth,
        element.offsetHeight,
        parseFloat(style.right),
        parseFloat(style.top),
        window.devicePixelRatio
      );
      void tauriBridge.fitHudWindow(width, height);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(fit);
    };

    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    schedule();

    return () => {
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [ref]);
}
