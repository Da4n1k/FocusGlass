import React from 'react';
import {
  Brain,
  Sliders,
  MousePointerClick,
  Maximize2,
  Zap,
  Play,
  Pause,
  AlertCircle,
} from 'lucide-react';
import type { ElectrodeSignalQuality, PresetState } from '../../services/eegTypes';
import { GlassPanel } from '../glass/GlassPanel';
import { CompactElectrodePill } from './CompactElectrodePill';

export interface FocusBarHUDViewProps {
  mode: 'concentration' | 'relaxation';
  isSimulator: boolean;
  streamActive: boolean;
  contactOk: boolean;
  artifactFrozen: boolean;
  metric: number;
  threshold: number;
  sensors: ElectrodeSignalQuality;
  isPaused: boolean;
  activePreset: PresetState;
  isClickThrough: boolean;
  /** Enables native Tauri window dragging on the HUD header (used on Linux HUD window). */
  dragRegion?: boolean;
  onTogglePause: () => void;
  onOpenDashboard: () => void;
  /** Кнопка настроек показывается только там, где настройки доступны (окно панели). */
  onOpenSettings?: () => void;
  onToggleClickThrough: () => void;
  onSetPreset: (preset: PresetState) => void;
  onInjectArtifact: () => void;
}

const PRESET_BUTTONS = [
  { key: '1', name: 'Focus', preset: 'high_focus' },
  { key: '2', name: 'Flow', preset: 'calm_flow' },
  { key: '3', name: 'Drop', preset: 'attention_drift' },
  { key: '4', name: 'Blink', preset: 'artifact' },
] as const;

/**
 * Плавающий HUD («шкала-столбик»). Чистый презентационный компонент (без импорта стора):
 * рисуется в едином окне оверлея (Windows), в браузерном режиме и внутри `FocusBarHUD` (Linux).
 */
export const FocusBarHUDView = React.forwardRef<HTMLDivElement, FocusBarHUDViewProps>(
  (props, ref) => {
    const {
      mode,
      isSimulator,
      streamActive,
      contactOk,
      artifactFrozen,
      metric,
      threshold,
      sensors,
      isPaused,
      activePreset,
      isClickThrough,
      dragRegion = false,
    } = props;

    const isConcentration = mode === 'concentration';
    const hasSignal = streamActive && contactOk;
    const isBelowThreshold = hasSignal && metric < threshold;

    return (
      <div
        ref={ref}
        // A standalone native HUD must fit the card, not a transparent shadow
        // gutter: the compositor excludes this window's bounds from our blur.
        className={`fixed ${dragRegion ? 'top-0 right-0' : 'top-5 right-5'} z-50 select-none animate-in fade-in duration-300`}
      >
        <GlassPanel
          variant="primary"
          glow={isBelowThreshold ? 'orange' : 'cyan'}
          className="p-3.5 w-80 shadow-2xl backdrop-blur-2xl border-white/20"
        >
          {/* Top Header */}
          <div
            {...(dragRegion ? { 'data-tauri-drag-region': 'deep' } : {})}
            className="flex items-center justify-between pb-2.5 mb-2.5 border-b border-white/10"
          >
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#FF6600] to-[#E64A00] flex items-center justify-center shadow-md">
                <Brain className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold tracking-wide uppercase text-white">
                    FocusGlass
                  </span>
                  <span className="text-[10px] px-1 rounded bg-orange-500/20 text-[#FF6600] font-mono font-medium">
                    {isSimulator ? 'SIM' : 'BLE'}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 capitalize">
                  {isConcentration ? 'Beta Focus Mode' : 'Alpha Calm Mode'}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1">
              {isSimulator && (
                <button
                  onClick={props.onTogglePause}
                  title={isPaused ? 'Resume Simulation (Space)' : 'Pause Simulation (Space)'}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {isPaused ? (
                    <Play className="w-3.5 h-3.5 text-emerald-400" />
                  ) : (
                    <Pause className="w-3.5 h-3.5" />
                  )}
                </button>
              )}
              <button
                onClick={props.onOpenDashboard}
                title="Open Full Dashboard (Ctrl+Shift+G)"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              {props.onOpenSettings && (
                <button
                  onClick={props.onOpenSettings}
                  title="Settings"
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Live Score Display */}
          <div className="flex items-baseline justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-slate-300 font-medium">
                {isConcentration ? 'Concentration' : 'Relaxation'}
              </span>
              {streamActive && artifactFrozen && (
                <span className="text-[10px] text-amber-400 flex items-center gap-0.5">
                  <AlertCircle className="w-2.5 h-2.5" /> Artifact
                </span>
              )}
              {streamActive && !contactOk && (
                <span className="text-[10px] text-rose-400 flex items-center gap-0.5">
                  <AlertCircle className="w-2.5 h-2.5" /> Contact Lost
                </span>
              )}
              {!streamActive && (
                <span className="text-[10px] text-rose-400 flex items-center gap-0.5">
                  <AlertCircle className="w-2.5 h-2.5" /> Disconnected
                </span>
              )}
            </div>
            <div className="flex items-baseline gap-1">
              <span
                className={`text-2xl font-black font-mono tracking-tight ${
                  !hasSignal
                    ? 'text-slate-500'
                    : isBelowThreshold
                    ? 'text-[#FF6600]'
                    : 'text-[#00D2FF]'
                }`}
              >
                {hasSignal ? `${Math.round(metric)}%` : '—'}
              </span>
              <span className="text-xs text-slate-400 font-mono">/ {threshold}%</span>
            </div>
          </div>

          {/* The Liquid Glass Focus Bar ("Шкала-столбик") */}
          <div className="relative h-6 bg-slate-900/80 rounded-full border border-white/15 p-0.5 shadow-inner overflow-hidden mb-3">
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-white/70 z-20 shadow-[0_0_8px_white]"
              style={{ left: `${threshold}%` }}
              title={`Threshold: ${threshold}%`}
            >
              <div className="w-1.5 h-1.5 bg-white rounded-full -ml-0.5 -mt-0.5 shadow-sm" />
            </div>

            <div
              className={`h-full rounded-full transition-all duration-300 relative overflow-hidden ${
                isBelowThreshold
                  ? 'bg-gradient-to-r from-red-600 via-[#FF6600] to-[#FFA347]'
                  : 'bg-gradient-to-r from-cyan-600 via-[#00D2FF] to-emerald-400'
              }`}
              style={{ width: `${hasSignal ? Math.max(4, Math.min(100, metric)) : 0}%` }}
            >
              <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/40 to-transparent" />
            </div>
          </div>

          {/* Electrode Micro Contact Indicator & Click-Through Button */}
          <div className="flex items-center justify-between text-xs pt-1">
            <CompactElectrodePill quality={sensors} streamActive={streamActive} />

            <button
              onClick={props.onToggleClickThrough}
              className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border transition-all cursor-pointer ${
                isClickThrough
                  ? 'bg-[#00D2FF]/20 text-[#00D2FF] border-[#00D2FF]/40 shadow-[0_0_12px_rgba(0,210,255,0.3)]'
                  : 'bg-white/5 hover:bg-white/10 text-slate-300 border-white/10'
              }`}
              title="Click-Through: HUD stops catching the mouse too (Ctrl+Shift+G or tray menu to restore)"
            >
              <MousePointerClick className="w-3 h-3" />
              <span>{isClickThrough ? 'Click-Thru ON' : 'Interactive'}</span>
            </button>
          </div>

          {/* Quick Simulator Shortcuts Helper */}
          {isSimulator && (
            <div className="mt-3 pt-2.5 border-t border-white/10 flex items-center justify-between text-[10px] text-slate-400">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                Sim Presets:
              </span>
              <div className="flex items-center gap-1">
                {PRESET_BUTTONS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => {
                      if (p.preset === 'artifact') {
                        props.onInjectArtifact();
                      } else {
                        props.onSetPreset(p.preset);
                      }
                    }}
                    className={`px-1.5 py-0.5 rounded border text-[10px] transition-colors cursor-pointer ${
                      activePreset === p.preset
                        ? 'bg-[#FF6600]/30 text-[#FF6600] border-[#FF6600]/50'
                        : 'bg-white/5 hover:bg-white/10 text-slate-400 border-white/10'
                    }`}
                  >
                    <kbd className="font-mono font-bold text-white/90">{p.key}</kbd>:{p.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </GlassPanel>
      </div>
    );
  }
);
FocusBarHUDView.displayName = 'FocusBarHUDView';
