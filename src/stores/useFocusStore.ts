import { create } from 'zustand';
import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  DeviceStatus,
  PresetState,
  CalibrationResult,
  TimelineSample,
  SavedSessionRecord,
} from '../services/eegTypes.ts';
import { BiofeedbackEngine, DEFAULT_APP_SETTINGS } from '../services/biofeedbackEngine.ts';
import { simulationEngine, type GuidedDemoStatus } from '../services/simulationEngine.ts';
import { tauriBridge } from '../services/tauriBridge.ts';
import { audioBiofeedback } from '../services/audioBiofeedback.ts';
import { sessionRepository, downloadTextFile } from '../services/sessionRepository.ts';
import {
  parseEEGFromCSV,
  exportTimelineToCSV,
  exportSessionsJournalToCSV,
} from '../services/spectralMath.ts';

interface FocusStoreState {
  // Settings
  settings: FocusGlassSettings;
  updateSettings: (newSettings: Partial<FocusGlassSettings>) => void;

  // View & Window
  viewMode: 'dashboard' | 'hud';
  setViewMode: (mode: 'dashboard' | 'hud') => void;
  showWorkspacePreview: boolean;
  setShowWorkspacePreview: (show: boolean) => void;
  isClickThrough: boolean;
  setClickThrough: (enabled: boolean) => Promise<void>;
  toggleClickThrough: () => Promise<void>;
  isAlwaysOnTop: boolean;
  toggleAlwaysOnTop: () => Promise<void>;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  settingsInitialTab: 'bci' | 'device' | 'calibration' | 'hotkeys';
  openSettingsTab: (tab: 'bci' | 'device' | 'calibration' | 'hotkeys') => void;

  // Live Biometrics
  telemetry: EEGTelemetry | null;
  feedbackState: BiofeedbackFeedbackState;
  sessionStats: SessionStatistics;
  timeline: TimelineSample[];
  deviceStatus: DeviceStatus;
  isPaused: boolean;
  sessionStartedAt: Date;

  // Presets & Artifacts
  activePreset: PresetState;
  setPreset: (preset: PresetState) => void;
  injectArtifact: (kind?: 'blink' | 'jaw') => void;
  togglePause: () => void;
  setElectrodeContact: (channel: 't3' | 't4' | 'o1' | 'o2', ok: boolean) => void;

  // Guided Auto-Demo (Hands-free presentation)
  demoStatus: GuidedDemoStatus;
  startGuidedDemo: () => void;
  stopGuidedDemo: () => void;

  // CSV Replay
  replayInfo: { count: number; label: string };
  loadCSVReplay: (csvText: string, fileName: string) => { ok: boolean; count?: number; error?: string };
  loadDemoSampleCSV: () => void;

  // Session Journal & Export
  savedSessions: SavedSessionRecord[];
  saveAndResetSession: () => SavedSessionRecord | null;
  resetSessionStats: () => void;
  exportCurrentTimelineCSV: () => void;
  exportJournalCSV: () => void;
  clearSavedSessions: () => void;

  // Calibration
  isCalibrating: boolean;
  calibrationDurationSec: number;
  calibrationProgress: number; // 0 - 100
  calibrationResult: CalibrationResult | null;
  startCalibration: (durationSeconds?: number) => void;
  cancelCalibration: () => void;
  applyCalibration: () => void;
}

let calibrationTimer: ReturnType<typeof setInterval> | null = null;

export const useFocusStore = create<FocusStoreState>((set, get) => {
  // Subscribe store to live engine ticks
  simulationEngine.subscribe((telemetry, feedbackState, sessionStats, timeline, demoStatus) => {
    const currentSettings = get().settings;
    const paused = simulationEngine.getIsPaused();

    // Modulate Web Audio pink noise volume smoothly
    audioBiofeedback.setVolume(
      paused ? 0 : feedbackState.audioVolume,
      currentSettings.audioFeedbackEnabled && !paused && currentSettings.deviceSource !== 'bluetooth'
    );

    set({
      telemetry,
      feedbackState,
      sessionStats,
      timeline: [...timeline],
      demoStatus,
      activePreset: simulationEngine.getPreset(),
      isPaused: paused,
    });
  });

  simulationEngine.start(DEFAULT_APP_SETTINGS);

  // Query initial honest device status
  void tauriBridge.getDeviceStatus(DEFAULT_APP_SETTINGS.deviceSource).then((deviceStatus) => {
    set({ deviceStatus });
  });

  return {
    settings: DEFAULT_APP_SETTINGS,

    updateSettings: (newSettings) => {
      if (newSettings.audioFeedbackEnabled === true) {
        audioBiofeedback.unlock();
      }

      const merged = { ...get().settings, ...newSettings };
      const updatedFeedback = simulationEngine.updateSettings(newSettings);

      audioBiofeedback.setVolume(
        get().isPaused ? 0 : updatedFeedback.audioVolume,
        merged.audioFeedbackEnabled && !get().isPaused && merged.deviceSource !== 'bluetooth'
      );

      set({
        settings: merged,
        feedbackState: updatedFeedback,
      });

      if (newSettings.deviceSource !== undefined) {
        const replayLabel = simulationEngine.getReplayInfo().label;
        void tauriBridge.getDeviceStatus(newSettings.deviceSource, replayLabel).then((deviceStatus) => {
          set({ deviceStatus });
        });
      }
    },

    viewMode: 'dashboard',
    setViewMode: (mode) => set({ viewMode: mode }),

    showWorkspacePreview: true,
    setShowWorkspacePreview: (show) => set({ showWorkspacePreview: show }),

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
    setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),
    settingsInitialTab: 'bci',
    openSettingsTab: (tab) => set({ settingsInitialTab: tab, isSettingsOpen: true }),

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
      isContactPaused: false,
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
    timeline: [],
    deviceStatus: {
      connected: true,
      deviceSource: 'simulator',
      batteryPercentage: null,
      deviceName: 'Симулятор ЭЭГ (250 Гц · α/β/θ)',
      samplingRateHz: 250,
      isSimulated: true,
      sdkIntegrated: false,
      statusNote: 'Демонстрационная математическая модель сигнала (без физического BrainBit).',
    },
    isPaused: false,
    sessionStartedAt: new Date(),

    activePreset: 'calm_flow',
    setPreset: (preset) => {
      simulationEngine.stopGuidedDemo();
      simulationEngine.setPreset(preset);
      set({ activePreset: preset, demoStatus: simulationEngine.getGuidedDemoStatus() });
    },

    injectArtifact: (kind = 'blink') => {
      simulationEngine.injectArtifact(kind);
    },

    togglePause: () => {
      const paused = simulationEngine.togglePause();
      if (paused) {
        audioBiofeedback.setVolume(0, false);
      }
      set({ isPaused: paused });
    },

    setElectrodeContact: (channel, ok) => {
      simulationEngine.setElectrodeQuality(channel, ok);
    },

    demoStatus: simulationEngine.getGuidedDemoStatus(),
    startGuidedDemo: () => {
      if (get().settings.deviceSource !== 'simulator') {
        get().updateSettings({ deviceSource: 'simulator' });
      }
      simulationEngine.startGuidedDemo();
      set({
        demoStatus: simulationEngine.getGuidedDemoStatus(),
        isPaused: false,
      });
    },
    stopGuidedDemo: () => {
      simulationEngine.stopGuidedDemo();
      set({ demoStatus: simulationEngine.getGuidedDemoStatus() });
    },

    replayInfo: { count: 0, label: '' },
    loadCSVReplay: (csvText, fileName) => {
      try {
        const frames = parseEEGFromCSV(csvText);
        simulationEngine.loadReplayFrames(frames, fileName);
        const replayInfo = simulationEngine.getReplayInfo();
        set({ replayInfo });
        get().updateSettings({ deviceSource: 'csv_replay' });
        return { ok: true, count: frames.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Ошибка разбора CSV';
        return { ok: false, error: msg };
      }
    },

    loadDemoSampleCSV: () => {
      // Synthesize a 12-second (3000-sample @ 250Hz) 4-channel raw uV CSV without precomputed metrics
      // so spectralMath genuinely calculates Beta/Alpha spectra from raw T3,T4,O1,O2 microvolts!
      const rows = ['timestamp,t3,t4,o1,o2'];
      const t0 = Date.now();
      for (let i = 0; i < 3000; i++) {
        const t = i / 250;
        const isFocusPhase = t < 5 || t >= 9;
        const alphaAmp = isFocusPhase ? 9 : 34;
        const betaAmp = isFocusPhase ? 34 : 9;
        const thetaAmp = isFocusPhase ? 6 : 24;
        const blink = i >= 1600 && i < 1650 ? Math.sin(((i - 1600) / 50) * Math.PI) * 185 : 0;

        const t3 = (Math.sin(2 * Math.PI * 21 * t) * betaAmp + Math.cos(2 * Math.PI * 10 * t) * alphaAmp + blink).toFixed(2);
        const t4 = (Math.sin(2 * Math.PI * 21 * t + 0.3) * betaAmp + Math.cos(2 * Math.PI * 10 * t + 0.3) * alphaAmp + blink).toFixed(2);
        const o1 = (Math.sin(2 * Math.PI * 10 * t) * alphaAmp * 1.5 + Math.cos(2 * Math.PI * 6 * t) * thetaAmp).toFixed(2);
        const o2 = (Math.sin(2 * Math.PI * 10 * t + 0.25) * alphaAmp * 1.5 + Math.cos(2 * Math.PI * 6 * t + 0.2) * thetaAmp).toFixed(2);
        rows.push(`${t0 + i * 4},${t3},${t4},${o1},${o2}`);
      }
      get().loadCSVReplay(rows.join('\n'), 'demo_4ch_raw_250Hz.csv');
    },

    savedSessions: sessionRepository.getAllSessions(),

    saveAndResetSession: () => {
      const stats = simulationEngine.getSessionStats();
      if (stats.durationSeconds < 1) return null;
      const { settings, sessionStartedAt } = get();
      const saved = sessionRepository.saveSession({
        startedAt: sessionStartedAt,
        endedAt: new Date(),
        deviceSource: settings.deviceSource,
        mode: settings.mode,
        threshold: settings.threshold,
        stats,
      });
      simulationEngine.resetSession();
      set({
        savedSessions: sessionRepository.getAllSessions(),
        sessionStats: simulationEngine.getSessionStats(),
        timeline: [],
        sessionStartedAt: new Date(),
      });
      return saved;
    },

    resetSessionStats: () => {
      simulationEngine.resetSession();
      set({
        sessionStats: simulationEngine.getSessionStats(),
        timeline: [],
        sessionStartedAt: new Date(),
      });
    },

    exportCurrentTimelineCSV: () => {
      const csv = exportTimelineToCSV(simulationEngine.getTimelineBuffer());
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadTextFile(`focusglass_timeline_${stamp}.csv`, csv);
    },

    exportJournalCSV: () => {
      const sessions = sessionRepository.getAllSessions();
      const csv = exportSessionsJournalToCSV(sessions);
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      downloadTextFile(`focusglass_sessions_${stamp}.csv`, csv);
    },

    clearSavedSessions: () => {
      sessionRepository.clearSessions();
      set({ savedSessions: [] });
    },

    isCalibrating: false,
    calibrationDurationSec: 6,
    calibrationProgress: 0,
    calibrationResult: null,

    startCalibration: (durationSeconds = 6) => {
      if (get().isCalibrating) return;
      if (calibrationTimer) clearInterval(calibrationTimer);

      const safeDuration = Math.max(3, Math.min(60, durationSeconds));
      set({
        isCalibrating: true,
        calibrationDurationSec: safeDuration,
        calibrationProgress: 0,
        calibrationResult: null,
      });

      const startBufferIndex = simulationEngine.getRawBuffer().length;
      const collectedFrames: EEGTelemetry[] = [];
      let lastSeenLen = startBufferIndex;

      const tickMs = 150;
      const totalTicks = Math.max(1, Math.round((safeDuration * 1000) / tickMs));
      let tickCount = 0;

      calibrationTimer = setInterval(() => {
        if (!get().isCalibrating) {
          if (calibrationTimer) clearInterval(calibrationTimer);
          calibrationTimer = null;
          return;
        }

        const currentBuf = simulationEngine.getRawBuffer();
        if (currentBuf.length > lastSeenLen) {
          const fresh = currentBuf.slice(lastSeenLen);
          collectedFrames.push(...fresh);
        } else if (currentBuf.length > 0) {
          collectedFrames.push(...currentBuf.slice(-38));
        }
        lastSeenLen = currentBuf.length;

        tickCount++;
        const progress = Math.min(100, Math.round((tickCount / totalTicks) * 100));

        if (tickCount >= totalTicks) {
          if (calibrationTimer) clearInterval(calibrationTimer);
          calibrationTimer = null;

          const activeMode = get().settings.mode;
          const result = BiofeedbackEngine.calibrateBaseline(collectedFrames, activeMode);
          set({
            isCalibrating: false,
            calibrationProgress: 100,
            calibrationResult: result,
          });
        } else {
          set({ calibrationProgress: progress });
        }
      }, tickMs);
    },

    cancelCalibration: () => {
      if (calibrationTimer) {
        clearInterval(calibrationTimer);
        calibrationTimer = null;
      }
      set({ isCalibrating: false, calibrationProgress: 0 });
    },

    applyCalibration: () => {
      const { calibrationResult, updateSettings } = get();
      if (calibrationResult) {
        updateSettings({ threshold: calibrationResult.recommendedThreshold });
      }
    },
  };
});
