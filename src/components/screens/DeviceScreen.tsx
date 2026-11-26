import React, { useState } from 'react';
import {
  RotateCw,
  Power,
  Bluetooth,
  Battery,
  Headphones,
  Play,
  Check,
  Target,
  ArrowRight,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import headbandHero from '../../assets/headband-hero.webp';

export const DeviceScreen: React.FC = () => {
  const {
    settings,
    updateSettings,
    deviceStatus,
    telemetry,
    startCalibration,
    calibrationResult,
    setOnboardingStep,
    setActiveNav,
  } = useFocusStore();

  const [isCheckingContact, setIsCheckingContact] = useState(false);
  const [contactCheckNote, setContactCheckNote] = useState<string | null>(null);

  const isSimulator = settings.deviceSource === 'simulator';
  const isBleConnected = !isSimulator && deviceStatus.connected;
  const isStreamActive = isSimulator || isBleConnected;

  const quality = telemetry?.signalQuality ?? {
    t3: isSimulator,
    t4: isSimulator,
    o1: isSimulator,
    o2: isSimulator,
  };

  const connectedCount = isStreamActive
    ? [quality.t3, quality.t4, quality.o1, quality.o2].filter(Boolean).length
    : 0;

  const formatResistance = (
    channelOk: boolean,
    val: number | null | undefined,
    fallbackVal: number
  ): string => {
    if (!isStreamActive) return '— кОм';
    if (!channelOk) return 'нет контакта';
    if (val === null) return '— кОм';
    const numeric = val ?? fallbackVal;
    return `${Math.round(numeric)} кОм`;
  };

  const sensorRows = [
    {
      id: 'T3',
      name: 'Левый висок',
      ok: quality.t3,
      val: formatResistance(quality.t3, telemetry?.resistanceKOhm?.t3, 130),
    },
    {
      id: 'T4',
      name: 'Правый висок',
      ok: quality.t4,
      val: formatResistance(quality.t4, telemetry?.resistanceKOhm?.t4, 132),
    },
    {
      id: 'O1',
      name: 'Затылок слева',
      ok: quality.o1,
      val: formatResistance(quality.o1, telemetry?.resistanceKOhm?.o1, 112),
    },
    {
      id: 'O2',
      name: 'Затылок справа',
      ok: quality.o2,
      val: formatResistance(quality.o2, telemetry?.resistanceKOhm?.o2, 124),
    },
  ];

  const handleStartRecalibrate = () => {
    if (!isSimulator && !isBleConnected) {
      setOnboardingStep('connect');
      setActiveNav('onboarding');
      return;
    }
    startCalibration(30);
    setOnboardingStep('calibrating');
    setActiveNav('onboarding');
  };

  const handleCheckContact = () => {
    setIsCheckingContact(true);
    setContactCheckNote(null);
    setTimeout(() => {
      setIsCheckingContact(false);
      if (!isStreamActive) {
        setContactCheckNote('Нет активного сигнала');
      } else {
        setContactCheckNote(
          connectedCount === 4 ? 'Контакт стабилен (4/4)' : `Активно: ${connectedCount} из 4`
        );
      }
      setTimeout(() => setContactCheckNote(null), 2500);
    }, 350);
  };

  const handleDisconnect = () => {
    if (isSimulator) {
      updateSettings({ deviceSource: 'bluetooth' });
    } else if (isBleConnected) {
      updateSettings({ deviceSource: 'simulator' });
    }
  };

  const activeCalibration =
    calibrationResult &&
    (!calibrationResult.deviceSource || calibrationResult.deviceSource === settings.deviceSource)
      ? calibrationResult
      : null;

  const hasBaselineMetrics = Boolean(activeCalibration);

  const formatCalibrationDate = (iso?: string) => {
    const dt = iso ? new Date(iso) : new Date();
    return `калибровка от ${dt.toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
    })}, ${dt.toLocaleTimeString('ru-RU', {
      hour: '2-digit',
      minute: '2-digit',
    })}`;
  };

  const baselineLabel = activeCalibration
    ? formatCalibrationDate(activeCalibration.calibratedAt)
    : isSimulator
      ? 'демо-режим · калибровка ещё не проводилась'
      : 'индивидуальные пороги ещё не настроены';

  const statusPillStyle = isStreamActive
    ? 'bg-[#34D399]/[0.12] text-[#6EE7B7]'
    : 'bg-[#F87171]/[0.12] text-[#FCA5A5]';

  const countBadgeStyle =
    connectedCount === 4
      ? 'bg-[#34D399]/[0.12] text-[#6EE7B7]'
      : connectedCount > 0
      ? 'bg-[#F59E0B]/[0.12] text-[#FCD34D]'
      : 'bg-[#F87171]/[0.12] text-[#FCA5A5]';

  return (
    <div className="w-full pt-7 px-8 pb-6 space-y-4 animate-in fade-in duration-200">
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-[28px] leading-[1.15] font-bold tracking-tight text-[#EEF1F8]">
          Устройство
        </h1>
        <p className="text-[15px] text-[#A3ACC2] mt-1.5">
          Подключение обруча, датчики и калибровка.
        </p>
      </div>

      {/* Asymmetric 2-column grid matching 12_device.svg (459 : 521) */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,459fr)_minmax(0,521fr)] gap-4 items-center">
        {/* Left: Connection Card */}
        <div className="p-6 rounded-[20px] bg-[#131A2A] border border-white/[0.06] flex flex-col justify-between min-h-[310px]">
          <div>
            {/* Device identity & pills */}
            <div className="flex items-center gap-4">
              <div className="w-[120px] h-[90px] rounded-[16px] bg-[#0E1322] p-2 flex items-center justify-center shrink-0">
                <img
                  src={headbandHero}
                  alt="BrainBit"
                  className="w-full h-full object-contain rounded-[6px]"
                />
              </div>

              <div className="min-w-0">
                <h2 className="text-[20px] leading-[1.2] font-bold tracking-tight text-[#EEF1F8] truncate">
                  {isSimulator
                    ? 'Симулятор ЭЭГ'
                    : deviceStatus.deviceName || 'BrainBit BLE'}
                </h2>

                <div className="flex flex-wrap items-center gap-2 mt-2.5">
                  <span
                    className={`h-[26px] px-3 rounded-full flex items-center gap-2 text-[12px] font-medium ${statusPillStyle}`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        isStreamActive
                          ? 'bg-[#34D399] shadow-[0_0_0_3px_rgba(52,211,153,0.18)]'
                          : 'bg-[#F87171] shadow-[0_0_0_3px_rgba(248,113,113,0.18)]'
                      }`}
                    />
                    <span>
                      {isSimulator
                        ? 'Демо-поток'
                        : isBleConnected
                          ? 'Подключён'
                          : 'Отключён'}
                    </span>
                  </span>

                  <span className="h-[26px] px-3 rounded-full bg-white/[0.06] text-[#C9D1E3] flex items-center gap-1.5 text-[12px] font-medium tabular-nums">
                    <Battery className="w-3.5 h-3.5 text-[#C9D1E3]" />
                    <span>
                      {isStreamActive ? `${deviceStatus.batteryPercentage}%` : '—'}
                    </span>
                  </span>

                  <span className="h-[26px] px-3 rounded-full bg-white/[0.06] text-[#C9D1E3] flex items-center text-[12px] font-medium tabular-nums">
                    {deviceStatus.samplingRateHz || 250} Гц
                  </span>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="h-px bg-white/[0.07] my-5" />

            {/* Signal Source Selector */}
            <div>
              <div className="text-[15px] font-semibold text-[#EEF1F8]">Источник сигнала</div>
              <div className="mt-3 h-[46px] p-[4px] rounded-[12px] bg-[#131A2A] border border-white/[0.07] grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => updateSettings({ deviceSource: 'bluetooth' })}
                  className={`h-full rounded-[9px] flex items-center justify-center gap-2 text-[13px] font-semibold transition-colors cursor-pointer ${
                    !isSimulator
                      ? 'bg-[#FF7A2F] text-[#1A0E06]'
                      : 'text-[#A3ACC2] hover:text-[#EEF1F8]'
                  }`}
                >
                  <Headphones className="w-3.5 h-3.5" />
                  <span>Обруч BrainBit</span>
                </button>
                <button
                  type="button"
                  onClick={() => updateSettings({ deviceSource: 'simulator' })}
                  className={`h-full rounded-[9px] flex items-center justify-center gap-2 text-[13px] font-semibold transition-colors cursor-pointer ${
                    isSimulator
                      ? 'bg-[#FF7A2F] text-[#1A0E06]'
                      : 'text-[#A3ACC2] hover:text-[#EEF1F8]'
                  }`}
                >
                  <Play className="w-3.5 h-3.5" />
                  <span>Демо-режим</span>
                </button>
              </div>
            </div>
          </div>

          {/* Left Card Actions */}
          <div className="flex flex-wrap items-center gap-2.5 mt-5">
            <button
              type="button"
              onClick={handleDisconnect}
              disabled={!isStreamActive}
              className="h-[36px] px-4 rounded-[10px] bg-[#F87171]/[0.08] hover:bg-[#F87171]/[0.14] border border-[#F87171]/[0.25] text-[#FCA5A5] text-[13px] font-medium flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
            >
              <Power className="w-3.5 h-3.5" />
              <span>{isSimulator ? 'Остановить демо' : 'Отключить'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setOnboardingStep('connect');
                setActiveNav('onboarding');
              }}
              className="h-[36px] px-4 rounded-[10px] bg-transparent hover:bg-white/[0.04] border border-white/[0.12] text-[#C9D1E3] hover:text-[#EEF1F8] text-[13px] font-medium flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Bluetooth className="w-3.5 h-3.5 text-[#C9D1E3]" />
              <span>Найти другой обруч</span>
            </button>
          </div>
        </div>

        {/* Right: Sensors & Contact Card */}
        <div className="p-6 rounded-[20px] bg-[#131A2A] border border-white/[0.06] flex flex-col justify-between min-h-[328px]">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[16px] font-semibold text-[#EEF1F8]">Датчики</h2>
            <div className="flex items-center gap-2">
              {contactCheckNote && (
                <span className="text-[12px] text-[#A3ACC2]">{contactCheckNote}</span>
              )}
              <span
                className={`h-[26px] px-3 rounded-full text-[12px] font-medium flex items-center gap-1.5 ${countBadgeStyle}`}
              >
                <Check className="w-3 h-3" strokeWidth={2.5} />
                <span>{connectedCount} из 4</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-5 items-center my-4">
            {/* Top-down Head Schematic */}
            <div className="flex justify-center">
              <svg className="w-[180px] h-[180px]" viewBox="0 0 200 200" aria-label="Схема электродов">
                {/* Nose */}
                <path
                  d="M 86 31 L 100 10 L 114 31"
                  fill="#1A2236"
                  stroke="#3A4560"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                {/* Ears */}
                <ellipse
                  cx="22"
                  cy="100"
                  rx="10"
                  ry="22"
                  fill="#1A2236"
                  stroke="#3A4560"
                  strokeWidth="2"
                />
                <ellipse
                  cx="178"
                  cy="100"
                  rx="10"
                  ry="22"
                  fill="#1A2236"
                  stroke="#3A4560"
                  strokeWidth="2"
                />
                {/* Head circumference */}
                <circle
                  cx="100"
                  cy="100"
                  r="72"
                  fill="#151C2E"
                  stroke="#3A4560"
                  strokeWidth="2"
                />
                {/* Headband strap */}
                <path
                  d="M 29.456 96.4 C 76.496 173.2 123.536 173.2 170.576 96.4"
                  fill="none"
                  stroke="#FF7A2F"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeOpacity="0.45"
                />
                {/* Labels */}
                <text x="100" y="67" textAnchor="middle" fill="#6E7891" fontSize="11" fontWeight="500">
                  лоб
                </text>
                <text
                  x="100"
                  y="111"
                  textAnchor="middle"
                  fill="#6E7891"
                  fontSize="10.5"
                  fontWeight="500"
                >
                  вид сверху
                </text>

                {/* Electrode T3 */}
                <circle
                  cx="29.4"
                  cy="96.4"
                  r="17"
                  fill={quality.t3 ? '#34D399' : '#F87171'}
                  fillOpacity="0.18"
                />
                <circle cx="29.4" cy="96.4" r="11" fill={quality.t3 ? '#34D399' : '#F87171'} />
                <text
                  x="29.4"
                  y="99.8"
                  textAnchor="middle"
                  fill="#0B0F1A"
                  fontSize="9.5"
                  fontWeight="700"
                >
                  T3
                </text>

                {/* Electrode T4 */}
                <circle
                  cx="170.6"
                  cy="96.4"
                  r="17"
                  fill={quality.t4 ? '#34D399' : '#F87171'}
                  fillOpacity="0.18"
                />
                <circle cx="170.6" cy="96.4" r="11" fill={quality.t4 ? '#34D399' : '#F87171'} />
                <text
                  x="170.6"
                  y="99.8"
                  textAnchor="middle"
                  fill="#0B0F1A"
                  fontSize="9.5"
                  fontWeight="700"
                >
                  T4
                </text>

                {/* Electrode O1 */}
                <circle
                  cx="69.8"
                  cy="164.8"
                  r="17"
                  fill={quality.o1 ? '#34D399' : '#F87171'}
                  fillOpacity="0.18"
                />
                <circle cx="69.8" cy="164.8" r="11" fill={quality.o1 ? '#34D399' : '#F87171'} />
                <text
                  x="69.8"
                  y="168.2"
                  textAnchor="middle"
                  fill="#0B0F1A"
                  fontSize="9.5"
                  fontWeight="700"
                >
                  O1
                </text>

                {/* Electrode O2 */}
                <circle
                  cx="130.2"
                  cy="164.8"
                  r="17"
                  fill={quality.o2 ? '#34D399' : '#F87171'}
                  fillOpacity="0.18"
                />
                <circle cx="130.2" cy="164.8" r="11" fill={quality.o2 ? '#34D399' : '#F87171'} />
                <text
                  x="130.2"
                  y="168.2"
                  textAnchor="middle"
                  fill="#0B0F1A"
                  fontSize="9.5"
                  fontWeight="700"
                >
                  O2
                </text>
              </svg>
            </div>

            {/* Clean borderless Sensor Rows */}
            <div className="space-y-2">
              {sensorRows.map((sensor) => (
                <div
                  key={sensor.id}
                  className="h-[34px] flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`w-8 h-8 rounded-[9px] flex items-center justify-center text-[12px] font-bold shrink-0 ${
                        sensor.ok
                          ? 'bg-[#34D399]/[0.12] text-[#6EE7B7]'
                          : 'bg-[#F87171]/[0.12] text-[#FCA5A5]'
                      }`}
                    >
                      {sensor.id}
                    </span>
                    <span className="text-[13px] font-medium text-[#C9D1E3] truncate">
                      {sensor.name}
                    </span>
                  </div>
                  <span className="text-[13px] text-[#A3ACC2] tabular-nums shrink-0">
                    {sensor.val}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Card Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={handleCheckContact}
              className="h-[36px] px-4 rounded-[10px] bg-[#1F2840] hover:bg-[#273250] border border-white/[0.08] text-[13px] font-medium text-[#EEF1F8] flex items-center gap-2 transition-colors cursor-pointer"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isCheckingContact ? 'animate-spin' : ''}`} />
              <span>Проверить контакт</span>
            </button>
            <button
              type="button"
              onClick={handleStartRecalibrate}
              className="h-[36px] px-4 rounded-[10px] bg-[#1F2840] hover:bg-[#273250] border border-white/[0.08] text-[13px] font-medium text-[#EEF1F8] flex items-center gap-2 transition-colors cursor-pointer"
            >
              <Target className="w-3.5 h-3.5 text-[#EEF1F8]" />
              <span>Повторить калибровку</span>
            </button>
          </div>
        </div>
      </div>

      {/* Bottom: Baseline "Ваша норма" Card */}
      <div className="px-6 py-5 rounded-[20px] bg-[#131A2A] border border-white/[0.06] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
        <div>
          <h3 className="text-[16px] font-semibold text-[#EEF1F8]">Ваша норма</h3>
          <p className="text-[13px] text-[#A3ACC2] mt-1">{baselineLabel}</p>
        </div>

        {hasBaselineMetrics ? (
          <div className="flex items-center gap-12">
            <div>
              <span className="text-[12px] text-[#A3ACC2]">Фокус</span>
              <div className="text-[22px] leading-[1.2] font-bold text-[#FF7A2F] tabular-nums mt-0.5">
                {activeCalibration ? Math.round(activeCalibration.baselineFocus) : 64}%
              </div>
            </div>
            <div>
              <span className="text-[12px] text-[#A3ACC2]">Спокойствие</span>
              <div className="text-[22px] leading-[1.2] font-bold text-[#9B8CFF] tabular-nums mt-0.5">
                {activeCalibration ? Math.round(activeCalibration.baselineRelaxation) : 58}%
              </div>
            </div>
            <div>
              <span className="text-[12px] text-[#A3ACC2]">Порог</span>
              <div className="text-[22px] leading-[1.2] font-bold text-[#EEF1F8] tabular-nums mt-0.5">
                {activeCalibration ? Math.round(activeCalibration.recommendedThreshold) : 55}%
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            <span className="h-[28px] px-3 rounded-full bg-[#F59E0B]/[0.12] text-[#FCD34D] text-[13px] font-medium inline-flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
              <span>Нужна калибровка</span>
            </span>
            <button
              type="button"
              onClick={handleStartRecalibrate}
              className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#FF7A2F] hover:text-[#FF8B47] underline underline-offset-4 transition-colors cursor-pointer"
            >
              <span>Пройти калибровку</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
