import React from 'react';
import { TrendingUp, Download, Save, Trash2, BarChart3 } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassPanel } from '../glass/GlassPanel';
import { GlassButton } from '../glass/GlassButton';
import { GlassBadge } from '../glass/GlassBadge';

export const ResponseTimelineCard: React.FC = () => {
  const {
    timeline,
    telemetry,
    settings,
    savedSessions,
    saveAndResetSession,
    exportCurrentTimelineCSV,
    exportJournalCSV,
    clearSavedSessions,
  } = useFocusStore();

  const lang = settings.language ?? 'ru';
  const isRu = lang === 'ru';
  const isConcentration = settings.mode === 'concentration';

  const recent = timeline.slice(-60); // Last 60 seconds window
  const width = 640;
  const height = 145;
  const padX = 28;
  const padY = 14;
  const plotW = width - padX * 2;
  const plotH = height - padY * 2;

  const toY = (pct: number) => padY + plotH - (Math.max(0, Math.min(100, pct)) / 100) * plotH;
  const toX = (idx: number, count: number) =>
    count <= 1 ? padX : padX + (idx / (count - 1)) * plotW;

  const metricPath =
    recent.length > 1
      ? recent
          .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toX(i, recent.length).toFixed(1)} ${toY(pt.smoothedMetric).toFixed(1)}`)
          .join(' ')
      : '';

  const opacityPath =
    recent.length > 1
      ? recent
          .map((pt, i) => `${i === 0 ? 'M' : 'L'} ${toX(i, recent.length).toFixed(1)} ${toY(pt.overlayOpacityPct).toFixed(1)}`)
          .join(' ')
      : '';

  const thresholdY = toY(settings.threshold);

  const spectrum = telemetry?.spectrum ?? { delta: 10, theta: 16, alpha: 34, beta: 34, gamma: 6 };
  const bands = [
    { key: 'delta', label: 'δ (1–3 Гц)', labelEn: 'δ (1–3 Hz)', val: spectrum.delta, color: '#64748B' },
    { key: 'theta', label: 'θ (4–7 Гц)', labelEn: 'θ (4–7 Hz)', val: spectrum.theta, color: '#F59E0B' },
    { key: 'alpha', label: 'α (8–13 Гц)', labelEn: 'α (8–13 Hz)', val: spectrum.alpha, color: '#A78BFA' },
    { key: 'beta', label: 'β (14–30 Гц)', labelEn: 'β (14–30 Hz)', val: spectrum.beta, color: '#00D2FF' },
    { key: 'gamma', label: 'γ (31–45 Гц)', labelEn: 'γ (31–45 Hz)', val: spectrum.gamma, color: '#34D399' },
  ];

  return (
    <GlassPanel variant="card" className="p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-orange-500/20 text-[#FF6600]">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">
              {isRu
                ? 'Механика БОС: отклик прозрачности экрана и спектр ритмов'
                : 'Biofeedback Response: Metric vs Screen Dimming & Spectrum'}
            </h3>
            <p className="text-[11px] text-slate-400">
              {isRu
                ? 'Окно 60 с · ДПФ биполярных отведений (T3−O1, T4−O2) · экспорт в CSV для Python/MNE'
                : '60s rolling window · Bipolar DFT (T3−O1, T4−O2) · CSV export for Python/MNE'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <GlassButton
            size="sm"
            variant="secondary"
            onClick={() => saveAndResetSession()}
            icon={<Save className="w-3.5 h-3.5" />}
            title={isRu ? 'Завершить текущую сессию и записать в локальный журнал' : 'Save session to local journal'}
          >
            {isRu ? 'Сохранить сессию' : 'Save Session'}
          </GlassButton>
          <GlassButton
            size="sm"
            variant="secondary"
            onClick={() => exportCurrentTimelineCSV()}
            disabled={timeline.length === 0}
            icon={<Download className="w-3.5 h-3.5" />}
            title={isRu ? 'Скачать посекундный CSV текущей сессии' : 'Download 1Hz CSV of current session'}
          >
            {isRu ? 'CSV таймлайна' : 'Timeline CSV'}
          </GlassButton>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Dual Curve SVG Chart (8 cols) */}
        <div className="lg:col-span-8 bg-slate-950/70 rounded-xl border border-white/10 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] mb-1.5">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-cyan-300">
                <span className="w-3 h-0.5 bg-[#00D2FF] inline-block" />
                {isConcentration
                  ? isRu ? 'Сглаж. концентрация (%)' : 'Smoothed Focus (%)'
                  : isRu ? 'Сглаж. релаксация (%)' : 'Smoothed Calm (%)'}
              </span>
              <span className="flex items-center gap-1.5 text-orange-300">
                <span className="w-3 h-0.5 bg-[#FF6600] inline-block" />
                {isRu ? 'Затемнение экрана (%)' : 'Screen Dimming (%)'}
              </span>
              <span className="flex items-center gap-1.5 text-slate-300">
                <span className="w-3 border-t border-dashed border-white/70 inline-block" />
                {isRu ? `Порог (${settings.threshold}%)` : `Threshold (${settings.threshold}%)`}
              </span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">
              {recent.length > 0 ? `${recent.length}s` : isRu ? 'Накопление 1 Гц...' : 'Buffering 1 Hz...'}
            </span>
          </div>

          <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-[145px] overflow-visible">
            {/* Horizontal grid lines */}
            {[0, 25, 50, 75, 100].map((lvl) => (
              <g key={lvl}>
                <line
                  x1={padX}
                  y1={toY(lvl)}
                  x2={width - padX}
                  y2={toY(lvl)}
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth="1"
                />
                <text
                  x={4}
                  y={toY(lvl) + 3}
                  fill="rgba(148,163,184,0.75)"
                  fontSize="9"
                  fontFamily="monospace"
                >
                  {lvl}%
                </text>
              </g>
            ))}

            {/* Threshold line */}
            <line
              x1={padX}
              y1={thresholdY}
              x2={width - padX}
              y2={thresholdY}
              stroke="rgba(255,255,255,0.55)"
              strokeDasharray="4 4"
              strokeWidth="1.2"
            />

            {/* Dimming curve */}
            {opacityPath && (
              <path
                d={opacityPath}
                fill="none"
                stroke="#FF6600"
                strokeWidth="2"
                strokeDasharray="3 2"
              />
            )}

            {/* Smoothed metric curve */}
            {metricPath && (
              <path
                d={metricPath}
                fill="none"
                stroke={isConcentration ? '#00D2FF' : '#A78BFA'}
                strokeWidth="2.4"
              />
            )}

            {recent.length < 2 && (
              <text
                x={width / 2}
                y={height / 2}
                textAnchor="middle"
                fill="rgba(148,163,184,0.7)"
                fontSize="11"
              >
                {isRu
                  ? 'График строится в реальном времени (1 точка/сек)...'
                  : 'Building real-time response curve (1 sample/sec)...'}
              </text>
            )}
          </svg>
        </div>

        {/* Right: Relative Bipolar Spectrum (4 cols) */}
        <div className="lg:col-span-4 bg-slate-950/70 rounded-xl border border-white/10 p-3 flex flex-col justify-between">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-white flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5 text-cyan-400" />
              {isRu ? 'Спектр ЭЭГ (доли мощности)' : 'EEG Band Power (%)'}
            </span>
            <GlassBadge variant="neutral">T3−O1 · T4−O2</GlassBadge>
          </div>

          <div className="space-y-2">
            {bands.map((b) => (
              <div key={b.key} className="space-y-0.5">
                <div className="flex justify-between text-[10px]">
                  <span className="text-slate-300 font-mono">{isRu ? b.label : b.labelEn}</span>
                  <span className="font-mono text-white font-semibold">{b.val.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${Math.max(2, Math.min(100, b.val))}%`,
                      backgroundColor: b.color,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Saved Sessions Local Journal */}
      {savedSessions.length > 0 && (
        <div className="pt-2 border-t border-white/10 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-300">
              {isRu
                ? `Локальный журнал сессий (${savedSessions.length})`
                : `Saved Session Journal (${savedSessions.length})`}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => exportJournalCSV()}
                className="text-[11px] text-[#00D2FF] hover:underline flex items-center gap-1 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                {isRu ? 'Экспорт журнала CSV' : 'Export Journal CSV'}
              </button>
              <button
                onClick={() => clearSavedSessions()}
                className="text-[11px] text-slate-400 hover:text-rose-400 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                {isRu ? 'Очистить' : 'Clear'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 max-h-28 overflow-y-auto pr-1">
            {savedSessions.slice(0, 6).map((s) => {
              const flowPct =
                s.stats.durationSeconds > 0
                  ? Math.round((s.stats.timeInFocusSeconds / s.stats.durationSeconds) * 100)
                  : 0;
              return (
                <div
                  key={s.id}
                  className="p-2 rounded-lg bg-white/5 border border-white/10 flex items-center justify-between text-[11px]"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="px-1.5 py-0.2 rounded bg-orange-500/20 text-[#FF6600] font-mono text-[9px]">
                        {s.isSimulated ? (s.deviceSource === 'csv_replay' ? 'CSV' : 'СИМ') : 'BLE'}
                      </span>
                      <span className="text-white font-medium">
                        {s.mode === 'concentration'
                          ? isRu ? 'Концентрация' : 'Focus'
                          : isRu ? 'Релаксация' : 'Calm'}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {Math.round(s.stats.durationSeconds)}s · {isRu ? 'ср.' : 'avg'} {Math.round(s.stats.averageFocusScore)}%
                    </span>
                  </div>
                  <div className="text-right font-mono">
                    <span className="text-emerald-400 font-bold">{flowPct}%</span>
                    <span className="block text-[9px] text-slate-400">
                      {isRu ? 'в потоке' : 'in flow'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </GlassPanel>
  );
};
