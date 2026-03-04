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

Readable by a phone NFC reader. Example scan (NXP TagInfo):

| Field | Value |
| --- | --- |
| UID | `E0:16:5C:01:1D:37:E8:50` |
| Technology | ISO/IEC 15693 |
| IC Manufacturer | Unknown (code `0x16`) |
| Memory | 0 bytes (not readable over standard 15693) |

`E0` is the ISO 15693 flag byte. Byte 2 (`0x16` = 22) is the IC manufacturer code — unknown vendor, likely custom silicon.

LEGO calls this "near-field magnetic communication". They claim the brick can detect which face a tag is on with millimeter precision (**NFC positioning** — per Wired article, not independently verified).

Two tag types in firmware:

| Type | Description |
| --- | --- |
| **Identity** | Smart Minifigs — character identity |
| **Item** | Smart Tiles — play logic that defines the brick's role |

Tags have 64-bit IDs, checksums, and security fields. Firmware sources: `tag_asic.c`, `tag_manager_impl.c`, `tag_claim.c`, `tag_db.c`, `tag_message_parser.c`, `tag.c`.

## Play Engine

Stack-based semantic tree executor. Firmware sources:

- `semantic_tree.c` — tree structure
- `play_stack_executor.c` — stack VM
- `play_execution.c` — execution context
- `play_engine_message_handler.c` — event routing
- `ppl_preset_resolver.c` — **PPL** preset resolution (Play Programming Language?)

## On-Device Content

Read-only filesystem (ROFS):

- `play.bin` — Play scripts (semantic trees)
- `audio.bin` — Audio data
- `animation.bin` — Animation data

## Multi-Brick Communication

### Positioning (Coils)

The copper coils also sense **distance, direction, and orientation** between nearby bricks. Self-organizing — no setup, no app, no central hub.

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
