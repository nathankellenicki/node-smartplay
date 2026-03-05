# LEGO Smart Play — Hardware

> Sourced from firmware binaries, APK decompilation, teardown photos ([r/LegoSmartBrick](https://reddit.com/r/LegoSmartBrick)), and [Wired](https://www.wired.com/story/exclusive-inside-look-at-new-lego-smart-brick/). May contain errors.

## Chipset

Two main ICs identified from teardown photos:

| Chip | Marking | Role |
| --- | --- | --- |
| **Custom LEGO ASIC** | `DA000001-01` / `DNP6G-010` / `20043-014` | 4.1mm mixed-signal ASIC — coil control (tag reading, wireless charging, brick-to-brick positioning), LED array, sensors, analog synthesizer |
| **EM9305** | `EM9305` / `1055X` / `810300` | EM Microelectronic BLE 5.4 SoC — 32-bit ARC CPU, 512KB flash, I2S/SPI/I2C. Handles BLE (app GATT connection, PAwR play communication) |

The EM9305 is the main processor — firmware is raw ARC machine code (~499KB) with the full Cordio BLE stack. The `EM` in `P11_audiobrick_EM-v2.29.0` refers to EM Microelectronic. The ASIC handles analog (coils, sensors, audio); the EM9305 handles digital (BLE, play engine, application logic).

- **BLE Stack:** Arm Cordio / Packetcraft (originally Wicentric "exactLE")
- **Product ID:** `P11_audiobrick`

"exactLE" is encoded in the WDX UUID base: `005fXXXX-2ff2-4ed5-b045-4C7463617865` — trailing bytes `4C7463617865` = "LtcaxE" ("ExactL" reversed).

## Features

- Speaker with volume control (Low/Medium/High)
- Microphone for audio input (streams mic samples)
- LED array
- Accelerometer, light sensors, sound sensor
- Analog synthesizer
- Rechargeable battery with wireless charging (via coils)
- BLE 5.4 with PAwR support (via EM9305)
- On-device ROFS filesystem
- Near-field magnetic tag reader (Smart Tiles / Smart Minifigs)

## Smart Tags

Smart Tiles and Smart Minifigs use passive **ISO/IEC 15693** RFID (13.56 MHz). The ASIC reads them via copper coils — the same coils handle wireless charging and brick-to-brick positioning.

### NFC Scan

Readable by a phone NFC reader, but memory is not accessible over standard 15693 commands — the ASIC uses **proprietary read commands**. Example scan (NXP TagInfo):

| Field | Value |
| --- | --- |
| UID | `E0:16:5C:01:1D:37:E8:50` |
| Technology | ISO/IEC 15693 |
| IC Manufacturer | Unknown (code `0x16`) |
| Memory | 0 bytes (not readable over standard 15693) |

`E0` is the ISO 15693 flag byte. Byte 2 (`0x16` = 22) is the IC manufacturer code — unknown vendor, likely custom silicon.

LEGO calls this "near-field magnetic communication". They claim the brick can detect which face a tag is on with millimeter precision (**NFC positioning** — per Wired article, not independently verified).

### Tag Types

| Type | Description |
| --- | --- |
| **Identity** | Smart Minifigs — character identity |
| **Item** | Smart Tiles — content selector that tells the brick which play script to run |

### Tag Data Format

Reconstructed from firmware debug strings (v0.46–v0.54) and disassembly of production firmware (v0.72.1). The ASIC reads tag data via proprietary ISO 15693 commands and passes it to the EM9305 over SPI.

```
Tag Response (from ASIC via SPI):
┌──────────────────────────────────┐
│ Flag Byte (1 byte)               │  Bit 0 = error, bit 3 = format variant
├──────────────────────────────────┤
│ Tag UID (8 bytes, 64-bit)        │  ISO 15693 UID: E0:16:XX:XX:XX:XX:XX:XX
├──────────────────────────────────┤
│ Tag Status                       │  "tag_sta" — referenced in CRC error path
├──────────────────────────────────┤
│ Checksum (4 bytes, CRC32)        │  Over tag data
├──────────────────────────────────┤
│ Tag Type                         │  Identity (minifig) or Item (tile)
├──────────────────────────────────┤
│ Security Format + Info           │  Variable length, multiple formats supported
│ (format byte + security data)    │  CRC + proprietary validation (not crypto)
├──────────────────────────────────┤
│ Content Data (variable length)   │  Play content — see below
├──────────────────────────────────┤
│ Position Data                    │  Axis + position on brick surface
│ (from inventory result)          │  Multi-axis coil sensing
└──────────────────────────────────┘
```

The UID is extracted by the firmware from the SPI response with two parsing paths depending on flag byte bit 3 (standard vs compact format). Six bytes are assembled into two 32-bit words.

### Tag Content Data

The tag carries **content identifiers**, not play logic. There is no lookup table mapping tag UIDs to content — instead, the tag's content fields tell the firmware which pre-existing assets to load from the ROFS. All actual play logic (sensor conditions, branching, state machines, PAwR messaging) lives in `play.bin` on the brick. The tag selects three independent things:

1. **Script** (from `play.bin`) — which behavioral logic to run (e.g., react to motion, fire on color, PAwR combat)
2. **Audio bank** (from `audio.bin`) — which set of sounds to play (e.g., swoosh, laser, explosion)
3. **Animation bank** (from `animation.bin`) — which LED patterns to use

This means different tags can share the same script but produce completely different experiences by referencing different audio and animation banks. For example, two vehicle tags could both use the same combat script (motion reactivity, color sensor firing, PAwR hit counting, damage progression) but with entirely different engine sounds, firing sounds, explosion effects, and LED patterns.

After validation, the firmware reads content from the parsed tag event struct:

| Offset | Size | Purpose |
| --- | --- | --- |
| 4 | 4 bytes | **Event type** (determines dispatch path) |
| 8 | 4 bytes | **Content reference** (identity) or **audio bank + class + variant** (item) |
| 9 | 1 byte | Content class (item tags, masked with `bclr 0x5` to ignore bit 5) |
| 10 | 1-2 bytes | Content variant (item tags) |
| 12 | 4 bytes | Extra parameter (both tag types) |
| 16 | 4 bytes | Extended data (item tags, content types 3/4) |
| 20 | 4 bytes | Extended data (item tags only) |

Identity tags (minifigs) carry a simple 32-bit content reference at offset 8. Item tags (tiles) carry significantly more data across offsets 8–20, specifying audio bank, content class, variant, and type.

### Tag Event Types

The event type at offset 4 determines how the firmware processes the tag:

| Type | Magic ID | Description |
| --- | --- | --- |
| 1 | `0xA7E24ED1` | Identity tag placed (minifig) |
| 2 | `0x0BBDA113` | Item tag placed (tile) — extended content params |
| 3 | `0x812312DC` | Play command |
| 4 | `0x814A0D84` | Distributed play (triggers PAwR multi-brick session) |
| 5 | `0xA7E24ED1` | Identity alias |
| 6 | `0xE3B77171` | Status/position event |
| 7–8 | `0xA7E24ED1` | Tag presence update |

The magic IDs are message type identifiers passed to the play engine to distinguish event kinds.

### Tag Removal

Tag removal is **not instant**. The firmware has a 20-tick grace period (~320ms at 62.5 Hz). If the tag returns within that window, playback continues uninterrupted. After the grace period, the play engine stops and flushes buffers.

### Tag Security

Multi-layer validation, **not crypto-based** (no AES/HMAC/signature in tag context — those are only used for BrickNet session encryption):

1. **CRC32 check** over tag data
2. **Security format validation** — multiple formats supported, format-dependent length
3. **Security info validation** — presence and length checks
4. **Payload verification** — content integrity check
5. **Final verification** — overall tag accepted or rejected

### Tag Reading Pipeline

The copper coils are time-multiplexed between tag reading, wireless charging, brick-to-brick positioning (NPM), and audio. The magnetics scheduler allocates "tag slots" at microsecond precision. Tag reading yields to audio playback.

```
1. ASIC detects tag in field (interrupt bit 21 at 0xF00860)
2. Magnetics scheduler allocates tag time slot
3. Inventory scan per axis — ISO 15693 anti-collision resolves multiple tags
4. Full read by tag ID via proprietary 15693 command
5. SPI transfer: ASIC → EM9305
6. UID extraction from SPI response (flag byte determines format)
7. Compare against stored UID at 0x809430 (same tag / new tag / removed)
8. Parse: extract checksum, type, security, content fields
9. Verify: CRC → security format → security info → payload
10. Tag DB: add/remove, duplicate detection, slot limits
11. Tag claiming: prevents multiple bricks claiming same tag
12. Content loading: tag type → play.bin lookup → play engine starts
13. Event dispatch: 8-case jump table at 0x66BF8 triggers play content
```

Tag polling runs on a **600ms timer** — the ASIC periodically scans for tag presence.

### Tag Discovery (BLE Interface)

Tag events are exposed over BLE via WDX registers (`rpc_handlers_tag_int.c`). The app can subscribe to tag events, receiving notifications for tag placement, removal, and state changes. Tag discovery has an enable flag and subscriber count.

### Firmware Sources

From debug strings in development builds:

```
tag_asic.c, tag_message_parser.c, tag.c, tag_db.c,
tag_claim.c, tag_manager_impl.c (→ tag_manager.c in v0.54+),
rpc_handlers_tag_int.c
```

Debug strings were stripped in production (v0.65+) but all functional code is present — confirmed by SPI register accesses, tag UID comparison logic, interrupt handlers, and the 8-case event dispatch jump table in v0.72.1.

## Play Engine

Three-layer execution system that turns tag data into audio, LED, and inter-brick behaviour. See [FIRMWARE.md](FIRMWARE.md) for function addresses and disassembly details.

### Architecture Model

The firmware is a **generic play engine** — it doesn't know what an X-Wing, a castle, or a spaceship is. It provides:

- A **144-opcode software synthesizer** for audio generation
- A **25-opcode semantic tree executor** for reactive scripting
- A **PPL state machine** for content sequencing
- **Sensor reading** (accelerometer, light/color, sound)
- **PAwR messaging** for inter-brick communication

All specific behaviour lives in the **ROFS content files** (`play.bin`, `audio.bin`, `animation.bin`), not in the firmware code. The tag is a **parameterized content selector** — its content fields (audio bank, class, variant, type) index into `play.bin` to select which script runs. The firmware resolves the tag's content reference to a specific script node, then the semantic tree executor runs that script reactively against sensor input.

```
Smart Tag (content selector)
  ↓ content class + variant → selects script from play.bin
  ↓ audio bank             → selects sounds from audio.bin
  ↓ animation bank         → selects LED patterns from animation.bin
ROFS content
  ↓ script = reactive logic (sensor conditions, branching, PAwR, state machines)
  ↓ audio  = synthesizer instructions for ASIC
  ↓ animation = LED timing/pattern data
Firmware engine (generic)
  ↓ executes script, reads sensors, drives output
Hardware (ASIC speaker, LEDs, PAwR radio)
```

Different tags can share the same script but reference different audio and animation banks, producing different sounds and LED patterns with identical gameplay behaviour.

### Execution Pipeline

```
Tag content data
  → Tag event dispatch (8-case jump table, routes by event type)
  → Play event message builder (serializes event + params to ring buffer)
  → PPL preset resolver (tracks tag counts, manages content switching)
  → Play event handler (resolves ROFS content, starts engine)
  → Semantic tree executor (processes play.bin script nodes)
  → Play/animation engine (144-opcode synthesizer, drives audio + LEDs)
  → ASIC output (audio via DA000001-01 speaker, LED array)
```

### Sensor Input

All sensors are read by the ASIC via time-multiplexed copper coils and passed to the EM9305 as interrupt-driven SPI transfers. There is no separate sensor API — sensor values land in RAM and the semantic tree executor reads them directly through its typed value system.

| Sensor | Hardware | How It Reaches the Play Engine |
| --- | --- | --- |
| Accelerometer | ASIC coils + ADC | Interrupt at `0xF00860` → SPI → play detector state at `0x80D9D0` |
| Light / color | ASIC coils + ADC | Same path — ASIC analog config via `0xF00A84` modes `0x8`/`0x100`/`0x200` |
| Sound | Microphone + ADC | Same interrupt path |

The magnetics scheduler at `0x801BE8` time-multiplexes the coils between tag reading, wireless charging, positioning, and sensor measurement. Sensor readings become part of the runtime state that play scripts evaluate via condition opcodes.

### Reactive Scripting

Play scripts in `play.bin` are **reactive programs** — they continuously evaluate sensor conditions and produce audio/LED/PAwR output. The semantic tree executor has a full type system (81-entry type resolver) supporting bytes, unsigned, signed, floats, and condition values. Sensor thresholds are encoded inline in the script data.

**Example: motion-triggered sound (X-Wing swoosh)**
```
Semantic tree: opcode 13 (if-then)
  → opcode 16 (range check): is acceleration between X and Y?
  → then-branch: opcodes 3–12 write audio command → swoosh sound
```

**Example: color-triggered action (laser fire on red)**
```
Semantic tree: opcode 14 (if-then-else)
  → opcode 18 (equality check): is color value == RED?
  → then-branch: laser sound + LED flash + opcode 21 (PAwR broadcast)
  → else-branch: skip (idle animation)
```

**Example: distributed play (laser hits remote brick)**
```
Semantic tree: opcode 21 (distributed execute)
  → if value == 2 (multi-brick content): serialize 16 bytes of tree state
  → send via BrickNet transport → PAwR broadcast to nearby bricks
  → remote brick deserializes → PPL counter increments → state transition
```

Opcodes 16–18 (range check clamped, range check signed, equality check) are the comparison primitives. They read typed values from the script stream — inline literals, 2-byte values, 3-byte signed, or 5-byte floats — and compare against sensor readings.

### PPL — Play Preset Language

The PPL state machine manages content sequencing and completion. State at `0x80C6C0` (364 bytes):

| Field | Offset | Description |
| --- | --- | --- |
| State | 0x00 | 0=idle, 1=playing, 2=loading, 3=waiting, 4=error |
| Total needed | 0x02 | Number of tag events needed to complete preset |
| Step counter | 0x04 | Current step in the preset sequence |
| Identity count | 0x06 | Number of identity (minifig) tag events received |
| Item count | 0x08 | Number of item (tile) tag events received |
| Other count | 0x0A | Number of other events received |

A preset can require a **mix of identity and item tags** to complete — all three counts are summed against the total. The content signature at `0x80C808` (audio bank, content class, variant, type, position) determines whether a new tag matches the current preset or triggers a content switch.

### Play State Machine

A 9-state machine at `0x80D804` tracks immediate play behaviour, working alongside the PPL counters. The counter at offset `+0xA` drives progressive state transitions for gameplay like hit counting.

| State | Behaviour | Transition |
| --- | --- | --- |
| 0 | Idle | Tag placed → state 2 |
| 2 | Active play (sensors monitored, audio playing) | First hit → LED flash, stay in state 2; second hit → state 3 |
| 3 | Content iteration (alarm sounds, warning LEDs) | Loops through content records; PPL threshold reached → state 4 |
| 4 | Event processing (reset executor) | Cleanup → state 5 or completion |
| 5 | Sensor active (monitoring content signature match) | Match → continue; mismatch → state 3 |
| 7 | Conditional reset | Reset play engine → idle |

**Two interlocking counter systems** drive progressive gameplay:

1. **Play state counter** at `0x80D804+0xA` — controls **immediate** state transitions (idle → first hit → alarm). Counter = 1 triggers an LED flash. Counter > 1 triggers state 3 (content iteration / alarm).

2. **PPL "other" counter** at `0x80C6C0+0xA` — counts PAwR hit events from other bricks. When `identity + item + other >= total_needed`, the preset completes. PPL state 4 triggers the "destroyed" audio (bank from `[0x80C8B8]`, value 261) and resets the experience.

**Example: X-Wing damage progression**
```
Tag placed → PPL: state=playing, total_needed=N
  → PAwR hit #1: LED flash, play state counter=1
  → PAwR hit #2: state 3, alarm sounds + warning LEDs
  → PAwR hits continue: PPL other_count accumulates
  → PPL sum >= total_needed: "destroyed" audio + explosion LEDs
  → PPL reset → ready for re-engagement
```

### Semantic Tree Executor

Processes `play.bin` scripts as a **flat linearized tree**. 25 opcodes (1-based), recursive — opcodes 13–15, 19–21 call the executor again with the same state.

The bytecode uses a **table-driven encoding** — a 256-byte translation table maps each byte value to an opcode handler. Multiple byte values encode the same opcode, with the specific byte carrying implicit operand data. For example, opcode 3 (write byte) has 40 different encodings. This makes the scripts very compact.

| Opcode | Category | Description |
| --- | --- | --- |
| 1–2 | Control | Conditional execute, evaluate expression |
| 3–12 | Data | Write byte / halfword / word / float / typed values to output buffers |
| 13–14 | Control | If-then, if-then-else blocks |
| 15, 19–20 | Loop | Counted loops, nested loops with stride |
| 16–18 | Compare | Range check (clamped), range check (signed), equality check |
| **21** | **Network** | **Distributed execute** — if value==2, sends via BrickNet (`0x6CEF8`); otherwise executes locally |
| 23–24 | Param | Read 1-byte or 2-byte parameter, then recurse |
| 25 | Typed | Type dispatch (1/2/4/8/129/130/132/136) to different write functions |

Opcode 21 is how play scripts drive multi-brick behaviour — it evaluates a condition and either executes locally or serializes the current tree state and sends it over PAwR to another brick.

### Play/Animation Engine

A **software analog synthesizer** with 144 opcodes, operating on 64-sample single-precision float blocks. 6 playback channels, each with play step, sub-step, flags, repeat count, priority, duration, and content index.

**Opcode categories:**

| Category | Examples |
| --- | --- |
| **Oscillators** | Sine wave generation via 512-entry lookup table |
| **Filters** | IIR lowpass/highpass, biquad filters |
| **Envelopes** | Crossfade `(1-t)*a + t*b`, exponential decay |
| **Mixing** | Add, subtract, multiply, modulate |
| **Pitch** | Phase accumulation for frequency control |
| **Math** | Fast reciprocal (Newton-Raphson), division, normalization |

Play instructions are 16-bit words — bits 0–14 encode the opcode, followed by 0–N 16-bit operands (count from a per-opcode table). The operands are offsets into per-channel data buffers.

### LED Output

8 pattern types via a jump table:

| Type | Pattern | Description |
| --- | --- | --- |
| 0 | LFSR | Pseudo-random from seed |
| 1 | `0x0F` | Bottom 4 LEDs |
| 2 | `0x55` | Alternating / checkerboard |
| 4 | `0xFF` | All on |
| 5 | `0x00` | All off |
| 6 | `0xF0` | Top 4 LEDs |
| 7 | `0xAA` | Inverse alternating |

### Audio Output

Audio is **procedurally generated**, not played back from recordings. The `audio.bin` clips contain synthesizer instruction sequences for the ASIC's analog synthesizer. Audio flows from the play engine through:

1. Content resolution — resolves ROFS pointer to `audio.bin` synthesizer instructions
2. Audio command message — bank ID, playback mode, priority, duration, content index
3. Audio scheduling — configures playback parameters
4. ASIC output — 72-byte blocks (48 bytes audio + parameters) sent to the DA000001-01 via SPI, aligned to 64-sample DMA periods

154 audio clips across 3 banks, with format codes indicating different synthesizer modes (short effects, speech/dialogue, music/intro tracks).

## On-Device Content

Read-only filesystem (ROFS) in the firmware's second segment (zlib-compressed, 94 KB → 165 KB). Header: `ROFS` magic, version 1, CRC32, 4 files. See [FIRMWARE.md](FIRMWARE.md) for full ROFS structure and play.bin format.

| File | Magic | Size (v0.72.1) | Contents |
| --- | --- | --- | --- |
| `play.bin` | `7F PPL` | 22,690 bytes | Play Preset Library — 5 presets, 58 script blocks, table-driven bytecode |
| `audio.bin` | `7F AAP` | 132,569 bytes | Audio Assets Pack — 3 banks, 154 clips of **synthesizer instructions** (not PCM audio) |
| `animation.bin` | `7F ANI` | 9,407 bytes | Animation data — 9 banks, 135 LED animation clips with float32 timing values |
| `version.txt` | (text) | 17 bytes | Version string `"0.72.1"` |

All three binary files use an ELF-inspired magic: `0x7F` followed by a 3-character type identifier.

The firmware is a **generic engine**. All specific play behaviour (X-Wing swooshes, laser sounds, hit counting, explosion sequences) is encoded in `play.bin` as reactive scripts. The firmware provides the execution machinery (synthesizer, semantic tree executor, PPL, sensor reading, PAwR messaging) but has no knowledge of specific play experiences. The `audio.bin` clips are not PCM recordings — they are **synthesizer instruction sequences** for the ASIC's analog synthesizer, meaning all audio is generated procedurally.

Content is **not indexed by tag ID**. Tags carry their own content references (audio bank, class, variant, type) which the firmware uses to look up entries in the ROFS files. Two tags with the same content fields behave identically regardless of UID. The PPL resolver compares tag content signatures (via FNV-1a hashing) to decide whether to continue the current preset or switch content.

### Content Indexing

A Smart Tag's RFID data selects three independent assets from the ROFS:

| Tag Field | Offsets | Selects | From |
| --- | --- | --- | --- |
| Content index + variant ID | 10–13 | **Script** (behavioral logic) | `play.bin` — 1 of 58 script blocks via preset table |
| Audio bank | 8 | **Sounds** (synthesizer instructions) | `audio.bin` — 1 of 3 audio banks, 154 clips |
| Animation bank | 8 | **LED patterns** (timing + intensity) | `animation.bin` — 1 of 9 animation banks, 135 clips |

The content index (offsets 10–11, uint16) selects 1 of 5 presets, and the variant ID (offsets 12–13, uint16) selects a script block within that preset. Identity tags (minifigs) always use variant 1. Item tags (tiles) use the full variant ID for multiple script variations.

Because the three selections are independent, different tags can share identical gameplay behaviour while having completely different sounds and LED patterns.

**NPM/proximity scripts (type 0x09) are not selected by tags** — they are triggered by the firmware's NPM event system when another brick is detected nearby. The firmware maps NPM events to type 0x09 and randomly selects one of the 11 proximity scripts using their selection weights.

### Content Extensibility and Limits

The ROFS is baked into the firmware binary (zlib-compressed second segment). There is no separate content update channel — the WDX file transfer protocol only supports full firmware upload, telemetry download, and fault log download. **New scripts, sounds, or animations require a firmware update.**

However, Smart Tags are **combinatorial selectors** — LEGO can produce new tags that reference any combination of the existing 58 scripts × 3 audio banks × 9 animation banks without a firmware update. As long as a tag's content fields point to existing IDs, it works. This is a large design space already exercised in practice (X-Wing and Imperial Turret share the same combat script with different audio/animation banks).

#### Content Growth Across Firmware Versions

| Version | Scripts | Audio Clips | Anim Clips | ROFS Decompressed | ROFS Compressed |
| --- | --- | --- | --- | --- | --- |
| v0.46.0 | 53 | 200 | 225 | 358 KB | 154 KB |
| v0.48.2 | 56 | 201 | 227 | 377 KB | 157 KB |
| v0.54.0 | 55 | 188 | 166 | 176 KB | 100 KB |
| v0.65.0 | 52 | 155 | 132 | 163 KB | 92 KB |
| v0.66.1–v0.72.3 | 58 | 154 | 135 | 165 KB | 95 KB |

Content has gone **both up and down**. Between v0.48 and v0.54 the ROFS halved — audio switched from a large format (333 KB raw) to the current synthesizer instruction format (132 KB). Scripts have been both added and removed across versions (53 → 56 → 55 → 52 → 58), showing LEGO actively iterates on content.

#### Format Limits

| Constraint | Limit | Current Usage |
| --- | --- | --- |
| PPL script count field | uint16 → 65,535 | 58 |
| PPL preset count field | uint16 → 65,535 | 5 |
| Audio clip count field | uint16 → 65,535 | 154 |
| Animation clip count field | uint16 → 65,535 | 135 |
| play.bin size | ~22 KB of ~165 KB ROFS (13.7%) | Headroom for ~5× growth |
| audio.bin size | ~132 KB of ~165 KB ROFS (80.2%) | Dominates ROFS budget |
| Firmware file size | ~594 KB (code ~499 KB + ROFS ~95 KB compressed) | Early firmware reached 651 KB |

The **format** supports tens of thousands of scripts. The **practical bottleneck is flash storage**, and within that, **audio dominates** — play scripts are cheap (avg 375 bytes, NPM proximity scripts only 101 bytes), but synthesizer audio clips are expensive. At current script density, play.bin could hold ~130 scripts in 50 KB or ~260 in 100 KB.

The earliest firmware (v0.46.0) had a 377 KB decompressed ROFS in a 645 KB firmware file, proving the flash can accommodate at least 2× the current content size. LEGO has significant headroom for content growth through firmware updates.

### Script Profiling and Capabilities

Of the 58 script blocks in `play.bin` (v0.72.1):

**PAwR-capable scripts** (4 scripts use distributed execute, opcode 21):

| Script | Preset Type | Size | Branches | Range Checks | If-Then-Else | Table Lookups |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 0x0B | — | — | — | — | — |
| 14 | 0x03 | — | — | — | — | — |
| **42** | **0x0E** | **1,564** | **6** | **9** | **17** | **71** |
| 54 | 0x10 | — | — | — | — | — |

Script 42 is the only type-0x0E (Item tag) script with PAwR. It is by far the largest and most complex script in the file.

**NPM/proximity scripts** (11 scripts, type 0x09):

Scripts #21–#31 are **NPM positioning reaction scripts**. They respond to brick-to-brick proximity events, not tag scans or buttons. All 11 have header flag `0x40` (unique to type 0x09 and system type 0x0B). 10 of 11 are exactly 101 bytes — the same template with different audio/animation clip references. When another brick is detected nearby, one of these scripts is randomly selected (with roughly equal weight) and executed, producing a short audio/LED reaction.

The remaining 43 scripts are single-brick experiences triggered by tags, buttons, timers, or idle states.

### Case Study: X-Wing and Imperial Turret Tags (Inferred)

> The following reconstruction is **inferred** from matching observed physical behaviour against the script profiles in `play.bin`. Neither tag has been read directly — content field values are deduced from the firmware's content dispatch logic and script characteristics. Confidence levels are noted.

#### Shared Script: Script 42

Both the X-Wing and Imperial Turret exhibit PAwR combat behaviour (fire on red, hit counting, progressive damage, explosion). Script 42 is the **only** type-0x0E (Item tag) script with PAwR capability, so both tags must select it. They share identical gameplay logic but produce different experiences through different audio and animation bank selections.

**Script 42 characteristics** (confirmed from binary analysis):

- **Size:** 1,564 bytes — largest script in play.bin
- **Branches:** 6 (sub-header child_count)
- **Range checks:** 9 instances, using 3 distinct sensor byte values:
  - Byte `0x30`: 5 occurrences with varying thresholds (likely accelerometer axes — **inferred**)
  - Byte `0x21`: 2 occurrences (likely a second sensor input — **inferred**)
  - Byte `0x27`: 1 occurrence (likely a third sensor input — **inferred**)
- **Distributed execute:** 1 instance at script byte offset 1382, skip amount 7 — positioned late in the script, consistent with combat interaction being a later behavioral state
- **No equality checks** (opcode 18) — color sensor detection appears to use narrow range checks instead, which is sensible for analog sensor readings

**Inferred behavioral branch mapping:**

| Branch | Likely Behaviour | X-Wing Experience | Imperial Turret Experience |
| --- | --- | --- | --- |
| 1–2 | Idle + motion detection | Flying swoosh sounds | Turret rotation sounds |
| 3 | Color sensor trigger | Laser firing sound | Turret firing sound |
| 4–5 | PAwR combat | Hit sounds on remote brick | Hit sounds on remote brick |
| 6 | Alarm + destruction | X-Wing explosion | Turret explosion |

The motion detection branches (1–2) use the same accelerometer range checks in both cases. The **physical LEGO build** determines what motion triggers them — the X-Wing is held and moved freely (producing swoosh), while the turret sits on a rotating base (producing rotation). The script just sees "acceleration exceeded threshold" and plays from whichever audio bank the tag selected.

#### Tag Content Comparison

| Field | X-Wing | Imperial Turret | Confidence |
| --- | --- | --- | --- |
| Event type | 2 (Item placed) | 2 (Item placed) | High |
| Content type | `0x01` (Item) | `0x01` (Item) | High |
| **Script selection** | **Script 42** | **Script 42** | **High** — only type-0x0E script with PAwR |
| **Audio bank** | **Different** | **Different** | **High** — different sounds observed |
| **Animation bank** | **Different** | **Different** | **High** — different LED patterns observed |
| Content class | Different values | Different values | Medium — selects different audio/animation banks |
| PAwR content type | `0x02` or `0x04` | `0x02` or `0x04` | High — required for PAwR |

The tags differ only in their **audio bank** and **animation bank** references. The script, event type, content type, and PAwR content type are the same. This is the key architectural insight: the tag's content class and variant select different audio/animation assets while the script selection (via preset type and content index) points to the same behavioral logic.

#### What This Demonstrates

The same reactive script handles both a flying vehicle and a stationary rotating turret. The script's sensor condition checks are generic — "did the accelerometer exceed this threshold?" — and it is the physical LEGO build, combined with the tag's audio/animation bank selection, that creates the distinct play experience. The firmware and script have no concept of "X-Wing" or "turret" — they only know sensor thresholds, audio bank IDs, and animation bank IDs.

#### Positioning Not Used by Combat Script

Script 42 does **not** use NPM positioning — PAwR combat hits register from any BLE range, including from a different room. The distributed execute opcode sends unconditionally with no distance or orientation check.

However, **other scripts do use positioning**. The 11 type-0x09 scripts (#21–#31) are dedicated NPM/proximity reaction scripts — short audio/LED behaviours triggered by brick-to-brick proximity. These scripts and the combat script operate independently: proximity reactions fire when bricks detect each other nearby, while PAwR combat fires when a tag's color sensor sees red, regardless of distance.

#### What's NOT known
- The exact byte values of either tag's RFID memory (security format, CRC, raw encoding)
- The specific content_class values for each tag
- Which specific audio clip IDs correspond to swoosh vs rotation vs laser vs explosion
- The exact sensor threshold values and what physical measurements they represent
- Whether other Item tags with PAwR combat also share script 42, or if there are product-specific variants in future firmware
- The exact NPM conditions that trigger type 0x09 scripts (near threshold, facing direction, or any proximity)

## Multi-Brick Communication

### Positioning (Coils / NPM)

The copper coils sense **distance, direction, and orientation** between nearby bricks. Self-organizing — no setup, no app, no central hub. LEGO has demonstrated that a brick can detect when another brick is facing it.

Internally called **NPM** (Near-field Positioning/Magnetics). The NPM subsystem is **confirmed present and functional** in production firmware v0.72.1 — 20 functions mapped at `0x34D00`–`0x35FFF`. See [FIRMWARE.md](FIRMWARE.md) for the complete function map, RAM layout, and processing pipeline.

#### How NPM Works

The ASIC coils are time-multiplexed between tag reading (modes 0–6) and NPM positioning (modes > 6). When in NPM mode, the coils measure magnetic field strength from nearby bricks across 3 axes. The processing pipeline:

1. Raw 3-axis coil measurements arrive via ASIC interrupt
2. Baseline subtraction removes static field (stored at `0x808418`–`0x808420`)
3. `npm_process` at `0x34DFC` computes magnitude (`sqrt(x² + y² + z²)`), normalizes to unit vector, scales by 1000, applies IIR low-pass filter (alpha=0.5)
4. Filtered XYZ stored at `0x80389C`/`A0`/`A4` (IEEE 754 float)
5. Converted to fixed-point signed halfwords, validated against ±32767 range
6. Stored as current measurement at `0x8068F0` (3 signed halfwords: X, Y, Z)

#### NPM → Play Engine

NPM measurements are delivered to the play engine as events through the standard ring buffer:

| Event | Type | Sub-type | Hash | Meaning |
| --- | --- | --- | --- | --- |
| Valid measurement | `0x1E` | `0x1B` | `0xC47A2B46` | Position/orientation change detected |
| Out of range | `0x28` | `0x1B` | `0x9153122C` | Coil measurement exceeded ±32767 |

These events are processed by the play state machine in **state 5** ("sensor active"). The semantic tree executor does not read NPM hardware directly — it operates on pre-computed state buffers populated by the play engine from NPM events. NPM data enters the script execution context through the play event ring buffer and the sensor monitoring command (play command 5, via `0x4E1BC`).

#### NPM and Current Play Content

**11 of 58 scripts use positioning.** Preset type `0x09` (scripts #21–#31) are dedicated NPM/proximity reaction scripts. They are short, uniform (~101 bytes each), and produce brief audio/LED reactions when another brick is detected nearby. One is randomly selected (weighted) when a proximity event fires.

NPM events are **strictly content-signature routed**. The event builder at `0x50A94` tags each NPM event with the content hash `0xC47A2B46`. The dispatcher at `0x52588` looks up this hash in the session table at `0x80927C` — if no active session matches, the event is silently dropped. Scripts must have the PAwR capability flag (bit 1 at script+40) set to receive NPM events.

**Not all play scripts use positioning.** The X-Wing / Imperial Turret combat script (script 42, type 0x0E) does not gate PAwR combat on distance or orientation — hits register from any BLE range. Positioning reactions (type 0x09) and PAwR combat (type 0x0E) operate on independent channels: proximity events trigger type 0x09 scripts, while combat events flow through the distributed execute opcode in type 0x0E scripts.

| Capability | Script Type | Count | Trigger |
| --- | --- | --- | --- |
| NPM proximity reactions | 0x09 | 11 | Brick detects another brick nearby |
| PAwR combat (not distance-gated) | 0x0E (script 42) | 1 | Color sensor sees red |
| PAwR general | 0x03, 0x0B, 0x10 | 3 | Various (tag, system, button) |

### Data (PAwR / BrickNet)

Game state and events go over **BLE 5.4 PAwR (Periodic Advertising with Responses)**. Undocked bricks don't advertise via standard BLE — invisible to scanners.

One brick is the **coordinator**, broadcasting periodic advertising trains. Others **synchronize** and respond in designated slots. Sessions are encrypted and authenticated.

Internally called **BrickNet**. Firmware sources: `bnet_coord.c`, `bnet_resp.c`, `jam_bricknet_transport.c`.

#### When PAwR Activates

PAwR is **not** always active when undocked. It is triggered by **Smart Tags whose play content requires multi-brick communication**.

1. A Smart Tag (tile or minifig) is placed on the brick
2. The tag's play content is loaded from the ROFS `play.bin`
3. The firmware checks the **content type byte** — only types `0x02` and `0x04` indicate multi-brick play
4. If multi-brick: a PAwR session is initiated with a group UUID identifying the play experience (`0x7020162E` for type 2, `0xBF8C4668` for type 4)
5. The first brick becomes the **coordinator**, starting periodic advertising
6. Other bricks with compatible play content join as **responders**
7. The semantic tree executor's **opcode 21** enables inter-brick messaging over the BrickNet transport

Tags with single-brick play content (any type other than 2 or 4) do not activate PAwR. The brick plays locally without any BLE communication.

#### Session Persistence

If a brick power-cycles during an active PAwR session, the session state is persisted to flash. On next boot, the firmware reads the saved state and automatically resumes coordinator or responder mode if 2+ peers were recorded. See [FIRMWARE.md](FIRMWARE.md) for details.

#### PAwR Message Format

Inter-brick play messages are **25-byte packets** sent over PAwR periodic advertising slots:

```
┌──────────────────────────────────┐
│ Header (8 bytes)                 │  Session/routing info
├──────────────────────────────────┤
│ Opcode (1 byte)                  │  Message type (3 = play state)
├──────────────────────────────────┤
│ Semantic Tree State (16 bytes)   │  Serialized script position,
│                                  │  condition values, output buffer
└──────────────────────────────────┘
```

The semantic tree executor's **opcode 21** (distributed execute) decides what gets sent. It walks the play script and for each iteration either executes locally or serializes the current tree state via the BrickNet transport at `0x6CEF8` — a 13-opcode sub-interpreter that serializes the same opcode table used by the semantic tree.

Payloads are **XOR-encrypted** using a session key at struct+0x20, established during session setup. This is lightweight obfuscation, not AES — the session key is distributed by the coordinator during PAwR session initiation.

| Message Type | Hex | Purpose |
| --- | --- | --- |
| Play state | `0x2B` | Primary inter-brick play event (hit, action, state change) |
| Control | `0x1F` | Session control/status |
| Content | `0x2E` | Variable-length content data |

When the receiving brick gets a play state message, it deserializes the tree state, increments the PPL "other" counter at `0x80C6C0+0xA`, and the play state machine at `0x80D804` processes the state transition.

#### App-Side PAwR Registers

WDX registers `0x1B`, `0x1C`, `0x25`, `0x26` manage an **existing** PAwR session (sync data, payload exchange, session membership). They cannot independently start PAwR — a Smart Tag with multi-brick content must be present.

### PAwR Network States

| State | Meaning |
| --- | --- |
| `SYNC_LOST` | Lost synchronization with advertising train |
| `JOIN_FAILED` | Failed to join play session |
| `AUTH_FAILED` | Authentication failure |
| `REMOVED_BY_COORD` | Removed by coordinator |
| `SEEN_BETTER_NETWORK` | Found a better session |
| `BAD_SESSION_KEY` | Session key error |
| `STOPPED` | Session stopped |
| `SUSPENDED` | Session suspended |

## References

- [Packetcraft Cordio BLE stack](https://github.com/packetcraft-inc/stacks) — Open-source Cordio with WDX protocol definitions
- [ADI MSDK](https://github.com/analogdevicesinc/msdk) — MAX32 SDK with Cordio, WDX, and mesh support
- WDX protocol definitions: `Libraries/Cordio/ble-profiles/sources/profiles/include/wdx_defs.h`
