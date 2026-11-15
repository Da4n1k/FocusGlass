import React, { useEffect, useState } from 'react';
import { Target, Wind, Volume2, VolumeX, ShieldBan } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassSlider } from '../glass/GlassSlider';

export const BiofeedbackConfig: React.FC = () => {
  const { settings, activeCalibration, updateSettings, isTauri, distractionSupported, foregroundWindow } =
    useFocusStore();

  // Edit distractor patterns as multi-line text and apply on blur so the window
  // monitor doesn't reconfigure on every keystroke.
  const [patternDraft, setPatternDraft] = useState(settings.distractorPatterns.join('\n'));
  useEffect(() => {
    setPatternDraft(settings.distractorPatterns.join('\n'));
  }, [settings.distractorPatterns]);

  const commitPatterns = () => {
    const patterns = Array.from(
      new Set(
        patternDraft
          .split('\n')
          .map((p) => p.trim().toLowerCase())
          .filter((p) => p.length > 0)
      )
    );
    if (patterns.join('\n') !== settings.distractorPatterns.join('\n')) {
      updateSettings({ distractorPatterns: patterns });
    }
  };

  return (
    <div className="space-y-4">
      {/* Mode Selector */}
      <div>
        <label className="text-xs font-semibold text-slate-300 block mb-1.5">
          Training Mode & Target Cognitive Metric
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => updateSettings({ mode: 'concentration' })}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              settings.mode === 'concentration'
                ? 'bg-[#FF6600]/20 border-[#FF6600]/50 shadow-[0_0_16px_rgba(255,102,0,0.25)]'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-[#FF6600]" />
              <span className="text-xs font-bold text-white">Concentration (Focus)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Tracks high-frequency Beta (14-30 Hz) rhythm. Screen dims when attention wanders.
            </p>
          </button>

          <button
            onClick={() => updateSettings({ mode: 'relaxation' })}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              settings.mode === 'relaxation'
                ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 shadow-[0_0_16px_rgba(139,92,246,0.25)]'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Wind className="w-4 h-4 text-[#8B5CF6]" />
              <span className="text-xs font-bold text-white">Relaxation (Calm)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Tracks synchronous Alpha (8-13 Hz) rhythm. Screen dims when tension and stress rise.
            </p>
          </button>
        </div>
      </div>

      {/* Threshold Slider */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
        <GlassSlider
          label={activeCalibration ? 'Target Cutoff (Source Index)' : 'Target Biofeedback Threshold'}
          value={settings.threshold}
          min={10}
          max={95}
          step={5}
          unit="%"
          accentColor={settings.mode === 'concentration' ? 'orange' : 'violet'}
          description={activeCalibration ? 'Stored in the original Focus/Calm index. Personal calibration maps the cutoff to the displayed 0–100 score.' : 'The cutoff point. Any score below this triggers proportional screen darkening.'}
          onChange={(val) => updateSettings({ threshold: val })}
        />
      </div>

      {/* Sensitivity & Smoothing */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
        <GlassSlider
          label="Sensitivity & Moving Average Smoothing"
          value={settings.sensitivitySeconds}
          min={0.5}
          max={5.0}
          step={0.5}
          unit="s"
          accentColor="cyan"
          description="Time window for rolling average. Lower = instant reaction; Higher = gentle smooth transitions."
          onChange={(val) => updateSettings({ sensitivitySeconds: val })}
        />
      </div>

      {/* Visual Dimming & Blur Settings */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 space-y-3">
        <GlassSlider
          label="Maximum Screen Dimming Opacity"
          value={Math.round(settings.dimmingMaxOpacity * 100)}
          min={10}
          max={95}
          step={5}
          unit="%"
          accentColor="orange"
          description="How dark the screen gets when focus completely drops to zero."
          onChange={(val) => updateSettings({ dimmingMaxOpacity: val / 100 })}
        />

        <GlassSlider
          label="Screen Blur Strength"
          value={settings.blurRadius}
          min={0}
          max={32}
          step={2}
          unit="px"
          accentColor="cyan"
          description={
            isTauri
              ? 'Desktop overlay: on Windows other apps are blurred from a live screen snapshot (engaging from 4 px, hidden from capture while active); on Linux/browser backdrop-blur is used. 0 = dimming only.'
              : 'Browser mode: Gaussian backdrop-blur radius applied to the page when focus is fully lost.'
          }
          onChange={(val) => updateSettings({ blurRadius: val })}
        />
      </div>

      {/* Smart distraction blocking */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldBan className="w-4 h-4 text-[#FF6600]" />
          <span className="text-xs font-semibold text-white">Dimming Scope</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => updateSettings({ dimmingScope: 'fullscreen' })}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              settings.dimmingScope === 'fullscreen'
                ? 'bg-[#FF6600]/20 border-[#FF6600]/50'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <span className="text-xs font-bold text-white block">Whole Screen</span>
            <span className="text-[11px] text-slate-400">
              Everything dims when the metric drops below the threshold.
            </span>
          </button>
          <button
            disabled={!distractionSupported}
            onClick={() => updateSettings({ dimmingScope: 'distractors' })}
            className={`p-2.5 rounded-xl border text-left transition-all ${
              !distractionSupported
                ? 'opacity-40 cursor-not-allowed bg-white/5 border-white/10'
                : settings.dimmingScope === 'distractors'
                ? 'bg-[#FF6600]/20 border-[#FF6600]/50 cursor-pointer'
                : 'bg-white/5 border-white/10 hover:border-white/20 cursor-pointer'
            }`}
          >
            <span className="text-xs font-bold text-white block">Distracting Apps Only</span>
            <span className="text-[11px] text-slate-400">
              {distractionSupported
                ? 'Only the active window is dimmed, and only if it matches the list below.'
                : 'Requires the FocusGlass desktop app on Windows.'}
            </span>
          </button>
        </div>

        {settings.dimmingScope === 'distractors' && (
          <div className="space-y-1.5">
            <label className="text-[11px] text-slate-300 block" htmlFor="distractor-patterns">
              Distractor list — one entry per line, matched against the process name and window
              title (so browser tabs like “YouTube” work too)
            </label>
            <textarea
              id="distractor-patterns"
              value={patternDraft}
              onChange={(e) => setPatternDraft(e.target.value)}
              onBlur={commitPatterns}
              rows={4}
              spellCheck={false}
              className="w-full rounded-lg bg-black/40 border border-white/15 px-2.5 py-1.5 text-xs font-mono text-slate-100 select-text focus:outline-none focus:border-[#FF6600]/60"
            />
            <p className="text-[11px] text-slate-400">
              Active window:{' '}
              {foregroundWindow ? (
                <span className={foregroundWindow.isDistractor ? 'text-[#FF6600]' : 'text-emerald-400'}>
                  {foregroundWindow.exe || 'unknown'} —{' '}
                  {foregroundWindow.isDistractor
                    ? `distractor (“${foregroundWindow.matchedPattern ?? ''}”)`
                    : 'allowed'}
                </span>
              ) : (
                <span className="text-slate-500">waiting for the window monitor…</span>
              )}
            </p>
          </div>
        )}
      </div>

      {/* Inverted reaction: dim when the metric rises above the threshold */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-white block">Invert Reaction</span>
          <span className="text-[11px] text-slate-400">
            Darken the screen when the score rises above the threshold instead of falling below it.
          </span>
        </div>
        <button
          role="switch"
          aria-checked={settings.invertReaction}
          aria-label="Invert Reaction"
          onClick={() => updateSettings({ invertReaction: !settings.invertReaction })}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border ${
            settings.invertReaction ? 'bg-[#FF6600] border-[#FF6600]' : 'bg-slate-800 border-white/20'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform transform ${
              settings.invertReaction ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Audio Biofeedback Toggle */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-xl ${settings.audioFeedbackEnabled ? 'bg-orange-500/20 text-[#FF6600]' : 'bg-white/5 text-slate-400'}`}>
            {settings.audioFeedbackEnabled ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </div>
          <div>
            <span className="text-xs font-semibold text-white block">
              Audio-БОС (Nature / Pink Noise Modulation)
            </span>
            <span className="text-[11px] text-slate-400">
              Gentle ambient sound intensity scales smoothly when focus drops.
            </span>
          </div>
        </div>

        <button
          onClick={() => updateSettings({ audioFeedbackEnabled: !settings.audioFeedbackEnabled })}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border ${
            settings.audioFeedbackEnabled ? 'bg-[#FF6600] border-[#FF6600]' : 'bg-slate-800 border-white/20'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform transform ${
              settings.audioFeedbackEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {settings.audioFeedbackEnabled && (
        <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
          <GlassSlider
            label="Audio Feedback Volume"
            value={Math.round(settings.audioVolume * 100)}
            min={0}
            max={100}
            step={5}
            unit="%"
            accentColor="orange"
            description="Master volume of the biofeedback sound at full focus deficit."
            onChange={(val) => updateSettings({ audioVolume: val / 100 })}
          />
        </div>
      )}
    </div>
  );
};
