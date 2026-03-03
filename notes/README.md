# Notes

Reverse engineering notes for the LEGO Smart Play system. Everything here was pieced together from Android HCI (btsnoop) captures, decompilation of the SmartAssist APK via Il2CppDumper, firmware binary analysis, and direct probing of the Bilbo backend API. Some things aren't visible in the app or are encrypted on the wire — details may be incomplete or wrong.

## Files

| File | Contents |
| --- | --- |
| [PROTOCOL.md](PROTOCOL.md) | BLE register protocol, services, register map, connection lifecycle, authentication |
| [HARDWARE.md](HARDWARE.md) | Chipset, features, on-device content, PAwR play communication |
| [BACKEND.md](BACKEND.md) | LEGO backend API endpoints, command signing, ownership model |
| [FILE-TRANSFER.md](FILE-TRANSFER.md) | WDX data channel protocol, on-device files, telemetry format, firmware upload |
| [CONNECTKIT.md](CONNECTKIT.md) | LEGO's internal BLE SDK — hub types, protocol stacks, where Smart Brick fits |
