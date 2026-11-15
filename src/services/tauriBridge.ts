import type {
  BrainBitScanResult,
  DeviceStatus,
  DistractionStatus,
  EEGTelemetry,
  ForegroundWindowInfo,
  HudAction,
  OverlayFrame,
  OverlayInfo,
  PixelRect,
  RawBrainBitPacket,
  SessionRecord,
  WindowState,
} from './eegTypes';
import { SYNC_REQUEST_EVENT, SYNC_STATE_EVENT, type SyncSnapshot } from './windowSync';

/** Ошибка вызова Rust-ядра: `kind` — машинный код из `AppError::kind()`. */
export class BridgeError extends Error {
  public readonly kind: string;

  constructor(kind: string, message: string) {
    super(message);
    this.name = 'BridgeError';
    this.kind = kind;
  }
}

export type WindowLabel = 'main' | 'overlay';

interface TauriInternals {
  metadata?: { currentWindow?: { label?: string } };
}

function toBridgeError(command: string, raw: unknown): BridgeError {
  if (raw instanceof BridgeError) return raw;
  if (typeof raw === 'object' && raw !== null) {
    const { kind, message } = raw as { kind?: unknown; message?: unknown };
    if (typeof message === 'string') {
      return new BridgeError(typeof kind === 'string' ? kind : 'unknown', message);
    }
  }
  return new BridgeError('unknown', `${command}: ${String(raw)}`);
}

/**
 * Защитный мост к Tauri IPC. В браузере (без оболочки Tauri) возвращает
 * безопасные заглушки, чтобы симулятор и БОС работали без нативной оболочки.
 */
class TauriBridge {
  private fallbackSource: 'simulator' | 'bluetooth' = 'simulator';
  private lastError: string | null = null;

  public isTauri(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  /** Метка текущего окна Tauri; `null` в браузере. */
  public windowLabel(): WindowLabel | null {
    if (!this.isTauri()) return null;
    const internals = (window as unknown as { __TAURI_INTERNALS__?: TauriInternals })
      .__TAURI_INTERNALS__;
    return internals?.metadata?.currentWindow?.label === 'overlay' ? 'overlay' : 'main';
  }

  public consumeLastError(): string | null {
    const err = this.lastError;
    this.lastError = null;
    return err;
  }

  private async invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      return await invoke<T>(command, args);
    } catch (err) {
      throw toBridgeError(command, err);
    }
  }

  /** Подписка на событие Tauri; в браузере — пустая отписка. */
  public async on<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
    if (!this.isTauri()) return () => {};
    try {
      const { listen } = await import('@tauri-apps/api/event');
      return await listen<T>(event, (e) => handler(e.payload));
    } catch (err) {
      console.warn(`[TauriBridge] Failed to subscribe to ${event}:`, err);
      return () => {};
    }
  }

  private buildFallbackStatus(source: 'simulator' | 'bluetooth'): DeviceStatus {
    if (source === 'bluetooth') {
      return {
        connected: false,
        deviceSource: 'bluetooth',
        connectionState: 'sdk_unavailable',
        batteryPercentage: 0,
        deviceName: 'BrainBit BLE (not connected)',
        samplingRateHz: 250,
        statusMessage:
          'NeuroSDK2 adapter is not linked in this build yet. Switch to Simulator to test biofeedback.',
      };
    }

    return {
      connected: true,
      deviceSource: 'simulator',
      connectionState: 'simulated',
      batteryPercentage: 100,
      deviceName: 'Synthetic EEG Generator (250 Hz)',
      samplingRateHz: 250,
      statusMessage: 'Synthetic 4-channel EEG stream active (demo/testing mode).',
    };
  }

  // --- Окна и оверлей -------------------------------------------------------

  /**
   * Возвращает фактически применённое состояние или `null` при сбое IPC,
   * чтобы стор никогда не расходился с реальным состоянием окна.
   */
  public async setClickThrough(enabled: boolean): Promise<boolean | null> {
    if (this.isTauri()) {
      try {
        this.lastError = null;
        return await this.invoke<boolean>('set_click_through', { enabled });
      } catch (err) {
        const bridgeErr = toBridgeError('set_click_through', err);
        this.lastError = bridgeErr.message;
        console.warn('[TauriBridge] Error invoking set_click_through:', bridgeErr);
        return null;
      }
    }
    return enabled;
  }

  public async toggleAlwaysOnTop(enabled: boolean): Promise<boolean | null> {
    if (this.isTauri()) {
      try {
        this.lastError = null;
        return await this.invoke<boolean>('toggle_always_on_top', { enabled });
      } catch (err) {
        const bridgeErr = toBridgeError('toggle_always_on_top', err);
        this.lastError = bridgeErr.message;
        console.warn('[TauriBridge] Error invoking toggle_always_on_top:', bridgeErr);
        return null;
      }
    }
    return enabled;
  }

  public async setOverlayMode(enabled: boolean): Promise<boolean | null> {
    if (this.isTauri()) {
      try {
        this.lastError = null;
        return await this.invoke<boolean>('set_overlay_mode', { enabled });
      } catch (err) {
        const bridgeErr = toBridgeError('set_overlay_mode', err);
        this.lastError = bridgeErr.message;
        console.warn('[TauriBridge] Error invoking set_overlay_mode:', bridgeErr);
        return null;
      }
    }
    return enabled;
  }

  public async setOverlayEnabled(enabled: boolean): Promise<boolean> {
    if (!this.isTauri()) return enabled;
    return this.invoke<boolean>('set_overlay_enabled', { enabled });
  }

  /** Режим HUD на Windows: панель прячется в трей, на экране остаётся единый оверлей. */
  public async setHudMode(enabled: boolean): Promise<boolean> {
    if (!this.isTauri()) return enabled;
    return this.invoke<boolean>('set_hud_mode', { enabled });
  }

  public async showDashboard(): Promise<void> {
    if (!this.isTauri()) return;
    await this.invoke<void>('show_dashboard');
  }

  public async getWindowState(): Promise<WindowState | null> {
    if (!this.isTauri()) return null;
    return this.invoke<WindowState>('get_window_state');
  }

  public async updateOverlay(frame: OverlayFrame): Promise<void> {
    if (!this.isTauri()) return;
    await this.invoke<void>('update_overlay', { frame });
  }

  public async getOverlayFrame(): Promise<OverlayFrame | null> {
    if (!this.isTauri()) return null;
    return this.invoke<OverlayFrame | null>('get_overlay_frame');
  }

  public async setOverlayHitRegion(rect: PixelRect | null): Promise<void> {
    if (!this.isTauri()) return;
    await this.invoke<void>('set_overlay_hit_region', { rect });
  }

  public async minimizeWindow(): Promise<void> {
    if (!this.isTauri()) return;
    await this.invoke<void>('minimize_window');
  }

  public async closeWindow(): Promise<void> {
    if (!this.isTauri()) return;
    await this.invoke<void>('close_window');
  }

  public async quitApp(): Promise<void> {
    if (!this.isTauri()) return;
    await this.invoke<void>('quit_app');
  }

  /** HUD в окне оверлея пересылает действие окну панели управления. */
  public async sendHudAction(action: HudAction): Promise<void> {
    if (!this.isTauri()) return;
    try {
      const { emitTo } = await import('@tauri-apps/api/event');
      await emitTo('main', 'hud-action', action);
    } catch (err) {
      throw toBridgeError('hud-action', err);
    }
  }

  // --- Помощники для Linux split-overlay (`overlay-*` + `fg://state`) -------

  public async emitSnapshot(snapshot: SyncSnapshot): Promise<void> {
    if (!this.isTauri()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(SYNC_STATE_EVENT, snapshot);
    } catch (err) {
      console.warn('[TauriBridge] Failed to emit state snapshot:', err);
    }
  }

  public async onSnapshot(handler: (payload: unknown) => void): Promise<() => void> {
    if (!this.isTauri()) return () => {};
    return this.on<unknown>(SYNC_STATE_EVENT, handler);
  }

  public async requestState(): Promise<void> {
    if (!this.isTauri()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(SYNC_REQUEST_EVENT);
    } catch (err) {
      console.warn('[TauriBridge] Failed to request state:', err);
    }
  }

  public async onStateRequest(handler: () => void): Promise<() => void> {
    if (!this.isTauri()) return () => {};
    return this.on<unknown>(SYNC_REQUEST_EVENT, () => handler());
  }

  public async setOverlayVisible(visible: boolean): Promise<boolean> {
    if (!this.isTauri()) return true;
    try {
      await this.invoke('set_overlay_visible', { visible });
      return true;
    } catch (err) {
      console.warn('[TauriBridge] Error invoking set_overlay_visible:', err);
      return false;
    }
  }

  public async fitHudWindow(width: number, height: number): Promise<void> {
    if (!this.isTauri()) return;
    try {
      await this.invoke('fit_hud_window', { width, height });
    } catch (err) {
      console.warn('[TauriBridge] Error invoking fit_hud_window:', err);
    }
  }

  public async getOverlayInfo(): Promise<OverlayInfo> {
    if (this.isTauri()) {
      try {
        return await this.invoke<OverlayInfo>('get_overlay_info');
      } catch (err) {
        console.warn('[TauriBridge] Error invoking get_overlay_info:', err);
      }
    }
    return { count: 0, composited: false, unifiedHud: false };
  }

  // --- Устройство -----------------------------------------------------------

  public async getDeviceStatus(): Promise<DeviceStatus> {
    if (this.isTauri()) {
      try {
        return await this.invoke<DeviceStatus>('get_device_status');
      } catch (err) {
        console.warn('[TauriBridge] get_device_status failed:', err);
      }
    }
    return this.buildFallbackStatus(this.fallbackSource);
  }

  public async setDeviceSource(source: 'simulator' | 'bluetooth'): Promise<DeviceStatus> {
    this.fallbackSource = source;
    if (this.isTauri()) {
      try {
        return await this.invoke<DeviceStatus>('set_device_source', { source });
      } catch (err) {
        console.warn('[TauriBridge] set_device_source failed:', err);
      }
    }
    return this.buildFallbackStatus(source);
  }

  public async scanBrainBitDevices(): Promise<BrainBitScanResult> {
    if (this.isTauri()) {
      try {
        return await this.invoke<BrainBitScanResult>('scan_brainbit_devices');
      } catch (err) {
        console.warn('[TauriBridge] scan_brainbit_devices failed:', err);
      }
    }
    return {
      sdkAvailable: false,
      devices: [],
      message: 'NeuroSDK2 BLE transport is not linked yet. No physical scan was performed.',
    };
  }

  public onBrainBitTelemetry(handler: (packet: EEGTelemetry) => void): Promise<() => void> {
    return this.on<EEGTelemetry>('brainbit-telemetry', handler);
  }

  public onBrainBitRawSignal(handler: (packet: RawBrainBitPacket) => void): Promise<() => void> {
    return this.on<RawBrainBitPacket>('brainbit-raw-signal', handler);
  }

  // --- История сессий (SQLite) ----------------------------------------------

  public async sessionsUpsert(record: SessionRecord): Promise<void> {
    await this.invoke<void>('sessions_upsert', { record });
  }

  public async sessionsList(limit: number): Promise<SessionRecord[]> {
    return this.invoke<SessionRecord[]>('sessions_list', { limit });
  }

  public async sessionsImport(records: SessionRecord[]): Promise<number> {
    return this.invoke<number>('sessions_import', { records });
  }

  public async sessionsClear(): Promise<number> {
    return this.invoke<number>('sessions_clear');
  }

  // --- Умная блокировка -----------------------------------------------------

  public async setDistractionConfig(config: {
    enabled: boolean;
    patterns: string[];
  }): Promise<DistractionStatus> {
    if (!this.isTauri()) {
      return { supported: false, enabled: false, patterns: config.patterns };
    }
    return this.invoke<DistractionStatus>('set_distraction_config', { config });
  }

  public async getForegroundWindow(): Promise<ForegroundWindowInfo | null> {
    if (!this.isTauri()) return null;
    return this.invoke<ForegroundWindowInfo | null>('get_foreground_window');
  }
}

export const tauriBridge = new TauriBridge();
