import React from 'react';
import {
  Play,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import brainbitIcon from '../../assets/brainbit-icon.png';

export const FocusBarHUD: React.FC = () => {
  const {
    feedbackState,
    telemetry,
    settings,
    deviceStatus,
    sessionStats,
    setViewMode,
    isPaused,
    togglePause,
  } = useFocusStore();

  const isConcentration = settings.mode === 'concentration';
  const isSimulator = settings.deviceSource === 'simulator';
  const isStreamActive = isSimulator || deviceStatus.connected;
  const hasSignalData = isSimulator || deviceStatus.connected || sessionStats.durationSeconds > 0;

  const currentMetric = isSimulator
    ? Math.round(feedbackState.smoothedMetric) || 78
    : hasSignalData
      ? Math.round(feedbackState.smoothedMetric)
      : 0;
  const threshold = settings.threshold;
  const isBelowThreshold = isStreamActive && feedbackState.isContactOk && currentMetric < threshold;

  const quality = telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true };
  const activeSensorsCount = isSimulator || deviceStatus.connected
    ? [quality.t3, quality.t4, quality.o1, quality.o2].filter(Boolean).length
    : 4;

  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = Math.floor(totalSeconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed top-7 right-7 z-50 select-none animate-in fade-in duration-200">
      <div
        className="w-[320px] h-[165px] p-[14px_16px] rounded-[20px] bg-[#131A2A]/[0.96] backdrop-blur-2xl border border-white/[0.12] shadow-[0_20px_50px_rgba(0,0,0,0.5)] text-[#EEF1F8] flex flex-col justify-between"
        data-tauri-drag-region
      >
        {/* Row 1: Header Row (h: 30px) */}
        <div className="flex items-center justify-between" data-tauri-drag-region>
          {/* Logo & Name */}
          <div className="flex items-center gap-2" data-tauri-drag-region>
            <img src={brainbitIcon} alt="BrainBit" className="w-5 h-5 rounded-[5px] object-contain shrink-0" />
            <span className="text-[13px] font-semibold text-[#EEF1F8] tracking-tight">FocusGlass</span>
          </div>

          {/* Right Controls: Mode Pill + Pause + Maximize */}
          <div className="flex items-center gap-2">
            {/* Mode Pill */}
            <div
              className={`h-[26px] px-2.5 rounded-full flex items-center gap-1.5 shrink-0 ${
                isBelowThreshold
                  ? 'bg-[#FBBF24]/[0.14] text-[#FCD34D]'
                  : 'bg-[#FF7A2F]/[0.14] text-[#FFB085]'
              }`}
            >
              {isConcentration ? (
                <>
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 12 12" fill="none">
                    <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="0.9" />
                    <circle cx="6" cy="6" r="2.5" stroke="currentColor" strokeWidth="0.9" />
                    <circle cx="6" cy="6" r="0.5" fill="currentColor" />
                  </svg>
                  <span className="text-[12px] font-semibold leading-none">Фокус</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3 shrink-0" viewBox="0 0 18 18" fill="none">
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
                  <span className="text-[12px] font-semibold leading-none">Спокойствие</span>
                </>
              )}
            </div>

            {/* Pause Button with Background Podkladka */}
            <button
              onClick={() => togglePause()}
              className="w-[30px] h-[30px] rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[#C9D1E3] flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title={isPaused ? 'Продолжить' : 'Пауза'}
            >
              {isPaused ? (
                <Play className="w-3.5 h-3.5 text-[#34D399]" />
              ) : (
                <svg className="w-3.5 h-3.5" viewBox="0 0 15 15" fill="none">
                  <path d="M5 2.5V12.5M10 2.5V12.5" stroke="#C9D1E3" strokeWidth="1.125" strokeLinecap="round" />
                </svg>
              )}
            </button>

            {/* Maximize Button with Background Podkladka */}
            <button
              onClick={() => setViewMode('dashboard')}
              className="w-[30px] h-[30px] rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-[#C9D1E3] flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Развернуть"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 15 15" fill="none">
                <path d="M9.5 2H13V5.5M13 2L9 6M5.5 13H2V9.5M2 13L6 9" stroke="#C9D1E3" strokeWidth="1.125" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>

        {/* Row 2: Metric & Status Row */}
        <div className="flex items-center gap-3.5">
          {/* 44px Number with 20px Percent */}
          <div
            className={`font-bold tracking-tight leading-none flex items-baseline select-none ${
              isBelowThreshold ? 'text-[#FBBF24]' : 'text-[#FF7A2F]'
            }`}
          >
            <span className="text-[44px] font-bold tracking-[-1.32px] leading-none">{currentMetric}</span>
            <span className="text-[20px] font-bold ml-0.5 leading-none">%</span>
          </div>

          <div className="flex-1 min-w-0">
            {/* Colored Status Title */}
            <div
              className={`text-[14px] font-semibold truncate leading-tight ${
                !hasSignalData
                  ? 'text-[#A3ACC2]'
                  : isBelowThreshold
                    ? 'text-[#FBBF24]'
                    : 'text-[#FF7A2F]'
              }`}
            >
              {!hasSignalData
                ? 'Ожидание BrainBit'
                : isBelowThreshold
                  ? 'Фокус ниже порога'
                  : 'Внимание в норме'}
            </div>
            {/* Subtitle */}
            <div className="text-[12px] text-[#A3ACC2] truncate mt-1 leading-tight font-normal">
              Сессия{' '}
              {formatTime(
                isSimulator
                  ? sessionStats.durationSeconds > 0
                    ? sessionStats.durationSeconds
                    : 1458
                  : sessionStats.durationSeconds
              )}{' '}
              · порог {threshold}%
            </div>
          </div>
        </div>

        {/* Row 3: Progress Bar with Threshold Needle Mark */}
        <div className="relative w-full h-2 rounded-full bg-[#232C42]">
          {/* Filled progress bar */}
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              isBelowThreshold ? 'bg-[#FBBF24]' : 'bg-[#FF7A2F]'
            }`}
            style={{ width: `${Math.min(100, Math.max(0, currentMetric))}%` }}
          />

          {/* Vertical white threshold needle mark (2x16, extending above & below bar) */}
          <div
            className="absolute -top-1 -bottom-1 w-[2px] rounded-[2px] bg-[#EEF1F8] z-10 shadow-sm transition-all duration-200"
            style={{ left: `${threshold}%` }}
            title={`Порог: ${threshold}%`}
          />
        </div>

        {/* Row 4: Bottom Status Line */}
        <div className="flex items-center justify-between text-[12px] text-[#A3ACC2]">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#34D399] shadow-[0_0_0_3px_rgba(52,211,153,0.18)] shrink-0" />
            <span>Датчики {activeSensorsCount}/4</span>
            <span className="text-[#3A4560] font-normal mx-1">·</span>
            <span>Затемнение</span>
          </div>

          <button
            onClick={() => setViewMode('dashboard')}
            className="text-[12px] font-semibold text-[#FF9A5C] hover:text-[#FF7A2F] transition-colors cursor-pointer"
          >
            Развернуть
          </button>
        </div>
      </div>
    </div>
  );
};