import type { Peripheral } from "@stoprocent/noble";
import { EventEmitter } from "./event-emitter";
import { FEF6_SERVICE_SHORT, LEGO_COMPANY_IDENTIFIER } from "./constants";
import { SmartBrickConnection, matchesSmartBrickService } from "./connection";
import { SmartBrickDevice } from "./devices";
import { createDebug } from "./logger";

const log = createDebug("node-smartplay:scanner");

/** @internal */
type NobleAdapter = {
  state: string;
  on(event: "discover", listener: (peripheral: Peripheral) => void): void;
  on(event: "stateChange", listener: (state: string) => void): void;
  removeListener(event: "discover" | "stateChange", listener: (...args: any[]) => void): void;
  startScanning(serviceUUIDs: string[], allowDuplicates: boolean, callback: (err?: Error | null) => void): void;
  stopScanning(): void;
};

/**
 * Main entry point for discovering and managing LEGO Smart Play BLE devices.
 * Create an instance and call {@link scan} to begin discovering nearby devices.
 */
export class SmartPlay extends EventEmitter {
  private scanning = false;
  private readonly discovered = new Set<string>();
  private readonly devices = new Map<string, SmartBrickDevice>();
  private readonly handleDiscoverBound = (peripheral: Peripheral) => {
    this.handleDiscover(peripheral);
  };
  private adapter: NobleAdapter | undefined;

  /** @internal */
  constructor(adapter?: NobleAdapter) {
    super();
    this.adapter = adapter;
  }

  /**
   * Begin scanning for Smart Play devices over BLE.
   * Emits a "discover" event for each new device found.
   */
  async scan(): Promise<void> {
    if (this.scanning) {
      return;
    }
    this.scanning = true;

    const adapter = await this.getAdapter();
    adapter.on("discover", this.handleDiscoverBound);

    try {
      await this.startScanning(adapter);
    } catch (error) {
      adapter.removeListener("discover", this.handleDiscoverBound);
      this.scanning = false;
      throw error;
    }
  }

  /**
   * Stop scanning and clear the discovered device inventory.
   */
  stop(): void {
    if (!this.scanning) {
      return;
    }
    this.scanning = false;
    this.discovered.clear();
    this.devices.clear();
    if (this.adapter) {
      this.adapter.removeListener("discover", this.handleDiscoverBound);
      try {
        this.adapter.stopScanning();
      } catch (error) {
        // Ignore stop errors; adapter may already be stopped.
      }
    }
  }

  /**
   * Get a discovered device by its UUID.
   */
  getDevice(uuid: string): SmartBrickDevice | undefined {
    return this.devices.get(uuid);
  }

  /**
   * Get all discovered devices.
   */
  getDevices(): SmartBrickDevice[] {
    return Array.from(this.devices.values());
  }

  private handleDiscover(peripheral: Peripheral): void {
    if (!matchesSmartBrickService(peripheral)) {
      return;
    }

    if (this.discovered.has(peripheral.id)) {
      return;
    }

    if (!hasLegoManufacturerData(peripheral)) {
      return;
    }

    log("discovered device: %s (%s)", peripheral.advertisement?.localName ?? "unknown", peripheral.id);

    const connection = new SmartBrickConnection(peripheral);
    const device = new SmartBrickDevice(connection, peripheral.uuid);

    this.discovered.add(peripheral.id);
    this.devices.set(peripheral.uuid, device);

    peripheral.once("disconnect", () => {
      this.discovered.delete(peripheral.id);
      this.devices.delete(peripheral.uuid);
    });

    this.emit("discover", device);
  }

  private async startScanning(adapter: NobleAdapter): Promise<void> {
    if (adapter.state === "poweredOn") {
      await beginScanning(adapter);
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        adapter.removeListener("stateChange", handleStateChange);
      };
      const handleStateChange = (state: string) => {
        if (state === "poweredOn") {
          cleanup();
          beginScanning(adapter).then(resolve).catch(reject);
        } else if (state === "unauthorized" || state === "unsupported") {
          cleanup();
          reject(new Error(`Bluetooth adapter is ${state}`));
        }
      };
      adapter.on("stateChange", handleStateChange);
    });
  }

  private async getAdapter(): Promise<NobleAdapter> {
    if (this.adapter) {
      return this.adapter;
    }
    const module = await import("@stoprocent/noble");
    const adapter = (module as { default?: NobleAdapter }).default ?? (module as unknown as NobleAdapter);
    this.adapter = adapter;
    return adapter;
  }
}

function hasLegoManufacturerData(peripheral: Peripheral): boolean {
  const data = peripheral.advertisement?.manufacturerData;
  if (!data || data.length < 2) {
    return false;
  }
  const companyId = (data[1]! << 8) | data[0]!;
  return companyId === LEGO_COMPANY_IDENTIFIER;
}

async function beginScanning(adapter: NobleAdapter): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    adapter.startScanning([FEF6_SERVICE_SHORT], false, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
