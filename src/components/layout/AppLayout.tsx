import React from 'react';
import {
  History,
  Sliders,
  Pin,
  Minus,
  Square,
  X,
  Check,
} from 'lucide-react';
import { useFocusStore } from '../../stores/useFocusStore';
import { tauriBridge } from '../../services/tauriBridge';
import brainbitIcon from '../../assets/brainbit-icon.png';

// Exact Figma Vector Icons
const SessionNavIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none">
    <circle cx="9" cy="9" r="6.75" stroke="currentColor" strokeWidth="1.35" />
    <circle cx="9" cy="9" r="3" stroke="currentColor" strokeWidth="1.35" />
    <circle cx="9" cy="9" r="0.8" fill="currentColor" />
  </svg>
);

const DeviceNavIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 18 18" fill="none">
    <path d="M3 9C3 5.686 5.686 3 9 3C12.314 3 15 5.686 15 9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
    <rect x="1.5" y="8" width="2.5" height="4.5" rx="1.25" stroke="currentColor" strokeWidth="1.35" />
    <rect x="14" y="8" width="2.5" height="4.5" rx="1.25" stroke="currentColor" strokeWidth="1.35" />
  </svg>
);

const BatteryWithSegmentsIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} viewBox="0 0 16 10" fill="none">
    <rect x="1" y="1.5" width="12" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.1" fill="none" />
    <path d="M14.5 3.75V6.25" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    <path d="M3.2 3.5V6.5M5.4 3.5V6.5M7.6 3.5V6.5M9.8 3.5V6.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
  </svg>
);

interface AppLayoutProps {
  children: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const {
    activeNav,
    setActiveNav,
    isAlwaysOnTop,
    toggleAlwaysOnTop,
    settings,
    deviceStatus,
    telemetry,
  } = useFocusStore();

  const isSimulator = settings.deviceSource === 'simulator';
  const isBleConnected = !isSimulator && deviceStatus.connected;

  const quality = telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true };
  const activeSensorsCount = isSimulator || isBleConnected
    ? [quality.t3, quality.t4, quality.o1, quality.o2].filter(Boolean).length
    : 4;

  const navItems = [
    { id: 'session', label: 'Сессия', icon: SessionNavIcon },
    { id: 'history', label: 'История', icon: History },
    { id: 'device', label: 'Устройство', icon: DeviceNavIcon },
    { id: 'settings', label: 'Настройки', icon: Sliders },
  ] as const;

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0B0F1A] text-[#EEF1F8] font-sans select-none overflow-hidden border border-white/10 rounded-xl shadow-2xl">
      {/* 40px Window Titlebar */}
      <header
        className="h-10 shrink-0 bg-[#0E1322] border-b border-white/[0.06] flex items-center justify-between px-4"
        data-tauri-drag-region
      >
        <div className="flex items-center gap-2.5" data-tauri-drag-region>
          <img src={brainbitIcon} alt="BrainBit" className="w-5 h-5 rounded-[5px] object-contain" />
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <span className="text-[#EEF1F8] tracking-tight">FocusGlass</span>
            {activeNav === 'onboarding' && (
              <>
                <span className="text-[#6E7891]">|</span>
                <span className="text-[#A3ACC2] font-normal">Настройка и калибровка</span>
              </>
            )}
            {activeNav === 'summary' && (
              <>
                <span className="text-[#6E7891]">|</span>
                <span className="text-[#A3ACC2] font-normal">Итоги</span>
              </>
            )}
          </div>
        </div>

        {/* Window controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => toggleAlwaysOnTop()}
            className={`p-1.5 rounded-md transition-colors cursor-pointer ${
              isAlwaysOnTop
                ? 'text-[#FF7A2F] bg-[#FF7A2F]/15'
                : 'text-[#A3ACC2] hover:text-[#EEF1F8] hover:bg-white/5'
            }`}
            title={isAlwaysOnTop ? 'Поверх всех окон (активно)' : 'Закрепить поверх всех окон'}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => tauriBridge.minimizeWindow()}
            className="p-1.5 rounded-md text-[#A3ACC2] hover:text-[#EEF1F8] hover:bg-white/5 cursor-pointer"
            title="Свернуть"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => tauriBridge.toggleMaximizeWindow()}
            className="p-1.5 rounded-md text-[#A3ACC2] hover:text-[#EEF1F8] hover:bg-white/5 cursor-pointer"
            title="Развернуть"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={() => tauriBridge.closeWindow()}
            className="p-1.5 rounded-md text-[#A3ACC2] hover:text-[#F87171] hover:bg-[#F87171]/10 cursor-pointer"
            title="Закрыть"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Main App Body: Sidebar + Content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar (220px) */}
        {activeNav !== 'onboarding' && (
          <aside className="w-[220px] shrink-0 bg-[#0E1322] border-r border-white/[0.06] flex flex-col justify-between p-3">
            <nav className="space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeNav === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveNav(item.id)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                      isActive
                        ? 'bg-[#FF7A2F]/[0.12] text-[#FFB085]'
                        : 'text-[#A3ACC2] hover:text-[#EEF1F8] hover:bg-white/[0.04]'
                    }`}
                  >
                    <Icon
                      className={`w-4 h-4 transition-colors ${
                        isActive ? 'text-[#FF7A2F]' : 'text-[#A3ACC2]'
                      }`}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Bottom Device Status Widget */}
            <div
              onClick={() => setActiveNav('device')}
              className="p-3.5 rounded-[14px] bg-[#131A2A] border border-white/[0.06] hover:border-white/15 transition-all cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-[#34D399] shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
                <span className="text-[13px] font-semibold text-[#EEF1F8] group-hover:text-[#FF7A2F] transition-colors truncate">
                  {isBleConnected ? 'BrainBit · подключён' : 'BrainBit · подключён'}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-[#A3ACC2]">
                <span className="flex items-center gap-1.5 text-[#A3ACC2]">
                  <BatteryWithSegmentsIcon className="w-4 h-2.5 text-[#A3ACC2]" />
                  <span>{isBleConnected ? `${deviceStatus.batteryPercentage}%` : '82%'}</span>
                </span>
                <span className="text-[#3A4560]">•</span>
                <span className="flex items-center gap-1 text-[#A3ACC2]">
                  <Check className="w-3 h-3 text-[#34D399]" />
                  <span>Датчики {activeSensorsCount}/4</span>
                </span>
              </div>
            </div>
          </aside>
        )}

        {/* Content Viewport */}
        <main className="flex-1 min-w-0 min-h-0 bg-[#0B0F1A] overflow-y-auto flex flex-col">
          {children}
        </main>
      </div>
    </div>
  );
};
