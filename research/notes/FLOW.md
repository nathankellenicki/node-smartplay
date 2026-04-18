# Tag → Play Engine Flow

> How a Smart Tag drives gameplay on the Smart Brick. Based on firmware disassembly (v0.72.1), play.bin analysis, and architectural reasoning. The decrypted tag content has never been directly observed — the encryption key is in ASIC silicon.

## Overview

The tag is a **playlist** — a list of `{script, sounds, animations}` tuples that the brick executes. The brick does not need to "know about" a tag in advance. Any tag that references valid scripts and banks in the ROFS will work without a firmware update.

## Step-by-Step Flow

### 1. Wake

The brick is shaken to wake up. No tag is present, so no scripts are loaded and there is no play behaviour. The play engine is idle.

### 2. Tag Placed

A Smart Tag (minifig or tile) is brought near the brick. The tag's EEPROM contains 74–171 bytes of encrypted data, preceded by a 5-byte cleartext header (`00 [payload_length] 01 0C 01`). The data is protected by **full authenticated encryption (AEAD)** — empirically confirmed that modification of any single byte causes silent rejection. The encryption algorithm is **unknown** — it runs entirely inside the DA000001-01 ASIC. It behaves like an authenticated stream cipher with a per-content IV. The tag IC manufacturer is irrelevant (clones work on NXP ICODE SLIX2). Earlier references to "AES-128-CCM" were a misattribution; the AES-CCM functions in the EM9305 firmware are for BrickNet PAwR session encryption and EM9305↔ASIC mutual authentication, not tag data decryption.

### 3. ASIC Reads and Decrypts

The DA000001-01 ASIC handles the ISO 15693 RF protocol autonomously — inventory, anti-collision, and block reads. It decrypts the tag payload internally using a key held in silicon (not accessible from firmware). The cleartext header byte 1 tells the ASIC how many bytes to decrypt. The EM9305 firmware never sees the encrypted data or the cleartext header — it receives only the structured decrypted output.

The decrypted output is structured as a **type 0x22 TLV container** containing multiple sub-records. The ASIC deposits this into the EM9305's memory-mapped register space:
- 4 × 20-byte blocks at registers 0x04–0x07 → RAM `0x8078A8`–`0x8078F8`
- 3 × 100-byte buffers at registers 0x2A–0x2C → RAM `0x807930`–`0x8079F8`
- 24-byte repacked summary at register 0x2E → RAM `0x807A60`

### 4. TLV Parsing (Two Layers)

**Layer 1 — ASIC register dispatch (`0x10600`):**
A loop at `0x10706` iterates over sub-records inside the type 0x22 container. Each sub-record has format `[type:1][param:1][length:1][payload:N]`. The loop processes all records sequentially until the offset reaches total size — the number of records is variable and depends on the tag.

**Layer 2 — Content buffer assembly (`0x4ec58`):**
Sub-records are queued as fragments into message queue `0x80b514`. The accumulator assembles fragments into complete high-level TLV records (4-byte header: `[type_id:2][content_length:2][payload:N]`). Each complete record triggers the dispatch chain at `0x523a8` → type handler → triple callback.

### 5. Content Identity Record

One TLV record (type 0x22, handled at `0xED74`) carries a **7-byte content identity**: `{content_lo(u32), content_hi(u16), type_byte(u8)}`.

- The **type_byte** routes events to the correct preset type category (0x03=identity, 0x06=item, etc.)
- The **6-byte identity** is used for:
  - **Change detection** — XOR comparison at `0x809430` (same tag vs new tag, avoids reloading)
  - **PRNG seeding** — `content_lo ^ content_hi` at `0x80CF28` seeds the xorshift32 that generates per-playback variation in audio/LED selection within scripts. This means different characters running the same script produce different variation sequences — Luke and Vader on the same idle script will select different audio clips and LED patterns each playback, making characters feel distinct even when sharing scripts.
  - **Pool entry scoring** — priority tiebreaking (exact=+10, wildcard=+3, mismatch=+2)

The content identity is **not** the primary driver of gameplay logic. It is essentially a session key: "has the tag changed?" and "which random sequence should we use?" It may uniquely identify a character (i.e. "this is Luke Skywalker"), but the firmware uses it purely as housekeeping — session management and variation seeding. The actual gameplay behaviour is driven entirely by the resource reference records below.

### 6. Resource Reference Records

Multiple TLV records (sub-type `0x0008`, tag byte `0x12`) carry **resource references** — each one independently selecting a complete interaction profile:

| Field | Size | Range | Selects |
| --- | --- | --- | --- |
| content_ref_start | u16 | 6–3200 | Matches a `param` in the PPL preset table → selects a **script** from `play.bin` |
| content_ref_end | u16 | ≥ start, ≤ 3200 | Content reference range end |
| bank_index | u16 | 0–499 | Selects an **animation bank** from `animation.bin` (LED patterns, timing, intensity) |
| bank_ref | u16 | 10–3200 | Selects an **audio bank** from `audio.bin` (synthesizer instructions for ASIC speaker) |

Each resource reference record is extracted at `0x52454` and dispatched via opcode `0x72` (`0x16B84`) to populate the slot table at `0x80931C`.

**A single tag produces multiple resource reference records** — one for each interaction mode the tag supports. This is why tag payload sizes vary: more interaction modes = more records = more encrypted bytes.

### 7. Script Selection via Preset Table

The PPL preset table in `play.bin` has 58 entries, each with a **type** and a **param**:

```
[type:4][param:4] × 58 entries
```

The content_ref from each resource reference record is matched against the param field of entries with the appropriate preset type. Each match selects one script:

| Preset Type | Trigger | Scripts | Description |
| --- | --- | --- | --- |
| 0x03 | Tag scan (identity) | 16 | Initial minifig placement response |
| 0x06 | Tag scan (item) | 5 | Initial tile placement response |
| 0x09 | NPM proximity | 11 | Brick-to-brick positioning reactions |
| 0x0B | System | 6 | Startup, transitions |
| 0x0E | Timer/idle | 16 | Ambient play sequences; combat orchestrator (#42) |
| 0x10 | Shake / IMU motion | 7 | Accelerometer-driven responses (firmware's internal name for this is "Button", but **there is no physical button** — X-Wing swoosh, turret rotation, Lightsaber shake, etc.) |

**Color sensor events are NOT a preset type** — they take a separate path (ISR-driven ADC dispatch, see "Color sensor input" below).

A Vader minifig might carry resource reference records that select one script from type 0x03 (tag scan), one from 0x0E (idle), one from 0x10 (IMU shake), and one from 0x09 (NPM) — each with independently chosen audio and animation banks.

### 8. Execution

Once scripts are loaded, the play engine runs them. Two distinct execution modes coexist:

**Event-triggered scripts** (one-shot reactions): a script is invoked, it produces a playback record, and playback completes.
- **Tag placed** → fires the type 0x03 or 0x06 script
- **Shake / IMU motion** → fires the type 0x10 script (firmware hardcodes preset type at `0x50A94`; firmware's internal label is "button" but there is no physical button — the trigger is accelerometer threshold crossing)
- **NPM proximity** → fires the type 0x09 script (firmware routes NPM events to type 0x09)
- **Color sensor trigger** → separate pathway (see "Color sensor input" subsection below). Colors play audio/LED reactions but do not map to a single preset type.

**Timer-scheduled scripts** (continuous orchestration): while certain tags are active, a type 0x0E (timer/idle) script is invoked every tick via the timer fallback table at `0x37D42C` (hardcoded by `0x50A20`). The script runs continuously and polls firmware state — counter bytes, flag bits, animation pointers — to decide what to output each cycle.

**Combat is the canonical poll-driven case.** PAwR-combat-capable tags (ship tags) select script #42 for type 0x0E. Script #42 runs on every timer tick as long as the ship tag is present. When an incoming PAwR fire message arrives, it is handled entirely in C code through a two-threshold state machine — **not** by invoking a new script:

1. **Hits 1–3 (healthy):** `0x1232C` increments hit counter at `[0x80CF28+0x12]`. Per-hit event `0x0D`/`0x0E` is emitted onto Queue B. Hit SFX plays synchronously via direct play-engine calls (`0x4B9C`, `0x47344`, `0x47124`).
2. **Hit 4 — entering damaged state:** counter exceeds 3. Flag bit 2 set in `[0x80CF28+0x13]`, counter reset to 0, event `0x0F` (alarm) emitted. Alarm audio plays.
3. **Hit 5:** counter increments again (still in damaged state). Hit SFX plays.
4. **Hit 6 — destroyed:** counter exceeds 1 in damaged state. Flag bit 2 cleared, event `0x0C` (explosion) emitted. Explosion audio plays via `0x3314` → `0x165E0` with `r0=3`.
5. Script #42, running on each timer tick, observes the flag bit 2 and produces a different decoded playback record (ambient while healthy, warning loop while damaged, post-destruction cleanup after explosion), selecting different audio/animation banks from the tag's resource references.

Observed X-Wing gameplay matches exactly: alarm at 4 hits, explosion at ~6 hits.

All these audio invocations — script-driven and directly-dispatched — read the *same* `audio_bank_ref` and `animation_bank_ref` values from the active tag's resource-reference records. That's why different ships (same script #42, different banks) sound and look different even though the gameplay logic is identical, and why non-combat tags (no script #42 in their resource references, no matching banks for combat audio) simply don't respond to fire events.

Scripts are bytecode schemas that decode a typed input stream into a playback record — see [SCRIPTS.md](SCRIPTS.md) for the interpreter model. The xorshift32 PRNG (seeded by content identity at `0x80CF28+0`) introduces variation in the downstream dispatcher's variant selection — different characters on the same script play different audio clips each cycle.

**Opcode 21 (`bricknet_send`) is dead code.** The interpreter handler at `0x4BB7A` exists but no byte in the translation table maps to it, so no script can invoke BrickNet sends. All PAwR transmission in v0.72.1 is C-driven from the BrickNet coordinator code, not from play.bin.

#### Color sensor input (separate pathway)

The Smart Brick's color sensor is the "fire button" for combat (red triggers laser/fire on X-Wing, etc.) and also drives flavor reactions (green = "repair" audio, blue = "refuel" audio). Unlike tag scan / timer / shake / NPM, **color detection does not map to a preset type**. It takes its own ISR-driven path:

1. The DA000001-01 ASIC performs the actual color sensing and raises an interrupt on `[0xF00860]`.
2. ISR `0x336E4` configures ADC mode via `[0xF04400]=0x04`, reads the 13-bit sample via AUX register 1680+channel×3, and stashes the value in the sensor event-queue struct at `0x8093E0` / `0x8093F0` (halfword at `+0x0E`).
3. Depending on which `[0xF00860]` bit fired, the ISR emits an event code (one of `0x00`, `0x02`, `0x03`, `0x04`, `0x07`, `0x08`, `0x09`, `0x0A`) via the registered callback at `0x33AD8`.
4. Codes `0x00`–`0x05` feed **Queue A** and are matched against the 38-entry dispatch table at `0x37D5A4` → which selects a script via `0x6BFFE`. Codes `0x07`–`0x0A` fall through to the timer fallback table at `0x37D42C`.
5. The invoked script decodes a playback record using the tag's resource-reference banks; audio/LED plays accordingly.

**Red / green / blue are purely audio + LED — no gameplay state changes.** The firmware contains zero "fuel", "health", "ammo", or "repair" strings or state variables. Green ("repair") and blue ("refuel") are flavor reactions — they play sound and LED sequences but do not increment or track anything. Red is the same pattern plus an additional C-level BrickNet send that causes *other* bricks' hit counters to increment (the one real combat state variable). This was confirmed by firmware trace 2026-04-18.

Which ISR bit corresponds to which sensor (color vs accelerometer vs sound) and which event code represents which specific color is not determinable from static firmware — that mapping lives in ASIC silicon. Candidate script mappings from the 38-row dispatch table: evt=0x02 → script #4, evt=0x03 → various (including #16), evt=0x04 → script #12 or similar, evt=0x05 → script #2 or **#14** (the identity PAwR-capable script).

### 9. Tag Removal

When the tag is removed, a 320ms grace period prevents false triggers. After grace, the play engine flushes buffers and stops. The brick returns to idle, waiting for a new tag.

## Design Implications

**No per-tag registration required.** The brick doesn't contain a table mapping tag IDs to behaviours. A tag is a self-describing playlist of `{script, audio_bank, animation_bank}` tuples. Any tag that references valid ROFS content will work.

**New characters without firmware updates.** LEGO can ship new tags that compose existing scripts with different audio/animation bank selections. A new character is just a new combination of content_ref + bank_index + bank_ref values pointing to content already on the brick.

**Firmware updates extend the palette.** New scripts, audio banks, and animation banks can be added via firmware updates. All existing AND future tags can reference the new content — the tag format is forward-compatible.

**Variable payload sizes reflect interaction richness.** R2-D2 (74 bytes) supports fewer interaction modes than Darth Vader (169 bytes). Each additional resource reference record adds ~8 bytes of decrypted content (plus encryption overhead) to the tag payload.

## What We Cannot See

The **actual matching logic** between content_ref values and PPL preset table params happens in ROFS-mapped play engine code (memory-mapped from `play.bin`), which is not visible in the firmware disassembly. The mechanism described above is inferred from:
- The PPL preset table structure (58 entries with type + param)
- The resource reference extraction code at `0x52454`
- The event builder functions that hardcode preset types
- The architectural constraint that tags must work without per-character firmware knowledge

The decrypted tag content has never been directly observed. The number and exact structure of TLV sub-records per tag type is inferred from payload size variation and the variable-length TLV loop at `0x10706`.

## Illustrative Example — X-Wing Decrypted Payload

> ⚠️ **This is a constructed example, not real data.** Tag encryption has not been broken — no decrypted tag content has ever been observed. The key is held in ASIC silicon and is not recoverable from firmware. The bytes below are inferred from documented field layouts (FIRMWARE.md § "Resource Reference Records"), known script parameters from `play.bin`, and the architectural reasoning in this document. Exact byte values, record counts, padding, and framing are **guesses** — they illustrate the *shape* of decrypted content and would only be confirmed by a successful decryption.

The cleartext 5-byte RF header `00 6B 01 0C 01` preceding the ciphertext tells the ASIC how many bytes follow (byte 1 = `0x6B` = 107 = payload length). The ASIC consumes and discards this header — the EM9305 firmware never sees it.

After ASIC decryption, the firmware reassembles a **type 0x22 TLV container** containing one content-identity record and N resource-reference records. For a 107-byte X-Wing, a plausible layout:

```
Offset  Bytes                                             Field / Meaning
──────  ───────────────────────────────────────────────   ───────────────────────────────
# Top-level TLV container (type 0x22)
0x00    22 00 68 00                                       type_id=0x0022, content_length=0x68 (104 payload)

# Record 1: Content Identity (TLV header + 7-byte identity)
0x04    22 00 07 00                                       type_id=0x0022, length=7
0x08    A3 B7 C4 D1                                       content_lo (u32 LE) — opaque identity
0x0C    5E 92                                             content_hi (u16 LE) — opaque identity
0x0E    06                                                type_byte=0x06 → preset-type category "item/tile"
0x0F    02                                                PAwR content type = 0x02 (multi-brick capable)

# Record 2: Resource reference — Item scan (type 0x06)
0x10    22 00 0C 00 00 00 00 00                           TLV header
0x18    12 00 08 00                                       tag byte (0x12), session counter, sub_type=0x0008
0x1C    A8 05                                             content_ref_start = 1448  → matches script #16
0x1E    A8 05                                             content_ref_end = 1448
0x20    0E 00                                             bank_index = 14           (placement animation)
0x22    22 01                                             bank_ref = 290            (placement SFX)

# Record 3: Resource reference — Timer / combat orchestrator (type 0x0E)
0x24    22 00 0C 00 00 00 00 00                           TLV header
0x2C    12 01 08 00                                       tag=0x12, counter=1, sub_type=0x0008
0x30    18 00                                             content_ref_start = 24    → matches script #42 (combat)
0x32    18 00                                             content_ref_end = 24
0x34    1F 00                                             bank_index = 31           (X-Wing combat anims)
0x36    3C 01                                             bank_ref = 316            (X-Wing combat SFX)

# Record 4: Resource reference — Shake / IMU motion (type 0x10, firmware-internal name "button")
0x38    22 00 0C 00 00 00 00 00                           TLV header
0x40    12 02 08 00                                       tag=0x12, counter=2, sub_type=0x0008
0x44    48 00                                             content_ref_start = 72    → matches script #52 (shake)
0x46    48 00                                             content_ref_end = 72
0x48    20 00                                             bank_index = 32           (shake/swoosh anims)
0x4A    3D 01                                             bank_ref = 317            (swoosh SFX)

# Record 5: Resource reference — NPM proximity (type 0x09)
0x4C    22 00 0C 00 00 00 00 00                           TLV header
0x54    12 03 08 00                                       tag=0x12, counter=3, sub_type=0x0008
0x58    80 01                                             content_ref_start = 384   → matches script #21 (NPM)
0x5A    80 01                                             content_ref_end = 384
0x5C    21 00                                             bank_index = 33           (proximity anims)
0x5E    3E 01                                             bank_ref = 318            (proximity SFX)

# Tail / alignment
0x60    00 00 00                                          padding to 107 bytes
                                                          (real tags likely use this tail for encryption
                                                          metadata — counter, nonce, or MAC anchor — that
                                                          the ASIC strips before handing off)
```

### What each record drives

| Trigger                              | Record consulted  | Script invoked                                   | Banks used                     |
|--------------------------------------|-------------------|--------------------------------------------------|--------------------------------|
| Tag placed                           | Record 2          | #16 (item scan)                                  | anim=14, audio=290             |
| Every timer tick                     | Record 3          | **#42 (combat orchestrator — polls hit state)**  | anim=31, audio=316             |
| Shake / IMU motion (swoosh)          | Record 4          | #52                                              | anim=32, audio=317             |
| Color sensor — red shown             | *(no tag record — separate ISR path via `0x336E4`; selects a script via 0x37D5A4 based on emitted event code)* | varies by event code (TBD) | varies — "fire" SFX + LED + BrickNet broadcast to other bricks |
| Color sensor — green shown           | *(same path)*     | varies                                           | "repair" SFX + LED (**no state change — flavor only**) |
| Color sensor — blue shown            | *(same path)*     | varies                                           | "refuel" SFX + LED (**no state change — flavor only**) |
| Proximity to another brick           | Record 5          | #21                                              | anim=33, audio=318             |
| Incoming PAwR fire hit (1–3, or 5)   | *(no record — C handler reads pre-populated banks at `0x80DA14` / `0x8089FC` set by record 3)* | (no script — handler plays synchronously) | anim=31, audio=316 (hit index) |
| Alarm — entering damaged state (4th hit) | *(same as hit)* | (no script) | anim=31, audio=316 (alarm index) |
| Explosion — destroyed (6th hit, 2nd in damaged state) | *(same as hit)* | (no script) | anim=31, audio=316 (explosion index) |

### How a TIE Fighter tag would differ

- **Record 1:** different `content_lo`/`content_hi` → different xorshift32 PRNG seed → different variant selections within scripts
- **Record 3:** *still* `content_ref=24` (selects the same script #42 — the combat orchestrator is shared across all ship tags)
- **Record 3 bank values:** different `bank_index` / `bank_ref` → different animation.bin and audio.bin entries → different sounds and LED patterns for the same gameplay logic
- Records 2, 4, 5 likely follow similar patterns — same scripts, different banks

### How a non-combat tag (e.g. R2-D2) would differ

- `type_byte = 0x03` (identity, not item)
- PAwR content type ≠ 0x02/0x04 → no PAwR session is started
- **No record with `content_ref = 24`** → script #42 never runs → hit counter state never drives playback (the counter itself still exists in firmware state but nothing observes it)
- Typically fewer records total — R2-D2's 74-byte payload can fit maybe 3 records vs. X-Wing's 5, reflecting its simpler interaction set

### Explicit caveats on this example

1. **Byte values are fabricated.** Every `A3 B7 C4 D1`, every bank_index, every bank_ref is a placeholder. The real values require either decryption or observing RAM after a real scan.
2. **Record count is a guess.** A 107-byte tag could contain 4, 5, or 6 records depending on TLV overhead and any padding/metadata the ASIC inserts. The firmware parser iterates until offset == total size, so any count is possible.
3. **Framing uncertainty.** The 4-byte TLV header `[type_id:2][content_length:2]` is documented, but the exact interleaving between layer-1 sub-records (3-byte header, from the ASIC register dispatcher at `0x10600`) and layer-2 assembled records (4-byte header, from the accumulator at `0x4EC58`) could differ from my guess.
4. **Tail contents are speculative.** The trailing bytes almost certainly aren't plain padding — real AEAD schemes would carry a MAC there. But whether the MAC is in the encrypted payload or stripped by the ASIC before handoff is unknown.
5. **The example cannot be validated against real tags** until encryption is broken. It is a *structural guide*, not a data reference.

This example exists to make the architecture concrete. It is not a specification.
