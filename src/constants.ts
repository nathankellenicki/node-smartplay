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
  IdleBeacon = 0x02,
  DeviceConfig = 0x08,
  Battery = 0x20,
  FirmwareVersion = 0x22,
  DeviceName = 0x80,
  Volume = 0x81,
  MacAddress = 0x84,
  ReadyFlag = 0x85,
  AuthNonce = 0x86,
  AuthResponse = 0x87,
  CryptoData = 0x88,
  Keepalive = 0x90,
  SetupCommand = 0x91,
  ConnectionState = 0x93,
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

export enum ConnectionState {
  Initial = 0x01,
  Connected = 0x61,
  SetupComplete = 0xa0,
  Active = 0xa1,
}

export const KEEPALIVE_DATA = [0xea, 0x00];
export const POLL_INTERVAL_MS = 500;
export const DEFAULT_TIMEOUT_MS = 10_000;
