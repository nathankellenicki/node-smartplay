import { CommandType, Register } from "./constants";

export interface RegisterResponse {
  type: CommandType;
  register: number;
  data: Buffer;
}

export function encodeReadCommand(register: Register): Buffer {
  return Buffer.from([CommandType.Read, register]);
}

export function encodeWriteCommand(register: Register, data: number[] | Buffer): Buffer {
  const buf = Buffer.alloc(2 + data.length);
  buf[0] = CommandType.Write;
  buf[1] = register;
  const src = Buffer.isBuffer(data) ? data : Buffer.from(data);
  src.copy(buf, 2);
  return buf;
}

export function decodeResponse(raw: Buffer): RegisterResponse | null {
  if (raw.length < 2) {
    return null;
  }
  const type = raw[0];
  if (type !== CommandType.Response) {
    return null;
  }
  const register = raw[1]!;
  const data = raw.subarray(2);
  return { type, register, data };
}

export function getRegisterKey(register: number): string {
  return `reg:${register.toString(16).padStart(2, "0")}`;
}

export function parseFirmwareVersion(data: Buffer): string {
  const end = data.indexOf(0);
  const str = data.subarray(0, end === -1 ? undefined : end).toString("utf8");
  return str;
}

export function parseDeviceName(data: Buffer): string {
  const end = data.indexOf(0);
  const str = data.subarray(0, end === -1 ? undefined : end).toString("utf8");
  return str;
}

export function parseMacAddress(data: Buffer): string {
  return Array.from(data.subarray(0, 6))
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(":");
}

export function parseBatteryLevel(data: Buffer): number {
  return data[0] ?? 0;
}

export function parseVolumeLevel(data: Buffer): number {
  return data[0] ?? 0;
}

export function parseConnectionState(data: Buffer): number {
  return data[0] ?? 0;
}

export function parseReadyFlag(data: Buffer): boolean {
  return (data[0] ?? 0) === 0;
}
