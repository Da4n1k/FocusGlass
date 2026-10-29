import type { DeviceStatus } from '../contracts/telemetry.ts';

export interface IPCCallRecord {
  command: string;
  args: any;
  timestamp: number;
}

export class TauriIPCMock {
  private clickThroughEnabled: boolean = false;
  private deviceStatus: DeviceStatus;
  private callHistory: IPCCallRecord[] = [];

  constructor(initialStatus?: Partial<DeviceStatus>) {
    this.deviceStatus = {
      connected: true,
      deviceSource: 'simulator',
      batteryPercentage: 92,
      deviceName: 'BrainBit Headband (Simulated)',
      samplingRateHz: 250,
      ...initialStatus,
    };
  }

  public async invoke(command: string, args: Record<string, any> = {}): Promise<any> {
    const timestamp = Date.now();
    this.callHistory.push({ command, args, timestamp });

    switch (command) {
      case 'set_click_through': {
        const enabled = Boolean(args.enabled);
        this.clickThroughEnabled = enabled;
        return { success: true, clickThrough: this.clickThroughEnabled };
      }
      case 'get_device_status': {
        return { ...this.deviceStatus };
      }
      case 'set_device_source': {
        this.deviceStatus.deviceSource = args.source === 'bluetooth' ? 'bluetooth' : 'simulator';
        this.deviceStatus.deviceName =
          this.deviceStatus.deviceSource === 'bluetooth'
            ? 'BrainBit-BLE-7A4F'
            : 'BrainBit Headband (Simulated)';
        return { success: true, source: this.deviceStatus.deviceSource };
      }
      default:
        throw new Error(`Unknown Tauri IPC command: ${command}`);
    }
  }

  public isClickThrough(): boolean {
    return this.clickThroughEnabled;
  }

  public getCallsFor(command: string): IPCCallRecord[] {
    return this.callHistory.filter(c => c.command === command);
  }

  public clearHistory(): void {
    this.callHistory = [];
  }
}
