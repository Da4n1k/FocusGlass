import React, { useState } from 'react';
import {
  X,
  Sliders,
  Bluetooth,
  Gauge,
  Sparkles,
  Play,
  CheckCircle,
  Keyboard,
  Info,
  AlertTriangle,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassButton } from '../glass/GlassButton';
import { BiofeedbackConfig } from './BiofeedbackConfig';
import { DeviceSelector } from './DeviceSelector';

export const SettingsModal: React.FC = () => {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    settings,
    deviceStatus,
    isCalibrating,
    calibrationDurationSeconds,
    setCalibrationDuration,
    calibrationProgress,
    calibrationRemainingSeconds,
    calibrationResult,
    startCalibration,
    cancelCalibration,
    applyCalibration,
  } = useFocusStore();

  const [activeTab, setActiveTab] = useState<'bci' | 'device' | 'calibration' | 'hotkeys'>('bci');

  if (!isSettingsOpen) return null;

  const isStreamReady = settings.deviceSource === 'simulator' || deviceStatus.connected;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in duration-200">
      <GlassPanel
        variant="primary"
        className="w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl border-white/20"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-orange-500/20 text-[#FF6600]">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-wide">
                FocusGlass Control Center
              </h2>
              <p className="text-xs text-slate-400">Biological Feedback (БОС) Configuration</p>
            </div>
          </div>

          <button
            onClick={() => setIsSettingsOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-white/10 px-6 gap-2 bg-slate-950/30 shrink-0 overflow-x-auto">
          {[
            {
              id: 'bci' as const,
              label: 'Biofeedback Parameters',
              icon: <Sliders className="w-3.5 h-3.5" />,
            },
            {
              id: 'device' as const,
              label: 'BrainBit & Simulator',
              icon: <Bluetooth className="w-3.5 h-3.5" />,
            },
            {
              id: 'calibration' as const,
              label: 'Baseline Calibration',
              icon: <Gauge className="w-3.5 h-3.5" />,
            },
            {
              id: 'hotkeys' as const,
              label: 'Demo Shortcuts',
              icon: <Keyboard className="w-3.5 h-3.5" />,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? 'border-[#FF6600] text-[#FF6600] bg-orange-500/10'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab Content Body */}
        <div className="p-6 overflow-y-auto space-y-4 grow">
          {activeTab === 'bci' && <BiofeedbackConfig />}

          {activeTab === 'device' && <DeviceSelector />}

          {activeTab === 'calibration' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-white font-semibold text-xs">
                    <Info className="w-4 h-4 text-[#00D2FF]" />
                    <span>
                      Individual Baseline Calibration (
                      {settings.mode === 'concentration' ? 'Focus / Beta' : 'Calm / Alpha'})
                    </span>
                  </div>

                  {/* Duration selector */}
                  <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5 border border-white/10 text-[11px]">
                    {([10, 30] as const).map((sec) => (
                      <button
                        key={sec}
                        disabled={isCalibrating}
                        onClick={() => setCalibrationDuration(sec)}
                        className={`px-2.5 py-0.5 rounded cursor-pointer ${
                          calibrationDurationSeconds === sec
                            ? 'bg-white/20 text-white font-medium'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {sec}s
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  Records clean 250 Hz telemetry frames (excluding EOG/EMG artifacts and lost
                  contact intervals) to estimate personal mean and standard deviation for the
                  selected training mode.
                </p>

                {!isStreamReady && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                    <span>
                      Active signal stream required. Connect a BrainBit headband or switch to
                      Simulator in the Device tab.
                    </span>
                  </div>
                )}

                {isCalibrating ? (
                  <div className="mt-3 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-center space-y-2.5">
                    <span className="text-xs text-orange-300 font-medium block">
                      Recording baseline ({calibrationRemainingSeconds}s remaining)... Keep steady
                      posture and relax facial muscles.
                    </span>
                    <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden border border-white/10">
                      <div
                        className="h-full bg-gradient-to-r from-[#FF6600] to-[#00D2FF] transition-all duration-200"
                        style={{ width: `${calibrationProgress}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-400 pt-1">
                      <span className="font-mono">{calibrationProgress}%</span>
                      <GlassButton
                        size="sm"
                        variant="secondary"
                        onClick={() => cancelCalibration()}
                      >
                        Cancel
                      </GlassButton>
                    </div>
                  </div>
                ) : calibrationResult ? (
                  <div className="mt-3 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-2 text-emerald-400 font-semibold">
                        <CheckCircle className="w-4 h-4" />
                        {(calibrationResult.sampleCount ?? 0) > 0
                          ? 'Baseline Computed'
                          : 'Insufficient Clean Signal'}
                      </span>
                      <span className="text-[11px] font-mono text-slate-400">
                        Clean samples: {calibrationResult.sampleCount ?? 0} · Confidence:{' '}
                        {Math.round(calibrationResult.confidence * 100)}%
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">Baseline Focus</span>
                        <span className="font-mono text-white font-bold">
                          {calibrationResult.baselineFocus}%
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">Baseline Calm</span>
                        <span className="font-mono text-white font-bold">
                          {calibrationResult.baselineRelaxation}%
                        </span>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">
                          Recommended Cutoff
                        </span>
                        <span className="font-mono text-[#FF6600] font-bold">
                          {calibrationResult.recommendedThreshold}%
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <GlassButton
                        size="sm"
                        variant="secondary"
                        disabled={!isStreamReady}
                        onClick={() => startCalibration()}
                      >
                        Recalibrate ({calibrationDurationSeconds}s)
                      </GlassButton>
                      <GlassButton
                        size="sm"
                        variant="primary"
                        disabled={(calibrationResult.sampleCount ?? 0) === 0}
                        onClick={() => applyCalibration()}
                      >
                        Apply Threshold ({calibrationResult.recommendedThreshold}%)
                      </GlassButton>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 text-center">
                    <GlassButton
                      variant="primary"
                      disabled={!isStreamReady}
                      onClick={() => startCalibration()}
                      icon={<Play className="w-4 h-4 fill-white" />}
                    >
                      Start {calibrationDurationSeconds}s Calibration
                    </GlassButton>
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'hotkeys' && (
            <div className="space-y-4">
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
                <h3 className="text-xs font-bold text-white tracking-wide flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                  Simulator & Window Shortcuts
                </h3>
                <p className="text-xs text-slate-300">
                  Keys 1–5 and Space control the synthetic EEG generator when Simulator mode is
                  selected:
                </p>

                <div className="space-y-2 pt-1 text-xs">
                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-[#FF6600]">
                        1
                      </kbd>
                      <span className="text-white font-medium">High Focus State (92%)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Clear screen, high Beta waves</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-[#00D2FF]">
                        2
                      </kbd>
                      <span className="text-white font-medium">Flow State (78%)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Balanced Alpha & Beta</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-red-400">
                        3
                      </kbd>
                      <span className="text-white font-medium">Attention Drift (42%)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Triggers smooth optical dimming</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-amber-400">
                        4
                      </kbd>
                      <span className="text-white font-medium">Blink / EMG Burst (240 ms)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Freezes opacity without flicker</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-purple-400">
                        5
                      </kbd>
                      <span className="text-white font-medium">Meditation / Calm (94%)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">High Alpha, low Beta</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-3 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-white">
                        Space
                      </kbd>
                      <span className="text-white font-medium">Pause / Resume Simulator</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Freeze synthetic stream</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-cyan-300">
                        Ctrl+Shift+G
                      </kbd>
                      <span className="text-white font-medium">Exit Click-Through (Global)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Restores interactive window</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-3 border-t border-white/10 bg-slate-950/40 shrink-0">
          <GlassButton variant="secondary" size="sm" onClick={() => setIsSettingsOpen(false)}>
            Close Settings
          </GlassButton>
        </div>
      </GlassPanel>
    </div>
  );
};
