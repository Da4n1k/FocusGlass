import React from 'react';
import {
  Clock,
  AlertTriangle,
  Sun,
  Play,
  ChevronRight,
  Check,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';

// Exact Figma Mode Switch Icons
const ModeFocusIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 16" fill="none">
    <circle cx="8" cy="8" r="5.625" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="8" cy="8" r="2.75" stroke="currentColor" strokeWidth="1.25" />
    <circle cx="8" cy="8" r="0.75" fill="currentColor" />
  </svg>
);

const ModeCalmIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none">
    <path
      d="M8.12 13.75C7.03 13.75 5.97 13.34 5.16 12.6C4.35 11.86 3.85 10.84 3.75 9.75C3.66 8.66 3.98 7.57 4.65 6.7C5.32 5.83 6.29 5.25 7.37 5.06C10.94 4.38 11.87 4.06 13.12 2.5C13.75 3.75 14.37 5.13 14.37 7.5C14.37 10.94 11.37 13.75 8.12 13.75Z"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.5 14.38C2.5 12.5 3.69 11 5.69 10.63"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const SessionScreen: React.FC = () => {
  const {
    settings,
    updateSettings,
    feedbackState,
    sessionStats,
    deviceStatus,
    isPaused,
    togglePause,
    setViewMode,
    setActiveNav,
    finishSession,
    focusTimeline,
    feedbackStyle,
  } = useFocusStore();

  const isSimulator = settings.deviceSource === 'simulator';
  const hasSignalData =
    isSimulator ||
    deviceStatus.connected ||
    sessionStats.durationSeconds > 0 ||
    focusTimeline.length > 0;

  const currentMetric = hasSignalData ? Math.round(feedbackState.smoothedMetric) : 0;
  const isConcentration = settings.mode === 'concentration';
  const threshold = settings.threshold;
  const isBelowThreshold = hasSignalData && feedbackState.isContactOk && currentMetric < threshold;
  const activeFeedbackStyle = settings.feedbackStyle ?? feedbackStyle;
  const maxDimPct = Math.round(settings.dimmingMaxOpacity * 100);
  const feedbackStyleLabel =
    activeFeedbackStyle === 'blur'
      ? `Размытие · до ${settings.blurRadius} px`
      : activeFeedbackStyle === 'distracting_only'
        ? `Только отвлекающие окна · до ${maxDimPct}%`
        : `Плавное затемнение · до ${maxDimPct}%`;

  // Format session duration
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // SVG circular gauge calculations matching Figma
  const gaugeRadius = 90;
  const circumference = 2 * Math.PI * gaugeRadius;
  const strokeDashoffset = circumference - (currentMetric / 100) * circumference;

  // Dynamic threshold needle on circular gauge (rotates with threshold slider)
  // The gauge SVG has className="-rotate-90".
  // Inside this rotated coordinate system, 0 rad (+X) maps to visual 12 o'clock (0%).
  // Clockwise progression: 25% -> 3 o'clock, 50% -> 6 o'clock, 75% -> 9 o'clock, 100% -> 12 o'clock.
  const thresholdAngleRad = (threshold / 100) * 2 * Math.PI;
  const needleInnerR = 76;
  const needleOuterR = 104;
  const needleX1 = (110 + needleInnerR * Math.cos(thresholdAngleRad)).toFixed(1);
  const needleY1 = (110 + needleInnerR * Math.sin(thresholdAngleRad)).toFixed(1);
  const needleX2 = (110 + needleOuterR * Math.cos(thresholdAngleRad)).toFixed(1);
  const needleY2 = (110 + needleOuterR * Math.sin(thresholdAngleRad)).toFixed(1);

  // Generate SVG path for 10-minute focus chart
  const chartWidth = 380;
  const chartHeight = 110;
  const paddingX = 10;
  const paddingY = 10;

  const defaultPoints = [
    { focus: 68, isDip: false },
    { focus: 72, isDip: false },
    { focus: 75, isDip: false },
    { focus: 78, isDip: false },
    { focus: 70, isDip: false },
    { focus: 54, isDip: true },
    { focus: 49, isDip: true },
    { focus: 62, isDip: false },
    { focus: 76, isDip: false },
    { focus: 81, isDip: false },
    { focus: 77, isDip: false },
    { focus: 78, isDip: false },
  ];

  const points =
    focusTimeline.length > 0
      ? focusTimeline
      : isSimulator
        ? defaultPoints
        : [];
  const stepX = (chartWidth - paddingX * 2) / Math.max(1, points.length - 1);

  const getCoord = (idx: number, val: number) => {
    const x = paddingX + idx * stepX;
    const y = chartHeight - paddingY - (val / 100) * (chartHeight - paddingY * 2);
    return { x, y };
  };

  const pathD =
    points.length >= 2
      ? points
          .map((p, i) => {
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
    chartHeight - paddingY - (threshold / 100) * (chartHeight - paddingY * 2);

  const handleThresholdChange = (val: number) => {
    updateSettings({
      threshold: val,
    });
  };

  return (
    <div className="pt-7 px-8 pb-4 h-full flex flex-col justify-between animate-in fade-in duration-200">
      <div className="space-y-5">
        {/* Screen Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-[#EEF1F8]">Сессия</h1>
            <p className="text-[13px] text-[#A3ACC2] mt-1">
              Работайте как обычно — FocusGlass подскажет, когда внимание снизится.
            </p>
          </div>

          {/* Mode Selector Segmented Pill */}
          <div className="h-[46px] p-1 rounded-xl bg-[#131A2A] border border-white/[0.07] flex items-center self-start sm:self-auto">
            <button
              onClick={() => updateSettings({ mode: 'concentration' })}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-[9px] text-[13px] font-semibold transition-all cursor-pointer ${
                isConcentration
                  ? 'bg-[#FF7A2F] text-[#1A0E06] shadow-[0_0_12px_rgba(255,122,47,0.35)]'
                  : 'text-[#A3ACC2] hover:text-[#EEF1F8]'
              }`}
            >
              <ModeFocusIcon className={`w-3.5 h-3.5 shrink-0 ${isConcentration ? 'text-[#1A0E06]' : 'text-[#A3ACC2]'}`} />
              <span className="leading-none">Фокус</span>
            </button>
            <button
              onClick={() => updateSettings({ mode: 'relaxation' })}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-[9px] text-[13px] font-medium transition-all cursor-pointer ${
                !isConcentration
                  ? 'bg-[#FF7A2F] text-[#1A0E06] shadow-[0_0_12px_rgba(255,122,47,0.35)]'
                  : 'text-[#A3ACC2] hover:text-[#EEF1F8]'
              }`}
            >
              <ModeCalmIcon className={`w-4 h-4 shrink-0 ${!isConcentration ? 'text-[#1A0E06]' : 'text-[#A3ACC2]'}`} />
              <span className="leading-none">Спокойствие</span>
            </button>
          </div>
        </div>

        {/* Main Grid: Left Primary Card (700px) + Right Control Cards (280px) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left Large Card: Circular Focus Gauge + 10-Minute Trend */}
          <div className="lg:col-span-8 p-6 rounded-[20px] bg-[#131A2A] border border-white/[0.06] flex flex-col md:flex-row items-center gap-7 justify-between shadow-xl relative overflow-hidden">
            {/* Subtle ambient back-glow */}
            <div className="absolute top-0 left-1/4 w-48 h-48 bg-[#FF7A2F]/5 rounded-full blur-3xl pointer-events-none" />

            {/* Left: Circular Focus Gauge */}
            <div className="flex flex-col items-center shrink-0 w-full md:w-auto">
              <div className="relative w-[204px] h-[204px] flex items-center justify-center">
                <svg className="w-full h-full -rotate-90 overflow-visible" viewBox="0 0 220 220">
                  {/* Background track circle */}
                  <circle
                    cx="110"
                    cy="110"
                    r={gaugeRadius}
                    stroke="white"
                    strokeOpacity="0.07"
                    strokeWidth="15"
                    fill="none"
                  />
                  {/* Progress arc */}
                  <circle
                    cx="110"
                    cy="110"
                    r={gaugeRadius}
                    stroke={isConcentration ? '#FF7A2F' : '#34D399'}
                    strokeWidth="15"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    fill="none"
                    style={{ transition: 'stroke-dashoffset 300ms ease-out' }}
                  />

                  {/* White indicator needle tick dynamically placed at threshold percentage */}
                  <line
                    x1={needleX1}
                    y1={needleY1}
                    x2={needleX2}
                    y2={needleY2}
                    stroke="#EEF1F8"
                    strokeWidth="3.2"
                    strokeLinecap="round"
                    style={{ transition: 'all 150ms ease-out' }}
                  />
                </svg>

                {/* Centered Metric Text */}
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pointer-events-none">
                  <span className="text-[52px] font-bold tracking-tight text-[#EEF1F8] font-mono leading-none">
                    {currentMetric}
                    <span className="text-[26px] font-bold text-[#EEF1F8] ml-0.5">%</span>
                  </span>
                  <span className="text-[13px] text-[#A3ACC2] lowercase tracking-normal font-medium mt-1">
                    {isConcentration ? 'фокус' : 'спокойствие'}
                  </span>
                </div>
              </div>

              {/* Status Pill Badge */}
              <div className="mt-3.5">
                {!hasSignalData ? (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-white/[0.06] border border-white/[0.08] text-[#A3ACC2] text-[13px] font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#6E7891]" />
                    <span>Ожидание сигнала BrainBit</span>
                  </div>
                ) : isBelowThreshold ? (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#FBBF24]/12 border border-[#FBBF24]/20 text-[#FBBF24] text-[13px] font-medium">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#FBBF24] animate-pulse" />
                    <span>
                      {isConcentration ? 'Фокус ниже порога' : 'Спокойствие ниже порога'}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-[#34D399]/12 border border-[#34D399]/20 text-[#6EE7B7] text-[13px] font-medium">
                    <Check className="w-3.5 h-3.5 text-[#34D399]" />
                    <span>
                      {isConcentration ? 'Внимание в норме' : 'Спокойствие в норме'}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right: 10-Minute Line Chart */}
            <div className="flex-1 w-full flex flex-col justify-start self-stretch pt-1">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-[15px] font-semibold text-[#EEF1F8]">
                    {isConcentration ? 'Фокус за последние 10 минут' : 'Релаксация за 10 минут'}
                  </h3>
                  <p className="text-[12px] text-[#A3ACC2] mt-0.5">
                    пунктир — ваш порог {threshold}%
                  </p>
                </div>
                <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-white/[0.06] text-[#C9D1E3]">
                  10 мин
                </span>
              </div>

              {/* Chart Area */}
              <div className="relative h-[125px] w-full my-1">
                <svg
                  className="w-full h-full overflow-visible"
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  preserveAspectRatio="none"
                >
                  <defs>
                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor={isConcentration ? '#FF7A2F' : '#34D399'}
                        stopOpacity="0.25"
                      />
                      <stop
                        offset="100%"
                        stopColor={isConcentration ? '#FF7A2F' : '#34D399'}
                        stopOpacity="0.00"
                      />
                    </linearGradient>
                  </defs>

                  {/* Horizontal grid lines at 75%, 50%, and 25% */}
                  <line x1={paddingX} y1={32.5} x2={chartWidth - paddingX} y2={32.5} stroke="white" strokeOpacity="0.05" />
                  <line x1={paddingX} y1={55.0} x2={chartWidth - paddingX} y2={55.0} stroke="white" strokeOpacity="0.05" />
                  <line x1={paddingX} y1={77.5} x2={chartWidth - paddingX} y2={77.5} stroke="white" strokeOpacity="0.05" />

                  {/* Threshold line */}
                  <line
                    x1={paddingX}
                    y1={thresholdY}
                    x2={chartWidth - paddingX}
                    y2={thresholdY}
                    stroke="#EEF1F8"
                    strokeWidth="1.2"
                    strokeDasharray="5 5"
                    strokeOpacity="0.55"
                  />

                  {points.length >= 2 && (
                    <>
                      {/* Filled area */}
                      <path d={areaD} fill="url(#chartGradient)" />

                      {/* Smooth stroke line */}
                      <path
                        d={pathD}
                        fill="none"
                        stroke={isConcentration ? '#FF7A2F' : '#34D399'}
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />

                      {/* Dip markers */}
                      {points.map((p, i) => {
                        if (p.focus >= threshold) return null;
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
                      stroke={points[0].focus < threshold ? '#FBBF24' : isConcentration ? '#FF7A2F' : '#34D399'}
                      strokeWidth="2.5"
                    />
                  )}
                </svg>
                {points.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <span className="text-[12px] text-[#6E7891]">
                      Ожидание данных с обруча BrainBit...
                    </span>
                  </div>
                )}
              </div>

              {/* Labels snuggly underneath chart */}
              <div className="flex items-center justify-between text-[11px] text-[#A3ACC2] mt-1.5">
                <span>10 мин назад</span>
                <span>сейчас</span>
              </div>
            </div>
          </div>

          {/* Right Stack: Threshold Slider + Notification Mode (280px) */}
          <div className="lg:col-span-4 flex flex-col justify-between p-[22px] rounded-[20px] bg-[#131A2A] border border-white/[0.06] shadow-xl">
            {/* Threshold Section */}
            <div>
              <h3 className="text-base font-semibold text-[#EEF1F8]">Порог срабатывания</h3>
              <div className="flex items-center justify-between mt-2.5">
                <span className="text-[13px] text-[#A3ACC2]">Ниже порога экран тускнеет</span>
                <span className="text-lg font-bold text-[#EEF1F8]">{threshold}%</span>
              </div>

              <div className="my-3.5">
                <input
                  type="range"
                  min="10"
                  max="95"
                  value={threshold}
                  onChange={(e) => handleThresholdChange(Number(e.target.value))}
                  className="w-full figma-slider cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #FF7A2F 0%, #FF7A2F ${((threshold - 10) / (95 - 10)) * 100}%, #232C42 ${((threshold - 10) / (95 - 10)) * 100}%, #232C42 100%)`
                  }}
                />
                <div className="flex justify-between text-[12px] text-[#A3ACC2] mt-1 font-medium">
                  <span>мягче</span>
                  <span>строже</span>
                </div>
              </div>
            </div>

            {/* Feedback Mode Quick-Card */}
            <div className="pt-2">
              <h3 className="text-base font-semibold text-[#EEF1F8]">Как подсказывать</h3>

              <div
                onClick={() => setActiveNav('settings')}
                className="mt-3 p-3.5 rounded-[14px] bg-[#1A2236] border border-transparent hover:border-white/10 transition-all cursor-pointer flex items-start gap-3 group"
              >
                <div className="pt-0.5 text-[#FF7A2F] shrink-0">
                  <Sun className="w-[18px] h-[18px] text-[#FF7A2F]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-[#EEF1F8] group-hover:text-[#FF7A2F] transition-colors">
                    {activeFeedbackStyle === 'blur'
                      ? 'Размытие экрана'
                      : activeFeedbackStyle === 'distracting_only'
                        ? 'Только отвлекающие окна'
                        : 'Плавное затемнение'}
                  </div>
                  <div className="text-[12.5px] text-[#A3ACC2] mt-0.5">
                    {feedbackStyleLabel} · настройки
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#A3ACC2] group-hover:text-white transition-colors shrink-0 mt-0.5" />
              </div>
            </div>
          </div>
        </div>

        {/* 4 Metric Cards Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Duration */}
          <div className="h-[76px] px-[18px] py-3.5 rounded-[18px] bg-[#131A2A] border border-white/[0.06] flex items-center gap-3.5 shadow-md">
            <div className="p-2 rounded-xl bg-[#1A2236] text-[#A3ACC2]">
              <Clock className="w-[18px] h-[18px] text-[#A3ACC2]" />
            </div>
            <div>
              <div className="text-[13px] text-[#A3ACC2]">Длительность</div>
              <div className="text-[22px] font-bold text-[#EEF1F8] font-mono leading-tight">
                {formatTime(sessionStats.durationSeconds)}
              </div>
            </div>
          </div>

          {/* Time In Focus */}
          <div className="h-[76px] px-[18px] py-3.5 rounded-[18px] bg-[#131A2A] border border-white/[0.06] flex items-center gap-3.5 shadow-md">
            <div className="p-2 rounded-xl bg-[#1A2236]">
              <svg className="w-[18px] h-[18px]" viewBox="0 0 18 18" fill="none">
                <circle cx="9" cy="9" r="6.75" stroke="#FF7A2F" strokeWidth="1.35" />
                <circle cx="9" cy="9" r="3" stroke="#FF7A2F" strokeWidth="1.35" />
                <circle cx="9" cy="9" r="0.8" fill="#FF7A2F" />
              </svg>
            </div>
            <div>
              <div className="text-[13px] text-[#A3ACC2]">Время в фокусе</div>
              <div className="text-[22px] font-bold text-[#EEF1F8] font-mono leading-tight">
                {sessionStats.durationSeconds > 0
                  ? Math.round(
                      (sessionStats.timeInFocusSeconds / sessionStats.durationSeconds) * 100
                    )
                  : 0}
                %
              </div>
            </div>
          </div>

          {/* Distractions */}
          <div className="h-[76px] px-[18px] py-3.5 rounded-[18px] bg-[#131A2A] border border-white/[0.06] flex items-center gap-3.5 shadow-md">
            <div className="p-2 rounded-xl bg-[#1A2236] text-[#FBBF24]">
              <AlertTriangle className="w-[18px] h-[18px] text-[#FBBF24]" />
            </div>
            <div>
              <div className="text-[13px] text-[#A3ACC2]">Отвлечения</div>
              <div className="text-[22px] font-bold text-[#EEF1F8] font-mono leading-tight">
                {sessionStats.distractionEventsCount}
              </div>
            </div>
          </div>

          {/* Average Focus */}
          <div className="h-[76px] px-[18px] py-3.5 rounded-[18px] bg-[#131A2A] border border-white/[0.06] flex items-center gap-3.5 shadow-md">
            <div className="p-2 rounded-xl bg-[#1A2236] text-[#A3ACC2]">
              {/* Coordinate axis with vertical on LEFT and horizontal on BOTTOM */}
              <svg className="w-[18px] h-[18px]" viewBox="0 0 18 18" fill="none">
                <path d="M3 3V15H15" stroke="#A3ACC2" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M6 12L9 9L11.25 11.25L15 6" stroke="#A3ACC2" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <div className="text-[13px] text-[#A3ACC2]">Средний фокус</div>
              <div className="text-[22px] font-bold text-[#EEF1F8] font-mono leading-tight">
                {sessionStats.durationSeconds > 0
                  ? Math.round(sessionStats.averageFocusScore)
                  : 0}
                %
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Session Action Ribbon - Docked at the bottom with top border line */}
      <div className="mt-auto pt-4 border-t border-white/[0.06] flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Пауза */}
          <button
            onClick={togglePause}
            className="flex-1 sm:flex-none h-[44px] px-[18px] rounded-xl bg-[#1F2840] hover:bg-[#283556] border border-white/[0.08] text-[15px] font-semibold text-[#EEF1F8] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            {isPaused ? (
              <Play className="w-4 h-4 text-[#34D399]" />
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
                <path d="M5.5 3.5V12.5M10.5 3.5V12.5" stroke="#EEF1F8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
            <span>{isPaused ? 'Продолжить' : 'Пауза'}</span>
          </button>

          {/* Завершить сессию */}
          <button
            onClick={finishSession}
            className="flex-1 sm:flex-none h-[44px] px-[18px] rounded-xl bg-[#F87171]/[0.08] hover:bg-[#F87171]/[0.15] border border-[#F87171]/25 text-[15px] font-semibold text-[#FCA5A5] flex items-center justify-center gap-2 transition-colors cursor-pointer"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 14 14" fill="none">
              <rect x="2" y="2" width="10" height="10" rx="1.5" stroke="#FCA5A5" strokeWidth="1.35" />
            </svg>
            <span>Завершить сессию</span>
          </button>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
          <span className="h-[27px] px-2 py-0.5 rounded-lg border border-white/10 text-[12px] font-mono text-[#6E7891] flex items-center">
            Ctrl + Shift + F
          </span>
          <button
            onClick={() => setViewMode('hud')}
            className="w-full sm:w-auto h-[44px] px-[18px] rounded-xl bg-[#FF7A2F] hover:bg-[#FF8D4D] text-[#1A0E06] text-[15px] font-semibold flex items-center justify-center gap-2 shadow-[0_4px_16px_rgba(255,122,47,0.35)] transition-all cursor-pointer"
          >
            {/* Inward shrink/collapse icon from Figma */}
            <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none">
              <path
                d="M10 13V9.5H13.5M10 9.5L14 13.5M6 3V6.5H2.5M6 6.5L2 2.5"
                stroke="#1A0E06"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span>Свернуть в мини-панель</span>
          </button>
        </div>
      </div>
    </div>
  );
};