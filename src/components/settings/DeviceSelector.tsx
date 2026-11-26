import React, { useState } from 'react';
import {
  Bluetooth,
  Radio,
  BatteryCharging,
  RefreshCw,
  Smartphone,
  AlertTriangle,
  Link2,
  Unlink,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { tauriBridge } from '../../services/tauriBridge';
import type { DiscoveredBrainBitDevice } from '../../services/eegTypes';
import { GlassButton } from '../glass/GlassButton';
import { GlassBadge } from '../glass/GlassBadge';

export const DeviceSelector: React.FC = () => {
  const {
    settings,
    updateSettings,
    deviceStatus,
    fitVerified,
    connectBrainBitDevice,
    disconnectBrainBitDevice,
    startFitCheck,
    startEegStreamFromFitCheck,
  } = useFocusStore();

  const [isScanning, setIsScanning] = useState(false);
  const [connectingAddress, setConnectingAddress] = useState<string | null>(null);
  const [isSwitchingMode, setIsSwitchingMode] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<DiscoveredBrainBitDevice[]>([]);
  const [scanMessage, setScanMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isSimulator = settings.deviceSource === 'simulator';
  const isBleConnected = !isSimulator && deviceStatus.connected;
  const streamMode = deviceStatus.streamMode ?? 'idle';
  const sdkAvailable = deviceStatus.sdkAvailable !== false && deviceStatus.connectionState !== 'sdk_unavailable';

  const handleScan = async () => {
    setIsScanning(true);
    setScanMessage(null);
    setActionError(null);
    try {
      const res = await tauriBridge.scanBrainBitDevices(4000);
      setDiscoveredDevices(res.devices);
      setScanMessage(res.message);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleConnect = async (address: string) => {
    setConnectingAddress(address);
    setActionError(null);
    try {
      await connectBrainBitDevice(address, 'resist');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectingAddress(null);
    }
  };

  const handleDisconnect = async () => {
    setConnectingAddress(deviceStatus.deviceAddress ?? 'disconnect');
    setActionError(null);
    try {
      await disconnectBrainBitDevice();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnectingAddress(null);
    }
  };

  const handleSwitchMode = async (mode: 'resist' | 'signal') => {
    setIsSwitchingMode(true);
    setActionError(null);
    try {
      if (mode === 'resist') {
        await startFitCheck();
      } else {
        await startEegStreamFromFitCheck();
      }
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSwitchingMode(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Device Mode Toggle */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => {
            setScanMessage(null);
            setActionError(null);
            updateSettings({ deviceSource: 'simulator' });
          }}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            isSimulator
              ? 'bg-[#FF6600]/15 border-[#FF6600]/50 shadow-[0_0_16px_rgba(255,102,0,0.25)]'
              : 'bg-white/5 border-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[#FF6600]" /> Synthetic Simulator
            </span>
            {isSimulator && <GlassBadge variant="orange">Active</GlassBadge>}
          </div>
          <p className="text-[11px] text-slate-300">
            250 Hz synthetic Alpha/Beta/Theta generator with hotkeys 1-5 for offline testing and demos.
          </p>
        </button>

        <button
          onClick={() => {
            setActionError(null);
            updateSettings({ deviceSource: 'bluetooth' });
          }}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            !isSimulator
              ? 'bg-[#00D2FF]/15 border-[#00D2FF]/50 shadow-[0_0_16px_rgba(0,210,255,0.25)]'
              : 'bg-white/5 border-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Bluetooth className="w-3.5 h-3.5 text-[#00D2FF]" /> Physical BrainBit BLE
            </span>
            {!isSimulator && (
              <GlassBadge variant={isBleConnected ? 'cyan' : 'red'}>
                {isBleConnected ? 'Connected' : 'Disconnected'}
              </GlassBadge>
            )}
          </div>
          <p className="text-[11px] text-slate-300">
            Direct NeuroSDK2 BLE transport (4 dry electrodes: T3, T4, O1, O2 + impedance fit check).
          </p>
        </button>
      </div>

      {/* Connection & BLE Status Card */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-white">Active Source Status</span>
          </div>
          <div className="flex items-center gap-2">
            {isSimulator ? (
              <>
                <span className="text-xs text-amber-300 font-mono">VIRTUAL</span>
                <GlassBadge variant="orange">Simulated</GlassBadge>
              </>
            ) : isBleConnected ? (
              <>
                <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
                  <BatteryCharging className="w-3.5 h-3.5" /> {deviceStatus.batteryPercentage}%
                </span>
                <GlassBadge variant={streamMode === 'resist' ? 'orange' : 'green'}>
                  {streamMode === 'resist'
                    ? 'Fit Check (kΩ)'
                    : streamMode === 'signal'
                    ? 'EEG 250 Hz'
                    : 'Connected'}
                </GlassBadge>
              </>
            ) : (
              <>
                <span className="text-xs text-slate-500 font-mono">Battery: —</span>
                <GlassBadge variant="red">Disconnected</GlassBadge>
              </>
            )}
          </div>
        </div>

        <div className="space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">Source</span>
            <span className="font-mono text-white">
              {deviceStatus.deviceName}
              {deviceStatus.serialNumber ? ` (S/N ${deviceStatus.serialNumber})` : ''}
            </span>
          </div>
          {!isSimulator && deviceStatus.deviceAddress && (
            <div className="flex justify-between py-1 border-b border-white/5">
              <span className="text-slate-400">BLE Address</span>
              <span className="font-mono text-white">{deviceStatus.deviceAddress}</span>
            </div>
          )}
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">Target Sampling Rate</span>
            <span className="font-mono text-white">
              {deviceStatus.samplingRateHz} Hz (4 ms packet)
            </span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">Montage (10-20)</span>
            <span className="font-mono text-white">4 ch (T3, T4, O1, O2 · bipolar O1-T3 / O2-T4)</span>
          </div>
        </div>

        {deviceStatus.statusMessage && (
          <div
            className={`mt-3 p-2.5 rounded-lg border text-[11px] flex items-start gap-2 ${
              isSimulator || isBleConnected || sdkAvailable
                ? 'bg-white/5 border-white/10 text-slate-300'
                : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
            }`}
          >
            {!isSimulator && !isBleConnected && !sdkAvailable && (
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            )}
            <span>{deviceStatus.statusMessage}</span>
          </div>
        )}

        {actionError && (
          <div className="mt-3 p-2.5 rounded-lg border bg-rose-500/10 border-rose-500/30 text-[11px] text-rose-200 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Active BLE Session Mode & Disconnect Controls */}
        {isBleConnected && (
          <div className="mt-4 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <GlassButton
                size="sm"
                variant={streamMode === 'resist' ? 'primary' : 'secondary'}
                disabled={isSwitchingMode || streamMode === 'resist'}
                onClick={() => void handleSwitchMode('resist')}
                icon={<ShieldCheck className="w-3.5 h-3.5" />}
              >
                {fitVerified ? 'Повторная проверка посадки' : 'Проверка посадки (Импеданс)'}
              </GlassButton>
              <GlassButton
                size="sm"
                variant={streamMode === 'signal' ? 'cyan' : 'primary'}
                disabled={isSwitchingMode || streamMode === 'signal'}
                onClick={() => void handleSwitchMode('signal')}
                icon={<Activity className="w-3.5 h-3.5" />}
              >
                Поток ЭЭГ 250 Гц
              </GlassButton>
            </div>

            <GlassButton
              size="sm"
              variant="danger"
              disabled={connectingAddress !== null}
              onClick={() => void handleDisconnect()}
              icon={<Unlink className="w-3.5 h-3.5" />}
            >
              Отключить
            </GlassButton>
          </div>
        )}

        {/* BLE Scanning UI */}
        {!isSimulator && (
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <div>
                <span className="text-xs font-medium text-white block">Bluetooth LE Discovery</span>
                <span className="text-[10px] text-slate-400">
                  Вставьте заряженный аккумулятор в ободок. НЕ добавляйте BrainBit в настройках Bluetooth Windows — подключайтесь напрямую здесь.
                </span>
              </div>
              <GlassButton
                size="sm"
                variant="secondary"
                onClick={() => void handleScan()}
                disabled={isScanning || connectingAddress !== null || !sdkAvailable}
                icon={<RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />}
              >
                {isScanning ? 'Scanning (4s)...' : 'Scan BrainBit BLE'}
              </GlassButton>
            </div>

            {!sdkAvailable && (
              <p className="text-[11px] text-amber-300 mt-2 p-2 rounded-lg bg-amber-500/10 border border-amber-500/30">
                Не найдена библиотека <code>neurosdk2-x64.dll</code>. Запустите{' '}
                <code>scripts/fetch-neurosdk2.ps1</code> или положите DLL рядом с приложением.
              </p>
            )}

            {scanMessage && (
              <p className="text-[11px] text-slate-300 mt-2 p-2 rounded-lg bg-black/30 border border-white/10">
                {scanMessage}
              </p>
            )}

            {discoveredDevices.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {discoveredDevices.map((dev) => {
                  const isThisConnected =
                    isBleConnected &&
                    deviceStatus.deviceAddress?.toUpperCase() === dev.address.toUpperCase();
                  const isConnectingThis =
                    connectingAddress?.toUpperCase() === dev.address.toUpperCase();
                  return (
                    <div
                      key={dev.address}
                      className="flex items-center justify-between p-2.5 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-semibold">{dev.name}</span>
                          {dev.family && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 font-mono">
                              {dev.family}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 font-mono">
                          {dev.address}
                          {dev.serialNumber ? ` · S/N ${dev.serialNumber}` : ''}
                          {typeof dev.rssi === 'number' ? ` · ${dev.rssi} dBm` : ''}
                        </span>
                      </div>

                      {isThisConnected ? (
                        <GlassButton
                          size="sm"
                          variant="danger"
                          disabled={connectingAddress !== null}
                          onClick={() => void handleDisconnect()}
                          icon={<Unlink className="w-3 h-3" />}
                        >
                          Отключить
                        </GlassButton>
                      ) : (
                        <GlassButton
                          size="sm"
                          variant="primary"
                          disabled={connectingAddress !== null}
                          onClick={() => void handleConnect(dev.address)}
                          icon={<Link2 className="w-3 h-3" />}
                        >
                          {isConnectingThis ? 'Подключение...' : 'Подключить'}
                        </GlassButton>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
