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

Tag memory is **fully readable** using standard ISO 15693 commands from any NFC-capable phone — **no authentication required**. Earlier NXP TagInfo scans reported "0 bytes" because the app relied on the Get System Info memory size field, which this custom IC reports incorrectly; the actual memory is accessible via Read Single/Multiple Block commands.

#### Identity Tag (Smart Minifig) — Scanned via Android NFC Tools

| Field | Value |
| --- | --- |
| UID | `E0:16:5C:01:25:84:18:BE` |
| Technology | ISO/IEC 15693 (NfcV) |
| IC Manufacturer | EM Microelectronic (code `0x16`) |
| IC Reference | `0x17` (custom LEGO die — **not** EM4233SLIC) |
| DSFID | `0x00` |
| AFI | `0x00` |
| Memory | 66 blocks × 4 bytes = **264 bytes** |
| Data payload | 157–158 bytes (blocks 0–39), remainder zeros |

`E0` is the ISO 15693 allocation class. Byte 2 (`0x16` = 22) is the IC manufacturer code — **EM Microelectronic** (the same company that makes the EM9305 BLE SoC). IC reference `0x17` does **not** match any off-the-shelf EM product (EM4233SLIC = `0x02`, EM4233 = `0x09`). This is a **custom LEGO die** fabricated by EM Microelectronic with 66 blocks (vs 32 for EM4233SLIC, 64 for EM4233).

#### Get System Info Response

```
Command:  02 2B
Response: 00 0F BE 18 84 25 01 5C 16 E0 00 00 00 41 03 17
          │  │  └─────────UID──────────┘  │  │  └──mem──┘  │
          │  info_flags                  DSFID AFI  66×4  IC_ref
          flags (no error)
```

#### Reading Commands

Standard ISO 15693 reads work without any Login or authentication:
- `02 20 XX` — Read Single Block (block XX)
- `02 23 XX YY` — Read Multiple Blocks (start XX, count YY)
- `02 2B` — Get System Information

No custom commands (`0xA0`–`0xDF`) or Login (`0xE4`) are needed.

#### Raw Memory Dumps — Identity Tags (Smart Minifigs)

**Tag 1: Pilot Luke Skywalker** — UID `E0:16:5C:01:25:84:18:BE`

```
Block  0: 00 9D 01 0C    Block 16: 12 13 1F 33    Block 32: 04 3B 47 4E
Block  1: 01 86 84 CC    Block 17: DD BB E1 94    Block 33: AE 60 D5 9B
Block  2: 84 C0 2C 26    Block 18: 1D B0 E7 15    Block 34: 43 D5 D8 38
Block  3: 17 C7 F2 2F    Block 19: 6A 31 BA 42    Block 35: 88 B2 61 78
Block  4: 6A FB FC 1A    Block 20: C6 12 BA 1E    Block 36: C1 C6 83 1F
Block  5: EA C1 43 C3    Block 21: 3F 72 82 4A    Block 37: F2 03 0E 10
Block  6: 7B F1 0E E8    Block 22: B7 F2 9E C3    Block 38: 57 2C 85 95
Block  7: E4 2D 41 53    Block 23: C3 C5 17 47    Block 39: 29 00 00 00
Block  8: 42 8F 59 68    Block 24: 02 D3 79 13    Blocks 40-65: 00 00 00 00
Block  9: 1F B1 0B DD    Block 25: A5 05 D0 49
Block 10: 15 83 B5 D7    Block 26: 52 9F C1 8B
Block 11: FF 42 7A 4C    Block 27: 25 49 49 46
Block 12: 29 EF 2B 2F    Block 28: CA 0D 0A 8D
Block 13: F7 50 5A D1    Block 29: 2F 53 9B A2
Block 14: 11 61 D8 49    Block 30: B3 50 2B 7F
Block 15: E2 65 14 F3    Block 31: F4 93 DF A6
```

**Tag 1b: Jedi Luke Skywalker** — UID `E0:16:5C:01:1D:37:E8:50`, Content ID `0x9D`

```
Block  0: 00 9D 01 0C    Block 16: 12 13 1F 33    Block 32: 04 3B 47 4E
Block  1: 01 86 84 CC    Block 17: DD BB E1 94    Block 33: AE 60 D5 9B
Block  2: 84 C0 2C 26    Block 18: 1D B0 E7 15    Block 34: 43 D5 D8 38
Block  3: 17 C7 F2 2F    Block 19: 6A 31 BA 42    Block 35: 88 B2 61 78
Block  4: 6A FB FC 1A    Block 20: C6 12 BA 1E    Block 36: C1 C6 83 1F
Block  5: EA C1 43 C3    Block 21: 3F 72 82 4A    Block 37: F2 03 0E 10
Block  6: 7B F1 0E E8    Block 22: B7 F2 9E C3    Block 38: 57 2C 85 95
Block  7: E4 2D 41 53    Block 23: C3 C5 17 47    Block 39: 29 00 00 00
Block  8: 42 8F 59 68    Block 24: 02 D3 79 13    Blocks 40-65: 00 00 00 00
Block  9: 1F B1 0B DD    Block 25: A5 05 D0 49
Block 10: 15 83 B5 D7    Block 26: 52 9F C1 8B
Block 11: FF 42 7A 4C    Block 27: 25 49 49 46
Block 12: 29 EF 2B 2F    Block 28: CA 0D 0A 8D
Block 13: F7 50 5A D1    Block 29: 2F 53 9B A2
Block 14: 11 61 D8 49    Block 30: B3 50 2B 7F
Block 15: E2 65 14 F3    Block 31: F4 93 DF A6
```

Data is **byte-for-byte identical** to Tag 1 (Pilot Luke Skywalker). Different physical minifig, different UID, same content.

**Tag 2: Darth Vader** — UID `E0:16:5C:01:1F:C8:8E:45`, Content ID `0xA9`

```
Block  0: 00 A9 01 0C    Block 16: 88 5F 47 57    Block 32: 90 B8 88 B6
Block  1: 01 2A 72 06    Block 17: 30 80 09 64    Block 33: 08 57 3C D2
Block  2: 94 F4 E5 26    Block 18: 0D C5 9A 51    Block 34: 6E 29 A8 1A
Block  3: 64 D6 CA C9    Block 19: 88 F9 DD 30    Block 35: E2 E3 5E A0
Block  4: 21 D9 96 98    Block 20: 88 A9 E6 03    Block 36: 30 11 7D F4
Block  5: 19 C2 F2 53    Block 21: 99 A3 EC E7    Block 37: 48 80 E8 03
Block  6: 7B 9A 87 CB    Block 22: 46 87 3A B6    Block 38: 53 13 DF 2D
Block  7: D0 48 9F 30    Block 23: EE 87 53 73    Block 39: 46 79 2F C3
Block  8: 60 2F 81 8A    Block 24: FE 22 30 F7    Block 40: 76 24 8C DE
Block  9: 63 DA E3 9F    Block 25: 6C DA 7A 90    Block 41: 9A 65 84 C3
Block 10: 71 4F 6A 7E    Block 26: 54 AE 2A 2F    Block 42: 3F 00 00 00
Block 11: 77 E4 33 2E    Block 27: 11 55 59 15    Blocks 43-65: 00 00 00 00
Block 12: 62 09 F8 DE    Block 28: 2E 4B A3 69
Block 13: 49 89 1D D7    Block 29: E3 01 25 55
Block 14: 2C 57 29 4D    Block 30: 21 4F DB 4F
Block 15: BA E3 E9 A0    Block 31: A5 F0 B7 95
```

**169 bytes of data** (blocks 0–42).

**Tag 3: Emperor Palpatine** — UID `E0:16:5C:01:1F:BB:14:18`, Content ID `0xAB`

```
Block  0: 00 AB 01 0C    Block 16: 7D 12 B5 71    Block 32: E9 AD DC C8
Block  1: 01 07 24 FD    Block 17: AE 4A EF DA    Block 33: 4F 9D CF D5
Block  2: 04 5C A7 E3    Block 18: B9 43 82 36    Block 34: FC CD 00 01
Block  3: FD 2A BD 4E    Block 19: 79 CF D2 1B    Block 35: 5A C4 7B 82
Block  4: 94 2E 07 69    Block 20: 6E E8 76 59    Block 36: AB D3 EC 99
Block  5: 6A 35 FC BB    Block 21: 1C D9 04 11    Block 37: 35 51 74 B5
Block  6: 9C 55 31 EE    Block 22: 24 FF 3A 0A    Block 38: F5 50 EF FD
Block  7: 69 46 A5 4E    Block 23: 21 C2 5A 9D    Block 39: B0 4A 01 8A
Block  8: 3A 4C 25 84    Block 24: 73 7A 02 7D    Block 40: 96 53 4D 21
Block  9: 76 4D 27 FA    Block 25: 3C E4 D4 FF    Block 41: 1E 74 67 17
Block 10: 53 AF BD E7    Block 26: 32 78 31 32    Block 42: 2E 02 03 00
Block 11: DF 9A A5 55    Block 27: A2 3B 7B A5    Blocks 43-65: 00 00 00 00
Block 12: 7B F2 C4 6B    Block 28: 74 50 26 12
Block 13: 72 9F E6 DB    Block 29: ED 41 5B C0
Block 14: 80 AC 0B D8    Block 30: BA 1C 6C 57
Block 15: A9 96 46 57    Block 31: 3C C5 CB C7
```

**171 bytes of data** (blocks 0–42).

**Tag 4: Leia** — UID `E0:16:5C:01:1F:B7:A4:70`

```
Block  0: 00 9E 01 0C    Block 16: E7 1D AE D2    Block 32: 68 7B 7A 4A
Block  1: 01 48 12 5F    Block 17: 4B 8A BC 1F    Block 33: D2 B2 E2 F3
Block  2: 4E B3 0B 49    Block 18: D1 DC 93 B3    Block 34: 82 0F 37 C2
Block  3: F3 76 E9 6F    Block 19: 7C 8B 63 4B    Block 35: 02 12 D3 58
Block  4: A8 44 DE 7D    Block 20: 69 FD C4 B0    Block 36: AD 53 A1 6A
Block  5: DE C1 FC 45    Block 21: FD BC 5D E7    Block 37: 3E 1B 73 D4
Block  6: 92 A2 E9 D7    Block 22: E2 2C 98 F2    Block 38: D9 62 94 E1
Block  7: 9C 46 B8 F1    Block 23: 97 B2 8D EB    Block 39: 98 95 00 00
Block  8: A0 FE 43 0A    Block 24: 93 58 71 75    Blocks 40-65: 00 00 00 00
Block  9: EE 8B 31 A2    Block 25: 0E 7E 69 2B
Block 10: 6F 6F A3 05    Block 26: CE AA 93 43
Block 11: DD 78 21 D6    Block 27: 5B E9 2C 45
Block 12: BD 33 1D C2    Block 28: C3 68 F2 D3
Block 13: 04 21 2D EE    Block 29: E2 79 C3 15
Block 14: 69 98 E3 F8    Block 30: D5 82 BC FE
Block 15: 1C 6B 8E 9D    Block 31: D8 55 D1 37
```

**Tag 5: R2-D2** — UID `E0:16:5C:01:26:19:58:B2`, Content ID `0x4A`

```
Block  0: 00 4A 01 0C
Block  1: 01 24 B4 10
Block  2: E7 C0 D0 7D
Block  3: 2D FD B5 13
Block  4: F9 0D 49 9A
Block  5: 3C B6 45 4F
Block  6: FB 90 BF 80
Block  7: 59 18 C1 85
Block  8: 68 57 0F CE
Block  9: FE 3D D8 60
Block 10: 47 B1 C9 05
Block 11: 2B 16 AE A1
Block 12: 7C 4C 16 B4
Block 13: AF AF 94 82
Block 14: D5 9F A9 41
Block 15: 69 C3 1F F0
Block 16: F9 EB 13 13
Block 17: 86 13 E2 41
Block 18: F1 71 00 00
Blocks 19-65: 00 00 00 00
```

**Physically a tile** (attaches to the back of an R2-D2 minifig), but the brick treats it as an Identity tag (minifig character). **74 bytes of data** (blocks 0–18, block 18 partial) — the smallest tag seen so far, even smaller than Item tiles. The Identity-vs-Item classification is in the encrypted payload, not visible in cleartext.

#### Raw Memory Dumps — Item Tags (Smart Tiles)

**Tag 6: Lightsaber Tile** — UID `E0:16:5C:01:1B:F7:4D:57`, Content ID `0x7E`

```
Block  0: 00 7E 01 0C    Block 16: 8C B7 25 DA
Block  1: 01 6D BC B0    Block 17: 9D 6B 10 82
Block  2: 50 6C DA ED    Block 18: 3D 2B EF 36
Block  3: CF D2 A4 62    Block 19: DE 8E 71 32
Block  4: 54 05 A4 8D    Block 20: F8 E2 CF 9F
Block  5: 51 59 FB CA    Block 21: 25 71 78 86
Block  6: 70 6F 56 FF    Block 22: EC 48 30 2C
Block  7: C1 D1 FD 22    Block 23: EE 55 A9 D3
Block  8: BD 52 C8 71    Block 24: 17 80 93 E1
Block  9: 1A 0B 55 11    Block 25: 51 72 59 F3
Block 10: 3E 04 81 2B    Block 26: 10 EB 6A 8C
Block 11: 9C D2 DD B0    Block 27: 44 B2 93 C5
Block 12: 0D C0 D9 F2    Block 28: 96 9F F1 9A
Block 13: 5B D5 1B BB    Block 29: 54 1F D3 87
Block 14: D9 7A 0A 2A    Block 30: 58 91 0D F4
Block 15: BA 97 2F 9E    Block 31: 01 94 00 00
                         Blocks 32-65: 00 00 00 00
```

**126 bytes of data** (blocks 0–31, block 31 partial). Blocks 32–65 are all zeros.

**Tag 7: Lightsaber Tile** — UID `E0:16:5C:01:1B:FE:9F:53`, Content ID `0x7E`

Data is **byte-for-byte identical** to Tag 6 (same content ID `0x7E`, same 126 bytes). See "Cloning Discovery" below.

**Tag 8: X-Wing Tile** — UID `E0:16:5C:01:21:E2:94:ED`, Content ID `0x6B`

```
Block  0: 00 6B 01 0C    Block 16: DB 4A D1 13
Block  1: 01 24 D4 3E    Block 17: BC A3 04 18
Block  2: 82 9F 37 1F    Block 18: 02 6C AD EB
Block  3: 47 AB 8F 36    Block 19: 41 C9 71 CC
Block  4: 36 42 63 71    Block 20: AE C1 CD DC
Block  5: D5 54 F2 B8    Block 21: 92 79 8E 13
Block  6: F4 C5 B5 AF    Block 22: 25 97 06 A2
Block  7: E9 10 BF 00    Block 23: 3D 39 E9 D6
Block  8: 83 33 2F 74    Block 24: F4 1E 33 9B
Block  9: F7 CA 47 EF    Block 25: B2 B9 AF 46
Block 10: 1A B0 79 86    Block 26: C2 22 E8 00
Block 11: 41 4E CE CA    Blocks 27-65: 00 00 00 00
Block 12: BD 34 F8 DA
Block 13: A6 79 C6 47
Block 14: 35 BD 10 31
Block 15: 3C 37 F8 DC
```

**107 bytes of data** (blocks 0–26, block 26 partial). Blocks 27–65 are all zeros.

#### Tag Comparison

All tags share the same **5-byte cleartext header** `00 XX 01 0C 01`, where byte 1 is the content ID:

```
               Byte 0  Byte 1  Byte 2  Byte 3  Byte 4   Payload   Blocks used
Luke (ID):       00     9D      01      0C      01      157 bytes   0–39
Vader (ID):      00     A9      01      0C      01     ~169 bytes   0–42
Palpatine (ID):  00     AB      01      0C      01     ~171 bytes   0–42
Leia (ID):       00     9E      01      0C      01      158 bytes   0–39
R2-D2 (ID*):     00     4A      01      0C      01       74 bytes   0–18
Lightsaber:      00     7E      01      0C      01      126 bytes   0–31
X-Wing:          00     6B      01      0C      01      107 bytes   0–26
```

| Byte | Value | Meaning |
| --- | --- | --- |
| 0 | `0x00` | Fixed across all known tags — always zero |
| 1 | varies | **Content ID** (observed) |
| 2 | `0x01` | Fixed across all known tags |
| 3 | `0x0C` | Fixed — format version or flags |
| 4 | `0x01` | Fixed — unknown |

**Content ID field size is uncertain.** Byte 1 varies per tag and is the only byte observed to change, but bytes 0 and 2 being constant across just 7 known tags doesn't prove they aren't part of a wider content ID field. A future firmware/tag generation could use bytes 0 and/or 2 to extend beyond 255 unique IDs. We cannot determine the true field width because:

1. **The EM9305 firmware never sees the cleartext header.** The ASIC reads raw EEPROM, decrypts it, and sends a restructured response over SPI. The firmware contains zero references to any known content ID value (`0x9D`, `0xA9`, etc.) or header constants (`0x0C`).
2. **The companion app has no NFC functionality.** The SmartAssist app communicates with the brick over BLE only — it never reads tags directly via phone NFC. No tag content ID parsing exists in the IL2CPP dump.
3. **The cleartext content ID is consumed solely by the ASIC silicon.** It likely selects the decryption key/route, but the ASIC's internal logic is opaque. The actual content identity used by the play engine comes from the **decrypted payload** as a 32-bit content reference (offset 8 of the tag event struct).

The cleartext header may exist for future use cases (e.g., phone-based tag identification without decryption) or may be purely an ASIC-internal routing mechanism.

**Item tags are shorter than Identity tags.** Identity tags use ~157–169 bytes across blocks 0–39 (or 0–42 for Vader); Item tiles use ~107–126 bytes across blocks 0–26/31. Both types leave remaining blocks as zeros.

The two Item tiles have **different content IDs** (`0x7E` = Lightsaber, `0x6B` = X-Wing) — each tile content gets its own ID, as expected.

#### Known Content IDs

| ID | Tag Type | Content |
| --- | --- | --- |
| `0x4A` | Identity (tile*) | R2-D2 — physically a tile, acts as Identity minifig |
| `0x6B` | Item (tile) | X-Wing |
| `0x7E` | Item (tile) | Lightsaber |
| `0x9D` | Identity (minifig) | Luke Skywalker (Pilot Luke / Jedi Luke confirmed identical) |
| `0x9E` | Identity (minifig) | Leia |
| `0xA9` | Identity (minifig) | Darth Vader |
| `0xAB` | Identity (minifig) | Emperor Palpatine |

#### Encrypted Region (bytes 5+)

From byte 5 onward, tags with **different content IDs** are completely different — XOR produces uniformly distributed output (~6.4 bits/byte entropy), consistent with AES or similar block cipher encryption.

#### Cloning Discovery

Two physical Lightsaber tiles (Tags 6 and 7) with **different UIDs** contain **byte-for-byte identical EEPROM data**:

| | UID | Content ID | Data |
| --- | --- | --- | --- |
| Tag 6 | `E0:16:5C:01:1B:F7:4D:57` | `0x7E` | 126 bytes |
| Tag 7 | `E0:16:5C:01:1B:FE:9F:53` | `0x7E` | 126 bytes (identical) |

This proves:
1. **Encryption is NOT UID-diversified** — the UID plays no role in the ciphertext
2. **All tags of the same content type have identical EEPROM data** — it's a fixed blob per content ID
3. **Cloning should work** — writing the raw bytes to any compatible ISO 15693 tag should produce a working clone
4. **Custom tags are feasible** — if the encrypted format can be understood, new content blobs could potentially be crafted

The ASIC does **not** use the tag UID for decryption. The encrypted data is a static per-content-ID payload programmed identically into all physical tags of that type at the factory.

#### Security Model

LEGO's tag security operates at **two layers**:

1. **EM9305 ↔ ASIC authentication** (AES-128 + ECC): The EM9305 firmware derives a 16-byte key from ROFS config data + hardware OTP, written to ASIC register `0xF04084`. This authenticates the EM9305 to the ASIC — prevents rogue processors from using the ASIC. Per-brick unique (hardware OTP dependent).

2. **Tag data encryption** (algorithm unknown, in ASIC silicon): Raw EEPROM content is encrypted. The ASIC decrypts it after reading, before passing to the EM9305. The decryption key is in the ASIC's internal logic — not accessible from the EM9305 firmware or via JTAG. All bricks share the same decryption capability (tags work on any brick).

Tag access itself is **completely open** — no password, no page protection, no privacy mode. Anyone with an NFC reader can dump the raw EEPROM. But the data is meaningless without the ASIC's decryption key.

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
  ┌─────────────────────────────────────────────────────────────┐
  │  ASIC Coils (13.56 MHz ISO 15693 RF)                       │
  │  → Inventory, anti-collision, tag read — all in hardware    │
  └────────────────────┬────────────────────────────────────────┘
                       │ Memory-mapped registers (0xF01800–0xF04BFF)
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  SPI Driver (0x32304–0x326D0)                               │
  │  → Status via 0xF0180C, data via 0xF01808                  │
  │  → DMA via 0xF01814, 512-byte transfers                    │
  │  → 14 × 32-bit words copied from 0xF01810+                 │
  └────────────────────┬────────────────────────────────────────┘
                       │ Coil interrupt (vector 0xAA, level 0x12)
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Interrupt Handler (0x3B728)                                │
  │  → Per-channel dispatch from handler table at 0x808854      │
  │  → 600ms timer-based coil scheduling                       │
  └────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  ASIC-to-RAM Copy (0x69944–0x699E2)                        │
  │  → 4 × 20-byte blocks to 0x8078A8–0x8078E4                │
  │  → Dirty bits set in 0x807890/0x807898 (atomic)            │
  └────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Tag Scan Loop (0x67634)                                    │
  │  → Polls 0x501E8 for tag presence                          │
  │  → Gets buffer via 0x501FC                                 │
  │  → Dual-read + complement validation                       │
  └────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  UID Extraction (0x4FC58)                                   │
  │  → Parses ISO 15693 response flags (bit 0=error, bit 3=fmt)│
  │  → Extracts 6-byte UID → (32-bit low, 16-bit high)        │
  │  → Compares against stored UID at 0x809430                 │
  └────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Message Dispatcher (0x1D2A8)                               │
  │  → Handler table at 0x80B514                               │
  │  → Type 2 → TLV parser, Type 4 → removal, Type 5 → play  │
  └────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  TLV Content Parser (0x4EC58)                               │
  │  → Structure at 0x80B538, max size at 0x80B580             │
  │  → Block type 0x2000 = new packet, 0x1000 = continuation   │
  │  → Reassembles multi-packet TLV data                       │
  └────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Content Callback + Manufacturer Dispatch (0x5C96C)         │
  │  → FNV hash dedup at 0x1D27E                               │
  │  → IC manufacturer dispatch: EM(0x16)/TI(0x07)/ST(0x0D)   │
  │  → 2D handler table at ROM 0x37CF00 + state machine        │
  └────────────────────┬────────────────────────────────────────┘
                       │
                       ▼
  ┌─────────────────────────────────────────────────────────────┐
  │  Play Engine Action Handlers (0x35xxxx)                     │
  │  → Content indexing → play.bin script selection             │
  │  → Semantic tree executor starts                           │
  └─────────────────────────────────────────────────────────────┘
```

Tag polling runs on a **600ms timer** — the ASIC periodically scans for tag presence.

### Tag Discovery (BLE Interface)

Development firmware (v0.54 and earlier) referenced `rpc_handlers_tag_int.c`, suggesting tag events were once planned for BLE exposure. In production firmware v0.72.1, the complete WDX dispatch table was enumerated and **no tag-event registers exist**. The tag pipeline is a closed loop: physical RFID → ASIC → EM9305 firmware → play engine. There is no BLE path to inject or observe tag events.

Register `0x92` (undocumented, read-only) returns a single status byte from `0x807A78` — the ASIC status register. It may reflect NFC reader state but cannot accept injected tag data.

### Tag Protocol Architecture

The ISO 15693 RF protocol is handled **entirely by the DA000001-01 ASIC**, not the EM9305 firmware. The EM9305 does not construct ISO 15693 command frames, calculate CRC-16, or implement anti-collision. Instead, it communicates with the ASIC through two interfaces:

1. **Memory-mapped hardware registers** at `0xF04000`–`0xF044FF` — direct hardware control
2. **Software register interface** — ~64 registers (IDs 0x02–0x3E) mirrored in RAM at `0x8078A0`–`0x807AA8`

The EM9305 writes configuration to ASIC registers; the ASIC performs the ISO 15693 inventory, anti-collision, and tag read autonomously, then deposits results into registers for the EM9305 to read.

#### ASIC Hardware Registers (Tag-Related)

Two register ranges: `0xF04000`–`0xF040FF` for low-level tag/coil control, `0xF04400`–`0xF04BFF` for tag operations and FIFO.

| Address | R/W | Name | Purpose |
| --- | --- | --- | --- |
| `0xF04004` | R | TAG_CTRL | Status / config readback |
| `0xF04008` | W | TAG_CMD | Full command word (`0x93C` = inventory+read). Used for coil modes 2–3 |
| `0xF04009` | W | TAG_SUBCMD | Simple command select: 0=basic inventory, 1=addressed mode. Used for coil modes 0–1 |
| `0xF0400C` | RW | TAG_TIMING | Timing / carrier configuration |
| `0xF04034` | W | TAG_CONFIG | General tag configuration |
| `0xF04040` | RW | SLOT_CTRL | Slot / channel control |
| `0xF04044` | W | ANTICOLL_MASK | Anti-collision mask (standard ISO 15693 16-slot: `0x5555`, `0xFFFF`, `0x3333`, `0x0F0F`, `0xFF`) |
| `0xF04050` | RW | ANTICOLL_CFG | Anti-collision config (bit 4 = addressed mode) |
| `0xF04054` | R | TAG_STATUS | Tag presence: bit 5=detected, bit 6=active, bit 7=data valid, bits 8-9=type |
| `0xF04079` | W | IRQ_CONFIG | Interrupt configuration |
| `0xF04080` | RW | DMA_CONFIG | DMA / transfer configuration |
| `0xF040A4` | W | COIL_CAL_A | Coil calibration A |
| `0xF040A8` | R | COIL_CAL_B | Coil calibration B (readback) |
| `0xF040B0` | W | COIL_TRIM | Coil trim X/Y (packed via `vpack2hl`) |
| `0xF040BC` | RW | SLOT_MASK | Slot enable mask / per-slot anti-collision results |
| `0xF04400` | W | RF_ENABLE | RF field control: 4=tag scan, 1=positioning mode |
| `0xF04401` | W | RF_MODE | RF mode: 1=positioning, 3=extended range |
| `0xF04404` | W | OP_TRIGGER | Operation trigger/reset (0=reset before new op) |
| `0xF0440C` | R | OP_STATUS | Operation status: bit 0=complete, bit 1=data ready |
| `0xF04410` | W | POS_OFFSET | Position offset X/Y (packed via `vpack2hl`) |
| `0xF04420` | W | TAG_DATA_W | Tag data write register |
| `0xF04424` | W | TAG_SLOT_CMD | Tag slot command: bits 0-5=slot index (0–39), bits 10-11=2-bit type (from slot struct offset 80) |
| `0xF04428` | R | TAG_DATA_R | Tag response data (halfword) |
| `0xF0484C` | RW | COIL_CONFIG | Coil drive: bits 2-5=drive level, bits 6-11=field strength, bit 14=extended range |
| `0xF04800`–`0xF04BFF` | W | FIFO | 256-entry halfword TX FIFO — data loaded here gets transmitted in the ISO 15693 RF frame |

**Command register protocol:** Modes 0–1 use the simple `TAG_SUBCMD` register (0/1 toggle selects between two pre-configured ASIC command sequences). Modes 2–3 use the full `TAG_CMD` register with command word `0x93C` — this is an ASIC-native opcode, **not** a raw ISO 15693 command byte. The ASIC generates ISO 15693 RF frames internally. Data payloads are loaded into the FIFO at `0xF04800+` before triggering the command.

**Coil configuration table** at ROM `0x3062E8`: Per-mode 3-byte entries (drive level, field strength, extended flag). Values scale from low-power (mode 0: drive=1, strength=0xDF) to high-power (mode 25+: drive=0x25, strength=0xFD). Applied to `COIL_CONFIG` register at `0xF0484C`.

#### ASIC Software Registers (Tag Data in RAM)

~64 registers (IDs 0x02–0x3E) mirrored in RAM at `0x8078A0`–`0x807AA8`. A dirty bitmap at `0x807890` and pending bitmap at `0x807898` track which registers have been updated (set atomically via `clri`/`seti`).

| Reg ID | RAM Address | Size | Purpose |
| --- | --- | --- | --- |
| 0x04 | `0x8078A8` | 20 bytes | Tag data block A (coil config A) |
| 0x05 | `0x8078BC` | 20 bytes | Tag data block B |
| 0x06 | `0x8078D0` | 20 bytes | Tag data block C |
| 0x07 | `0x8078E4` | 20 bytes | Tag data block D |
| 0x09 | `0x8078F8` | packed 16-bit | Coil position data (via `vpack2hl`) |
| 0x0A | `0x807900` | packed 16-bit | Coil position data (via `vpack2hl`) |
| 0x16 | `0x807914` | 4 bytes | Tag UID word |
| 0x24 | `0x80792A` | 1 byte | Tag configuration byte |
| 0x2A–0x2C | `0x807930`–`0x8079F8` | 3 × 100 bytes | Large data buffers |
| 0x2E | `0x807A60` | 24 bytes | Tag data payload (complex 24-byte repack from byte pairs to 32-bit words) |
| 0x2F | `0x807A78` | 1 byte | **ASIC status byte** (exposed via WDX register 0x92) |
| 0x38 | `0x807A90` | 16 bytes | Tag UID buffer (big-endian packed) |
| 0x3D | `0x807AA2` | 6 bytes | Extended tag info (3 × 16-bit) |

#### Tag Interrupt Flow

Tag detection is interrupt-driven via `0xF00860`:

| Interrupt Bit | Meaning | Action |
| --- | --- | --- |
| Bit 25 | Tag detected | Enable coil at `0xF04400`, set flag at `0x80DF1C` |
| Bit 16 | Tag read complete | Read `0xF04054` status, check coil, extract data |
| Bit 21 | Tag data ready | Read data, check presence at `0xF0407D`, set timing (4ms or 10ms) |
| Bit 22 | Coil/antenna event | Clear interrupt, adjust scan timing |

After interrupt processing, the ASIC-to-RAM copy functions at `0x69944`–`0x699E2` transfer 4 × 20-byte tag data blocks from the ASIC result buffer into the RAM mirror. Each calls the register-change notification at `0x2A9E0`.

#### Multi-Manufacturer Tag Support

The firmware supports tags from **multiple IC manufacturers**. After tag data arrives in RAM, a manufacturer dispatch at `0x5C96C` reads the IC manufacturer code from `0x80B944+0x8` and branches to manufacturer-specific handlers:

| MFR Code | Manufacturer | Type Index | Notes |
| --- | --- | --- | --- |
| 0x07 | Texas Instruments | 0 | Secondary IC ref check required |
| 0x0D | STMicroelectronics | (check) | IC ref must be 0xF |
| 0x11 | (unknown) | (check) | IC ref must be 0x16 |
| **0x16** | **EM Microelectronic** | **2** | **Production Smart Tags** |
| 0x17 | Texas Instruments (new) | 1 | Direct accept |
| 0x18 | (other) | 1 | Same path as TI(17) |

The type index selects handler functions from a **2D dispatch table** at ROM `0x37CF00`. One dimension is the tag sub-type (r0), the other is the manufacturer type index. TI and EM tags go through **different handler functions** — the firmware does not simply treat all tags the same after inventory.

The byte table at ROM `0x37CFA0` returns a per-manufacturer configuration value used for further dispatch. The EM path consistently returns **54** for all sub-types, while TI paths return varying values (88–204). This likely reflects different tag data payload formats for each manufacturer.

**Implication for custom tags:** Standard TI or ST ISO 15693 tags would be recognized by the manufacturer dispatch, but they would go through the TI/ST handler path — not the EM path that production Smart Tags use. The TI handler functions (e.g., `0x35BF9C`) are different from the EM handler functions (e.g., `0x35BFF4`). Whether TI-format tag data can produce valid content fields through the TI path is unknown. The safest approach for custom tags is to use the EM path (manufacturer code 0x16) with properly formatted data.

#### Tag Data Format (Parsed)

The tag content parser at `0x4EC58` processes data in a TLV-style format after it reaches the RAM mirror:

```
byte[0:1]  Tag type ID (12-bit type + 2-bit block type in bits 12-13)
           block type: 0=header, 1=data continuation, 2=security
byte[2:3]  Content length (uint16 LE)
byte[4..]  Content payload (LEGO Smart Tag data)
```

This parser feeds into the tag content structure at `0x80B944`, which is the convergence point for all manufacturer paths before content enters the play engine.

#### No CRC in Firmware

The EM9305 firmware contains **no CRC-16 or CRC-32 calculation** for tag data (confirmed by exhaustive search — no CRC constants or functions found). ISO 15693 CRC-16 is handled entirely by the ASIC hardware. The `0xDEADDD00` value found in the code is an event-struct validity sentinel, not a data integrity check.

### Tag IC Identification: Custom EM Microelectronic Die

The LEGO Smart Tags use a **custom ISO 15693 IC** fabricated by EM Microelectronic. It is **not** an off-the-shelf EM4233SLIC or EM4233.

| Property | Value |
| --- | --- |
| Manufacturer | EM Microelectronic (code `0x16`) |
| IC Reference | **`0x17`** (custom — EM4233SLIC=`0x02`, EM4233=`0x09`) |
| Memory | **66 blocks × 4 bytes = 264 bytes** (vs 32 blocks for EM4233SLIC) |
| Frequency | 13.56 MHz (ISO/IEC 15693) |
| Access control | **None** — no password, no page protection, no privacy mode |
| Data protection | **Encryption** — content encrypted by ASIC, not by tag IC |
| UID format | `E0:16:XX:XX:XX:XX:XX:XX` |
| DSFID | `0x00` |
| AFI | `0x00` |

The custom die supports standard ISO 15693 commands (Inventory, Read Single/Multiple Block, Get System Info) and has significantly more memory than the EM4233SLIC (264 bytes vs 128 bytes). Whether it supports EM4233-style custom commands (EAS, Login, etc.) is unknown — they are not needed to read tag data.

#### EM4233 Family Reference (for comparison)

The EM4233 family from EM Microelectronic supports custom commands in the `0xA0`–`0xDF` range (EAS, password, page protection) and proprietary commands (`0xC3` Fast Read, `0xE4` Login). The LEGO custom die likely shares this command set architecture but with extended memory and a unique IC reference (`0x17`). None of these commands are needed to read LEGO tags — the data is accessible via standard reads.

**Key observation:** The ASIC sends command word `0x93C` to its internal command register, **not** raw ISO 15693 command bytes. The ASIC internally generates the correct ISO 15693 frames. The `0x93C` opcode is not a Login sequence — it's simply a read command, since no authentication is needed at the tag level.

### SPI Bus Architecture

The ASIC is NOT accessed via traditional SPI bit-banging. It is memory-mapped into the EM9305's address space at two register ranges:

| Range | Purpose |
| --- | --- |
| `0xF01800`–`0xF01860` | SPI/DMA control — command trigger, status, data, DMA buffer config |
| `0xF04000`–`0xF04BFF` | Tag/coil operations — command registers, anti-collision, FIFO |

The SPI driver at `0x32304`–`0x326D0` manages transfers through a 3-state machine:
- **State 0** (COMPLETE): Transfer finished, data available
- **State 1** (ACTIVE): DMA in progress, spin-wait for `0xF0180C` bit 0
- **State 2** (IDLE): Ready for new transfer, write 1 to `0xF01800` to start

ASIC link status at `0xF0383B` must have bits 0-1 = 3 (link established) before data is accepted.

### Firmware Sources

From debug strings in development builds:

```
asic.c, tag_message_parser.c, tag.c, tag_db.c,
tag_claim.c, tag_manager_impl.c (→ tag_manager.c in v0.54+),
rpc_handlers_tag_int.c
```

Debug strings were stripped in production (v0.65+) but all functional code is present — confirmed by SPI register accesses, tag UID comparison logic, interrupt handlers, and the 8-case event dispatch jump table in v0.72.1. The tag ASIC driver source is simply `asic.c` (not `tag_asic.c`).

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
