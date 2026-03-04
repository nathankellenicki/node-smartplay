# Notes

Reverse engineering notes for the LEGO Smart Play system. Pieced together from Android HCI (btsnoop) captures, decompilation of the SmartAssist APK via Il2CppDumper, firmware binary analysis, direct probing of the Bilbo backend API, NFC tag scans, and community teardown photos. Some things aren't visible in the app or are encrypted on the wire — details may be incomplete or wrong.

## Files

| File | Contents |
| --- | --- |
| [PROTOCOL.md](PROTOCOL.md) | BLE register protocol, services, register map, connection lifecycle, authentication |
| [HARDWARE.md](HARDWARE.md) | Chipset, features, smart tags, play engine, multi-brick communication |
| [BACKEND.md](BACKEND.md) | LEGO backend API endpoints, command signing, ownership model |
| [FILE_TRANSFER.md](FILE_TRANSFER.md) | WDX data channel protocol, on-device files, telemetry format, firmware upload |
| [FIRMWARE.md](FIRMWARE.md) | Firmware image format, memory map, disassembly setup, source file list, version history |
| [CONNECTKIT.md](CONNECTKIT.md) | LEGO's internal BLE SDK — hub types, protocol stacks, where Smart Brick fits |
