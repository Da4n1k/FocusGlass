import React, { useCallback, useEffect, useState } from 'react';
import {
  Target,
  Wind,
  Volume2,
  VolumeX,
  ShieldBan,
  SunDim,
  ScanEye,
  PauseCircle,
  RefreshCw,
  Check,
  Plus,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { tauriBridge } from '../../services/tauriBridge';
import type { LinuxBlurStatus, OverlayVisualMode, RunningWindowInfo } from '../../services/eegTypes';
import { DENSE_BLUR_MIN_PX, THRESHOLD_BLUR_ON_DEFICIT } from '../../services/overlayVisualPolicy';
import { GlassSlider } from '../glass/GlassSlider';
import { GlassButton } from '../glass/GlassButton';
import { LinuxBlurStatusPanel } from './LinuxBlurStatusPanel';

const FULLSCREEN_CONCEPTS: ReadonlyArray<{
  id: Exclude<OverlayVisualMode, 'distractors'>;
  title: string;
  badge: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    id: 'fullscreen_dim',
    title: 'Плавное затемнение',
    badge: 'База по ТЗ',
    description:
      'Экран плавно притухает как снижение яркости (0 px блюра). Текст всегда чёткий — глаза не напрягаются.',
    icon: <SunDim className="w-4 h-4 text-[#FF6600]" />,
  },
  {
    id: 'vignette_blur',
    title: 'Виньетка по краям',
    badge: 'Чёткий центр',
    description:
      'Рабочая область в центре остаётся на 100% резкой; затемняются и мягко размываются только края экрана.',
    icon: <ScanEye className="w-4 h-4 text-[#00D2FF]" />,
  },
  {
    id: 'threshold_blur',
    title: 'Блюр по порогу + Пауза',
    badge: 'Без «мыла»',
    description: `При лёгком спаде — только мягкое затемнение. Ниже −${Math.round(THRESHOLD_BLUR_ON_DEFICIT * 100)}% дефицита сразу плотный блюр ≥${DENSE_BLUR_MIN_PX} px и плашка «Сделай паузу».`,
    icon: <PauseCircle className="w-4 h-4 text-[#A78BFA]" />,
  },
];

export const BiofeedbackConfig: React.FC = () => {
  const { settings, activeCalibration, updateSettings, isTauri, distractionSupported, foregroundWindow } =
    useFocusStore();

  const [patternDraft, setPatternDraft] = useState(settings.distractorPatterns.join('\n'));
  const [runningWindows, setRunningWindows] = useState<RunningWindowInfo[]>([]);
  const [loadingWindows, setLoadingWindows] = useState(false);
  const [linuxBlurStatus, setLinuxBlurStatus] = useState<LinuxBlurStatus | null>(null);
  const nativeLinuxBlur = linuxBlurStatus?.linux === true;

  useEffect(() => {
    setPatternDraft(settings.distractorPatterns.join('\n'));
  }, [settings.distractorPatterns]);

  const refreshRunningWindows = useCallback(async () => {
    if (!distractionSupported) return;
    setLoadingWindows(true);
    try {
      const list = await tauriBridge.listRunningWindows();
      setRunningWindows(list);
    } finally {
      setLoadingWindows(false);
    }
  }, [distractionSupported]);

  useEffect(() => {
    if (settings.overlayMode === 'distractors' && distractionSupported) {
      void refreshRunningWindows();
    }
  }, [settings.overlayMode, distractionSupported, settings.distractorPatterns, refreshRunningWindows]);

  const commitPatterns = () => {
    const patterns = Array.from(
      new Set(
        patternDraft
          .split('\n')
          .map((p) => p.trim().toLowerCase())
          .filter((p) => p.length > 0)
      )
    );
    if (patterns.join('\n') !== settings.distractorPatterns.join('\n')) {
      updateSettings({ distractorPatterns: patterns });
    }
  };

  const toggleRunningWindowPattern = (win: RunningWindowInfo) => {
    const current = settings.distractorPatterns.map((p) => p.trim().toLowerCase()).filter(Boolean);
    if (win.isDistractor && win.matchedPattern) {
      const next = current.filter((p) => p !== win.matchedPattern);
      updateSettings({ distractorPatterns: next });
      return;
    }
    const candidate = win.suggestedPattern.trim().toLowerCase();
    if (!candidate) return;
    if (!current.includes(candidate)) {
      updateSettings({ distractorPatterns: [...current, candidate] });
    }
  };

  const activeMode = settings.overlayMode;
  const visibleDistractorCount = foregroundWindow?.distractorRegions?.length ?? 0;

  return (
    <div className="space-y-4">
      <LinuxBlurStatusPanel onStatus={setLinuxBlurStatus} />
      {/* Training Mode Selector */}
      <div>
        <label className="text-xs font-semibold text-slate-300 block mb-1.5">
          Режим тренировки и целевой ритм
        </label>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => updateSettings({ mode: 'concentration' })}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              settings.mode === 'concentration'
                ? 'bg-[#FF6600]/20 border-[#FF6600]/50 shadow-[0_0_16px_rgba(255,102,0,0.25)]'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Target className="w-4 h-4 text-[#FF6600]" />
              <span className="text-xs font-bold text-white">Concentration (Focus)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Отслеживает Бета-ритм (14–30 Гц). Реагирует при потере концентрации.
            </p>
          </button>

          <button
            onClick={() => updateSettings({ mode: 'relaxation' })}
            className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
              settings.mode === 'relaxation'
                ? 'bg-[#8B5CF6]/20 border-[#8B5CF6]/50 shadow-[0_0_16px_rgba(139,92,246,0.25)]'
                : 'bg-white/5 border-white/10 hover:border-white/20'
            }`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Wind className="w-4 h-4 text-[#8B5CF6]" />
              <span className="text-xs font-bold text-white">Relaxation (Calm)</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Отслеживает Альфа-ритм (8–13 Гц). Реагирует при росте напряжения и стресса.
            </p>
          </button>
        </div>
      </div>

      {/* Neurotech «Не навреди» Overlay Visual Concept Switcher */}
      <div className="p-3.5 rounded-xl bg-slate-900/55 border border-white/10 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span className="text-xs font-semibold text-white">
              Концепция оверлея (правило «не навреди»)
            </span>
          </div>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300">
            Без «полумыла» на тексте
          </span>
        </div>

        {/* Group 1: Fullscreen concepts (baseline TZ) */}
        <div className="space-y-1.5">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
            Режим 1 — Весь экран (базовый по ТЗ «Нейротех»)
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {FULLSCREEN_CONCEPTS.map((concept) => {
              const selected = activeMode === concept.id;
              return (
                <button
                  key={concept.id}
                  onClick={() => updateSettings({ overlayMode: concept.id })}
                  className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                    selected
                      ? 'bg-[#FF6600]/20 border-[#FF6600]/55 shadow-[0_0_14px_rgba(255,102,0,0.2)]'
                      : 'bg-white/5 border-white/10 hover:border-white/20'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <span className="flex items-center gap-1.5 text-xs font-bold text-white">
                        {concept.icon}
                         {nativeLinuxBlur && concept.id === 'threshold_blur' ? 'Блюр по порогу · Linux' : concept.title}
                      </span>
                    </div>
                    <p className="text-[10px] text-slate-300 leading-relaxed">
                       {nativeLinuxBlur && concept.id === 'threshold_blur'
                         ? linuxBlurStatus?.adjustableRadius
                           ? 'Сквозной GPU-блюр и волна частиц при падении внимания ниже целевого порога. Нативный бэкенд защищает окно приложения, HUD и панели.'
                           : 'Сквозной блюр при падении внимания ниже целевого порога. В резервном Wayland-режиме силу задаёт композитор; защита HUD не гарантируется.'
                         : concept.description}
                    </p>
                  </div>
                  <span className="inline-block self-start text-[9px] px-1.5 py-0.5 rounded bg-black/35 border border-white/10 text-slate-300 font-mono">
                     {nativeLinuxBlur && concept.id === 'threshold_blur' ? 'Нативный Linux' : concept.badge}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Group 2: Smart distractor windows (bonus TZ feature) */}
        <div className="space-y-1.5 pt-1">
          <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold block">
            Режим 2 — Умная блокировка окон-отвлекателей (бонус ТЗ)
          </span>
          <button
            disabled={!distractionSupported}
            onClick={() => updateSettings({ overlayMode: 'distractors' })}
            className={`w-full p-3 rounded-xl border text-left transition-all ${
              !distractionSupported
                ? 'opacity-45 cursor-not-allowed bg-white/5 border-white/10'
                : activeMode === 'distractors'
                ? 'bg-cyan-500/15 border-cyan-400/55 shadow-[0_0_14px_rgba(0,210,255,0.2)] cursor-pointer'
                : 'bg-white/5 border-white/10 hover:border-white/20 cursor-pointer'
            }`}
          >
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs font-bold text-white flex items-center gap-2">
                <ShieldBan className="w-4 h-4 text-[#00D2FF]" />
                Приглушать и размывать только выбранные окна-отвлекатели
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/35 text-cyan-200 font-mono shrink-0">
                Часть экрана · Z-order
              </span>
            </div>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              {distractionSupported
                ? 'Рабочие окна (IDE, документы) всегда остаются 100% чёткими. Затемняются и/или размываются только видимые окна мессенджеров и соцсетей — включая открытые рядом в split-screen.'
                : 'Доступно в десктопном приложении FocusGlass на Windows.'}
            </p>
          </button>
        </div>

        {/* Live Running Windows Picker + Manual Pattern Rules */}
        {activeMode === 'distractors' && distractionSupported && (
          <div className="pt-2 border-t border-white/10 space-y-3">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Monitor className="w-3.5 h-3.5 text-cyan-300" />
                  Запущенные программы и окна
                </span>
                <GlassButton
                  size="sm"
                  variant="ghost"
                  disabled={loadingWindows}
                  onClick={() => void refreshRunningWindows()}
                  icon={<RefreshCw className={`w-3 h-3 ${loadingWindows ? 'animate-spin' : ''}`} />}
                >
                  Обновить
                </GlassButton>
              </div>

              {runningWindows.length === 0 ? (
                <p className="text-[11px] text-slate-400 p-2.5 rounded-lg bg-black/25 border border-white/10">
                  {loadingWindows
                    ? 'Читаю список открытых окон Windows...'
                    : 'Открытые сторонние окна не обнаружены. Нажмите «Обновить».'}
                </p>
              ) : (
                <div className="max-h-44 overflow-y-auto space-y-1.5 pr-1">
                  {runningWindows.map((win, idx) => (
                    <div
                      key={`${win.exe}-${idx}`}
                      className={`flex items-center justify-between gap-2 p-2 rounded-lg border text-xs ${
                        win.isDistractor
                          ? 'bg-orange-500/10 border-orange-500/35'
                          : 'bg-black/25 border-white/10'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-mono text-[11px] text-white font-semibold truncate">
                            {win.exe || 'window'}
                          </span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-slate-300 shrink-0">
                            {win.isBrowser ? 'вкладка' : 'приложение'}
                          </span>
                          {win.isDistractor && win.matchedPattern && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/25 text-orange-200 font-mono shrink-0">
                              «{win.matchedPattern}»
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 truncate" title={win.title}>
                          {win.title}
                        </p>
                      </div>

                      <button
                        onClick={() => toggleRunningWindowPattern(win)}
                        className={`px-2 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 shrink-0 cursor-pointer transition-colors ${
                          win.isDistractor
                            ? 'bg-orange-500/25 hover:bg-rose-500/25 text-orange-200 border-orange-500/45'
                            : 'bg-white/10 hover:bg-cyan-500/20 text-slate-200 border-white/15'
                        }`}
                        title={
                          win.isDistractor
                            ? `Удалить правило «${win.matchedPattern ?? ''}»`
                            : `Добавить правило «${win.suggestedPattern}»`
                        }
                      >
                        {win.isDistractor ? (
                          <>
                            <Check className="w-3 h-3" /> Отвлекатель
                          </>
                        ) : (
                          <>
                            <Plus className="w-3 h-3" /> {win.suggestedPattern}
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] text-slate-300 block" htmlFor="distractor-patterns">
                Список правил (по одному на строку — имя процесса или часть заголовка вкладки браузера):
              </label>
              <textarea
                id="distractor-patterns"
                value={patternDraft}
                onChange={(e) => setPatternDraft(e.target.value)}
                onBlur={commitPatterns}
                rows={3}
                spellCheck={false}
                className="w-full rounded-lg bg-black/40 border border-white/15 px-2.5 py-1.5 text-xs font-mono text-slate-100 select-text focus:outline-none focus:border-[#FF6600]/60"
              />
              <p className="text-[11px] text-slate-400">
                Активное окно:{' '}
                {foregroundWindow ? (
                  <span className={foregroundWindow.isDistractor ? 'text-[#FF6600]' : 'text-emerald-400'}>
                    {foregroundWindow.exe || 'unknown'} —{' '}
                    {foregroundWindow.isDistractor
                      ? `отвлекатель («${foregroundWindow.matchedPattern ?? ''}»)`
                      : 'рабочее (чёткое)'}
                    {visibleDistractorCount > 0
                      ? ` · видимых зон отвлекателей: ${visibleDistractorCount}`
                      : ''}
                  </span>
                ) : (
                  <span className="text-slate-500">ожидание монитора окон…</span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Threshold Slider */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
        <GlassSlider
          label={activeCalibration ? 'Целевой порог (исходная шкала индекса)' : 'Целевой порог БОС'}
          value={settings.threshold}
          min={10}
          max={95}
          step={5}
          unit="%"
          accentColor={settings.mode === 'concentration' ? 'orange' : 'violet'}
          description={
            activeCalibration
              ? 'Хранится в исходном индексе; персональная калибровка переводит порог в шкалу 0–100%.'
              : 'Ниже этого порога начинает работать выбранный режим оверлея.'
          }
          onChange={(val) => updateSettings({ threshold: val })}
        />
      </div>

      {/* Sensitivity & Smoothing */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
        <GlassSlider
          label="Сглаживание реакции (окно скользящего среднего)"
          value={settings.sensitivitySeconds}
          min={0.5}
          max={5.0}
          step={0.5}
          unit="s"
          accentColor="cyan"
          description="Меньше = быстрый отклик; больше = плавные переходы без скачков."
          onChange={(val) => updateSettings({ sensitivitySeconds: val })}
        />
      </div>

      {/* Visual Dimming & Mode-Aware Blur Settings */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 space-y-3">
        <GlassSlider
          label="Максимальная плотность затемнения"
          value={Math.round(settings.dimmingMaxOpacity * 100)}
          min={10}
          max={95}
          step={5}
          unit="%"
          accentColor="orange"
          description="Максимальная глубина приглушения при полном спаде целевого ритма."
          onChange={(val) => updateSettings({ dimmingMaxOpacity: val / 100 })}
        />

        {activeMode === 'fullscreen_dim' ? (
          <p className="text-[11px] text-emerald-300/90 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
            Размытие отключено (`0 px`): в базовом режиме «Плавное затемнение» буквы всегда остаются резкими по принципу «не навреди». Для размытия краёв, плотной паузы или окон-отвлекателей выберите соответствующую концепцию выше.
          </p>
        ) : nativeLinuxBlur && activeMode === 'threshold_blur' ? (
          <div className="space-y-2">
            {linuxBlurStatus?.adjustableRadius && (
              <GlassSlider
                label="Радиус GPU-размытия"
                value={settings.blurRadius / 2}
                min={0}
                max={16}
                step={1}
                unit="px"
                accentColor="cyan"
                description="0 — выключено; 4–8 px — заметное размытие; 12–16 px — сильное. Превью использует выбранную силу."
                onChange={(value) => updateSettings({ blurRadius: value * 2 })}
              />
            )}
            {settings.blurRadius === 0 && (
              <div role="alert" className="rounded-lg border border-amber-400/40 bg-amber-500/10 p-3 text-xs text-amber-200">
                <p>Радиус 0: размытие по порогу выключено, даже если метрика пересекла порог.</p>
                <button type="button" className="mt-2 font-semibold underline"
                  onClick={() => updateSettings({ blurRadius: 16 })}>
                  Включить заметный блюр · 8 px
                </button>
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              {linuxBlurStatus?.adjustableRadius
                ? 'Сцена размывается GPU-шейдером; собственные окна и панели исключаются из эффекта.'
                : 'Для управления радиусом нужен плагин KWin на Wayland или focusglass-x11 на X11. Резервный Wayland-протокол не задаёт силу размытия.'}
            </p>
          </div>
        ) : (
          <GlassSlider
            label={
              activeMode === 'vignette_blur'
                ? 'Сила размытия краёв (виньетка)'
                : activeMode === 'threshold_blur'
                ? `Плотность размытия «Сделай паузу» (мин. ${DENSE_BLUR_MIN_PX} px)`
                : 'Размытие окон-отвлекателей (0 = только затемнение)'
            }
            value={
              activeMode === 'threshold_blur'
                ? Math.max(DENSE_BLUR_MIN_PX, settings.blurRadius)
                : settings.blurRadius
            }
            min={activeMode === 'threshold_blur' ? DENSE_BLUR_MIN_PX : 0}
            max={32}
            step={2}
            unit="px"
            accentColor="cyan"
            description={
              activeMode === 'vignette_blur'
                ? 'Применяется только по периметру экрана — центр всегда резкий.'
                : activeMode === 'threshold_blur'
                ? 'Включается скачком только при глубоком спаде фокуса, чтобы пользователь не пытался читать сквозь размытый текст.'
                : isTauri
                ? 'Применяется строго внутри видимых прямоугольников окон-отвлекателей; рабочие окна рядом не затрагиваются.'
                : 'Радиус размытия в режиме предпросмотра.'
            }
            onChange={(val) => updateSettings({ blurRadius: val })}
          />
        )}
      </div>

      {/* Inverted reaction */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 flex items-center justify-between">
        <div>
          <span className="text-xs font-semibold text-white block">Invert Reaction</span>
          <span className="text-[11px] text-slate-400">
            Срабатывать при превышении порога вместо падения ниже него.
          </span>
        </div>
        <button
          role="switch"
          aria-checked={settings.invertReaction}
          aria-label="Invert Reaction"
          onClick={() => updateSettings({ invertReaction: !settings.invertReaction })}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border ${
            settings.invertReaction ? 'bg-[#FF6600] border-[#FF6600]' : 'bg-slate-800 border-white/20'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform transform ${
              settings.invertReaction ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {/* Audio Biofeedback Toggle */}
      <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`p-2 rounded-xl ${
              settings.audioFeedbackEnabled ? 'bg-orange-500/20 text-[#FF6600]' : 'bg-white/5 text-slate-400'
            }`}
          >
            {settings.audioFeedbackEnabled ? (
              <Volume2 className="w-5 h-5" />
            ) : (
              <VolumeX className="w-5 h-5" />
            )}
          </div>
          <div>
            <span className="text-xs font-semibold text-white block">
              Audio-БОС (Nature / Pink Noise Modulation)
            </span>
            <span className="text-[11px] text-slate-400">
              Мягкий фоновый шум плавно усиливается при падении концентрации.
            </span>
          </div>
        </div>

        <button
          onClick={() => updateSettings({ audioFeedbackEnabled: !settings.audioFeedbackEnabled })}
          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer border ${
            settings.audioFeedbackEnabled ? 'bg-[#FF6600] border-[#FF6600]' : 'bg-slate-800 border-white/20'
          }`}
        >
          <div
            className={`w-4 h-4 rounded-full bg-white transition-transform transform ${
              settings.audioFeedbackEnabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {settings.audioFeedbackEnabled && (
        <div className="p-3.5 rounded-xl bg-slate-900/50 border border-white/10">
          <GlassSlider
            label="Audio Feedback Volume"
            value={Math.round(settings.audioVolume * 100)}
            min={0}
            max={100}
            step={5}
            unit="%"
            accentColor="orange"
            description="Максимальная громкость аудио-БОС при полном дефиците внимания."
            onChange={(val) => updateSettings({ audioVolume: val / 100 })}
          />
        </div>
      )}
    </div>
  );
};
