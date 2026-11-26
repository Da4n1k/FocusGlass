import React from 'react';
import type { ElectrodeSignalQuality } from '../../services/eegTypes';

interface CompactElectrodePillProps {
  /** Качество контакта по каналам; при неактивном потоке все каналы считаются отключёнными. */
  quality: ElectrodeSignalQuality;
  streamActive: boolean;
}

const CHANNELS = ['t3', 't4', 'o1', 'o2'] as const;

/** Микро-индикатор контакта 4 электродов для HUD. */
export const CompactElectrodePill: React.FC<CompactElectrodePillProps> = ({
  quality,
  streamActive,
}) => (
  <div className="flex items-center gap-1.5" title="Electrode Contact (T3, T4, O1, O2)">
    <span className="text-[10px] text-slate-400">Sensors:</span>
    {CHANNELS.map((ch) => {
      const ok = streamActive && quality[ch];
      return (
        <span
          key={ch}
          className={`w-2 h-2 rounded-full border ${
            ok
              ? 'bg-emerald-400 border-emerald-300 shadow-[0_0_6px_rgba(52,211,153,0.8)]'
              : 'bg-rose-500 border-rose-400'
          }`}
          title={`${ch.toUpperCase()}: ${ok ? 'Contact OK' : 'No contact'}`}
        />
      );
    })}
  </div>
);
