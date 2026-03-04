# LEGO ConnectKit SDK Overview

> Extracted from the SmartAssist APK via Il2CppDumper. Reflects class definitions and metadata, not runtime behaviour. May contain errors.

Extracted from the LEGO SmartAssist APK (`com.lego.smartassist`, codename "Horizon") via Il2CppDumper. ConnectKit version **6.2.0-preview.234**, Unity **6000.1.17f1**.

LEGO's internal BLE SDK, shipped as a Unity package (`com.lego.sdk.dpt.connectkit`) inside all companion apps. Integrates every generation of connected hardware — WeDo 2.0 (2016) through Smart Brick (2025) — behind a single interface. Identifies hub type from BLE advertisements, selects the right protocol stack, and exposes uniform services. App code calls `GetBatteryLevel()` the same way regardless of whether the hub speaks LWP3, WDX, or P11/RPC.

The Smart Brick (AudioBrick) uses the WDX stack. Full extracted reference in `randomfiles/CONNECT_KIT.md`.

## Hub Types

| Enum | System ID | Name | Protocol |
| --- | --- | --- | --- |
| Hub32 | 0x20 | WeDo 2.0 Smart Hub | LWP3 |
| Hub33 | 0x21 | DUPLO Train Base | LWP3 |
| Hub64 | 0x40 | Boost Move Hub | LWP3 |
| Hub65 | 0x41 | City Hub (Powered Up 2-port) | LWP3 |
| Hub66 | 0x42 | Remote Control Handset | LWP3 |
| Hub67 | 0x43 | Mario Hub | LWP3/LEAF |
| Hub68 | 0x44 | Technic Large Hub (6-port) | LWP3 |
| Hub69 | 0x45 | Luigi/Peach Hub | LWP3/LEAF |
| Hub128 | 0x80 | Technic Hub / SPIKE Prime | LWP3 |
| Hub129 | 0x81 | SPIKE Essential | LWP3 |
| Hub131 | 0x83 | SPIKE Prime 2 | LWP3 |
| Hub132 | 0x84 | Hub132 | LWP3 |
| **AudioBrick** | — | **Smart Brick** | **WDX** |

All hubs advertise with LEGO company ID `0x0397`. Manufacturer data byte 3 encodes `HubSystemType` (upper bits) and device number (lower bits).

## Protocol Stacks

Three different BLE protocols, each reflecting a different hardware generation:

| Stack | BLE Service | Era | Chipset | Used By |
| --- | --- | --- | --- | --- |
| **LWP3** | `00001623-...` | 2016–present | TI CC2640/CC26x2 + Nordic | WeDo, Boost, Powered Up, Technic, SPIKE, DUPLO Train, Mario |
| **WDX** | `0000fef6-...` | 2024–present | EM Microelectronic EM9305 (ARC, Arm Cordio) | Smart Brick, PanelCharger |
| **P11/RPC** | `005F0001-3FF2-...` | 2025–present | EM9305 (Arm Cordio) | Newer P11 platform hubs |

### LWP3 (LEGO Wireless Protocol v3)

Used by the majority of LEGO connected products, and by node-poweredup. Message-framed: `[Length, HubID, MessageType, ...Payload]`. Port-based I/O — peripherals attach to ports, addressed by port ID. The LEAF variant (Mario/Luigi/Peach) extends LWP3 with game engine IO types.

### WDX (Wireless Data Exchange)

The Smart Brick's protocol. Based on the Arm Cordio / Packetcraft WDX profile. Register-based property get/set over a control point, plus file transfer channels for firmware, telemetry, and fault logs. No port-based I/O — single unit with named properties. See [PROTOCOL.md](PROTOCOL.md) and [FILE_TRANSFER.md](FILE_TRANSFER.md).

### P11/RPC (JAM + MessagePack)

Newest protocol, same Cordio-based chips as WDX. Separate Tx/Rx characteristics, MessagePack-serialized RPC calls in JAM framing with hash-based procedure addressing. Likely the direction for future products.

## WDX Services (AudioBrick)

Four high-level services for the Smart Brick:

| Service | Description | Registers Used |
| --- | --- | --- |
| FirmwareUpdateService | Firmware upload, battery, charging, UXSignal, travel mode | 0x20, 0x26, 0x85, 0x88, 0x89, 0x90, 0x93, 0x96 |
| TelemetryService | Download/erase telemetry data | File handle 3 |
| FaultLogService | Download/erase fault logs | File handle 2 |
| WdxSecurityService | Ownership, factory reset, telemetry consent | 0x86, 0x87, 0x91, 0x95 |

## WDX Products

| Value | Product |
| --- | --- |
| 0 | AudioBrick (Smart Brick) |
| 1 | PanelCharger |

## IO Types (48 total)

48 peripheral types defined across all hub families. Most are LWP3-only.

The Smart Brick uses WDX registers, not LWP3 port-based IO, so these IO types are likely all LWP3/LEAF. Listed for reference:

| ID | Name | Notes |
| --- | --- | --- |
| 0x2A (42) | SoundPlayer | Sound playback |
| 0x49 (73) | LEAFTag | LEGO Mario tag reader |
| 0x59 (89) | PlayVM | Play Virtual Machine — possibly Mario/Journey, not confirmed Smart Brick |
| 0x5A (90) | JourneyGameEngine | Journey (Mario/Luigi/Peach) game engine |
| 0xFF (255) | JourneyColorSensor | Journey color sensor (Mode 1 = "Tag") |

## Signed Commands

Two categories:

**Backend-signed** (app sends nonce to LEGO server, gets ECDSA signature back):

| Type | Value | Description |
| --- | --- | --- |
| Unlock | 1 | Unlock device |
| EnableTelemetryConsent | 2 | Enable/disable telemetry |
| FactoryReset | 3 | Factory reset |
| StartFirmwareUpgrade | 4 | Start firmware OTA |

**Device-signed** (hub generates signed proof, app forwards to server for verification):

| Type | Value | Description |
| --- | --- | --- |
| Ownership | 1 | Ownership proof |
| ReowningSuspensionStatus | 2 | Reowning cooldown check |
