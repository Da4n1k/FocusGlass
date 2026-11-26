import React, { useState, useEffect } from 'react';
import {
  Bluetooth,
  Play,
  RotateCw,
  Check,
  ChevronRight,
  ChevronLeft,
  User,
  Eye,
  VolumeX,
  Zap,
  Leaf,
  Info,
  Flame,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { tauriBridge } from '../../services/tauriBridge';
import type { DiscoveredBrainBitDevice } from '../../services/eegTypes';
import headbandHero from '../../assets/headband-hero.webp';

export const OnboardingWizard: React.FC = () => {
  const {
    onboardingStep,
    setOnboardingStep,
    startNewSession,
    settings,
    updateSettings,
    deviceStatus,
    feedbackState,
    startCalibration,
    cancelCalibration,
    isCalibrating,
    calibrationRemainingSeconds,
    calibrationProgress,
    calibrationResult,
    applyCalibration,
    telemetry,
  } = useFocusStore();

  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredBrainBitDevice[]>([]);
  const [selectedAddress, setSelectedAddress] = useState<string | null>(null);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const isSimulator = settings.deviceSource === 'simulator';
  const isStreamReady = isSimulator || deviceStatus.connected;

  const handleStartSearching = async () => {
    setIsSearching(true);
    setScanMessage(null);
    try {
      const res = await tauriBridge.scanBrainBitDevices();
      setDiscoveredDevices(res.devices);
      setScanMessage(res.message);
      setSelectedAddress(res.devices[0]?.address ?? null);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    if (onboardingStep === 'connect' && !isSimulator) {
      void handleStartSearching();
    }
  }, [onboardingStep, isSimulator]);

  // Auto-start calibration timer only when entering calibrating cleanly without an old result
  useEffect(() => {
    if (onboardingStep === 'calibrating' && isStreamReady && !isCalibrating && !calibrationResult) {
      startCalibration(30);
    }
  }, [onboardingStep, isStreamReady, isCalibrating, calibrationResult, startCalibration]);

  // Transition to done once calibration finishes
  useEffect(() => {
    if (onboardingStep === 'calibrating' && !isCalibrating && calibrationResult) {
      setOnboardingStep('done');
    }
  }, [calibrationResult, isCalibrating, onboardingStep, setOnboardingStep]);

  const handleEnterCalibration = () => {
    startCalibration(30);
    setOnboardingStep('calibrating');
  };

  const handleFinishCalibrationAndStartSession = () => {
    applyCalibration();
    startNewSession();
  };

  const quality = telemetry?.signalQuality ?? {
    t3: isSimulator,
    t4: isSimulator,
    o1: isSimulator,
    o2: isSimulator,
  };
  const allContactOk =
    isStreamReady && quality.t3 && quality.t4 && quality.o1 && quality.o2;

  const formatResistance = (
    ok: boolean,
    val: number | null | undefined,
    fallback: number
  ): string => {
    if (!isStreamReady) return 'нет потока';
    if (!ok) return 'нет контакта';
    if (val === null) return '— кОм';
    return `${Math.round(val ?? fallback)} кОм`;
  };

  const sensorRows = [
    {
      id: 'T3',
      name: 'Левый висок',
      ok: isStreamReady && quality.t3,
      val: formatResistance(quality.t3, telemetry?.resistanceKOhm?.t3, 130),
    },
    {
      id: 'T4',
      name: 'Правый висок',
      ok: isStreamReady && quality.t4,
      val: formatResistance(quality.t4, telemetry?.resistanceKOhm?.t4, 132),
    },
    {
      id: 'O1',
      name: 'Затылок слева',
      ok: isStreamReady && quality.o1,
      val: formatResistance(quality.o1, telemetry?.resistanceKOhm?.o1, 112),
    },
    {
      id: 'O2',
      name: 'Затылок справа',
      ok: isStreamReady && quality.o2,
      val: formatResistance(quality.o2, telemetry?.resistanceKOhm?.o2, 124),
    },
  ];

  return (
    <div className="min-h-full flex flex-col justify-center items-center p-6 max-w-5xl mx-auto animate-in fade-in duration-200">
      {/* Top Stepper (Steps 2-5) */}
      {onboardingStep !== 'welcome' && (
        <div className="flex items-center gap-4 mb-8 text-xs font-semibold">
          {/* Step 1: Подключение */}
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                onboardingStep === 'connect'
                  ? 'bg-[#FF7A2F] text-white'
                  : 'bg-[#34D399] text-[#0B0F1A]'
              }`}
            >
              {onboardingStep === 'connect' ? '1' : <Check className="w-3.5 h-3.5 stroke-[3]" />}
            </span>
            <span className={onboardingStep === 'connect' ? 'text-[#EEF1F8]' : 'text-[#34D399]'}>
              Подключение
            </span>
          </div>

          <div
            className={`w-8 h-0.5 ${
              onboardingStep === 'connect' ? 'bg-[#1A2236]' : 'bg-[#34D399]'
            }`}
          />

          {/* Step 2: Проверка датчиков */}
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                onboardingStep === 'sensors'
                  ? 'bg-[#FF7A2F] text-white'
                  : onboardingStep === 'calibrating' || onboardingStep === 'done'
                  ? 'bg-[#34D399] text-[#0B0F1A]'
                  : 'bg-[#1A2236] text-[#6E7891]'
              }`}
            >
              {onboardingStep === 'calibrating' || onboardingStep === 'done' ? (
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              ) : (
                '2'
              )}
            </span>
            <span
              className={
                onboardingStep === 'sensors'
                  ? 'text-[#EEF1F8]'
                  : onboardingStep === 'calibrating' || onboardingStep === 'done'
                  ? 'text-[#34D399]'
                  : 'text-[#6E7891]'
              }
            >
              Проверка датчиков
            </span>
          </div>

          <div
            className={`w-8 h-0.5 ${
              onboardingStep === 'done' ? 'bg-[#34D399]' : 'bg-[#1A2236]'
            }`}
          />

          {/* Step 3: Калибровка */}
          <div className="flex items-center gap-2">
            <span
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                onboardingStep === 'calibrating'
                  ? 'bg-[#FF7A2F] text-white'
                  : onboardingStep === 'done'
                  ? 'bg-[#34D399] text-[#0B0F1A]'
                  : 'bg-[#1A2236] text-[#6E7891]'
              }`}
            >
              {onboardingStep === 'done' ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : '3'}
            </span>
            <span
              className={
                onboardingStep === 'calibrating'
                  ? 'text-[#EEF1F8]'
                  : onboardingStep === 'done'
                  ? 'text-[#34D399]'
                  : 'text-[#6E7891]'
              }
            >
              Калибровка
            </span>
          </div>
        </div>
      )}

      {/* STEP 1: 01 Приветствие */}
      {onboardingStep === 'welcome' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center w-full">
          {/* Left Column */}
          <div className="md:col-span-7 space-y-6">
            <div className="space-y-3">
              <span className="text-[11px] font-bold text-[#FF7A2F] uppercase tracking-wider">
                БИООБРАТНАЯ СВЯЗЬ ДЛЯ РАБОТЫ ЗА КОМПЬЮТЕРОМ
              </span>
              <h1 className="text-3xl lg:text-4xl font-extrabold text-[#EEF1F8] leading-tight">
                Экран, который замечает усталость{' '}
                <span className="text-[#FF7A2F]">раньше вас</span>
              </h1>
              <p className="text-sm text-[#A3ACC2] leading-relaxed">
                FocusGlass читает сигнал нейрообруча BrainBit. Когда внимание падает, экран мягко
                тускнеет — это подсказка вернуться к задаче или сделать паузу.
              </p>
            </div>

            {/* 3 Step Cards */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3.5 rounded-2xl bg-[#131A2A] border border-white/5 space-y-1">
                <span className="w-5 h-5 rounded-full bg-[#FF7A2F] text-white flex items-center justify-center text-[10px] font-bold">
                  1
                </span>
                <div className="text-xs font-semibold text-[#EEF1F8]">Подключите обруч</div>
                <div className="text-[11px] text-[#6E7891]">Bluetooth, около минуты</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#131A2A] border border-white/5 space-y-1">
                <span className="w-5 h-5 rounded-full bg-[#1A2236] text-[#A3ACC2] flex items-center justify-center text-[10px] font-bold">
                  2
                </span>
                <div className="text-xs font-semibold text-[#EEF1F8]">Калибровка</div>
                <div className="text-[11px] text-[#6E7891]">30 секунд в покое</div>
              </div>

              <div className="p-3.5 rounded-2xl bg-[#131A2A] border border-white/5 space-y-1">
                <span className="w-5 h-5 rounded-full bg-[#1A2236] text-[#A3ACC2] flex items-center justify-center text-[10px] font-bold">
                  3
                </span>
                <div className="text-xs font-semibold text-[#EEF1F8]">Работайте как обычно</div>
                <div className="text-[11px] text-[#6E7891]">подсказки — поверх любых окон</div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <button
                  onClick={() => {
                    updateSettings({ deviceSource: 'bluetooth' });
                    setOnboardingStep('connect');
                  }}
                  className="flex items-center gap-2 px-6 py-3 rounded-xl bg-[#FF7A2F] hover:bg-[#ff8944] text-white text-sm font-semibold shadow-[0_4px_16px_rgba(255,122,47,0.35)] transition-all cursor-pointer"
                >
                  <Bluetooth className="w-4 h-4" />
                  <span>Подключить BrainBit</span>
                </button>
                <button
                  onClick={() => {
                    updateSettings({ deviceSource: 'simulator' });
                    setOnboardingStep('connect');
                  }}
                  className="flex items-center gap-2 px-5 py-3 rounded-xl bg-[#131A2A] hover:bg-[#1A2236] border border-white/10 text-sm font-semibold text-[#EEF1F8] transition-colors cursor-pointer"
                >
                  <Play className="w-4 h-4" />
                  <span>Демо без обруча</span>
                </button>
              </div>
              <p className="text-[11px] text-[#6E7891]">
                Демо-режим использует синтетический сигнал — удобно, чтобы посмотреть, как всё
                работает.
              </p>
            </div>
          </div>

          {/* Right Column: Hero Photo */}
          <div className="md:col-span-5 flex flex-col items-center">
            <div className="relative rounded-[24px] overflow-hidden border border-white/10 bg-[#131A2A] shadow-2xl max-w-sm">
              <img
                src={headbandHero}
                alt="BrainBit Headband"
                className="w-full h-auto object-cover"
              />
            </div>
            <span className="text-xs text-[#6E7891] mt-3 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5" />
              Нейрообруч BrainBit · 4 сухих электрода
            </span>
          </div>
        </div>
      )}

      {/* STEP 2: 02 Подключение обруча */}
      {onboardingStep === 'connect' && (
        <div className="w-full max-w-xl p-8 rounded-[24px] bg-[#131A2A] border border-white/5 shadow-2xl space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-2xl font-bold text-[#EEF1F8]">Найдите свой обруч</h2>
              <p className="text-xs text-[#A3ACC2] mt-1">
                Включите BrainBit: зажмите кнопку на 2 секунды — индикатор начнёт мигать.
              </p>
            </div>
            <button
              onClick={() => void handleStartSearching()}
              disabled={isSearching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1A2236] hover:bg-white/10 text-xs font-semibold text-[#EEF1F8] border border-white/5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCw className={`w-3.5 h-3.5 ${isSearching ? 'animate-spin' : ''}`} />
              <span>Искать снова</span>
            </button>
          </div>

          {/* Search indicator / Status */}
          {isSimulator ? (
            <div className="p-4 rounded-xl bg-[#FF7A2F]/10 border border-[#FF7A2F]/30 text-xs text-[#EEF1F8] space-y-1">
              <div className="font-semibold text-[#FF7A2F]">Выбран демо-режим (симулятор 250 Гц)</div>
              <p className="text-[#A3ACC2]">
                Можно сразу перейти к проверке виртуальных датчиков или переключиться на поиск
                физического обруча BrainBit по BLE.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 text-xs text-[#38BDF8]">
                {isSearching && <span className="w-2 h-2 rounded-full bg-[#38BDF8] animate-ping" />}
                <span>
                  {isSearching
                    ? 'Идёт поиск устройств BrainBit поблизости...'
                    : discoveredDevices.length > 0
                      ? `Найдено устройств: ${discoveredDevices.length}`
                      : 'Устройства BrainBit BLE не найдены'}
                </span>
              </div>

              {discoveredDevices.length > 0 ? (
                <div className="space-y-3">
                  {discoveredDevices.map((dev) => {
                    const isSelected = selectedAddress === dev.address;
                    return (
                      <div
                        key={dev.address}
                        onClick={() => setSelectedAddress(dev.address)}
                        className={`p-4 rounded-xl flex items-center justify-between transition-all cursor-pointer ${
                          isSelected
                            ? 'bg-[#1A2236] border-2 border-[#FF7A2F] shadow-sm'
                            : 'bg-[#1A2236] border border-white/5 hover:border-white/20'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-lg bg-[#131A2A] flex items-center justify-center text-[#FF7A2F]">
                            <Bluetooth className="w-4 h-4" />
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-[#EEF1F8]">{dev.name}</div>
                            <div className="text-xs text-[#6E7891] font-mono">
                              {dev.address}
                              {dev.rssi !== undefined ? ` · RSSI ${dev.rssi} dBm` : ''}
                            </div>
                          </div>
                        </div>
                        <span
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'border-[#FF7A2F] bg-[#FF7A2F]' : 'border-white/20'
                          }`}
                        >
                          {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-[#1A2236] border border-white/10 text-xs text-[#A3ACC2] leading-relaxed">
                  {scanMessage ||
                    'Физический BrainBit не обнаружен или адаптер NeuroSDK2 не подключён в этой сборке.'}
                </div>
              )}
            </>
          )}

          {/* Action Row */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setOnboardingStep('welcome')}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1A2236] hover:bg-white/10 text-xs font-semibold text-[#EEF1F8] border border-white/10 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Назад</span>
            </button>
            <button
              disabled={!isSimulator && !deviceStatus.connected && !selectedAddress}
              onClick={() => setOnboardingStep('sensors')}
              className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-[#FF7A2F] hover:bg-[#ff8944] text-white text-xs font-semibold shadow-[0_4px_16px_rgba(255,122,47,0.35)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>{isSimulator ? 'Продолжить в демо-режиме' : 'Подключить'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="text-center">
            <span className="text-xs text-[#6E7891]">Нет обруча под рукой? </span>
            <button
              onClick={() => {
                updateSettings({ deviceSource: 'simulator' });
                setOnboardingStep('sensors');
              }}
              className="text-xs text-[#FF7A2F] hover:underline font-medium cursor-pointer"
            >
              Запустить демо-режим
            </button>
          </div>
        </div>
      )}

      {/* STEP 3: 03 Проверка датчиков */}
      {onboardingStep === 'sensors' && (
        <div className="w-full max-w-3xl p-8 rounded-[24px] bg-[#131A2A] border border-white/5 shadow-2xl space-y-6">
          <div>
            <h2 className="text-2xl font-bold text-[#EEF1F8]">Проверим контакт датчиков</h2>
            <p className="text-xs text-[#A3ACC2] mt-1">
              Датчики должны плотно касаться кожи. Если какой-то горит жёлтым — поправьте обруч и
              уберите волосы из-под электрода.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
            {/* Left Column: Head Map Schematic */}
            <div className="md:col-span-5 p-4 rounded-2xl bg-[#0B0F1A] border border-white/5 flex flex-col items-center justify-center">
              <svg className="w-48 h-48" viewBox="0 0 200 200">
                {/* Head circle */}
                <ellipse
                  cx="100"
                  cy="105"
                  rx="75"
                  ry="85"
                  fill="#131A2A"
                  stroke="#1A2236"
                  strokeWidth="2"
                />
                {/* Nose */}
                <path d="M 90 22 Q 100 12 110 22" fill="none" stroke="#1A2236" strokeWidth="2" />
                <text x="100" y="65" textAnchor="middle" fill="#6E7891" fontSize="11">
                  лоб
                </text>
                <text x="100" y="105" textAnchor="middle" fill="#6E7891" fontSize="10">
                  вид сверху
                </text>

                {/* Headband arc */}
                <path
                  d="M 38 100 Q 100 150 162 100"
                  fill="none"
                  stroke="#FF7A2F"
                  strokeWidth="4"
                  opacity="0.8"
                />

                {/* Electrodes dots */}
                {/* T3 */}
                <circle cx="38" cy="98" r="9" fill={isStreamReady && quality.t3 ? '#34D399' : '#F87171'} />
                <text x="38" y="101" textAnchor="middle" fill="#0B0F1A" fontSize="9" fontWeight="bold">
                  T3
                </text>

                {/* T4 */}
                <circle cx="162" cy="98" r="9" fill={isStreamReady && quality.t4 ? '#34D399' : '#F87171'} />
                <text x="162" y="101" textAnchor="middle" fill="#0B0F1A" fontSize="9" fontWeight="bold">
                  T4
                </text>

                {/* O1 */}
                <circle cx="75" cy="142" r="9" fill={isStreamReady && quality.o1 ? '#34D399' : '#F87171'} />
                <text x="75" y="145" textAnchor="middle" fill="#0B0F1A" fontSize="9" fontWeight="bold">
                  O1
                </text>

                {/* O2 */}
                <circle cx="125" cy="142" r="9" fill={isStreamReady && quality.o2 ? '#34D399' : '#F87171'} />
                <text x="125" y="145" textAnchor="middle" fill="#0B0F1A" fontSize="9" fontWeight="bold">
                  O2
                </text>
              </svg>

              {/* Legend */}
              <div className="flex items-center gap-4 text-[11px] text-[#6E7891] mt-2">
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#34D399]" />
                  хорошо
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#FBBF24]" />
                  слабо
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#F87171]" />
                  нет контакта
                </span>
              </div>
            </div>

            {/* Right Column: Sensor list */}
            <div className="md:col-span-7 space-y-2.5">
              {sensorRows.map((s) => (
                <div
                  key={s.id}
                  className="p-3 rounded-xl bg-[#1A2236] border border-white/5 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <span
                      className={`px-2 py-1 rounded font-mono text-xs font-bold ${
                        s.ok
                          ? 'bg-[#34D399]/15 text-[#34D399]'
                          : 'bg-[#F87171]/15 text-[#F87171]'
                      }`}
                    >
                      {s.id}
                    </span>
                    <div>
                      <div className="text-xs font-semibold text-[#EEF1F8]">{s.name}</div>
                      <div className="text-[11px] text-[#6E7891]">сопротивление {s.val}</div>
                    </div>
                  </div>
                  <span
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${
                      s.ok
                        ? 'bg-[#34D399]/10 text-[#34D399]'
                        : 'bg-[#F87171]/10 text-[#F87171]'
                    }`}
                  >
                    {s.ok && <Check className="w-3 h-3 stroke-[3]" />}
                    {s.ok ? 'Хороший контакт' : 'Нет контакта'}
                  </span>
                </div>
              ))}

              {/* Confirmation Banner */}
              <div
                className={`p-3 rounded-xl border flex items-center gap-2 text-xs font-medium ${
                  allContactOk
                    ? 'bg-[#34D399]/10 border-[#34D399]/20 text-[#34D399]'
                    : 'bg-[#F87171]/10 border-[#F87171]/25 text-[#FCA5A5]'
                }`}
              >
                {allContactOk && <Check className="w-4 h-4 stroke-[3]" />}
                <span>
                  {allContactOk
                    ? 'Все 4 датчика на месте. Можно переходить к калибровке.'
                    : isStreamReady
                      ? 'Проверьте прилегание электродов — контакт должен быть на всех 4 каналах.'
                      : 'Поток BrainBit не активен. Вернитесь и подключите обруч или выберите демо-режим.'}
                </span>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={() => setOnboardingStep('connect')}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1A2236] hover:bg-white/10 text-xs font-semibold text-[#EEF1F8] border border-white/10 transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Назад</span>
            </button>
            <button
              disabled={!allContactOk}
              onClick={handleEnterCalibration}
              className="flex items-center gap-1.5 px-6 py-2.5 rounded-xl bg-[#FF7A2F] hover:bg-[#ff8944] text-white text-xs font-semibold shadow-[0_4px_16px_rgba(255,122,47,0.35)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <span>Далее: калибровка</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* STEP 4: 04 Калибровка */}
      {onboardingStep === 'calibrating' && (
        <div className="w-full max-w-2xl p-8 rounded-[24px] bg-[#131A2A] border border-white/5 shadow-2xl space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
            {/* Left Column: Countdown Circle */}
            <div className="md:col-span-5 flex flex-col items-center justify-center">
              <div className="relative w-44 h-44 flex items-center justify-center">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 160 160">
                  <circle
                    cx="80"
                    cy="80"
                    r="64"
                    className="stroke-[#1A2236]"
                    strokeWidth="8"
                    fill="transparent"
                  />
                  <circle
                    cx="80"
                    cy="80"
                    r="64"
                    className="stroke-[#38BDF8]"
                    strokeWidth="8"
                    strokeDasharray={2 * Math.PI * 64}
                    strokeDashoffset={
                      2 * Math.PI * 64 - (calibrationProgress / 100) * (2 * Math.PI * 64)
                    }
                    strokeLinecap="round"
                    fill="transparent"
                    style={{ transition: 'stroke-dashoffset 200ms linear' }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className="text-4xl font-bold text-[#EEF1F8] font-mono">
                    {calibrationRemainingSeconds > 0 ? calibrationRemainingSeconds : 0}
                    <span className="text-base text-[#A3ACC2]"> сек</span>
                  </span>
                  <span className="text-xs text-[#6E7891] mt-0.5">осталось</span>
                </div>
              </div>
            </div>

            {/* Right Column: Guidance */}
            <div className="md:col-span-7 space-y-4">
              <div>
                <span className="text-[11px] font-bold text-[#FF7A2F] uppercase tracking-wider">
                  КАЛИБРОВКА · 30 СЕКУНД
                </span>
                <h2 className="text-xl font-bold text-[#EEF1F8] mt-1">
                  Запоминаем вашу личную норму
                </h2>
                <p className="text-xs text-[#A3ACC2] mt-1">
                  У каждого свой уровень ритмов мозга. Калибровка нужна, чтобы подсказки срабатывали
                  по вашей норме, а не по средним значениям.
                </p>
              </div>

              {/* Instructions list */}
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-[#1A2236] border border-white/5 flex items-center gap-3 text-xs text-[#EEF1F8]">
                  <User className="w-4 h-4 text-[#38BDF8] shrink-0" />
                  <span>Сядьте удобно и расслабьте плечи</span>
                </div>
                <div className="p-3 rounded-xl bg-[#1A2236] border border-white/5 flex items-center gap-3 text-xs text-[#EEF1F8]">
                  <Eye className="w-4 h-4 text-[#38BDF8] shrink-0" />
                  <span>Смотрите в центр экрана, старайтесь не моргать часто</span>
                </div>
                <div className="p-3 rounded-xl bg-[#1A2236] border border-white/5 flex items-center gap-3 text-xs text-[#EEF1F8]">
                  <VolumeX className="w-4 h-4 text-[#38BDF8] shrink-0" />
                  <span>Не разговаривайте и не двигайтесь</span>
                </div>
              </div>

              {/* Live Signal Quality */}
              {!isStreamReady ? (
                <div className="p-3 rounded-xl bg-[#F87171]/10 border border-[#F87171]/25 text-xs text-[#FCA5A5] space-y-2">
                  <div>Поток ЭЭГ не активен — подключите BrainBit или включите демо-режим.</div>
                  <button
                    onClick={() => {
                      updateSettings({ deviceSource: 'simulator' });
                      startCalibration(30);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-[#FF7A2F] text-white font-semibold cursor-pointer"
                  >
                    Включить демо-режим и начать калибровку
                  </button>
                </div>
              ) : (
                <div
                  className={`flex items-center gap-2 text-xs font-medium ${
                    !feedbackState.isContactOk
                      ? 'text-[#F87171]'
                      : telemetry?.isArtifact
                        ? 'text-[#FBBF24]'
                        : 'text-[#34D399]'
                  }`}
                >
                  <Check className="w-3.5 h-3.5 stroke-[3]" />
                  <span>
                    {!feedbackState.isContactOk
                      ? 'Потерян контакт одного из электродов — запись приостановлена'
                      : telemetry?.isArtifact
                        ? 'Обнаружен артефакт (моргание/ЭМГ) — кадры отфильтровываются'
                        : 'Качество сигнала: хорошее · артефактов нет'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-2 border-t border-white/5">
            <button
              onClick={() => {
                cancelCalibration();
                setOnboardingStep('sensors');
              }}
              className="px-4 py-2.5 rounded-xl bg-[#1A2236] hover:bg-white/10 text-xs font-semibold text-[#EEF1F8] border border-white/10 transition-colors cursor-pointer"
            >
              Отменить
            </button>
            <span className="px-3 py-1.5 rounded-lg bg-[#1A2236] text-xs text-[#A3ACC2] font-mono">
              ⏱ Длительность: 30 сек
            </span>
          </div>
        </div>
      )}

      {/* STEP 5: 05 Калибровка завершена */}
      {onboardingStep === 'done' && (
        <div className="w-full max-w-2xl p-8 rounded-[24px] bg-[#131A2A] border border-white/5 shadow-2xl space-y-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#34D399]/20 text-[#34D399] flex items-center justify-center shrink-0">
              <Check className="w-5 h-5 stroke-[3]" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-[#EEF1F8]">Калибровка завершена</h2>
              <p className="text-xs text-[#A3ACC2] mt-0.5">
                Ваша норма сохранена. Порог подобран автоматически — его всегда можно изменить.
              </p>
            </div>
          </div>

          {/* 3 Metric Result Cards */}
          <div className="grid grid-cols-3 gap-3.5">
            {/* Focus */}
            <div className="p-4 rounded-2xl bg-[#1A2236] border border-white/5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[#A3ACC2]">
                <Flame className="w-3.5 h-3.5 text-[#FF7A2F]" />
                <span>Ваш фокус</span>
              </div>
              <div className="text-3xl font-extrabold text-[#FF7A2F] font-mono">
                {calibrationResult ? Math.round(calibrationResult.baselineFocus) : 64}%
              </div>
              <div className="text-[11px] text-[#6E7891]">средний уровень в покое</div>
            </div>

            {/* Calm */}
            <div className="p-4 rounded-2xl bg-[#1A2236] border border-white/5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[#A3ACC2]">
                <Leaf className="w-3.5 h-3.5 text-[#9B8CFF]" />
                <span>Спокойствие</span>
              </div>
              <div className="text-3xl font-extrabold text-[#9B8CFF] font-mono">
                {calibrationResult ? Math.round(calibrationResult.baselineRelaxation) : 58}%
              </div>
              <div className="text-[11px] text-[#6E7891]">средний уровень в покое</div>
            </div>

            {/* Threshold */}
            <div className="p-4 rounded-2xl bg-[#1A2236] border border-white/5 space-y-1">
              <div className="flex items-center gap-1.5 text-xs text-[#A3ACC2]">
                <Zap className="w-3.5 h-3.5 text-[#EEF1F8]" />
                <span>Рекомендуемый порог</span>
              </div>
              <div className="text-3xl font-extrabold text-[#EEF1F8] font-mono">
                {calibrationResult ? Math.round(calibrationResult.recommendedThreshold) : 55}%
              </div>
              <div className="text-[11px] text-[#6E7891]">ниже порога экран тускнеет</div>
            </div>
          </div>

          {/* Info Callout */}
          <div className="p-4 rounded-xl bg-[#1A2236] border border-white/5 flex items-start gap-3 text-xs text-[#A3ACC2] leading-relaxed">
            <Info className="w-4 h-4 text-[#38BDF8] shrink-0 mt-0.5" />
            <span>
              Как это работает: пока показатель выше порога — экран чистый. Если опускается ниже —
              экран плавно затемняется. Когда внимание возвращается, затемнение исчезает само.
            </span>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={handleEnterCalibration}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1A2236] hover:bg-white/10 text-xs font-semibold text-[#EEF1F8] border border-white/10 transition-colors cursor-pointer"
            >
              <RotateCw className="w-3.5 h-3.5" />
              <span>Повторить калибровку</span>
            </button>
            <button
              onClick={handleFinishCalibrationAndStartSession}
              className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-[#FF7A2F] hover:bg-[#ff8944] text-white text-xs font-semibold shadow-[0_4px_16px_rgba(255,122,47,0.35)] transition-all cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              <span>Начать сессию</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
