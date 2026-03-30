# LEGO Smart Brick - BLE Reverse Engineering Report

**Date:** 2026-03-02
**Device:** LEGO Smart Brick (Smart Play system)
**Firmware:** 2.29.2
**Tools:** Raspberry Pi 3 (btmon, hcitool, noble), macOS (noble, tshark/Wireshark), Android HCI logging

## 1. Executive Summary

The LEGO Smart Brick advertises via standard BLE when docked on its charging base. It exposes a GATT server with standard services and two custom services. When undocked and in play mode, it does **not** advertise via standard BLE. Firmware analysis (see Section 3) reveals that the brick uses **BLE 5.4 PAwR (Periodic Advertising with Responses)** for brick-to-brick play communication. One brick acts as a coordinator, others synchronize to its periodic advertising train. The chip is a **Maxim/Analog Devices MAX32** series running the **Arm Cordio** BLE stack (originally Wicentric exactLE).

Initial probing of the BLE GATT interface while docked revealed that the brick **accepts writes silently** and **does not respond** with any meaningful data. However, **analysis of the LEGO companion app's Android HCI traffic** (across 3 separate captures with 3 different bricks) revealed the actual protocol: the FEF6 service's Control Point characteristic (`005f0002`) uses a **register-based command/response protocol** with command types `0x01` (read register), `0x02` (write register), and `0x03` (response/notification). The app performs a specific handshake sequence including a **cryptographic challenge-response** (64-byte ECDSA-like signature), then enters a polling loop.

Key decoded registers include:
- **0x20 = Battery level** (0x64=100%, 0x28=40%)
- **0x22 = Firmware version** ("2.29.2" as a padded string)
- **0x80 = Device name** ("Smart Brick")
- **0x81 = Volume** (0x64=high, 0x0A=low)
- **0x84 = Device MAC address** (6 bytes, e.g., `9C:9A:C0:46:68:4A`)
- **0x86/0x87 = Challenge-response** (8-byte nonce + 64-byte signature)

The reason our direct probing failed is that the device requires the **correct handshake sequence** (including cryptographic authentication) before it will respond to commands.

## 2. Discovery & Advertisement

### 2.1 BLE Advertisement (Docked)
When on the charging base, the brick advertises as a connectable device:

| Field | Value |
|---|---|
| Name | `Smart Brick` |
| Address Type | LE Random (rotates frequently) |
| Connectable | Yes |
| AD Flags | `0x06` (General Discoverable, BR/EDR Not Supported) |
| Service UUIDs | `0xFEF6` (Wiced Smart / Cypress) |
| Manufacturer Data | `97 03 00 60 00 00 00 00` |

**Manufacturer Data Breakdown:**
- `9703` = `0x0397` little-endian = **LEGO System A/S** (Bluetooth SIG Company ID)
- `00 60 00 00 00 00` = device-specific payload (purpose unknown)

### 2.2 Address Rotation
The brick uses BLE Random addresses that rotate frequently. Across multiple scans, the same physical brick appeared as different addresses:
- `4F:84:A9:84:6D:08`
- `48:C4:A7:87:5A:9F`
- `43:73:63:60:F4:F8`
- `72:80:DE:36:69:D8`

This makes tracking by address unreliable. The device name "Smart Brick" is the only consistent identifier.

### 2.3 BLE Advertisement (Undocked / Playing)
When undocked and in active play mode, the brick **does not advertise via standard BLE**. It is invisible to standard BLE scanners. However, firmware analysis reveals it uses BLE 5.4 PAwR (see Section 3).

## 3. Play Communication — BLE 5.4 PAwR (Periodic Advertising with Responses)

### 3.1 Discovery Method
Firmware binaries were extracted from the LEGO SmartAssist APK's Unity asset bundles. 12 firmware versions were found (v0.46.0 through v0.72.3, spanning firmware code versions v1.119.0 through v2.29.1). The cleartext metadata section of each firmware image contains source file references and error state strings that reveal the communication mechanism.

### 3.2 Chip Identification
- **Chip:** Maxim/Analog Devices MAX32 series (likely MAX32655 or MAX32665)
- **BLE Stack:** Arm Cordio (originally Wicentric "exactLE")
  - The "exactLE" name appears encoded in the WDX UUID base: `005fXXXX-2ff2-4ed5-b045-4C7463617865` where `4C7463617865` = "LtcaxE" (reverse of "ExactL")
- **BLE Stack source files found:** `bsal_main.c`, `bsal_wdxc.c`, `bsal_batjamc.c`, `bsal_ead.c`, `wsf_msg.c`, `wsf_buf.c`, `wsf_queue.c`, `ll_main.c`, `ll_init.c`, `lctr_main.c`, `dm_*.c`, `att_main.c`, `smp_main.c`, `hci_core.c`, `app_main.c`, `sch_main.c`, and many more
- **Product identifier:** `P11_audiobrick`
- **Build string example:** `P11_audiobrick_EM-v2.29.0-gfc9910378` (git hash: fc9910378)
- **Build date:** 2025-06-01

### 3.3 BLE 5.4 PAwR Evidence
The firmware contains extensive PAwR (Periodic Advertising with Responses) code, a BLE 5.4 feature designed for coordinated multi-device communication:

**PAwR source files in firmware:**
- `bb_ble_adv_central_pawr.c` — Baseband PAwR central (coordinator) advertising
- `bb_ble_adv_peripheral_pawr.c` — Baseband PAwR peripheral advertising
- `lctr_init_central_pawr.c` — Link controller PAwR central initialization
- `lctr_init_peripheral_pawr.c` — Link controller PAwR peripheral initialization
- `lctr_act_conn_central_pawr.c` — PAwR central connection actions
- `lctr_isr_adv_central_pawr.c` — PAwR central ISR handlers
- `lctr_isr_adv_peripheral_pawr.c` — PAwR peripheral ISR handlers
- `ll_init_adv_central_pawr.c` — Link layer PAwR central init
- `ll_init_adv_peripheral_pawr.c` — Link layer PAwR peripheral init
- `bsal_ead.c` — Encrypted Advertising Data (BLE 5.4 companion feature to PAwR)

**PAwR network state strings found:**
| String | Meaning |
|---|---|
| `SYNC_LOST` | Lost synchronization with the PAwR periodic advertising train |
| `JOIN_FAILED` | Failed to join the PAwR play session |
| `AUTH_FAILED` | Authentication failure during session join |
| `REMOVED_BY_COORD` | Removed from session by the coordinator brick |
| `SEEN_BETTER_NETWORK` | Found a better PAwR train/play session |
| `BAD_SESSION_KEY` | Encrypted session key error |
| `STOPPED` | PAwR session stopped |
| `SUSPENDED` | PAwR session suspended |

### 3.4 How PAwR Works for Brick-to-Brick Play
BLE 5.4 PAwR enables efficient, low-latency communication between multiple devices:

1. **One brick acts as coordinator** — sends periodic advertising trains with play state data
2. **Other bricks synchronize** to the coordinator's periodic advertising train
3. **Coordinator broadcasts** play state, game events, and synchronization data to all bricks
4. **Bricks respond** during designated response slots in the periodic advertising train
5. **Sessions are encrypted** (BAD_SESSION_KEY, AUTH_FAILED states confirm this)
6. **No phone/app needed** — bricks communicate directly without the smartphone
7. **Coordinator can manage membership** (REMOVED_BY_COORD, SEEN_BETTER_NETWORK)

This explains why:
- Bricks are invisible to standard BLE scanners during play (PAwR uses periodic advertising, not connectable advertising)
- The LEGO app has no mesh/PAwR code (it's handled entirely on-device)
- The app only manages configuration via the WDX/FEF6 service; play is autonomous

### 3.5 Additional Firmware Features
- `semantic_tree.c` — Play scripts are parsed as semantic trees on-device
- `interpolate.c` — Smooth animation/audio interpolation
- `"Memory Allocation failed while stream mic samples"` — The brick has a **microphone** for audio input
- `charging_ui.c` — Charging state UI management
- Version string `"1.15.4"` appears near PAwR code (possibly Cordio stack version)
- 3 content files in ROFS filesystem: `play.bin`, `audio.bin`, `animation.bin`

### 3.6 Previous Bluetooth Mesh Speculation
Raw HCI captures via `btmon` on Raspberry Pi picked up Bluetooth Mesh Secure Network Beacons (AD type `0x2B`) during play sessions, but these were from **unrelated devices** in the environment, not from Smart Bricks. The LEGO ConnectKit SDK contains zero Bluetooth Mesh references. The Smart Brick uses BLE 5.4 PAwR, not traditional BLE Mesh.

## 4. GATT Service Table

### 4.1 Service: Generic Access (`0x1800`)

| Characteristic | UUID | Properties | Value |
|---|---|---|---|
| Device Name | `0x2A00` | Read | `"Smart Brick"` |
| Appearance | `0x2A01` | Read | `0x0000` (Unknown) |
| Central Addr Resolution | `0x2AA6` | Read | `0x00` (Not supported) |

### 4.2 Service: Generic Attribute (`0x1801`)

| Characteristic | UUID | Properties | Handle | Value |
|---|---|---|---|---|
| Service Changed | `0x2A05` | Indicate | `0x0012` (CCCD: `0x0013`) | Not readable |
| Client Supported Features | `0x2B29` | Read, Write | | `0x05` initial |
| Database Hash | `0x2B2A` | Read | `0x0017` | `fa2e39ff80c2e753e671afccd9e2be83` (stable) |
| Server Supported Features | `0x2B3A` | Read | | `0x00` |

### 4.3 Service: Device Information (`0x180A`)

| Characteristic | UUID | Properties | Value |
|---|---|---|---|
| Manufacturer Name | `0x2A29` | Read | `"LEGO"` |
| Model Number | `0x2A24` | Read | `"Smart Brick"` |
| Firmware Revision | `0x2A26` | Read | `"2.29.2"` |
| Software Revision | `0x2A28` | Read | `"2.29.2"` |

### 4.4 Service: LEGO Custom (`005f0001-3ff2-4ed5-b045-4c7463617865`)

| Characteristic | UUID | Properties | Handle (CCCD) | Notes |
|---|---|---|---|---|
| Command Input | `005f0009-3ff2-...` | WriteWithoutResponse, Write | None | Purpose unknown; accepts writes silently |
| Bidirectional Channel | `005f000a-3ff2-...` | Read, Write, Notify | `0x00c5` | Sends empty notifications periodically |

### 4.5 Service: Wiced Smart / FEF6 (`0xFEF6`) - **PRIMARY PROTOCOL SERVICE**

UUID base for all chars: `005f000X-2ff2-4ed5-b045-4c7463617865`

| Characteristic | UUID Suffix | Properties | Handle (CCCD) | Role |
|---|---|---|---|---|
| **Control Point** | `005f0002-2ff2-...` | Write, Notify | `0x0242` (`0x0243`) | **Main command/response channel** |
| Data Channel 1 | `005f0003-2ff2-...` | WriteWithoutResponse, Notify | `0x0245` (`0x0246`) | Bulk data transfer |
| Data Channel 2 | `005f0004-2ff2-...` | WriteWithoutResponse, Notify | `0x0248` (`0x0249`) | Bulk data (notification only in practice) |
| Data Channel 3 | `005f0005-2ff2-...` | Write, Notify | `0x024b` (`0x024c`) | Unused in captured session |

## 5. Protocol Analysis (from Android HCI Capture)

### 5.1 Overview

The LEGO companion app communicates with the Smart Brick using a **register-based protocol** on the FEF6 Control Point characteristic (`0x0242`). The protocol uses three message types:

| Type Byte | Direction | Format | Description |
|---|---|---|---|
| `0x01` | App → Brick | `01 RR` | Read register RR |
| `0x02` | App → Brick | `02 RR VV [VV...]` | Write value(s) to register RR |
| `0x03` | Brick → App | `03 RR VV [VV...]` | Response: register RR contains value VV |

**Key insight:** Type `0x03` responses mirror the register byte from the corresponding `0x01` or `0x02` command. The response `03 RR VV` means "register RR has value VV".

The special notification `03 02 00` is sent **unprompted** by the brick as an idle/ready beacon before any commands are sent. With a larger MTU, the full beacon is `03 02 00 0C 00 00 00 F4 01`.

### 5.2 Connection Lifecycle

The captured session shows 2 complete connection cycles. Each cycle follows the same phases:

#### Phase 1: CCCD Subscription
The app enables notifications on all relevant characteristics in order:

```
1. Write 0x00c5 ← CCCD for custom service bidirectional channel
2. Write 0x0243 ← CCCD for FEF6 Control Point (fails first time, retried ~5s later)
3. Write 0x0246 ← CCCD for Data Channel 1
4. Write 0x0249 ← CCCD for Data Channel 2
5. Write 0x024c ← CCCD for Data Channel 3
6. Write 0x0013 ← CCCD for Service Changed indication
```

**Note:** The first CCCD write to `0x0243` fails (possibly because the first connection attempt times out). The app reconnects ~5 seconds later and succeeds with the full subscription sequence.

#### Phase 2: Handshake (Register Read x3)
The app reads 4 registers in sequence, and repeats the entire sequence **3 times**:

```
→ 01 22    ← 03 22 "2.29.2\0..."   Firmware version (16 bytes, padded)
→ 01 81    ← 03 81 64               Volume level (0x64 = 100 = HIGH)
→ 01 84    ← 03 84 9C9AC046684A    Device MAC address (6 bytes)
→ 01 80    ← 03 80 "Smart Brick"   Device name (ASCII string)
(repeated 3 times total)
```

With a larger BLE MTU, the full response payloads are visible:
- **Register 0x22**: `03 22 32 2E 32 39 2E 32 00...` = "2.29.2" (16-byte null-padded string). The initial capture with a small MTU only showed the first byte `0x32` = ASCII "2".
- **Register 0x81**: `03 81 64` = Volume level, 0x64 (100) = HIGH
- **Register 0x84**: `03 84 9C 9A C0 46 68 4A` = Device MAC address. Three bricks observed:
  - Brick A: `9C:9A:C0:46:68:4A`
  - Brick B: `9C:9A:C0:46:66:85`
  - Brick C: `9C:9A:C0:40:9E:A3`
- **Register 0x80**: `03 80 53 6D 61 72 74 20 42 72 69 63 6B` = "Smart Brick". The first byte `0x53` = ASCII "S".

#### Phase 3: Setup Commands
After the handshake, several one-time commands configure the brick:

```
→ 01 88    ← 03 88 D4...       Read register 0x88 (21 bytes, crypto-related)
→ 02 90 EA 00                   Write to register 0x90 (no immediate response)
→ 01 86    ← 03 86 XXXXXXXX   Read register 0x86 (8-byte NONCE, changes each connection)
→ 01 84    ← 03 84 XXXX...    Re-read register 0x84 (device MAC)
→ 02 91 01                     Write 0x01 to register 0x91
  ← 03 91 01                   (delayed response ~400ms later)
```

Then the **cryptographic challenge-response**:
```
→ 02 87 [8-byte nonce from 0x86] [02 02 01] [64-byte signature]
  ← 03 87 01                   (delayed ~400ms: 0x01 = authentication success)
```

The register 0x87 write is **77 bytes** total, structured as:
- `02 87` — write command (2 bytes)
- 8-byte **nonce echo** from register 0x86
- `02 02 01` — protocol header (possibly version 2.2.1)
- 64-byte **cryptographic signature** (likely ECDSA P-256: two 32-byte integers r, s)

Six unique 0x87 writes were captured across all sessions, each with a different nonce and signature but identical structure. The `03 87 01` response always indicates success.

Final setup:
```
→ 01 08    ← 03 08 F4 00      Read register 0x08 (0x00F4 = 244)
```

**Note:** One brick returned `03 08 14 00` (0x0014 = 20) for register 0x08, suggesting this value varies per device.

#### Phase 4: Data Channel Initialization
After control channel setup, the data channels are initialized:

```
→ Write 0x0245: 01 00 00 00 00 00 00 00 08 00 00 01
  ← Notify 0x0245: 02 00 00 00 00 30 00
  ← Notify 0x0248: 00 01 03 [filesystem directory - see below]
  ← Notify 0x0245: 0A 00 00
```

Then repeated for each filesystem entry, followed by:
```
→ Write 0x0245: 01 03 00 00 00 00 00 00 08 00 00 01
  ← Notify 0x0245: 02 03 00 00 00 30 00
  ← Notify 0x0248: 00 "TELM" [telemetry data]
  ← Notify 0x0248: [continuation data]
  ← Notify 0x0245: 0A 03 00
→ Write 0x0245: 05 03 00
  ← Notify 0x0245: 06 03 00 00     (ack)
```

**Filesystem Directory (from Data Channel 2):**
The brick exposes a filesystem with 3 entries:

| Index | Name | Version | Size (bytes) |
|---|---|---|---|
| 1 | `Firmware` | 1.0 | 1,048,572 (0x0FFFFC) |
| 2 | `FaultLog` | 1.0 | 5 |
| 3 | `Telemetry` | 1.0 | 402-411 (varies per brick) |

The telemetry data begins with `00 "TELM" 02` followed by the brick's MAC address (reversed) and encrypted/compressed data.

The data channel protocol uses its own command/response types (01→02 ack, 05→06 ack, 0A=end-of-transfer).

#### Phase 5: Polling Loop (~1 second interval)
The app enters a continuous polling loop with 3 commands per cycle:

```
→ 01 93        ← 03 93 A1     Read register 0x93 (always 0xA1 = 161)
→ 02 90 EA                     Write keepalive to register 0x90
→ 01 20        ← 03 20 64     Read register 0x20 (always 0x64 = 100)
```

The polling runs in pairs, with two full cycles per ~1 second interval:
- **0x93 = 0xA1 (161):** Status/state register. Changes to `0x01` when brick disconnects/reconnects.
- **0x90 = 0xEA:** Keepalive write (sent every poll cycle)
- **0x20 = Battery level:** Confirmed across multiple bricks:
  - `0x64` (100) = Full battery (observed on 2 bricks)
  - `0x28` (40) = Low battery (observed on 1 brick)

#### Phase 6: Volume Control
Register 0x81 controls the brick's **speaker volume**. The volume change pattern captured from a session with 4 changes (HIGH→LOW→HIGH→LOW→HIGH):

```
→ 01 85    ← 03 85 00         Check ready (register 0x85 = 0, always 0)
→ 02 81 0A                     SET VOLUME LOW (0x0A = 10)
→ 01 81    ← 03 81 0A         Verify: volume is now LOW

→ 01 85    ← 03 85 00         Check ready
→ 02 81 64                     SET VOLUME HIGH (0x64 = 100)
→ 01 81    ← 03 81 64         Verify: volume is now HIGH

→ 01 85    ← 03 85 00         Check ready
→ 02 81 0A                     SET VOLUME LOW
→ 01 81    ← 03 81 0A         Verify: LOW

→ 02 81 64                     SET VOLUME HIGH
→ 01 81    ← 03 81 64         Verify: HIGH
```

**Volume levels:**
- `0x64` (100) = **High** (default)
- `0x0A` (10) = **Low**

The pattern is: read 0x85 (check ready) → write 0x81 (set volume) → read 0x81 (verify). Register 0x85 always returns 0x00 and may be a "busy" flag.

### 5.3 Register Map

| Register | Access | Type | Value(s) | Description |
|---|---|---|---|---|
| `0x02` | — | Status | `00 0C 00 00 00 F4 01` | **Idle beacon** (sent unprompted before handshake) |
| `0x08` | Read | uint16 | `F4 00` (244), `14 00` (20) | Device-specific, varies per brick |
| `0x20` | Read | uint8 | `64` (100), `28` (40) | **Battery level %** (confirmed: 100% vs 40%) |
| `0x22` | Read | string | `"2.29.2\0..."` (16 bytes) | **Firmware version** |
| `0x80` | Read | string | `"Smart Brick"` | **Device name** |
| `0x81` | R/W | uint8 | `64` (100), `0A` (10) | **Volume level**: 0x64=HIGH, 0x0A=LOW |
| `0x84` | Read | 6 bytes | e.g., `9C9AC046684A` | **Device MAC address** |
| `0x85` | Read | uint8 | `00` | Ready/busy flag (always 0, checked before volume writes) |
| `0x86` | Read | 8 bytes | Variable per connection | **Authentication nonce** (challenge) |
| `0x87` | Write | 75 bytes | nonce + `020201` + 64B sig | **Authentication response** (see Section 5.7) |
| `0x88` | Read | 21 bytes | `D4 3F 4B CA 4C D6...` | Crypto-related (stable per brick, possibly a public key fragment) |
| `0x90` | Write | uint8+00 | `EA 00` | **Keepalive** (written every poll cycle) |
| `0x91` | Write | uint8 | `01` | Setup command; delayed `03 91 01` response |
| `0x93` | Read | uint8 | `A1` (active), `01` (transitional) | **Connection state** (0xA1=normal, 0x01=reconnecting) |

### 5.4 Type 0x02 Command Analysis

Type `0x02` commands (register writes) have three behavior patterns:

**Immediate (no response):**
- `02 90 EA 00` — Keepalive, sent every poll cycle

**Confirmed writes (response echoes value):**
- `02 81 0A` → `03 81 0A` — Set volume to LOW, response confirms
- `02 81 64` → `03 81 64` — Set volume to HIGH, response confirms

**Authentication write (response = success code):**
- `02 87 [nonce][header][signature]` → `03 87 01` — 0x01 = auth success

### 5.5 Authentication Protocol (Register 0x86/0x87)

The handshake includes an **ECDSA-like cryptographic challenge-response**:

1. App reads register `0x86` → brick returns **8-byte nonce** (unique per connection)
2. App computes a **64-byte signature** over the nonce (possibly using a shared secret or device-specific key)
3. App writes to register `0x87`: `[8-byte nonce echo] [02 02 01] [64-byte signature]`
4. Brick verifies and responds `03 87 01` (success)

**Observed nonce/signature pairs (6 unique across 3 bricks):**

| Brick MAC | Nonce (0x86) | Header | Sig (first 8 bytes) |
|---|---|---|---|
| `...46684A` | `551fad8ea0992d48` | `020201` | `6700ac2db35c85a8...` |
| `...466685` | `175bbc38a67a5128` | `020201` | `5b4b59d94c66b4a6...` |
| `...466685` | `93a8021a0fd61c66` | `020201` | `2fd381d364664d30...` |
| `...409EA3` | `0595cf555cc85900` | `020201` | (not captured)* |
| `...466685` | `b0f143ae5e663ee4` | `020201` | `44fd6b928f73196a...` |
| `...466685` | `c8397678253cb6ee` | `020201` | `492942a3aaf3c71a...` |
| `...409EA3` | `04330bff43767799` | `020201` | `3002032c7ae55cc3...` |

The 64-byte signature is consistent with **ECDSA P-256** (two 32-byte integers r, s). The `02 02 01` header may indicate protocol version or signature algorithm.

**This is the main barrier to third-party implementations** — without the signing key, the authentication cannot be replicated.

### 5.6 Data Channel Protocol

The data channels (`0x0245`, `0x0248`) use a separate protocol from the control point:

| Command | Response | Channel | Notes |
|---|---|---|---|
| `01 00 00` | `02 00 00` | Ch1→Ch1 | Init/ack |
| | `00 01 03` | →Ch2 | Cross-channel response |
| | `0A 00 00` | →Ch1 | Additional data |
| `05 03 00` | `06 03 00` | Ch1→Ch1 | Secondary init |

The data channel appears to be for **bulk data transfer** (firmware updates or large configuration payloads), not used during normal operation after initial setup.

### 5.7 Connection Timing

```
T+0.0s    Connect, GATT discovery
T+0.5s    Brick sends 03 02 00 idle beacon (x3 over first second)
T+1.2s    First CCCD subscription attempt (0x00c5 + 0x0243, 0x0243 fails)
T+6.4s    Reconnect, full CCCD subscription succeeds
T+6.8s    Handshake (4 registers x 3 rounds = ~0.8s)
T+9.3s    Setup commands (0x88, 0x90, 0x86, 0x84, 0x91 = ~2.5s)
T+10.8s   Type 0x02 commands (0x87, 0x08 = ~0.5s)
T+11.5s   Data channel init
T+11.8s   Polling loop begins
T+13.1s   Disconnect (after ~1.3s of polling)
T+13.5s   Reconnect, full sequence repeats
...
T+54.0s   Last poll, then disconnection at T+56.2s
```

Total session: ~56 seconds, 501 ATT protocol exchanges, 2 full connection cycles.

## 6. Blind Probing Results

### 6.1 Custom Service (`005f0001`)

**Characteristic `005f0009` (Write-only):**
- Accepts ALL data without error: single bytes (0x00-0xFF), multi-byte patterns, 20-byte payloads, ASCII strings, JSON, LEGO manufacturer data, sequential bytes, all-zeros, all-ones
- **Never generates any notification on any channel**
- No observable side effects

**Characteristic `005f000a` (Read/Write/Notify):**
- Read always returns **empty data** (zero bytes)
- Write **always times out** (5 second timeout) - the device does not acknowledge writes to this characteristic
- Sends **empty notifications** (zero bytes) periodically (~1-2 minutes apart), unprompted
- 3 empty notifications received during the ~4 minute probing session

### 6.2 FEF6 Service (Without Correct Protocol)

All four characteristics (`005f0002` through `005f0005`):
- Accept all write patterns without error
- **Never send any notifications** despite being subscribed
- Tested: single bytes, multi-byte, LEGO company ID, DFU/OTA command patterns
- No observable response to any input

**Why this failed:** Our blind probing did not follow the correct CCCD subscription sequence or handshake protocol. The brick requires the specific connection setup (Phase 1-2) before it will respond to register commands.

## 7. UUID Analysis

### 7.1 Custom UUID Bases
Two distinct UUID bases are used:

| Base | Service |
|---|---|
| `005f000X-3ff2-4ed5-b045-4c7463617865` | Custom LEGO service |
| `005f000X-2ff2-4ed5-b045-4c7463617865` | FEF6 / OTA service |

The trailing bytes `4c7463617865` decode to ASCII `"Ltcaxe"` — this is **"ExactL"** reversed. The UUID base comes from the **Wicentric exactLE** BLE protocol stack, now known as **Arm Cordio** (ARM acquired Wicentric in 2015). The Packetcraft open-source release of Cordio defines this exact UUID base in `wdx_defs.h`.

### 7.2 FEF6 Service
`0xFEF6` is the **WDX (Wireless Data Exchange)** service UUID, defined by the Arm Cordio / Packetcraft BLE stack. Originally registered to Wiced Smart, it is used by devices running the Cordio BLE stack on Maxim/Analog Devices MAX32 chips. The WDX protocol provides device configuration (register read/write), file transfer (firmware OTA, asset upload), and authentication.

## 8. Conclusions

### 8.1 The BLE Protocol is Substantially Decoded
The FEF6 service Control Point (`005f0002`) uses a register-based protocol:
- **Read:** `01 RR` → `03 RR VV [VV...]`
- **Write:** `02 RR VV [VV...]` → `03 RR VV` (confirmation) or `03 RR 01` (success)
- **Idle beacon:** `03 02 00 0C 00 00 00 F4 01` (sent unprompted)

Register responses carry variable-length payloads (strings, MACs, crypto data). The initial capture with a small MTU truncated these, making single-byte values appear where there were actually multi-byte fields.

**Decoded registers:**
- Battery level (0x20), firmware version (0x22), device name (0x80), volume (0x81), MAC address (0x84)
- Volume can be set to HIGH (0x64=100) or LOW (0x0A=10) via register 0x81
- The brick exposes a filesystem with Firmware, FaultLog, and Telemetry entries via the data channels

### 8.2 Authentication is the Main Barrier
The handshake requires a **64-byte cryptographic signature** (likely ECDSA P-256) over an 8-byte nonce from the brick. Without the app's signing key, third-party implementations cannot complete the authentication step. The key is likely embedded in the LEGO companion app binary.

### 8.3 Device Identification via MAC Address
Despite BLE address rotation, each brick has a **stable MAC address** stored in register 0x84 (e.g., `9C:9A:C0:46:68:4A`). The app reads this during handshake to identify returning devices. The OUI prefix `9C:9A:C0` appears to be LEGO-specific.

### 8.4 The BLE Interface is a Provisioning Interface
The BLE GATT server on the docked Smart Brick is primarily a **maintenance/provisioning interface**. It provides battery monitoring, volume control, firmware info, name setting, and telemetry. Brick-to-brick play communication uses **BLE 5.4 PAwR** (see Section 3).

### 8.5 Play Communication Uses BLE 5.4 PAwR
Firmware analysis (Section 3) confirmed that the Smart Brick uses **BLE 5.4 PAwR (Periodic Advertising with Responses)** for brick-to-brick play. One brick acts as a coordinator, broadcasting periodic advertising trains that other bricks synchronize to. The sessions are encrypted and authenticated. The chip is a Maxim/Analog Devices MAX32 running the Arm Cordio BLE stack with full PAwR support. Play content is stored as `play.bin`, `audio.bin`, and `animation.bin` in an on-device ROFS filesystem, with play scripts executed as semantic trees.

### 8.6 Next Steps
1. **Extract the signing key** - Decompile/reverse-engineer the LEGO companion app (Android APK) to extract the ECDSA private key used for register 0x87 authentication
2. **Try connecting without auth** - Test whether the brick responds to register reads (0x01 commands) without completing the 0x87 authentication step. The handshake registers may work before auth.
3. **Probe all registers** - Once authenticated, systematically read registers 0x00-0xFF to map the full register space
4. **Explore the filesystem** - Read the Firmware, FaultLog, and Telemetry entries via the data channel protocol
5. **Monitor register changes** - Poll registers while physically interacting with the brick to correlate values with state
6. **Capture firmware update** - Trigger an OTA update to understand the data channel write protocol
7. **Capture PAwR traffic** - Use an nRF52840 dongle with raw BLE 5.4 packet capture to intercept PAwR periodic advertising trains between bricks during play. Identify the data format, coordinator election, and synchronization mechanism.
8. **Decode firmware code section** - The main firmware code in the ~P11 container is compressed (499KB → 3.17MB). Identify the compression algorithm to enable Ghidra analysis and full reverse engineering.
9. **Analyze play content format** - Decode the `play.bin`, `audio.bin`, and `animation.bin` content files stored in the ROFS filesystem

## 9. Files

| File | Description |
|---|---|
| `scan.js` | BLE advertisement scanner |
| `diff.js` | Scan result comparator |
| `explore.js` | GATT service/characteristic enumerator |
| `before.json` | Baseline scan (device off) |
| `after.json` | Scan with device on |
| `brick_explore.json` | Full GATT table dump |
| `brick_probe.json` | Comprehensive probing results (306 entries) |
| `capture_play.btsnoop` | btmon capture (short session) |
| `capture_play2.btsnoop` | btmon capture (play session, 1.1MB) |
| `android_hci.btsnoop` | Android HCI log - initial session (2 bricks, full battery) |
| `android_hci_prev.btsnoop` | Android HCI log (duplicate of above) |
| `bugreport_battery` | Android HCI log - 3 bricks, multiple reconnections |
| `bugreport_volume` | Android HCI log - volume changes (HIGH↔LOW) + low battery brick (40%) |

## Appendix A: Full Handshake Sequence

This is the exact byte sequence the LEGO app sends to establish communication, extracted from the Android HCI capture. Handle values in parentheses.

```
# Phase 1: Enable notifications (write 0x0100 to each CCCD)
WRITE  (0x00c5)  01 00           # Enable notifications on custom service
WRITE  (0x0243)  01 00           # Enable notifications on FEF6 Control Point
WRITE  (0x0246)  01 00           # Enable notifications on Data Channel 1
WRITE  (0x0249)  01 00           # Enable notifications on Data Channel 2
WRITE  (0x024c)  01 00           # Enable notifications on Data Channel 3
WRITE  (0x0013)  01 00           # Enable indications on Service Changed

# Phase 2: Handshake - read 4 registers, repeat 3 times
WRITE  (0x0242)  01 22           # → 03 22 "2.29.2\0..." (firmware version, 16 bytes)
WRITE  (0x0242)  01 81           # → 03 81 64 (volume = HIGH)
WRITE  (0x0242)  01 84           # → 03 84 XX XX XX XX XX XX (device MAC, 6 bytes)
WRITE  (0x0242)  01 80           # → 03 80 "Smart Brick" (device name)
# (repeat above 4 commands 2 more times)

# Phase 3: Setup
WRITE  (0x0242)  02 90 EA 00    # Keepalive (no response)
WRITE  (0x0242)  01 08           # → 03 08 F4 00 (device-specific)

# Phase 4: Data channel init (filesystem read)
WRITE  (0x0245)  01 00 00 00 00 00 00 00 08 00 00 01
                                  # → (0x0245): 02 00 00 00 00 30 00
                                  # → (0x0248): 00 01 03 [filesystem directory]
                                  # → (0x0245): 0A 00 00
WRITE  (0x0245)  01 00 00 00 00 00 00 00 08 00 00 01   # (repeat)
WRITE  (0x0245)  01 03 00 00 00 00 00 00 08 00 00 01   # Read telemetry
                                  # → (0x0245): 02 03 00 00 00 30 00
                                  # → (0x0248): 00 "TELM" [telemetry data]
                                  # → (0x0245): 0A 03 00
WRITE  (0x0245)  05 03 00        # → (0x0245): 06 03 00 00

# Phase 5: Setup continued
WRITE  (0x0242)  01 86           # → 03 86 XX XX XX XX XX XX XX XX (8-byte nonce)
WRITE  (0x0242)  01 84           # → 03 84 XX XX XX XX XX XX (device MAC)
WRITE  (0x0242)  02 90 EA 00    # Keepalive

# Phase 6: Authentication
WRITE  (0x0242)  02 87 [8B nonce] 02 02 01 [64B signature]
                                  # → 03 87 01 (success!)
WRITE  (0x0242)  01 88           # → 03 88 [21 bytes, crypto-related]

# Phase 7: Polling loop (repeat every ~0.5s)
WRITE  (0x0242)  01 93           # → 03 93 A1 (connection state)
WRITE  (0x0242)  02 90 EA 00    # Keepalive (no response)
WRITE  (0x0242)  01 20           # → 03 20 XX (battery level: 64=100%, 28=40%)

# Volume control (when user changes volume)
WRITE  (0x0242)  01 85           # → 03 85 00 (check ready)
WRITE  (0x0242)  02 81 0A       # Set volume LOW (or 02 81 64 for HIGH)
WRITE  (0x0242)  01 81           # → 03 81 0A (verify new volume)
```
