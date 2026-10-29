import { create } from 'zustand';
import type {
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  SessionStatistics,
  DeviceStatus,
  PresetState,
  CalibrationResult,
} from '../services/eegTypes';
import { simulationEngine } from '../services/simulationEngine';
import { tauriBridge } from '../services/tauriBridge';

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
  setActiveTab: (tab: 'monitor' | 'oscilloscope' | 'electrodes' | 'calibration' | 'analytics' | 'settings') => void;

  // Live Biometrics
  telemetry: EEGTelemetry | null;
  feedbackState: BiofeedbackFeedbackState;
  sessionStats: SessionStatistics;
  deviceStatus: DeviceStatus;
  isPaused: boolean;

  // Preset
  activePreset: PresetState;
  setPreset: (preset: PresetState) => void;
  injectArtifact: () => void;
  togglePause: () => void;
  setElectrodeContact: (channel: 't3' | 't4' | 'o1' | 'o2', ok: boolean) => void;

  // Calibration
  isCalibrating: boolean;
  calibrationProgress: number; // 0 - 100
  calibrationResult: CalibrationResult | null;
  startCalibration: () => void;
  applyCalibration: () => void;
}

const DEFAULT_SETTINGS: FocusGlassSettings = {
  mode: 'concentration',
  deviceSource: 'simulator',
  threshold: 60,
  sensitivitySeconds: 2.0,
  dimmingMaxOpacity: 0.70,
  blurRadius: 16,
  audioFeedbackEnabled: false,
  glassOpacity: 0.85,
};

export const useFocusStore = create<FocusStoreState>((set, get) => {
  // Initialize and connect simulation engine
  simulationEngine.subscribe((telemetry, feedbackState, sessionStats) => {
    set({
      telemetry,
      feedbackState,
      sessionStats,
      activePreset: simulationEngine.getPreset(),
      isPaused: simulationEngine.getIsPaused(),
    });
  });

  // Start the engine
  simulationEngine.start(DEFAULT_SETTINGS);

  return {
    settings: DEFAULT_SETTINGS,

    updateSettings: (newSettings) => {
      set((state) => {
        const updated = { ...state.settings, ...newSettings };
        if (newSettings.sensitivitySeconds !== undefined) {
          simulationEngine.updateBufferSize(newSettings.sensitivitySeconds);
        }
        return { settings: updated };
      });
    },

    viewMode: 'dashboard',
    setViewMode: (mode) => set({ viewMode: mode }),

    isClickThrough: false,
    setClickThrough: async (enabled) => {
      await tauriBridge.setClickThrough(enabled);
      set({ isClickThrough: enabled });
    },
    toggleClickThrough: async () => {
      const current = get().isClickThrough;
      const target = !current;
      await tauriBridge.setClickThrough(target);
      set({ isClickThrough: target });
    },

    isAlwaysOnTop: true,
    toggleAlwaysOnTop: async () => {
      const current = get().isAlwaysOnTop;
      const target = !current;
      await tauriBridge.toggleAlwaysOnTop(target);
      set({ isAlwaysOnTop: target });
    },

    isSettingsOpen: false,
    setIsSettingsOpen: (open) => set({ isSettingsOpen: open }),

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
      averageFocusScore: 78,
      minFocusScore: 78,
      maxFocusScore: 78,
      artifactCount: 0,
    },
    deviceStatus: {
      connected: true,
      deviceSource: 'simulator',
      batteryPercentage: 92,
      deviceName: 'BrainBit Headband BLE (250Hz)',
      samplingRateHz: 250,
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
      set({ isPaused: paused });
    },

    setElectrodeContact: (channel, ok) => {
      simulationEngine.setElectrodeQuality(channel, ok);
    },

    isCalibrating: false,
    calibrationProgress: 0,
    calibrationResult: null,

    startCalibration: () => {
      if (get().isCalibrating) return;
      set({ isCalibrating: true, calibrationProgress: 0, calibrationResult: null });

      const frames: number[] = [];
      const interval = setInterval(() => {
        const { telemetry, isCalibrating } = get();
        if (!isCalibrating) {
          clearInterval(interval);
          return;
        }

        if (telemetry && !telemetry.isArtifact) {
          frames.push(telemetry.concentration);
        }

        set((s) => {
          const next = s.calibrationProgress + 5;
          if (next >= 100) {
            clearInterval(interval);
            const avg = frames.reduce((a, b) => a + b, 0) / (frames.length || 1);
            const result: CalibrationResult = {
              baselineFocus: Number(avg.toFixed(1)),
              baselineRelaxation: 65,
              recommendedThreshold: Math.max(40, Math.min(85, Math.round(avg - 8))),
              confidence: 0.94,
            };
            return {
              isCalibrating: false,
              calibrationProgress: 100,
              calibrationResult: result,
            };
          }
          return { calibrationProgress: next };
        });
      }, 150);
    },

    applyCalibration: () => {
      const { calibrationResult, updateSettings } = get();
      if (calibrationResult) {
        updateSettings({ threshold: calibrationResult.recommendedThreshold });
      }
    },
  };
});
