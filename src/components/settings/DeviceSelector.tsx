import React, { useState } from 'react';
import { Bluetooth, Radio, BatteryCharging, RefreshCw, Smartphone } from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { GlassButton } from '../glass/GlassButton';
import { GlassBadge } from '../glass/GlassBadge';

export const DeviceSelector: React.FC = () => {
  const { settings, updateSettings, deviceStatus } = useFocusStore();
  const [isScanning, setIsScanning] = useState(false);
  const [discoveredDevices, setDiscoveredDevices] = useState<string[]>([]);

  const handleScan = () => {
    setIsScanning(true);
    setDiscoveredDevices([]);
    setTimeout(() => {
      setDiscoveredDevices(['BrainBit-Headband-7492', 'BrainBit-Pro-1048']);
      setIsScanning(false);
    }, 1200);
  };

  return (
    <div className="space-y-4">
      {/* Device Mode Toggle */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => updateSettings({ deviceSource: 'simulator' })}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            settings.deviceSource === 'simulator'
              ? 'bg-[#FF6600]/15 border-[#FF6600]/50 shadow-[0_0_16px_rgba(255,102,0,0.25)]'
              : 'bg-white/5 border-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Radio className="w-3.5 h-3.5 text-[#FF6600]" /> Presentation Simulator
            </span>
            {settings.deviceSource === 'simulator' && (
              <GlassBadge variant="orange">Active</GlassBadge>
            )}
          </div>
          <p className="text-[11px] text-slate-300">
            250 Hz synthetic Alpha/Beta generator with hotkeys 1-4 for flawless pitch demos.
          </p>
        </button>

        <button
          onClick={() => updateSettings({ deviceSource: 'bluetooth' })}
          className={`p-3.5 rounded-xl border text-left transition-all cursor-pointer ${
            settings.deviceSource === 'bluetooth'
              ? 'bg-[#00D2FF]/15 border-[#00D2FF]/50 shadow-[0_0_16px_rgba(0,210,255,0.25)]'
              : 'bg-white/5 border-white/10 hover:border-white/20'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-bold text-white flex items-center gap-1.5">
              <Bluetooth className="w-3.5 h-3.5 text-[#00D2FF]" /> Physical BrainBit BLE
            </span>
            {settings.deviceSource === 'bluetooth' && (
              <GlassBadge variant="cyan">Active</GlassBadge>
            )}
          </div>
          <p className="text-[11px] text-slate-300">
            Connects to real BrainBit 4-channel headband via Bluetooth Low Energy 5.0.
          </p>
        </button>
      </div>

      {/* Connection & BLE Status Card */}
      <div className="p-4 rounded-xl bg-slate-900/60 border border-white/10">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-semibold text-white">Active Device Status</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-emerald-400 flex items-center gap-1 font-mono">
              <BatteryCharging className="w-3.5 h-3.5" /> {deviceStatus.batteryPercentage}%
            </span>
            <GlassBadge variant="green">Connected</GlassBadge>
          </div>
        </div>

        <div className="space-y-1.5 text-xs text-slate-300">
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">Device Model</span>
            <span className="font-mono text-white">{deviceStatus.deviceName}</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">Sampling Rate</span>
            <span className="font-mono text-white">{deviceStatus.samplingRateHz} Hz (4 ms packet)</span>
          </div>
          <div className="flex justify-between py-1 border-b border-white/5">
            <span className="text-slate-400">Active Channels</span>
            <span className="font-mono text-white">4 (T3, T4, O1, O2)</span>
          </div>
        </div>

        {/* BLE Scanning UI */}
        {settings.deviceSource === 'bluetooth' && (
          <div className="mt-4 pt-3 border-t border-white/10">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-slate-400">Bluetooth Discovery</span>
              <GlassButton
                size="sm"
                variant="secondary"
                onClick={handleScan}
                disabled={isScanning}
                icon={<RefreshCw className={`w-3 h-3 ${isScanning ? 'animate-spin' : ''}`} />}
              >
                {isScanning ? 'Scanning...' : 'Scan Nearby Headbands'}
              </GlassButton>
            </div>

            {discoveredDevices.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {discoveredDevices.map((dev) => (
                  <div
                    key={dev}
                    className="flex items-center justify-between p-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white"
                  >
                    <span className="font-mono">{dev}</span>
                    <button className="px-2 py-0.5 rounded bg-[#00D2FF]/20 text-[#00D2FF] border border-[#00D2FF]/40 text-[11px] hover:bg-[#00D2FF]/30 cursor-pointer">
                      Pair
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
