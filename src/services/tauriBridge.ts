import type { DeviceStatus, TelemetryOrigin } from './eegTypes.ts';

interface RustDeviceStatusPayload {
  connected: boolean;
  deviceSource: string;
  batteryPercentage: number;
  deviceName: string;
  samplingRateHz: number;
}

/**
 * Safe IPC Bridge for FocusGlass Tauri v2 & Web Browser fallback.
 * Strictly separates synthetic simulation / CSV replay from real BrainBit BLE hardware.
 */
class TauriBridge {
  public isTauriRuntime(): boolean {
    return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
  }

  public async setClickThrough(enabled: boolean): Promise<boolean> {
    if (this.isTauriRuntime()) {
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

  public async getDeviceStatus(
    requestedSource: TelemetryOrigin = 'simulator',
    replayLabel?: string
  ): Promise<DeviceStatus> {
    if (requestedSource === 'simulator') {
      return {
        connected: true,
        deviceSource: 'simulator',
        batteryPercentage: null,
        deviceName: 'Симулятор ЭЭГ (250 Гц · α/β/θ)',
        samplingRateHz: 250,
        isSimulated: true,
        sdkIntegrated: false,
        statusNote: 'Демонстрационная математическая модель сигнала (без физического BrainBit).',
      };
    }

    if (requestedSource === 'csv_replay') {
      return {
        connected: true,
        deviceSource: 'csv_replay',
        batteryPercentage: null,
        deviceName: replayLabel ? `CSV-запись: ${replayLabel}` : 'Воспроизведение CSV-записи ЭЭГ',
        samplingRateHz: 250,
        isSimulated: true,
        sdkIntegrated: false,
        statusNote: 'Офлайн-воспроизведение ЭЭГ с расчётом спектра биполярных отведений (T3-O1, T4-O2).',
      };
    }

    // requestedSource === 'bluetooth'
    if (this.isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const rustStatus = await invoke<RustDeviceStatusPayload>('get_device_status');
        // Only report real BLE connection if Rust backend explicitly confirms 'bluetooth' source
        if (rustStatus.deviceSource === 'bluetooth' && rustStatus.connected) {
          return {
            connected: true,
            deviceSource: 'bluetooth',
            batteryPercentage: rustStatus.batteryPercentage,
            deviceName: rustStatus.deviceName,
            samplingRateHz: rustStatus.samplingRateHz,
            isSimulated: false,
            sdkIntegrated: true,
            statusNote: 'Подключён физический нейроинтерфейс BrainBit по Bluetooth LE.',
          };
        }
      } catch (err) {
        console.warn('[TauriBridge] Error invoking get_device_status:', err);
      }
    }

    return {
      connected: false,
      deviceSource: 'bluetooth',
      batteryPercentage: null,
      deviceName: 'BrainBit BLE (ожидает подключения neurosdk2)',
      samplingRateHz: 250,
      isSimulated: false,
      sdkIntegrated: false,
      statusNote: this.isTauriRuntime()
        ? 'Нативная оболочка Tauri запущена, но библиотека neurosdk2 / EmotionalMath ещё не слинкована.'
        : 'Запущено в браузере. Прямой доступ к BrainBit BLE требует Tauri-сборки с библиотекой neurosdk2.',
    };
  }

  public async scanBrainBitDevices(): Promise<{
    sdkIntegrated: boolean;
    devices: Array<{ id: string; name: string }>;
    message: string;
  }> {
    const status = await this.getDeviceStatus('bluetooth');
    if (status.sdkIntegrated && status.connected) {
      return {
        sdkIntegrated: true,
        devices: [{ id: 'brainbit-active', name: status.deviceName }],
        message: 'Обнаружено активное устройство BrainBit.',
      };
    }
    return {
      sdkIntegrated: false,
      devices: [],
      message:
        'Сканирование BLE недоступно: модуль neurosdk2 ещё не подключён к этой сборке (см. инструкцию интеграции в docs/TEAM_ROADMAP_AND_BRAINBIT_INTEGRATION.md).',
    };
  }

  public async toggleAlwaysOnTop(enabled: boolean): Promise<boolean> {
    if (this.isTauriRuntime()) {
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
    if (this.isTauriRuntime()) {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        await invoke('minimize_window');
      } catch (err) {
        console.warn('[TauriBridge] Error invoking minimize_window:', err);
      }
    }
  }

  public async closeWindow(): Promise<void> {
    if (this.isTauriRuntime()) {
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
