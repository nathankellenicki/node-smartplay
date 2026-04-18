# Audio Format — audio.bin

> Reverse-engineered structure of the AAP (Audio Assets Pack) container and its clip formats. The Smart Brick uses a custom analog synthesizer built into the DA000001-01 ASIC. Most audio is synthesizer instructions, not PCM — except for format 6 (raw PCM) and one QOA-encoded clip.

## AAP Container

The file begins with a 16-byte header, followed by a clip ID table, a secondary table, a metadata table, and clip data.

```
Offset  Size   Field
0x00    4      Magic: 7F 41 41 50 ("\x7FAAP")
0x04    6      Reserved (zeros)
0x0A    2      num_clips (u16 LE) — 154 in v0.72.1
0x0C    4      Reserved (zeros)
0x10    N×2    Clip ID table: num_clips × u16 LE
        N×2    Secondary table: num_clips × u16 LE (purpose unknown, values are monotonically increasing)
        N×16   Metadata table: num_clips × 16-byte entries
```

**Computed offsets** (for v0.72.1 with N=154):
- Secondary table: `0x10 + N×2` = `0x144`
- Metadata table: `0x10 + N×4` = `0x278`

Metadata offsets are **absolute from file start** — there is no separate clip data section header. The first clip begins at the offset specified in its metadata entry (0xC14 in v0.72.1, which overlaps with the last 4 bytes of the metadata table).

### Clip ID Table

Starting at offset `0x10`, one `u16 LE` per clip. IDs are sparse (values 0–330 in v0.72.1). Clips with `id=0` are anonymous companions to the preceding named clip (see [Clip Pairing](#clip-pairing)).

### Metadata Table

Starting at offset `0x10 + N×4`, each entry is 16 bytes:

```
[size:u32][offset:u32][ref_clip_id:u32][format:u32]
```

| Field | Description |
| --- | --- |
| size | Clip data length in bytes |
| offset | Absolute byte offset from file start |
| ref_clip_id | ID of a referenced clip, or `0xFFFFFFFF` if none |
| format | Format code (6, 8, 9, 10, or 11) |

**Note:** The last metadata entry (clip 153) overlaps the first 4 bytes of clip data, producing an anomalous format value `0x191DFFFF`. This is a packing artefact, not a real format code.

## Format Types

| Format | Count | Size range | Role | Encoding |
| --- | --- | --- | --- | --- |
| 6 | 1 | 48,440 | Pre-rendered audio | Raw signed 16-bit LE PCM @ 15,625 Hz |
| 8 | 43 | 215–2,000 | Instrument patches | Synthesizer bytecode (42) + QOA audio (1) |
| 9 | 16 | 150–1,492 | Instrument patches (variant) | Synthesizer bytecode |
| 10 | 92 | 7–450 | Sequencer configuration | Sparse register writes |
| 11 | 1 | 354 | Sequencer config (variant) | Sparse register writes |

### Format 6 — Raw PCM Audio

Single clip (id=7, 48,440 bytes). **Raw signed 16-bit little-endian PCM at 15,625 Hz**, duration 1.55 seconds. No header — audio data starts at byte 0.

The sample rate was determined from its QOA-encoded companion clip (format 8, clip 001, id=0), which specifies 15,625 Hz in its QOA header.

The firmware dispatches format 6 through its own handler at `0x589f8` which checks a flag at `0x80C853` bit 0.

### Format 8 — Instrument Patches

43 clips. **42 clips** use a proprietary synthesizer bytecode; **1 clip** (clip 001, id=0, companion to format 6) is [QOA (Quite OK Audio)](https://qoaformat.org/) encoded:

```
QOA clip: mono, 15,625 Hz, 4918 samples, 0.315s, 2000 bytes
```

#### Synthesizer Bytecode (42 clips)

The 42 non-QOA clips are a bytecode stream consumed by the ASIC voice engine (engine type 6, init at `0x366814`, step at `0x36B14C`). Key structural features:

- **0x82 is the dominant opcode** — appears in 15–25% of bytes across clips. Other high-bit opcodes: 0x80, 0x81, 0x83, 0x84.
- **Contains IEEE 754 float32 values** inline — frequencies, amplitudes, filter coefficients (e.g., 1.0, 0.2, 100.0, 297.9 Hz ≈ D4).
- **Loop marker at end** — all 42 clips end with `[byte1][byte2][00][00]` where byte1,byte2 match bytes 1–2 from the start of the clip. This is a loop-back instruction pointing to the beginning.
- The exact instruction encoding (opcode → argument count mapping) is not decoded.

Formats 8 and 9 share the same firmware readiness handler at `0x589A2` (adds 676 to voice struct, tests bit 7).

### Format 9 — Instrument Patches (Variant)

16 clips, structurally identical to format 8 synthesizer bytecode. Same loop marker ending pattern. Same firmware dispatch handler. Differences from format 8 are not yet characterised.

### Format 10 — Sequencer Configuration (Sparse Register Writes)

92 clips. **91 clips** fully parse as sparse register writes; **1 clip** (id=244) uses format 8-style bytecode.

#### Register Write Encoding

Each record: `[addr_lo:u8][addr_hi:u8][len:u8][data:len]`

- **addr_lo, addr_hi** — little-endian 16-bit address into a voice/synthesizer configuration struct
- **len** — number of data bytes (1–52)
- **data** — parameter values (float32, integer, or mixed)
- Addresses are **monotonically increasing** within each clip (91/91 clips verified)
- Address range across all clips: **0x003C – 0x07AE** (~1900-byte struct)

#### Voice Engine Struct Layout

The addresses are offsets into a ~1900-byte voice engine struct. No single address appears in all clips — each clip only sets the parameters it needs, leaving others at defaults (presumably inherited from the referenced format 8/9 instrument patch).

**Most-written addresses** (by number of clips that write to them):

| Address | Clips | Typical len | Data type | Inferred role |
| --- | --- | --- | --- | --- |
| 0x004C | 21 | 8 | 8 × int8 | Per-voice detuning offsets (e.g., -10, -8, -5, -7) |
| 0x00D4 | 19 | 3,4,16 | float32 | Oscillator pitch (musical frequencies: B5–B7 range) |
| 0x0104 | 7 | 52 | 13 × float32 | Harmonic amplitude table (same values in all 7 clips: 0.87, 0.05, 1.0, 0.20, 0.92, 0.29, 0.15, 0.34, 0.19, 0.44, 0.31, 0.95, 0.11) |
| 0x013C | 18 | 4,12 | float32 | Amplitude/timing parameter |
| 0x0220 | 16 | 3,4,7,8,11 | mixed | Voice parameter |
| 0x025C | 15 | 3,4,7,8,16 | mixed | Voice parameter |
| 0x0274 | 17 | 3,4,7,8,32 | float32 | Pitch/frequency (G4–F5 range) |
| 0x0280 | 18 | 3,4,7,8,16,19 | float32 | Pitch (A#3–D5 range) |
| 0x02A0 | 17 | 3,4,7,8,16 | mixed | Voice parameter |
| 0x02C4 | 20 | 2,3,4,7,8,11,12,16 | mixed | Wide range values (26–2082 Hz) |
| 0x02F8 | 35 | 3,4,8,11,19 | mixed | Most-written address, mixed byte/float data |
| 0x0304 | 27 | 3,4,7,11,12 | float32 | Wide range (0–1417), includes frequencies |
| 0x0310 | 29 | 3,4,8 | mixed | Small values 0–3, mode/control selector |
| 0x0324 | 33 | 7,8,11,16,20 | float32 | Envelope/modulation (0–3472 range) |
| 0x0334 | 19 | 3,4,8,11,12,19,20 | mixed | Voice parameter |
| 0x033C | 18 | 3,4,7,8,11,12 | mixed | Amplitude range (0.1 typical) |
| 0x0350 | 24 | 3,4,7,8,16 | float32 | Pitch/note (musical frequencies: G5, A#5, C#5) |
| 0x0362 | 22 | 1,2,10 | int8/int16 | Flag/mode selector |
| 0x0368 | 20 | 3,4,7,8,16 | mixed | Small amplitudes (0–1.5) |
| 0x0374 | 15 | 3,4,7,15 | float32 | Amplitude/timing |
| 0x0390 | 21 | 4,12,15,16,27,31 | float32 | Frequency target (wide: C#2–C8, primary pitch) |
| 0x03A8 | 25 | 3,4,7,8,24 | float32 | Frequency/rate (0–7812 Hz) |
| 0x03B8 | 18 | 3,4,8,11,15,20 | mixed | Timing/amplitude |
| 0x03C0 | 29 | 3,4,7,8,15,16 | float32 | Modulation depth (small values, 0–10) |
| 0x03D4 | 18 | 3,4,8,16,28,32 | mixed | Complex parameter block |
| 0x0450 | 33 | 3,4,7,8,27,28,32 | float32 | Timing/tempo (0–320 range) |
| 0x0500+ | sparse | 1 | int8 | Flags and mode selectors (single-byte writes) |

**Struct region summary:**

| Region | Likely role |
| --- | --- |
| 0x003C–0x00FF | Global config: detuning (0x4C), oscillator pitch (0xD4) |
| 0x0100–0x01FF | Voice shape: harmonic table (0x104), filter params, amplitude |
| 0x0200–0x02FF | Secondary voice params: pitch, frequency, modulation |
| 0x0300–0x03FF | Envelope/sequencer: timing, pitch targets, modulation depth |
| 0x0400–0x04FF | Extended params: tempo, complex parameter blocks |
| 0x0500–0x07AE | Sparse flags: single-byte mode selectors |

#### Example

Smallest clip (clip 143, id=0, 7 bytes) — single register write:
```
6c 00 04 41 a7 4d 3f
→ addr=0x006C, len=4, data=0x3F4DA741 (float32: 0.803)
```

Medium clip (clip 147, 90 bytes) — 12 register writes setting frequencies, amplitudes, and timing:
```
addr=0x00D4  len=4  float32: 225.37 Hz
addr=0x00DC  len=3  (mixed)
addr=0x0152  len=1  0x80
addr=0x0194  len=4  float32: 236.47 Hz
addr=0x01BC  len=4  float32: 100.0
...
addr=0x0338  len=8  float32: 1.0, 0.0
addr=0x0358  len=7  (mixed)
```

#### Outlier: Clip id=244 (203 bytes)

The single format 10 clip that does NOT use register-write encoding. Instead it uses high-bit opcodes (0x80, 0x81, 0x82) similar to format 8 bytecode. This may be a different sub-format or a mislabeled clip type.

### Format 11 — Sequencer Configuration (Variant)

Single clip (id=42, 354 bytes, ref=270). Uses the same register-write encoding as format 10. Fully parses as 29 monotonically-addressed records, address range 0x003C–0x044A. (Earlier notes associated this clip with "PPL script #42 (PAwR combat)"; that link is unverified — it may simply share the clip id number 42 by coincidence. Combat-related audio references come from the active tag's resource-reference records, not from clip-id/script-id number matches.)

## Hierarchical Reference System

Format 10 sequencer clips reference format 8/9 instrument clips via the `ref_clip_id` metadata field. This creates a **patch + sequence** layering:

```
Format 10 (register writes) --ref--> Format 8/9 (instrument bytecode)
Format 10 (register writes) --ref--> Format 10 (another config, chaining)
```

The firmware loads the referenced format 8/9 instrument patch first (which programs the ASIC voice engine), then applies the format 10 register writes to configure the sequencer for that specific sound.

### Most-Referenced Patches

| Clip ID | Format | Size | References |
| --- | --- | --- | --- |
| 270 | 10 | 348 | 24× (chain target) |
| 66 | 8 | 215 | 11× |
| 292 | 10 | 185 | 10× (chain target) |
| 283 | 10 | 299 | 9× (chain target) |
| 74 | 8 | 339 | 7× |
| 107 | 9 | 1,131 | 6× |
| 92 | 8 | 1,250 | 5× |
| 159 | 8 | 1,099 | 3× |

## Clip Pairing

Clips are arranged in alternating pairs: `[id=N][id=0]`. Both clips in a pair share the same format code and are adjacent in the metadata table. The `id=0` clip is an anonymous companion — likely a second voice channel, variation data, or continuation of the named clip.

Examples:
```
idx=0  id=  7 fmt=6  size=48440  ← named (raw PCM)
idx=1  id=  0 fmt=8  size=2000   ← companion (QOA audio of same sound)

idx=22 id= 66 fmt=8  size=215    ← named instrument
idx=23 id=  0 fmt=8  size=538    ← companion data

idx=82 id=292 fmt=10 size=185    ← named sequence
idx=83 id=  0 fmt=10 size=217    ← companion data
```

Some clips break the pattern (e.g., consecutive `id=0` clips or unpaired named clips near format boundaries).

## Firmware Audio Engine

### Memory Layout

- Code loaded at base address `0x306000`
- Audio state structs at `0x80DA90`, `0x80DAA0`, `0x80DAA4`, `0x80DAE0`
- Voice channel config at `0x80B950`
- Audio flags at `0x80C850`, `0x80C853`, `0x80C858`, `0x80C989`

### Format Dispatch

**Readiness check** at `0x58980` — called before playback to test if a format can be played:

```
sub   r1, r1, 1          ; format_code - 1
cmp   r1, 8              ; 9-case jump table (formats 1-9)
bih   [r1]               ; branch indexed
```

| Format | Handler | Action |
| --- | --- | --- |
| 1 | `0x589DA` | Check byte at struct+2 == 1 |
| 2 | `0x589E4` | Check byte at struct+2 == 1 AND struct+672 bit 3 |
| 3 | `0x589AC` | Check format == 2, else read struct+654 |
| 4 | `0x589B6` | Check struct+672 bit 5 |
| 5 | `0x589C0` | Check byte at struct+2 != 0, conditional on format |
| 6 | `0x589F8` | Check `[0x80C853]` bit 0 |
| 7 | `0x58A12` | Check struct+675 bit 2 |
| 8, 9 | `0x589A2` | Check struct+676 bit 7 (shared handler) |

**Engine type dispatch** at `0x5923C`:

```
cmp r0, 8    → format 8: engine_type = 6
cmp r0, 10   → format 10: engine_type = 1 or 2 (based on state)
```

### Function Pointer Table

At `0x37CA5C` (ROM), 7 entries × 20 bytes (5 function pointers per entry):

| Entry | Init (col 0) | Step (col 1) | Col 2 | Role |
| --- | --- | --- | --- | --- |
| 0 | `0x3675AC` | `0x36B4FC` | `0x3675AC` | Engine type 0 |
| 1 | `0x366A5C` | `0x36B430` | `0x366A64` | Format 10 (primary) |
| 2 | `0x3674F0` | `0x36B540` | — | Format 10 (alternate) |
| 3 | `0x35BFFC` | `0x35BFAC` | — | Engine type 3 |
| 4 | `0x366C44` | `0x36B3F0` | `0x366C9C` | Engine type 4 |
| 5 | `0x366798` | `0x36B0C8` | `0x36471C` | Engine type 5 |
| 6 | `0x366814` | `0x36B14C` | `0x36471C` | Format 8/9 |

### ASIC Audio Registers

| Register | Width | Purpose |
| --- | --- | --- |
| `0xF04400` | byte | Audio data output (stb writes) |
| `0xF04404` | word | ASIC control (cleared before register writes) |
| `0xF0440C` | word | Audio status (read for flags) |
| `0xF04800`+ | u16 | **Synthesizer register file** — 256 registers, format 10/11 target |
| `0xF0484C` | word | Audio configuration (st writes) |
| `0xF04054` | word | Audio event flags |
| `0xF00860` | word | Interrupt status |
| `0xF00868` | word | Interrupt acknowledge |

The low-level audio ISR at `0x336E4` reads interrupt status from `0xF00860`, acknowledges events via `0xF00868`, and writes synthesizer parameters to `0xF04400` (byte) and `0xF0484C` (word). Register `0xF0484C` carries voice configuration bits including a volume/gain field at bits 2–5 and an envelope flag at bit 14.

### Format 10/11 → ASIC Hardware Path (Firmware Traced)

Format 10/11 clips write **directly to ASIC hardware registers**, not to firmware memory. The full data path:

1. **Format dispatch** at `0x5C758`: command byte `0x72` (114) → format 10 (internal id `0x0A`)
2. **2D function table** at `0x37CD0C`: indexed by `(voice_type × 44) + (format_id × 4)` → init function pointer
3. **Format 10 init** at `0x55D4C`: calls `0x5E224` which constructs ASIC command type `0x0B` (11)
4. **Format 10 step** at `0x55DC4`: calls `0x60BE8` → allocates command slot via `0x65874`, sets command type `0x0B`, dispatches via `0x658B0`
5. **ASIC command queue** at `0x80FD60`: buffer of (u16 address, u16 value) pairs
6. **ASIC register write loop** at `0x339E4`:

```
339e4: ldh.ab r0,[r3,2]      ; read u16 address from command buffer
339e8: ldh.ab r2,[r3,2]      ; read u16 value
339ec: asl_s  r0,r0,0x2      ; addr <<= 2
339ee: and    r0,r0,0x3FC    ; mask to 10 bits (256 register slots)
339f2: add_s  r0,r0,0xF04800 ; + ASIC synthesizer register base
339fc: sth_s  r2,[r0,0]      ; write u16 value to hardware register
339f8: dbnz.d r1,-20         ; loop over all pairs
```

The format 10 addresses (0x003C–0x07AE) are ASIC synthesizer register indices. Only the low 8 bits of each address select among 256 physical registers (due to the `& 0x3FC` mask after shifting). The data is reformatted from the format 10 encoding (`[addr:u16][len:u8][data:N]`) into `(addr, value)` u16 pairs before reaching the write loop.

After writing the register data (command 0x0B), the step function also sends ASIC command type `0x17` (23) via `0x60A2C` — a voice configuration/start command.

### Voice Struct Layout

The EM9305 firmware maintains voice state in a **1028-byte (0x404) struct**, with the global array base pointer at `0x80DAA4`. The step function at `0x36B430` (file `0x65430`) accesses a sub-struct at offset `+0x2C0`:

| Offset | Size | Role |
| --- | --- | --- |
| +0x0048 | u8 | Period calculation mode A (selects formula) |
| +0x0049 | u8 | Period calculation mode B |
| +0x02BE | u16 | Period parameter A |
| +0x02C0 | u16 | Period parameter B |
| +0x02C2 | u16 | Period parameter C |
| +0x02C4 | u16 | Period parameter D |
| +0x02D0 | u16 | Computed period (output of `0x5674C`) |
| +0x02F8 | u8 | Flags byte (bit 0 tested for voice type selection) |
| +0x0212 | u8 | State flag (set to 1 after data copy) |
| +0x0213 | u8 | State flag |
| +0x0398 | 10 bytes | Copied notification data |

The **period calculator** at `0x5674C` uses modes at offsets 0x48/0x49 to select timing formulas:

| Mode | Formula | Range |
| --- | --- | --- |
| 2 | `0x3C + param × 4` | 60–1084 |
| 3 | `param × 64 + 976`, min 2704 | 976–66512 |
| default | `param × 8 + 0x38` | 56–?? |

Final period = sum of both calculations + 150, returned as u16. This likely controls the audio sample output rate or envelope timing.

## What We Cannot See

- **ASIC synthesizer register map** — format 10/11 addresses are ASIC hardware register indices at `0xF04800 + (addr << 2)`. The DA000001-01 has 256 synthesizer registers, but their function (oscillator frequency, filter cutoff, envelope timing, waveform select, etc.) is proprietary to EM Microelectronic. Without the register datasheet, we cannot map format 10 addresses to synthesis parameters.
- **Software synthesis is blocked** — format 10/11 clips configure analog hardware, not a software synthesizer. Emulating the audio output would require either: (1) a complete register-level model of the DA000001-01's analog audio engine, or (2) recording audio output while feeding known register values to a physical brick. Neither is currently feasible.
- **Format 8/9 bytecode decoding** — the opcode→argument mapping for the synthesizer bytecode is not decoded. 0x82 is the dominant opcode (~20% of bytes); other high-bit opcodes (0x80–0x84) appear frequently. The data mixes float32 parameters with integer control bytes. Format 8/9 bytecode likely also ends up as ASIC register writes (via engine type 6 step function at `0x36B14C`), making it subject to the same hardware dependency.
- **Register address wrapping** — the `& 0x3FC` mask in the write loop means only 8 bits of each format 10 address select among 256 physical registers. Addresses 0x003C and 0x013C would map to the same physical register. Whether the firmware pre-processes addresses to avoid collisions (e.g., writing in multiple passes) or whether the full address space is intentional (different commands for different register banks) is unknown.
- **Clip pairing semantics** — the relationship between named clips and their `id=0` companions is inferred from adjacency, not confirmed by firmware tracing. The format 6/QOA pairing confirms companions can be alternate encodings of the same sound.
- **PPL script → audio clip correlation** — knowing which clips play during specific gameplay events (tag scan, idle, combat) would allow comparative analysis of register values to infer parameter roles. This requires cross-referencing the play.bin preset table with audio bank references from tag resource records.

## Possible Paths Forward

1. **Record audio from physical brick** — play tags and capture the speaker output with a microphone. Correlate known format 10 register values with recorded audio to empirically map register functions. This is the most practical approach.
2. **Compare register values across clips** — clips that produce similar sounds (same ref chain) should share register patterns. Statistical clustering of register values may reveal which addresses control pitch vs. timbre vs. timing.
3. **Probe ASIC registers over SPI/I2C** — if the DA000001-01 has a debug interface, direct register reads during playback could reveal the synthesizer state. Requires hardware probing.
