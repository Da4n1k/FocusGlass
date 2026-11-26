import React, { useState } from 'react';
import { Check, Volume2, Keyboard } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { DEFAULT_SETTINGS } from '../../services/biofeedbackEngine';

function SunModeIcon({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M14.667 11C14.667 13.025 13.025 14.667 11 14.667C8.975 14.667 7.333 13.025 7.333 11C7.333 8.975 8.975 7.333 11 7.333C13.025 7.333 14.667 8.975 14.667 11Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M11 1.833V3.667M11 18.333V20.167M4.492 4.492L5.775 5.775M16.225 16.225L17.508 17.508M1.833 11H3.667M18.333 11H20.167M4.492 17.508L5.775 16.225M16.225 5.775L17.508 4.492"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BlurModeIcon({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M19.25 11C19.25 15.556 15.556 19.25 11 19.25C6.444 19.25 2.75 15.556 2.75 11C2.75 6.444 6.444 2.75 11 2.75C15.556 2.75 19.25 6.444 19.25 11Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M15.496 10.106C15.554 10.395 15.584 10.694 15.584 11C15.584 11.306 15.554 11.605 15.496 11.895M14.812 8.454C14.477 7.954 14.047 7.523 13.547 7.189M11.895 6.504C11.606 6.447 11.306 6.417 11 6.417C10.694 6.417 10.395 6.447 10.106 6.504M8.454 7.189C7.954 7.523 7.524 7.954 7.189 8.454M6.504 10.106C6.447 10.395 6.417 10.694 6.417 11C6.417 11.306 6.447 11.605 6.504 11.895M7.189 13.547C7.524 14.046 7.954 14.477 8.454 14.811M10.106 15.496C10.395 15.553 10.694 15.583 11 15.583C11.306 15.583 11.606 15.553 11.895 15.496M13.547 14.811C14.047 14.477 14.477 14.046 14.812 13.547"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DistractingWindowModeIcon({ className }: { className?: string }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 22 22"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M4.583 3.667H17.417C18.429 3.667 19.25 4.488 19.25 5.5V16.5C19.25 17.513 18.429 18.333 17.417 18.333H4.583C3.571 18.333 2.75 17.513 2.75 16.5V5.5C2.75 4.488 3.571 3.667 4.583 3.667Z"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M2.75 8.25H19.25"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6.417 5.958H6.426M9.167 5.958H9.176"
        stroke="currentColor"
        strokeWidth="1.65"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FigmaToggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={onChange}
      className={`w-[46px] h-[26px] rounded-full transition-colors relative shrink-0 cursor-pointer ${
        checked ? 'bg-[#FF7A2F]' : 'bg-[#2A3350]'
      }`}
    >
      <span
        className={`block w-[20px] h-[20px] rounded-full transition-all duration-200 absolute top-[3px] ${
          checked
            ? 'left-[23px] bg-white shadow-sm'
            : 'left-[3px] bg-[#C9D1E3]'
        }`}
      />
    </button>
  );
}

function sliderBackground(value: number, min: number, max: number): string {
  const ratio = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return `linear-gradient(to right, #FF7A2F 0%, #FF7A2F ${ratio}%, #232C42 ${ratio}%, #232C42 100%)`;
}

export const SettingsScreen: React.FC = () => {
  const {
    settings,
    updateSettings,
    settingsSubTab,
    setSettingsSubTab,
    feedbackStyle,
    setFeedbackStyle,
    isClickThrough,
    setClickThrough,
  } = useFocusStore();

  const [savedToast, setSavedToast] = useState(false);
  const [dimOnlyTextApps, setDimOnlyTextApps] = useState(true);

  const handleSave = () => {
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 2000);
  };

  const handleReset = () => {
    updateSettings({ ...DEFAULT_SETTINGS });
    setFeedbackStyle('dimming');
    void setClickThrough(true);
  };

  const tabs = [
    { id: 'feedback' as const, label: 'Подсказки' },
    { id: 'sensitivity' as const, label: 'Чувствительность' },
    { id: 'sound' as const, label: 'Звук' },
    { id: 'hotkeys' as const, label: 'Горячие клавиши' },
  ];

  const feedbackModes = [
    {
      id: 'dimming' as const,
      title: 'Плавное затемнение',
      desc: 'Экран тускнеет постепенно вместе с падением фокуса',
      Icon: SunModeIcon,
      color: '#FF7A2F',
      activeBg: 'rgba(255, 122, 47, 0.08)',
    },
    {
      id: 'blur' as const,
      title: 'Размытие',
      desc: 'Ниже порога изображение размывается — заметнее',
      Icon: BlurModeIcon,
      color: '#38BDF8',
      activeBg: 'rgba(56, 189, 248, 0.08)',
    },
    {
      id: 'distracting_only' as const,
      title: 'Только отвлекающие окна',
      desc: 'Тускнеют соцсети и мессенджеры, рабочее окно остаётся чётким',
      Icon: DistractingWindowModeIcon,
      color: '#9B8CFF',
      activeBg: 'rgba(155, 140, 255, 0.08)',
    },
  ];

  const dimPct = Math.round(settings.dimmingMaxOpacity * 100);
  const sensitivityVal = Math.max(1, Math.min(10, Math.round(settings.sensitivitySeconds)));
  const thresholdVal = Math.max(30, Math.min(90, Math.round(settings.threshold)));
  const glassOpacityPct = Math.round(settings.glassOpacity * 100);
  const blurRadiusVal = Math.max(4, Math.min(32, Math.round(settings.blurRadius)));

  return (
    <div className="w-full min-h-full flex flex-col justify-between pt-7 px-8 pb-6 animate-in fade-in duration-200">
      <div className="w-full">
        {/* Header */}
        <div>
          <h1 className="text-[28px] leading-[1.15] font-bold tracking-tight text-[#EEF1F8]">
            Настройки
          </h1>
          <p className="text-[15px] text-[#A3ACC2] mt-1.5">
            Настройте, как FocusGlass будет подсказывать.
          </p>
        </div>

        {/* Sub-tabs */}
        <div className="flex items-center gap-2 mt-5 border-b border-white/[0.07]">
          {tabs.map((tab) => {
            const isActive = settingsSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSettingsSubTab(tab.id)}
                className={`px-4 pb-3 pt-1 text-[15px] font-semibold transition-colors relative cursor-pointer ${
                  isActive ? 'text-[#EEF1F8]' : 'text-[#A3ACC2] hover:text-[#EEF1F8]'
                }`}
              >
                <span>{tab.label}</span>
                {isActive && (
                  <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-[#FF7A2F]" />
                )}
              </button>
            );
          })}
        </div>

        {/* Tab content */}
        {settingsSubTab === 'feedback' && (
          <div className="mt-6 space-y-[18px]">
            {/* Visual Mode Cards (separate from settings controls container) */}
            <div>
              <h2 className="text-[16px] font-semibold text-[#EEF1F8] mb-3.5">
                Как показывать снижение фокуса
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
                {feedbackModes.map((mode) => {
                  const Icon = mode.Icon;
                  const isActive = feedbackStyle === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => setFeedbackStyle(mode.id)}
                      style={{
                        backgroundColor: isActive ? mode.activeBg : '#131A2A',
                        borderColor: isActive ? mode.color : 'rgba(255, 255, 255, 0.07)',
                      }}
                      className="min-h-[130px] p-5 rounded-[18px] border text-left transition-all relative cursor-pointer hover:border-white/[0.16] flex flex-col"
                    >
                      <div className="flex items-start justify-between">
                        <span
                          style={{ color: isActive ? mode.color : '#EEF1F8' }}
                          className="transition-colors"
                        >
                          <Icon />
                        </span>

                        {isActive && (
                          <span
                            className="w-[22px] h-[22px] rounded-full flex items-center justify-center shrink-0"
                            style={{ backgroundColor: mode.color }}
                          >
                            <Check className="w-3.5 h-3.5 text-[#0B0F1A]" strokeWidth={2.5} />
                          </span>
                        )}
                      </div>

                      <div className="mt-3.5">
                        <div className="text-[15px] font-semibold text-[#EEF1F8]">
                          {mode.title}
                        </div>
                        <p className="text-[13px] text-[#A3ACC2] mt-1 leading-[1.45]">
                          {mode.desc}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Separate Settings Container */}
            <div className="rounded-[20px] bg-[#131A2A] border border-white/[0.06] divide-y divide-white/[0.05] px-6">
              {/* Max Dimming */}
              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Максимальное затемнение
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    насколько сильно темнеет экран при сильном падении фокуса
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <input
                    type="range"
                    min={10}
                    max={95}
                    value={dimPct}
                    onChange={(e) =>
                      updateSettings({ dimmingMaxOpacity: Number(e.target.value) / 100 })
                    }
                    aria-label="Максимальное затемнение"
                    className="figma-slider w-[200px]"
                    style={{ background: sliderBackground(dimPct, 10, 95) }}
                  />
                  <span className="text-[15px] font-bold text-[#EEF1F8] tabular-nums w-12 text-right">
                    {dimPct}%
                  </span>
                </div>
              </div>

              {/* Reaction Speed */}
              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Скорость реакции
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    сглаживание сигнала: больше — реже ложные срабатывания
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={sensitivityVal}
                    onChange={(e) =>
                      updateSettings({ sensitivitySeconds: Number(e.target.value) })
                    }
                    aria-label="Скорость реакции"
                    className="figma-slider w-[200px]"
                    style={{ background: sliderBackground(sensitivityVal, 1, 10) }}
                  />
                  <span className="text-[15px] font-bold text-[#EEF1F8] tabular-nums w-12 text-right">
                    {sensitivityVal} сек
                  </span>
                </div>
              </div>

              {/* Click-through */}
              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Клики проходят сквозь затемнение
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    можно продолжать работать, не снимая подсказку
                  </div>
                </div>
                <FigmaToggle
                  checked={isClickThrough}
                  onChange={() => void setClickThrough(!isClickThrough)}
                  ariaLabel="Клики проходят сквозь затемнение"
                />
              </div>

              {/* Audio Feedback */}
              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Звуковая подсказка
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    мягкий природный шум усиливается при падении фокуса
                  </div>
                </div>
                <FigmaToggle
                  checked={settings.audioFeedbackEnabled}
                  onChange={() =>
                    updateSettings({ audioFeedbackEnabled: !settings.audioFeedbackEnabled })
                  }
                  ariaLabel="Звуковая подсказка"
                />
              </div>
            </div>
          </div>
        )}

        {settingsSubTab === 'sensitivity' && (
          <div className="mt-6">
            <h2 className="text-[16px] font-semibold text-[#EEF1F8] mb-3.5">
              Пороги и обработка ЭЭГ-сигнала
            </h2>
            <div className="rounded-[20px] bg-[#131A2A] border border-white/[0.06] divide-y divide-white/[0.05] px-6">
              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Базовый порог концентрации
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    ниже этого значения включается визуальная обратная связь
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <input
                    type="range"
                    min={30}
                    max={90}
                    value={thresholdVal}
                    onChange={(e) => updateSettings({ threshold: Number(e.target.value) })}
                    aria-label="Базовый порог концентрации"
                    className="figma-slider w-[200px]"
                    style={{ background: sliderBackground(thresholdVal, 30, 90) }}
                  />
                  <span className="text-[15px] font-bold text-[#EEF1F8] tabular-nums w-12 text-right">
                    {thresholdVal}%
                  </span>
                </div>
              </div>

              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Интенсивность размытия
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    сила эффекта blur в режиме «Размытие»
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <input
                    type="range"
                    min={4}
                    max={32}
                    step={2}
                    value={blurRadiusVal}
                    onChange={(e) => updateSettings({ blurRadius: Number(e.target.value) })}
                    aria-label="Интенсивность размытия"
                    className="figma-slider w-[200px]"
                    style={{ background: sliderBackground(blurRadiusVal, 4, 32) }}
                  />
                  <span className="text-[15px] font-bold text-[#EEF1F8] tabular-nums w-12 text-right">
                    {blurRadiusVal} px
                  </span>
                </div>
              </div>

              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Фильтр артефактов (моргание и мимика)
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    замораживать адаптацию при мышечных импульсах EMG / EOG
                  </div>
                </div>
                <FigmaToggle
                  checked={dimOnlyTextApps}
                  onChange={() => setDimOnlyTextApps(!dimOnlyTextApps)}
                  ariaLabel="Фильтр артефактов"
                />
              </div>

              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Прозрачность стеклянных карточек
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    насыщенность эффекта Liquid Glass для плавающих панелей
                  </div>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <input
                    type="range"
                    min={50}
                    max={100}
                    value={glassOpacityPct}
                    onChange={(e) =>
                      updateSettings({ glassOpacity: Number(e.target.value) / 100 })
                    }
                    aria-label="Прозрачность стеклянных карточек"
                    className="figma-slider w-[200px]"
                    style={{ background: sliderBackground(glassOpacityPct, 50, 100) }}
                  />
                  <span className="text-[15px] font-bold text-[#EEF1F8] tabular-nums w-12 text-right">
                    {glassOpacityPct}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {settingsSubTab === 'sound' && (
          <div className="mt-6">
            <h2 className="text-[16px] font-semibold text-[#EEF1F8] mb-3.5">
              Аудиообратная связь (Бинауральное сопровождение)
            </h2>
            <div className="rounded-[20px] bg-[#131A2A] border border-white/[0.06] divide-y divide-white/[0.05] px-6">
              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="flex items-center gap-3.5 min-w-0">
                  <Volume2 className="w-5 h-5 text-[#FF7A2F] shrink-0" />
                  <div>
                    <div className="text-[15px] font-semibold text-[#EEF1F8]">
                      Розовый шум / Фоновая атмосфера
                    </div>
                    <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                      плавное нарастание мягкого звука при снижении концентрации
                    </div>
                  </div>
                </div>
                <FigmaToggle
                  checked={settings.audioFeedbackEnabled}
                  onChange={() =>
                    updateSettings({ audioFeedbackEnabled: !settings.audioFeedbackEnabled })
                  }
                  ariaLabel="Включить звуковую подсказку"
                />
              </div>

              <div className="min-h-[68px] py-3.5 flex items-center justify-between gap-6">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-[#EEF1F8]">
                    Профиль целевого ритма
                  </div>
                  <div className="text-[13px] text-[#A3ACC2] mt-0.5">
                    частотная характеристика зависит от активного режима сессии
                  </div>
                </div>
                <span className="px-3 py-1 rounded-lg bg-[#0B0F1A] border border-white/[0.07] text-[13px] font-medium text-[#EEF1F8]">
                  {settings.mode === 'concentration'
                    ? 'Focus (Beta 14–30 Гц)'
                    : 'Calm (Alpha 8–13 Гц)'}
                </span>
              </div>
            </div>
          </div>
        )}

        {settingsSubTab === 'hotkeys' && (
          <div className="mt-6">
            <h2 className="text-[16px] font-semibold text-[#EEF1F8] mb-3.5">
              Горячие клавиши и управление симуляцией
            </h2>
            <div className="rounded-[20px] bg-[#131A2A] border border-white/[0.06] divide-y divide-white/[0.05] px-6">
              {[
                { key: 'Ctrl + Shift + G', label: 'Переключить режим Windowed / Мини-виджет' },
                { key: 'Ctrl + Shift + D', label: 'Показать / скрыть панель диагностики (Debug Drawer)' },
                { key: '1', label: 'Пресет: Глубокий фокус (симулятор)' },
                { key: '2', label: 'Пресет: Рассеивание внимания' },
                { key: '3', label: 'Пресет: Релаксация (Alpha пик)' },
                { key: '4', label: 'Инъекция артефакта (моргание / EMG)' },
              ].map((hk) => (
                <div key={hk.key} className="min-h-[58px] py-3 flex items-center justify-between gap-6">
                  <div className="flex items-center gap-3 min-w-0">
                    <Keyboard className="w-4 h-4 text-[#FF7A2F] shrink-0" />
                    <span className="text-[14px] text-[#EEF1F8]">{hk.label}</span>
                  </div>
                  <kbd className="px-2.5 py-1 rounded-lg bg-[#0B0F1A] border border-white/10 text-xs font-mono text-[#A3ACC2] shrink-0">
                    {hk.key}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Actions Bar separated by translucent border */}
      <div className="w-full flex items-center justify-between pt-4 mt-6 border-t border-white/[0.06]">
        <button
          type="button"
          onClick={handleReset}
          className="h-[44px] px-7 rounded-[12px] bg-transparent hover:bg-white/[0.04] border border-white/[0.12] text-[15px] font-semibold text-[#C9D1E3] transition-colors cursor-pointer"
        >
          Сбросить по умолчанию
        </button>

        <button
          type="button"
          onClick={handleSave}
          className="h-[44px] px-6 rounded-[12px] bg-[#FF7A2F] hover:bg-[#FF8B47] text-[#1A0E06] text-[15px] font-semibold flex items-center gap-2 transition-colors cursor-pointer"
        >
          <Check className="w-4 h-4 text-[#1A0E06]" strokeWidth={2.2} />
          <span>{savedToast ? 'Сохранено' : 'Сохранить'}</span>
        </button>
      </div>
    </div>
  );
};
