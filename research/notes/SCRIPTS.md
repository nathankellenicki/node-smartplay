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
| 42 | 24 | 1,564 | 10 | 0x00 | **Largest script** — combat orchestrator (see below) |
| 43 | 1228 | 363 | 9 | 0x00 | |
| 44 | 73 | 227 | 8 | 0x00 | |
| 45 | 1484 | 330 | 8 | 0x00 | |
| 46 | 97 | 98 | 7 | 0x50 | |
| 47 | 1868 | 268 | 8 | 0x00 | |
| 48 | 1356 | 770 | 9 | 0x00 | |
| 49 | 116 | 439 | 9 | 0x00 | |
| 50 | 1612 | 634 | 9 | 0x00 | |

Script #42 (1,564 bytes) is the largest script in play.bin and is the **combat orchestrator** — a timer/idle script (type 0x0E) that runs continuously while a PAwR-combat-capable tag is active. Rather than being invoked *in response to* hit events, it polls firmware state variables (hit counter at `0x80CF28+0x12`, flags at `0x80CEBE`, animation pointer at `0x80DA14`, slot arrays at `0x8089FC`) and branches its playback accordingly. Incoming PAwR fire messages update those state variables directly via the hit handlers at `0x18A12`/`0x18A3A`/`0x18AB6` — see the "Combat model" subsection below. Script #36 (1,223 bytes) is the second largest — likely a complex idle sequence with multiple audio/animation branches.

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

## Bytecode Semantics (verified 2026-04-18)

Scripts are **typed record UNPACKERS**, not imperative gameplay bytecode. The interpreter at `0x4B830` takes four arguments:

| Register | Role |
| --- | --- |
| r18 | Input stream reader state (pointer to struct `{pos:u32, ...}` of typed data to parse) |
| r17 | Input stream end pointer (for underflow checks) |
| r15 | Output destination buffer (decoded fields accumulate here) |
| r16 | **Bytecode** position counter (separate from input stream) |
| r19 | `0x37BCF4` — 256-byte opcode translation table |

The dispatch loop reads `byte = TABLE[*r16]`, advances r16, and dispatches to one of 25 handler addresses. Each handler (e.g. `0x51C28` for write_byte) calls `READ_TYPED(r18, r17, expected_tag)` at `0x51F50`, which:

1. Advances the **input stream** r18 by 1 byte to read a msgpack-style type tag
2. Based on tag, reads payload bytes: `0xCC`→u8+1, `0xCD`→u16+2, `0xCE`→u32+4, `0xCF`→f32+4, `0xE1`→raw byte, `0x00`→untyped inline
3. Writes the decoded value to r15 output buffer

**Return codes:** 0=ok, 1=type mismatch, 2=unexpected nil/cond-false, 3=hash mismatch, 4=stream underflow.

**What this means architecturally:**

- The script bytecode is a **schema** describing *what fields* to extract and *in what order*
- The r18 stream holds the **actual data** — decoded from a ROFS record looked up via hash table at `0x37B9A8` (decompressor call to `0x6BE00`)
- The r15 output is a **decoded playback record** (audio refs, LED commands, timer thresholds, bank indices)
- After the interpreter returns, the caller at `0x6BFF8+` invokes a dispatcher callback (`[r13,0x8]` indirect jump) that consumes the output buffer and drives the audio/LED subsystems
- Different scripts for different preset types describe different record schemas; the tag's resource-reference record selects which script (schema) to apply

This reconciles with the xorshift32 PRNG observation: the PRNG is used by the **downstream dispatcher** after parsing, picking among multiple variants encoded in the decoded output record — not during bytecode execution itself.

### Translation Table

The dispatch loop uses a 256-byte translation table at ROM `0x37BCF4` (file offset `0x75CF4`) that maps each byte value to an opcode (1–25, with 0 and >25 indicating operand data).

### Complete Handler Dispatch Table

All 25 handler addresses extracted from the dispatch jump table at `0x4B85E`:

| Opcode | Encodings | Handler | Name | Operand bytes (fixed) |
| --- | --- | --- | --- | --- |
| 1  | 15 | `0x4B8E2` | cond_exec | variable |
| 2  | 8  | `0x4B8EC` | eval_expr | variable |
| 3  | 40 | `0x4B8F8` | write_byte | variable |
| 4  | 24 | `0x4B904` | write_half | variable |
| 5  | 28 | `0x4B910` | write_word | variable |
| 6  | 4  | `0x4B91C` | write_float | variable |
| 7  | 10 | `0x4B928` | write_typed | variable |
| 8  | 25 | `0x4B934` | write_typed2 | variable |
| 9  | 1  | `0x4B940` | op9_write? | variable |
| 10 | 3  | `0x4B94C` | op10_write? | variable |
| 11 | 14 | `0x4B958` | op11_write? | variable |
| 12 | —  | `0x4BC1A` | op12_error | (error branch) |
| 13 | 2  | `0x4B966` | if_then | variable + nested block |
| 14 | 9  | `0x4B992` | if_then_else | variable + nested block |
| 15 | 20 | `0x4B9E0` | counted_loop | 3 (iteration count + range) + nested body |
| 16 | 1  | `0x4BA3A` | op16 | 2 |
| 17 | 5  | `0x4BA74` | op17 | 2 |
| 18 | 0  | `0x4BAB0` | op18 | 2 |
| 19 | 1  | `0x4BAE6` | nested_loop | 2 + nested body |
| 20 | 5  | `0x4BB2A` | nested_stride | 3 + nested body |
| 21 | —  | `0x4BB7A` | bricknet_send | **dead code** — no byte value maps to op21 |
| 22 | 2  | `0x4B8C2` | op22 | 1 |
| 23 | 0  | `0x4BBF0` | op23 | 1 (reads one operand byte) |
| 24 | 0  | `0x4BBFC` | op24 | 2 (reads u16 operand) |
| 25 | 6  | `0x4BC1E` | type_dispatch | 1 (reads type byte at +1) |

**Variable-length opcodes (1-14):** Occupy exactly 1 bytecode byte each. Operand values are read from the SEPARATE r18 data stream, NOT from bytecode. The byte value itself encodes part of the operand selector (40 byte values map to opcode 3 = write_byte; the encoding number distinguishes which variant).

**Fixed-length opcodes (15-25):** Handler explicitly advances bytecode position via `st r0, [r16]` with `add r0, r1, N`. These are block-control opcodes (loops, dispatch, if/else). For `counted_loop` (op15): bytes[1]=count, bytes[2..3]=stride_offset (u16 LE index into table at `0x37BA00`).

**Block opcodes (13, 14, 15, 19, 20, 21):** After consuming their fixed bytecode span, recursively invoke the interpreter to execute a nested body. The body is a sequence of opcodes that follows in bytecode and terminates at the first byte whose table value falls outside 1-25.

**Terminators:** Any byte at an opcode position with `TABLE[byte]` outside 1-25 ends the current block. The dispatch loop at `0x4B850` checks `cmp_s r0, 0x18; bhi → exit` where `r0 = TABLE[byte] - 1`. Both `0` and values `>25` trip this and the interpreter returns 0 to the caller (block complete). Every byte in a script's bytecode is either an opcode byte, a fixed-opcode operand byte, or a terminator.

### Disassembler

A best-effort bytecode disassembler is available at `research/tools/disasm-bytecode.js`:
```bash
node research/tools/disasm-bytecode.js [script_idx]
```

Output for all 58 scripts is pre-generated in `research/analysis/disasm/`. Every script parses with 0 unknowns — the full bytecode round-trips through the opcode model. Example (script #33):

```
# Script #33 — type=sys (0x0b) param=96 size=40
  body:
    0x00c: counted_loop     bytes=[0x11 0xc3 0x68 0x02] count=195 stride_off=0x0268
    0x010:   write_byte     enc#4/39   bytes=[0x10]
    0x011:   counted_loop   bytes=[0x1b 0x08 0xb0 0x11] count=8  stride_off=0x11b0
    0x015:     write_op11   enc#8/13   bytes=[0xd1]
    0x016:     write_word   enc#2/27   bytes=[0x82]
    ...
    0x019:     — term byte=0x35 table=0xf9
```

Nesting is shown through indentation (every block opcode increases depth, every terminator decreases it). Terminators visualize block boundaries but the indentation is a linear approximation — it does NOT reflect the actual recursive execution flow, which is driven by block opcodes' count arguments at runtime.

## Combat model (script #42)

Script #42 does not "react to a hit event" or "fire weapons via bricknet_send" — those are earlier mistaken assumptions that the evidence does not support. Instead:

**Combat is poll-driven, not event-triggered.**

When a PAwR-combat-capable tag is placed, script #42 (type 0x0E, timer/idle) is invoked via the timer fallback table at `0x37D42C` (hardcoded by `0x50A20`). The script then runs continuously — every timer tick re-invokes it — and reads firmware state variables to decide what to output.

When an incoming PAwR fire message arrives, it is handled entirely in C code:

1. Counter logic at `0x1232C` reads the incoming message, increments the byte at `[0x80CF28+0x12]`, and checks against threshold 4.
2. Below threshold: emits event `0x0D` or `0x0E` onto the secondary event queue at `0x80ce9c` (6-byte records).
3. At threshold: sets bit 2 of flags at `[0x80CF28+0x13]` and emits event `0x0F` (explosion) onto the same queue.
4. The secondary dispatcher at `0x187F0` runs handlers for these events:
   - `0x18A12`/`0x18A3A` (hit): update state (animation pointer at `0x80DA14`, slot arrays at `0x8089FC`, flags at `0x80CEBE`) and call play-engine audio entries directly — `0x4B9C` (sound dispatcher), `0x47344`/`0x47124` (play-engine invocation).
   - `0x18AB6` (explosion): calls `0x3314` → `0x165E0` with `r0=3` (the explosion SoundEvent dispatch).

Critically, **none of these handlers invoke a script via `0x6BFFE`** (the only external call site of the interpreter). They play audio/LED synchronously and update state bits. Script #42, running on the next timer tick, observes the state change and produces different output (different decoded playback record → different audio/LED).

**So the answer to "which script plays the hit sound":** none. The hit sound is played directly from the C hit handler. Script #42 orchestrates the *ongoing* combat playback (idle weapon-ready loop, post-hit state, post-explosion state), but the instantaneous hit/explosion audio is not script-produced.

**Why different ships sound different** — same script #42, but the running script reads the active tag's resource-reference record to get `audio_bank_ref` / `animation_bank_ref` values. Different ships have different refs in their records. (The direct play-engine calls from hit handlers also read the same per-tag refs, so hit/explosion sounds likewise vary per ship.)

**Why non-combat tags don't do this** — tags without PAwR-combat resource-reference records don't select script #42 at all, so the timer never invokes it and no combat loop runs. The hit counter still exists in firmware state but nothing reads it.

## Size Statistics

| Metric | Value |
| --- | --- |
| Total play.bin | 22,690 bytes |
| Header + tables | 968 bytes (4.3%) |
| Script data | 21,722 bytes (95.7%) |
| Avg script size | 375 bytes |
| Largest | #42 — 1,564 bytes (combat orchestrator) |
| Smallest | #33 — 40 bytes (system) |

## Extraction

```
node examples/extract-scripts.js <play.bin> [output_dir]
```

Outputs per-script `.bin` (raw) and `.txt` (hex dump + metadata) files organized by type subdirectory, plus `manifest.json`.

## What We Cannot See

- **Input stream contents** — the r18 stream is populated from a hash table lookup at `0x37B9A8` plus decompression at `0x6BE00`. The actual byte layout of the input data (what the decoded record fields MEAN) is defined by the ROFS payload format, which we haven't fully mapped.
- **Audio/animation clip index semantics** — decoded records contain integer indices into banks, but the bank-to-resource mapping lives in play.bin/audio.bin/animation.bin lookup tables.
- **Dispatcher callback** — after the interpreter returns, `[r13,0x8]` is called to consume the output. `r13` holds a context struct we haven't fully typed. Each preset type likely uses a different callback to route the decoded record to the right subsystem.
- **Why op21 exists but is unused** — the handler code for op21 (`bricknet_send`, at `0x4BB7A`, invokes a sub-interpreter at `0x6CEF8`) is fully present in the interpreter, but no byte in the translation table at `0x37BCF4` maps to opcode 21, so it's unreachable from any bytecode. Likely a legacy feature from an earlier design where PAwR sends were script-driven; in v0.72.1 BrickNet messaging happens entirely in C code (firmware functions, not bytecode). The handler is dead code retained for possible future use.

### What We CAN See (with the disassembler)

- **Script structure** — header, sub-header, body layout
- **Opcode sequence** — which opcodes each script uses and in what order
- **Block structure** — loops, if/else branches, nested blocks
- **Script complexity** — counts of each opcode per script
- **Relative comparison** — we can diff scripts to see structural changes (e.g., v0.72.1 vs v0.72.33)
