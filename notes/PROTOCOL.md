# LEGO Smart Play — BLE Protocol

> **Note:** This was reverse engineered from Android HCI (btsnoop) captures and decompilation of the SmartAssist APK (Il2CppDumper). Some protocol details may be incomplete or wrong — not everything is visible in captured traffic, and some payloads are encrypted.

## Overview

The brick exposes a GATT server when docked on its charging base. The primary interface is a register-based command/response protocol over the WDX (Wireless Data Exchange) service (`0xFEF6`).

When undocked and in play mode, the brick does not advertise via standard BLE. See [HARDWARE.md](HARDWARE.md) for details on play communication.

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

The first two bytes of manufacturer data are the LEGO company identifier `0x0397` (little-endian). The remaining bytes are device-specific payload.

The brick uses BLE random addresses that rotate frequently. The same physical brick will appear as different addresses across scans. The stable identifier is the MAC address stored in register `0x84`, readable after connecting.

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

All communication with the brick happens through the **Control Point** characteristic using a register-based protocol. Messages have three types:

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

The brick uses **ECDSA P-256** challenge-response authentication. The private key is held on LEGO's backend servers — the companion app proxies signing requests via `api/v1/commands/sign` on `p11.bilbo.lego.com`. See [BACKEND.md](BACKEND.md) for details on the backend API.

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
