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

### ROFS Header (32 bytes)

| Offset | Size | Value | Description |
| --- | --- | --- | --- |
| 0x00 | 4 | `ROFS` | Magic identifier |
| 0x04 | 4 | 1 | Version |
| 0x08 | 4 | `0x3EB60BD6` | CRC32 of filesystem |
| 0x0C | 4 | `0x40` | Offset to first file entry |
| 0x10 | 8 | `17a06286c2f563fe` | 64-bit hash |
| 0x18 | 4 | 165,291 | Total content size |
| 0x1C | 4 | 4 | Number of files |

### File Table

4 entries of 12 bytes each starting at offset 0x20. Format: `[CRC32:4][entry_offset:4][entry_size:4]`.

| # | Name | CRC32 | Entry Offset | Entry Size |
| --- | --- | --- | --- | --- |
| 0 | play | `0xC2CBD863` | `0x0048` | 22,770 |
| 1 | audio | `0xE0613999` | `0x5982` | 132,649 |
| 2 | animation | `0xE145EE5D` | `0x25FF3` | 9,487 |
| 3 | version | `0x4671AE97` | `0x2854A` | 97 |

Entry sizes include an 80-byte per-file header: 8-byte metadata (CRC pair or `00000000 META`), 64-byte filename (null-padded ASCII), 8-byte content hash. File content follows the header.

The tail of the ROFS contains a plaintext manifest with version and 64-bit hashes of each file:
```
0.72.1
play.bin:0x97C6D1D9024B4427
audio.bin:0xAA8C2DE61258F454
animation.bin:0xDB081D8D66AC9643
```

### play.bin — PPL (Play Preset Library)

22,690 bytes. Magic `7F PPL`. See [play.bin Format](#playbinformat) below for full details.

### audio.bin — AAP (Audio Assets Pack)

132,569 bytes. Magic `7F AAP`. Contains **synthesizer instructions** for the ASIC's analog synthesizer, not PCM audio. 3 audio banks, 154 clips.

| Offset | Size | Description |
| --- | --- | --- |
| 0x00 | 4 | Magic: `7F 41 41 50` (`7F AAP`) |
| 0x04 | 4 | Version/flags (0) |
| 0x08 | 2 | Number of audio banks (3) |
| 0x0A | 2 | Number of audio clips (154) |
| 0x10 | 616 | Audio ID table — 154 x 4-byte clip IDs (sparse, values 4–330) |
| 0x278 | 2,464 | Clip metadata table — 154 x 16-byte entries: `[size:4][offset:4][0xFFFFFFFF:4][format_code:4]` |
| 0xC14 | 128,063 | Audio clip data |

Format codes indicate synthesizer modes: 6 (1 clip, large — music/intro), 8 (43 clips — short effects), 9 (16 clips), 10 (92 clips — most common, speech/dialogue), 11 (1 clip).

### animation.bin — ANI (Animation Data)

9,407 bytes. Magic `7F ANI`. Contains LED animation sequences. 9 animation banks, 135 clips.

| Offset | Size | Description |
| --- | --- | --- |
| 0x00 | 4 | Magic: `7F 41 4E 49` (`7F ANI`) |
| 0x04 | 2 | Number of animation banks (9) |
| 0x06 | 2 | Number of animation clips (135) |
| 0x08 | 540 | Animation ID table — 135 x 4-byte IDs, structured as `[bank:8][type:8][index:8][reserved:8]` |
| 0x224 | 1,080 | Clip offset/size table — 135 x 8-byte entries: `[offset:4][size:4]` |
| 0x65C | ~7,700 | Animation clip data — small clips (17–83 bytes) with IEEE 754 float32 timing/intensity values |

Animation banks: bank 1 (types 0x04–0x07 = 67 base patterns, types 0x40–0x7E = 32 individual LED channel controls), bank 2 (31 animations), bank 17 (4 system/special animations).

### version.txt

17 bytes. Plaintext version string `"0.72.1"`.

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
| `0x801BE8` | Coil mode state |
| `0x801CAC` | Play engine tick counter (32-bit) |
| `0x801CB0` | Play engine start tick (32-bit) |
| `0x80195A` | BrickNet state machine flags |
| `0x806ADA` | BrickNet peer address / channel ID |
| `0x8068D0` | BLE connection info |
| `0x8083F6` | Crypto / pairing data |
| `0x808424` | BrickNet callback function pointer |
| `0x809074` | Advertising state struct (restart callback, per-set callbacks) |
| `0x80942C` | Hardware charger status byte (5-bit bitmap) |
| `0x809430` | Tag UID struct (low 32 at +0, high 32 at +4) |
| `0x809438` | Play engine state table (6 channels, ~8KB total at `+0x1C`) |
| `0x809392` | Magnetics flag |
| `0x80B5DC` | WDX connection state table / content registry |
| `0x80C6C0` | PPL preset state (364 bytes — state, counts, thresholds) |
| `0x80C808` | Current content signature (audio bank, class, variant, type, position) |
| `0x80CF11` | PAwR power/signal level |
| `0x80CF23` | PAwR feature flags |
| `0x80DCC8` | ASIC tag state struct (80 bytes) |
| `0x80D670` | Device name buffer |
| `0x80D968` | Play engine ready flag |
| `0x80D96C` | Tag database struct |
| `0x80D804` | Play state machine struct (state, counter at +0xA, sensor signature at +6) |
| `0x80D9D0` | Play detector state (tag removal grace timer, sensor flags at +0x08, event counter at +0x18) |
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
| `0xF01800` | ASIC SPI control (write 1 = start transfer, 256 = init) |
| `0xF01804` | ASIC SPI status / FIFO depth |
| `0xF01808` | ASIC SPI data (TX/RX FIFO) / timer counter |
| `0xF0180C` | ASIC SPI interrupt status (bit 0 = transfer complete) |
| `0xF01810` | ASIC SPI slave select / chip select |
| `0xF01814` | ASIC SPI transfer length / DMA pointer |
| `0xF01818` | ASIC SPI interrupt enable mask |
| `0xF0181C` | ASIC SPI configuration |
| `0xF03838`, `0xF0383C` | System status (polled at boot) |
| `0xF0404C` | ASIC control register (tag init: write 0x48) |
| `0xF0484C` | Coil control register (tag reading power levels, modes 0–9+) |
| `0xF00860` | ASIC interrupt status (bit 0=tag data, 4=magnetics, 16=slot, 21=tag detect, 22=timer, 25=magnetics complete) |
| `0xF00868` | ASIC interrupt acknowledge |

## Disassembly

Disassembled using `arc-elf32-objdump` from the [ARC GNU toolchain](https://github.com/foss-for-synopsys-dwc-arc-processors/toolchain/releases). The raw binary must be wrapped in an ELF container first — `objdump -b binary` silently fails for ARC, outputting only `.word` data:

```bash
arc-elf32-objcopy -I binary -O elf32-littlearc -B EM \
  --rename-section .data=.text smartbrick_v0.72.1_code.bin fw.elf
arc-elf32-objdump -d -m EM fw.elf > disasm.txt
```

No prebuilt macOS toolchain — run via Docker with `--platform linux/amd64` on Apple Silicon.

Full disassembly: 178,900 lines, 10 MB.

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

**Play/animation engine** (`0x5262C`, ~6,677 lines): Largest function in the firmware. Software analog synthesizer with **144 opcodes**, dispatched via jump table at `0x37C800`. Hardware FPU operations (`fsadd`, `fsmul`, `fsub`, `fscmpf`, `fcvt32`). Operates on 64-sample single-precision float blocks. 6 playback channels indexed from state table at `0x809438`. Reads 16-bit instructions — bits 0–14 = opcode, followed by 0–N operands (count from table at `0x37D8B8`). Opcode categories: oscillators (sine via 512-entry table at `0x37E200`), filters (IIR, biquad), envelopes (crossfade, decay), mixing (add/sub/mul/modulate), pitch (phase accumulation), math (Newton-Raphson reciprocal with magic `0x7EF311AC`).

**Play event handler** (`0x52588`): Entry point for incoming content events. Validates content type against registry at `0x80B5DC`, resolves ROFS content via `0x40F88`, calls `0x16B64` to start the play engine dispatch loop.

**Semantic tree executor** (`0x4B830`, ~493 lines): 25-entry switch table via `bi [r0]` at `0x4B85A`, opcodes from table at `0x37BCF4`. Recursive tree walker processing play script nodes from `play.bin`. Opcodes: 1–2 (control/conditional), 3–12 (data writes — byte/halfword/word/float/typed), 13–14 (if-then, if-then-else), 15/19–20 (loops), 16–18 (comparisons), **21 (distributed execute — BrickNet send via `0x6CEF8` or local)**, 23–24 (parameterized recurse), 25 (typed store dispatch).

**Assert / fault handler** (`0x3B1D4`): Called from **931 assert points** across the firmware. Stores magic `0xDEADDD00` at `0x80F470` with hash, line number, PC, and severity. Sends fault notification over BLE via `0x6BE40`.

**RTOS scheduler** (`0x714FC`): Uses `clri`/`seti` for critical sections. Manages task queues at `0x80EB50`, `0x80DD28`, `0x80DF58`. Semaphore/mutex with atomic decrement patterns.

**WsfBufAlloc** (`0x02770`): Buffer allocator from the Cordio stack. Called 50+ times from the WDX dispatch alone. Takes size in `r0`, returns buffer pointer.

### Smart Tag Subsystem

Debug strings stripped in production (v0.65+) but all functional code is present. Key functions identified by MMIO accesses, RAM struct references, and assert module hashes.

**ASIC SPI driver** (`0x32304`–`0x326D0`): Low-level SPI communication with the custom LEGO ASIC. Configures registers at `0xF01800`–`0xF0181C`. Transaction flow: trigger transfer (`st 1,[0xF01800]`), poll interrupt (`[0xF0180C]` bit 0), read results from `[0xF01808]`. Post-transfer processing loops over 8 tag slots reading timing data.

**ASIC interrupt handler** (`0x336E4`): Reads interrupt status from `[0xF00860]`, dispatches by bit field — bit 0 (tag data ready), bit 4 (magnetics cycle), bit 16 (slot complete), bit 21 (tag detection), bit 22 (timer), bit 25 (magnetics complete). Acknowledges via `[0xF00868]`.

**Tag subsystem init** (`0x2A17C`): Zeros the 80-byte ASIC tag state struct at `0x80DCC8`. Configures ASIC control register at `[0xF0404C]` with value `0x48`. Enables SPI channels 0, 1, 3. Sets up 600ms periodic tag polling timer via `0x33CAC`.

**Coil control** (`0x33FD0`): Configures copper coils via `[0xF0484C]` for tag reading at different power levels (modes 0–9+). Stores mode state at `0x801BE8` and magnetics flag at `0x809392`.

**Tag UID extraction** (`0x4FC58`): Parses ISO 15693 / NFC-V response from SPI buffer. Checks flag byte bit 0 (error) and bit 3 (format variant). Two parsing paths — standard reads bytes [7]–[12], compact reads [1]–[6]. Assembles 6 bytes into two 32-bit words via shift/or.

**Tag scan loop** (`0x67634`): Core tag detection loop. Calls `0x4FC58` for UID extraction, compares against stored UID at `[0x809430]`/`[0x809434]` via XOR. Detects: same tag (no change), new tag (dispatch add), tag removed (dispatch remove). Validates against all-ones (no tag present).

### Tag → Play Engine Pipeline

**Sensor input pipeline**: All sensors (accelerometer, light/color, sound) are read by the ASIC via time-multiplexed coils. The ASIC interrupt handler at `0x336E4` reads `[0xF00860]` (interrupt status register), dispatching by bit field. Sensor readings arrive as SPI transfers into the play detector state at `0x80D9D0`. The magnetics scheduler at `0x801BE8` controls coil time-multiplexing between tag reading, charging, positioning, and sensor measurement. ADC/analog configuration at `[0xF00A84]` is written with mode values `0x8`, `0x100`, `0x200` at boot, IRQ setup, play engine area, and RTOS init.

**Semantic tree type system** (`0x51E68`): 81-entry jump table mapping instruction byte values 144–224 to semantic types. Type 6 (unsigned, via `0x519E8`) used by opcode 16 (range check) — values `0xDB`=5-byte float, `0xD9`=2-byte, `0xDA`=3-byte, `0xA0`=1-byte literal. Type 7 (signed, via `0x514B8`) used by opcodes 17–18 — values `0xC6`=5-byte float, `0xC5`=3-byte, `0xC4`=2-byte. Type 8 (condition, via `0x513B4`) used by opcodes 13–14, 19–21 — values `0xDD`=5-byte float, `0xDC`=3-byte, `0x90`=1-byte literal (0–143 direct, computed as `add1 r1, r0, 0x38`).

**Play state machine** (`0x6F178`): 9-state machine over struct `0x80D804`. State 2 (active play): reads content ID, extracts fields via XOR with `0xFFF` mask, increments counter at `[0x80D804+0xA]` — counter ≤ 1 calls `0x6784C` (LED update), counter > 1 transitions to state 3 (content iteration). State 5 (sensor active): reads sensor signature at `[0x80D804+6]`, compares content data — match continues play, mismatch transitions to state 3.

**Play command dispatcher** (`0x4E9DC`): 9-case jump table over `0x80D804`. Command 1=start play, 2=LED mode (`0xFF02`), 3=content iteration, 4=reset executor (`0x4B650`), 5=sensor monitoring (11-bit mask increment, mode 4 via `0x4E1BC`), 6=conditional reset/resume, 7=callback, 8=terminal mode 6.

**PPL counter increment** (`0x66990`): Event type 0 → identity count (`+0x06`), type 4 → item count (`+0x08`), else → other count (`+0x0A`). Sums all three; if sum ≥ total_needed and state == 2, transitions to completion.

**PPL completion** (`0x669D0`): State 1 → content reload (`0x36D4C`). State 2 → cleanup (`0x40484`), set mode 2 (`0xA5CC`). State 4 → allocate audio (`0x40728`), write 261, read bank from `[0x80C8B8]`, audio output (`0x407D4`) — the "destroyed" sound. Otherwise → zero state, reset PPL (`0x24A30`).

**Content signature matching** (`0x80C808`): PPL resolver at `0x66A48` compares tag content signature — class (bit 5 masked via `bclr 0x5`), variant bytes, audio bank, content type halfword. Step index at `+0x10` masked to 5 bits (cycles 0–31). Uses `0xAAAAAA` alternating pattern for step sequencing.

**FNV-1a content hashing** (`0x4E9B8`): Init `0x811C9DC5`, per byte XOR then multiply `0x01000193`. Used for fast content signature comparison.

**Tag validation bridge** (`0x51058`): Validates tag data struct (checks `0xDEADDD00` magic), then calls the event dispatch at `0x66BF8`. Also called for tag-removed (NULL) case.

**Tag event dispatch** (`0x66BF8`): Reads event type from tag struct offset 4, dispatches via 8-case jump table. Identity tags (type 1/5) → `0x508C8` with magic `0xA7E24ED1`. Item tags (type 2) → first calls `0x47A10` (item-specific lookup), then `0x5095C` with magic `0x0BBDA113` and extended params from offsets 8–20. Content type 3 → `0x50C08` with `0x812312DC`. Distributed/type 4 → `0x50C08` with `0x814A0D84`. Status/type 6 → `0x50B88` with `0xE3B77171`.

**Play event message builders** (`0x508C8`, `0x5095C`, `0x50C08`, `0x50B88`): Check play engine readiness (`0x80D968`), look up event handler via `0x50FDC` (matches current tag UID against `0x809430`), serialize message with opcode + params, enqueue to play engine event ring buffer via `0x51094`.

**PPL preset resolver** (`0x66A48` / `0x66AC0`): Manages content sequencing from state at `0x80C6C0` (364 bytes). Tracks identity, item, and other event counts separately. Sums all three against a total threshold — when reached, triggers content completion via `0x22D14`. Compares tag content signature at `0x80C808` (audio bank, content class, variant, type, position) against current content to decide continue vs switch.

**Content resolution** (`0x40F88`): Resolves ROFS content pointer — maps content reference from tag data to actual data in `play.bin`/`audio.bin`/`animation.bin`.

**Audio output** (`0x407D4` → `0x407F0`): Schedules audio playback — 72-byte blocks (48 bytes audio + parameters) sent to ASIC via SPI. Aligned to 64-sample DMA periods. Audio commands carry bank ID, playback mode (8=trigger), priority, duration, content index.

**LED output** (`0x66864`): 8-case jump table for LED patterns — type 0=LFSR random, 1=`0x0F`, 2=`0x55` alternating, 4=`0xFF` all on, 5=`0x00` all off, 6=`0xF0`, 7=`0xAA` inverse alternating. Fills LED buffer via memset.

**Tag removal handler** (`0x66CD0`): On tag removal, checks elapsed time against 20-tick threshold (~320ms grace period). If within grace window, does nothing (tag may return). After grace period, flushes play buffers via `0x37C08` and stops play engine via `0x6F848`.

**Tag event dispatch** (`0x66BF8`): 8-case jump table triggered when a tag is detected and identified. Cases route to content loading — loads audio, looks up tag type via `0x47A10`, triggers play content from ROFS `play.bin`. Content type determines play mode (single-brick or multi-brick PAwR).

**Magnetics timer scheduling** (`0x3B858`): Periodic timer for tag slot scheduling. Reads ASIC timer counter via `0x32304`, computes next trigger time. Interrupt channel registration at `0x808854` for channels 4–5.

### WDX Register Dispatch

The handler at `0x3FA24` parses the first byte of the payload to determine request type (1=read, 2=write), then dispatches by register number.

#### Read Handlers

Two dispatch mechanisms — sequential comparisons for registers outside the 0x80–0x94 range, then an indexed branch table at `0x3FACA` for 0x80–0x94. Each handler allocates a response buffer via `WsfBufAlloc` (`0x02770`), fills `[0x03, register_id, ...data]`, and sends via `0x38BF0`.

**Sequential (outside jump table):**

| Register | Response Size | Handler | Purpose |
| --- | --- | --- | --- |
| `0x02` | varies | `0x3FB80` | CurrentConnectionParameters |
| `0x08` | 4 bytes | `0x3FCA8` | CurrentAttMtu |
| `0x0A` | 2 bytes | `0x3FCC8` | CurrentPhy |
| `0x20` | 3 bytes | `0x3FB90` | BatteryLevel |
| `0x21` | 20 bytes | `0x3FBE0` | DeviceModel |
| `0x22` | 18 bytes | `0x3FBEA` | FirmwareRevision |

**Indexed jump table (0x80–0x94):**

| Register | Response Size | Handler | Purpose |
| --- | --- | --- | --- |
| `0x80` | 14 bytes | `0x3FB22` | HubLocalName |
| `0x81` | 3 bytes | `0x3FCE0` | UserVolume |
| `0x82` | 8 bytes | `0x3FCFA` | CurrentWriteOffset |
| `0x83` | 4 bytes | `0x3FD40` | **Undocumented** — internal firmware state |
| `0x84` | 8 bytes | `0x3FD64` | PrimaryMacAddress |
| `0x85` | 3 bytes | `0x3FD9E` | UpgradeState |
| `0x86` | 10 bytes | `0x3FDB8` | SignedCommandNonce |
| `0x87`–`0x91` | — | `0x3FAA0` | Nop (write-only registers) |
| `0x88` | 22 bytes | `0x3FDD8` | UpdateState |
| `0x89` | 3 bytes | `0x3FDFA` | PipelineStage |
| `0x92` | 3 bytes | `0x3FE14` | **Undocumented** — reads `0x807A78` (ASIC/tag driver status) |
| `0x93` | 3 bytes | `0x3FE2E` | ChargingState |
| `0x94` | 3 bytes | `0x3FE48` | **Undocumented** — hardware timer/clock from MMIO |

Registers 0x87, 0x8A–0x91 map to the nop handler `0x3FAA0` (write-only — no read response).

#### Write Handlers

Sequential comparisons, not indexed. Payload length is checked before dispatch.

| Register | Handler | Length | Purpose |
| --- | --- | --- | --- |
| `0x01` | `0x3FC20` | 8 | ConnectionParameterUpdateReq |
| `0x03` | `0x3FC56` | varies | DisconnectReq |
| `0x09` | `0x3FA78` | 5 | PhyUpdateReq |
| `0x25` | `0x3FC70` | — | DisconnectAndReset (sets flag to 1) |
| `0x26` | `0x3FC74` | — | DisconnectConfigureFotaAndReset (sets flag to 2) |
| `0x80` | `0x3FBBA` → `0x3F97C` | varies | HubLocalName write |
| `0x81` | `0x3FC5A` → `0x3F9D4` | 1 | UserVolume write |
| `0x87` | `0x3FC68` → `0x3FF64` | 75 | SignedCommand (ECDSA auth) |
| `0x90` | `0x3FB6C` → `0x3F934` | 2 | UXSignal (keepalive) |
| `0x91` | `0x3FC7E` → `0x3F6D0` | varies | OwnershipProof write |
| `0x95` | `0x3FC86` → `0x3FA18` | 0 | FactoryReset |
| `0x96` | `0x3FBD4` → `0x3F968` | 0 | TravelMode write |

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

`0x6CEF8` is a 13-opcode sub-interpreter for BrickNet message serialization (variable-length messages, base table at `0x37BCF4`). Opcodes: 0=skip, 1=recursive call, 2–6=advance by data size (byte/half/word/3/4 bytes), 7=count-prefixed loop, 8–11=advance 2–3 bytes, 12=variable-length with recursion.

**BrickNet message construction** (`0x6D0E4`): Reads session type from offset 58, computes offset 63 value (3 or 4), calls `0x6E3FC` (prepare buffer), gets 25-byte buffer via `0x6D6F8`, writes opcode 3 at offset 8, copies **16 bytes of semantic tree state** to offset 9, sends via `0x6E374`. The 25-byte packet is: 8-byte header + 1-byte opcode + 16-byte serialized tree state.

**BrickNet message encryption** (`0x6D188`): Reads session type from offset 58, channel from offset 61. XOR-encrypts payload bytes using key bytes from struct+0x20. Sends via `0x172B8` (BLE HCI command). Message type `0x092B` = play state, `0x1F` = control, `0x2E` = variable-length content.

**BrickNet message receive**: Incoming PAwR responses are decrypted, deserialized back to tree state, and fed into the PPL counter system at `0x66990` as "other" events. The play state machine at `0x6F178` processes the resulting state transition.

#### Hardware Interrupt Path (`0x17C20`)

ARC auxiliary timer registers (1024–1028) drive PAwR periodic advertising timing. The interrupt handler at `0x17C20` services the PAwR advertising train — this runs only after PAwR is already active, not as an activation trigger.

### Patterns

**Response building:** Every read handler follows the same pattern — `WsfBufAlloc(size)`, store `0x03` at byte 0, register ID at byte 1, fill remaining bytes, call `0x38BF0` to send.

**Assert points:** 931 locations call `0x3B1D4` (directly) or `0x40408` (wrapper). Each passes a source filename hash and line number. The fault record at `0x80F470` uses magic `0xDEADDD00`.

**Critical sections:** 185 `clri` / 210 `seti` / 234 `sync` instructions. Concentrated in the RTOS scheduler, memory allocator, and BLE stack.

**Jump tables:** 18 indexed branch tables (`bi [r0]`) across the binary — WDX register dispatch, semantic tree opcodes, animation engine opcodes, BLE event dispatch, SMP state machine, GATT/ATT dispatch.

### ROM Data Tables

| Address | Size | Contents |
| --- | --- | --- |
| `0x37BA00` | varies | Semantic tree loop stride/skip table |
| `0x37BCF4` | ~50 bytes | Semantic tree opcode bytes (25 entries + parameters) |
| `0x37C800` | 576 bytes | Play engine jump table (144 x 4-byte handler addresses) |
| `0x37D8B8` | 144 bytes | Play engine operand count table (1 byte per opcode) |
| `0x37E200` | 1024 bytes | Sine lookup table (512 entries, 16-bit fixed-point, `0x4B000000` = 2^23 scaling) |
| `0x37D960`+ | ~324 bytes | Semantic tree type resolver jump table (81 entries, bytes 144–224) |
| `0x351768` | 4 bytes | ROFS filesystem base pointer |
| `0x352C0` | varies | Audio block table (indexed by block number for DMA) |
| `0x375820` | varies | Play engine timer configuration |

### Play Engine Channel State (`0x809438`)

6 playback channels, each with a 2-byte offset at `0x80943C + channel*2`. `0xFFFF` = inactive. Per-channel slot structure:

| Offset | Size | Field |
| --- | --- | --- |
| 0x00 | 2 | Current play step |
| 0x02 | 2 | Total steps |
| 0x04 | 2 | Current sub-step |
| 0x06 | 2 | Flags |
| 0x08 | 2 | Step size |
| 0x0A | 2 | Repeat count |
| 0x1E | 2 | Priority |
| 0x20 | 2 | Start tick |
| 0x24 | 2 | Duration / length |
| 0x26 | 2 | Content index |
| 0x28 | 2 | Total content entries |

### play.bin Format

The PPL (Play Preset Library) file contains all play scripts as flat linearized semantic trees.

#### PPL Header (16 bytes)

| Offset | Size | Value (v0.72.1) | Description |
| --- | --- | --- | --- |
| 0x00 | 4 | `7F 50 50 4C` | Magic: `0x7F` `PPL` |
| 0x04 | 4 | 1 | Version |
| 0x08 | 2 | 5 | Number of presets |
| 0x0A | 2 | 58 | Number of script blocks |

#### Preset Table (offset 0x10)

61 entries of 8 bytes each: `[type:4][value:4]`. Six distinct type IDs group content by category:

| Type | Count | Script Indices | Description |
| --- | --- | --- | --- |
| 0x03 | 16 | 3–18 | Standard play content (1 PAwR-capable: script 14) |
| 0x06 | 5 | 19–23 | Interactive content |
| 0x09 | 11 | 24–34 | Ambient/background |
| 0x0B | 6 | 0–2, 35–37 | Short responses (1 PAwR-capable: script 1) |
| 0x0E | 16 | 38–53 | Item tag play sequences (1 PAwR-capable: script 42) |
| 0x10 | 7 | 54–60 | Identity/system content (1 PAwR-capable: script 54) |

#### Script Directory (offset 0x1F8)

58 entries of 8 bytes each: `[offset:4][size:4]`. Offsets are from the start of play.bin. Script sizes range from 40 to 1,564 bytes. All 58 script blocks are stored consecutively starting at offset `0x3C8`.

#### Script Block Format

Each script block starts with an 8-byte header:
```
[size:2 LE16][01][04][00][01][02][03]
```
The first 2 bytes echo the block size. The remaining 6 bytes (`01 04 00 01 02 03`) are a constant preamble in all 58 scripts.

After the header, a 4-byte sub-header:
```
[00][10][child_count][flags]
```
- Byte 0: `0x00` (root node marker)
- Byte 1: `0x10` (type/version)
- Byte 2: Child count (values 0x06–0x0B)
- Byte 3: Flags (`0x00`, `0x40`, `0x50`, `0x60`)

#### Bytecode Encoding

The bytecode uses a **table-driven opcode dispatch**, not a simple opcode-operand format. A **256-byte translation table** at ROM address `0x37BCF4` (file offset `0x75CF4`) maps each possible byte value to an opcode handler.

Execution cycle:
1. Read one byte from the script stream
2. Index into the 256-byte translation table
3. Table value minus 1 = opcode handler ID (0–24)
4. Dispatch to handler via jump table at `0x4B85E`
5. Handler consumes additional bytes from stream as needed
6. Loop back to step 1

Multiple byte values encode the same opcode — the specific byte chosen carries **implicit operand data**. The handler extracts this information from the byte value itself. This makes the encoding very compact for the EM9305's limited resources.

| Opcode | # Byte Encodings | Description |
| --- | --- | --- |
| 1 | 15 | Conditional execute |
| 2 | 8 | Evaluate expression |
| 3 | 40 | Write byte |
| 4 | 24 | Write halfword |
| 5 | 28 | Write word |
| 6 | 4 | Write float |
| 7 | 10 | Write typed value |
| 8 | 25 | Write typed value (alt) |
| 9 | 1 | Write typed value (alt2) |
| 10 | 3 | Write typed value (alt3) |
| 11 | 14 | Write typed value (alt4) |
| 13 | 2 | If-then |
| 14 | 9 | If-then-else |
| 15 | 20 | Counted loop |
| 16 | 1 | Range check (clamped) |
| 17 | 5 | Range check (signed) |
| 19 | 1 | Nested loop |
| 20 | 5 | Nested loop with stride |
| 22 | 2 | (unused in v0.72.1 scripts) |
| 25 | 6 | Type dispatch |

Byte values that map to values > 25 in the translation table are operand data consumed by the preceding opcode handler — they are never reached as instruction bytes.

#### Content Indexing from Smart Tags

The play event handler at `0x52588` maps tag RFID data to scripts:

| Tag Data Offset | Field | Maps To |
| --- | --- | --- |
| +8 | Tag type | 1 = Identity (minifig), 0x13 = Item (tile) |
| +9 | Content type | Validated against preset table types |
| +10, +11 | Content index (uint16 LE) | Selects preset (added by 4) |
| +12, +13 | Variant ID (uint16 LE) | Selects script block within preset |

Identity tags (minifigs) force variant = 1 (always the same script). Item tags use the full variant ID to select from multiple possible scripts within the chosen preset.

#### PAwR-Capable Scripts

Only 4 of 58 scripts use distributed execute (handler 21 / PAwR messaging):

| Script | Preset Type | Size (bytes) | Branches | Range Checks | If-Then-Else | Table Lookups |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0x0B | — | — | — | — | — |
| 14 | 0x03 | — | — | — | — | — |
| 42 | 0x0E | 1,564 | 6 | 9 | 17 | 71 |
| 54 | 0x10 | — | — | — | — | — |

Script 42 is the largest and most complex script in the file, and the only type-0x0E (Item tag) script with PAwR capability. See [HARDWARE.md](HARDWARE.md) for the inferred X-Wing tag case study.

#### Type-0x0E Script Comparison (Item Tags)

| Script | Size | Branches | dist_exec | Range Checks | If-Then-Else | Table Lookups |
| --- | --- | --- | --- | --- | --- | --- |
| 38 | 161 | 0 | No | 2 | 0 | 14 |
| 39 | 535 | 2 | No | 8 | 3 | 36 |
| 40 | 554 | 2 | No | 5 | 3 | 37 |
| 41 | 242 | 0 | No | 7 | 1 | 16 |
| **42** | **1,564** | **6** | **Yes** | **9** | **17** | **71** |
| 43 | 363 | 1 | No | 8 | 1 | 19 |
| 44 | 227 | 0 | No | 4 | 1 | 16 |
| 45 | 330 | 1 | No | 7 | 0 | 23 |
| 46 | 98 | 0 | No | 1 | 0 | 10 |
| 47 | 268 | 1 | No | 5 | 0 | 15 |
| 48 | 770 | 3 | No | 6 | 1 | 43 |
| 49 | 439 | 1 | No | 10 | 4 | 20 |
| 50 | 634 | 2 | No | 8 | 1 | 33 |
| 51 | 233 | 0 | No | 7 | 1 | 13 |
| 52 | 103 | 0 | No | 3 | 1 | 9 |
| 53 | 69 | 0 | No | 3 | 1 | 5 |

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

Tag subsystem (from dev builds v0.46–v0.54, stripped from production strings but code present):

```
tag_asic.c, tag_message_parser.c, tag.c, tag_db.c,
tag_claim.c, tag_manager_impl.c (→ tag_manager.c in v0.54+),
rpc_handlers_tag_int.c
```

ASIC / magnetics / positioning (from dev builds):

```
asic_irq.c, asic_mcu_reserved_data.c, asic_unique_id.c,
audio_spi_asic.c, mfm_asic.c, light_asic_controller.c, light_asic_led_out.c,
magnetics_control.c, magnetics_helpers.c, magnetics_scheduler.c,
npm_play.cpp, npm_engine.cpp, npm_processing_chain.cpp,
pose_estimator.cpp, pose_tracker.cpp, pose_filter.cpp, ambiguity_filter.cpp
```

Play engine (from dev builds):

```
play_execution.c, play_stack_executor.c, play_engine_message_handler.c,
play_file_resolver.c, play_distributed.c, play_detector.c,
ppl_preset_resolver.c
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
