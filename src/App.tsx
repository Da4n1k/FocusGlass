import React, { useEffect } from 'react';
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

export const App: React.FC = () => {
  const {
    viewMode,
    activeNav,
    setViewMode,
  } = useFocusStore();

  // Ctrl+Shift+G / Ctrl+Shift+F synchronization with Tauri backend
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    let unlistenDisabled: (() => void) | undefined;

    import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen('click-through-disabled', () =>
          useFocusStore.setState({ isClickThrough: false })
        )
      )
      .then((fn) => {
        unlistenDisabled = fn;
      });

    return () => {
      unlistenDisabled?.();
    };
  }, []);

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

  return (
    <div className="min-h-screen w-full relative flex flex-col font-sans overflow-hidden bg-transparent">
      {/* Background Ambient Biofeedback Screen Overlay & Gentle Prompts */}
      <BiofeedbackOverlay />

      {/* Floating HUD View (Mini-panel 07) or Full Window Layout (01-06, 09-12) */}
      {viewMode === 'hud' ? (
        <FocusBarHUD />
      ) : (
        <AppLayout>
          {activeNav === 'session' && <SessionScreen />}
          {activeNav === 'history' && <HistoryScreen />}
          {activeNav === 'device' && <DeviceScreen />}
          {activeNav === 'settings' && <SettingsScreen />}
          {activeNav === 'onboarding' && <OnboardingWizard />}
          {activeNav === 'summary' && <SessionSummaryScreen />}
        </AppLayout>
      )}
    </div>
  );
};

export default App;
