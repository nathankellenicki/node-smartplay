# Notes

Reverse engineering notes for the LEGO Smart Play system. Pieced together from Android HCI (btsnoop) captures, decompilation of the SmartAssist APK via Il2CppDumper, firmware binary analysis and ARC disassembly, ROFS content extraction, direct probing of the Bilbo backend API, NFC tag scans, and community teardown photos. Some things aren't visible in the app or are encrypted on the wire — details may be incomplete or wrong.

## Files

| File | Contents |
| --- | --- |
| [PROTOCOL.md](PROTOCOL.md) | BLE register protocol, WDX service, register map (documented + undocumented), connection lifecycle, authentication, PAwR registers, smart tag BLE visibility |
| [HARDWARE.md](HARDWARE.md) | Chipset (EM9305 + custom ASIC), smart tags (data format, event types, security, reading pipeline), play engine (architecture model, sensor input, reactive scripting, PPL state machine, play state machine, semantic tree executor, synthesizer, LED/audio output), ROFS content (play.bin/audio.bin/animation.bin formats), content indexing, script profiling, X-Wing tag case study, multi-brick communication (PAwR activation, message format, session persistence) |
| [FIRMWARE.md](FIRMWARE.md) | Firmware container format, ROFS filesystem structure (header, file table, per-file format), play.bin PPL format (header, preset table, script directory, bytecode encoding, opcode translation table, content indexing), audio.bin AAP format, animation.bin ANI format, memory map, RAM layout, MMIO registers, code map, key functions, smart tag subsystem, tag-to-play pipeline, WDX register dispatch (read/write handlers), BLE advertising state machine, PAwR/BrickNet activation, BrickNet message construction/encryption, play state machine, semantic tree type system, script profiling tables, source file lists, version history |
| [BACKEND.md](BACKEND.md) | LEGO backend API endpoints, command signing, ownership model |
| [FILE_TRANSFER.md](FILE_TRANSFER.md) | WDX data channel protocol, on-device files, telemetry format, firmware upload |
| [CONNECTKIT.md](CONNECTKIT.md) | LEGO's internal BLE SDK — hub types, protocol stacks (LWP3/WDX/P11-RPC), WDX services, IO types, signed commands |
