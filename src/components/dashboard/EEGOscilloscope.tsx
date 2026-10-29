import React, { useEffect, useRef, useState } from 'react';
import { Activity } from 'lucide-react';
import { simulationEngine } from '../../services/simulationEngine';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';

const CHANNELS = [
  { key: 't3', label: 'T3 (Left Temporal)', color: '#00D2FF' },
  { key: 't4', label: 'T4 (Right Temporal)', color: '#FF6600' },
  { key: 'o1', label: 'O1 (Left Occipital)', color: '#A78BFA' },
  { key: 'o2', label: 'O2 (Right Occipital)', color: '#34D399' },
] as const;

export const EEGOscilloscope: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [timeScale, setTimeScale] = useState<number>(2); // seconds visible
  const gain = 1.5; // vertical gain multiplier

  useEffect(() => {
    let animationFrameId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;
      if (width === 0 || height === 0) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      // Dark translucent background with phosphor persistence trail
      ctx.fillStyle = 'rgba(10, 14, 26, 0.45)';
      ctx.fillRect(0, 0, width, height);

      // Draw subtle grid
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
      ctx.lineWidth = 1;

      const gridSpacingX = width / 10;
      const gridSpacingY = height / 8;

      ctx.beginPath();
      for (let x = 0; x < width; x += gridSpacingX) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y < height; y += gridSpacingY) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Retrieve live 250Hz samples from engine
      const buffer = simulationEngine.getRawBuffer();
      const samplesNeeded = Math.min(buffer.length, Math.round(timeScale * 250));
      const slice = buffer.slice(-samplesNeeded);

      if (slice.length > 1) {
        const channelHeight = height / 4;

        CHANNELS.forEach((ch, index) => {
          const centerY = channelHeight * index + channelHeight / 2;

          // Channel baseline zero-line
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
          ctx.setLineDash([2, 4]);
          ctx.beginPath();
          ctx.moveTo(0, centerY);
          ctx.lineTo(width, centerY);
          ctx.stroke();
          ctx.setLineDash([]);

          // Waveform line
          ctx.strokeStyle = ch.color;
          ctx.lineWidth = 1.8;
          ctx.shadowColor = ch.color;
          ctx.shadowBlur = 6;
          ctx.beginPath();

          const dx = width / (slice.length - 1);

          for (let i = 0; i < slice.length; i++) {
            const rawVal = slice[i].rawChannels[ch.key];
            const y = centerY - rawVal * gain * 0.4;
            const x = i * dx;

            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
          }
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Draw active pulse dot at the leading tip
          const lastPoint = slice[slice.length - 1];
          const lastY = centerY - lastPoint.rawChannels[ch.key] * gain * 0.4;
          ctx.fillStyle = ch.color;
          ctx.beginPath();
          ctx.arc(width - 2, lastY, 3, 0, Math.PI * 2);
          ctx.fill();

          // Label and live microvolt readout
          ctx.fillStyle = 'rgba(241, 245, 249, 0.7)';
          ctx.font = '10px "JetBrains Mono", monospace';
          ctx.fillText(ch.label, 8, centerY - channelHeight / 2 + 14);

          const liveUv = lastPoint.rawChannels[ch.key];
          ctx.fillStyle = ch.color;
          ctx.font = '11px "JetBrains Mono", monospace';
          ctx.fillText(`${liveUv > 0 ? '+' : ''}${liveUv.toFixed(1)} µV`, width - 75, centerY - channelHeight / 2 + 14);
        });
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [timeScale, gain]);

  // Keep canvas resolution synced to container
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (canvas) {
        canvas.width = canvas.parentElement?.clientWidth || 700;
        canvas.height = 300;
      }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <GlassPanel variant="card" className="p-4 overflow-hidden">
      {/* Oscilloscope Header */}
      <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/20 text-[#00D2FF]">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">4-Channel Real-Time Oscilloscope</h3>
            <p className="text-[11px] text-slate-400">250 Hz Sampling Rate · 24-bit ADC · Low-Noise Filter</p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <GlassBadge variant="green" pulse={true}>
            Live 250 Hz
          </GlassBadge>

          {/* Time Window Selector */}
          <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5 border border-white/10 text-[11px]">
            <button
              onClick={() => setTimeScale(1)}
              className={`px-2 py-0.5 rounded cursor-pointer ${timeScale === 1 ? 'bg-white/20 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
            >
              1s
            </button>
            <button
              onClick={() => setTimeScale(2)}
              className={`px-2 py-0.5 rounded cursor-pointer ${timeScale === 2 ? 'bg-white/20 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
            >
              2s
            </button>
            <button
              onClick={() => setTimeScale(4)}
              className={`px-2 py-0.5 rounded cursor-pointer ${timeScale === 4 ? 'bg-white/20 text-white font-medium' : 'text-slate-400 hover:text-white'}`}
            >
              4s
            </button>
          </div>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div className="relative w-full h-[300px] bg-slate-950/70 rounded-xl overflow-hidden border border-white/10">
        <canvas ref={canvasRef} className="w-full h-full block" />
      </div>

      {/* Channel Color Legend */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 pt-2 text-[11px] text-slate-400 border-t border-white/10">
        {CHANNELS.map((ch) => (
          <div key={ch.key} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ch.color }} />
            <span className="truncate">{ch.label}</span>
          </div>
        ))}
      </div>
    </GlassPanel>
  );
};
