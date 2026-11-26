import React, { useEffect } from 'react';
import { X } from 'lucide-react';
import { useFocusStore } from './stores/useFocusStore';
import { AppLayout } from './components/layout/AppLayout';
import { SessionScreen } from './components/screens/SessionScreen';
import { HistoryScreen } from './components/screens/HistoryScreen';
import { DeviceScreen } from './components/screens/DeviceScreen';
import { SettingsScreen } from './components/screens/SettingsScreen';
import { OnboardingWizard } from './components/screens/OnboardingWizard';
import { SessionSummaryScreen } from './components/screens/SessionSummaryScreen';
import { FocusBarHUD } from './components/hud/FocusBarHUD';
import { BiofeedbackOverlay } from './components/overlay/BiofeedbackOverlay';

/** Всплывающее сообщение об ошибке Rust-ядра или экспорта. */
const NoticeToast: React.FC = () => {
  const notice = useFocusStore((s) => s.notice);
  const dismissNotice = useFocusStore((s) => s.dismissNotice);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(dismissNotice, 8000);
    return () => window.clearTimeout(timer);
  }, [notice, dismissNotice]);

  if (!notice) return null;
  return (
    <div
      role="alert"
      className={`fixed bottom-5 left-1/2 -translate-x-1/2 z-[60] max-w-lg px-4 py-2.5 rounded-xl border text-xs shadow-2xl backdrop-blur-xl flex items-start gap-3 ${
        notice.kind === 'error'
          ? 'bg-rose-950/90 border-rose-500/50 text-rose-100'
          : 'bg-slate-900/90 border-white/20 text-slate-100'
      }`}
    >
      <span className="select-text">{notice.text}</span>
      <button
        onClick={dismissNotice}
        className="shrink-0 text-white/60 hover:text-white cursor-pointer"
        title="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const App: React.FC = () => {
  const {
    isTauri,
    unifiedHud,
    overlayWindowCount,
    viewMode,
    activeNav,
    setViewMode,
  } = useFocusStore();

  // Keyboard shortcut Ctrl+Shift+F to toggle HUD / Window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'F' || e.key === 'f' || e.key === 'а' || e.key === 'А')) {
        e.preventDefault();
        setViewMode(viewMode === 'hud' ? 'dashboard' : 'hud');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [viewMode, setViewMode]);

  const isSplitLinuxHud = isTauri && !unifiedHud && viewMode === 'hud';
  const hideDashboardForHud = isTauri && unifiedHud && viewMode === 'hud';
  const renderInPageOverlay = !isTauri || (!unifiedHud && overlayWindowCount === 0);

  return (
    <div className="min-h-screen w-full relative flex flex-col font-sans overflow-hidden bg-transparent">
      {/* In-page dimming + Screen 08 gentle prompt when native overlay is inactive (browser / non-composited X11) */}
      {renderInPageOverlay && <BiofeedbackOverlay />}

      {/* Floating HUD View (Mini-panel 07) or Full Window Layout (01-06, 09-12) */}
      {viewMode === 'hud' && (!isTauri || isSplitLinuxHud) ? (
        <FocusBarHUD />
      ) : hideDashboardForHud ? null : (
        <AppLayout>
          {activeNav === 'session' && <SessionScreen />}
          {activeNav === 'history' && <HistoryScreen />}
          {activeNav === 'device' && <DeviceScreen />}
          {activeNav === 'settings' && <SettingsScreen />}
          {activeNav === 'onboarding' && <OnboardingWizard />}
          {activeNav === 'summary' && <SessionSummaryScreen />}
        </AppLayout>
      )}

      <NoticeToast />
    </div>
  );
};

export default App;
