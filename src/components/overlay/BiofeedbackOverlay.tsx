import React from 'react';
import { useFocusStore } from '../../stores/useFocusStore';

export { DimLayer, type DimLayerProps, type DimRegionTarget } from './DimLayer';
const CoffeeYellowIcon: React.FC<{ className?: string }> = ({ className = 'w-6 h-6' }) => (
  <svg className={className} viewBox="0 0 24 24" fill="none">
    <path
      d="M17 8H18C20.06 8 21.08 8.42 21.83 9.17C22.58 9.92 23 10.94 23 12C23 13.06 22.58 14.08 21.83 14.83C21.08 15.58 20.06 16 18 16H17"
      stroke="#FBBF24"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M3 8H17V17C17 19.2 15.2 21 13 21H7C4.8 21 3 19.2 3 17V8Z"
      stroke="#FBBF24"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M6 2V4M10 2V4M14 2V4"
      stroke="#FBBF24"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

const CoffeeWhiteIcon: React.FC<{ className?: string }> = ({ className = 'w-[17px] h-[17px]' }) => (
  <svg className={className} viewBox="0 0 17 17" fill="none">
    <path
      d="M12 5.67H12.75C14.5 5.67 15.58 6.75 15.58 8.5C15.58 10.25 14.5 11.33 12.75 11.33H12"
      stroke="#EEF1F8"
      strokeWidth="1.275"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M2.125 5.67H12.04V12.04C12.04 13.6 10.8 14.875 9.2 14.875H4.96C3.4 14.875 2.125 13.6 2.125 12.04V5.67Z"
      stroke="#EEF1F8"
      strokeWidth="1.275"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M4.25 1.42V2.83M7.08 1.42V2.83M9.92 1.42V2.83"
      stroke="#EEF1F8"
      strokeWidth="1.275"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export const BiofeedbackOverlay: React.FC = () => {
  const {
    feedbackState,
    settings,
    deviceStatus,
    activeNav,
    isSessionEnded,
    isPaused,
    isGentleAlertDismissed,
    dismissGentleAlert,
    pauseForMinutes,
    feedbackStyle,
  } = useFocusStore();

  const { overlayOpacity, blurRadius, isDimmingActive, isContactOk, smoothedMetric } =
    feedbackState;
  const isStreamActive = settings.deviceSource === 'simulator' || deviceStatus.connected;
  const activeFeedbackStyle = settings.feedbackStyle ?? feedbackStyle;

  const canDim =
    !isPaused &&
    !isSessionEnded &&
    activeNav !== 'summary' &&
    activeNav !== 'onboarding' &&
    isStreamActive &&
    isContactOk &&
    isDimmingActive;
  const displayOpacity = canDim
    ? activeFeedbackStyle === 'blur'
      ? Math.min(overlayOpacity, 0.22)
      : overlayOpacity
    : 0;
  const displayBlur = canDim && activeFeedbackStyle === 'blur' ? blurRadius : 0;

  const currentVal = Math.round(smoothedMetric);
  const isConcentration = settings.mode === 'concentration';

  return (
    <div
      className="fixed inset-0 pointer-events-none z-40 transition-all duration-700 ease-out flex flex-col justify-end items-center pb-[89px] overflow-hidden"
      style={{
        backgroundColor: `rgba(11, 15, 26, ${displayOpacity})`,
        backdropFilter: displayBlur > 0 ? `blur(${displayBlur}px)` : 'none',
        WebkitBackdropFilter: displayBlur > 0 ? `blur(${displayBlur}px)` : 'none',
      }}
    >
      {/* Peripheral Vignette Gradient */}
      <div
        className="absolute inset-0 transition-opacity duration-700 pointer-events-none"
        style={{
          opacity: displayOpacity > 0 ? Math.min(1, displayOpacity * 1.5) : 0,
          background:
            'radial-gradient(circle at center, transparent 40%, rgba(11, 15, 26, 0.45) 70%, rgba(5, 7, 13, 0.95) 100%)',
        }}
      />

      {/* Figma Screen 08 Bottom Gentle Cue Prompt */}
      {canDim && !isGentleAlertDismissed && (
        <div className="relative z-50 pointer-events-auto w-[560px] max-w-[560px] p-[20px_22px] rounded-[20px] bg-[#131A2A] border border-[#FBBF24]/35 shadow-[0_24px_60px_rgba(0,0,0,0.55)] flex items-start gap-4 animate-in fade-in slide-in-from-bottom-4 duration-300 mx-4">
          {/* Left Icon Badge: Yellow 48x48, rounded-14, NO shadow, NO border */}
          <div className="w-12 h-12 rounded-[14px] bg-[#FBBF24]/12 flex items-center justify-center shrink-0">
            <CoffeeYellowIcon />
          </div>

          {/* Right Content */}
          <div className="flex-1 min-w-0">
            {/* Title: 17px SemiBold in #EEF1F8 */}
            <h4 className="text-[17px] font-semibold text-[#EEF1F8] leading-tight">
              {isConcentration
                ? `Внимание снизилось до ${currentVal}%`
                : `Спокойствие снизилось до ${currentVal}%`}
            </h4>

            {/* Description: 14px Regular in #A3ACC2, leading-20 */}
            <p className="text-[14px] text-[#A3ACC2] leading-[20px] mt-1 font-normal">
              {isConcentration
                ? 'Вернитесь к задаче или сделайте короткую паузу. Экран прояснится сам, когда фокус восстановится.'
                : 'Сделайте глубокий вдох и расслабьте плечи. Экран прояснится сам, когда спокойствие восстановится.'}
            </p>

            {/* Buttons Row: Aligned to start (text alignment), pt-3.5 */}
            <div className="flex items-center justify-start gap-2.5 pt-3.5">
              {/* Button: Пауза 5 минут */}
              <button
                onClick={() => {
                  pauseForMinutes(5);
                  dismissGentleAlert();
                }}
                className="h-[36px] px-3.5 rounded-[10px] bg-[#1F2840] hover:bg-[#283556] border border-white/[0.08] text-[14px] font-semibold text-[#EEF1F8] flex items-center gap-2 transition-colors cursor-pointer"
              >
                <CoffeeWhiteIcon />
                <span>Пауза 5 минут</span>
              </button>

              {/* Button: Понятно (No checkmark, dark brown text #1A0E06) */}
              <button
                onClick={dismissGentleAlert}
                className="h-[36px] px-3.5 rounded-[10px] bg-[#FF7A2F] hover:bg-[#FF8D4D] text-[#1A0E06] text-[14px] font-semibold transition-all cursor-pointer flex items-center justify-center"
              >
                <span>Понятно</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
