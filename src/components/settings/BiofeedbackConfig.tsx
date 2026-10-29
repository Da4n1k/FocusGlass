import React from 'react';
import { Target, Wind, Volume2, VolumeX } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassSlider } from '../glass/GlassSlider';

export const BiofeedbackConfig: React.FC = () => {
  const { settings, updateSettings } = useFocusStore();

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
          label="Target Biofeedback Threshold"
          value={settings.threshold}
          min={20}
          max={90}
          step={5}
          unit="%"
          accentColor={settings.mode === 'concentration' ? 'orange' : 'violet'}
          description="The cutoff point. Any score below this triggers proportional screen darkening."
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
          label="Vignette Optical Blur Radius"
          value={settings.blurRadius}
          min={0}
          max={32}
          step={2}
          unit="px"
          accentColor="cyan"
          description="Gaussian backdrop-blur radius applied around the screen periphery during mind-wandering."
          onChange={(val) => updateSettings({ blurRadius: val })}
        />
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
    </div>
  );
};
