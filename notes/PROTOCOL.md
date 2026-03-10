# LEGO Smart Play — BLE Protocol

> Reverse engineered from Android HCI (btsnoop) captures and APK decompilation (Il2CppDumper). Not everything is visible in traffic — some payloads are encrypted. May contain errors.

## Overview

GATT server exposed when docked on charging base. Register-based command/response protocol over the WDX service (`0xFEF6`).

GATT server exposed when docked on charging base. Undocked bricks with single-brick content do not advertise. Undocked bricks with multi-brick content (PAwR active) advertise as "Smart Brick" but are **not connectable**. See [BLE Advertisement](#ble-advertisement) for full details and [HARDWARE.md](HARDWARE.md) for PAwR play communication.

## BLE Advertisement

When docked, the brick advertises as:

| Field | Value |
| --- | --- |
| Name | `Smart Brick` |
| Address Type | LE Random (rotates frequently) |
| Connectable | Yes |
| AD Flags | `0x06` (General Discoverable, BR/EDR Not Supported) |
| Service UUIDs | `0xFEF6` (WDX) |
| Manufacturer Data | `97 03 00 60 00 00 00 00` |

First two bytes of manufacturer data are LEGO company ID `0x0397` (little-endian). Remaining bytes are device-specific.

BLE random addresses rotate frequently — same brick shows different addresses across scans. Stable identifier is the MAC in register `0x84`, readable after connecting.

### When Is The Brick Connectable?

**Only when it boots while docked on a charging base.** Confirmed from firmware disassembly — there are no other triggers (no button, motion sensor, timer, or play-state transition that independently enables connectable advertising).

| Scenario | BLE Connectable? |
| --- | --- |
| Booted while docked | Yes |
| Booted while undocked (single-brick tag) | No — not advertising |
| Booted while undocked (multi-brick tag) | Advertises "Smart Brick" but not connectable |
| Undocked after booting docked | Likely continues connectable advertising — no re-check of dock state |
| Brick-to-brick PAwR | Standard non-connectable advertising + PAwR on separate address |
| Firmware update (DFU) | Special DFU advertising only |

The firmware performs a **one-time charger detection at boot** (`0xF0FC`). It reads a hardware status byte at `0x80942C` and tests bit 4 (dock/USB charger). If docked, connectable advertising starts immediately. If undocked with single-brick content, no advertising occurs. If undocked with multi-brick content (PAwR required), non-connectable "Smart Brick" advertising is started alongside PAwR — radio captures confirm three undocked bricks advertising simultaneously during PAwR play, each visible to scanners but not connectable by Smart Assist.

If docked, the charger type byte at `0x801420` offset 0 is checked — only types `0x02` and `0x04` (two dock variants) enable connectable advertising. The charger identification uses FNV-1a hashing against hardware ID data and runs once at boot; there is no GPIO interrupt, polling loop, or timer that re-checks dock state at runtime.

Once advertising is running, 17 call sites in the Cordio BLE connection state machine automatically restart advertising after connection lifecycle events (connect, disconnect, parameter change, link supervision timeout). These restarts do not re-check dock state — they unconditionally restart advertising. This means a brick that was docked at boot will likely remain connectable even if physically removed from the dock during operation.

PAwR periodic advertising (used for brick-to-brick play communication) runs on a **separate BLE address** from the brick's standard advertising. When PAwR is active, standard non-connectable "Smart Brick" advertising also runs — the brick is discoverable to scanners but not connectable by Smart Assist. See [HARDWARE.md](HARDWARE.md) and [PAWR.md](PAWR.md) for PAwR details.

## BLE Services

### Standard Services

**Generic Access (0x1800):**

| Characteristic | UUID | Value |
| --- | --- | --- |
| Device Name | `0x2A00` | `"Smart Brick"` |
| Appearance | `0x2A01` | `0x0000` (Unknown) |

**Device Information (0x180A):**

| Characteristic | UUID | Value |
| --- | --- | --- |
| Manufacturer Name | `0x2A29` | `"LEGO"` |
| Model Number | `0x2A24` | `"Smart Brick"` |
| Firmware Revision | `0x2A26` | e.g. `"2.29.2"` |
| Software Revision | `0x2A28` | e.g. `"2.29.2"` |

### WDX Service (0xFEF6) — Primary Protocol Service

UUID base: `005fXXXX-2ff2-4ed5-b045-4c7463617865`

The trailing bytes `4c7463617865` decode to "LtcaxE" — "ExactL" reversed, a reference to the Wicentric exactLE stack that became Arm Cordio.

| Characteristic | UUID | Properties | Role |
| --- | --- | --- | --- |
| Control Point | `005f0002-2ff2-...` | Write, Notify | Main command/response channel |
| Data Channel 1 | `005f0003-2ff2-...` | WriteWithoutResponse, Notify | Bulk data transfer |
| Data Channel 2 | `005f0004-2ff2-...` | WriteWithoutResponse, Notify | Bulk data transfer |
| Data Channel 3 | `005f0005-2ff2-...` | Write, Notify | Bulk data transfer |

### Custom LEGO Service

UUID base: `005fXXXX-3ff2-4ed5-b045-4c7463617865`

| Characteristic | UUID | Properties | Notes |
| --- | --- | --- | --- |
| Command Input | `005f0009-3ff2-...` | Write | Accepts writes silently, purpose unknown |
| Bidirectional Channel | `005f000a-3ff2-...` | Read, Write, Notify | Sends empty notifications periodically |

## Register Protocol

All communication goes through the **Control Point** characteristic. Three message types:

| Type | Byte | Direction | Format |
| --- | --- | --- | --- |
| Read | `0x01` | App → Brick | `01 RR` |
| Write | `0x02` | App → Brick | `02 RR VV [VV...]` |
| Response | `0x03` | Brick → App | `03 RR VV [VV...]` |

Responses echo the register byte from the corresponding read or write command: `03 RR VV` means "register RR contains value VV".

The brick sends an idle beacon `03 02 00 0C 00 00 00 F4 01` unprompted before any commands are issued.

## Register Map

### BLE Connection (0x01–0x0A)

| Register | Hex | Access | Description |
| --- | --- | --- | --- |
| ConnectionParameterUpdateReq | `0x01` | Write | Request connection parameter update |
| CurrentConnectionParameters | `0x02` | Read | Current connection parameters |
| DisconnectReq | `0x03` | Write | Request disconnect |
| ConnectionSecurityLevel | `0x04` | Read | Current security level |
| SecurityReq | `0x05` | Write | Request security/pairing |
| ServiceChanged | `0x06` | Read | Service changed indication |
| DeleteBonds | `0x07` | Write | Delete bonding information |
| CurrentAttMtu | `0x08` | Read | Current ATT MTU (uint16 LE, typically 244 or 20) |
| PhyUpdateReq | `0x09` | Write | Request PHY update |
| CurrentPhy | `0x0A` | Read | Current PHY setting |

### Device Info (0x20–0x26)

| Register | Hex | Access | Type | Description |
| --- | --- | --- | --- | --- |
| BatteryLevel | `0x20` | Read | uint8 | Battery percentage (0–100) |
| DeviceModel | `0x21` | Read | string | Model identifier (null-terminated) |
| FirmwareRevision | `0x22` | Read | string | Firmware version, e.g. `"2.29.2"` (16 bytes, null-padded) |
| EnterDiagnosticMode | `0x23` | Write | — | Enter diagnostic mode (requires auth) |
| DiagnosticModeComplete | `0x24` | Read | — | Diagnostic mode completion (requires auth) |
| DisconnectAndReset | `0x25` | Write | — | Disconnect and reset (requires auth) |
| DisconnectConfigureFotaAndReset | `0x26` | Write | — | Disconnect, configure FOTA, reset (requires auth) |

### Hub Properties (0x80–0x96)

| Register | Hex | Access | Type | Description |
| --- | --- | --- | --- | --- |
| HubLocalName | `0x80` | Read/Write | string | Device name (null-terminated, max 12 bytes UTF-8) |
| UserVolume | `0x81` | Read/Write | uint8 | Volume: Low=10, Medium=40, High=100 |
| CurrentWriteOffset | `0x82` | Read | — | Current write offset for file transfers |
| PrimaryMacAddress | `0x84` | Read | 6 bytes | BLE MAC address (e.g. `9C:9A:C0:46:68:4A`) |
| UpgradeState | `0x85` | Read | uint8 | 0=Ready, 1=InProgress, 2=LowBattery |
| SignedCommandNonce | `0x86` | Read | 8 bytes | Authentication nonce (triggers BLE pairing) |
| SignedCommand | `0x87` | Write | 75 bytes | Authentication payload (see Authentication) |
| UpdateState | `0x88` | Read | 20 bytes | Device identity fingerprint (SHA-1, same across bricks) |
| PipelineStage | `0x89` | Read | uint8 | Build pipeline stage (dev/qa/staging/release) |
| UXSignal | `0x90` | Write | — | Keepalive signal (`EA 00`, fire-and-forget) |
| OwnershipProof | `0x91` | Write | uint8 | Ownership proof command (requires auth) |
| ChargingState | `0x93` | Read | uint8 | Connection/charging state |
| FactoryReset | `0x95` | Write | — | Factory reset (requires auth) |
| TravelMode | `0x96` | Read/Write | — | Travel/shipping mode |

### Undocumented Registers

Present in firmware but **not in the ConnectKit SDK** — the official app does not use them. Discovered by comparing the firmware dispatch table against the SDK enum.

| Register | Hex | Access | Size | Description |
| --- | --- | --- | --- | --- |
| — | `0x83` | Read | 4 bytes | Internal firmware state — exact meaning unknown |
| — | `0x92` | Read | 1 byte | Reads from RAM `0x807A78`, written by ASIC/tag driver — possibly tag reader status |
| — | `0x94` | Read | 1 byte | Hardware timer/clock readout from MMIO peripheral |

Register `0x92` is the most interesting — its backing RAM address is written from the tag ASIC driver area of the firmware (`0x694D8`–`0x69A74`). It may reflect NFC tag reader state.

### PAwR Registers (Brick-to-Brick)

Handled by a secondary write handler at `0x6CC8C`. Not used by the app over BLE — these are internal to the PAwR brick-to-brick subsystem.

| Register | Hex | Access | Description |
| --- | --- | --- | --- |
| — | `0x1B` | Write | PAwR train sync (16 bytes config data) |
| — | `0x1C` | Write | PAwR data exchange (8 bytes, triple-buffered) |
| — | `0x25` | Write | PAwR session parameter A |
| — | `0x26` | Write | PAwR session parameter B |

### Smart Tags and BLE

**Smart Tag events are NOT exposed over BLE.** The tag subsystem is entirely internal to the brick:

1. Tags are detected by the NFC ASIC and processed by the play engine
2. Tag state changes are broadcast to other bricks via PAwR
3. The phone/app has zero awareness of tags — the ConnectKit SDK has no tag API, no tag methods, no tag fields

The firmware's WDX register dispatch has **no register that reports tag UID, tag type, or tag events**. No code path exists from tag detection to BLE notification sending. This was confirmed by:

- Complete enumeration of all WDX read/write handlers in the firmware dispatch at `0x3FA24`
- Cross-referencing against the ConnectKit SDK `IWdxProtocolProcessor.Properties` enum (exact match, no missing entries)
- Tracing the tag scan loop (`0x67634`) — it terminates in internal message queues and PAwR broadcasts, never reaching the BLE notification path (`0x38BF0`)

Register `0x92` is the closest thing to tag-visible state over BLE, but it returns only a single status byte, not tag identification data. Probing it during tag placement may reveal whether it reflects reader state.

## Connection Lifecycle

### Phase 1: CCCD Subscription

Enable notifications on characteristics in this order:

1. Bidirectional channel (`005f000a`, custom service)
2. Control Point (`005f0002`, FEF6 service)
3. Data Channel 1 (`005f0003`)
4. Data Channel 2 (`005f0004`)
5. Data Channel 3 (`005f0005`)
6. Service Changed (`0x2A05`)

The first CCCD write to the Control Point may fail. Retry after ~5 seconds.

### Phase 2: Handshake

Read device identity registers. The official app repeats this sequence 3 times:

```
→ 01 22    ← 03 22 "2.29.2\0..."   Firmware version (16 bytes, null-padded)
→ 01 81    ← 03 81 64               Volume (0x64 = 100 = High)
→ 01 84    ← 03 84 9C9AC046684A     MAC address (6 bytes)
→ 01 80    ← 03 80 "Smart Brick"    Device name
```

### Phase 3: Setup

```
→ 02 90 EA 00                       Keepalive (no response expected)
→ 01 08    ← 03 08 F4 00            ATT MTU (varies per device)
```

### Phase 4: Authentication (ECDSA P-256)

```
→ 01 86    ← 03 86 XXXXXXXX         Read 8-byte nonce
→ 02 87 [8B nonce][020201][64B sig]  Write signed response
           ← 03 87 01               Success (01 = verified)
```

See the Authentication section below.

### Phase 5: Polling Loop (every ~500ms)

```
→ 01 93    ← 03 93 A1               Connection state
→ 02 90 EA 00                       Keepalive (no response)
→ 01 20    ← 03 20 XX               Battery level
```

## Volume Control

Volume is controlled via register `0x81`. The pattern is: check ready, write, verify.

```
→ 01 85    ← 03 85 00               Check upgrade state (0 = ready)
→ 02 81 0A                          Set volume to Low (10)
→ 01 81    ← 03 81 0A               Verify new value
```

| Level | Value | Hex |
| --- | --- | --- |
| Low | 10 | `0x0A` |
| Medium | 40 | `0x28` |
| High | 100 | `0x64` |

## Authentication

**ECDSA P-256** challenge-response. Private key is server-side — the app proxies signing via `/commands/sign` on `p11.bilbo.lego.com`. See [BACKEND.md](BACKEND.md).

### Protocol

1. Read register `0x86` → 8-byte nonce (unique per connection)
2. Compute message: `SHA256(nonce[8] || 0x020201)`
3. Sign message with ECDSA P-256 private key → 64-byte signature (r ∥ s, 32 bytes each, big-endian)
4. Write register `0x87`:

```
Bytes 0–7:   Nonce echo (from register 0x86)
Bytes 8–10:  Command suffix: 02 02 01
Bytes 11–42: ECDSA r value (32 bytes, big-endian)
Bytes 43–74: ECDSA s value (32 bytes, big-endian)
```

5. Response `03 87 01` = success, `03 87 00` = failure

### Recovered Public Key

From ECDSA public key recovery across 6 captured signatures:

```
X: 7002e81f364ee278e005f9dcbf8e4805137c6013b7cda4aab1d9c1fa3f39cd9b
Y: 2706d1bd9c81af2ab6d7ced72a4804235d1c865250fd722f8480a505388b6097
```

This key is also present in the firmware images within the crypto verification section.

### What Requires Authentication

| Operation | Signed Command Type |
| --- | --- |
| Unlock | 1 |
| Enable Telemetry Consent | 2 |
| Factory Reset | 3 |
| Start Firmware Upgrade | 4 |

Reading device info, setting volume, setting name, and keepalive polling all work **without** authentication.
