import type { Characteristic, Peripheral, Service } from "@stoprocent/noble";
import { EventEmitter } from "./event-emitter";
import { createDebug } from "./logger";
import {
  CONTROL_POINT_CHAR_UUID,
  DATA_CHANNEL_1_CHAR_UUID,
  DATA_CHANNEL_2_CHAR_UUID,
  DATA_CHANNEL_3_CHAR_UUID,
  BIDIRECTIONAL_CHAR_UUID,
  SERVICE_CHANGED_CHAR_UUID,
  FEF6_SERVICE_SHORT,
  DEFAULT_TIMEOUT_MS,
  Register,
} from "./constants";
import {
  RegisterResponse,
  encodeReadCommand,
  encodeWriteCommand,
  decodeResponse,
  getRegisterKey,
} from "./protocol";

const log = createDebug("node-smartplay:connection");
const logRaw = createDebug("node-smartplay:connection:raw");

type PendingRequest = {
  resolve: (msg: RegisterResponse) => void;
  reject: (err: Error) => void;
  timeout: NodeJS.Timeout;
};

/** @internal */
export class SmartBrickConnection extends EventEmitter {
  private controlPoint?: Characteristic;
  private readonly pending = new Map<string, PendingRequest[]>();
  private readonly handleDataBound = (data: Buffer) => this.handleIncoming(data);
  private readonly handlePeripheralDisconnectBound = () => this.handlePeripheralDisconnect();
  private isOpen = false;

  constructor(public readonly peripheral: Peripheral) {
    super();
  }

  async open(): Promise<void> {
    if (this.isOpen) {
      return;
    }

    await connectPeripheral(this.peripheral);

    const { characteristics } = await discoverAllServicesAndCharacteristics(this.peripheral);

    const controlPoint = findCharacteristic(characteristics, CONTROL_POINT_CHAR_UUID);
    const dataCh1 = findCharacteristic(characteristics, DATA_CHANNEL_1_CHAR_UUID);
    const dataCh2 = findCharacteristic(characteristics, DATA_CHANNEL_2_CHAR_UUID);
    const dataCh3 = findCharacteristic(characteristics, DATA_CHANNEL_3_CHAR_UUID);
    const bidir = findCharacteristic(characteristics, BIDIRECTIONAL_CHAR_UUID);
    const serviceChanged = findCharacteristic(characteristics, SERVICE_CHANGED_CHAR_UUID);

    if (!controlPoint) {
      throw new Error("Unable to locate Control Point characteristic");
    }

    // Subscribe CCCDs in the order observed in the Android HCI capture
    if (bidir) {
      log("subscribing to bidirectional channel");
      await subscribe(bidir);
    }
    log("subscribing to control point");
    await subscribe(controlPoint);
    if (dataCh1) {
      log("subscribing to data channel 1");
      await subscribe(dataCh1);
    }
    if (dataCh2) {
      log("subscribing to data channel 2");
      await subscribe(dataCh2);
    }
    if (dataCh3) {
      log("subscribing to data channel 3");
      await subscribe(dataCh3);
    }
    if (serviceChanged) {
      log("subscribing to service changed");
      await subscribe(serviceChanged);
    }

    this.peripheral.on("disconnect", this.handlePeripheralDisconnectBound);
    this.controlPoint = controlPoint;
    controlPoint.on("data", this.handleDataBound);
    this.isOpen = true;
    log("connection open");
  }

  async readRegister(register: Register, timeoutMs?: number): Promise<RegisterResponse> {
    const data = encodeReadCommand(register);
    return this.request(data, register, timeoutMs);
  }

  async writeRegister(
    register: Register,
    data: number[] | Buffer,
    expectResponse: boolean = true,
    timeoutMs?: number,
  ): Promise<RegisterResponse | void> {
    const encoded = encodeWriteCommand(register, data);
    if (!expectResponse) {
      await this.send(encoded);
      return;
    }
    return this.request(encoded, register, timeoutMs);
  }

  async request(
    data: Buffer,
    register: Register,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<RegisterResponse> {
    if (!this.controlPoint) {
      throw new Error("Connection is not ready");
    }

    const key = getRegisterKey(register);

    const responsePromise = new Promise<RegisterResponse>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.rejectPending(key, new Error(`Request '${key}' timed out`));
      }, timeoutMs);

      const entry: PendingRequest = {
        resolve: (msg) => {
          clearTimeout(timeout);
          resolve(msg);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
        timeout,
      };

      const queue = this.pending.get(key) ?? [];
      queue.push(entry);
      this.pending.set(key, queue);
    });

    log("sending command register=0x%s data=%s", register.toString(16).padStart(2, "0"), formatHex(data));
    await writeWithResponse(this.controlPoint, data);
    return responsePromise;
  }

  async send(data: Buffer): Promise<void> {
    if (!this.controlPoint) {
      throw new Error("Connection is not ready");
    }
    logRaw("tx (fire-and-forget) %s", formatHex(data));
    await writeWithResponse(this.controlPoint, data);
  }

  disconnect(): void {
    this.peripheral.removeListener("disconnect", this.handlePeripheralDisconnectBound);

    if (this.controlPoint) {
      this.controlPoint.removeListener("data", this.handleDataBound);
    }

    this.peripheral.disconnect();
    this.isOpen = false;

    for (const [key] of this.pending) {
      this.rejectPending(key, new Error("Connection closed"));
    }
    this.pending.clear();
    this.emit("disconnect");
  }

  private handleIncoming(raw: Buffer): void {
    logRaw("rx %s", formatHex(raw));

    const parsed = decodeResponse(raw);
    if (!parsed) {
      return;
    }

    const key = getRegisterKey(parsed.register);
    const pendingQueue = this.pending.get(key);

    if (pendingQueue && pendingQueue.length > 0) {
      const entry = pendingQueue.shift();
      if (entry) {
        log(
          "received response register=0x%s data=%s",
          parsed.register.toString(16).padStart(2, "0"),
          formatHex(parsed.data),
        );
        entry.resolve(parsed);
      }
      if (pendingQueue.length === 0) {
        this.pending.delete(key);
      }
      return;
    }

    // Unsolicited notification (e.g., idle beacon 03 02 00)
    log("received unsolicited register=0x%s data=%s", parsed.register.toString(16).padStart(2, "0"), formatHex(parsed.data));
    this.emit("notification", parsed);
  }

  private handlePeripheralDisconnect(): void {
    this.disconnect();
  }

  private rejectPending(key: string, error: Error): void {
    const queue = this.pending.get(key);
    if (!queue) {
      return;
    }
    while (queue.length) {
      const entry = queue.shift();
      if (entry) {
        clearTimeout(entry.timeout);
        entry.reject(error);
      }
    }
    this.pending.delete(key);
  }
}

export function matchesSmartBrickService(peripheral: Peripheral): boolean {
  const services = peripheral.advertisement?.serviceUuids ?? [];
  return services.some((uuid) => normalizeUuid(uuid) === normalizeUuid(FEF6_SERVICE_SHORT));
}

function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

function findCharacteristic(characteristics: Characteristic[], targetUuid: string): Characteristic | undefined {
  const normalized = normalizeUuid(targetUuid);
  return characteristics.find((c) => normalizeUuid(c.uuid) === normalized);
}

async function connectPeripheral(peripheral: Peripheral): Promise<void> {
  if (peripheral.state === "connected") {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    peripheral.connect((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function discoverAllServicesAndCharacteristics(
  peripheral: Peripheral,
): Promise<{ services: Service[]; characteristics: Characteristic[] }> {
  return new Promise((resolve, reject) => {
    peripheral.discoverAllServicesAndCharacteristics((err, services, characteristics) => {
      if (err) {
        reject(err);
      } else {
        resolve({ services: services ?? [], characteristics: characteristics ?? [] });
      }
    });
  });
}

async function subscribe(characteristic: Characteristic): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    characteristic.subscribe((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

async function writeWithResponse(characteristic: Characteristic, data: Buffer): Promise<void> {
  logRaw("tx %s", formatHex(data));
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(data);
  await new Promise<void>((resolve, reject) => {
    // false = write WITH response (ATT Write Request)
    characteristic.write(payload, false, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function formatHex(data: Buffer | Uint8Array): string {
  return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
