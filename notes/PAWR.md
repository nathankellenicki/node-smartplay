# PAwR / BrickNet — Capture & Decryption

Inter-brick play communication uses **BLE 5.4 PAwR** (Periodic Advertising with Responses). Internally called **BrickNet**. See [HARDWARE.md](HARDWARE.md) for protocol overview and firmware references.

This document covers the capture methodology, wire format, and XOR encryption analysis derived from passive radio sniffing of live multi-brick play sessions.

## Capture Setup

### Hardware

- **nRF52840 Dongle** (PCA10059) flashed with nRF Sniffer firmware
- Serial port: `/dev/cu.usbmodem11301`
- Tool: `nrfutil ble-sniffer sniff` (nrfutil v0.18.0+)

### Capture Commands

**Broad capture** (advertising channels only — no `--follow`):

```bash
nrfutil ble-sniffer sniff \
  --port /dev/cu.usbmodem11301 \
  --scan-follow-aux \
  --output-pcap-file /tmp/capture.pcap \
  --timeout 120000
```

**Targeted capture** (follows a specific device into data channels):

```bash
nrfutil ble-sniffer sniff \
  --port /dev/cu.usbmodem11301 \
  --follow "XX:XX:XX:XX:XX:XX" \
  --scan-follow-aux \
  --output-pcap-file /tmp/capture.pcap \
  --timeout 120000
```

### Key Limitations

- **PAwR subevent data is on secondary advertising channels**, not data channels. The `--scan-follow-aux` flag captures these without needing `--follow`. This is the important flag for PAwR.
- `--follow` is only needed to capture GATT data channel traffic (e.g. between docked brick and phone). It requires a specific BLE address.
- **Coordinator uses a random BLE address that changes on every reboot.** To use `--follow`, first run a broad capture to identify the address, then restart the sniffer.
- PCAP output is **big-endian** with LINKTYPE_NORDIC_BLE (272).
- Wireshark 4.6.4 cannot decode BLE 5.4 PAwR PDU types (0x0a–0x0f shown as "Unknown"). Custom dissection required.

### Two-Phase Capture Strategy

Because the coordinator address is unknown until the brick is powered on:

1. **Phase 1 — Discovery:** Start broad capture (no `--follow`). Power on brick 1. Wait ~5 seconds. Extract LEGO address by searching for manufacturer data pattern `1e ff 06 00 01 0f` in the pcap.
2. **Phase 2 — Targeted:** Kill sniffer. Restart with `--follow <address>`. Power on brick 2. This captures the GATT connection and data channel traffic.

In practice, PAwR subevent payloads (the actual game data) are captured in Phase 1 without needing Phase 2 at all.

## PAwR Wire Format

### Framing

PAwR subevent payloads are wrapped in BLE advertising data structures:

- **AUX_SYNC_IND** (coordinator broadcast): Manufacturer-specific data (`0xFF`), pattern `1e ff 06 00 01 0f 20 22 ...`
- **Subevent IND/RSP** (game data): Service Data AD type (`0x16`) with UUID **0xFEF3** (Arm/Cordio PAwR service)

To extract payloads from a pcap, search for the byte sequence `\x16\xf3\xfe` (type + little-endian UUID), then read `ad_length - 3` bytes of payload.

### BrickNet Message Format (25 bytes)

```
┌─────────────────────────────────────────────────┐
│ Encrypted region (16 bytes, XOR)                │
│ ┌─────────────────────────────────────────────┐ │
│ │ Bytes 0–1:  Counter/routing (XOR'd)         │ │
│ │ Bytes 2–8:  Header + opcode (XOR'd, Key A)  │ │
│ │ Bytes 9–15: Tree state low (XOR'd, Key B)   │ │
│ └─────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────┤
│ Cleartext region (9 bytes)                      │
│ Bytes 16–24: Tree state high (not encrypted)    │
└─────────────────────────────────────────────────┘
```

- **Total:** 25 bytes per message
- **Encrypted:** First 16 bytes, simple XOR with a static session key
- **Cleartext:** Last 9 bytes, sent unencrypted
- **Byte 8** (within encrypted region): Message opcode

## XOR Encryption

### Encryption Scheme

The firmware at `0x6d1fc`–`0x6d24a` applies XOR encryption:

```
wire[0]  = plaintext[0]  XOR counter_byte_0 XOR r14
wire[1]  = plaintext[1]  XOR counter_byte_1 XOR r13
wire[2]  = plaintext[2]  XOR key_a[0]
wire[3]  = plaintext[3]  XOR key_a[1]
...
wire[8]  = plaintext[8]  XOR key_a[6]
wire[9]  = plaintext[9]  XOR key_b[0]
wire[10] = plaintext[10] XOR key_b[1]
...
wire[15] = plaintext[15] XOR key_b[6]
wire[16..24] = plaintext[16..24]   (not encrypted)
```

- **Key A** (7 bytes): Stored at struct offset `+0x20`
- **Key B** (7 bytes): Stored at struct offset `+0x27`
- **Counter bytes** (2 bytes): Derived from stream state and XOR'd with r14/r13

### Session Key

The session key is established during PAwR session setup and **persists to flash across power cycles**. The same key was observed across multiple captures from different boot sessions.

**Observed key:**

```
Full 16-byte XOR key:  4a 17 23 4a 59 34 37 11 32 18 25 39 31 b5 6b f6

  Counter (bytes 0–1):  4a 17
  Key A   (bytes 2–8):  23 4a 59 34 37 11 32
  Key B   (bytes 9–15): 18 25 39 31 b5 6b f6
```

**Decryption:**

```python
KEY = bytes([0x4a, 0x17, 0x23, 0x4a, 0x59, 0x34, 0x37, 0x11,
             0x32, 0x18, 0x25, 0x39, 0x31, 0xb5, 0x6b, 0xf6])

def decrypt(wire_payload):
    decrypted = bytes(a ^ b for a, b in zip(wire_payload[:16], KEY))
    cleartext = wire_payload[16:]
    return decrypted + cleartext
```

### How the Key Was Derived (Known-Plaintext Attack)

The XOR key was recovered without capturing the key exchange, using a straightforward known-plaintext attack:

1. **Observation:** ~85% of captured PAwR subevent payloads have near-identical encrypted bytes — the "consensus" ciphertext.
2. **Hypothesis:** The most common message is an idle heartbeat with **all-zero plaintext**. When plaintext is all zeros, `wire[i] = 0 XOR key[i] = key[i]`. The consensus ciphertext IS the key.
3. **Verification:** XOR'ing the consensus key against all 120 captured messages produces clean decrypted data:
   - Idle messages (opcode 0x00) decrypt to all zeros — correct
   - Non-idle messages have structured content at meaningful byte positions
   - The same key correctly decrypts messages from a different boot session
4. **Radio noise filtering:** Single-bit deviations from the consensus (e.g. `0x4a` vs `0x4b`) are CRC/radio bit errors in the passive capture, not distinct messages.

### Key Exchange Protocol

The key exchange occurs over PAwR subevents (NOT a separate GATT connection):

| Message Type | Byte 8 | Direction | Content |
| --- | --- | --- | --- |
| Coordinator key | `0x01` | Coord → Responder | 7 key bytes at positions 9–15 |
| Subscriber key  | `0x04` | Responder → Coord  | 16 key bytes at positions 9–24 |
| Key verify      | `0x03` / `0x0D` | Either | Verification result |

Firmware addresses:
- `0x6e480` — Coordinator key generation (builds 15-byte message, stores 0x01 at offset 8)
- `0x6e4e8` — Subscriber key reception (copies 16 bytes from message+9 to struct+0x20)
- `0x6e420` — Key verification (memcmp 16 bytes)

The key exchange only happens on **first session establishment**. Subsequent boots reuse the persisted session key.

**Alternative theory — key embedded in coordinator broadcast:** The session key may not require a dedicated exchange at all. The coordinator's AUX_SYNC_IND broadcast contains ~31 bytes of payload. After the 8-byte prefix (`1e ff 06 00 01 0f 20 22`), there are ~23 bytes — more than enough to embed the 14-byte key (Key A + Key B). If the key is in the broadcast, any responder that syncs to the PAwR train immediately has the key with no handshake needed. This would explain why late-joining bricks can start decrypting instantly, and why only a single 0x01/0x04 pair was observed in 20 minutes (those messages may serve a different purpose — join acknowledgment, capability negotiation, etc.). **Unverified** — needs a new capture to check whether the AUX_SYNC_IND payload contains the key bytes.

## Message Opcodes

Opcodes occupy byte 8 of the decrypted message. They appear to be **bit flags**, not sequential IDs:

| Opcode | Frequency | Description |
| --- | --- | --- |
| `0x00` | ~85% | Idle / heartbeat (all-zero payload) |
| `0x01` | Rare | Key exchange / key refresh |
| `0x04` | Rare | Subscriber key response |
| `0x06` | Rare | Game event (observed: symmetric pattern `06 ... 06`) |
| `0x08` | Rare | Game event |
| `0x0C` | Rare | Game event (3-brick session) |
| `0x10` | ~4% | Game event (most common non-idle) |
| `0x20` | Rare | Game event |
| `0x30` | Rare | Game state with content data |
| `0x3A` | Rare | Game event (3-brick session, rich payload) |
| `0x40` | Rare | Game event |
| `0x60` | Rare | Unknown — 30-byte message with different cleartext tail (see below) |
| `0x80` | ~2% | Game event |

Note: The previously documented message types (0x2B play state, 0x1F control, 0x2E content) from the HARDWARE.md appear to be at a different protocol layer or use a different encoding. The wire-level opcodes observed in captures are the bit-flag values above.

## Decrypted Message Examples

### Idle Heartbeat (opcode 0x00)

```
Encrypted: 4a 17 23 4a 59 34 37 11 32 18 25 39 31 b5 6b f6
Decrypted: 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00
Cleartext: e1 2c 14 1c 3b 8a 44 4b 31 e2
```

All-zero encrypted payload. The cleartext tail (`e1 2c 14 1c 3b 8a 44 4b 31 e2`) is stable across most messages — likely contains session identifiers or routing metadata.

### Key Exchange (opcode 0x01)

```
Decrypted: 00 00 a8 00 10 03 08 83 01 0a 00 80 00 08 01 00
Cleartext: e1 2c 14 1c 3b 69 45 6b 35 e2
```

Note the cleartext tail differs from idle messages (bytes 21–24: `69 45 6b 35` vs `8a 44 4b 31`) — the key exchange carries additional routing/state data.

### Game Event (opcode 0x30)

```
Decrypted: 00 00 00 00 00 00 00 00 30 20 00 c4 02 1a 00 00
Cleartext: e1 2c 14 1c 3b 8a 44 4b 31 e2
```

Non-zero bytes in the tree state region (positions 9–15): `20 00 c4 02 1a 00 00`. This represents serialized semantic tree state being transmitted to the other brick.

### Game Event (opcode 0x10)

```
Decrypted: 00 00 00 00 00 00 00 00 10 00 00 00 00 00 00 1c
Cleartext: e1 2c 14 1c 3b 8a 44 4b 31 e2
```

Opcode 0x10 with a single non-zero byte at position 15 (`0x1c`). Most 0x10 messages have minimal content — likely a simple state flag or trigger.

## Cleartext Tail Analysis

The unencrypted bytes 16–24 have a stable "consensus" value:

```
e1 2c 14 1c 3b 8a 44 4b 31 e2
```

These bytes are largely constant across all message types, with occasional small variations. They likely contain:
- Session identifier or group UUID fragment
- Sender identification
- Sequence/timing metadata

Variations observed:
- Byte 17 occasionally `0xac` or `0x10` (vs consensus `0x2c`)
- Byte 18 occasionally `0x94`, `0x54`, `0x15` (vs consensus `0x14`)
- Byte 21 occasionally `0xca`, `0x82` (vs consensus `0x8a`)

These may represent actual state changes or radio bit errors.

## Firmware References

| Address | Function |
| --- | --- |
| `0x6CEF8` | BrickNet transport — 13-opcode sub-interpreter for tree state serialization |
| `0x6d188` | XOR encrypt + send function |
| `0x6d1fc`–`0x6d24a` | Core XOR encryption loop (2 counter + 7 Key A + 7 Key B) |
| `0x6d280` | XOR decrypt (inbound), core at `0x6d2f4`–`0x6d326` |
| `0x6e480` | Coordinator key generation |
| `0x6e4e8` | Subscriber key reception |
| `0x6e420` | Key verification (memcmp 16 bytes) |
| `0x505f0` | PAwR session init / serialized message builder |
| `0x3828c` | PAwR transport send |
| `0x80deb4` | Global session/subevent index |

## Capture Files

| File | Size | Duration | FEF3 Payloads | Notes |
| --- | --- | --- | --- | --- |
| `randomfiles/pawr_capture.pcap` | 1.5 MB | ~5.5 min | 27 | 3-brick session (Turret + X-Wing + A-Wing), same key verified |

Previous captures (in `/tmp/`, since purged):
- `smartbrick_capture.pcap` — 4.2 MB, ~20 min, 120 FEF3 payloads. Original 2-brick session, primary analysis source for key derivation.
- `smartbrick_coldstart.pcap` — 988 KB, ~3 min, 3 FEF3 payloads. Different boot session, same key verified.

## Multi-Brick Play Flow (Example: X-Wing vs TIE Fighters)

This traces the full technical path from power-on through gameplay for a three-brick session: one X-Wing (coordinator) firing weapons at two TIE Fighters (responders).

### Phase 1 — Brick 1 Boots (X-Wing)

1. **Power on.** The EM9305 boots, loads persisted state from flash.
2. **Tag scan.** The DA000001-01 ASIC reads the X-Wing Smart Tag via its copper coils (ISO 15693, 13.56 MHz). The ASIC decrypts the tag data internally using keys burned into silicon, then passes the decrypted TLV content to the EM9305 firmware.
3. **Content identity extraction.** Firmware extracts the 6-byte content identity and type_byte from TLV type 0x22 (at `0xED74`). The XOR key (content_lo ^ content_hi) is written to `0x80CF28` for PPL script routing.
4. **Content type dispatch.** The type_byte maps to a content type. Code at `0x632e` checks: types `0x02` and `0x04` mean "multi-brick play." The X-Wing content is one of these types.
5. **PAwR session init.** A PAwR session is initiated with group UUID `0x7020162E` (type 2) or `0xBF8C4668` (type 4). The session init code at `0x505f0` builds the initial message template.
6. **Becomes coordinator.** No existing PAwR train is found, so Brick 1 starts one. It begins broadcasting AUX_SYNC_IND periodic advertising on secondary channels with the pattern `1e ff 06 00 01 0f 20 22 ...`. PAwR subevent slots are allocated for responders.
7. **Play engine loads scripts.** The PPL preset system loads X-Wing play scripts from `play.bin`. Preset type `0x03` (content group A, scripts #0–#15) handles the minifig/content-specific behaviour. Timer/idle scripts (`0x0E`, #35–#50) and sensor/interaction scripts (`0x10`, #51–#57) are also active.

### Phase 2 — Brick 2 Boots (First TIE Fighter)

8. **Same boot & tag scan.** TIE Fighter tag is read, content identity extracted, type_byte checked. It's also content type 2 or 4 — multi-brick play required.
9. **Discovers the PAwR train.** Brick 2 scans secondary advertising channels and finds Brick 1's periodic advertising matching the same group UUID. It synchronizes to the periodic advertising train (BLE PAwR sync).
10. **Key exchange over PAwR subevents.** On first session establishment, the coordinator sends a type `0x01` message containing 7 key bytes at positions 9–15. Brick 2 receives it, stores the 16-byte key at struct+0x20 (`0x6e4e8`), and responds with a type `0x04` message. Both sides verify via memcmp at `0x6e420`. The session key is persisted to flash. On subsequent boots with the same session, this step is skipped entirely — both bricks already have the key.
11. **Becomes responder.** Brick 2 is now synchronized, listening in its designated subevent slot. It receives the continuous stream of 25-byte BrickNet messages — mostly idle heartbeats (opcode `0x00`, all-zero payload).
12. **TIE Fighter scripts loaded.** The PPL preset system loads TIE Fighter play scripts. These include response behaviours for incoming inter-brick events (hits, weapons, state changes).

### Phase 3 — Brick 3 Boots (Second TIE Fighter)

13. **Identical to Brick 2.** Same boot, tag scan, group UUID match, PAwR sync. Joins the same PAwR train as an additional responder — any number of bricks with compatible content can sync to the coordinator's train. **How the late joiner gets the session key is unclear.** The leading theory is that the key is embedded in the coordinator's AUX_SYNC_IND broadcast (~23 bytes of payload after the known prefix), so any brick that syncs to the train immediately has the key — no handshake needed. Alternatively, the coordinator may detect the new responder and send a type `0x01` key message, though only one such exchange was observed in 20 minutes of capture. The key is session-level, not per-peer.

### Phase 4 — Gameplay (Weapon Fire)

14. **Colour sensor trigger on Brick 1.** You show the colour red to the brick's colour sensor. The DA000001-01 ASIC detects the colour and generates an event. The play engine maps "red detected" to the weapon-fire action for X-Wing content — this is how all Smart Bricks trigger actions (there is no physical button). The PPL preset system selects the appropriate weapon-fire script based on the content identity + type_byte.
15. **Local sound playback.** The semantic tree executor runs the weapon script locally. An audio command is dispatched to the DA000001-01 ASIC's analog synthesizer, which plays the weapon sound effect through the speaker. LED animations fire simultaneously.
16. **Opcode 21 — distributed execute.** The weapon script contains semantic tree opcode 21 (distributed execute). This is the instruction that means "send this state to other bricks." The BrickNet transport at `0x6CEF8` — a 13-opcode sub-interpreter — serializes the current tree position, condition values, and output buffer into a 25-byte BrickNet message.
17. **XOR encrypt.** The encrypt function at `0x6d1fc` XORs the first 16 bytes of the message with the session key (Key A for bytes 2–8, Key B for bytes 9–15, counter for bytes 0–1). Bytes 16–24 are left as cleartext.
18. **PAwR broadcast.** The encrypted message is sent as a PAwR subevent indication, wrapped in FEF3 Service Data framing (`0x16 0xF3 0xFE` + 25-byte payload). This goes out on a secondary advertising channel. **All synced responders receive it simultaneously** — PAwR subevent indications are broadcast, not addressed to individual responders.

### Phase 5 — TIE Fighters React

19. **Both Brick 2 and Brick 3 receive the message.** The PAwR subevent indication arrives at each responder in their designated listening slot. Both bricks get the exact same 25-byte encrypted message.
20. **XOR decrypt.** Each brick's decrypt function at `0x6d280` XORs bytes 0–15 with the session key, recovering the plaintext tree state. The opcode at byte 8 identifies this as a game event (e.g. `0x10` or `0x30`).
21. **Play state machine processes.** The deserialized tree state is fed into the play state machine at `0x80D804`. The PPL "other" counter at `0x80C6C0+0xA` is incremented (tracking how many inter-brick events have been received).
22. **TIE Fighter response script fires.** Each brick's semantic tree executor looks up its own TIE Fighter response script for the received event. The script determines the local reaction — explosion sounds, damage LED animations, hit acknowledgments. The response depends on each brick's own tag content, not on any per-responder addressing in the message.
23. **Both TIE Fighters react together.** Because the broadcast is simultaneous and both bricks run the same TIE Fighter content, both react at the same time with the same explosion/hit effects.

### What's on the Wire

During steady-state play, the PAwR subevent channel looks like this:

```
[idle 0x00] [idle 0x00] [idle 0x00] ... [WEAPON 0x10] ... [idle 0x00] [idle 0x00] ...
```

~85% of messages are idle heartbeats (all-zero encrypted payload = the session key itself on the wire). Game events are sparse — a weapon fire is a single non-idle message punctuating the heartbeat stream.

The coordinator doesn't say "hit TIE Fighter." It says "I fired weapons — here's my semantic tree state." Each responder independently runs its own play script to decide how to react based on its own tag content. A TIE Fighter reacts with explosions. A different tag might react differently to the same event.

### Responder-to-Coordinator (Subevent RSP)

The TIE Fighters can also send messages back to the coordinator via PAwR subevent responses. This likely carries hit acknowledgments, damage state, or "I was destroyed" events. The responder→coordinator direction uses subevent RSP frames and may have a different structure — patterns like `f4 72 5b 72 73 7c` have been observed but not fully decoded.

## Open Questions

1. **Cleartext tail structure:** What do bytes 16–24 encode? Session ID? Group UUID? Sender identity?
2. **Opcode semantics:** What game actions do opcodes 0x10, 0x30, 0x06, etc. represent? Need correlation with observed play behaviour.
3. **Tree state encoding:** How do bytes 9–15 (encrypted) and 16–24 (cleartext) map to the semantic tree executor's state machine?
4. **Key derivation:** The key is "deterministically assembled from device config bytes at `[0x801cc4]`" per firmware analysis. What exactly are the inputs?
5. **Multiple sessions:** Does a new tag combination generate a new key? Only one key observed so far.
6. **Subevent RSP format:** Responder→coordinator messages may use a different structure. Patterns like `f4 72 5b 72 73 7c` observed but not decoded.
