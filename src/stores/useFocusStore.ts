import { create } from 'zustand';
import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  SessionRecord,
  DeviceStatus,
  PresetState,
  CalibrationResult,
} from '../services/eegTypes';
import { BiofeedbackEngine, DEFAULT_SETTINGS } from '../services/biofeedbackEngine';
import { simulationEngine } from '../services/simulationEngine';
import { audioFeedback } from '../services/audioFeedback';
import { tauriBridge } from '../services/tauriBridge';

const SETTINGS_STORAGE_KEY = 'focusglass.settings.v1';
const SESSIONS_STORAGE_KEY = 'focusglass.sessions.v1';

function loadPersistedSettings(): FocusGlassSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<FocusGlassSettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      // Always start in simulator until physical BrainBit session is explicitly selected
      deviceSource: 'simulator',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function savePersistedSettings(settings: FocusGlassSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

function loadSessionHistory(): SessionRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SessionRecord[]) : [];
  } catch {
    return [];
  }
}

function saveSessionHistory(records: SessionRecord[]): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(records.slice(0, 50)));
  } catch {
    // Ignore storage quota errors
  }
}

interface FocusStoreState {
  // Settings
  settings: FocusGlassSettings;
  updateSettings: (newSettings: Partial<FocusGlassSettings>) => void;

  // View & Window
  viewMode: 'dashboard' | 'hud';
  setViewMode: (mode: 'dashboard' | 'hud') => void;
  isClickThrough: boolean;
  setClickThrough: (enabled: boolean) => Promise<void>;
  toggleClickThrough: () => Promise<void>;
  isAlwaysOnTop: boolean;
  toggleAlwaysOnTop: () => Promise<void>;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  activeTab: 'monitor' | 'oscilloscope' | 'electrodes' | 'calibration' | 'analytics' | 'settings';
  setActiveTab: (
    tab: 'monitor' | 'oscilloscope' | 'electrodes' | 'calibration' | 'analytics' | 'settings'
  ) => void;

  // Live Biometrics
  telemetry: EEGTelemetry | null;
  feedbackState: BiofeedbackFeedbackState;
  sessionStats: SessionStatistics;
  sessionHistory: SessionRecord[];
  sessionStartedAt: string;
  deviceStatus: DeviceStatus;
  isPaused: boolean;

  // Controls
  activePreset: PresetState;
  setPreset: (preset: PresetState) => void;
  injectArtifact: () => void;
  togglePause: () => void;
  setElectrodeContact: (channel: 't3' | 't4' | 'o1' | 'o2', ok: boolean) => void;
  resetSession: (saveCurrent?: boolean) => void;
  exportSessionsCsv: () => void;

  // Calibration
  isCalibrating: boolean;
  calibrationDurationSeconds: 10 | 30;
  setCalibrationDuration: (seconds: 10 | 30) => void;
  calibrationProgress: number;
  calibrationRemainingSeconds: number;
  calibrationResult: CalibrationResult | null;
  startCalibration: (durationSeconds?: 10 | 30) => void;
  cancelCalibration: () => void;
  applyCalibration: () => void;
}

export const useFocusStore = create<FocusStoreState>((set, get) => {
  const initialSettings = loadPersistedSettings();
  let calibrationFrames: EEGTelemetry[] = [];
  let calibrationTimer: ReturnType<typeof setInterval> | null = null;

  simulationEngine.subscribe((telemetry, feedbackState, sessionStats) => {
    const state = get();

    if (state.isCalibrating) {
      calibrationFrames.push(telemetry);
    }

    const shouldPlayAudio =
      state.settings.audioFeedbackEnabled &&
      feedbackState.isDimmingActive &&
      feedbackState.isContactOk &&
      !(state.settings.deviceSource === 'bluetooth' && !state.deviceStatus.connected);

    audioFeedback.sync(shouldPlayAudio, feedbackState.audioVolume);

    set({
      telemetry,
      feedbackState,
      sessionStats,
      activePreset: simulationEngine.getPreset(),
      isPaused: simulationEngine.getIsPaused(),
    });
  });

  simulationEngine.start(initialSettings);

  void tauriBridge.getDeviceStatus().then((status) => {
    set({ deviceStatus: status });
  });

  void tauriBridge.onBrainBitTelemetry((packet) => {
    if (get().settings.deviceSource === 'bluetooth') {
      simulationEngine.ingestExternalTelemetry(packet);
    }
  });

  void tauriBridge.onBrainBitRawSignal((packet) => {
    if (get().settings.deviceSource === 'bluetooth') {
      simulationEngine.ingestRawBrainBitPacket(packet);
    }
  });

  return {
    settings: initialSettings,

    updateSettings: (newSettings) => {
      const current = get().settings;
      simulationEngine.updateSettings(newSettings);
      const updated = simulationEngine.getSettings();
      savePersistedSettings(updated);

      if (!updated.audioFeedbackEnabled) {
        audioFeedback.sync(false, 0);
      }

      set({ settings: updated });

      if (newSettings.deviceSource && newSettings.deviceSource !== current.deviceSource) {
        audioFeedback.sync(false, 0);
        void tauriBridge.setDeviceSource(newSettings.deviceSource).then((deviceStatus) => {
          set({ deviceStatus });
        });
      }
    },

    viewMode: 'dashboard',
    setViewMode: (mode) => {
      if (mode === 'dashboard' && get().isClickThrough) {
        void tauriBridge.setClickThrough(false);
        set({ viewMode: mode, isClickThrough: false });
      } else {
        set({ viewMode: mode });
      }
      void tauriBridge.setOverlayMode(mode === 'hud');
    },

    isClickThrough: false,
    setClickThrough: async (enabled) => {
      await tauriBridge.setClickThrough(enabled);
      set({ isClickThrough: enabled });
    },
    toggleClickThrough: async () => {
      const target = !get().isClickThrough;
      await tauriBridge.setClickThrough(target);
      set({ isClickThrough: target });
    },

    isAlwaysOnTop: true,
    toggleAlwaysOnTop: async () => {
      const target = !get().isAlwaysOnTop;
      await tauriBridge.toggleAlwaysOnTop(target);
      set({ isAlwaysOnTop: target });
    },

    isSettingsOpen: false,
    setIsSettingsOpen: (open) => {
      if (open && get().isClickThrough) {
        void tauriBridge.setClickThrough(false);
        set({ isSettingsOpen: open, isClickThrough: false });
      } else {
        set({ isSettingsOpen: open });
      }
    },

    activeTab: 'monitor',
    setActiveTab: (tab) => set({ activeTab: tab }),

    telemetry: null,
    feedbackState: {
      currentMetric: 78,
      smoothedMetric: 78,
      deficit: 0,
      overlayOpacity: 0,
      blurRadius: 0,
      audioVolume: 0,
      isDimmingActive: false,
      isContactOk: true,
      isArtifactFrozen: false,
    },
    sessionStats: {
      durationSeconds: 0,
      timeInFocusSeconds: 0,
      timeInDimmingSeconds: 0,
      distractionEventsCount: 0,
      averageFocusScore: 0,
      minFocusScore: 0,
      maxFocusScore: 0,
      artifactCount: 0,
    },
    sessionHistory: loadSessionHistory(),
    sessionStartedAt: new Date().toISOString(),
    deviceStatus: {
      connected: true,
      deviceSource: 'simulator',
      connectionState: 'simulated',
      batteryPercentage: 100,
      deviceName: 'Synthetic EEG Generator (250 Hz)',
      samplingRateHz: 250,
      statusMessage: 'Synthetic 4-channel EEG stream active (demo/testing mode).',
    },
    isPaused: false,

    activePreset: 'calm_flow',
    setPreset: (preset) => {
      simulationEngine.setPreset(preset);
      set({ activePreset: preset });
    },

    injectArtifact: () => {
      simulationEngine.injectArtifact();
    },

    togglePause: () => {
      const paused = simulationEngine.togglePause();
      if (paused) {
        audioFeedback.sync(false, 0);
      }
      set({ isPaused: paused });
    },

    setElectrodeContact: (channel, ok) => {
      simulationEngine.setElectrodeQuality(channel, ok);
    },

    resetSession: (saveCurrent = true) => {
      const { sessionStats, settings, sessionStartedAt, sessionHistory } = get();
      let updatedHistory = sessionHistory;

      if (saveCurrent && sessionStats.durationSeconds >= 3) {
        const record: SessionRecord = {
          ...sessionStats,
          id: `${Date.now()}`,
          startedAt: sessionStartedAt,
          endedAt: new Date().toISOString(),
          mode: settings.mode,
          deviceSource: settings.deviceSource,
          threshold: settings.threshold,
        };
        updatedHistory = [record, ...sessionHistory].slice(0, 50);
        saveSessionHistory(updatedHistory);
      }

      simulationEngine.resetSession();
      audioFeedback.sync(false, 0);
      set({
        sessionHistory: updatedHistory,
        sessionStartedAt: new Date().toISOString(),
        sessionStats: simulationEngine.getSessionStats(),
      });
    },

    exportSessionsCsv: () => {
      if (typeof document === 'undefined') return;
      const { sessionHistory, sessionStats, settings, sessionStartedAt } = get();

      const rows: SessionRecord[] = [...sessionHistory];
      if (sessionStats.durationSeconds >= 1) {
        rows.unshift({
          ...sessionStats,
          id: 'active',
          startedAt: sessionStartedAt,
          endedAt: new Date().toISOString(),
          mode: settings.mode,
          deviceSource: settings.deviceSource,
          threshold: settings.threshold,
        });
      }

      const header = [
        'id',
        'started_at',
        'ended_at',
        'mode',
        'device_source',
        'threshold_pct',
        'duration_sec',
        'time_in_focus_sec',
        'time_in_dimming_sec',
        'distraction_dips',
        'avg_score_pct',
        'min_score_pct',
        'max_score_pct',
        'artifacts_count',
      ].join(',');

      const lines = rows.map((r) =>
        [
          r.id,
          r.startedAt,
          r.endedAt,
          r.mode,
          r.deviceSource,
          r.threshold,
          r.durationSeconds,
          r.timeInFocusSeconds,
          r.timeInDimmingSeconds,
          r.distractionEventsCount,
          r.averageFocusScore,
          r.minFocusScore,
          r.maxFocusScore,
          r.artifactCount,
        ].join(',')
      );

      const csv = [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = `focusglass-sessions-${dateStr}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    },

    isCalibrating: false,
    calibrationDurationSeconds: 10,
    setCalibrationDuration: (seconds) => set({ calibrationDurationSeconds: seconds }),
    calibrationProgress: 0,
    calibrationRemainingSeconds: 0,
    calibrationResult: null,

    startCalibration: (durationOverride) => {
      const state = get();
      if (state.isCalibrating) return;
      if (state.settings.deviceSource === 'bluetooth' && !state.deviceStatus.connected) {
        return;
      }

      const durationSec = durationOverride ?? state.calibrationDurationSeconds;
      calibrationFrames = [];
      const startedAt = Date.now();
      const totalMs = durationSec * 1000;

      if (calibrationTimer) {
        clearInterval(calibrationTimer);
      }

      set({
        isCalibrating: true,
        calibrationDurationSeconds: durationSec,
        calibrationProgress: 0,
        calibrationRemainingSeconds: durationSec,
        calibrationResult: null,
      });

      calibrationTimer = setInterval(() => {
        if (!get().isCalibrating) {
          if (calibrationTimer) clearInterval(calibrationTimer);
          calibrationTimer = null;
          return;
        }

        const elapsedMs = Date.now() - startedAt;
        const progress = Math.min(100, Math.round((elapsedMs / totalMs) * 100));
        const remainingSec = Math.max(0, Math.ceil((totalMs - elapsedMs) / 1000));

        if (elapsedMs >= totalMs) {
          if (calibrationTimer) clearInterval(calibrationTimer);
          calibrationTimer = null;
          const activeMode = get().settings.mode;
          const result = BiofeedbackEngine.calibrateBaseline(calibrationFrames, activeMode);
          calibrationFrames = [];
          set({
            isCalibrating: false,
            calibrationProgress: 100,
            calibrationRemainingSeconds: 0,
            calibrationResult: result,
          });
        } else {
          set({
            calibrationProgress: progress,
            calibrationRemainingSeconds: remainingSec,
          });
        }
      }, 200);
    },

    cancelCalibration: () => {
      if (calibrationTimer) {
        clearInterval(calibrationTimer);
        calibrationTimer = null;
      }
      calibrationFrames = [];
      set({
        isCalibrating: false,
        calibrationProgress: 0,
        calibrationRemainingSeconds: 0,
      });
    },

    applyCalibration: () => {
      const { calibrationResult, updateSettings } = get();
      if (calibrationResult && (calibrationResult.sampleCount ?? 1) > 0) {
        updateSettings({ threshold: calibrationResult.recommendedThreshold });
      }
    },
  };
});
