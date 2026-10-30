import React from 'react';
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';
import electrodeDiagramImg from '../../assets/electrode-diagram.webp';
import headbandHeroImg from '../../assets/headband-hero.webp';

export const ElectrodeCard: React.FC = () => {
  const { telemetry, settings, deviceStatus, setElectrodeContact } = useFocusStore();

  const isSimulator = settings.deviceSource === 'simulator';
  const isStreamActive = isSimulator || deviceStatus.connected;

  const quality = isStreamActive
    ? telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true }
    : { t3: false, t4: false, o1: false, o2: false };

  const resistance = telemetry?.resistanceKOhm;
  const allGood = isStreamActive && quality.t3 && quality.t4 && quality.o1 && quality.o2;

  const formatResistance = (ch: 't3' | 't4' | 'o1' | 'o2', ok: boolean): string => {
    if (!isStreamActive) return '— kΩ';
    if (!ok) return '> 2500 kΩ';
    const val = resistance?.[ch];
    if (val === undefined || val === null) {
      const defaults = { t3: 134, t4: 128, o1: 115, o2: 121 };
      return `${defaults[ch]} kΩ`;
    }
    return `${Math.round(val)} kΩ`;
  };

  const electrodes = [
    {
      id: 't3' as const,
      name: 'T3 — Left Temporal',
      location: 'Left temporal (dry spring electrode)',
      ok: quality.t3,
      impedance: formatResistance('t3', quality.t3),
    },
    {
      id: 't4' as const,
      name: 'T4 — Right Temporal',
      location: 'Right temporal (dry spring electrode)',
      ok: quality.t4,
      impedance: formatResistance('t4', quality.t4),
    },
    {
      id: 'o1' as const,
      name: 'O1 — Left Occipital',
      location: 'Left occipital (visual / alpha)',
      ok: quality.o1,
      impedance: formatResistance('o1', quality.o1),
    },
    {
      id: 'o2' as const,
      name: 'O2 — Right Occipital',
      location: 'Right occipital (visual / alpha)',
      ok: quality.o2,
      impedance: formatResistance('o2', quality.o2),
    },
  ];

  return (
    <GlassPanel variant="card" className="p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-lg ${
                allGood ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              {allGood ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">4-Channel Dry Electrode Contact</h3>
              <p className="text-[11px] text-slate-400">
                BrainBit 10-20 Montage · Norm &lt; 1000 kΩ
              </p>
            </div>
          </div>
          <GlassBadge variant={!isStreamActive ? 'neutral' : allGood ? 'green' : 'red'}>
            {!isStreamActive
              ? 'No Device'
              : allGood
              ? 'Contact OK'
              : 'Contact Lost (БОС Paused)'}
          </GlassBadge>
        </div>

        {/* Diagram & Photo View */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="relative rounded-xl overflow-hidden bg-slate-900/60 border border-white/10 p-2 flex flex-col items-center justify-center">
            <img
              src={electrodeDiagramImg}
              alt="Electrode 10-20 Layout"
              className="h-24 object-contain filter drop-shadow-md"
            />
            <span className="text-[10px] text-slate-400 mt-1 font-mono">10-20 International Map</span>
          </div>

          <div className="relative rounded-xl overflow-hidden bg-slate-900/60 border border-white/10 p-2 flex flex-col items-center justify-center">
            <img
              src={headbandHeroImg}
              alt="BrainBit Headband"
              className="h-24 object-contain filter drop-shadow-md"
            />
            <span className="text-[10px] text-slate-400 mt-1 font-mono">BrainBit Wireless Band</span>
          </div>
        </div>

        {/* Interactive Sensors List */}
        <div className="space-y-2">
          {electrodes.map((el) => (
            <div
              key={el.id}
              className={`flex items-center justify-between p-2 rounded-xl border transition-colors ${
                el.ok
                  ? 'bg-white/5 border-white/10 hover:border-white/20'
                  : 'bg-rose-500/10 border-rose-500/30'
              }`}
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (isSimulator) {
                      setElectrodeContact(el.id, !el.ok);
                    }
                  }}
                  disabled={!isSimulator}
                  title={
                    isSimulator
                      ? 'Click to simulate dry electrode contact loss'
                      : 'Controlled by physical BrainBit sensor'
                  }
                  className={isSimulator ? 'cursor-pointer' : 'cursor-default opacity-70'}
                >
                  {el.ok ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <XCircle className="w-4 h-4 text-rose-400" />
                  )}
                </button>
                <div>
                  <div className="text-xs font-semibold text-white">{el.name}</div>
                  <div className="text-[10px] text-slate-400">{el.location}</div>
                </div>
              </div>

              <div className="text-right">
                <span
                  className={`text-xs font-mono font-medium ${
                    !isStreamActive
                      ? 'text-slate-500'
                      : el.ok
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                  }`}
                >
                  {el.impedance}
                </span>
                <span className="block text-[9px] text-slate-500">Resistance</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-[10px] text-slate-400 mt-3 pt-2 border-t border-white/10 text-center">
        {isSimulator
          ? 'Simulator: click any channel icon above to test contact loss pause.'
          : 'Physical BLE mode: resistance values require active NeuroSDK2 ResistData stream.'}
      </p>
    </GlassPanel>
  );
};
