# LEGO Smart Play — Firmware

> Sourced from binary analysis of firmware images extracted from the Bilbo backend, and disassembly of v0.72.1 code segment using the ARC GNU toolchain. May contain errors.

## Container Format

Firmware images use a custom `~P11` container with a 104-byte WDX header:

```
Bytes 0–3:     Magic: ~P11 (0x7E503131)
Bytes 4–7:     Version (1)
Bytes 8–11:    Flags
Bytes 12–15:   Total file length
Bytes 16–63:   ECDSA signature (48 bytes)
Bytes 64–67:   Padding
Bytes 68–71:   Padding
Bytes 72–75:   Padding
Bytes 76–79:   Padding
Bytes 80–83:   Product (0=AudioBrick, 1=PanelCharger)
Bytes 84–87:   Hardware version
Bytes 88–91:   Upgrade version
Bytes 92–95:   Segment table offset
Bytes 96–99:   Segment table count
```

## Segments

Two segments, described by 32-byte entries at the segment table offset:

### Segment 0 — Code

Raw ARC EM (ARCv2) machine code for the EM9305. **Not compressed** — runs directly from flash.

| Field | Value (v0.72.1) |
| --- | --- |
| File offset | `0xB8` (after 64-byte sub-header) |
| Actual code start | `0xF8` (sub-header contains hash + HW version + padding) |
| Size | 499,296 bytes (~488 KB) |
| Flash address range | `0x00000000`–`0x00306000` |

The sub-header at `0xB8` contains `\x7fP11` closing marker, a size field, SHA-1 hash, hardware version, and FF padding.

### Segment 1 — ROFS

Zlib-compressed read-only filesystem.

| Field | Value (v0.72.1) |
| --- | --- |
| File offset | `0x79F58` (immediately after code) |
| Compressed size | 94,741 bytes |
| Decompressed size | 165,372 bytes |
| Marker | `ROFS` at segment descriptor |

Contains `play.bin`, `audio.bin`, `animation.bin`.

## Memory Map (EM9305)

| Region | Start | End | Size |
| --- | --- | --- | --- |
| Flash | `0x00000000` | `0x00080000` | 512 KB |
| SRAM | `0x10000000` | `0x10040000` | 256 KB |
| SRAM (cached alias) | `0x80000000`+ | — | Same SRAM, cached view |
| MMIO | `0xF00000`+ | — | Peripheral registers |

Code (499 KB) fits within the 512 KB flash. The firmware addresses SRAM via `0x80xxxx` (cached/aliased), not the raw `0x10xxxxxx` base. MMIO lives at `0xF0xxxx`.

### RAM Layout (0x80xxxx)

| Address | Contents |
| --- | --- |
| `0x801040` | BLE stack workspace |
| `0x801090` | Event handler dispatch table pointer |
| `0x801444` | Boot time counter |
| `0x801CAC` | Play engine state |
| `0x80195A` | BrickNet state machine flags |
| `0x806ADA` | BrickNet peer address / channel ID |
| `0x8068D0` | BLE connection info |
| `0x8083F6` | Crypto / pairing data |
| `0x808424` | BrickNet callback function pointer |
| `0x809074` | Advertising state struct (restart callback, per-set callbacks) |
| `0x80942C` | Hardware charger status byte (5-bit bitmap) |
| `0x809430` | Audio sample rate tables |
| `0x80B5DC` | WDX connection state table |
| `0x80CF11` | PAwR power/signal level |
| `0x80CF23` | PAwR feature flags |
| `0x80D670` | Device name buffer |
| `0x80D78C` | PAwR coordinator state flags |
| `0x80D8EC` | Communication session data |
| `0x80D8FC` | Coordinator launched flag |
| `0x80D8FD` | Play-driven BrickNet flag |
| `0x80DD28` | RTOS ready queue head |
| `0x80DD8C` | Memory pool descriptor |
| `0x80DE10` | PAwR session state block |
| `0x80DF50` | RTOS semaphore / mutex |
| `0x80EA80` | Assert handler state |
| `0x80EB50` | RTOS scheduler current task |
| `0x80ECF0`–`0x80F2D0` | Stack |
| `0x80F470` | Fault record (magic: `0xDEADDD00`) |
| `0x80FB78` | BLE advertising state |
| `0x80FE08` | Boot timing records |

### MMIO Registers (0xF0xxxx)

| Address | Role |
| --- | --- |
| `0xF00428` | GPIO / peripheral control (bit 6 = peripheral enable) |
| `0xF0041E`, `0xF00434`, `0xF0045C` | GPIO pin configuration |
| `0xF00840` | Clock / timer control |
| `0xF008C4`, `0xF008C8` | Interrupt controller config |
| `0xF008D4` | BLE radio interrupt enable / ack |
| `0xF009A8` | Power management control |
| `0xF00A84` | ADC / analog configuration |
| `0xF03838`, `0xF0383C` | System status (polled at boot) |

## Disassembly

Disassembled using `arc-elf32-objdump` from the [ARC GNU toolchain](https://github.com/foss-for-synopsys-dwc-arc-processors/toolchain/releases). The raw binary must be wrapped in an ELF container first — `objdump -b binary` silently fails for ARC, outputting only `.word` data:

```bash
arc-elf32-objcopy -I binary -O elf32-littlearc -B EM \
  --rename-section .data=.text smartbrick_v0.72.1_code.bin fw.elf
arc-elf32-objdump -d -m EM fw.elf > disasm.txt
```

No prebuilt macOS toolchain — run via Docker with `--platform linux/amd64` on Apple Silicon.

Full disassembly: `randomfiles/firmware/smartbrick_v0.72.1_disasm.txt` (178,900 lines, 10 MB).

Ghidra 12.0.4 does **not** have ARC/ARCv2 processor support. Open PRs (#3006, #3233) only cover ARCompact, not ARCv2.

### Code Map

2,859 functions (`enter_s` / `leave_s` pairs). No symbol names — all bare addresses.

| Address Range | Functions | Contents |
| --- | --- | --- |
| `0x00000`–`0x04FFF` | 97 | Reset handler, exception vectors, FPU library |
| `0x05000`–`0x0FFFF` | 293 | Low-level drivers: MMIO, timers, GPIO, clocks |
| `0x10000`–`0x1FFFF` | 434 | BLE stack lower: HCI, L2CAP, SMP, pairing |
| `0x20000`–`0x2FFFF` | 419 | BLE stack upper: ATT, GATT, crypto (AES/ECC), advertising |
| `0x30000`–`0x3FFFF` | 380 | WDX protocol: register dispatch, memory management, assert/fault |
| `0x40000`–`0x4FFFF` | 429 | Application: semantic tree executor, play engine helpers |
| `0x50000`–`0x5FFFF` | 284 | Play / animation engine, audio (includes largest function) |
| `0x60000`–`0x6FFFF` | 491 | App comms: BLE PAwR, WDX write handlers |
| `0x70000`–`0x714FC` | 32 | RTOS scheduler / task management |
| `0x71628`–`0x72FFF` | — | **Data:** source filenames, product strings, version info |
| `0x73000`–`0x76AFA` | — | **Data:** lookup tables, config data |
| `0x77642`–`0x79F40` | — | **Data:** assert filename strings (~220 unique), config |

### Key Functions

**Reset handler** (`0x00000`): Sets stack pointer to `0x80F2D0`, interrupt vector base to `0x306400`. Configures MMIO at `0xF00428`, copies `.data` from flash to SRAM at `0x10B7D4`, sets JLI base at `0x1FF000`. Calls system init, then enters main event loop.

**System init** (`0x07B10`): `kflag 0`, configures `status32`, initializes timer (`count0`), sets up BLE peripheral at `0xF008D4`, calls into BLE stack init and the event loop at `0x29A24`.

**WDX register dispatch** (`0x3FA24`, ~443 lines): The core handler for BLE register read/write — this is what the app (and our Node library) talks to. Takes `connId`, `type` (0=data, 1=readReq, 2=writeReq, 3=response), `payload`, `length`. See [WDX Register Dispatch](#wdx-register-dispatch) below.

**BLE event dispatcher** (`0x2E580`, ~755 lines): Cascading if/else on HCI event IDs (`0x02`, `0x0A`, `0x10`, `0x21`, `0x22`, `0x28`, `0x29`, `0x59`, `0xD1`, `0xD2`...). Handles ATT operations, connection management.

**Play/animation engine** (`0x52588`, ~6,677 lines): Largest function in the firmware. Bytecode interpreter with **144 opcodes**, dispatched via jump table at `0x37C800`. Hardware FPU operations (`fsadd`, `fsmul`, `fsub`, `fscmpf`, `fcvt32`). Zero-overhead loops over 64-element arrays. Processes 16-bit opcode stream from a data pointer.

**Semantic tree executor** (`0x4B830`, ~493 lines): 25-entry switch table via `bi [r0]` at `0x4B85A`, opcodes from table at `0x37BCF4`. Recursive tree walker processing play script nodes from `play.bin`.

**Assert / fault handler** (`0x3B1D4`): Called from **931 assert points** across the firmware. Stores magic `0xDEADDD00` at `0x80F470` with hash, line number, PC, and severity. Sends fault notification over BLE via `0x6BE40`.

**RTOS scheduler** (`0x714FC`): Uses `clri`/`seti` for critical sections. Manages task queues at `0x80EB50`, `0x80DD28`, `0x80DF58`. Semaphore/mutex with atomic decrement patterns.

**WsfBufAlloc** (`0x02770`): Buffer allocator from the Cordio stack. Called 50+ times from the WDX dispatch alone. Takes size in `r0`, returns buffer pointer.

### WDX Register Dispatch

The handler at `0x3FA24` parses the first byte of the payload to determine request type (1=read, 2=write), then dispatches by register number.

#### Read Handlers

Indexed branch table at `0x3FACA`. Each handler allocates a response buffer via `WsfBufAlloc` (`0x02770`), fills `[0x03, register_id, ...data]`, and sends via `0x38BF0`.

| Register | Response Size | Handler | Likely Purpose |
| --- | --- | --- | --- |
| `0x01` | 8 bytes | `0x3FC20` | — |
| `0x02` | varies | `0x3FC92` | — |
| `0x03` | varies | `0x3FC56` | — |
| `0x08` | 4 bytes | `0x3FCA8` | — |
| `0x0A` | half-word | `0x3FCC8` | — |
| `0x20` | 3 bytes | `0x3FB90` | Battery level |
| `0x21` | 20 bytes | `0x3FE70` | — |
| `0x22` | 18 bytes | `0x3FBEA` | — |
| `0x25` | varies | `0x3FC70` | — |
| `0x26` | varies | `0x3FC74` | — |
| `0x80` | 14 bytes | `0x3FB22` | General device info |
| `0x81` | 3 bytes | `0x3FCE0` | Firmware version? |
| `0x82` | 8 bytes | `0x3FCFA` | Timer / counter |
| `0x83` | 4 bytes | `0x3FD40` | Status byte |
| `0x84` | 8 bytes | `0x3FD64` | Timestamp / uptime |
| `0x85` | 3 bytes | `0x3FD9E` | Upgrade state |
| `0x86` | 10 bytes | `0x3FDB8` | Device info block |
| `0x88` | 22 bytes | `0x3FDD8` | Large data block |
| `0x89` | 3 bytes | `0x3FDFA` | Single byte |
| `0x92` | 3 bytes | `0x3FE14` | Single byte |
| `0x93` | 3 bytes | `0x3FE2E` | Single byte |
| `0x94` | 3 bytes | `0x3FE48` | Single byte |

#### Write Handlers

Sequential comparisons, not indexed. Payload length is checked before dispatch.

| Register | Handler | Notes |
| --- | --- | --- |
| `0x80` | `0x3FBBA` via `0x3F97C` | Write general config |
| `0x87` | `0x3FF64` | Auth challenge (ECDSA) |
| `0x91` | `0x3F6D0` | Write param (checked payload length) |
| `0x95` | `0x3FA18` | Write param (checked payload = 0) |
| `0x96` | `0x3F968` | Write param (checked payload = 0) |

#### Secondary Write Handler (`0x6CC8C`)

Handles PAwR / advertising-related registers:

| Register | Purpose |
| --- | --- |
| `0x1B` | PAwR train sync |
| `0x1C` | PAwR data exchange |
| `0x25` | PAwR session management |
| `0x26` | PAwR session management |

Uses session state block at `0x80DE10`.

### BLE Advertising State Machine

Connectable BLE advertising is gated by a one-time boot check. The decision is made in the main init at `0x6326` and is irreversible at runtime.

#### Boot-Time Charger Detection

Five charger detection functions at `0xF09C`–`0xF0FC` each test a different bit of the hardware status byte at `0x80942C`:

| Address | Bit | Return Struct | Charger Variant |
| --- | --- | --- | --- |
| `0xF09C` | 3 | `0x801418` | Variant 3 |
| `0xF0B4` | 0 | `0x801400` | Variant 0 |
| `0xF0CC` | 1 | `0x801408` | Variant 1 |
| `0xF0E4` | 2 | `0x801410` | Variant 2 |
| `0xF0FC` | 4 | `0x801420` | Dock / USB charger |

The status byte is populated by `0xF114`, which uses FNV-1a hashing against hardware ID data to identify the charger type. Called once at boot — no runtime re-check.

#### Advertising Decision (`0x6326`)

```
0x6326: bl   0xF0FC          ; Charger detection (bit 4)
0x632A: breq r0, 0, 0x6350   ; NULL → not docked → skip advertising
0x632C: ldb  r0, [r0, 0]     ; Load charger type byte
0x632E: breq r0, 0x4, 0x6344 ; Type 4 → path A
0x6334: brne r0, 0x2, 0x6350 ; Type ≠ 2 → skip advertising
```

Only charger types `0x02` and `0x04` enable connectable advertising. All other values (including not-docked) skip to `0x6350`, continuing init without advertising.

#### Advertising Restart Function (`0xA624`)

Dispatcher that restarts connectable advertising after BLE connection events. Operates through the advertising state struct at `0x809074`:

- Loads a function pointer from `[0x809074 + 4]` (the restart callback)
- Optionally calls a per-advertising-set cleanup callback before restarting
- Sets an "advertising restarted" flag at `[0x809074 + 130]`

Called from **17 sites** — all in BLE connection lifecycle handlers:

| Callers | Address Range | Context |
| --- | --- | --- |
| 3 | `0x9E12`–`0xA142` | Core BLE connection state machine (connect/disconnect completion) |
| 14 | `0x4A4BE`–`0x4B5CE` | Cordio DM `ConnSmAct` state machine actions (open, close, timeout, subrating, parameter negotiation) |

None of these callers independently decide to start advertising — they restart an already-running advertising set. The initial start decision is made only at `0x6326`.

#### DmAdvStart Callers (`0x2A5F8`)

11 call sites for the low-level advertising start:

| Address | Context |
| --- | --- |
| `0x6B22` | WDX connectable advertising setup |
| `0x837E` | Battery level change → re-advertise |
| `0xA6EA` | Core advertising restart (called via `0xA624`) |
| `0xAB6C` | Register write advertising update |
| `0xAC44` | IRK advertising update after pairing |
| `0xECBE` | Appearance/name advertising update |
| `0xF042` | Scan response data update |
| `0x12ED8` | Periodic advertising setup (PAwR, non-connectable) |
| `0x182C0` | Firmware DFU mode advertising |
| `0x390CC` | Advertising interval update |
| `0x6B646` | PAwR periodic advertising (non-connectable) |

### PAwR / BrickNet Activation

PAwR brick-to-brick communication is **data-driven** — activated when a Smart Tag's play content requires multi-brick synchronization. Not always active when undocked.

#### RAM State

| Address | Contents |
| --- | --- |
| `0x80D78C` | Coordinator state flags (bit 0 = coordinator active, bit 1 = responder active, bit 2 = has active session) |
| `0x80D8FC` | Coordinator launched flag (set to 1 when coordinator starts) |
| `0x80D8FD` | Play-driven BrickNet flag |
| `0x80DE10` | Session state block (parameters, peer data, sync state) |
| `0x80CF11` | PAwR power/signal level |
| `0x80CF23` | PAwR feature flags (bit 2 = responder mode supported) |
| `0x80195A` | BrickNet state machine flags (bit 0 = callback pending, bit 1 = peer connected, bit 2 = coordinator joined) |
| `0x808424` | BrickNet callback function pointer |
| `0x806ADA` | BrickNet peer address / channel ID |

#### Activation Path

The boot init at `0x62D8` checks play content type after tag detection:

```
0x630E: bl   0x1505C         ; Check if undocked
0x6312: bl   0x4F938         ; Get play state / content info
0x6318: bl   0x5102C         ; Validate play content
0x6326: bl   0xF0FC          ; Get play content type descriptor
0x632A: breq r0, 0, 0x6350   ; NULL → no multi-brick content → skip PAwR
0x632C: ldb  r0, [r0, 0]     ; Load content type byte
0x632E: breq r0, 0x4, 0x6344 ; Type 4 → PAwR session (UUID 0xBF8C4668)
0x6334: brne r0, 0x2, 0x6350 ; Type ≠ 2 → skip PAwR
0x634C: bl   0x505F0         ; Start PAwR session (type 2: UUID 0x7020162E)
```

Content types `0x02` and `0x04` initiate PAwR with different group UUIDs — likely identifying different play experiences so only compatible bricks synchronize.

#### Coordinator Setup (`0x3B29C`)

The main PAwR coordinator initialization:

1. Calls `0x1504C` — verify undocked / ready for BrickNet
2. Sets bit 0 of `0x80D78C` (coordinator active)
3. Calls `0x13E70` — BLE controller init
4. Calls `0x3B828` with 10,000ms timeout
5. Calls `0x3B688` with arg 1 (PAwR advertising mode)
6. Sets `0x80D8FC` = 1 (coordinator launched)
7. Configures BLE stack via `0x193D0`, `0x2AFDC`, `0x196A4`, `0x1962C`, `0x196B8`
8. Sets up periodic advertising interval via `0x6F7E0`
9. If resuming (bit 2 of `0x80D78C` set): sends session reconnect via `0x6BE40`

Called from **5 sites** via the task dispatch system (types 1, 3, 4, 7) and the hardware interrupt path.

#### Session Start (`0x505F0`)

Constructs and sends a BrickNet session initiation message:

1. Calls `0x6CEC8` — check BrickNet transport availability
2. Calls `0x51078` — initialize session parameters
3. Builds session request (type `0x0B`) with opcode 5 (session start), peer ID, channel, UUID, encryption key
4. Sends via BrickNet transport

#### Session Persistence

On boot, `0x151AC` reads flash for a previously saved PAwR session (2 storage slots, validated by magic numbers):

```
0x6416: bl   0x151AC         ; Check for saved PAwR session in flash
0x641C: breq 0x6486          ; State == 0 (no saved session) → skip
0x641E: bl   0x1101C         ; Check PAwR power state (0x80CF11)
0x6424: bl   0x11240         ; Check responder mode (0x80CF23 bit 2)
0x642C: bl   0x3B250         ; Query active task type 4
...
0x647A: bl   0x505F0         ; Resume PAwR session
0x6492: bl   0x2BB88         ; Or start as responder
```

If a valid session exists with 2+ peers, PAwR coordinator mode resumes automatically. Otherwise, the brick may join as a responder (`0x2BB88` sets bit 2 of `0x80195A`).

#### Semantic Tree Integration

The semantic tree executor at `0x4B830` has **opcode 21** (`0x4BB7A`) which calls `0x6CEF8` — BrickNet transport message send. This allows play bytecode in `play.bin` to send messages between bricks over an established PAwR session. The bytecode sends data but does not initiate PAwR itself — activation happens at the content-type level.

`0x6CEF8` is a sub-interpreter with 13 opcodes for BrickNet message serialization (variable-length messages, base table at `0x37BCF4`).

#### Hardware Interrupt Path (`0x17C20`)

ARC auxiliary timer registers (1024–1028) drive PAwR periodic advertising timing. The interrupt handler at `0x17C20` services the PAwR advertising train — this runs only after PAwR is already active, not as an activation trigger.

### Patterns

**Response building:** Every read handler follows the same pattern — `WsfBufAlloc(size)`, store `0x03` at byte 0, register ID at byte 1, fill remaining bytes, call `0x38BF0` to send.

**Assert points:** 931 locations call `0x3B1D4` (directly) or `0x40408` (wrapper). Each passes a source filename hash and line number. The fault record at `0x80F470` uses magic `0xDEADDD00`.

**Critical sections:** 185 `clri` / 210 `seti` / 234 `sync` instructions. Concentrated in the RTOS scheduler, memory allocator, and BLE stack.

**Jump tables:** 18 indexed branch tables (`bi [r0]`) across the binary — WDX register dispatch, semantic tree opcodes, animation engine opcodes, BLE event dispatch, SMP state machine, GATT/ATT dispatch.

### String Table Offsets

| Offset | Contents |
| --- | --- |
| `0x716BF` | `charging_ui.c`, `asic.c` |
| `0x716F7` | BLE stack sources (`bsal_*.c`, `wsf_*.c`, `ll_*.c`, `bb_ble_*.c`) |
| `0x71DD3` | `semantic_tree.c`, `interpolate.c` |
| `0x71DF1` | "Memory Allocation failed while stream mic samples" |
| `0x71E42` | PAwR network state strings (`SYNC_LOST`, `JOIN_FAILED`, etc.) |
| `0x726A0` | Build metadata: "Smart Brick", "P11_audiobrick", "v2.29.0" |
| `0x72AF4` | Full build string: `P11_audiobrick_EM-v2.29.0-gfc9910378` |
| `0x72B5B` | WDX file names: "Firmware", "FaultLog", "Telemetry" |
| `0x73FB4` | `exactLE` UUID strings |
| `0x77642`+ | Assert filenames (~220 unique C source paths) |

## Source Files (from debug strings)

BLE stack (Cordio):

```
bsal_main.c, bsal_msg.c, bsal_disc.c, bsal_batjamc.c, bsal_ead.c,
bsal_gap.c, bsal_timer.c, bsal_wdxc.c, wsf_msg.c, wsf_buf.c,
wsf_queue.c, ll_main.c, ll_init.c, lctr_main.c, dm_dev_priv.c,
bb_main.c, bb_ble_main.c, bb_ble_conn_master.c, bb_ble_conn_slave.c,
hci_core.c, hci_cmd.c, att_main.c, atts_main.c, smp_main.c,
sec_main.c, app_main.c, app_master.c, app_slave.c
```

PAwR:

```
ll_init_adv_central_pawr.c, ll_init_adv_peripheral_pawr.c,
lctr_init_central_pawr.c, lctr_init_peripheral_pawr.c,
bb_ble_adv_central_pawr.c, bb_ble_adv_peripheral_pawr.c,
lctr_isr_adv_central_pawr.c, lctr_isr_adv_peripheral_pawr.c,
lctr_act_conn_central_pawr.c, hci_cmd_pawr.c
```

Application:

```
asic.c, charging_ui.c, semantic_tree.c, interpolate.c
```

## Firmware Versions

12+ versions extracted from the Bilbo backend. Debug strings are progressively stripped in later builds — earlier versions (v0.46.0) contain more source filenames than production builds (v0.72.1).

| Version | HW | FW | Size | Notes |
| --- | --- | --- | --- | --- |
| v0.46.0 | hw4 | v1.119.0 | 645 KB | Most debug strings |
| v0.48.2 | hw4 | v1.122.0 | 652 KB | |
| v0.54.0 | hw4 | v2.3.0 | 600 KB | |
| v0.65.0 | hw4 | v2.18.0 | 590 KB | |
| v0.66.1 | hw4 | v2.21.0 | 591 KB | |
| v0.66.1 | hw4 | v2.29.0 | 594 KB | |
| v0.70.0 | dev | v2.25.0 | 593 KB | Dev build |
| v0.71.0 | dev | v2.28.0 | 594 KB | Dev build |
| v0.72.1 | hw4 | v2.29.0 | 594 KB | Current production |
| v0.72.1 | hw4-customer | v2.29.0 | 594 KB | Customer variant |
| v0.72.3 | hw3-customer | v2.29.1 | 594 KB | hw3 variant |
