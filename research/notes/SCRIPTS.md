# Play Scripts — play.bin

> Structure and contents of the PPL (Play Preset Library) file from the ROFS. Contains all 58 play scripts as flat linearized semantic trees executed by the EM9305's bytecode interpreter. See [FIRMWARE.md](FIRMWARE.md) for bytecode encoding details.

## PPL Header

| Offset | Size | Value (v0.72.1) | Description |
| --- | --- | --- | --- |
| 0x00 | 4 | `7F 50 50 4C` | Magic: `\x7F` `PPL` |
| 0x04 | 4 | 1 | Version |
| 0x08 | 2 | 5 | Number of preset types |
| 0x0A | 2 | 58 | Number of script blocks |

Firmware validates at `0x34530`: magic must be `\x7F PPL`, num_preset_types must equal 5.

## Preset Table (offset 0x10)

61 entries × 8 bytes: `[type:u32][param:u32]`. First 3 entries are system defaults (type 0x0B, params 80/64/96). Remaining 58 map 1:1 to scripts. The `param` field is the matching key — tag resource reference `content_ref` values match against params to select scripts.

### Preset Types

| Type | Name | Scripts | Indices | Trigger |
| --- | --- | --- | --- | --- |
| 0x03 | Identity | 16 | #0–#15 | Tag scan (minifig placement) |
| 0x06 | Item | 5 | #16–#20 | Tag scan (tile placement) |
| 0x09 | NPM | 11 | #21–#31 | Brick-to-brick proximity |
| 0x0B | System | 3 | #32–#34 | Startup, transitions |
| 0x0E | Timer | 16 | #35–#50 | Idle/ambient play |
| 0x10 | Button | 7 | #51–#57 | Shake/button interaction |

Types 0x03/0x06 are triggered by tag scan. Types 0x0E/0x10 are hardcoded by firmware (`0x50A20` for timer, `0x50A94` for button). Type 0x09 is routed from NPM proximity events. Type 0x0B is system default.

## Script Directory (offset 0x1F8)

58 entries × 8 bytes: `[offset:u32][size:u32]`. Offsets are from the start of play.bin. Scripts are stored consecutively starting at offset `0x3C8`.

## Script Block Format

Each script starts with an 8-byte header + 4-byte sub-header:

```
[size:u16 LE][01 04 00 01 02 03]    — 8-byte header (size echoed, constant preamble)
[00][10][child_count][flags]         — 4-byte sub-header (root node)
```

Child count ranges from 6 to 11. Flags:

| Flag | Meaning | Scripts |
| --- | --- | --- |
| 0x00 | Standard | Most identity, item, timer scripts |
| 0x40 | NPM/system mode | All NPM (#21–#31), system (#32–#33) |
| 0x50 | Special capability | Some identity, item, timer, button scripts |
| 0x60 | (rare) | — |

## All 58 Scripts

### Identity Scripts (type 0x03) — Tag Scan Response

| # | Param | Size | Children | Flags | Notes |
| --- | --- | --- | --- | --- | --- |
| 0 | 1168 | 110 | 8 | 0x00 | |
| 1 | 256 | 754 | 9 | 0x00 | |
| 2 | 1152 | 181 | 8 | 0x00 | |
| 3 | 1024 | 71 | 7 | 0x50 | Smallest identity script |
| 4 | 304 | 381 | 8 | 0x00 | |
| 5 | 64 | 252 | 11 | 0x00 | |
| 6 | 1104 | 464 | 9 | 0x00 | |
| 7 | 432 | 689 | 9 | 0x00 | |
| 8 | 72 | 760 | 11 | 0x00 | |
| 9 | 4 | 529 | 8 | 0x00 | |
| 10 | 384 | 789 | 9 | 0x00 | |
| 11 | 400 | 679 | 9 | 0x00 | |
| 12 | 336 | 249 | 9 | 0x00 | |
| 13 | 272 | 553 | 10 | 0x00 | |
| 14 | 264 | 702 | 11 | 0x00 | PAwR-capable |
| 15 | 288 | 964 | 9 | 0x00 | Largest identity script |

### Item Scripts (type 0x06) — Tag Scan Response

| # | Param | Size | Children | Flags | Notes |
| --- | --- | --- | --- | --- | --- |
| 16 | 1448 | 350 | 8 | 0x00 | |
| 17 | 68 | 264 | 8 | 0x00 | |
| 18 | 1192 | 746 | 9 | 0x00 | Largest item script |
| 19 | 1296 | 138 | 8 | 0x00 | |
| 20 | 1128 | 783 | 9 | 0x00 | |

### NPM Scripts (type 0x09) — Brick-to-Brick Proximity

| # | Param | Size | Children | Flags | Notes |
| --- | --- | --- | --- | --- | --- |
| 21 | 384 | 101 | 7 | 0x40 | Template |
| 22 | 448 | 111 | 7 | 0x40 | Slightly larger variant |
| 23 | 336 | 101 | 7 | 0x40 | Template |
| 24 | 400 | 101 | 7 | 0x40 | Template |
| 25 | 288 | 101 | 7 | 0x40 | Template |
| 26 | 272 | 101 | 7 | 0x40 | Template |
| 27 | 320 | 101 | 7 | 0x40 | Template |
| 28 | 416 | 101 | 7 | 0x40 | Template |
| 29 | 480 | 101 | 7 | 0x40 | Template |
| 30 | 352 | 101 | 7 | 0x40 | Template |
| 31 | 256 | 101 | 7 | 0x40 | Template |

10 of 11 are exactly 101 bytes — same template with different audio/animation references. Short reactive behaviours (sounds + LED flash on proximity detection).

### System Scripts (type 0x0B)

| # | Param | Size | Children | Flags | Notes |
| --- | --- | --- | --- | --- | --- |
| 32 | 64 | 402 | 7 | 0x40 | Startup sequence |
| 33 | 96 | 40 | 6 | 0x40 | Smallest script in play.bin |
| 34 | 80 | 90 | 7 | 0x50 | Transition |

### Timer Scripts (type 0x0E) — Idle/Ambient Play

| # | Param | Size | Children | Flags | Notes |
| --- | --- | --- | --- | --- | --- |
| 35 | 266 | 240 | 8 | 0x00 | |
| 36 | 82 | 1,223 | 9 | 0x00 | **2nd largest** — complex idle sequence |
| 37 | 101 | 238 | 8 | 0x00 | |
| 38 | 118 | 161 | 8 | 0x00 | |
| 39 | 96 | 535 | 9 | 0x00 | |
| 40 | 302 | 554 | 9 | 0x00 | |
| 41 | 1068 | 242 | 8 | 0x00 | |
| 42 | 24 | 1,564 | 10 | 0x00 | **Largest script — PAwR combat** |
| 43 | 1228 | 363 | 9 | 0x00 | |
| 44 | 73 | 227 | 8 | 0x00 | |
| 45 | 1484 | 330 | 8 | 0x00 | |
| 46 | 97 | 98 | 7 | 0x50 | |
| 47 | 1868 | 268 | 8 | 0x00 | |
| 48 | 1356 | 770 | 9 | 0x00 | |
| 49 | 116 | 439 | 9 | 0x00 | |
| 50 | 1612 | 634 | 9 | 0x00 | |

Script #42 (1,564 bytes) is the largest script in play.bin — PAwR combat mode with BrickNet messaging (opcode 21). Script #36 (1,223 bytes) is the second largest — likely a complex idle sequence with multiple audio/animation branches.

### Button Scripts (type 0x10) — Shake/Button Response

| # | Param | Size | Children | Flags | Notes |
| --- | --- | --- | --- | --- | --- |
| 51 | 104 | 233 | 8 | 0x00 | |
| 52 | 72 | 103 | 7 | 0x50 | |
| 53 | 112 | 69 | 7 | 0x50 | |
| 54 | 80 | 551 | 11 | 0x00 | Largest button script |
| 55 | 88 | 159 | 8 | 0x00 | |
| 56 | 64 | 501 | 11 | 0x00 | |
| 57 | 96 | 239 | 8 | 0x00 | |

## Param Cross-References

Some params are shared across preset types, linking scripts for the same content across interaction modes. A tag carrying multiple resource reference records uses these shared params to select one script from each type:

| Param | Identity | Timer | Button | NPM |
| --- | --- | --- | --- | --- |
| 64 | #5 | — | #56 | — |
| 72 | #8 | — | #52 | — |
| 96 | — | #39 | #57 | — |
| 256 | #1 | — | — | #31 |
| 272 | #13 | — | — | #26 |
| 288 | #15 | — | — | #25 |
| 304 | #4 | — | — | — |
| 336 | #12 | — | — | #23 |
| 384 | #10 | — | — | #21 |
| 400 | #11 | — | — | #24 |
| 432 | #7 | — | — | — |

## Bytecode Encoding

Table-driven: a 256-byte translation table at ROM `0x37BCF4` maps each byte to an opcode handler (0–24). Multiple byte values encode the same opcode — the byte itself carries implicit operand data.

| Opcode | Encodings | Name | Description |
| --- | --- | --- | --- |
| 1 | 15 | cond_exec | Conditional execute |
| 2 | 8 | eval_expr | Evaluate expression |
| 3 | 40 | write_byte | Write byte value |
| 4 | 24 | write_half | Write halfword (u16) |
| 5 | 28 | write_word | Write word (u32) |
| 6 | 4 | write_float | Write float32 |
| 7 | 10 | write_typed | Write typed value |
| 8 | 25 | write_typed2 | Write typed value (variant) |
| 13 | 2 | if_then | If-then branch |
| 14 | 9 | if_then_else | If-then-else branch |
| 15 | 20 | counted_loop | Counted loop |
| 19 | 1 | nested_loop | Nested loop |
| 20 | 5 | nested_stride | Nested loop with stride |
| 21 | — | bricknet_send | PAwR message send (`0x6CEF8`) |
| 25 | 6 | type_dispatch | Type dispatch |

Byte values mapping to handler IDs > 25 are inline operand data consumed by the preceding opcode.

## Size Statistics

| Metric | Value |
| --- | --- |
| Total play.bin | 22,690 bytes |
| Header + tables | 968 bytes (4.3%) |
| Script data | 21,722 bytes (95.7%) |
| Avg script size | 375 bytes |
| Largest | #42 — 1,564 bytes (PAwR combat) |
| Smallest | #33 — 40 bytes (system) |

## Extraction

```
node examples/extract-scripts.js <play.bin> [output_dir]
```

Outputs per-script `.bin` (raw) and `.txt` (hex dump + metadata) files organized by type subdirectory, plus `manifest.json`.

## What We Cannot See

- **Bytecode disassembly** — without the 256-byte translation table extracted from ROM, we cannot decode individual instructions. The table at `0x37BCF4` (firmware file offset `0x75CF4`) maps byte values to opcode handlers.
- **Audio/animation clip references** — scripts reference audio clips and animation banks by index, but the inline encoding is not decoded. Identifying which clips a script triggers requires either bytecode disassembly or correlating script params with tag resource reference records.
- **Sensor thresholds** — scripts encode accelerometer/timer thresholds inline, but we cannot extract them without bytecode decoding.
- **PAwR combat protocol** — script #42 uses opcode 21 (bricknet_send) for brick-to-brick messaging, but the message format is encoded in the script data.
