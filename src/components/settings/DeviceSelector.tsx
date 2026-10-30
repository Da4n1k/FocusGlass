import React, { useRef, useState } from 'react';
import {
  Bluetooth,
  Radio,
  RefreshCw,
  FileSpreadsheet,
  Upload,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { tauriBridge } from '../../services/tauriBridge';
import { GlassButton } from '../glass/GlassButton';
import { GlassBadge } from '../glass/GlassBadge';

export const DeviceSelector: React.FC = () => {
  const {
    settings,
    updateSettings,
    deviceStatus,
    replayInfo,
    loadCSVReplay,
    loadDemoSampleCSV,
  } = useFocusStore();

  const isRu = (settings.language ?? 'ru') === 'ru';
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [csvFeedback, setCsvFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  const handleHonestBleScan = async () => {
    setIsScanning(true);
    setScanMessage(null);
    const result = await tauriBridge.scanBrainBitDevices();
    setScanMessage(result.message);
    setIsScanning(false);
  };

  const handleCSVUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const content = typeof reader.result === 'string' ? reader.result : '';
      const res = loadCSVReplay(content, file.name);
      if (res.ok) {
        setCsvFeedback({
          ok: true,
          text: isRu
            ? `Загружено ${res.count} отсчётов из ${file.name} (250 Гц)`
            : `Loaded ${res.count} samples from ${file.name}`,
        });
      } else {
        setCsvFeedback({
          ok: false,
          text: res.error ?? 'CSV error',
        });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-4">
      {/* 3 Honest Telemetry Sources */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {/* 1. Simulator */}
        <button
          onClick={() => updateSettings({ deviceSource: 'simulator' })}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
            settings.deviceSource === 'simulator'
              ? 'bg-[#FF6600]/15 border-[#FF6600]/50 shadow-[0_0_16px_rgba(255,102,0,0.2)]'
              : 'bg-white/5 border-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[#FF6600]" />
              {isRu ? 'Симулятор' : 'Simulator'}
            </span>
            {settings.deviceSource === 'simulator' && (
              <GlassBadge variant="orange">{isRu ? 'Активен' : 'Active'}</GlassBadge>
            )}
          </div>
          <p className="text-[11px] text-slate-300 leading-snug">
            {isRu
              ? 'Синтетика 250 Гц (α/β/θ) + клавиши 1–5 для демонстрации без гарнитуры.'
              : '250 Hz synthetic α/β/θ model + hotkeys 1–5 for pitch demos.'}
          </p>
        </button>

        {/* 2. CSV Replay */}
        <button
          onClick={() => {
            if (replayInfo.count === 0) {
              loadDemoSampleCSV();
            } else {
              updateSettings({ deviceSource: 'csv_replay' });
            }
          }}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
            settings.deviceSource === 'csv_replay'
              ? 'bg-purple-500/15 border-purple-500/50 shadow-[0_0_16px_rgba(139,92,246,0.2)]'
              : 'bg-white/5 border-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <FileSpreadsheet className="w-3.5 h-3.5 text-purple-400" />
              {isRu ? 'CSV-запись ЭЭГ' : 'EEG CSV Replay'}
            </span>
            {settings.deviceSource === 'csv_replay' && (
              <GlassBadge variant="violet">{isRu ? 'Активен' : 'Active'}</GlassBadge>
            )}
          </div>
          <p className="text-[11px] text-slate-300 leading-snug">
            {isRu
              ? 'Чтение 4 каналов (t3,t4,o1,o2) из MNE-Python/BrainBit CSV с расчётом спектра.'
              : 'Replay 4-ch CSV from MNE-Python/BrainBit with real DFT spectrum.'}
          </p>
        </button>

        {/* 3. Physical BrainBit BLE */}
        <button
          onClick={() => updateSettings({ deviceSource: 'bluetooth' })}
          className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
            settings.deviceSource === 'bluetooth'
              ? 'bg-[#00D2FF]/15 border-[#00D2FF]/50 shadow-[0_0_16px_rgba(0,210,255,0.2)]'
              : 'bg-white/5 border-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Bluetooth className="w-3.5 h-3.5 text-[#00D2FF]" />
              BrainBit BLE
            </span>
            {settings.deviceSource === 'bluetooth' && (
              <GlassBadge variant="cyan">{isRu ? 'Выбран' : 'Selected'}</GlassBadge>
            )}
          </div>
          <p className="text-[11px] text-slate-300 leading-snug">
            {isRu
              ? 'Аппаратный режим neurosdk2 + EmotionalMath (без подмены симуляцией).'
              : 'Hardware neurosdk2 + EmotionalMath slot (never faked).'}
          </p>
        </button>
      </div>

      {/* Honest Device Diagnostic Card */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-white">
            {isRu ? 'Фактический статус источника сигнала' : 'Actual Signal Source Status'}
          </span>
          <GlassBadge
            variant={
              deviceStatus.deviceSource === 'bluetooth' && !deviceStatus.connected
                ? 'red'
                : deviceStatus.isSimulated
                ? 'orange'
                : 'green'
            }
          >
            {deviceStatus.deviceSource === 'simulator'
              ? isRu ? 'Симуляция активна' : 'Simulation Active'
              : deviceStatus.deviceSource === 'csv_replay'
              ? isRu ? 'CSV-воспроизведение' : 'CSV Replay'
              : deviceStatus.connected
              ? isRu ? 'Подключён BLE' : 'BLE Connected'
              : isRu ? 'SDK не подключён' : 'SDK Not Linked'}
          </GlassBadge>
        </div>

        <div className="space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">{isRu ? 'Источник' : 'Source'}</span>
            <span className="font-mono text-white">{deviceStatus.deviceName}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">{isRu ? 'Частота потока' : 'Sample Rate'}</span>
            <span className="font-mono text-white">{deviceStatus.samplingRateHz} Hz (4 ms)</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">NeuroSDK2 / EmotionalMath</span>
            <span className={`font-mono ${deviceStatus.sdkIntegrated ? 'text-emerald-400' : 'text-amber-300'}`}>
              {deviceStatus.sdkIntegrated
                ? isRu ? 'Подключён' : 'Integrated'
                : isRu ? 'Ожидает интеграции (Этап 2)' : 'Pending Integration (Stage 2)'}
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">{isRu ? 'Заряд батареи' : 'Battery'}</span>
            <span className="font-mono text-white">
              {deviceStatus.batteryPercentage !== null
                ? `${deviceStatus.batteryPercentage}%`
                : isRu ? 'Н/Д (нет физ. обруча)' : 'N/A (no headband)'}
            </span>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 bg-black/25 p-2.5 rounded-lg border border-white/5">
          {deviceStatus.statusNote}
        </p>

        {/* CSV Upload Panel */}
        {settings.deviceSource === 'csv_replay' && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-slate-300">
                {replayInfo.count > 0
                  ? `${replayInfo.label} (${replayInfo.count} ${isRu ? 'отсчётов' : 'frames'})`
                  : isRu ? 'Загрузите файл .csv' : 'Upload a .csv file'}
              </span>
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={handleCSVUpload}
                  className="hidden"
                />
                <GlassButton
                  size="sm"
                  variant="secondary"
                  icon={<Upload className="w-3.5 h-3.5" />}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {isRu ? 'Выбрать CSV-файл' : 'Upload CSV'}
                </GlassButton>
                <GlassButton
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    loadDemoSampleCSV();
                    setCsvFeedback({
                      ok: true,
                      text: isRu
                        ? 'Загружен эталонный 4-канальный сигнал (3000 отсчётов @ 250 Гц)'
                        : 'Loaded 3000-sample 4-ch 250Hz reference CSV',
                    });
                  }}
                >
                  {isRu ? 'Тестовый 4-кан. CSV' : 'Sample 4-ch CSV'}
                </GlassButton>
              </div>
            </div>

            {csvFeedback && (
              <div
                className={`p-2 rounded-lg text-[11px] flex items-center gap-1.5 ${
                  csvFeedback.ok
                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                    : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                }`}
              >
                {csvFeedback.ok ? (
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                )}
                <span>{csvFeedback.text}</span>
              </div>
            )}
          </div>
        )}

        {/* Honest BLE Scan Panel */}
        {settings.deviceSource === 'bluetooth' && (
          <div className="pt-2 border-t border-white/10 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-300">
                {isRu ? 'Проверка адаптера BrainBit BLE' : 'BrainBit BLE Adapter Check'}
              </span>
              <GlassButton
                size="sm"
                variant="secondary"
                onClick={handleHonestBleScan}
                disabled={isScanning}
                icon={<RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />}
              >
                {isScanning
                  ? isRu ? 'Проверка...' : 'Checking...'
                  : isRu ? 'Проверить статус SDK' : 'Check SDK Status'}
              </GlassButton>
            </div>

            {scanMessage && (
              <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <span>{scanMessage}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
