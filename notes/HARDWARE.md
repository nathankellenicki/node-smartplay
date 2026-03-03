# LEGO Smart Play — Hardware

> **Note:** Hardware details were identified from firmware binary analysis (cleartext metadata sections) and the SmartAssist APK. Chip identification is based on string matches, not confirmed markings. Some details may be wrong.

## Chipset

- **Chip:** Maxim/Analog Devices MAX32 series (likely MAX32655 or MAX32665)
- **BLE Stack:** Arm Cordio (originally Wicentric "exactLE")
- **Product identifier:** `P11_audiobrick`
- **Build string format:** `P11_audiobrick_EM-v2.29.0-gfc9910378`

The "exactLE" name appears encoded in the WDX UUID base: `005fXXXX-2ff2-4ed5-b045-4C7463617865` where `4C7463617865` = "LtcaxE" ("ExactL" reversed).

## Features

- Speaker with volume control (Low/Medium/High)
- Microphone for audio input
- Rechargeable battery with charging base
- BLE 5.4 with PAwR support
- On-device ROFS filesystem

## On-Device Content

Play content is stored in a read-only filesystem (ROFS):

- `play.bin` — Play scripts, parsed as semantic trees on-device
- `audio.bin` — Audio data
- `animation.bin` — Animation data with smooth interpolation

## PAwR Play Communication

When undocked, bricks communicate using **BLE 5.4 PAwR (Periodic Advertising with Responses)**. They do not advertise via standard BLE during play and are invisible to BLE scanners.

One brick acts as a **coordinator**, broadcasting periodic advertising trains containing play state and game events. Other bricks **synchronize** to the train and respond in designated slots. Sessions are encrypted and authenticated. No phone or app is needed — play is fully autonomous.

### Network States

Firmware analysis reveals these PAwR session states:

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
