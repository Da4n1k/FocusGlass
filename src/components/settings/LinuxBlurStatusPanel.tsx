import React from 'react';
import { tauriBridge } from '../../services/tauriBridge';
import type { LinuxBlurStatus } from '../../services/eegTypes';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassButton } from '../glass/GlassButton';

/** Exposes actual native capability/mapping state instead of silently failing to blur. */
export const LinuxBlurStatusPanel: React.FC<{ onStatus?: (status: LinuxBlurStatus) => void }> = ({ onStatus }) => {
  const { settings, feedbackState, deviceStatus, isPaused, overlayEnabled, isTauri } = useFocusStore();
  const [status, setStatus] = React.useState<LinuxBlurStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [testing, setTesting] = React.useState(false);

  React.useEffect(() => {
    if (!tauriBridge.isTauri()) return;
    let stopped = false;
    let inFlight = false;
    const refresh = async (): Promise<void> => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const next = await tauriBridge.getLinuxBlurStatus();
        if (!stopped) {
          setStatus(next);
          onStatus?.(next);
        }
      } catch (error: unknown) {
        if (!stopped) setError(error instanceof Error ? error.message : String(error));
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 500);
    return () => { stopped = true; clearInterval(timer); };
  }, [onStatus]);

  if (!isTauri) {
    return (
      <p className="text-xs text-amber-200">
        В браузере нельзя размыть рабочий стол. Запустите десктопное приложение: npm run desktop:dev.
      </p>
    );
  }

  if (!status?.linux) {
    return error ? <p role="alert" className="text-xs text-amber-300">Статус размытия недоступен: {error}</p> : null;
  }

  let reason = settings.invertReaction
    ? 'Инверсия: метрика не превысила порог — размытие не требуется'
    : 'Внимание выше порога — размытие не требуется';
  if (!status.enabled) reason = 'Бэкенд отключён или Wayland недоступен';
  else if (!status.available) reason = 'Композитор не предоставил размытие';
  else if (status.active) reason = `Слой размытия включён · экранов: ${status.mappedOutputs}`;
  else if (!overlayEnabled) reason = 'Оверлей выключен';
  else if (settings.overlayMode !== 'threshold_blur') reason = 'Выберите «Блюр по порогу»';
  else if (isPaused) reason = 'Сеанс на паузе';
  else if (settings.deviceSource !== 'simulator' && (!deviceStatus.connected || deviceStatus.streamMode === 'resist')) {
    reason = 'Нет потока ЭЭГ или идёт проверка посадки';
  } else if (!feedbackState.isContactOk) reason = 'Нет контакта электродов';
  else if (settings.blurRadius <= 0) reason = 'Размытие отключено настройкой силы';
  else if (status.requested) reason = 'Запрос размытия получен, ожидаем поверхность';
  else if (feedbackState.isDimmingActive) reason = 'Движок запросил обратную связь, ожидаем включение';

  const preview = async (): Promise<void> => {
    setTesting(true);
    setError(null);
    try {
      await tauriBridge.previewLinuxBlur();
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="rounded-xl border border-cyan-400/25 bg-cyan-500/5 p-3 space-y-2">
      <div className="text-xs font-semibold text-cyan-200">Размытие рабочего стола · Linux / Wayland</div>
      <p role="status" className="text-xs text-slate-200">{reason}</p>
      {!status.available && <p className="text-[11px] text-amber-200 break-words">{status.message}</p>}
      <p className="text-[11px] text-slate-400">
        В этом режиме Linux блюр включается при падении внимания ниже целевого порога,
        без дополнительного ожидания дефицита 45%. Радиус задаёт композитор.
        При включённой инверсии направление сравнения обратное.
        Проверка ниже включает сквозной блюр на 3 секунды независимо от ЭЭГ.
      </p>
      <GlassButton size="sm" variant="ghost" disabled={!status.available || testing} onClick={() => { void preview(); }}>
        Проверить блюр · 3 секунды
      </GlassButton>
      {error && <p role="alert" className="text-xs text-amber-300">{error}</p>}
    </section>
  );
};
