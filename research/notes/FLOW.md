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
| 0x0E | Timer/idle | 16 | Ambient play sequences |
| 0x10 | Button/shake | 4 | Physical interaction responses |

A Vader minifig might carry resource reference records that select one script from type 0x03 (tag scan), one from 0x0E (idle), one from 0x10 (button), and one from 0x09 (NPM) — each with independently chosen audio and animation banks.

### 8. Execution

Once scripts are loaded, the play engine runs them as events occur:

- **Tag placed** → fires the type 0x03 or 0x06 script
- **Idle timer** → fires the type 0x0E script (firmware hardcodes preset type at `0x50A20`)
- **Button/shake** → fires the type 0x10 script (firmware hardcodes preset type at `0x50A94`)
- **NPM proximity** → fires the type 0x09 script (firmware routes NPM events to type 0x09)
- **PAwR combat** → scripts with PAwR capability flag use opcode 21 to send/receive BrickNet messages

Each script is a linearized semantic tree executed by the bytecode interpreter. Scripts reference audio clips and LED animations by index within the banks selected by the tag's resource references. The xorshift32 PRNG (seeded by the content identity) introduces variation — different audio clips or LED patterns each time the same event fires.

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
