import React from 'react';
import { useFocusStore } from '../../stores/useFocusStore';
import { SessionRecord, FocusTimelinePoint } from '../../services/eegTypes';
import {
  computeInFocusPct,
  getDistractionIntervalLabel,
  getFocusDeltaSummary,
} from '../../services/sessionSummaryMetrics';
import {
  buildFallbackTimelineForRecord,
  formatSummaryDateRangeRu,
} from '../../services/sessionHistoryMetrics';

export const SessionSummaryScreen: React.FC = () => {
  const {
    lastCompletedSession,
    sessionHistory,
    sessionStats,
    focusTimeline,
    exportSessionsCsv,
    startNewSession,
    setActiveNav,
    settings,
  } = useFocusStore();

  const record: SessionRecord = lastCompletedSession || {
    ...sessionStats,
    id: 'demo-summary',
    startedAt: '',
    endedAt: '',
    mode: settings.mode,
    deviceSource: settings.deviceSource,
    threshold: settings.threshold,
    durationSeconds: 52 * 60,
    timeInFocusSeconds: Math.round(52 * 60 * 0.78),
    distractionEventsCount: 5,
    averageFocusScore: 69,
  };

  const durationMins = Math.max(1, Math.round(record.durationSeconds / 60));
  const inFocusPct =
    record.durationSeconds > 0
      ? computeInFocusPct(record.timeInFocusSeconds, record.durationSeconds)
      : (lastCompletedSession ? 0 : 78);

  const focusDelta = React.useMemo(
    () =>
      getFocusDeltaSummary(
        inFocusPct,
        record.id,
        sessionHistory,
        Boolean(lastCompletedSession)
      ),
    [inFocusPct, record.id, sessionHistory, lastCompletedSession]
  );

  const focusDeltaColorClass =
    focusDelta.tone === 'positive'
      ? 'text-[#6EE7B7]'
      : focusDelta.tone === 'negative'
        ? 'text-[#F87171]'
        : 'text-[#6E7891]';

  const distractionIntervalLabel = React.useMemo(
    () => getDistractionIntervalLabel(record.distractionEventsCount, record.durationSeconds),
    [record.distractionEventsCount, record.durationSeconds]
  );

  const activeThreshold = record.threshold ?? settings.threshold;

  // Header Time Range string (СЕГОДНЯ / ВЧЕРА / ДД МЕСЯЦА · HH:MM–HH:MM)
  const timeRangeStr = React.useMemo(
    () => formatSummaryDateRangeRu(record.startedAt, record.endedAt),
    [record.startedAt, record.endedAt]
  );

  // Points for chart: saved snapshot -> deterministic history reconstruction -> active buffer/demo
  const points: FocusTimelinePoint[] = React.useMemo(() => {
    if (record.timeline !== undefined) {
      return record.timeline;
    }

    if (lastCompletedSession) {
      return buildFallbackTimelineForRecord(record, activeThreshold);
    }

    if (focusTimeline.length >= 2) {
      return focusTimeline;
    }

    return [
      { focus: 68, isDip: false, timestamp: 0, time: '13:40' },
      { focus: 72, isDip: false, timestamp: 0, time: '13:44' },
      { focus: 77, isDip: false, timestamp: 0, time: '13:48' },
      { focus: 70, isDip: false, timestamp: 0, time: '13:52' },
      { focus: 48, isDip: true, timestamp: 0, time: '13:56' },
      { focus: 42, isDip: true, timestamp: 0, time: '14:00' },
      { focus: 66, isDip: false, timestamp: 0, time: '14:04' },
      { focus: 79, isDip: false, timestamp: 0, time: '14:08' },
      { focus: 75, isDip: false, timestamp: 0, time: '14:12' },
      { focus: 47, isDip: true, timestamp: 0, time: '14:16' },
      { focus: 72, isDip: false, timestamp: 0, time: '14:20' },
      { focus: 78, isDip: false, timestamp: 0, time: '14:24' },
      { focus: 74, isDip: false, timestamp: 0, time: '14:28' },
      { focus: 77, isDip: false, timestamp: 0, time: '14:32' },
    ];
  }, [record, lastCompletedSession, focusTimeline, activeThreshold]);

  // 5 Timestamps under chart
  const timeLabels = React.useMemo(() => {
    if (record.startedAt && record.endedAt) {
      const tStart = new Date(record.startedAt).getTime();
      const tEnd = new Date(record.endedAt).getTime();
      const span = Math.max(1000, tEnd - tStart);
      return [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
        const t = new Date(tStart + span * ratio);
        const hh = String(t.getHours()).padStart(2, '0');
        const mm = String(t.getMinutes()).padStart(2, '0');
        return `${hh}:${mm}`;
      });
    }
    return ['13:40', '13:53', '14:06', '14:19', '14:32'];
  }, [record.startedAt, record.endedAt]);

  const chartWidth = 946;
  const chartHeight = 170;
  const paddingX = 0;
  const paddingY = 16;

  const stepX = (chartWidth - paddingX * 2) / Math.max(1, points.length - 1);
  const getCoord = (idx: number, val: number) => {
    const x = paddingX + idx * stepX;
    const y = chartHeight - paddingY - (val / 100) * (chartHeight - paddingY * 2);
    return { x, y };
  };

  const pathD =
    points.length >= 2
      ? points
          .map((p: FocusTimelinePoint, i: number) => {
            const { x, y } = getCoord(i, p.focus);
            return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
          })
          .join(' ')
      : '';

  const areaD =
    points.length >= 2
      ? `${pathD} L ${(paddingX + (points.length - 1) * stepX).toFixed(1)} ${chartHeight} L ${paddingX} ${chartHeight} Z`
      : '';
  const thresholdY =
    chartHeight - paddingY - (activeThreshold / 100) * (chartHeight - paddingY * 2);

  return (
    <div className="w-full h-full pt-7 px-8 pb-4 flex flex-col justify-between select-none animate-in fade-in duration-200">
      <div className="space-y-4">
        {/* 1. Header (w-full responsive, h: 83) */}
        <div className="w-full flex items-start justify-between">
          <div className="flex flex-col">
            <span className="text-[12px] font-semibold text-[#FF7A2F] tracking-[0.96px] leading-[15px]">
              {timeRangeStr}
            </span>
            <h1 className="text-[28px] font-bold tracking-[-0.42px] text-[#EEF1F8] leading-[36px] mt-[6px]">
              Сессия завершена
            </h1>
            <p className="text-[15px] font-normal text-[#A3ACC2] leading-[22px] mt-[4px]">
              Хорошая работа! Вот как менялось ваше внимание.
            </p>
          </div>

          {/* Экспорт CSV */}
          <button
            onClick={exportSessionsCsv}
            className="h-[36px] px-[14px] rounded-[10px] bg-transparent hover:bg-white/[0.04] border border-white/[0.12] text-[#C9D1E3] text-[14px] font-semibold flex items-center gap-2 transition-colors cursor-pointer mt-0 shrink-0"
          >
            <svg className="w-[17px] h-[17px] text-[#C9D1E3]" viewBox="0 0 17 17" fill="none">
              <path
                d="M 8.5 2.125 V 10.625 M 8.5 10.625 L 5.5 7.625 M 8.5 10.625 L 11.5 7.625"
                stroke="currentColor"
                strokeWidth="1.275"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M 3.54 14.875 H 13.46"
                stroke="currentColor"
                strokeWidth="1.275"
                strokeLinecap="round"
              />
            </svg>
            <span>Экспорт CSV</span>
          </button>
        </div>

        {/* 2. Top 4 Metric Cards (w-full responsive, h: 101px) */}
        <div className="w-full grid grid-cols-4 gap-4 mt-5">
          {/* Card 1: Длительность */}
          <div className="h-[101px] rounded-[18px] bg-[#131A2A] border border-white/[0.06] px-[18px] py-[16px] flex items-center gap-[14px] min-w-0">
            <svg className="w-5 h-5 text-[#A3ACC2] shrink-0" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M 10 5.83 V 10 L 12.5 11.67" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex flex-col items-start justify-center min-w-0 flex-1 overflow-hidden">
              <span className="text-[13px] text-[#A3ACC2] font-normal leading-[16px] truncate max-w-full">Длительность</span>
              <span className="text-[28px] font-bold text-[#EEF1F8] leading-[34px] font-sans tracking-tight whitespace-nowrap">{durationMins} мин</span>
            </div>
          </div>

          {/* Card 2: Время в фокусе */}
          <div className="h-[101px] rounded-[18px] bg-[#131A2A] border border-white/[0.06] px-[18px] py-[16px] flex items-center gap-[14px] min-w-0">
            <svg className="w-5 h-5 text-[#FF7A2F] shrink-0" viewBox="0 0 20 20" fill="none">
              <circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="4.17" stroke="currentColor" strokeWidth="1.5" />
              <circle cx="10" cy="10" r="1" fill="currentColor" />
            </svg>
            <div className="flex flex-col items-start justify-center min-w-0 flex-1 overflow-hidden">
              <span className="text-[13px] text-[#A3ACC2] font-normal leading-[16px] truncate max-w-full">Время в фокусе</span>
              <span className="text-[28px] font-bold text-[#EEF1F8] leading-[34px] font-sans tracking-tight whitespace-nowrap">{inFocusPct}%</span>
              <span className={`text-[12px] font-normal ${focusDeltaColorClass} leading-[15px] pt-[2px] truncate max-w-full`}>{focusDelta.text}</span>
            </div>
          </div>

          {/* Card 3: Отвлечения */}
          <div className="h-[101px] rounded-[18px] bg-[#131A2A] border border-white/[0.06] px-[18px] py-[16px] flex items-center gap-[14px] min-w-0">
            <svg className="w-5 h-5 text-[#FBBF24] shrink-0" viewBox="0 0 20 20" fill="none">
              <path d="M 10 2.5 L 18.7 17.5 H 1.3 L 10 2.5 Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
              <path d="M 10 7.5 V 10.83" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <path d="M 10 14.17 H 10.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <div className="flex flex-col items-start justify-center min-w-0 flex-1 overflow-hidden">
              <span className="text-[13px] text-[#A3ACC2] font-normal leading-[16px] truncate max-w-full">Отвлечения</span>
              <span className="text-[28px] font-bold text-[#EEF1F8] leading-[34px] font-sans tracking-tight whitespace-nowrap">{record.distractionEventsCount}</span>
              <span className="text-[12px] font-normal text-[#6E7891] leading-[15px] pt-[2px] truncate max-w-full">{distractionIntervalLabel}</span>
            </div>
          </div>

          {/* Card 4: Средний фокус */}
          <div className="h-[101px] rounded-[18px] bg-[#131A2A] border border-white/[0.06] px-[18px] py-[16px] flex items-center gap-[14px] min-w-0">
            <svg className="w-5 h-5 text-[#A3ACC2] shrink-0" viewBox="0 0 20 20" fill="none">
              <path d="M 2.5 2.5 V 17.5 H 17.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M 5.83 12.5 L 9.17 9.17 L 11.67 11.67 L 16.67 5.83" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <div className="flex flex-col items-start justify-center min-w-0 flex-1 overflow-hidden">
              <span className="text-[13px] text-[#A3ACC2] font-normal leading-[16px] truncate max-w-full">Средний фокус</span>
              <span className="text-[28px] font-bold text-[#EEF1F8] leading-[34px] font-sans tracking-tight whitespace-nowrap">
                {Math.round(record.averageFocusScore)}%
              </span>
            </div>
          </div>
        </div>

        {/* 3. Big Focus Timeline Chart Card (w-full responsive, h: 276px) */}
        <div className="w-full h-[276px] rounded-[20px] bg-[#131A2A] border border-white/[0.06] p-[24px_25px] flex flex-col justify-between mt-4">
          {/* Chart Header */}
          <div className="flex items-center justify-between">
            <h3 className="text-[15px] font-semibold text-[#EEF1F8]">Фокус в течение сессии</h3>
            <div className="flex items-center gap-5 text-[12px] text-[#A3ACC2]">
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-[2px] bg-[#FF7A2F] rounded-full inline-block" />
                фокус
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3.5 h-[1px] border-t border-dashed border-[#EEF1F8]/55 inline-block" />
                порог {activeThreshold}%
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full border border-[#FBBF24] inline-block" />
                отвлечение
              </span>
            </div>
          </div>

          {/* Chart Area */}
          <div className="relative h-[170px] w-full">
            <svg
              className="w-full h-full overflow-visible"
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="summaryGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#FF7A2F" stopOpacity="0.30" />
                  <stop offset="100%" stopColor="#FF7A2F" stopOpacity="0.00" />
                </linearGradient>
              </defs>

              {/* Subtle horizontal grid lines at 25%, 50%, 75% */}
              <line x1={0} y1={chartHeight * 0.25} x2={chartWidth} y2={chartHeight * 0.25} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              <line x1={0} y1={chartHeight * 0.50} x2={chartWidth} y2={chartHeight * 0.50} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
              <line x1={0} y1={chartHeight * 0.75} x2={chartWidth} y2={chartHeight * 0.75} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />

              {/* Threshold dashed line */}
              <line
                x1={0}
                y1={thresholdY}
                x2={chartWidth}
                y2={thresholdY}
                stroke="#EEF1F8"
                strokeWidth="1"
                strokeDasharray="4 4"
                opacity="0.55"
              />

              {points.length >= 2 && (
                <>
                  {/* Filled area */}
                  <path d={areaD} fill="url(#summaryGradient)" />

                  {/* Stroke path */}
                  <path
                    d={pathD}
                    fill="none"
                    stroke="#FF7A2F"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Dip circles */}
                  {points.map((p: FocusTimelinePoint, i: number) => {
                    if (!p.isDip) return null;
                    const { x, y } = getCoord(i, p.focus);
                    return (
                      <circle
                        key={i}
                        cx={x}
                        cy={y}
                        r="4"
                        fill="#0B0F1A"
                        stroke="#FBBF24"
                        strokeWidth="2"
                      />
                    );
                  })}
                </>
              )}
              {points.length === 1 && (
                <circle
                  cx={getCoord(0, points[0].focus).x}
                  cy={getCoord(0, points[0].focus).y}
                  r="4"
                  fill="#0B0F1A"
                  stroke={points[0].isDip ? '#FBBF24' : '#FF7A2F'}
                  strokeWidth="2"
                />
              )}
            </svg>
            {points.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <span className="text-[12px] text-[#6E7891]">
                  Недостаточно данных для построения графика
                </span>
              </div>
            )}
          </div>

          {/* Timestamps */}
          <div className="flex justify-between text-[13px] text-[#A3ACC2] pt-1 w-full">
            {timeLabels.map((lbl, idx) => (
              <span key={idx}>{lbl}</span>
            ))}
          </div>
        </div>

        {/* 4. Наблюдение: 46px height banner */}
        <div className="w-full h-[46px] rounded-xl bg-[#38BDF8]/[0.08] border border-[#38BDF8]/20 px-4 flex items-center gap-3 text-[14px] mt-3.5 min-w-0">
          <svg className="w-5 h-5 text-[#38BDF8] shrink-0" viewBox="0 0 20 20" fill="none">
            <path
              d="M 10 3.33 L 11.58 8.17 L 16.67 10 L 11.58 11.83 L 10 16.67 L 8.42 11.83 L 3.33 10 L 8.42 8.17 Z"
              stroke="#38BDF8"
              strokeWidth="1.5"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </svg>
          <div className="text-[14px] text-[#C9D1E3] truncate">
            <span className="font-semibold text-[#C9D1E3]">Наблюдение: </span>
            <span className="font-normal text-[#C9D1E3]">
              лучше всего вы держали фокус первые 20 минут. Попробуйте делать короткий перерыв каждые 25–30 минут.
            </span>
          </div>
        </div>
      </div>

      {/* 5. Bottom Action Buttons: w-full, responsive */}
      <div className="w-full border-t border-white/[0.06] pt-4 mt-auto flex items-center justify-between">
        {/* Открыть историю: #1F2840 background */}
        <button
          onClick={() => setActiveNav('history')}
          className="h-[44px] px-[18px] rounded-xl bg-[#1F2840] hover:bg-[#283556] border border-white/[0.08] text-[15px] font-semibold text-[#EEF1F8] flex items-center gap-2 transition-colors cursor-pointer"
        >
          <svg className="w-[17px] h-[17px] text-[#EEF1F8]" viewBox="0 0 17 17" fill="none">
            <path
              d="M 2.125 2.125 V 5.667 H 5.667"
              stroke="currentColor"
              strokeWidth="1.275"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 2.16 9.21 A 6.375 6.375 0 1 0 4.25 3.75 L 2.125 5.667"
              stroke="currentColor"
              strokeWidth="1.275"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M 8.5 4.96 V 8.5 L 10.625 10.625"
              stroke="currentColor"
              strokeWidth="1.275"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>Открыть историю</span>
        </button>

        {/* Новая сессия: Orange, black text #1A0E06, hollow outlined triangle icon */}
        <button
          onClick={startNewSession}
          className="h-[44px] px-[18px] rounded-xl bg-[#FF7A2F] hover:bg-[#FF8D4D] text-[#1A0E06] text-[15px] font-semibold flex items-center gap-2 transition-all cursor-pointer shadow-none"
        >
          <svg className="w-[17px] h-[17px]" viewBox="0 0 17 17" fill="none">
            <path
              d="M 4.96 2.833 V 14.167 L 14.17 8.5 Z"
              stroke="#1A0E06"
              strokeWidth="1.275"
              strokeLinejoin="round"
              strokeLinecap="round"
              fill="none"
            />
          </svg>
          <span>Новая сессия</span>
        </button>
      </div>
    </div>
  );
};
