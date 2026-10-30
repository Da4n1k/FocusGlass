export const TELEMETRY_SCHEMA_VERSION = '1.0.0';

export type {
  RawEEGChannels,
  ElectrodeSignalQuality,
  ChannelResistanceKOhm,
  SpectralBandPowers,
  RawBrainBitPacket,
  EEGTelemetry,
  FocusGlassSettings,
  BiofeedbackFeedbackState,
  DeviceStatus,
  DiscoveredBrainBitDevice,
  BrainBitScanResult,
  SessionStatistics,
  SessionRecord,
  CalibrationResult,
  PresetState,
} from '../../src/services/eegTypes.ts';
