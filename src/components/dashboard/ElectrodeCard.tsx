import React from 'react';
import { ShieldCheck, ShieldAlert, CheckCircle2, XCircle, Activity, Bluetooth } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import {
  classifyElectrodeImpedance,
  diagnoseHeadbandFit,
  FIT_HOLD_REQUIRED_MS,
  type ElectrodeFitTier,
} from '../../services/headbandFitCheck';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassBadge } from '../glass/GlassBadge';
import { GlassButton } from '../glass/GlassButton';
import electrodeDiagramImg from '../../assets/electrode-diagram.webp';
import headbandHeroImg from '../../assets/headband-hero.webp';

function tierColorClass(tier: ElectrodeFitTier): string {
  switch (tier) {
    case 'good':
      return 'text-emerald-400';
    case 'acceptable':
      return 'text-amber-300';
    case 'poor':
    case 'open':
      return 'text-rose-400';
    case 'unmeasured':
    default:
      return 'text-slate-400';
  }
}

export const ElectrodeCard: React.FC = () => {
  const {
    telemetry,
    settings,
    deviceStatus,
    fitHoldMs,
    setElectrodeContact,
    startFitCheck,
    startEegStreamFromFitCheck,
    setIsSettingsOpen,
  } = useFocusStore();

  const isSimulator = settings.deviceSource === 'simulator';
  const isStreamActive = isSimulator || deviceStatus.connected;
  const streamMode = deviceStatus.streamMode ?? 'idle';
  const isFitCheckMode = !isSimulator && deviceStatus.connected && streamMode === 'resist';

  const quality = isStreamActive
    ? telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true }
    : { t3: false, t4: false, o1: false, o2: false };

  const resistance = telemetry?.resistanceKOhm;
  const allGood = isStreamActive && quality.t3 && quality.t4 && quality.o1 && quality.o2;

  const effectiveHoldMs = isSimulator ? (allGood ? FIT_HOLD_REQUIRED_MS : 0) : fitHoldMs;
  const diagnostic = diagnoseHeadbandFit(
    isStreamActive ? resistance : undefined,
    quality,
    effectiveHoldMs
  );

  const formatResistance = (ch: 't3' | 't4' | 'o1' | 'o2'): string => {
    if (!isStreamActive) return '— kΩ';
    const val = resistance?.[ch];
    if (val === undefined) {
      return isSimulator ? '— kΩ' : quality[ch] ? 'OK (ЭЭГ)' : 'Обрыв';
    }
    if (val === null || !Number.isFinite(val)) {
      return 'Обрыв (∞)';
    }
    return `${Math.round(val)} kΩ`;
  };

  const electrodes = [
    {
      id: 't3' as const,
      name: 'T3 — Левый висок',
      location: 'Височная дужка слева (сухой электрод)',
      ok: quality.t3,
      tier: classifyElectrodeImpedance(resistance?.t3, quality.t3),
      impedance: formatResistance('t3'),
    },
    {
      id: 't4' as const,
      name: 'T4 — Правый висок',
      location: 'Височная дужка справа (сухой электрод)',
      ok: quality.t4,
      tier: classifyElectrodeImpedance(resistance?.t4, quality.t4),
      impedance: formatResistance('t4'),
    },
    {
      id: 'o1' as const,
      name: 'O1 — Левый затылок',
      location: 'Затылочная область (пружинный электрод)',
      ok: quality.o1,
      tier: classifyElectrodeImpedance(resistance?.o1, quality.o1),
      impedance: formatResistance('o1'),
    },
    {
      id: 'o2' as const,
      name: 'O2 — Правый затылок',
      location: 'Затылочная область (пружинный электрод)',
      ok: quality.o2,
      tier: classifyElectrodeImpedance(resistance?.o2, quality.o2),
      impedance: formatResistance('o2'),
    },
  ];

  const diagnosticBannerStyle =
    diagnostic.status === 'verified'
      ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
      : diagnostic.status === 'stabilizing'
      ? 'bg-cyan-500/10 border-cyan-500/35 text-cyan-200'
      : diagnostic.status === 'unmeasured'
      ? 'bg-white/5 border-white/10 text-slate-300'
      : 'bg-amber-500/10 border-amber-500/35 text-amber-200';

  return (
    <GlassPanel variant="card" className="p-4 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between mb-3 pb-2 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div
              className={`p-1.5 rounded-lg ${
                diagnostic.status === 'verified' || (!isFitCheckMode && allGood)
                  ? 'bg-emerald-500/20 text-emerald-400'
                  : 'bg-rose-500/20 text-rose-400'
              }`}
            >
              {diagnostic.status === 'verified' || (!isFitCheckMode && allGood) ? (
                <ShieldCheck className="w-4 h-4" />
              ) : (
                <ShieldAlert className="w-4 h-4" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">Посадка ободка и контакт</h3>
              <p className="text-[11px] text-slate-400">
                BrainBit 10-20 · Норма ≤ 800 кОм (отлично ≤ 500 кОм)
              </p>
            </div>
          </div>
          <GlassBadge
            variant={
              !isStreamActive
                ? 'neutral'
                : isFitCheckMode
                ? diagnostic.status === 'verified'
                  ? 'green'
                  : 'orange'
                : allGood
                ? 'green'
                : 'red'
            }
          >
            {!isStreamActive
              ? 'Нет связи'
              : isFitCheckMode
              ? diagnostic.status === 'verified'
                ? 'Посадка ОК ✓'
                : 'Проверка kΩ...'
              : allGood
              ? 'Контакт ОК'
              : 'Потеря контакта'}
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
            <span className="text-[10px] text-slate-400 mt-1 font-mono">10-20 + лобный референт</span>
          </div>

          <div className="relative rounded-xl overflow-hidden bg-slate-900/60 border border-white/10 p-2 flex flex-col items-center justify-center">
            <img
              src={headbandHeroImg}
              alt="BrainBit Headband"
              className="h-20 object-contain filter drop-shadow-md"
            />
            <span className="text-[10px] text-slate-400 mt-1 font-mono">BrainBit Wireless</span>
          </div>
        </div>

        {/* Interactive Sensors List */}
        <div className="space-y-1.5">
          {electrodes.map((el) => {
            const isHealthy = isStreamActive && (el.tier === 'good' || el.tier === 'acceptable' || (el.tier === 'unmeasured' && el.ok));
            return (
              <div
                key={el.id}
                className={`flex items-center justify-between p-2 rounded-xl border transition-colors ${
                  isHealthy
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
                        ? 'Нажмите для симуляции потери контакта'
                        : 'Измеряется физическим ободком BrainBit'
                    }
                    className={isSimulator ? 'cursor-pointer' : 'cursor-default opacity-80'}
                  >
                    {isHealthy ? (
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
                      !isStreamActive ? 'text-slate-500' : tierColorClass(el.tier)
                    }`}
                  >
                    {el.impedance}
                  </span>
                  <span className="block text-[9px] text-slate-500">Импеданс</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Fit Check Diagnostic Banner & Stability Progress */}
        {isStreamActive && (
          <div className={`mt-3 p-2.5 rounded-xl border text-[11px] space-y-2 ${diagnosticBannerStyle}`}>
            <div className="flex items-center justify-between font-semibold">
              <span>{diagnostic.headline}</span>
              <span className="font-mono">{diagnostic.usableCount}/4 ОК</span>
            </div>
            <p className="text-[10px] leading-relaxed opacity-90">{diagnostic.guidance}</p>

            {isFitCheckMode && (
              <div className="space-y-1">
                <div className="h-1.5 w-full bg-black/30 rounded-full overflow-hidden border border-white/10">
                  <div
                    className={`h-full transition-all duration-150 ${
                      diagnostic.status === 'verified' ? 'bg-emerald-400' : 'bg-cyan-400'
                    }`}
                    style={{ width: `${Math.round(diagnostic.progress * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Footer */}
      <div className="mt-3 pt-2.5 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
        {isSimulator ? (
          <p className="text-[10px] text-slate-400 w-full text-center">
            Симулятор: нажмите на иконку любого канала выше, чтобы проверить логику посадки и паузы БОС.
          </p>
        ) : !deviceStatus.connected ? (
          <>
            <span className="text-[10px] text-slate-400">
              Подключите ободок BrainBit для живой проверки сопротивления.
            </span>
            <GlassButton
              size="sm"
              variant="secondary"
              onClick={() => setIsSettingsOpen(true)}
              icon={<Bluetooth className="w-3.5 h-3.5" />}
            >
              Подключить BrainBit
            </GlassButton>
          </>
        ) : isFitCheckMode ? (
          <>
            <span className="text-[10px] text-slate-400">
              {diagnostic.status === 'verified'
                ? 'Все 4 канала проверены — можно запускать ЭЭГ.'
                : 'Держите голову спокойно до заполнения шкалы (3 с).'}
            </span>
            <GlassButton
              size="sm"
              variant={diagnostic.status === 'verified' ? 'primary' : 'secondary'}
              onClick={() => void startEegStreamFromFitCheck()}
              icon={<Activity className="w-3.5 h-3.5" />}
            >
              {diagnostic.status === 'verified' ? 'Надето ОК — Запустить ЭЭГ 250 Гц' : 'Перейти к ЭЭГ 250 Гц'}
            </GlassButton>
          </>
        ) : (
          <>
            <span className="text-[10px] text-slate-400">
              {resistance ? 'Использован последний замер посадки.' : 'Импеданс ещё не проверялся.'}
            </span>
            <GlassButton
              size="sm"
              variant="secondary"
              onClick={() => void startFitCheck()}
              icon={<ShieldCheck className="w-3.5 h-3.5" />}
            >
              Проверить посадку (Импеданс)
            </GlassButton>
          </>
        )}
      </div>
    </GlassPanel>
  );
};
