# Smart Play Reverse Engineering Research

This directory contains reverse engineering documentation, analysis scripts, and tools for the LEGO Smart Play ecosystem. It is separate from the [node-smartplay library](../README.md).

## Documentation

The `notes/` directory contains detailed technical documentation:

| File | Contents |
| ---- | -------- |
| [PROTOCOL.md](notes/PROTOCOL.md) | BLE protocol — registers, connection lifecycle, authentication |
| [HARDWARE.md](notes/HARDWARE.md) | Hardware architecture — ASIC, tag format, play engine, encryption investigation |
| [FIRMWARE.md](notes/FIRMWARE.md) | Firmware internals — disassembly, memory map, key functions |
| [FLOW.md](notes/FLOW.md) | Tag → play engine flow — how tags drive gameplay |
| [AUDIO.md](notes/AUDIO.md) | Audio format — AAP container, synthesizer bytecode, PCM |
| [SCRIPTS.md](notes/SCRIPTS.md) | Play scripts — PPL format, preset table, bytecode encoding |
| [PAWR.md](notes/PAWR.md) | Brick-to-brick communication — PAwR/BrickNet protocol |
| [BACKEND.md](notes/BACKEND.md) | LEGO backend API — Bilbo endpoints, command signing |
| [FILE_TRANSFER.md](notes/FILE_TRANSFER.md) | WDX file transfer — on-device files, telemetry |

## Analysis Scripts

Encryption analysis scripts in `analysis/`:
- `ccm-*.js` — XOR and structural analysis of tag ciphertext
- `grain128a/` — Grain-128A implementation, SAT solvers, plaintext mapping
- `parse-pawr-captures.js` — PAwR capture decryption

## Tools

Firmware and content parsing tools in `tools/`:
- `extract-audio.js` — Extract clips from audio.bin
- `extract-scripts.js` — Extract scripts from play.bin
- `disasm-script.js` — Disassemble script bytecode
- `parse-play-engine.py` — Parse play engine from firmware
- `p11_*.ksy` — Kaitai Struct definitions for file formats

## Data (gitignored)

Large binary files are not in the repository:
- `firmware_files/` — Extracted firmware binaries
- `audio_clips/` — Extracted audio clips
- `captures/` — BLE/PAwR packet captures
- `connectkit/` — Extracted ConnectKit SDK
