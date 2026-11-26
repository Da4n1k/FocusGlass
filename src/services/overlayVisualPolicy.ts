import type { OverlayVisualMode } from './eegTypes';

/**
 * Neurotech «Не навреди» (Do No Harm) eye-safety thresholds for full-screen blur:
 * - Mild blur (4–12 px across the whole screen) causes users to squint at half-readable text.
 * - Therefore `fullscreen_dim` keeps blur strictly at 0 px (smooth brightness reduction only),
 * - `vignette_blur` keeps the central reading zone sharp and blurs only the outer perimeter,
 * - `threshold_blur` stays at 0 px blur during mild dips and jumps straight to dense unreadable
 *   blur (≥ 20 px) + «Сделай паузу» card once deficit crosses 45% (releasing at ≤ 35%).
 */
export const THRESHOLD_BLUR_ON_DEFICIT = 0.45;
export const THRESHOLD_BLUR_OFF_DEFICIT = 0.35;
export const DENSE_BLUR_MIN_PX = 20;
export const VIGNETTE_BLUR_MIN_MAX_PX = 10;

/**
 * Anti-flicker stabilization parameters for live dry-electrode EEG:
 * - Exponential display smoothing (`tauUp`, `tauDown`) prevents jarring 0 <-> 0.5
 *   flashes when dry temporal electrodes (T3/T4) jitter or briefly drop contact.
 * - Schmitt-trigger hysteresis + leaky-integrator dwell + min-hold / cooldown
 *   prevents the «Внимание рассеивается» / «Сделай паузу» cue card from
 *   rapidly toggling when opacity hovers around the threshold.
 */
export const OVERLAY_OPACITY_TAU_UP_MS = 320;
export const OVERLAY_OPACITY_TAU_DOWN_MS = 420;
export const OVERLAY_BLUR_TAU_UP_MS = 240;
export const OVERLAY_BLUR_TAU_DOWN_MS = 320;

export const CUE_SHOW_OPACITY = 0.36;
export const CUE_HIDE_OPACITY = 0.20;
export const CUE_SHOW_DELAY_MS = 1500;
export const CUE_HIDE_DELAY_MS = 900;
export const CUE_MIN_VISIBLE_MS = 2000;
export const CUE_MIN_HIDDEN_MS = 1800;

export const VIGNETTE_CUE_SHOW_OPACITY = 0.26;
export const VIGNETTE_CUE_HIDE_OPACITY = 0.14;
export const VIGNETTE_CUE_SHOW_DELAY_MS = 1200;
export const VIGNETTE_CUE_HIDE_DELAY_MS = 900;
export const VIGNETTE_CUE_MIN_VISIBLE_MS = 1800;
export const VIGNETTE_CUE_MIN_HIDDEN_MS = 1500;

export const DISTRACTOR_CUE_SHOW_OPACITY = 0.22;
export const DISTRACTOR_CUE_HIDE_OPACITY = 0.12;
export const DISTRACTOR_CUE_SHOW_DELAY_MS = 1000;
export const DISTRACTOR_CUE_HIDE_DELAY_MS = 800;
export const DISTRACTOR_CUE_MIN_VISIBLE_MS = 1500;
export const DISTRACTOR_CUE_MIN_HIDDEN_MS = 1200;

export const THRESHOLD_BLUR_SHOW_DELAY_MS = 800;
export const THRESHOLD_BLUR_HIDE_DELAY_MS = 900;
export const THRESHOLD_BLUR_MIN_VISIBLE_MS = 2200;
export const THRESHOLD_BLUR_MIN_HIDDEN_MS = 1800;

export interface OverlayVisualInput {
  visualMode: OverlayVisualMode;
  canDim: boolean;
  deficit: number;
  rawOpacity: number;
  maxOpacity: number;
  blurRadiusSetting: number;
  prevThresholdBlurActive: boolean;
}

export interface ResolvedOverlayVisuals {
  opacity: number;
  blurPx: number;
  thresholdBlurActive: boolean;
  showPauseCard: boolean;
  vignetteBlurMask: boolean;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function resolveOverlayVisuals(input: OverlayVisualInput): ResolvedOverlayVisuals {
  if (!input.canDim) {
    return {
      opacity: 0,
      blurPx: 0,
      thresholdBlurActive: false,
      showPauseCard: false,
      vignetteBlurMask: false,
    };
  }

  const deficit = clamp(input.deficit, 0, 1);
  const rawOpacity = clamp(input.rawOpacity, 0, 0.95);
  const maxOpacity = clamp(input.maxOpacity, 0.05, 0.95);
  const blurSetting = clamp(input.blurRadiusSetting, 0, 32);

  switch (input.visualMode) {
    case 'fullscreen_dim':
      return {
        opacity: Number(rawOpacity.toFixed(4)),
        blurPx: 0,
        thresholdBlurActive: false,
        showPauseCard: false,
        vignetteBlurMask: false,
      };

    case 'vignette_blur': {
      const targetMaxBlur = blurSetting > 0 ? Math.max(VIGNETTE_BLUR_MIN_MAX_PX, blurSetting) : 0;
      return {
        opacity: Number(rawOpacity.toFixed(4)),
        blurPx: Number((deficit * targetMaxBlur).toFixed(2)),
        thresholdBlurActive: false,
        showPauseCard: false,
        vignetteBlurMask: true,
      };
    }

    case 'threshold_blur': {
      const active = input.prevThresholdBlurActive
        ? deficit >= THRESHOLD_BLUR_OFF_DEFICIT
        : deficit >= THRESHOLD_BLUR_ON_DEFICIT;

      if (!active) {
        return {
          opacity: Number((rawOpacity * 0.55).toFixed(4)),
          blurPx: 0,
          thresholdBlurActive: false,
          showPauseCard: false,
          vignetteBlurMask: false,
        };
      }

      return {
        opacity: Number(Math.max(0.68, Math.min(0.92, maxOpacity)).toFixed(4)),
        blurPx: Number(Math.max(DENSE_BLUR_MIN_PX, blurSetting).toFixed(2)),
        thresholdBlurActive: true,
        showPauseCard: true,
        vignetteBlurMask: false,
      };
    }

    case 'distractors':
      return {
        opacity: Number(rawOpacity.toFixed(4)),
        blurPx: Number((deficit * blurSetting).toFixed(2)),
        thresholdBlurActive: false,
        showPauseCard: false,
        vignetteBlurMask: false,
      };
  }
}

export interface StabilizedOverlayVisuals extends ResolvedOverlayVisuals {
  /** Time-stabilized visibility flag for «Внимание рассеивается» / «Сделай паузу» / status pills. */
  showCueCard: boolean;
}

export interface OverlayStabilizerInput {
  visualMode: OverlayVisualMode;
  canDim: boolean;
  /** True when stream is disconnected or Fit Check is active: clears immediately without fade lag. */
  hardClear?: boolean;
  deficit: number;
  rawOpacity: number;
  maxOpacity: number;
  blurRadiusSetting: number;
}

interface DwellGateConfig {
  showDelayMs: number;
  hideDelayMs: number;
  minVisibleMs: number;
  minHiddenMs: number;
}

/**
 * Schmitt-trigger + leaky-integrator dwell gate with minimum visible hold and cooldown.
 * Eliminates rapid on/off strobing when live dry-electrode EEG fluctuates around a threshold.
 */
export class DwellHysteresisGate {
  private active = false;
  private onProgress = 0;
  private offProgress = 0;
  private lastTransitionMs = Number.NEGATIVE_INFINITY;

  public reset(): void {
    this.active = false;
    this.onProgress = 0;
    this.offProgress = 0;
    this.lastTransitionMs = Number.NEGATIVE_INFINITY;
  }

  public isActive(): boolean {
    return this.active;
  }

  public update(
    conditionOn: boolean,
    conditionOff: boolean,
    dtMs: number,
    nowMs: number,
    config: DwellGateConfig,
    options?: { fastHide?: boolean }
  ): boolean {
    if (dtMs <= 0) {
      return this.active;
    }

    if (!this.active) {
      const cooldownElapsed = nowMs - this.lastTransitionMs >= config.minHiddenMs;
      if (conditionOn && cooldownElapsed) {
        this.onProgress = Math.min(1, this.onProgress + dtMs / Math.max(1, config.showDelayMs));
        if (this.onProgress >= 1) {
          this.active = true;
          this.onProgress = 0;
          this.offProgress = 0;
          this.lastTransitionMs = nowMs;
        }
      } else if (conditionOff) {
        this.onProgress = Math.max(
          0,
          this.onProgress - dtMs / Math.max(1, config.showDelayMs * 0.5)
        );
      } else {
        this.onProgress = Math.max(
          0,
          this.onProgress - dtMs / Math.max(1, config.showDelayMs * 1.5)
        );
      }
      return this.active;
    }

    const effectiveMinVisible = options?.fastHide
      ? config.minVisibleMs * 0.5
      : config.minVisibleMs;
    const holdElapsed = nowMs - this.lastTransitionMs >= effectiveMinVisible;
    if (!holdElapsed) {
      this.offProgress = 0;
      return this.active;
    }

    if (conditionOff) {
      const hideRateMultiplier = options?.fastHide ? 1.5 : 1;
      this.offProgress = Math.min(
        1,
        this.offProgress + (dtMs * hideRateMultiplier) / Math.max(1, config.hideDelayMs)
      );
      if (this.offProgress >= 1) {
        this.active = false;
        this.onProgress = 0;
        this.offProgress = 0;
        this.lastTransitionMs = nowMs;
      }
    } else if (conditionOn) {
      this.offProgress = Math.max(
        0,
        this.offProgress - dtMs / Math.max(1, config.hideDelayMs * 0.5)
      );
    } else {
      this.offProgress = Math.max(
        0,
        this.offProgress - dtMs / Math.max(1, config.hideDelayMs * 1.5)
      );
    }

    return this.active;
  }
}

function smoothExp(
  current: number,
  target: number,
  dtMs: number,
  tauUpMs: number,
  tauDownMs: number,
  zeroSnap: number
): number {
  if (dtMs <= 0) return current;
  const tau = target >= current ? tauUpMs : tauDownMs;
  const alpha = 1 - Math.exp(-dtMs / Math.max(1, tau));
  const next = current + (target - current) * alpha;
  if (target <= 0 && next < zeroSnap) return 0;
  if (Math.abs(target - next) < zeroSnap * 0.25) return target;
  return next;
}

const FULLSCREEN_CUE_CONFIG: DwellGateConfig = {
  showDelayMs: CUE_SHOW_DELAY_MS,
  hideDelayMs: CUE_HIDE_DELAY_MS,
  minVisibleMs: CUE_MIN_VISIBLE_MS,
  minHiddenMs: CUE_MIN_HIDDEN_MS,
};

const VIGNETTE_CUE_CONFIG: DwellGateConfig = {
  showDelayMs: VIGNETTE_CUE_SHOW_DELAY_MS,
  hideDelayMs: VIGNETTE_CUE_HIDE_DELAY_MS,
  minVisibleMs: VIGNETTE_CUE_MIN_VISIBLE_MS,
  minHiddenMs: VIGNETTE_CUE_MIN_HIDDEN_MS,
};

const DISTRACTOR_CUE_CONFIG: DwellGateConfig = {
  showDelayMs: DISTRACTOR_CUE_SHOW_DELAY_MS,
  hideDelayMs: DISTRACTOR_CUE_HIDE_DELAY_MS,
  minVisibleMs: DISTRACTOR_CUE_MIN_VISIBLE_MS,
  minHiddenMs: DISTRACTOR_CUE_MIN_HIDDEN_MS,
};

const THRESHOLD_BLUR_CONFIG: DwellGateConfig = {
  showDelayMs: THRESHOLD_BLUR_SHOW_DELAY_MS,
  hideDelayMs: THRESHOLD_BLUR_HIDE_DELAY_MS,
  minVisibleMs: THRESHOLD_BLUR_MIN_VISIBLE_MS,
  minHiddenMs: THRESHOLD_BLUR_MIN_HIDDEN_MS,
};

export const EMPTY_STABILIZED_VISUALS: StabilizedOverlayVisuals = {
  opacity: 0,
  blurPx: 0,
  thresholdBlurActive: false,
  showPauseCard: false,
  showCueCard: false,
  vignetteBlurMask: false,
};

/**
 * Stateful presentation-layer stabilizer for FocusGlass overlays:
 * smooths dimming opacity / peripheral blur and debounces cue/pause cards so
 * dry-electrode micro-jitter (e.g. temporal T3/T4 contact bounces) cannot flash UI cues.
 */
export class OverlayVisualStabilizer {
  private displayOpacity = 0;
  private displayBlurPx = 0;
  private lastNowMs: number | null = null;
  private lastMode: OverlayVisualMode | null = null;
  private readonly cueGate = new DwellHysteresisGate();
  private readonly thresholdGate = new DwellHysteresisGate();

  public reset(nowMs?: number): void {
    this.displayOpacity = 0;
    this.displayBlurPx = 0;
    this.lastNowMs = nowMs !== undefined ? nowMs : null;
    this.cueGate.reset();
    this.thresholdGate.reset();
  }

  public update(input: OverlayStabilizerInput, nowMs: number): StabilizedOverlayVisuals {
    if (input.hardClear) {
      this.reset(nowMs);
      this.lastMode = input.visualMode;
      return {
        ...EMPTY_STABILIZED_VISUALS,
        vignetteBlurMask: input.visualMode === 'vignette_blur',
      };
    }

    const dtMs =
      this.lastNowMs === null ? 0 : Math.max(0, Math.min(5000, nowMs - this.lastNowMs));
    this.lastNowMs = nowMs;

    if (this.lastMode !== null && this.lastMode !== input.visualMode) {
      this.cueGate.reset();
      this.thresholdGate.reset();
      if (input.visualMode === 'fullscreen_dim') {
        this.displayBlurPx = 0;
      }
    }
    this.lastMode = input.visualMode;

    const deficit = clamp(input.deficit, 0, 1);
    const rawOpacity = clamp(input.rawOpacity, 0, 0.95);
    const maxOpacity = clamp(input.maxOpacity, 0.05, 0.95);
    const blurSetting = clamp(input.blurRadiusSetting, 0, 32);

    let targetOpacity = 0;
    let targetBlurPx = 0;
    let thresholdBlurActive = false;
    let showPauseCard = false;
    let vignetteBlurMask = false;

    if (input.visualMode === 'threshold_blur') {
      const condOn = input.canDim && deficit >= THRESHOLD_BLUR_ON_DEFICIT;
      const condOff = !input.canDim || deficit < THRESHOLD_BLUR_OFF_DEFICIT;
      thresholdBlurActive = this.thresholdGate.update(
        condOn,
        condOff,
        dtMs,
        nowMs,
        THRESHOLD_BLUR_CONFIG
      );

      if (thresholdBlurActive) {
        targetOpacity = Math.max(0.68, Math.min(0.92, maxOpacity));
        targetBlurPx = Math.max(DENSE_BLUR_MIN_PX, blurSetting);
        showPauseCard = true;
      } else {
        targetOpacity = input.canDim ? rawOpacity * 0.55 : 0;
        targetBlurPx = 0;
        showPauseCard = false;
      }
    } else {
      const resolved = resolveOverlayVisuals({
        visualMode: input.visualMode,
        canDim: input.canDim,
        deficit,
        rawOpacity,
        maxOpacity,
        blurRadiusSetting: blurSetting,
        prevThresholdBlurActive: false,
      });
      targetOpacity = resolved.opacity;
      targetBlurPx = resolved.blurPx;
      vignetteBlurMask = resolved.vignetteBlurMask;
    }

    this.displayOpacity = smoothExp(
      this.displayOpacity,
      targetOpacity,
      dtMs,
      OVERLAY_OPACITY_TAU_UP_MS,
      OVERLAY_OPACITY_TAU_DOWN_MS,
      0.004
    );

    if (input.visualMode === 'fullscreen_dim') {
      this.displayBlurPx = 0;
    } else if (input.visualMode === 'threshold_blur') {
      // Eye-safety «не навреди»: never linger in half-readable 4..15 px blur; jump directly 0 <-> >=20 px.
      this.displayBlurPx = targetBlurPx;
    } else {
      this.displayBlurPx = smoothExp(
        this.displayBlurPx,
        targetBlurPx,
        dtMs,
        OVERLAY_BLUR_TAU_UP_MS,
        OVERLAY_BLUR_TAU_DOWN_MS,
        0.15
      );
    }

    let showCueCard = false;
    if (input.visualMode === 'threshold_blur') {
      showCueCard = showPauseCard;
    } else if (input.visualMode === 'vignette_blur') {
      const onThreshold = Math.min(VIGNETTE_CUE_SHOW_OPACITY, maxOpacity * 0.55);
      const offThreshold = Math.min(VIGNETTE_CUE_HIDE_OPACITY, maxOpacity * 0.30);
      showCueCard = this.cueGate.update(
        this.displayOpacity >= onThreshold && this.displayOpacity >= 0.14,
        this.displayOpacity <= offThreshold,
        dtMs,
        nowMs,
        VIGNETTE_CUE_CONFIG,
        { fastHide: this.displayOpacity <= 0.02 }
      );
    } else if (input.visualMode === 'distractors') {
      const onThreshold = Math.min(DISTRACTOR_CUE_SHOW_OPACITY, maxOpacity * 0.50);
      const offThreshold = Math.min(DISTRACTOR_CUE_HIDE_OPACITY, maxOpacity * 0.25);
      showCueCard = this.cueGate.update(
        this.displayOpacity >= onThreshold && this.displayOpacity >= 0.12,
        this.displayOpacity <= offThreshold,
        dtMs,
        nowMs,
        DISTRACTOR_CUE_CONFIG,
        { fastHide: this.displayOpacity <= 0.02 }
      );
    } else {
      const onThreshold = Math.min(CUE_SHOW_OPACITY, maxOpacity * 0.72);
      const offThreshold = Math.min(CUE_HIDE_OPACITY, maxOpacity * 0.40);
      showCueCard = this.cueGate.update(
        this.displayOpacity >= onThreshold && this.displayOpacity >= 0.18,
        this.displayOpacity <= offThreshold,
        dtMs,
        nowMs,
        FULLSCREEN_CUE_CONFIG,
        { fastHide: this.displayOpacity <= 0.02 }
      );
    }

    return {
      opacity: Number(clamp(this.displayOpacity, 0, 0.95).toFixed(4)),
      blurPx: Number(clamp(this.displayBlurPx, 0, 32).toFixed(2)),
      thresholdBlurActive,
      showPauseCard,
      showCueCard,
      vignetteBlurMask,
    };
  }
}
