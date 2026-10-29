import type { DeviceStatus } from './eegTypes';

/**
 * Safe IPC Bridge for FocusGlass Tauri v2 & Web Browser fallback
 */
class TauriBridge {
  private isTauriAvailable(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
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
    } else {
      // Mock browser fallback
      console.log(`[TauriBridge:Mock] setClickThrough(${enabled})`);
      return enabled;
    }
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
    // Browser mock fallback
    return {
      connected: true,
      deviceSource: 'simulator',
      batteryPercentage: 92,
      deviceName: 'BrainBit Virtual Headband (250Hz)',
      samplingRateHz: 250,
    };
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
    console.log(`[TauriBridge:Mock] toggleAlwaysOnTop(${enabled})`);
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
    } else {
      console.log('[TauriBridge:Mock] minimizeWindow()');
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
    } else {
      console.log('[TauriBridge:Mock] closeWindow()');
    }
  }
}

export const tauriBridge = new TauriBridge();
