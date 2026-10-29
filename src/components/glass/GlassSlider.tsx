import React from 'react';

interface GlassSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  accentColor?: 'orange' | 'cyan' | 'violet';
  description?: string;
  onChange: (val: number) => void;
}

export const GlassSlider: React.FC<GlassSliderProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  accentColor = 'orange',
  description,
  onChange,
}) => {
  const percentage = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));

  const gradientColors = {
    orange: 'from-[#FF6600] to-[#FFA347]',
    cyan: 'from-[#00D2FF] to-[#38BDF8]',
    violet: 'from-[#8B5CF6] to-[#A78BFA]',
  };

  const textColors = {
    orange: 'text-[#FF6600]',
    cyan: 'text-[#00D2FF]',
    violet: 'text-[#8B5CF6]',
  };

  return (
    <div className="space-y-1.5 py-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-300">{label}</span>
        <span className={`font-mono font-semibold ${textColors[accentColor]}`}>
          {value}
          {unit}
        </span>
      </div>

      {description && <p className="text-[11px] text-slate-400">{description}</p>}

      <div className="relative flex items-center h-5">
        {/* Track */}
        <div className="absolute inset-x-0 h-2 bg-slate-800/80 rounded-full border border-white/10 overflow-hidden shadow-inner">
          {/* Filled Bar */}
          <div
            className={`h-full bg-gradient-to-r ${gradientColors[accentColor]} transition-[width] duration-75`}
            style={{ width: `${percentage}%` }}
          />
        </div>

        {/* Real Range Input */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-x-0 w-full h-5 opacity-0 cursor-pointer z-10"
        />

        {/* Visual Thumb */}
        <div
          className="absolute w-4 h-4 -ml-2 rounded-full bg-white border border-slate-300 shadow-[0_2px_8px_rgba(0,0,0,0.5)] pointer-events-none transition-[left] duration-75"
          style={{ left: `${percentage}%` }}
        />
      </div>
    </div>
  );
};
