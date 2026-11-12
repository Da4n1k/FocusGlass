import React from 'react';
import { Eye, Wind, Sparkles } from 'lucide-react';

export interface OverlayCue {
  isConcentration: boolean;
  smoothedMetric: number;
  threshold: number;
}

interface OverlayLayerProps {
  /** Dimming opacity actually to show, already zeroed when dimming must be suppressed. */
  opacity: number;
  blurPx: number;
  cue: OverlayCue;
}

/** Pure presentation of the dimming layer; shared by the in-page overlay and the overlay window. */
export const OverlayLayer: React.FC<OverlayLayerProps> = ({ opacity, blurPx, cue }) => {
  const { isConcentration, smoothedMetric, threshold } = cue;

  return (
    <div
      className="fixed inset-0 pointer-events-none z-40 transition-all duration-500 ease-out flex flex-col items-center justify-center overflow-hidden"
      style={{
        backgroundColor: `rgba(6, 9, 18, ${opacity})`,
        backdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
        WebkitBackdropFilter: blurPx > 0 ? `blur(${blurPx}px)` : 'none',
      }}
    >
      {/* Peripheral Vignette Gradient */}
      <div
        className="absolute inset-0 transition-opacity duration-700 pointer-events-none"
        style={{
          opacity: opacity > 0 ? Math.min(1, opacity * 1.4) : 0,
          background:
            'radial-gradient(circle at center, transparent 35%, rgba(10, 15, 30, 0.4) 65%, rgba(0, 0, 0, 0.95) 100%)',
        }}
      />

      {/* Gentle Biofeedback Cue (appears when deeply dimmed) */}
      {opacity > 0.35 && (
        <div className="relative z-10 flex flex-col items-center gap-2 p-6 rounded-3xl bg-slate-950/60 border border-white/10 backdrop-blur-xl shadow-2xl animate-in fade-in zoom-in-95 duration-500 max-w-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center text-[#FF6600] shadow-[0_0_20px_rgba(255,102,0,0.3)]">
            {isConcentration ? (
              <Eye className="w-6 h-6 animate-pulse" />
            ) : (
              <Wind className="w-6 h-6 animate-pulse" />
            )}
          </div>
          <div>
            <h4 className="text-sm font-bold text-white tracking-wide">
              {isConcentration ? 'Attention Drifting' : 'Tension Detected'}
            </h4>
            <p className="text-xs text-slate-300 mt-1">
              {isConcentration
                ? `Focus dropped to ${Math.round(smoothedMetric)}% (target ≥ ${threshold}%). Return attention to your active task.`
                : `Calm index dropped to ${Math.round(smoothedMetric)}% (target ≥ ${threshold}%). Slow down your breathing to restore Alpha rhythm.`}
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-orange-400/90 font-medium mt-1">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Screen clears automatically when metric recovers</span>
          </div>
        </div>
      )}
    </div>
  );
};
