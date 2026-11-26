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
  FeedbackStyle,
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

function generateSeedHistory(): SessionRecord[] {
  const now = Date.now();
  return [
    {
      id: `${now - 1000 * 60 * 60 * 2}`,
      startedAt: new Date(now - 1000 * 60 * 52).toISOString(),
      endedAt: new Date(now).toISOString(),
      mode: 'concentration',
      deviceSource: 'simulator',
      threshold: 55,
      durationSeconds: 52 * 60,
      timeInFocusSeconds: Math.round(52 * 60 * 0.78),
      timeInDimmingSeconds: Math.round(52 * 60 * 0.22),
      distractionEventsCount: 5,
      averageFocusScore: 78,
      minFocusScore: 42,
      maxFocusScore: 92,
      artifactCount: 3,
    },
    {
      id: `${now - 1000 * 60 * 60 * 24}`,
      startedAt: new Date(now - 1000 * 60 * 60 * 24).toISOString(),
      endedAt: new Date(now - 1000 * 60 * 60 * 24 + 1000 * 60 * 80).toISOString(),
      mode: 'concentration',
      deviceSource: 'simulator',
      threshold: 55,
      durationSeconds: 80 * 60,
      timeInFocusSeconds: Math.round(80 * 60 * 0.74),
      timeInDimmingSeconds: Math.round(80 * 60 * 0.26),
      distractionEventsCount: 7,
      averageFocusScore: 74,
      minFocusScore: 38,
      maxFocusScore: 95,
      artifactCount: 5,
    },
    {
      id: `${now - 1000 * 60 * 60 * 48}`,
      startedAt: new Date(now - 1000 * 60 * 60 * 48).toISOString(),
      endedAt: new Date(now - 1000 * 60 * 60 * 48 + 1000 * 60 * 45).toISOString(),
      mode: 'concentration',
      deviceSource: 'simulator',
      threshold: 55,
      durationSeconds: 45 * 60,
      timeInFocusSeconds: Math.round(45 * 60 * 0.66),
      timeInDimmingSeconds: Math.round(45 * 60 * 0.34),
      distractionEventsCount: 6,
      averageFocusScore: 66,
      minFocusScore: 35,
      maxFocusScore: 88,
      artifactCount: 4,
    },
    {
      id: `${now - 1000 * 60 * 60 * 53}`,
      startedAt: new Date(now - 1000 * 60 * 60 * 53).toISOString(),
      endedAt: new Date(now - 1000 * 60 * 60 * 53 + 1000 * 60 * 38).toISOString(),
      mode: 'concentration',
      deviceSource: 'simulator',
      threshold: 55,
      durationSeconds: 38 * 60,
      timeInFocusSeconds: Math.round(38 * 60 * 0.81),
      timeInDimmingSeconds: Math.round(38 * 60 * 0.19),
      distractionEventsCount: 2,
      averageFocusScore: 81,
      minFocusScore: 48,
      maxFocusScore: 96,
      artifactCount: 1,
    },
    {
      id: `${now - 1000 * 60 * 60 * 72}`,
      startedAt: new Date(now - 1000 * 60 * 60 * 72).toISOString(),
      endedAt: new Date(now - 1000 * 60 * 60 * 72 + 1000 * 60 * 65).toISOString(),
      mode: 'concentration',
      deviceSource: 'simulator',
      threshold: 55,
      durationSeconds: 65 * 60,
      timeInFocusSeconds: Math.round(65 * 60 * 0.58),
      timeInDimmingSeconds: Math.round(65 * 60 * 0.42),
      distractionEventsCount: 11,
      averageFocusScore: 58,
      minFocusScore: 28,
      maxFocusScore: 85,
      artifactCount: 8,
    },
  ];
}

function loadSessionHistory(): SessionRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return generateSeedHistory();
  try {
    const raw = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return generateSeedHistory();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as SessionRecord[]) : generateSeedHistory();
  } catch {
    return generateSeedHistory();
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

export interface FocusTimelinePoint {
  time: string;
  timestamp: number;
  focus: number;
  isDip: boolean;
}

function generateInitialTimeline(threshold: number): FocusTimelinePoint[] {
  const points: FocusTimelinePoint[] = [];
  const now = Date.now();
  // 24 points spanning the last 10 minutes (each ~25 seconds)
  const baseCurve = [
    68, 72, 75, 76, 78, 80, 77, 72, 64, 48, 42, 58, 68, 75, 79, 82, 80, 78, 62, 50, 46, 60, 72, 78
  ];
  for (let i = 0; i < baseCurve.length; i++) {
    const val = baseCurve[i];
    const ts = now - (baseCurve.length - 1 - i) * 25000;
    const d = new Date(ts);
    points.push({
      time: d.toLocaleTimeString('ru-RU', { minute: '2-digit', second: '2-digit' }),
      timestamp: ts,
      focus: val,
      isDip: val < threshold,
    });
  }
  return points;
}

interface FocusStoreState {
  // Navigation & Redesign Screens
  activeNav: 'session' | 'history' | 'device' | 'settings' | 'onboarding' | 'summary';
  setActiveNav: (nav: 'session' | 'history' | 'device' | 'settings' | 'onboarding' | 'summary') => void;
  onboardingStep: 'welcome' | 'connect' | 'sensors' | 'calibrating' | 'done';
  setOnboardingStep: (step: 'welcome' | 'connect' | 'sensors' | 'calibrating' | 'done') => void;
  focusTimeline: FocusTimelinePoint[];
  lastCompletedSession: SessionRecord | null;
  isSessionEnded: boolean;
  finishSession: () => void;
  openSessionSummary: (record: SessionRecord) => void;
  startNewSession: () => void;
  isGentleAlertDismissed: boolean;
  dismissGentleAlert: () => void;
  settingsSubTab: 'feedback' | 'sensitivity' | 'sound' | 'hotkeys';
  setSettingsSubTab: (tab: 'feedback' | 'sensitivity' | 'sound' | 'hotkeys') => void;
  feedbackStyle: FeedbackStyle;
  setFeedbackStyle: (style: FeedbackStyle) => void;

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
  pauseForMinutes: (minutes: number) => void;
  setElectrodeContact: (channel: 't3' | 't4' | 'o1' | 'o2', ok: boolean) => void;
  resetSession: (saveCurrent?: boolean) => void;
  exportSessionsCsv: (singleRecord?: SessionRecord) => void;

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
  let pauseResumeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTimelineSample = Date.now();

  const clearPauseResumeTimer = () => {
    if (pauseResumeTimer) {
      clearTimeout(pauseResumeTimer);
      pauseResumeTimer = null;
    }
  };

  simulationEngine.subscribe((telemetry, feedbackState, sessionStats) => {
    const state = get();

    if (state.isCalibrating) {
      calibrationFrames.push(telemetry);
    }

    const isSummaryOrEnded = state.isSessionEnded || state.activeNav === 'summary';
    const shouldPlayAudio =
      !state.isPaused &&
      !isSummaryOrEnded &&
      state.settings.audioFeedbackEnabled &&
      feedbackState.isDimmingActive &&
      feedbackState.isContactOk &&
      !(state.settings.deviceSource === 'bluetooth' && !state.deviceStatus.connected);

    audioFeedback.sync(shouldPlayAudio, feedbackState.audioVolume);

    const now = Date.now();
    let updatedTimeline = state.focusTimeline;
    const hasContactSignal =
      telemetry.signalQuality.t3 ||
      telemetry.signalQuality.t4 ||
      telemetry.signalQuality.o1 ||
      telemetry.signalQuality.o2;
    const canRecordTimeline =
      !state.isPaused &&
      !isSummaryOrEnded &&
      (state.settings.deviceSource === 'simulator' || hasContactSignal);

    if (canRecordTimeline && now - lastTimelineSample >= 1000) {
      lastTimelineSample = now;
      const currentMetric = Math.round(feedbackState.smoothedMetric);
      const isDip = currentMetric < state.settings.threshold;
      const newPoint: FocusTimelinePoint = {
        time: new Date().toLocaleTimeString('ru-RU', { minute: '2-digit', second: '2-digit' }),
        timestamp: now,
        focus: currentMetric,
        isDip,
      };
      updatedTimeline = [...state.focusTimeline.slice(-599), newPoint];
    }

    set({
      telemetry,
      feedbackState,
      sessionStats: state.isSessionEnded ? state.sessionStats : sessionStats,
      focusTimeline: updatedTimeline,
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
    activeNav: 'session',
    setActiveNav: (nav) => {
      const state = get();
      if (nav === 'session' && (state.activeNav === 'summary' || state.isSessionEnded)) {
        state.startNewSession();
        return;
      }
      set({ activeNav: nav });
    },
    onboardingStep: 'welcome',
    setOnboardingStep: (step) => set({ onboardingStep: step }),
    focusTimeline:
      initialSettings.deviceSource === 'bluetooth'
        ? []
        : generateInitialTimeline(initialSettings.threshold),
    lastCompletedSession: null,
    isSessionEnded: false,
    isGentleAlertDismissed: false,
    dismissGentleAlert: () => set({ isGentleAlertDismissed: true }),
    settingsSubTab: 'feedback',
    setSettingsSubTab: (tab) => set({ settingsSubTab: tab }),
    feedbackStyle: initialSettings.feedbackStyle ?? 'dimming',
    setFeedbackStyle: (style) => {
      get().updateSettings({ feedbackStyle: style });
    },

    finishSession: () => {
      clearPauseResumeTimer();
      const { sessionStats, settings, sessionStartedAt, sessionHistory, focusTimeline } = get();
      const record: SessionRecord = {
        ...sessionStats,
        id: `${Date.now()}`,
        startedAt: sessionStartedAt,
        endedAt: new Date().toISOString(),
        mode: settings.mode,
        deviceSource: settings.deviceSource,
        threshold: settings.threshold,
        timeline: [...focusTimeline],
      };
      const updatedHistory = [record, ...sessionHistory].slice(0, 50);
      saveSessionHistory(updatedHistory);
      audioFeedback.sync(false, 0);
      get().resetSession(false);
      set({
        lastCompletedSession: record,
        sessionHistory: updatedHistory,
        activeNav: 'summary',
        isSessionEnded: true,
      });
    },

    openSessionSummary: (record) => {
      set({
        lastCompletedSession: record,
        activeNav: 'summary',
      });
    },

    startNewSession: () => {
      clearPauseResumeTimer();
      if (simulationEngine.getIsPaused()) {
        simulationEngine.togglePause();
      }
      const isBluetooth = get().settings.deviceSource === 'bluetooth';
      get().resetSession(false);
      set({
        activeNav: 'session',
        focusTimeline: [],
        lastCompletedSession: null,
        isGentleAlertDismissed: false,
        isSessionEnded: false,
        isPaused: false,
        ...(isBluetooth
          ? {
              telemetry: null,
              feedbackState: {
                currentMetric: 0,
                smoothedMetric: 0,
                deficit: 0,
                overlayOpacity: 0,
                blurRadius: 0,
                audioVolume: 0,
                isDimmingActive: false,
                isContactOk: false,
                isArtifactFrozen: false,
              },
            }
          : {}),
      });
    },

    settings: initialSettings,

    updateSettings: (newSettings) => {
      const current = get().settings;
      const isSwitchingSource =
        Boolean(newSettings.deviceSource) && newSettings.deviceSource !== current.deviceSource;

      simulationEngine.updateSettings(newSettings);
      const updated = simulationEngine.getSettings();
      savePersistedSettings(updated);

      if (!updated.audioFeedbackEnabled) {
        audioFeedback.sync(false, 0);
      }

      if (isSwitchingSource) {
        audioFeedback.sync(false, 0);
        simulationEngine.resetSession();
        const isBluetooth = updated.deviceSource === 'bluetooth';
        set({
          settings: updated,
          feedbackStyle: updated.feedbackStyle ?? 'dimming',
          sessionStartedAt: new Date().toISOString(),
          sessionStats: simulationEngine.getSessionStats(),
          focusTimeline: isBluetooth ? [] : generateInitialTimeline(updated.threshold),
          isSessionEnded: false,
          isGentleAlertDismissed: false,
          ...(isBluetooth
            ? {
                telemetry: null,
                feedbackState: {
                  currentMetric: 0,
                  smoothedMetric: 0,
                  deficit: 0,
                  overlayOpacity: 0,
                  blurRadius: 0,
                  audioVolume: 0,
                  isDimmingActive: false,
                  isContactOk: false,
                  isArtifactFrozen: false,
                },
              }
            : {}),
        });
        void tauriBridge.setDeviceSource(updated.deviceSource).then((deviceStatus) => {
          set({ deviceStatus });
        });
        return;
      }

      set({
        settings: updated,
        feedbackStyle: updated.feedbackStyle ?? 'dimming',
      });
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
      clearPauseResumeTimer();
      const paused = simulationEngine.togglePause();
      if (paused) {
        audioFeedback.sync(false, 0);
      }
      set({ isPaused: paused });
    },

    pauseForMinutes: (minutes) => {
      clearPauseResumeTimer();
      if (!simulationEngine.getIsPaused()) {
        simulationEngine.togglePause();
      }
      audioFeedback.sync(false, 0);
      set({ isPaused: true });

      const ms = Math.max(1000, Math.round(minutes * 60 * 1000));
      pauseResumeTimer = setTimeout(() => {
        pauseResumeTimer = null;
        if (simulationEngine.getIsPaused()) {
          const paused = simulationEngine.togglePause();
          set({ isPaused: paused, isGentleAlertDismissed: false });
        }
      }, ms);
    },

    setElectrodeContact: (channel, ok) => {
      simulationEngine.setElectrodeQuality(channel, ok);
    },

    resetSession: (saveCurrent = true) => {
      clearPauseResumeTimer();
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
        ...(settings.deviceSource === 'bluetooth' ? { focusTimeline: [] } : {}),
      });
    },

    exportSessionsCsv: (singleRecord) => {
      if (typeof document === 'undefined') return;
      const { sessionHistory, sessionStats, settings, sessionStartedAt } = get();

      const rows: SessionRecord[] = singleRecord ? [singleRecord] : [...sessionHistory];
      if (!singleRecord && sessionStats.durationSeconds >= 1) {
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

      const escapeCsv = (val: string | number) => {
        const s = String(val);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

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
        ]
          .map(escapeCsv)
          .join(',')
      );

      const csv = [header, ...lines].join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const dateStr = new Date().toISOString().slice(0, 10);
      link.href = url;
      link.download = singleRecord
        ? `focusglass-session-${dateStr}.csv`
        : `focusglass-sessions-${dateStr}.csv`;
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
          const stateAfter = get();
          const result: CalibrationResult = {
            ...BiofeedbackEngine.calibrateBaseline(calibrationFrames, stateAfter.settings.mode),
            deviceSource: stateAfter.settings.deviceSource,
            calibratedAt: new Date().toISOString(),
          };
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
