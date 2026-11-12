import type {
  BrainBitScanResult,
  DeviceStatus,
  EEGTelemetry,
  OverlayInfo,
  RawBrainBitPacket,
} from './eegTypes';
import { SYNC_REQUEST_EVENT, SYNC_STATE_EVENT, type SyncSnapshot } from './windowSync';

class TauriBridge {
  private fallbackSource: 'simulator' | 'bluetooth' = 'simulator';

  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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

  /**
   * Window-control commands resolve to the state the native window actually has,
   * or `null` when the IPC call failed, so callers never mirror a state that
   * was not applied. Outside Tauri (plain browser) the request is echoed back.
   */
  public async setClickThrough(enabled: boolean): Promise<boolean | null> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('set_click_through', { enabled });
      } catch (err) {
        console.warn('[TauriBridge] Error invoking set_click_through:', err);
        return null;
      }
    }
    return enabled;
  }

  public async setOverlayMode(enabled: boolean): Promise<boolean | null> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('set_overlay_mode', { enabled });
      } catch (err) {
        console.warn('[TauriBridge] Error invoking set_overlay_mode:', err);
        return null;
      }
    }
    return enabled;
  }

  public async getDeviceStatus(): Promise<DeviceStatus> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<DeviceStatus>('get_device_status');
      } catch (err) {
        console.warn('[TauriBridge] Error invoking get_device_status:', err);
      }
    }
    return this.buildFallbackStatus(this.fallbackSource);
  }

  public async setDeviceSource(source: 'simulator' | 'bluetooth'): Promise<DeviceStatus> {
    this.fallbackSource = source;
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<DeviceStatus>('set_device_source', { source });
      } catch (err) {
        console.warn('[TauriBridge] Error invoking set_device_source:', err);
      }
    }
    return this.buildFallbackStatus(source);
  }

  public async scanBrainBitDevices(): Promise<BrainBitScanResult> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<BrainBitScanResult>('scan_brainbit_devices');
      } catch (err) {
        console.warn('[TauriBridge] Error invoking scan_brainbit_devices:', err);
      }
    }
    return {
      sdkAvailable: false,
      devices: [],
      message:
        'NeuroSDK2 BLE transport is not linked yet. No physical scan was performed.',
    };
  }

  public async onBrainBitTelemetry(
    handler: (packet: EEGTelemetry) => void
  ): Promise<() => void> {
    if (!this.isTauriAvailable()) {
      return () => {};
    }
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<EEGTelemetry>('brainbit-telemetry', (event) => {
        handler(event.payload);
      });
      return unlisten;
    } catch (err) {
      console.warn('[TauriBridge] Failed to subscribe to brainbit-telemetry:', err);
      return () => {};
    }
  }

  public async onBrainBitRawSignal(
    handler: (packet: RawBrainBitPacket) => void
  ): Promise<() => void> {
    if (!this.isTauriAvailable()) {
      return () => {};
    }
    try {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<RawBrainBitPacket>('brainbit-raw-signal', (event) => {
        handler(event.payload);
      });
      return unlisten;
    } catch (err) {
      console.warn('[TauriBridge] Failed to subscribe to brainbit-raw-signal:', err);
      return () => {};
    }
  }

  public async toggleAlwaysOnTop(enabled: boolean): Promise<boolean | null> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('toggle_always_on_top', { enabled });
      } catch (err) {
        console.warn('[TauriBridge] Error invoking toggle_always_on_top:', err);
        return null;
      }
    }
    return enabled;
  }

  public async minimizeWindow(): Promise<void> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('minimize_window');
      } catch (err) {
        console.warn('[TauriBridge] Error invoking minimize_window:', err);
      }
    }
  }

  /** Engine window -> render-only windows. No-op outside Tauri (single-page browser mode). */
  public async emitSnapshot(snapshot: SyncSnapshot): Promise<void> {
    if (!this.isTauriAvailable()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(SYNC_STATE_EVENT, snapshot);
    } catch (err) {
      console.warn('[TauriBridge] Failed to emit state snapshot:', err);
    }
  }

  /** Render-only window side: payloads are untrusted, validate them with SnapshotReceiver. */
  public async onSnapshot(handler: (payload: unknown) => void): Promise<() => void> {
    if (!this.isTauriAvailable()) return () => {};
    try {
      const { listen } = await import('@tauri-apps/api/event');
      return await listen<unknown>(SYNC_STATE_EVENT, (event) => handler(event.payload));
    } catch (err) {
      console.warn('[TauriBridge] Failed to subscribe to state snapshots:', err);
      return () => {};
    }
  }

  public async requestState(): Promise<void> {
    if (!this.isTauriAvailable()) return;
    try {
      const { emit } = await import('@tauri-apps/api/event');
      await emit(SYNC_REQUEST_EVENT);
    } catch (err) {
      console.warn('[TauriBridge] Failed to request state:', err);
    }
  }

  public async onStateRequest(handler: () => void): Promise<() => void> {
    if (!this.isTauriAvailable()) return () => {};
    try {
      const { listen } = await import('@tauri-apps/api/event');
      return await listen(SYNC_REQUEST_EVENT, () => handler());
    } catch (err) {
      console.warn('[TauriBridge] Failed to subscribe to state requests:', err);
      return () => {};
    }
  }

  /** Resolves true when the overlay windows were shown/hidden (or there is nothing to show). */
  public async setOverlayVisible(visible: boolean): Promise<boolean> {
    if (!this.isTauriAvailable()) return true;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_overlay_visible', { visible });
      return true;
    } catch (err) {
      console.warn('[TauriBridge] Error invoking set_overlay_visible:', err);
      return false;
    }
  }

  /** Fits the floating-HUD window to its content (physical px); a no-op in dashboard mode. */
  public async fitHudWindow(width: number, height: number): Promise<void> {
    if (!this.isTauriAvailable()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('fit_hud_window', { width, height });
    } catch (err) {
      console.warn('[TauriBridge] Error invoking fit_hud_window:', err);
    }
  }

  public async getOverlayInfo(): Promise<OverlayInfo> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<OverlayInfo>('get_overlay_info');
      } catch (err) {
        console.warn('[TauriBridge] Error invoking get_overlay_info:', err);
      }
    }
    return { count: 0, composited: false };
  }

  public async closeWindow(): Promise<void> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('close_window');
      } catch (err) {
        console.warn('[TauriBridge] Error invoking close_window:', err);
      }
    }
  }
}

export const tauriBridge = new TauriBridge();
