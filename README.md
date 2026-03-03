# **node-smartplay** — A JavaScript/TypeScript module for LEGO Smart Play BLE devices

### Introduction

`node-smartplay` lets you discover and interact with LEGO Smart Play devices over Bluetooth Low Energy.

Currently supports the **Smart Brick** (audio-equipped brick). Additional device types will be supported as they are discovered.

### Sample Usage

```javascript
const { SmartPlay } = require("node-smartplay");

const smartPlay = new SmartPlay();

smartPlay.on("discover", async (device) => { // Wait to discover a device
    console.log("Found device, connecting...");
    await device.connect();

    const info = device.info;
    console.log(`  Name:     ${info.name}`);
    console.log(`  Model:    ${info.model}`);
    console.log(`  Firmware: ${info.firmware}`);
    console.log(`  MAC:      ${info.mac}`);
    console.log(`  Battery:  ${device.battery}%`);
    console.log(`  Volume:   ${device.volume}`);

    await device.setVolumeLow(); // Set volume to low (10)
    console.log("Volume set to low");

    device.disconnect();
});

smartPlay.scan(); // Start scanning for Smart Play devices
console.log("Scanning for Smart Play devices...");
```

More examples in the `examples/` directory.

### Installation

Node.js v18+ required.

```bash
npm install node-smartplay --save
```

`node-smartplay` uses `@stoprocent/noble` for BLE. See [noble prerequisites](https://github.com/stoprocent/noble?tab=readme-ov-file#prerequisites).

### API

#### SmartPlay (Scanner)

| Method | Description |
| ------ | ----------- |
| `scan()` | Start scanning for Smart Play devices. |
| `stop()` | Stop scanning. |
| `getDevice(uuid)` | Get a discovered device by UUID. |
| `getDevices()` | Get all discovered devices. |

| Event | Description |
| ----- | ----------- |
| `discover` | Emitted when a device is found. Provides a `SmartBrickDevice` instance. |

#### SmartBrickDevice

| Method | Description |
| ------ | ----------- |
| `connect()` | Connect and perform the handshake sequence. |
| `disconnect()` | Disconnect from the device. |
| `readBattery()` | Read the current battery level (%). |
| `readVolume()` | Read the current volume level. |
| `readModel()` | Read the device model name. |
| `readFirmwareRevision()` | Read the firmware version string. |
| `setVolume(level)` | Set volume to a `VolumeLevel` value. |
| `setVolumeHigh()` | Set volume to high (100). |
| `setVolumeMedium()` | Set volume to medium (40). |
| `setVolumeLow()` | Set volume to low (10). |
| `setName(name)` | Set the device name (max 12 bytes UTF-8). |
| `readRawRegister(register)` | Read a raw register value for exploration. |

| Property | Type | Description |
| -------- | ---- | ----------- |
| `battery` | `number` | Current battery level (%). |
| `volume` | `number` | Current volume level. |
| `connected` | `boolean` | Whether the device is connected. |
| `info` | `SmartBrickInfo` | Device identity (name, model, firmware, MAC, UUID). |

| Event | Description |
| ----- | ----------- |
| `battery` | Emitted when the battery level changes. |
| `volume` | Emitted when the volume changes. |
| `connectionState` | Emitted when the charging/connection state changes. |
| `disconnect` | Emitted when the device disconnects. |

### Compatibility

| Device | Status | Notes |
| ------ | ------ | ----- |
| Smart Brick | Supported | Battery, volume, naming, device info. Authentication not yet supported (requires LEGO backend signing). |

### Known Limitations

* **Authentication** — ECDSA P-256 challenge-response requires LEGO's backend signing server. Device info, volume, and naming work without auth. Firmware updates and factory reset require it.

* **Docked only** — Devices are only connectable while on the charging base. Undocked, they use BLE 5.4 PAwR for device-to-device play and aren't visible to BLE scanners.

* **Rotating BLE addresses** — The stable identifier is the MAC address, available via `device.info.mac` after connecting.

* **Linux permissions** — You may need to [grant node access to the Bluetooth adapter](https://github.com/stoprocent/noble?tab=readme-ov-file#running-without-rootsudo-linux-specific).

### Reverse Engineering Notes

The [`notes/`](notes/) directory contains reverse engineering documentation for the Smart Play BLE protocol, hardware, backend API, and file transfer system.

### Development

```bash
npm install
npm run build
```
