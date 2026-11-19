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
  ForegroundWindowInfo,
  HudAction,
  OverlayFrame,
  BrainBitStreamMode,
  ChannelResistanceKOhm,
  DumpSampleInput,
  EegDumpStatus,
} from '../services/eegTypes';
import type { EEGRecording } from '../services/eegRecording';
import { parseEEGRecording } from '../services/eegRecording';
import { RecordingPlayback } from '../services/recordingPlayback';
import { BiofeedbackEngine } from '../services/biofeedbackEngine';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../services/settingsSchema';
import { simulationEngine } from '../services/simulationEngine';
import { audioFeedback } from '../services/audioFeedback';
import { tauriBridge } from '../services/tauriBridge';
import { FitStabilityTracker } from '../services/headbandFitCheck';
import { areAllElectrodesUsable } from '../services/signalQuality';
import {
  createSessionRepository,
  mergeSession,
  type SessionStorageBackend,
} from '../services/sessionRepository';

const SETTINGS_STORAGE_KEY = 'focusglass.settings.v1';
const CALIBRATION_STORAGE_KEY = 'focusglass.calibration.v1';
/** Сессии короче этого значения в историю не попадают. */
const MIN_SESSION_SECONDS = 3;
const AUTOSAVE_INTERVAL_MS = 5000;
/** Период публикации состояния БОС в единое окно оверлея (~15 Гц). */
const OVERLAY_PUBLISH_INTERVAL_MS = 66;

const hasWindow = typeof window !== 'undefined';
const isTauri = tauriBridge.isTauri();

function loadPersistedCalibration(): CalibrationResult | null {
  if (!hasWindow || !window.localStorage) return null;
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(CALIBRATION_STORAGE_KEY) ?? 'null'
    ) as CalibrationResult | null;
    if (
      !parsed ||
      !Number.isFinite(parsed.baselineFocus) ||
      !Number.isFinite(parsed.baselineRelaxation) ||
      !Number.isFinite(parsed.variabilityFocus) ||
      !Number.isFinite(parsed.variabilityRelaxation) ||
      !Number.isFinite(parsed.recommendedThreshold) ||
      (parsed.sampleCount ?? 0) <= 0
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function savePersistedCalibration(calibration: CalibrationResult): void {
  if (!hasWindow || !window.localStorage) return;
  try {
    window.localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(calibration));
  } catch {
    // Keep the active in-memory baseline if browser storage is unavailable.
  }
}

function loadPersistedSettings(): FocusGlassSettings {
  if (!hasWindow || !window.localStorage) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    // localStorage is untrusted (hand-edited, older schema, corrupted): validate every field.
    return {
      ...sanitizeSettings(JSON.parse(raw) as unknown),
      // Always start in simulator until physical BrainBit session is explicitly selected
      deviceSource: 'simulator',
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function savePersistedSettings(settings: FocusGlassSettings): void {
  if (!hasWindow || !window.localStorage) return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}

function newSessionId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface UiNotice {
  id: number;
  kind: 'error' | 'info';
  text: string;
}

interface FocusStoreState {
  // Settings
  settings: FocusGlassSettings;
  updateSettings: (newSettings: Partial<FocusGlassSettings>) => void;

  // View & Window
  isTauri: boolean;
  viewMode: 'dashboard' | 'hud';
  setViewMode: (mode: 'dashboard' | 'hud') => void;
  isClickThrough: boolean;
  setClickThrough: (enabled: boolean) => Promise<void>;
  toggleClickThrough: () => Promise<void>;
  isAlwaysOnTop: boolean;
  toggleAlwaysOnTop: () => Promise<void>;
  overlayEnabled: boolean;
  setOverlayEnabled: (enabled: boolean) => Promise<void>;
  isSettingsOpen: boolean;
  setIsSettingsOpen: (open: boolean) => void;
  activeTab: 'monitor' | 'oscilloscope' | 'electrodes' | 'calibration' | 'analytics' | 'settings';
  setActiveTab: (
    tab: 'monitor' | 'oscilloscope' | 'electrodes' | 'calibration' | 'analytics' | 'settings'
  ) => void;
  notice: UiNotice | null;
  showNotice: (kind: UiNotice['kind'], text: string) => void;
  dismissNotice: () => void;
  quit: () => Promise<void>;

  // Live Biometrics
  telemetry: EEGTelemetry | null;
  feedbackState: BiofeedbackFeedbackState;
  sessionStats: SessionStatistics;
  sessionHistory: SessionRecord[];
  sessionStorageBackend: SessionStorageBackend;
  sessionId: string;
  sessionStartedAt: string;
  deviceStatus: DeviceStatus;
  /** Native overlay windows created by the backend; 0 means the in-page overlay is used. */
  overlayWindowCount: number;
  /** True on Windows when unified `overlay` window hosts dimming + HUD. */
  unifiedHud: boolean;
  isPaused: boolean;

  // Smart distraction blocking
  distractionSupported: boolean;
  foregroundWindow: ForegroundWindowInfo | null;

  // BrainBit BLE & Fit Check
  fitHoldMs: number;
  fitVerified: boolean;
  lastFitResistance: ChannelResistanceKOhm | null;
  connectBrainBitDevice: (address: string, initialMode?: BrainBitStreamMode) => Promise<DeviceStatus>;
  disconnectBrainBitDevice: () => Promise<void>;
  startFitCheck: () => Promise<void>;
  startEegStreamFromFitCheck: () => Promise<void>;

  // Raw 250 Hz EEG CSV Dump Recorder
  dumpStatus: EegDumpStatus;
  startEegDump: (sessionTag?: string) => Promise<void>;
  stopEegDump: () => Promise<void>;
  setEegDumpLabel: (label: string, oneShot?: boolean) => Promise<void>;
  openEegDumpsFolder: () => Promise<void>;

  // Controls
  activePreset: PresetState;
  setPreset: (preset: PresetState) => void;
  injectArtifact: () => void;
  togglePause: () => void;
  setElectrodeContact: (channel: 't3' | 't4' | 'o1' | 'o2', ok: boolean) => void;
  resetSession: (saveCurrent?: boolean) => void;
  persistActiveSession: () => Promise<void>;
  clearSessionHistory: () => Promise<void>;
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
  activeCalibration: CalibrationResult | null;

  // Prerecorded Neurotech/BrainBit stream playback
  recording: EEGRecording | null;
  recordingStatus: 'empty' | 'ready' | 'playing' | 'paused' | 'ended';
  recordingProgress: number;
  recordingSpeed: number;
  recordingError: string | null;
  loadRecording: (text: string, name: string) => void;
  playRecording: () => void;
  pauseRecording: () => void;
  stopRecording: () => void;
  seekRecording: (progress: number) => void;
  setRecordingSpeed: (speed: number) => void;
}

export const useFocusStore = create<FocusStoreState>((set, get) => {
  const initialSettings = loadPersistedSettings();
  const playback = new RecordingPlayback();
  const storedCalibration = loadPersistedCalibration();
  const sessions = createSessionRepository();
  const fitStability = new FitStabilityTracker();
  let simulatorWasPausedBeforePlayback: boolean | null = null;
  let calibrationFrames: EEGTelemetry[] = [];
  let calibrationTimer: ReturnType<typeof setInterval> | null = null;
  let noticeCounter = 0;
  let lastOverlayPublishAt = 0;
  let overlayErrorReported = false;
  let lastAutosavedDuration = -1;
  let simDumpQueue: DumpSampleInput[] = [];
  let simDumpPackSeq = 0;

  const flushSimulatorDumpQueue = (force = false): void => {
    if (simDumpQueue.length === 0) return;
    if (!force && simDumpQueue.length < 25) return;
    const batch = simDumpQueue;
    simDumpQueue = [];
    void tauriBridge.appendEegDumpSamples(batch).catch((err: unknown) => {
      console.warn('[FocusStore] appendEegDumpSamples failed:', err);
    });
  };

  const syncSimulatorDumpListener = (status: EegDumpStatus): void => {
    if (isTauri && status.recording && status.source === 'simulator') {
      simulationEngine.setSimulatorSampleListener((samples) => {
        for (const s of samples) {
          simDumpPackSeq += 1;
          simDumpQueue.push({
            timestamp: s.timestamp,
            packNum: simDumpPackSeq,
            marker: s.isArtifact ? 1 : 0,
            t3: s.rawChannels.t3,
            t4: s.rawChannels.t4,
            o1: s.rawChannels.o1,
            o2: s.rawChannels.o2,
            t3Ok: s.signalQuality.t3,
            t4Ok: s.signalQuality.t4,
            o1Ok: s.signalQuality.o1,
            o2Ok: s.signalQuality.o2,
          });
        }
        flushSimulatorDumpQueue(false);
      });
    } else {
      simulationEngine.setSimulatorSampleListener(null);
      simDumpQueue = [];
    }
  };

  if (storedCalibration) simulationEngine.setPersonalCalibration(storedCalibration);

  const showNotice = (kind: UiNotice['kind'], text: string): void => {
    noticeCounter += 1;
    set({ notice: { id: noticeCounter, kind, text } });
  };

  const restoreSimulatorAfterPlayback = () => {
    simulationEngine.setRecordingPlaybackActive(false);
    if (simulatorWasPausedBeforePlayback !== null) {
      if (simulationEngine.getIsPaused() !== simulatorWasPausedBeforePlayback) {
        simulationEngine.togglePause();
      }
      simulatorWasPausedBeforePlayback = null;
    }
  };

  /** Текущая сессия как запись истории; `null`, если она ещё слишком коротка. */
  const buildActiveRecord = (): SessionRecord | null => {
    const { sessionStats, settings, sessionStartedAt, sessionId } = get();
    if (sessionStats.durationSeconds < MIN_SESSION_SECONDS) return null;
    return {
      ...sessionStats,
      id: sessionId,
      startedAt: sessionStartedAt,
      endedAt: new Date().toISOString(),
      mode: settings.mode,
      deviceSource: settings.deviceSource,
      threshold: settings.threshold,
    };
  };

  const persistActiveSession = async (): Promise<void> => {
    const record = buildActiveRecord();
    if (!record || record.durationSeconds === lastAutosavedDuration) return;
    await sessions.upsert(record);
    lastAutosavedDuration = record.durationSeconds;
  };

  const buildOverlayFrame = (): OverlayFrame => {
    const state = get();
    const { feedbackState, settings, deviceStatus, telemetry } = state;
    const isSimulator = settings.deviceSource === 'simulator';
    const streamActive = isSimulator || deviceStatus.connected;
    const isFitCheckActive = !isSimulator && deviceStatus.streamMode === 'resist';
    const canDim =
      streamActive &&
      !isFitCheckActive &&
      feedbackState.isContactOk &&
      feedbackState.isDimmingActive;
    return {
      opacity: canDim ? feedbackState.overlayOpacity : 0,
      blurPx: canDim ? feedbackState.blurRadius : 0,
      metric: feedbackState.smoothedMetric,
      threshold: Math.round(feedbackState.effectiveThreshold ?? settings.threshold),
      mode: settings.mode,
      scope: settings.dimmingScope,
      streamActive,
      contactOk: feedbackState.isContactOk,
      artifactFrozen: feedbackState.isArtifactFrozen,
      isSimulator,
      paused: state.isPaused,
      hudVisible: state.viewMode === 'hud',
      activePreset: state.activePreset,
      sensors: streamActive
        ? telemetry?.signalQuality ?? { t3: true, t4: true, o1: true, o2: true }
        : { t3: false, t4: false, o1: false, o2: false },
    };
  };

  const publishOverlay = (): void => {
    if (!isTauri || !get().unifiedHud) return;
    lastOverlayPublishAt = performance.now();
    tauriBridge.updateOverlay(buildOverlayFrame()).then(
      () => {
        overlayErrorReported = false;
      },
      (err: unknown) => {
        // Кадры идут ~15 раз в секунду — сообщаем об ошибке один раз, а не потоком.
        if (!overlayErrorReported) {
          overlayErrorReported = true;
          showNotice('error', `Overlay window is not responding: ${errorText(err)}`);
        }
      }
    );
  };

  /** Передаёт Rust-монитору активных окон режим затемнения и список шаблонов. */
  const applyDistractionConfig = async (): Promise<void> => {
    const { settings } = get();
    try {
      const status = await tauriBridge.setDistractionConfig({
        enabled: settings.dimmingScope === 'distractors',
        patterns: settings.distractorPatterns,
      });
      set({ distractionSupported: status.supported });
      if (!status.supported && settings.dimmingScope === 'distractors') {
        get().updateSettings({ dimmingScope: 'fullscreen' });
      }
      if (!status.enabled) {
        set({ foregroundWindow: null });
      }
    } catch (err) {
      showNotice('error', `Active window monitor error: ${errorText(err)}`);
    }
  };

  const handleHudAction = (action: HudAction): void => {
    switch (action.type) {
      case 'toggle_pause':
        get().togglePause();
        break;
      case 'set_preset':
        get().setPreset(action.preset);
        break;
      case 'inject_artifact':
        get().injectArtifact();
        break;
    }
  };

  simulationEngine.subscribe((telemetry, feedbackState, sessionStats) => {
    const state = get();

    if (state.isCalibrating) {
      calibrationFrames.push(telemetry);
    }

    const shouldPlayAudio =
      state.settings.audioFeedbackEnabled &&
      feedbackState.isDimmingActive &&
      feedbackState.isContactOk &&
      !(
        state.settings.deviceSource === 'bluetooth' &&
        (!state.deviceStatus.connected || state.deviceStatus.streamMode === 'resist')
      );

    audioFeedback.sync(shouldPlayAudio, feedbackState.audioVolume);

    set({
      telemetry,
      feedbackState,
      sessionStats,
      activePreset: simulationEngine.getPreset(),
      isPaused: simulationEngine.getIsPaused(),
    });

    if (
      isTauri &&
      state.unifiedHud &&
      performance.now() - lastOverlayPublishAt >= OVERLAY_PUBLISH_INTERVAL_MS
    ) {
      publishOverlay();
    }
  });

  simulationEngine.start(initialSettings);

  void tauriBridge.getDeviceStatus().then((status) => {
    set({ deviceStatus: status });
  });

  void tauriBridge.getOverlayInfo().then((info) => {
    set({ overlayWindowCount: info.count, unifiedHud: Boolean(info.unifiedHud) });
    if (info.unifiedHud) {
      publishOverlay();
    }
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

  void tauriBridge.onBrainBitRawBatch((packets) => {
    if (get().settings.deviceSource === 'bluetooth') {
      simulationEngine.ingestRawBrainBitBatch(packets);
    }
  });

  void tauriBridge.onBrainBitResist((update) => {
    if (get().settings.deviceSource === 'bluetooth') {
      const allUsable = areAllElectrodesUsable(update.signalQuality, update.resistanceKOhm);
      const fit = fitStability.update(allUsable, update.timestamp || Date.now());
      simulationEngine.applyBrainBitResistUpdate(update);
      set({
        fitHoldMs: fit.holdMs,
        fitVerified: fit.verified,
        lastFitResistance: update.resistanceKOhm,
      });
    }
  });

  void tauriBridge.onBrainBitStatus((status) => {
    const prevMode = get().deviceStatus.streamMode;
    if (!status.connected || status.streamMode === 'idle') {
      fitStability.reset();
      set({ deviceStatus: status, fitHoldMs: 0, fitVerified: false, lastFitResistance: null });
    } else if (status.streamMode === 'resist' && prevMode !== 'resist') {
      fitStability.reset();
      set({ deviceStatus: status, fitHoldMs: 0, fitVerified: false });
    } else {
      set({ deviceStatus: status });
    }
    if (!status.connected || status.streamMode !== 'signal') {
      audioFeedback.sync(false, 0);
    }
    publishOverlay();
  });

  if (isTauri) {
    void tauriBridge.getEegDumpStatus().then(
      (dumpStatus) => {
        syncSimulatorDumpListener(dumpStatus);
        set({ dumpStatus });
      },
      () => undefined
    );
    void tauriBridge.onEegDumpStatus((dumpStatus) => {
      syncSimulatorDumpListener(dumpStatus);
      set({ dumpStatus });
    });
  }

  void sessions.list().then(
    (records) => set({ sessionHistory: records }),
    (err: unknown) => showNotice('error', `Failed to load session history: ${errorText(err)}`)
  );

  if (isTauri) {
    void tauriBridge.on<boolean>('click-through-changed', (enabled) =>
      set({ isClickThrough: enabled })
    );
    void tauriBridge.on<unknown>('click-through-disabled', () =>
      set({ isClickThrough: false })
    );
    void tauriBridge.on<boolean>('overlay-enabled-changed', (enabled) =>
      set({ overlayEnabled: enabled })
    );
    void tauriBridge.on<null>('dashboard-shown', () => {
      set({ viewMode: 'dashboard' });
      if (get().unifiedHud) {
        publishOverlay();
      }
    });
    void tauriBridge.on<{ message?: string }>('backend-error', (error) =>
      showNotice('error', error?.message ?? 'Unknown backend error')
    );
    void tauriBridge.on<HudAction>('hud-action', handleHudAction);
    void tauriBridge.on<ForegroundWindowInfo | null>('foreground-window', (info) =>
      set({ foregroundWindow: info })
    );
    void tauriBridge.on<null>('quit-requested', () => {
      void get().quit();
    });

    tauriBridge.getWindowState().then(
      (windowState) => {
        if (windowState) {
          set({
            isClickThrough: windowState.clickThrough,
            overlayEnabled: windowState.overlayEnabled,
            isAlwaysOnTop: windowState.alwaysOnTop,
          });
        }
      },
      (err: unknown) => showNotice('error', `Failed to read window state: ${errorText(err)}`)
    );

    // Стор ещё не создан в момент выполнения этой функции — откладываем на микрозадачу.
    queueMicrotask(() => {
      void applyDistractionConfig();
      publishOverlay();
    });
  }

  if (hasWindow) {
    // Автосохранение: при любом способе закрытия теряется не больше 5 секунд сессии.
    window.setInterval(() => {
      persistActiveSession().catch((err: unknown) => {
        showNotice('error', `Session autosave failed: ${errorText(err)}`);
      });
    }, AUTOSAVE_INTERVAL_MS);

    // В браузере localStorage пишется синхронно — успеваем сохранить при закрытии вкладки.
    window.addEventListener('pagehide', () => {
      const record = buildActiveRecord();
      if (record) sessions.upsertSync(record);
    });
  }

  return {
    settings: initialSettings,

    updateSettings: (newSettings) => {
      const current = get().settings;
      if (
        newSettings.deviceSource &&
        newSettings.deviceSource !== current.deviceSource &&
        (get().recordingStatus === 'playing' || get().recordingStatus === 'paused')
      ) {
        get().stopRecording();
      }
      simulationEngine.updateSettings(newSettings);
      const updated = simulationEngine.getSettings();
      savePersistedSettings(updated);

      if (!updated.audioFeedbackEnabled) {
        audioFeedback.sync(false, 0);
      }

      set({ settings: updated });

      if (newSettings.deviceSource && newSettings.deviceSource !== current.deviceSource) {
        if (get().dumpStatus.recording) {
          void get().stopEegDump();
        }
        audioFeedback.sync(false, 0);
        fitStability.reset();
        set({ fitHoldMs: 0, fitVerified: false, lastFitResistance: null });
        void tauriBridge.setDeviceSource(newSettings.deviceSource).then((deviceStatus) => {
          set({ deviceStatus });
          publishOverlay();
        });
      }

      if (
        isTauri &&
        (updated.dimmingScope !== current.dimmingScope ||
          updated.distractorPatterns !== current.distractorPatterns)
      ) {
        void applyDistractionConfig();
      }

      publishOverlay();
    },

    isTauri,
    viewMode: 'dashboard',
    setViewMode: (mode) => {
      set({ viewMode: mode });
      if (mode === 'dashboard' && get().isClickThrough) {
        void get().setClickThrough(false);
      }
      if (isTauri && get().unifiedHud) {
        publishOverlay();
        tauriBridge.setHudMode(mode === 'hud').catch((err: unknown) => {
          set({ viewMode: 'dashboard' });
          publishOverlay();
          showNotice('error', `Failed to switch view mode: ${errorText(err)}`);
        });
      } else if (isTauri) {
        void tauriBridge.setOverlayMode(mode === 'hud');
      }
    },

    isClickThrough: false,
    setClickThrough: async (enabled) => {
      // Mirror only what the native window really applied (null = IPC failure).
      const applied = await tauriBridge.setClickThrough(enabled);
      if (applied !== null) {
        set({ isClickThrough: applied });
      } else if (isTauri) {
        showNotice(
          'error',
          `Click-through was not changed: ${tauriBridge.consumeLastError() ?? 'IPC call failed'}`
        );
      }
    },
    toggleClickThrough: async () => {
      await get().setClickThrough(!get().isClickThrough);
    },

    isAlwaysOnTop: false,
    toggleAlwaysOnTop: async () => {
      const applied = await tauriBridge.toggleAlwaysOnTop(!get().isAlwaysOnTop);
      if (applied !== null) {
        set({ isAlwaysOnTop: applied });
      } else if (isTauri) {
        showNotice(
          'error',
          `Always-on-top was not changed: ${tauriBridge.consumeLastError() ?? 'IPC call failed'}`
        );
      }
    },

    overlayEnabled: true,
    setOverlayEnabled: async (enabled) => {
      try {
        set({ overlayEnabled: await tauriBridge.setOverlayEnabled(enabled) });
      } catch (err) {
        showNotice('error', `Overlay was not changed: ${errorText(err)}`);
      }
    },

    isSettingsOpen: false,
    setIsSettingsOpen: (open) => {
      set({ isSettingsOpen: open });
      if (open && get().isClickThrough) {
        void get().setClickThrough(false);
      }
    },

    activeTab: 'monitor',
    setActiveTab: (tab) => set({ activeTab: tab }),

    notice: null,
    showNotice,
    dismissNotice: () => set({ notice: null }),

    quit: async () => {
      if (get().dumpStatus.recording) {
        try {
          await get().stopEegDump();
        } catch (err) {
          console.warn('[FocusStore] dump stop on quit failed:', err);
        }
      }
      try {
        await persistActiveSession();
      } catch (err) {
        console.warn('[FocusStore] final session save failed:', err);
      }
      try {
        await tauriBridge.quitApp();
      } catch (err) {
        showNotice('error', `Failed to quit: ${errorText(err)}`);
      }
    },

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
    sessionHistory: [],
    sessionStorageBackend: sessions.backend,
    sessionId: newSessionId(),
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
    overlayWindowCount: 0,
    unifiedHud: false,
    isPaused: false,

    distractionSupported: false,
    foregroundWindow: null,

    fitHoldMs: 0,
    fitVerified: false,
    lastFitResistance: null,

    dumpStatus: {
      recording: false,
      dumpsDir: '',
      sampleCount: 0,
      durationSeconds: 0,
      markerCount: 0,
    },

    startEegDump: async (sessionTag) => {
      const { settings, deviceStatus } = get();
      if (settings.deviceSource === 'bluetooth' && !deviceStatus.connected) {
        showNotice('info', 'Сначала подключите BrainBit BLE во вкладке BrainBit & Simulator.');
        return;
      }
      try {
        simDumpPackSeq = 0;
        simDumpQueue = [];
        const status = await tauriBridge.startEegDump(settings.deviceSource, sessionTag);
        syncSimulatorDumpListener(status);
        set({ dumpStatus: status });
        if (settings.deviceSource === 'bluetooth') {
          const updatedDevice = await tauriBridge.getDeviceStatus();
          set({ deviceStatus: updatedDevice });
          publishOverlay();
        }
        showNotice('info', `Запись дампа ЭЭГ запущена: ${status.fileName ?? 'CSV'}`);
      } catch (err) {
        showNotice('error', `Не удалось начать запись дампа: ${errorText(err)}`);
      }
    },

    stopEegDump: async () => {
      try {
        flushSimulatorDumpQueue(true);
        simulationEngine.setSimulatorSampleListener(null);
        const status = await tauriBridge.stopEegDump();
        set({ dumpStatus: status });
        if (status.lastSavedPath) {
          showNotice(
            'info',
            `Дамп ЭЭГ сохранён (${(status.lastSavedSamples ?? 0).toLocaleString()} отсч.): ${status.lastSavedPath}`
          );
        }
      } catch (err) {
        showNotice('error', `Ошибка остановки записи дампа: ${errorText(err)}`);
      }
    },

    setEegDumpLabel: async (label, oneShot = false) => {
      if (!get().dumpStatus.recording) return;
      try {
        flushSimulatorDumpQueue(true);
        const status = await tauriBridge.setEegDumpLabel(label, oneShot);
        set({ dumpStatus: status });
      } catch (err) {
        showNotice('error', `Не удалось поставить метку дампа: ${errorText(err)}`);
      }
    },

    openEegDumpsFolder: async () => {
      try {
        const dir = await tauriBridge.openEegDumpsFolder();
        if (dir) {
          set((prev) => ({ dumpStatus: { ...prev.dumpStatus, dumpsDir: dir } }));
        }
      } catch (err) {
        showNotice('error', `Не удалось открыть папку дампов: ${errorText(err)}`);
      }
    },

    connectBrainBitDevice: async (address, initialMode = 'resist') => {
      try {
        const status = await tauriBridge.connectBrainBit(address, initialMode);
        if (get().settings.deviceSource !== 'bluetooth') {
          simulationEngine.updateSettings({ deviceSource: 'bluetooth' });
          const updated = simulationEngine.getSettings();
          savePersistedSettings(updated);
          set({ settings: updated });
        }
        fitStability.reset();
        set({ deviceStatus: status, fitHoldMs: 0, fitVerified: false, lastFitResistance: null });
        publishOverlay();
        showNotice(
          'info',
          initialMode === 'resist'
            ? `BrainBit подключён (${status.deviceName}). Идёт проверка посадки электродов.`
            : `BrainBit подключён (${status.deviceName}).`
        );
        return status;
      } catch (err) {
        const message = errorText(err);
        showNotice('error', `Не удалось подключиться к BrainBit: ${message}`);
        throw err;
      }
    },

    disconnectBrainBitDevice: async () => {
      try {
        const status = await tauriBridge.disconnectBrainBit();
        fitStability.reset();
        audioFeedback.sync(false, 0);
        set({ deviceStatus: status, fitHoldMs: 0, fitVerified: false, lastFitResistance: null });
        publishOverlay();
      } catch (err) {
        showNotice('error', `Ошибка отключения BrainBit: ${errorText(err)}`);
      }
    },

    startFitCheck: async () => {
      const { settings, deviceStatus } = get();
      if (settings.deviceSource === 'simulator') {
        fitStability.reset();
        set({ fitHoldMs: 0, fitVerified: false });
        return;
      }
      if (!deviceStatus.connected) {
        showNotice('info', 'Сначала подключите BrainBit во вкладке BrainBit & Simulator.');
        return;
      }
      try {
        fitStability.reset();
        audioFeedback.sync(false, 0);
        const status = await tauriBridge.setBrainBitMode('resist');
        set({ deviceStatus: status, fitHoldMs: 0, fitVerified: false });
        publishOverlay();
      } catch (err) {
        showNotice('error', `Не удалось запустить проверку посадки: ${errorText(err)}`);
      }
    },

    startEegStreamFromFitCheck: async () => {
      const { settings, deviceStatus } = get();
      if (settings.deviceSource !== 'bluetooth' || !deviceStatus.connected) return;
      try {
        const status = await tauriBridge.setBrainBitMode('signal');
        set({ deviceStatus: status });
        publishOverlay();
      } catch (err) {
        showNotice('error', `Не удалось запустить поток ЭЭГ 250 Гц: ${errorText(err)}`);
        throw err;
      }
    },

    activePreset: 'calm_flow',
    setPreset: (preset) => {
      simulationEngine.setPreset(preset);
      set({ activePreset: preset });
      publishOverlay();
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
      publishOverlay();
    },

    setElectrodeContact: (channel, ok) => {
      simulationEngine.setElectrodeQuality(channel, ok);
    },

    resetSession: (saveCurrent = true) => {
      const record = saveCurrent ? buildActiveRecord() : null;
      let updatedHistory = get().sessionHistory;

      if (record) {
        updatedHistory = mergeSession(updatedHistory, record);
        sessions.upsert(record).catch((err: unknown) => {
          showNotice('error', `Session was not saved: ${errorText(err)}`);
        });
      }

      simulationEngine.resetSession();
      audioFeedback.sync(false, 0);
      lastAutosavedDuration = -1;
      set({
        sessionHistory: updatedHistory,
        sessionId: newSessionId(),
        sessionStartedAt: new Date().toISOString(),
        sessionStats: simulationEngine.getSessionStats(),
      });
    },

    persistActiveSession,

    clearSessionHistory: async () => {
      try {
        await sessions.clear();
        // Активная сессия начнёт сохраняться заново при следующем автосохранении.
        lastAutosavedDuration = -1;
        set({ sessionHistory: [] });
      } catch (err) {
        showNotice('error', `History was not cleared: ${errorText(err)}`);
      }
    },

    exportSessionsCsv: () => {
      if (typeof document === 'undefined') return;
      const { sessionHistory } = get();

      const active = buildActiveRecord();
      const rows: SessionRecord[] = active
        ? [active, ...sessionHistory.filter((r) => r.id !== active.id)]
        : [...sessionHistory];

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
      const dateStr = new Date().toISOString().slice(0, 10);
      downloadBlob(
        new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
        `focusglass-sessions-${dateStr}.csv`
      );
    },

    isCalibrating: false,
    calibrationDurationSeconds: 10,
    setCalibrationDuration: (seconds) => set({ calibrationDurationSeconds: seconds }),
    calibrationProgress: 0,
    calibrationRemainingSeconds: 0,
    calibrationResult: storedCalibration,
    activeCalibration: storedCalibration,

    startCalibration: (durationOverride) => {
      const state = get();
      if (state.isCalibrating) return;
      if (state.settings.deviceSource === 'bluetooth' && !state.deviceStatus.connected) {
        return;
      }

      const beginCountdown = () => {
        const current = get();
        if (current.isCalibrating) return;
        const durationSec = durationOverride ?? current.calibrationDurationSeconds;
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
      };

      if (
        state.settings.deviceSource === 'bluetooth' &&
        state.deviceStatus.connected &&
        state.deviceStatus.streamMode !== 'signal'
      ) {
        void get()
          .startEegStreamFromFitCheck()
          .then(beginCountdown)
          .catch(() => {
            // Notice already displayed by startEegStreamFromFitCheck
          });
        return;
      }

      beginCountdown();
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
      if (
        calibrationResult &&
        (calibrationResult.sampleCount ?? 0) >= 20 &&
        calibrationResult.confidence > 0
      ) {
        simulationEngine.setPersonalCalibration(calibrationResult);
        savePersistedCalibration(calibrationResult);
        updateSettings({ threshold: calibrationResult.recommendedThreshold });
        set({ activeCalibration: calibrationResult });
      }
    },

    recording: null,
    recordingStatus: 'empty',
    recordingProgress: 0,
    recordingSpeed: 1,
    recordingError: null,
    loadRecording: (text, name) => {
      try {
        if (get().recordingStatus === 'playing' || get().recordingStatus === 'paused') {
          get().stopRecording();
        }
        const recording = parseEEGRecording(text, name);
        playback.load(recording);
        set({ recording, recordingStatus: 'ready', recordingProgress: 0, recordingError: null });
      } catch (error) {
        playback.stop();
        restoreSimulatorAfterPlayback();
        set({
          recording: null,
          recordingStatus: 'empty',
          recordingProgress: 0,
          recordingError: error instanceof Error ? error.message : 'Could not open the recording.',
        });
      }
    },
    playRecording: () => {
      const state = get();
      if (!state.recording) return;
      if (state.settings.deviceSource !== 'simulator') {
        set({
          recordingError: 'Select Simulator in the BrainBit & Simulator tab to play a recording.',
        });
        return;
      }
      if (simulatorWasPausedBeforePlayback === null) {
        simulatorWasPausedBeforePlayback = simulationEngine.getIsPaused();
        if (!simulatorWasPausedBeforePlayback) simulationEngine.togglePause();
      }
      if (state.recordingStatus !== 'paused') {
        simulationEngine.resetRecordedSignalPipeline();
      }
      simulationEngine.setRecordingPlaybackActive(true);
      set({ recordingStatus: 'playing', recordingError: null });
      const started = playback.play(
        state.recordingSpeed,
        (frames) => {
          simulationEngine.ingestRecordedFrames(frames);
        },
        (progress) => {
          set({ recordingProgress: progress });
        },
        () => {
          set({ recordingStatus: 'ended', recordingProgress: 1 });
          restoreSimulatorAfterPlayback();
        }
      );
      if (!started) {
        restoreSimulatorAfterPlayback();
        set({ recordingStatus: 'ready' });
      }
    },
    pauseRecording: () => {
      playback.pause();
      if (get().recordingStatus === 'playing') set({ recordingStatus: 'paused' });
    },
    stopRecording: () => {
      playback.stop();
      simulationEngine.resetRecordedSignalPipeline();
      restoreSimulatorAfterPlayback();
      set({
        recordingStatus: get().recording ? 'ready' : 'empty',
        recordingProgress: 0,
        recordingError: null,
      });
    },
    seekRecording: (progress) => {
      const wasPlaying = get().recordingStatus === 'playing';
      if (wasPlaying) playback.pause();
      const nextProgress = playback.seek(progress);
      simulationEngine.resetRecordedSignalPipeline();
      set({
        recordingProgress: nextProgress,
        ...(wasPlaying ? { recordingStatus: 'paused' as const } : {}),
      });
      if (wasPlaying) get().playRecording();
    },
    setRecordingSpeed: (speed) => {
      const wasPlaying = get().recordingStatus === 'playing';
      const boundedSpeed = Math.max(0.25, Math.min(4, speed));
      if (wasPlaying) playback.pause();
      set({ recordingSpeed: boundedSpeed });
      if (wasPlaying) get().playRecording();
    },
  };
});
