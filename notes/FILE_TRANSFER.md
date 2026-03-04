# LEGO Smart Play — File Transfer & Data Channels

> Reverse engineered from HCI captures and ConnectKit SDK class definitions. File transfer state machine is inferred from decompiled code — actual wire behaviour may differ. May contain errors.

## Overview

Data channels handle bulk file operations — telemetry, fault logs, firmware. Register commands use the Control Point (see [PROTOCOL.md](PROTOCOL.md)).

## Data Channel Characteristics

| Characteristic | UUID | Role |
| --- | --- | --- |
| Data Channel 1 (FTC) | `005f0003-2ff2-4ed5-b045-4c7463617865` | File Transfer Control — commands and acks |
| Data Channel 2 (FTD) | `005f0004-2ff2-4ed5-b045-4c7463617865` | File Transfer Data — bulk payload delivery |
| Data Channel 3 | `005f0005-2ff2-4ed5-b045-4c7463617865` | Authentication / unused in normal operation |

## On-Device Files

3 files on-device:

| Handle | Name | Permissions | Typical Size | Description |
| --- | --- | --- | --- | --- |
| 1 | Firmware | 0x0200 (read-only) | 1,048,572 bytes (~1 MB) | Firmware image |
| 2 | FaultLog | 0x0500 (read/write) | 0–5 bytes | Crash/fault data |
| 3 | Telemetry | 0x0500 (read/write) | 20–675 bytes (varies) | Usage telemetry |

The ConnectKit SDK also defines Slot0/Slot1 asset storage handles, but these aren't present on current firmware.

## File List Protocol

Request the file list by writing to FTC:

```
→ FTC:  01 00 00 00 00 00 00 00 08 00 00 01    Request file list
← FTC:  02 00 00 00 00 30 00                    Ack (file list ready)
← FTD:  00 01 03 [file entries...]              File list data
← FTC:  0A 00 00                                End of transfer
```

### File List Header (8 bytes)

```
Byte 0:    Page/fragment index (0x00)
Byte 1:    First file handle (0x01)
Byte 2:    File count (0x03)
Bytes 3–7: Reserved (zeros)
```

### File Entry Format (40 bytes each)

```
Bytes 0–1:   File handle (uint16 LE)
Bytes 2–3:   Permissions (uint16 LE)
Bytes 4–7:   File size (uint32 LE)
Bytes 8–23:  File name (16 bytes, null-padded ASCII)
Bytes 24–39: Version string (16 bytes, null-padded ASCII)
```

### Permission Flags

| Bit | Name |
| --- | --- |
| 1 | Read |
| 2 | Write |
| 4 | Erase |
| 8 | Verify |

## Reading a File

Example: reading Telemetry (handle 3):

```
→ FTC:  01 03 00 00 00 00 00 00 08 00 00 01    Request file handle 3
← FTC:  02 03 00 00 00 30 00                    Ack
← FTD:  00 [file data...]                       File content (may span multiple notifications)
← FTD:  [continuation...]                       Additional fragments
← FTC:  0A 03 00                                End of transfer
→ FTC:  05 03 00                                Confirm receipt
← FTC:  06 03 00 00                             Ack
```

### Data Channel Command Types

| Command | Response | Direction | Meaning |
| --- | --- | --- | --- |
| `01 HH 00 ...` | `02 HH 00 ...` | FTC → FTC | Request file / ack |
| `05 HH 00` | `06 HH 00 00` | FTC → FTC | Confirm receipt / ack |
| — | `0A HH 00` | ← FTC | End of transfer |
| — | `00 [data...]` | ← FTD | File data fragment |

`HH` is the file handle byte.

## Telemetry Data Format (TELM)

Telemetry starts with a TELM header:

```
Byte 0:      Fragment index
Bytes 1–4:   "TELM" ASCII marker
Byte 5:      Version (0x02)
Bytes 6–7:   Reserved (0x0000)
Byte 8:      Padding (0x00)
Bytes 9–14:  MAC address (6 bytes, reversed byte order)
Bytes 15–16: Separator (0x00 0x00)
Bytes 17+:   Encrypted telemetry payload
```

## Firmware Upload

### Transfer Constants

- **Max chunk size (FTD):** 100 bytes
- **Max asset space:** ~7 MB (7,331,280 bytes)
- **File type:** Bulk (0) for complete files, Stream (1) for streaming data

### Upload Flow

1. Check `UpgradeState` register (0x85) == Ready (0)
2. Upload firmware in chunks via FTC/FTD (max 100 bytes per chunk)
3. Verify uploaded firmware
4. Write register `DisconnectConfigureFotaAndReset` (0x26) to trigger FOTA reboot

### WDX Firmware Header

```
Format, Flags, Length, Checksum, Signature,
Product (AudioBrick=0, PanelCharger=1),
HardwareVersion, UpgradeVersion,
SegmentTableOffset, SegmentTableCount
```

### WDX Upload State Machine

```
Upload(2) → PrepareChunk(3) → AwaitChunkUploadRequestResponse(5)
→ UploadChunk(6) → AwaitChunkUploadedResponse(7) → Done(8)
```

### Verification / Erase Status

| Value | Status |
| --- | --- |
| 0 | Success |
| 1 | Failure |

## Erasing a File

FaultLog and Telemetry have the Erase permission:

```
EraseFile(28) → SendEraseFileRequest(29) → GetEraseFileResponse(30)
```
