// FEF6 service (Wiced Smart / Cypress) — primary protocol service
export const FEF6_SERVICE_UUID = "0000fef6-0000-1000-8000-00805f9b34fb";
export const FEF6_SERVICE_SHORT = "fef6";

// FEF6 characteristic UUIDs (base: 005f000X-2ff2-4ed5-b045-4c7463617865)
export const CONTROL_POINT_CHAR_UUID = "005f0002-2ff2-4ed5-b045-4c7463617865";
export const DATA_CHANNEL_1_CHAR_UUID = "005f0003-2ff2-4ed5-b045-4c7463617865";
export const DATA_CHANNEL_2_CHAR_UUID = "005f0004-2ff2-4ed5-b045-4c7463617865";
export const DATA_CHANNEL_3_CHAR_UUID = "005f0005-2ff2-4ed5-b045-4c7463617865";

// Custom LEGO service (base: 005f000X-3ff2-4ed5-b045-4c7463617865)
export const CUSTOM_SERVICE_UUID = "005f0001-3ff2-4ed5-b045-4c7463617865";
export const BIDIRECTIONAL_CHAR_UUID = "005f000a-3ff2-4ed5-b045-4c7463617865";

// GATT service
export const SERVICE_CHANGED_CHAR_UUID = "00002a05-0000-1000-8000-00805f9b34fb";

// LEGO manufacturer data company identifier (Bluetooth SIG)
export const LEGO_COMPANY_IDENTIFIER = 0x0397;

export enum Register {
  // BLE connection properties (0x01-0x0A)
  ConnectionParameterUpdateReq = 0x01,
  CurrentConnectionParameters = 0x02,
  DisconnectReq = 0x03,
  ConnectionSecurityLevel = 0x04,
  SecurityReq = 0x05,
  ServiceChanged = 0x06,
  DeleteBonds = 0x07,
  CurrentAttMtu = 0x08,
  PhyUpdateReq = 0x09,
  CurrentPhy = 0x0a,

  // Device info (0x20-0x26)
  BatteryLevel = 0x20,
  DeviceModel = 0x21,
  FirmwareRevision = 0x22,
  EnterDiagnosticMode = 0x23,
  DiagnosticModeComplete = 0x24,
  DisconnectAndReset = 0x25,
  DisconnectConfigureFotaAndReset = 0x26,

  // Hub properties (0x80-0x96)
  HubLocalName = 0x80,
  UserVolume = 0x81,
  CurrentWriteOffset = 0x82,
  PrimaryMacAddress = 0x84,
  UpgradeState = 0x85,
  SignedCommandNonce = 0x86,
  SignedCommand = 0x87,
  UpdateState = 0x88,
  PipelineStage = 0x89,
  UXSignal = 0x90,
  OwnershipProof = 0x91,
  ChargingState = 0x93,
  FactoryReset = 0x95,
  TravelMode = 0x96,
}

export enum CommandType {
  Read = 0x01,
  Write = 0x02,
  Response = 0x03,
}

export enum VolumeLevel {
  High = 100,
  Medium = 40,
  Low = 10,
}

export enum UpgradeStateValue {
  Ready = 0,
  InProgress = 1,
  LowBattery = 2,
}

export const KEEPALIVE_DATA = [0xea, 0x00];
export const POLL_INTERVAL_MS = 500;
export const DEFAULT_TIMEOUT_MS = 10_000;
