import type {
  BrainBitScanResult,
  DeviceStatus,
  EEGTelemetry,
} from './eegTypes';

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

  public async setClickThrough(enabled: boolean): Promise<boolean> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('set_click_through', { enabled });
      } catch (err) {
        console.warn('[TauriBridge] Error invoking set_click_through:', err);
        return false;
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

  public async toggleAlwaysOnTop(enabled: boolean): Promise<boolean> {
    if (this.isTauriAvailable()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        return await invoke<boolean>('toggle_always_on_top', { enabled });
      } catch (err) {
        console.warn('[TauriBridge] Error invoking toggle_always_on_top:', err);
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
