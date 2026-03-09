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

**ASIC SPI driver** (`0x32304`–`0x326D0`): Memory-mapped communication with the custom LEGO ASIC (not traditional SPI bit-banging). Control registers at `0xF01800`–`0xF01860`. Functions:
- `0x32304` — Read SPI byte count from `[0xF01804]`
- `0x32310` — Reset/init: set state=IDLE, clear data pointer, configure `[0xF01804]` (count=0, enable=1, chip_select=1, timeout=max)
- `0x32340` — Set DMA buffer: `[0xF01814]` = buffer base, length = 512
- `0x323A0` — Transfer start: checks state at struct offset `0x4C` (2=ready → write 1 to `[0xF01800]`, 0=wait, else=error). Spin-waits for `[0xF0180C]` bit 0 (complete)
- `0x3245C` — Post-transfer processing: clears interrupt via `[0xF00820]`, reconfigures DMA (1024-byte extended buffer)
- `0x325EC` — Data copy: reads `[0xF0180C]` status, checks ASIC link at `[0xF0383B]` (bits 0-1 must = 3), copies 14 × 32-bit words from `[0xF01810]+`, reads tag data word from `[0xF01808]`
- `0x326D0` — Pre-transfer setup: reads coil channel, loads config from `[0xF00480+channel]`

Three-state machine: 0=COMPLETE (data available), 1=ACTIVE (DMA in progress), 2=IDLE (ready for new transfer).

**ASIC interrupt handler** (`0x336E4`): Reads interrupt status from `[0xF00860]`, dispatches by bit field — bit 25 (tag detected → enable coil at `0xF04400`), bit 16 (tag read complete → read `0xF04054` status), bit 21 (tag data ready → read data, check presence at `0xF0407D`), bit 22 (coil/antenna event). Acknowledges via `[0xF00868]`.

**Coil interrupt handler** (`0x3B6F0`): Per-channel handler dispatched from ISR at `0x3B728` (saves r0–r13, lp registers). Configured with vector `0xAA`, level `0x12`. For each coil channel 0–7: computes bitmask `1<<channel`, clears interrupt via `[0xF00820]`. Channels 4–5 dispatch to tag-event callbacks from handler table at `0x808854`.

**Hardware timer** (`0x3B828`): Configured with vector `0x55`. Reads clock source from `[0xF03800]`: if bit 0 set, uses base period 24 (0x18), otherwise 48 (0x30). Multiplied by 60,000 (0xEA60) for timer compare value.

**Coil subsystem init** (`0x2A080`): Disables all coil interrupts. Calls `0x32594` with SPI channel count = 24, then `0x32584` to enable SPI mode 0. Sets all coil timers to `-1` (disabled) at `[0xF01810]`. Resets interrupt controller at `[0xF00814]` (all masked), then selectively enables bits 1 and 8. Resets coil event handlers for channels 0–3, sets timer period (256, then 1).

**Tag subsystem init** (`0x2A17C`): Zeros 0x80 bytes at `0x80DCC8`. Configures ASIC: `[0xF0404C]` = `0x48` (SPI clock divider), `[0xF0404C+0]` = `0xFF` (all channels enabled), coil modes `[0xF01845]=1` (coil 1 active), `[0xF01844]=2` (coil 0 passive), `[0xF01847]=0` (coil 3 off). Enables coil interrupts via `0x325C4`/`0x325A4`, sets 600ms periodic polling timer, state flag at `[0x80DCCC]=1`.

**Coil control** (`0x33FD0`): Configures copper coils via `[0xF0484C]` for tag reading at different power levels (modes 0–9+). Stores mode state at `0x801BE8` and magnetics flag at `0x809392`. Coil mode table at ROM `0x3062E8` provides per-mode 3-byte entries applied as: `COIL_CONFIG = (old & 0xFFFFB003) | (byte1<<2 & 0x3C) | (byte2_masked<<6); if byte0>6: set bit 14 (extended range)`.

**Tag command dispatch** (`0x33D54`): Branches by coil mode (`r8`): modes 0/1 write to `TAG_SUBCMD` (`[0xF04009]` = 0 or 1) for simple pre-configured ASIC sequences. Modes 2/3 load data into FIFO at `0xF04800+`, then write `0x93C` to `TAG_CMD` (`[0xF04008]`). FIFO is 256-entry halfword buffer accessed as `[index<<2 & 0x3FC + 0xF04800]`.

**Tag slot command** (`0x340B0`): Builds `TAG_SLOT_CMD` register value from slot table at `[0x80FD60]`: `value = slot_index | (type_bits<<10)` where type_bits are bits 0–1 of byte at `slot_struct[80]`. Slot index clamped to max 39.

**Anti-collision setup** (`0x3410C`): Takes mask and flag parameters. Computes `mask = (input & 0xFC) >> 1 | 1` (enable bit), writes to `[0xF04044]`. Then reads `[0xF04050]`, conditionally sets/clears bit 4 (addressed mode) based on flag, writes back.

**ASIC-to-RAM copy** (`0x69944`–`0x69AA8`): Family of functions copying tag data from ASIC result buffers to the RAM mirror. Each calls register-change notification at `0x2A9E0` which sets dirty/pending bits in bitmaps at `0x807890`/`0x807898` (atomic via `clri`/`seti`):
- `0x69944` → `0x8078A8` (20 bytes, register 4) — tag data block A
- `0x6996C` → `0x8078BC` (20 bytes, register 5) — tag data block B
- `0x69994` → `0x8078D0` (20 bytes, register 6) — tag data block C
- `0x699BC` → `0x8078E4` (20 bytes, register 7) — tag data block D
- `0x699E4` → `0x8078F8` (packed 16-bit via `vpack2hl`, register 9) — coil position
- `0x69A0C` → `0x807900` (packed 16-bit via `vpack2hl`, register 10) — coil position
- `0x69A34` → `0x80792A` (1 byte, register 0x24) — tag config
- `0x69A4C` → `0x807AA2` (3 × 16-bit, register 0x3D) — extended tag info
- `0x69A70` → `0x807A78` (1 byte, register 0x2F) — ASIC status (→ WDX register 0x92)
- `0x69A88` → `0x807A60` (24 bytes, register 0x2E) — tag payload (complex repack: byte pairs → 32-bit words)

**Tag content parser** (`0x4EC58`): Parses tag data from the RAM mirror in a TLV-style format: `[type_id:2][content_length:2][payload:N]`. The 16-bit type ID encodes a 12-bit tag type (bits 0–11) and a 2-bit block type (bits 12–13: 0=header, 1=data continuation, 2=security). Allocates a buffer, copies payload, and feeds into the tag content structure at `0x80B538` / `0x80B944`.

**Content identity extraction** (`0x4FC58`): Extracts the 6-byte content identity from the decrypted TLV buffer. Checks flag byte: bit 0 set → return 0xFFFFFFFF:0xFFFF (invalid/no tag). Bit 3 set → compact format (bytes [1]–[6]). Neither → extended format (bytes [7]–[12]). Assembles 6 bytes into content_lo (u32) and content_hi (u16, zero-extended to u32). This is the same 6-byte identity accessible via ROM function `0xffdfd164`.

**Tag scan loop** (`0x67634`): Core tag detection loop. Dequeues tag data from ring buffer, calls `0x4FC58` to extract the 6-byte content identity, XOR-compares against stored identity at `[0x809430]`/`[0x809434]`. Detects: same tag (no change), new tag (dispatch add → triggers `0x4F938`), tag removed (dispatch remove). All-ones identity = no tag present.

**Manufacturer dispatch** (`0x5C96C` / `0x63B20`): After tag data is parsed, reads IC manufacturer code from `0x80B944+0x8` and branches by manufacturer: 0x07 (TI, r14=0), 0x0D (ST, IC ref check), 0x16 (EM Micro, r14=2), 0x17 (TI new, r14=1). The type index r14 selects handler functions from a 2D dispatch table at ROM `0x37CF00`, indexed as `ROM[r0*32 + r14*4 + 0x37CF00]`. A secondary byte table at `0x37CFA0` returns per-manufacturer configuration values — EM(16) consistently returns 54, TI returns varying values (88–204). TI and EM paths use different handler functions throughout.

### Tag → Play Engine Pipeline

**Sensor input pipeline**: All sensors (accelerometer, light/color, sound) are read by the ASIC via time-multiplexed coils. The ASIC interrupt handler at `0x336E4` reads `[0xF00860]` (interrupt status register), dispatching by bit field. Sensor readings arrive as SPI transfers into the play detector state at `0x80D9D0`. The magnetics scheduler at `0x801BE8` controls coil time-multiplexing between tag reading, charging, positioning, and sensor measurement. ADC/analog configuration at `[0xF00A84]` is written with mode values `0x8`, `0x100`, `0x200` at boot, IRQ setup, play engine area, and RTOS init.

**Semantic tree type system** (`0x51E68`): 81-entry jump table mapping instruction byte values 144–224 to semantic types. Type 6 (unsigned, via `0x519E8`) used by opcode 16 (range check) — values `0xDB`=5-byte float, `0xD9`=2-byte, `0xDA`=3-byte, `0xA0`=1-byte literal. Type 7 (signed, via `0x514B8`) used by opcodes 17–18 — values `0xC6`=5-byte float, `0xC5`=3-byte, `0xC4`=2-byte. Type 8 (condition, via `0x513B4`) used by opcodes 13–14, 19–21 — values `0xDD`=5-byte float, `0xDC`=3-byte, `0x90`=1-byte literal (0–143 direct, computed as `add1 r1, r0, 0x38`).

**Play state machine** (`0x6F178`): 9-state machine over struct `0x80D804`. State 2 (active play): reads content ID, extracts fields via XOR with `0xFFF` mask, increments counter at `[0x80D804+0xA]` — counter ≤ 1 calls `0x6784C` (LED update), counter > 1 transitions to state 3 (content iteration). State 5 (sensor active): reads sensor signature at `[0x80D804+6]`, compares content data — match continues play, mismatch transitions to state 3.

**Play command dispatcher** (`0x4E9DC`): 9-case jump table over `0x80D804`. Command 1=start play, 2=LED mode (`0xFF02`), 3=content iteration, 4=reset executor (`0x4B650`), 5=sensor monitoring (11-bit mask increment, mode 4 via `0x4E1BC`), 6=conditional reset/resume, 7=callback, 8=terminal mode 6.

**PPL counter increment** (`0x66990`): Event type 0 → identity count (`+0x06`), type 4 → item count (`+0x08`), else → other count (`+0x0A`). Sums all three; if sum ≥ total_needed and state == 2, transitions to completion.

**PPL completion** (`0x669D0`): State 1 → content reload (`0x36D4C`). State 2 → cleanup (`0x40484`), set mode 2 (`0xA5CC`). State 4 → allocate audio (`0x40728`), write 261, read bank from `[0x80C8B8]`, audio output (`0x407D4`) — the "destroyed" sound. Otherwise → zero state, reset PPL (`0x24A30`).

**Content signature matching** (`0x80C808`): PPL resolver at `0x66A48` compares tag content signature — class (bit 5 masked via `bclr 0x5`), variant bytes, audio bank, content type halfword. Step index at `+0x10` masked to 5 bits (cycles 0–31). Uses `0xAAAAAA` alternating pattern for step sequencing.

**FNV-1a content hashing** (`0x4E9B8`): Init `0x811C9DC5`, per byte XOR then multiply `0x01000193`. Used for fast content signature comparison.

#### Stream 1: Content Identity (6 bytes + type_byte → script selection)

The ASIC decrypts the tag and produces a **6-byte content identity** — a 48-bit value that identifies the content experience. The firmware treats this as an **opaque identifier** — no sub-field extraction (no AND-masks, shifts, or modular arithmetic on the bytes). It is used for equality comparison, XOR hashing, and wildcard detection. Two parallel extraction paths exist:

**ROM content identity reader** (`0x13E48`): Calls EM9305 mask ROM function at `0xffdfd164`, which returns a pointer to 6 bytes populated by the ASIC after tag decryption. Assembles into content_lo (u32 LE from bytes[0..3]) and content_hi (u16 LE from bytes[4..5], zero-extended). Called from 9 sites including boot init (`0x27A90`), play engine init (`0x4F93C`), BLE notification builder (`0x118F8`), content hash computation (`0x1A4D8`), and TLV entry handler (`0xEC16`).

**TLV content identity extraction** (`0x4FC58`): Extracts the same 6 bytes directly from the TLV buffer. Two format variants (bit 3 of flag byte): compact reads bytes [1]–[6], extended reads bytes [7]–[12]. Produces the same content_lo/content_hi pair.

**TLV type 0x22 handler** (`0xED74`): Reads a **7-byte record** from decrypted TLV data: `{content_lo(u32), content_hi(u16), type_byte(u8)}`. The **type_byte** (7th byte) is separate from the 6-byte identity — it becomes byte 0 of the PPL event node and serves as the **PPL event subtype** that play.bin scripts match against. Calls `0x6BE40` with event hash `0x4E58710B`, event type ID `0x3B` (59), the 7-byte record, and the old content identity from `0x809430`.

**Tag-change handler** (`0x4F938`): Called when the scan loop detects a new tag. Calls `0x13E48` → `0x4FF58` to update `0x809430`. Also calls `0x4FDA8` (clears cached identity at `0x80D93C`) and sets up 5000ms timers at `0x80EB8C`/`0x80EB90`.

**Content identity writer** (`0x4FF58`): Writes content_lo to `[0x809430]` and content_hi to `[0x809434]`. Called from boot init (`0x27A98`) and tag-change handler (`0x4F950`).

**Content identity register** (`0x809430`): Stores the current content identity — content_lo (u32) at +0, content_hi (u32) at +4. Written by `0x4FF58` during boot and on tag change. Read by all subsequent event builders (timer at `0x50A20`, button at `0x50A94`, content resolver at `0x50FDC`, scan loop at `0x67634`) — this is how a tag scan establishes the content context for all interaction modes.

**PPL XOR key** (`0x80CF28`): The PPL state struct init at `0x12134` computes `content_lo ^ content_hi` and stores it as the first field of the PPL struct at `0x80CF28`. This 32-bit hash key is used by the PPL system for content routing. The init also registers 11 PPL handler entries with IDs {0x48, 0x4C, 0x49, 0x4B, 0x06, 0x05, 0x07, 0x01, 0x02, 0x04, 0x08, 0x47} and ROFS table pointers.

**Decrypted tag content block** (`0x807A60`): 24-byte region storing the full decrypted tag content output (NOT just an FNV hash). Written by `0x1A4C4` → `0x1A516`. Read by BLE register responses (`0x17922`), BLE advertisements (`0x1827A`), tag state notifications (`0x694EC`), and tag scan processing (`0x69B0E`). Zeroed on tag removal (`0x182AE`).

**FNV-1a hashing**: Six FNV-1a hash sites exist in the firmware (init `0x811C9DC5`, multiply `0x01000193`):
- `0x0F114`: 4-byte hash of ASIC register data at `0x801400` → stored at `0x80942C`
- `0x10C5C`: 6-byte hash of content identity at boot → passed to init functions
- `0x1D270`: Generic 8-byte FNV utility
- `0x34928`: Variable-length FNV used by play.bin bytecode interpreter
- `0x4E9AC`: **Play engine bytecode FNV opcode** — scripts can compute FNV-1a hashes at runtime for content matching within play.bin

**How the 6-byte identity participates in script selection:**

The content identity flows into the PPL system through multiple paths — it is NOT merely a change-detection fingerprint:

1. **PPL XOR key**: content_lo ^ content_hi stored at `0x80CF28+0` as the PPL state struct's primary key for content routing
2. **Pool entry matching**: `0x4F97C` writes the 6-byte identity into 19-byte pool entries. The match score (`preset_type << 4 + bonus`: exact=+10, wildcard=+3, mismatch=+2) affects which pool entry wins, influencing the script offset
3. **Script executor**: `0x4F7B4` walks a linked list of pool entries (which contain the identity), accumulates sizes, and selects the script at the target offset
4. **Event dispatchers**: `0x505A4`, `0x505F0`, etc. call `0x6CEC8` to validate play.bin context at `[0x80D948]`, then call `0x50FDC` with the content identity and preset type

The **actual matching logic** — where the content identity or XOR key is compared against PPL preset table params to find the specific script — happens in ROFS-mapped play engine code (memory-mapped from play.bin), which is not visible in the firmware disassembly. The event category hashes passed in r2 (e.g., `0xC47A2B46` for NPM, `0x4E58710B` for tag identity, `0x0BBDA113` for items) identify the event type, not the tag content.

#### Stream 2: Resource References (4 × u16 → bank selection)

A separate TLV record carries resource references for audio and animation banks.

**Tag TLV dispatch** (`0x523E4`): After TLV parsing at `0x4EC58`, dispatches by TLV type field. Type 4 → Identity tag handler chain (`0x47BE8` → callback at `0x5241C`). Type 6 → Item tag handler (`0x4D6B8` → vtable dispatch via `0x801B10` → `0x4D8E4`). Both paths extract 4 × u16 resource reference values from TLV sub-type `0x0008` at `0x52454`.

**Resource reference extraction** (`0x52454`): Reads TLV record with tag byte `0x12` and sub-type `0x0008` (data length = 8 bytes = 4 u16). Range checks use subtract-then-wrap pattern with constant `-3201` (`0xFFFFF37F`):
- value0 (+0x0C): Content ref start (range 6–3200)
- value1 (+0x0E): Content ref end (range value0–3200)
- value2 (+0x10): Bank index (range 0–499)
- value3 (+0x12): Bank reference (range 10–3200)

Packed into 12-byte struct `{u16, u16, u16, u16, u32(=0)}` and dispatched via opcode `0x72` through `0x16B84`. The 3200 limit is a system-wide constant also used as a default config value at `0x807ACC`.

**Opcode 0x72 dispatch** (`0x16B84`): Validates play session via `0x4C1D0`, builds a message with the struct pointer and dispatches to `0x4C630` (play engine message queue). The struct pointer is stored by reference — the data is not copied. The play engine processes opcode 0x72 as event category 0xa.

**Slot table population** (`0x16C80`): Writes audio_bank (u16 at +0) and anim_bank (u16 at +2) to `0x80931C + slot*8`. Called from the message handler chain. Slot index clamped to < 2 (assert at line 0x90). Default values via `0x4D7D4`: audio_bank=0x0640 (1600), anim_bank=0x0780 (1920).

**Slot table layout** at `0x80931C` (8 bytes/entry, 2 slots):

| Offset | Size | Field |
| --- | --- | --- |
| +0 | u16 | audio_bank |
| +2 | u16 | anim_bank |
| +4 | u8 | presence/activation flag |
| +5 | u8 | (unused) |
| +6 | u8 | status byte (set to 3 on removal by `0x4D784`) |
| +7 | u8 | secondary data present flag (from `0x16D68`) |

**Secondary slot data** at `0x80932C` (5 bytes/entry, 2 slots): Written by `0x16D68` from a data table at `[0x80DA10]`. Sets the secondary presence flag at slot+7.

**Item event builder** (`0x4D8E4`): Reads slot+7 to check for secondary data. If present → reads both primary (audio_bank, anim_bank) and all 5 secondary bytes, calls extended dispatch `0x1D798`. If absent → falls back to simple handler `0x4D6FC` which reads only audio_bank and anim_bank, calls `0x1D76C`.

**Item descriptor table** (`0x47A10` → `0x378484`): 9-entry pointer table in firmware const data. Indexes by item type (0–8, clamped): `if r0 >= 9 → return default (0x377F66); else → return *(0x378484 + r0 * 4)`. Used downstream in play engine execution (NOT during TLV parsing).

#### Event Builders and Content Resolution

**Play event message builders** (`0x50A20`, `0x50A94`): Non-tag event builders that check play engine readiness (`0x80D968`) and call content resolver `0x50FDC`. Each hardcodes a preset type in r3: `0x50A20` passes `0x0E` (Timer/idle), `0x50A94` passes `0x10` (Button/shake). After resolving, serialize message with opcode + params, enqueue to play engine event ring buffer via `0x51094`.

**PPL search** (`0x4F97C`): Buffer allocator and content encoder — NOT a PPL table iterator. Computes score `(preset_type << 4) + match_bonus`: +3 if wildcard (all 0xFFFF), +10 if content identity exactly matches previous (XOR == 0), +2 if mismatch. Score bit 0 determines entry size: odd → 13 bytes (wildcard, no identity stored), even → 19 bytes (stores full content identity). Calls `0x4FB20` → `0x4FD50` for pool allocation. The actual PPL preset table matching happens downstream in the play engine (ROFS-mapped code).

**Crash/fault dispatch** (`0x66BF8`): **NOT tag event dispatch** — this is the crash reporting system. Reads error category from fault struct offset 4, dispatches via 8-case jump table to error notification handlers (`0x508C8`, `0x5095C`, `0x50C08`, `0x50B88`). The fault struct at `0x80F470` uses magic `0xDEADDD00`. AUX registers 1024 (ECR), 1027 (ERSTATUS), 1028 (ERET) stored by crash handlers are standard ARC CPU exception registers, not tag data.

**PPL preset resolver** (`0x66A48` / `0x66AC0`): Manages content sequencing from state at `0x80C6C0` (364 bytes). Tracks identity, item, and other event counts separately. Sums all three against a total threshold — when reached, triggers content completion via `0x22D14`. Compares tag content signature at `0x80C808` against current content to decide continue vs switch.

**Content resolution** (`0x40F88`): Resolves ROFS content pointer — maps content reference from tag data to actual data in `play.bin`/`audio.bin`/`animation.bin`.

**Audio output** (`0x407D4` → `0x407F0`): Schedules audio playback — 72-byte blocks (48 bytes audio + parameters) sent to ASIC via SPI. Aligned to 64-sample DMA periods. Audio commands carry bank ID, playback mode (8=trigger), priority, duration, content index.

**LED output** (`0x66864`): 8-case jump table for LED patterns — type 0=LFSR random, 1=`0x0F`, 2=`0x55` alternating, 4=`0xFF` all on, 5=`0x00` all off, 6=`0xF0`, 7=`0xAA` inverse alternating. Fills LED buffer via memset.

**Tag removal handler** (`0x66CD0`): On tag removal, checks elapsed time against 20-tick threshold (~320ms grace period). If within grace window, does nothing (tag may return). After grace period, flushes play buffers via `0x37C08` and stops play engine via `0x6F848`.

**Content signature** (`0x80C808`): Written at `0x24624` from tag TLV data via event structs. Fields:
- `audio_bank` — from slot table → event struct byte[+3]
- `class` — from event struct byte[+4]
- `variant` — from event struct byte[+2]
- `type` — derived from event struct byte[+5]: 1→1, 2→2, 3→3, 4→3
- `position` — derived from type: 0, 1, or 2

Used by PPL resolver at `0x66A48` to compare against current content to decide continue vs switch.

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

61 entries of 8 bytes each: `[type:4][param:4]`. The first 3 entries are preamble/default script references (type=0x0B, values=[80, 64, 96]). The remaining 58 entries map 1:1 to the 58 scripts. The `param` field appears to encode `[content_id:8 (bits 11:4)][slot:4 (bits 3:0)]` — content IDs shared across preset groups link scripts for the same content across interaction modes (e.g., 6 params shared between type 0x03 and type 0x09). The exact matching mechanism between the tag's 48-bit content identity and these param values happens in ROFS-mapped play engine code (not fully traced). Script selection at the preset level is **deterministic** — but a **xorshift32 PRNG** at `0x1E5D2` (parameters 13, 17, 5) seeded by content_lo ^ content_hi generates variation within scripts (see Event Dispatch Table section below).

Six distinct type IDs group content by **interaction mode** — not by tag hardware type:

| Type | Count | Script Indices | Trigger Category | Header Flag |
| --- | --- | --- | --- | --- |
| 0x03 | 16 | #0–#15 | Content group A — currently used by minifig tags (1 PAwR-capable: script 14) | 0x00 |
| 0x06 | 5 | #16–#20 | Content group B — currently used by tile tags | 0x00/0x50 |
| **0x09** | **11** | **#21–#31** | **NPM/proximity reactions** — short reactive scripts triggered by brick-to-brick positioning events | **0x40** |
| 0x0B | 3 | #32–#34 | System/default scripts (startup, transitions) | 0x40 |
| 0x0E | 16 | #35–#50 | Timer/idle ambient play sequences (1 PAwR-capable: script 42) | 0x00/0x50 |
| 0x10 | 7 | #51–#57 | Button/shake responses (1 PAwR-capable: script 54) | 0x50 |

**Note:** Types 0x03 and 0x06 are labelled "Identity" and "Item" in some earlier notes, but this is misleading. The preset type is an **interaction mode slot**, not a tag hardware type. Tag scan (0x03/0x06) establishes content identity at `0x809430`. Timer/idle (0x0E) handles ongoing gameplay. Button/shake (0x10) handles physical interaction. NPM (0x09) handles proximity. System (0x0B) is default. For tag-triggered events, the preset type comes from the tag's encrypted content data — the firmware computes it from the tag payload via a ROM function call. A tile tag could theoretically carry content type 0x03 if programmed that way. For non-tag events, the firmware hardcodes the preset type: timer events → 0x0E, button/shake → 0x10.

**Type 0x09 (NPM/proximity)** scripts are structurally distinct from all other types:
- All 11 have the unique header flag byte `0x40` at script header position 11 (only shared with system type 0x0B)
- 10 of 11 are exactly 101 bytes (the 11th is 111 bytes) — the same template with different audio/animation references
- The `param` values for these scripts are relatively uniform but their purpose is unknown
- These scripts define short reactive behaviours (sounds, LED flashes) that play when another brick is detected nearby

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

The ASIC-decrypted tag payload produces **two separate data streams**:

**Stream 1 — Content Identity (6 bytes + type_byte → script selection):**

A 6-byte opaque content identity extracted via ROM function `0xffdfd164` (or TLV buffer at `0x4FC58`). Packed into content_lo (u32) + content_hi (u16). Plus a **type_byte** (7th byte from TLV type 0x22 handler at `0xED74`) that serves as the PPL event subtype — byte 0 of the PPL event node that scripts match against.

The identity flows into the PPL system: XOR key (content_lo ^ content_hi) at `0x80CF28` as the PPL routing key, pool entry match scoring (exact=+10, wildcard=+3, mismatch=+2) affecting script offset selection, and pool entries carrying the identity through the script executor at `0x4F7B4`. The scan loop at `0x67634` XOR-compares against `[0x809430]` for change detection. The actual matching between the content identity and PPL preset table entries happens in ROFS-mapped play engine code (not visible in firmware disassembly).

**Stream 2 — Resource References (4 × u16 → bank selection):**

A separate TLV record (sub-type `0x0008`, tag byte `0x12`, data length 8):

```
+0x00..+0x07  TLV header (type ID, length, etc.)
+0x08         Tag byte (must be 0x12)
+0x09         Session counter
+0x0A..+0x0B  Sub-type u16 LE (must be 0x0008)
+0x0C..+0x0D  value0: Content ref start (u16 LE, range 6–3200)
+0x0E..+0x0F  value1: Content ref end (u16 LE, range value0–3200)
+0x10..+0x11  value2: Bank index (u16 LE, range 0–499)
+0x12..+0x13  value3: Bank reference (u16 LE, range 10–3200)
```

Extracted at `0x52454`, dispatched via opcode `0x72` (`0x16B84`) through the message queue. The handler chain populates the slot table at `0x80931C` with audio and animation bank IDs, read back by item handler `0x4D6FC`/`0x4D8E4`.

**Script selection** uses the content identity + type_byte (Stream 1), not the 4 u16 resource references. The content identity flows through the PPL system (XOR key at `0x80CF28`, pool entries, match scoring), while the type_byte routes to specific scripts as the event subtype. The 4 u16 values (Stream 2) select which audio/animation banks those scripts use. The **preset type** (0x03, 0x06, etc.) is an interaction mode slot — for non-tag events, the firmware hardcodes the type: timer → 0x0E (`0x50A20`), button/shake → 0x10 (`0x50A94`). The content identity register persists after the tag scan, so all subsequent events reuse the same content context.

Script selection at the preset level is **deterministic** — the content identity + type_byte always maps to the same script. However, a **xorshift32 PRNG** at `0x1E5D2` (seeded by content_lo ^ content_hi at `0x80CF28`) introduces variation **below** the script selection level — generating random bytes dispatched as events (handler ID `0x0F`, type 4) that control which audio clips and LED patterns play within the selected script.

#### Event Dispatch Table (0x37D5A4)

A **38-entry dispatch table** at ROM address `0x37D5A4` (7 bytes/entry, 266 bytes total) drives the play engine's event routing. The dispatch function at `0x18644` processes events from a 2-entry circular ring buffer in the PPL state struct at `0x80CF28`.

**PPL State Struct** at `0x80CF28`:

| Offset | Size | Field |
| --- | --- | --- |
| +0x00 | 4 | XOR key (content_lo ^ content_hi) — also xorshift32 PRNG state |
| +0x04 | 1 | type_A (primary content type) |
| +0x05 | 1 | type_B (secondary content type) |
| +0x08 | 2 | Event ring buffer (2-entry circular) |
| +0x0C | 1 | Ring buffer read pointer |
| +0x0D | 1 | Ring buffer write pointer |
| +0x13 | 1 | Condition flags byte 1 |
| +0x14 | 1 | Condition flags byte 2 |
| +0x15 | 1 | Condition flags byte 3 |

**7-byte entry format:**

| Byte | Field | Description |
| --- | --- | --- |
| [0] | type_A_filter | Primary content type to match (0 = wildcard) |
| [1] | type_B_filter | Secondary type filter (0 = wildcard path, nonzero = strict match both) |
| [2] | event_type | Must exactly match event from ring buffer |
| [3] | target_type / ref_low | Target content type for post-match; also low byte of 16-bit ref |
| [4] | ref_high | High byte of 16-bit reference: `(entry[4] << 8) \| entry[3]` |
| [5] | script_index | Passed directly to `set_script()` at `0x1ED4` (range 0–32) |
| [6] | condition_code | Index into condition evaluator jump table at `0x1BE90` (18 cases, 0 = disabled) |

**Matching algorithm** (at `0x1867C`, loop counter r12 = 0x26 = 38):
1. Read event from ring buffer (masked `& 0x1`)
2. For each of 38 entries (stride 7: `mpy r17,r8,0x7`):
   - entry[2] must match event_type exactly
   - If entry[1] != 0: strict path — both entry[0] == type_A AND entry[1] == type_B required
   - If entry[1] == 0 AND entry[0] == 0: full wildcard (matches any type)
   - If entry[1] == 0 AND entry[0] != 0: match type_A directly, or hierarchy walk (dead code in v0.72.1)
3. On match: evaluate condition via jump table at `0x1BE90` using entry[6]
4. On condition pass: call `set_script(entry[5])` at `0x1ED4`, optionally update type_A/type_B

**Condition evaluator** (`0x1BE90`): 18-case `bih` jump table evaluating PPL state flags:
- 0: always disabled
- 1: `(state[+0x13] & 0x02) >> 1`
- 2: sign bit of state[+0x14]
- 4: `(state[+0x13] & 0x82) == 0x82`
- 5: `!(state[+0x13] & 0x78)` (bits 3–6 clear)
- 7: `(state[+0x13] & 0x01)`
- 8: `(state[+0x15] & 0x02) == 0`

**Post-match processing** (`0x186CE`–`0x18770`): If `ref16 = (entry[4] << 8) | entry[3]` >= 256, calls `content_lookup()` at `0x24F90` to resolve against a **19-entry content lookup table** at `0x37D4C4` (4 bytes/entry: `[typeA][typeB][byte2][byte3]`). Result updates type_A/type_B in the state struct.

**xorshift32 PRNG** (`0x1E5D2`): Mutates the XOR key in-place at `0x80CF28+0` using shifts 13, 17, 5. Generates 3 random bytes dispatched as events (handler ID `0x0F`, type 4). This introduces per-playback variation in audio clip and LED pattern selection **within** the selected script.

**Dead code in v0.72.1:** The hierarchy walk (at `0x186AE`–`0x186BA`) references a table at `0x37D464`, but this address is occupied by BLE GATT attribute definitions in v0.72.1 — the walk always terminates immediately. A secondary table at `0x37D42C` (14 entries, stride 4) is similarly overlapped by BLE data. Both were likely designed for a richer content type tree in earlier firmware or future versions.

#### play.bin Header Validation (0x34530)

At `0x34530`, the firmware validates the play.bin header loaded from ROFS:
1. Checks magic `0x7F PPL` (bytes `7F 50 50 4C`)
2. Validates `num_preset_types == 5` (must be exactly 5)
3. Reads `num_scripts` from header offset 10
4. Copies header fields into PPL runtime state

This confirms the PPL format is tightly coupled to the firmware — a play.bin with a different number of preset types would be rejected.

#### NPM Event → Script Routing

NPM events do **not** arrive via the tag content indexing path above. They enter through the play engine's ring buffer as pre-built events with a fixed content signature hash (`0xC47A2B46`). The routing:

1. NPM event builder at `0x50A94` serializes: type=`0x1E`, sub=`0x1B`, hash=`0xC47A2B46`, state=1(near)/2(far)
2. Ring buffer at `0x80D944` queues the event
3. Dispatcher at `0x52588` calls content hash lookup at `0x1660C` — compares 16-bit content hash from event against session table at `0x80927C`
4. If no active session matches → event silently dropped
5. If matched → routes to session's script via `0x16B64` → `0x4C1D0` (second hash verification against script slot at `0x809270+0xC`)
6. Script handler at `0x4C630` → `0x4C5F4` checks PAwR capability flag (bit 1 at script+40) → state 5 handler at `0x1EE98`

**Scripts must opt in** to NPM events: the PAwR capability flag at byte offset 40 of the script structure must have bit 1 set, AND the running session's content signature must match the NPM event hash. Type 0x09 scripts (with header flag `0x40`) are the designated NPM recipients.

The NPM event hash `0xC47A2B46` does not appear anywhere in play.bin — it is a firmware-level constant. The preset type 0x09 scripts respond to NPM events because the firmware maps incoming NPM protocol events to type 0x09 during script selection, not because the scripts contain the hash.

#### PAwR-Capable Scripts

Only 4 of 58 scripts use distributed execute (handler 21 / PAwR messaging):

| Script | Preset Type | Size (bytes) | Branches | Range Checks | If-Then-Else | Table Lookups |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0x0B | — | — | — | — | — |
| 14 | 0x03 | — | — | — | — | — |
| 42 | 0x0E | 1,564 | 6 | 9 | 17 | 71 |
| 54 | 0x10 | — | — | — | — | — |

Script 42 is the largest and most complex script in the file, and the only type-0x0E (Timer/idle) script with PAwR capability. See [HARDWARE.md](HARDWARE.md) for the inferred X-Wing tag case study.

#### Type-0x0E Script Comparison (Timer/Idle)

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

#### Content Growth Across Firmware Versions

ROFS content extracted from all available firmware images:

| Version | Scripts | Audio Clips | Anim Clips | play.bin | audio.bin | ROFS Decompressed |
| --- | --- | --- | --- | --- | --- | --- |
| v0.46.0 | 53 | 200 | 225 | 14,414 B | 333,404 B | 358,564 B |
| v0.48.2 | 56 | 201 | 227 | 15,500 B | 350,239 B | 376,780 B |
| v0.54.0 | 55 | 188 | 166 | 18,653 B | 146,287 B | 175,764 B |
| v0.65.0 | 52 | 155 | 132 | 20,286 B | 132,824 B | 163,052 B |
| v0.66.1 | 58 | 154 | 135 | 22,690 B | 132,569 B | 165,372 B |
| v0.72.1 | 58 | 154 | 135 | 22,690 B | 132,569 B | 165,372 B |

Between v0.48 and v0.54, audio.bin dropped from 350 KB to 146 KB — the audio format switched from a larger representation to the current synthesizer instruction format. Scripts have been both added and removed across versions (53 → 56 → 55 → 52 → 58). play.bin has grown steadily (14 KB → 23 KB) while audio.bin decreased.

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

NPM (Near-field Positioning/Magnetics) debug strings were stripped by v0.65 but the underlying code is likely still present — the same stripping pattern was observed with the tag subsystem, whose code was confirmed functional in production firmware. `npm_play.cpp` indicates a play engine interface. The NPM subsystem has not been traced in detail in the v0.72.1 disassembly — the function addresses are not yet identified.

Play engine (from dev builds):

```
play_execution.c, play_stack_executor.c, play_engine_message_handler.c,
play_file_resolver.c, play_distributed.c, play_detector.c,
ppl_preset_resolver.c
```

## NPM (Near-field Positioning/Magnetics) System

The NPM subsystem is **fully present and functional** in production firmware v0.72.1, despite having no debug strings (those were stripped between v0.54.0 and v0.65.0). The code handles brick-to-brick magnetic field measurement, 3D pose estimation, and feeding positioning data into the play engine.

### NPM Code Location

All NPM code resides in the magnetics region `0x34D00`–`0x35FFF` (binary offsets), with helpers in `0x1E000`–`0x1E200` and `0x38E00`–`0x39000`. The play engine interface functions are at `0x505F0` and `0x50A94`.

### Complete NPM Function Map

| Address | Name | Description |
| --- | --- | --- |
| `0x1E160` | `npm_init_caller` | Reads coil baseline from `0x8068F0`, passes callback `0x34D78` to `npm_init` |
| `0x1E184` | `npm_measurement_caller` | Subtracts baseline from raw coil values, calls `npm_counter_check` |
| `0x34D38` | `npm_result_callback` | NPM-to-play-engine bridge. On result=1: reads filtered XYZ, sends play event (0x1E/0x1B/0xC47A2B46). On result!=1: sends NPM state event |
| `0x34D80` | `npm_read_filtered_xyz` | Reads filtered XYZ from `0x80389C`/`A0`/`A4`, converts float to fixed-point via `fcvt32` |
| `0x34DAC` | `npm_init` | Stores callback at `0x80DB30`, initializes filter state at `0x80389C`–`A4`, clears counter at `0x801962` |
| `0x34DEC` | `npm_counter_check` | Reads counter from `[0x801962]`, returns true if < 101 (max 100 measurements per cycle) |
| `0x34DFC` | **`npm_process`** | **Main NPM function** (27 float ops). Full pipeline: convert 3 coil halfwords to float, compute magnitude (sqrt(x^2+y^2+z^2)), normalize, scale by 1000, apply IIR filter (alpha=0.5), store results, invoke callback |
| `0x35CD0` | `npm_preprocess` | Large function (r13–r25). Subtracts baseline from `0x808418`/`1C`/`20`, computes difference magnitude, checks threshold 0xB505 (46341), updates state at `0x808600`–`0x808614` |
| `0x35E3C` | `npm_get_state` | Returns `[0x808448]` (NPM processing state) |
| `0x35E48` | `npm_get_mode` | Returns byte at `[0x806C17]` (NPM mode: 0=active, nonzero=inactive) |
| `0x35E54` | `npm_update_state` | Updates state at `0x808448` and `0x808600` |
| `0x35EE0` | `npm_float_convert` | Converts coil measurements to 6 float values (3 components + 3 processed) |
| `0x35F80` | `npm_post_filter` | Post-processing after IIR filter output |
| `0x38EE8` | `npm_pose_change_handler` | Validates XYZ range (±32767). In-range: stores to `0x8068F0`, schedules next measurement (mode 12). Out-of-range: sends play event (0x28/0x1B/0x9153122C) |
| `0x50A94` | `play_event_builder_npm` | Builds NPM play event message with type 0x1E, sub-type 0x1B, hash 0xC47A2B46. Enqueues to play engine ring buffer via `0x51094` |
| `0x505F0` | `play_event_builder_npm_oor` | Builds out-of-range NPM play event (type 0x28, sub-type 0x1B, hash 0x9153122C) |

### NPM RAM Layout

| Address | Size | Contents |
| --- | --- | --- |
| `0x801962` | 2 | Measurement counter (halfword, resets after 100) |
| `0x80389C` | 4 | Filtered X component (IEEE 754 float, IIR output) |
| `0x8038A0` | 4 | Filtered Y component (IEEE 754 float, IIR output) |
| `0x8038A4` | 4 | Filtered Z component (IEEE 754 float, IIR output) |
| `0x8068F0` | 6 | Current NPM measurement (3 signed halfwords: X, Y, Z) |
| `0x806C17` | 1 | NPM mode byte (0=active, nonzero=inactive) |
| `0x808418` | 4 | Baseline X reference (word) |
| `0x80841C` | 4 | Baseline Y reference (word) |
| `0x808420` | 4 | Baseline Z reference (word) |
| `0x808448` | 4 | NPM processing state (0=needs init, nonzero=running) |
| `0x808600`–`0x808614` | 24 | Extended NPM state (6 words: accumulated values for delta processing) |
| `0x80DB30` | 4 | Callback function pointer (set during init) |

### NPM Processing Pipeline

```
ASIC Interrupt (0x336E4)
    |
    | bit 25: magnetics_complete flag set at 0x80DF1C
    | bit 4: magnetics cycle, reads coil state from 0x80DD84
    |
    v
Coil Control (0x33FD0)
    |
    | Configures coil modes via MMIO 0xF0484C
    | Mode > 6: sets magnetics flag 0x809392 (NPM active)
    | Config table at ROM 0x3062E8 (binary 0x62E8)
    |
    v
npm_measurement_caller (0x1E184)
    |
    | Reads 3 raw halfwords from coil hardware
    | Subtracts baseline from 0x8068F0
    |
    v
npm_preprocess (0x35CD0)
    |
    | Computes delta from baseline (0x808418/1C/20)
    | Absolute value comparison against threshold 0xB505
    | Updates running state in 0x808600-0x808614
    |
    v
npm_process (0x34DFC)  *** CORE NPM FUNCTION ***
    |
    | 1. Read 3 signed halfwords (X, Y, Z coil measurements)
    | 2. Check measurement counter at [0x801962] (every 10th sample)
    | 3. Convert to float via fcvt32
    | 4. Compute magnitude: sqrt(x^2 + y^2 + z^2)
    | 5. Normalize: (x/mag, y/mag, z/mag)
    | 6. Scale by 1000.0 (float 0x447A0000)
    | 7. IIR low-pass filter (alpha=0.5, float 0x3F000000):
    |      filtered = old + (old - new) * 0.5
    | 8. Store filtered XYZ to 0x80389C/A0/A4
    | 9. Call callback at [0x80DB30] with result code
    |
    v
npm_result_callback (0x34D38)
    |
    |-- result == 1 (valid measurement):
    |     npm_read_filtered_xyz (0x34D80)
    |       -> reads 0x80389C/A0/A4, converts float->fixed
    |     npm_pose_change_handler (0x38EE8)
    |       -> validates range ±32767
    |       -> stores to 0x8068F0 (current measurement)
    |       -> schedules next measurement cycle (mode 12)
    |     play_event_builder_npm (0x50A94)
    |       -> sends play event: type=0x1E, sub=0x1B
    |       -> FNV-1a hash: 0xC47A2B46
    |       -> enqueues to play engine ring buffer (0x51094)
    |
    |-- out of range:
    |     play_event_builder_npm_oor (0x505F0)
    |       -> sends play event: type=0x28, sub=0x1B
    |       -> FNV-1a hash: 0x9153122C
    |
    v
Play Engine Event Ring Buffer (0x51094)
    |
    v
Play State Machine (0x6F178)
    State 5: "sensor active" — reads sensor signature
    at [0x80D804+6], compares against NPM event content
```

### NPM Play Events

The NPM system generates two types of play events:

| Event | Type | Sub-type | FNV-1a Hash | Meaning |
| --- | --- | --- | --- | --- |
| Valid measurement | `0x1E` | `0x1B` | `0xC47A2B46` | NPM detected valid position/orientation change |
| Out of range | `0x28` | `0x1B` | `0x9153122C` | Coil measurement exceeded ±32767 range |

These events are enqueued via the standard play event message builder pattern (checks BrickNet availability via `0x6CEC8`, initializes session via `0x51078`, matches tag UID via `0x50FDC`, serializes, and enqueues via `0x51094`).

### NPM vs Tag Reading: Coil Modes

The ASIC coil controller at `0x33FD0` distinguishes NPM from tag reading by mode:

- **Modes 0–6**: Tag reading (RFID, tag detection, identity). Magnetics flag `0x809392` is NOT set.
- **Modes > 6**: NPM positioning. Magnetics flag `0x809392` IS set, enabling the NPM measurement pipeline.

The coil configuration table at ROM `0x3062E8` (binary offset `0x62E8`) contains per-mode register values written to MMIO `0xF0484C`.

### v0.54.0 NPM Debug Strings (stripped in production)

Earlier firmware v0.54.0 contains the following NPM debug strings (all absent in v0.72.1):

| Offset (v0.54) | String | Source File |
| --- | --- | --- |
| `0x6EE9C` | — | `rpc_handlers_npm.cpp` |
| `0x6EFF5` | — | `magnetics_helpers.c` |
| `0x6F023` | — | `magnetics_scheduler.c` |
| `0x6F0A0` | "NPM Task Queue is full, cleaning queue" | `npm_play.cpp` |
| `0x6F0C7` | — | `npm_play.cpp` |
| `0x6F0D4` | — | `npm_processing_chain.cpp` |
| `0x6F0F7` | — | `pose_estimator.cpp` |
| `0x6F10A` | — | `pose_tracker.cpp` |
| `0x6F11B` | — | `pose_filter.cpp` |
| `0x6F12B` | — | `ambiguity_filter.cpp` |
| `0x7055C` | "NPM Task (Action = {}, Offset_us = {})" | — |
| `0x706EC` | "NPM Task StartTime is invalid" | — |
| `0x7085F` | "Tag position found" | — |
| `0x70B41` | "Unable to add NPM Task to queue" | — |
| `0x716B5` | — | `magnetics_control.c` |
| `0x71AC0` | — | `npm_engine.cpp` |
| `0x72261` | "NPM reservation duration too short" | — |

### NPM → Play Engine → Script Bytecode

The NPM system feeds positioning data into the play engine via event messages. The play engine's state machine at `0x6F178` processes these events in **state 5** ("sensor active"), comparing the NPM content signature against the current play content. Content matches trigger play continuation; mismatches cause content transitions.

The semantic tree executor does NOT directly read NPM hardware — it operates on pre-computed state buffers populated by the play engine from NPM events. The 5 bytecode bytes that map to opcode 16 (range check signed: `0x18`, `0x21`, `0x27`, `0x30`, `0x5B`) encode different value types for comparing pre-loaded sensor state, not direct hardware sensor IDs. The NPM data enters the script execution context through the play event ring buffer and the sensor monitoring command (play command 5, via `0x4E1BC`).

### Float Math Budget

| Region | Float Ops | Purpose |
| --- | --- | --- |
| `0x34D00`–`0x35FFF` | ~55 | **NPM processing** (magnitude, normalize, IIR filter) |
| `0x41000`–`0x46FFF` | ~745 | Application (NOT NPM — animation interpolation, play engine math) |
| `0x52000`–`0x55FFF` | ~825 | Audio synthesizer |

The NPM processing uses 55 float operations across its function chain, concentrated in `npm_process` (27 ops) and `npm_preprocess` (28 ops). The APP region float math at `0x41000`–`0x46FFF` does NOT reference NPM RAM addresses and is unrelated to positioning.

## Firmware Versions

12+ versions extracted from Unity Addressable asset bundles inside the `split_UnityDataAssetPack.apk` (102 MB) shipped with the LEGO SmartAssist app. Each firmware is embedded as a Unity SerializedFile asset identified by GUID.

The Bilbo backend also has firmware download endpoints (see [BACKEND.md](../notes/BACKEND.md)). The app's update flow reads the brick's current version string from register `0x22`, then calls `GetStateFor(product, version)` with the product name (`AudioBrick`) and version (e.g. `"0.72.1"`). The backend returns the state hash for the target (newer) firmware version. The app then downloads the firmware binary using that target hash via `GetUpdateFor(stateHash)`. The brick's own `UpdateState` register (`0x88`) is not needed — the version string is sufficient.

Debug strings are progressively stripped in later builds — earlier versions (v0.46.0) contain more source filenames than production builds (v0.72.1).

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
