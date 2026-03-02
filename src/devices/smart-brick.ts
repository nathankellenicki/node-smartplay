import { EventEmitter } from "../event-emitter";
import { createDebug } from "../logger";
import { SmartBrickConnection } from "../connection";
import {
  Register,
  VolumeLevel,
  KEEPALIVE_DATA,
  POLL_INTERVAL_MS,
} from "../constants";
import {
  parseFirmwareVersion,
  parseDeviceName,
  parseMacAddress,
  parseBatteryLevel,
  parseVolumeLevel,
  parseConnectionState,
  parseReadyFlag,
} from "../protocol";

const log = createDebug("node-smartplay:device");

export interface SmartBrickInfo {
  name: string;
  firmware: string;
  mac: string;
  uuid: string;
}

export class SmartBrickDevice extends EventEmitter {
  private readonly handleConnectionDisconnectBound = () => this.handleConnectionDisconnect();
  private isConnected = false;
  private isAuthenticated = false;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private _battery = 0;
  private _volume = 0;
  private _connectionState = 0;
  private _info: SmartBrickInfo = { name: "", firmware: "", mac: "", uuid: "" };

  constructor(
    private readonly connection: SmartBrickConnection,
    uuid: string,
  ) {
    super();
    this._info.uuid = uuid;
  }

  get battery(): number {
    return this._battery;
  }

  get volume(): number {
    return this._volume;
  }

  get connected(): boolean {
    return this.isConnected;
  }

  get authenticated(): boolean {
    return this.isAuthenticated;
  }

  get info(): SmartBrickInfo {
    return { ...this._info };
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      await this.connection.open();

      this.connection.on("disconnect", this.handleConnectionDisconnectBound);

      // Phase 2: Handshake — read device identity registers
      log("starting handshake");

      const fwResponse = await this.connection.readRegister(Register.FirmwareVersion);
      this._info.firmware = parseFirmwareVersion(fwResponse.data);
      log("firmware: %s", this._info.firmware);

      const volResponse = await this.connection.readRegister(Register.Volume);
      this._volume = parseVolumeLevel(volResponse.data);
      log("volume: %d", this._volume);

      const macResponse = await this.connection.readRegister(Register.MacAddress);
      this._info.mac = parseMacAddress(macResponse.data);
      log("mac: %s", this._info.mac);

      const nameResponse = await this.connection.readRegister(Register.DeviceName);
      this._info.name = parseDeviceName(nameResponse.data);
      log("name: %s", this._info.name);

      const batteryResponse = await this.connection.readRegister(Register.Battery);
      this._battery = parseBatteryLevel(batteryResponse.data);
      log("battery: %d%%", this._battery);

      // Phase 3: Setup — keepalive + config
      log("sending setup commands");
      await this.connection.writeRegister(Register.Keepalive, KEEPALIVE_DATA, false);

      const configResponse = await this.connection.readRegister(Register.DeviceConfig);
      log("device config: %s", Array.from(configResponse.data).map((b) => b.toString(16).padStart(2, "0")).join(""));

      // Auth skipped — ECDSA P-256 signing requires LEGO's backend server.
      // Reading register 0x86 (auth nonce) triggers BLE pairing, so we avoid it.

      this.isConnected = true;
      log("connected (unauthenticated)");

      // Start polling loop
      this.startPolling();
    } catch (error) {
      this.connection.off("disconnect", this.handleConnectionDisconnectBound);
      this.connection.disconnect();
      throw error;
    }
  }

  disconnect(): void {
    this.stopPolling();
    this.connection.off("disconnect", this.handleConnectionDisconnectBound);
    this.connection.disconnect();
    this.isConnected = false;
    this.isAuthenticated = false;
    this.emit("disconnect");
  }

  async readBattery(): Promise<number> {
    const response = await this.connection.readRegister(Register.Battery);
    const level = parseBatteryLevel(response.data);
    if (level !== this._battery) {
      this._battery = level;
      this.emit("battery", level);
    }
    return level;
  }

  async readVolume(): Promise<number> {
    const response = await this.connection.readRegister(Register.Volume);
    const level = parseVolumeLevel(response.data);
    if (level !== this._volume) {
      this._volume = level;
      this.emit("volume", level);
    }
    return level;
  }

  async setVolume(level: VolumeLevel): Promise<void> {
    // Check ready flag before writing volume
    const readyResponse = await this.connection.readRegister(Register.ReadyFlag);
    const ready = parseReadyFlag(readyResponse.data);
    if (!ready) {
      throw new Error("Device is busy, cannot set volume");
    }

    // Write new volume
    await this.connection.writeRegister(Register.Volume, [level], true);

    // Verify
    const verifyResponse = await this.connection.readRegister(Register.Volume);
    const newLevel = parseVolumeLevel(verifyResponse.data);
    if (newLevel !== this._volume) {
      this._volume = newLevel;
      this.emit("volume", newLevel);
    }
    log("volume set to %d", newLevel);
  }

  async setVolumeHigh(): Promise<void> {
    return this.setVolume(VolumeLevel.High);
  }

  async setVolumeMedium(): Promise<void> {
    return this.setVolume(VolumeLevel.Medium);
  }

  async setVolumeLow(): Promise<void> {
    return this.setVolume(VolumeLevel.Low);
  }

  private startPolling(): void {
    if (this.pollTimer) {
      return;
    }
    log("starting poll loop (%dms interval)", POLL_INTERVAL_MS);
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = undefined;
      log("poll loop stopped");
    }
  }

  private async poll(): Promise<void> {
    try {
      // Read connection state
      const stateResponse = await this.connection.readRegister(Register.ConnectionState);
      const state = parseConnectionState(stateResponse.data);
      if (state !== this._connectionState) {
        this._connectionState = state;
        this.emit("connectionState", state);
        log("connection state changed: 0x%s", state.toString(16));
      }

      // Send keepalive
      await this.connection.writeRegister(Register.Keepalive, KEEPALIVE_DATA, false);

      // Read battery
      const batteryResponse = await this.connection.readRegister(Register.Battery);
      const battery = parseBatteryLevel(batteryResponse.data);
      if (battery !== this._battery) {
        this._battery = battery;
        this.emit("battery", battery);
        log("battery changed: %d%%", battery);
      }
    } catch (error) {
      log("poll error: %O", error);
    }
  }

  private handleConnectionDisconnect(): void {
    this.stopPolling();
    this.connection.off("disconnect", this.handleConnectionDisconnectBound);
    this.isConnected = false;
    this.isAuthenticated = false;
    this.emit("disconnect");
  }
}
