import React from 'react';
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';
import electrodeDiagramImg from '../../assets/electrode-diagram.webp';
import headbandHeroImg from '../../assets/headband-hero.webp';

export const ElectrodeCard: React.FC = () => {
  const { telemetry, settings, feedbackState, setElectrodeContact } = useFocusStore();

  const isRu = (settings.language ?? 'ru') === 'ru';
  const quality = telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true };
  const impedance = telemetry?.impedanceKOhm ?? { t3: 134, t4: 128, o1: 115, o2: 121 };
  const allGood = quality.t3 && quality.t4 && quality.o1 && quality.o2;
  const isSimulated = settings.deviceSource !== 'bluetooth';

  const electrodes = [
    {
      id: 't3' as const,
      name: isRu ? 'T3 — Левый височный' : 'T3 — Left Temporal',
      location: isRu ? 'Височная область (слух / ЭОГ-контроль)' : 'Left temporal lobe (auditory / EOG)',
      ok: quality.t3,
      kOhm: quality.t3 ? `${impedance.t3} ${isRu ? 'кОм' : 'kΩ'}` : isRu ? '> 2000 кОм' : '> 2000 kΩ',
    },
    {
      id: 't4' as const,
      name: isRu ? 'T4 — Правый височный' : 'T4 — Right Temporal',
      location: isRu ? 'Височная область (эмоц. тонус)' : 'Right temporal lobe (emotion)',
      ok: quality.t4,
      kOhm: quality.t4 ? `${impedance.t4} ${isRu ? 'кОм' : 'kΩ'}` : isRu ? '> 2000 кОм' : '> 2000 kΩ',
    },
    {
      id: 'o1' as const,
      name: isRu ? 'O1 — Левый затылочный' : 'O1 — Left Occipital',
      location: isRu ? 'Затылочная кора (зрение / α-ритм)' : 'Left occipital lobe (visual / α)',
      ok: quality.o1,
      kOhm: quality.o1 ? `${impedance.o1} ${isRu ? 'кОм' : 'kΩ'}` : isRu ? '> 2000 кОм' : '> 2000 kΩ',
    },
    {
      id: 'o2' as const,
      name: isRu ? 'O2 — Правый затылочный' : 'O2 — Right Occipital',
      location: isRu ? 'Затылочная кора (зрение / α-ритм)' : 'Right occipital lobe (visual / α)',
      ok: quality.o2,
      kOhm: quality.o2 ? `${impedance.o2} ${isRu ? 'кОм' : 'kΩ'}` : isRu ? '> 2000 кОм' : '> 2000 kΩ',
    },
  ];

  return (
    <GlassPanel variant="card" className="p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${allGood ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
              {allGood ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {isRu ? 'Контакт 4 сухих электродов' : '4-Channel Dry Electrodes'}
              </h3>
              <p className="text-[11px] text-slate-400">
                {isRu
                  ? `Система 10–20 ${isSimulated ? '· (имитация импеданса)' : '· BrainBit ResistData'}`
                  : `International 10–20 ${isSimulated ? '· (simulated resistance)' : '· ResistData'}`}
              </p>
            </div>
          </div>
          <GlassBadge variant={allGood ? 'green' : 'red'}>
            {allGood
              ? isRu ? 'Контакт в норме' : 'Contact OK'
              : feedbackState.isContactPaused
              ? isRu ? 'БОС на паузе' : 'BOS Paused'
              : isRu ? 'Обрыв контакта' : 'Contact Warning'}
          </GlassBadge>
        </div>

        {/* Diagram & Photo View */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div className="relative rounded-xl overflow-hidden bg-slate-900/60 border border-white/10 p-2 flex flex-col items-center justify-center">
            <img
              src={electrodeDiagramImg}
              alt="Electrode 10-20 Layout"
              className="h-20 object-contain filter drop-shadow-md"
            />
            <span className="text-[10px] text-slate-400 mt-1 font-mono">
              {isRu ? 'Схема 10–20' : '10–20 Map'}
            </span>
          </div>

          <div className="relative rounded-xl overflow-hidden bg-slate-900/60 border border-white/10 p-2 flex flex-col items-center justify-center">
            <img
              src={headbandHeroImg}
              alt="BrainBit Headband"
              className="h-20 object-contain filter drop-shadow-md"
            />
            <span className="text-[10px] text-slate-400 mt-1 font-mono">BrainBit Band</span>
          </div>
        </div>

        {/* Interactive Sensors List */}
        <div className="space-y-1.5">
          {electrodes.map((el) => (
            <div
              key={el.id}
              onClick={() => isSimulated && setElectrodeContact(el.id, !el.ok)}
              className={`flex items-center justify-between p-2 rounded-xl border transition-colors ${
                isSimulated ? 'cursor-pointer' : ''
              } ${
                el.ok
                  ? 'bg-white/5 border-white/10 hover:border-white/25'
                  : 'bg-rose-500/10 border-rose-500/35'
              }`}
              title={
                isSimulated
                  ? isRu
                    ? 'Нажмите, чтобы проверить реакцию на потерю контакта сухого электрода'
                    : 'Click to simulate dry electrode detachment'
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                {el.ok ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <XCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <div>
                  <div className="text-xs font-semibold text-white">{el.name}</div>
                  <div className="text-[10px] text-slate-400">{el.location}</div>
                </div>
              </div>

              <div className="text-right">
                <span className={`text-xs font-mono font-medium ${el.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {el.kOhm}
                </span>
                <span className="block text-[9px] text-slate-500">
                  {isRu ? 'Сопротивление' : 'Resistance'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {isSimulated && (
        <p className="text-[10px] text-slate-400 mt-2.5 pt-2 border-t border-white/10 text-center">
          {isRu
            ? 'Клик по электроду имитирует отход контакта (>2000 кОм) и безопасную паузу БОС.'
            : 'Click any electrode row to simulate contact loss (>2000 kΩ) and safe BOS pause.'}
        </p>
      )}
    </GlassPanel>
  );
};
