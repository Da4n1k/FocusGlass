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
    isCalibrating,
    calibrationProgress,
    calibrationResult,
    startCalibration,
    applyCalibration,
  } = useFocusStore();

  const [activeTab, setActiveTab] = useState<'bci' | 'device' | 'calibration' | 'hotkeys'>('bci');

  if (!isSettingsOpen) return null;

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
              <h2 className="text-base font-bold text-white tracking-wide">FocusGlass Control Center</h2>
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
        <div className="flex border-b border-white/10 px-6 gap-2 bg-slate-950/30 shrink-0">
          {[
            { id: 'bci' as const, label: 'Biofeedback Parameters', icon: <Sliders className="w-3.5 h-3.5" /> },
            { id: 'device' as const, label: 'BrainBit Device & BLE', icon: <Bluetooth className="w-3.5 h-3.5" /> },
            { id: 'calibration' as const, label: 'User Calibration', icon: <Gauge className="w-3.5 h-3.5" /> },
            { id: 'hotkeys' as const, label: 'Presentation Demo', icon: <Keyboard className="w-3.5 h-3.5" /> },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3.5 py-2.5 text-xs font-semibold border-b-2 transition-all cursor-pointer ${
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
              <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
                <div className="flex items-center gap-2 mb-2 text-white font-semibold text-xs">
                  <Info className="w-4 h-4 text-[#00D2FF]" />
                  <span>30-Second Baseline Calibration</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Every person possesses a distinct individual baseline for EEG Alpha and Beta rhythm powers.
                  Calibration records your brain activity during relaxed focus to calculate your optimal personal biofeedback threshold.
                </p>

                {/* Calibration in Progress */}
                {isCalibrating ? (
                  <div className="mt-4 p-4 rounded-xl bg-orange-500/10 border border-orange-500/30 text-center space-y-2">
                    <span className="text-xs text-orange-300 font-medium block">
                      Recording EEG Baselines... Stay relaxed and look at your screen.
                    </span>
                    <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden border border-white/10">
                      <div
                        className="h-full bg-gradient-to-r from-[#FF6600] to-[#00D2FF] transition-all duration-150"
                        style={{ width: `${calibrationProgress}%` }}
                      />
                    </div>
                    <span className="text-[11px] font-mono text-slate-400">{calibrationProgress}%</span>
                  </div>
                ) : calibrationResult ? (
                  <div className="mt-4 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold">
                      <CheckCircle className="w-4 h-4" />
                      <span>Calibration Complete</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">Baseline Focus</span>
                        <span className="font-mono text-white font-bold">{calibrationResult.baselineFocus}%</span>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">Baseline Calm</span>
                        <span className="font-mono text-white font-bold">{calibrationResult.baselineRelaxation}%</span>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/10">
                        <span className="text-slate-400 block text-[10px]">Recommended Cutoff</span>
                        <span className="font-mono text-[#FF6600] font-bold">{calibrationResult.recommendedThreshold}%</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <GlassButton size="sm" variant="secondary" onClick={() => startCalibration()}>
                        Recalibrate
                      </GlassButton>
                      <GlassButton size="sm" variant="primary" onClick={() => applyCalibration()}>
                        Apply Recommended Threshold ({calibrationResult.recommendedThreshold}%)
                      </GlassButton>
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 text-center">
                    <GlassButton
                      variant="primary"
                      onClick={() => startCalibration()}
                      icon={<Play className="w-4 h-4 fill-white" />}
                    >
                      Start Guided Calibration
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
                  Presentation Live Shortcuts (Tomorrow's Pitch)
                </h3>
                <p className="text-xs text-slate-300">
                  During the presentation, press the following physical keys anywhere in the app to showcase immediate biofeedback reactions:
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
                      <span className="text-white font-medium">Attention Drift (42% Focus Drop)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Triggers dynamic optical dimming!</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-amber-400">
                        4
                      </kbd>
                      <span className="text-white font-medium">Blink / Muscle Artifact</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Demonstrates anti-flicker freeze</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-2 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-purple-400">
                        5
                      </kbd>
                      <span className="text-white font-medium">Meditation / Calm (94%)</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Synchronous Alpha rhythm</span>
                  </div>

                  <div className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10">
                    <div className="flex items-center gap-2">
                      <kbd className="px-3 py-1 rounded bg-black/60 border border-white/20 font-mono font-bold text-white">
                        Space
                      </kbd>
                      <span className="text-white font-medium">Pause / Resume Telemetry</span>
                    </div>
                    <span className="text-slate-400 text-[11px]">Freeze signal generator</span>
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
