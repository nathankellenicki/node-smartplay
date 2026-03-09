# LEGO Smart Play — Reverse Engineering Methodology

> Step-by-step record of tools, commands, and approaches used during analysis. Intended as a reproducible reference.

## 1. APK Extraction

The LEGO SmartAssist app ships as 3 APK splits on Android:

| Split | Size | Contents |
| --- | --- | --- |
| `base.apk` | 119 MB | Unity assets, managed DLL metadata, sharedassets |
| `split_UnityDataAssetPack.apk` | 102 MB | Unity Addressable bundles (firmware, configs) |
| `split_config.arm64_v8a.apk` | 41 MB | ARM64 native libraries (`libil2cpp.so`) |

Pull from device:

```
adb shell pm path com.lego.smartassist
adb pull <path_to_base.apk>
adb pull <path_to_split_UnityDataAssetPack.apk>
adb pull <path_to_split_config.arm64_v8a.apk>
```

Unzip each to extract contents:

```
mkdir -p /private/tmp/apk_extract/base
mkdir -p /private/tmp/apk_extract/unity_data
mkdir -p /private/tmp/apk_extract/lib

unzip base.apk -d /private/tmp/apk_extract/base
unzip split_UnityDataAssetPack.apk -d /private/tmp/apk_extract/unity_data
unzip split_config.arm64_v8a.apk -d /private/tmp/apk_extract/lib
```

## 2. IL2CPP Decompilation

The app uses Unity IL2CPP. Class definitions were dumped using [Il2CppDumper](https://github.com/Perfare/Il2CppDumper) v6.7.46:

```
Il2CppDumper libil2cpp.so global-metadata.dat /tmp/il2cppdumper/
```

Inputs:
- `libil2cpp.so` — from `split_config.arm64_v8a.apk` at `lib/arm64-v8a/`
- `global-metadata.dat` — from `base.apk` at `assets/bin/Data/Managed/Metadata/`

Output: `dump.cs` (~46 MB) containing all class definitions, method signatures, and field layouts. No method bodies (IL2CPP compiles to native), but enough to understand the API client architecture, service interfaces, and data models.

Key files extracted from the dump and saved to `randomfiles/connectkit/`:
- `hub-service-interface.cs` — BLE service abstractions
- `hub-feature-library.cs` — Firmware update, file transfer, authentication
- `horizon-app.cs` — App-level services, backend client, UI

## 3. Firmware Extraction from Unity Asset Bundles

All 12 firmware images are bundled inside `split_UnityDataAssetPack.apk` as Unity Addressable assets. The asset files are GUID-named Unity SerializedFiles in `assets/bin/Data/`.

### Finding firmware bundles

Search for the `~P11` magic (`7E503131`) or the string literal:

```bash
for f in /private/tmp/apk_extract/unity_data/assets/bin/Data/*; do
    if grep -ql "~P11" "$f" 2>/dev/null; then
        echo "$(basename $f) ($(wc -c < "$f") bytes)"
    fi
done
```

This yields 12 Unity assets containing firmware. Extract the version name from each:

```bash
for f in <matched_files>; do
    strings "$f" | grep -i "smartbrick\|upgrade" | head -1
done
```

### Extracting the raw firmware binary

Each Unity SerializedFile contains the `~P11` firmware as an embedded asset. The firmware binary starts at the `~P11` magic within the file. Extract by finding the offset and copying to the end of the firmware (using the total length field at bytes 12-15 of the `~P11` header).

## 4. Firmware Container Parsing

The `~P11` container has a 104-byte header followed by two segments (code + ROFS). See [FIRMWARE.md](FIRMWARE.md) for the full header format.

### Parsing the header

```python
import struct

with open("smartbrick_v0.72.1-hw4_fw-v2.29.0.bin", "rb") as f:
    data = f.read()

magic = data[0:4]           # b'~P11'
total_len = struct.unpack_from('<I', data, 12)[0]
product = struct.unpack_from('<I', data, 80)[0]     # 0 = AudioBrick
hw_ver = struct.unpack_from('<I', data, 84)[0]
upgrade_ver = struct.unpack_from('<I', data, 88)[0]
```

### Locating segments

Two 32-byte segment descriptors follow the header. Segment 0 (code) starts at file offset `0xB8` with a 64-byte sub-header (starting with `\x7fP11` marker). Segment 1 (ROFS) is identified by the `ROFS` magic at the start of its descriptor.

```python
# Sub-header at 0xB8
sub_magic = data[0xB8:0xBC]   # b'\x7fP11'
code_size = struct.unpack_from('<I', data, 0xC0)[0]

# Code starts after the 64-byte sub-header
code_start = 0xF8
code = data[code_start:code_start + code_size]

# ROFS descriptor — find 'ROFS' magic in descriptor area
rofs_desc_offset = data.index(b'ROFS', 0x80, 0x100)
```

### Extracting the code segment

```python
with open("smartbrick_v0.72.1_code.bin", "wb") as f:
    f.write(code)
```

### Decompressing the ROFS

```python
import zlib

# ROFS file offset and compressed size from the descriptor
rofs_data = zlib.decompress(data[rofs_file_offset:rofs_file_offset + rofs_compressed_size])

with open("smartbrick_v0.72.1_metadata_decompressed.bin", "wb") as f:
    f.write(rofs_data)
```

## 5. ARC Disassembly

The EM9305 uses an ARC EM (ARCv2) core. The ARC GNU toolchain is required for disassembly. It is not available via Homebrew — run it in Docker using the pre-built Linux toolchain from Synopsys.

### Docker disassembly command

```bash
docker run --rm --platform linux/amd64 \
    -v /path/to/firmware:/fw \
    ubuntu:22.04 bash -c "
apt-get update -qq && apt-get install -y -qq wget bzip2 > /dev/null 2>&1 &&
wget -q https://github.com/foss-for-synopsys-dwc-arc-processors/toolchain/releases/download/arc-2024.06-release/arc_gnu_2024.06_prebuilt_elf32_le_linux_install.tar.bz2 -O /tmp/arc.tar.bz2 &&
tar xjf /tmp/arc.tar.bz2 -C /opt &&
export PATH=\$(dirname \$(find /opt -name 'arc-elf32-objdump' | head -1)):\$PATH &&
cd /fw &&
arc-elf32-objcopy -I binary -O elf32-littlearc \
    --rename-section .data=.text,contents,alloc,load,code \
    smartbrick_v0.72.1_code.bin smartbrick_v0.72.1_code.elf &&
arc-elf32-objdump -d smartbrick_v0.72.1_code.elf > smartbrick_v0.72.1_disasm.txt &&
rm smartbrick_v0.72.1_code.elf
"
```

### Key details

- **`--platform linux/amd64`** — the ARC toolchain is x86-only; required on Apple Silicon Macs (runs under Rosetta/QEMU)
- **`--rename-section .data=.text,contents,alloc,load,code`** — `objcopy -I binary` creates a `.data` section by default. `objdump -d` only disassembles sections marked as code, so the section must be renamed to `.text` with the `code` flag. Without this, the output is empty.
- **`-I binary -O elf32-littlearc`** — wraps the raw binary in a minimal ELF container. `objdump -b binary` does not work for ARC (it can't auto-detect the architecture).
- The toolchain extracts to `arc-multilib-elf32/` (not the filename-implied path), hence the `find` to locate the binary.
- The intermediate `.elf` file can be deleted after disassembly.

### Output

| Firmware | Lines | File |
| --- | --- | --- |
| v0.46.0 | 167,155 | `smartbrick_v0.46.0_disasm.txt` |
| v0.72.1 | 178,000+ | `smartbrick_v0.72.1_disasm.txt` |

No symbols — all function names in the notes were assigned manually through pattern analysis.

## 6. BLE Protocol Capture

HCI (Host Controller Interface) logs captured from Android's Bluetooth stack:

1. Enable Bluetooth HCI snoop log in Android Developer Options
2. Interact with the Smart Brick via the SmartAssist app
3. Pull the btsnoop log:
   ```
   adb pull /data/misc/bluetooth/logs/btsnoop_hci.log
   ```

Captures stored in `randomfiles/` as `.btsnoop` files. Parsed with a custom script (`randomfiles/parse_btsnoop_lwp_v3.py`) and Wireshark.

## 7. Backend API Probing

The Bilbo API at `p11.bilbo.lego.com` exposes its OpenAPI spec publicly:

```
GET https://p11.bilbo.lego.com/openapi.json
GET https://p11.bilbo.lego.com/redoc
```

Unauthenticated endpoints tested directly:

```bash
# Check brick ownership
curl -X POST https://p11.bilbo.lego.com/elements/owned \
    -H "Content-Type: application/json" \
    -d '{"element_ids": ["9C:9A:C0:46:68:4A"]}'

# Probe for firmware updates
curl https://p11.bilbo.lego.com/update/<state_hash>/probe
```

Authenticated endpoints require a JWT from LEGO ID (`identity.lego.com`, OAuth client `lego-p11-parental-app`). Authenticated behaviour is inferred from the IL2CPP dump, not directly observed.

## 8. NFC Tag Scanning

Tags scanned using a standard NFC phone with ISO 15693 support:

```
# Read Single Block
02 20 XX              (XX = block number)

# Read Multiple Blocks
02 23 XX YY           (XX = start block, YY = count-1)

# Get System Info
02 2B
```

Tag IC: custom EM Microelectronic die (manufacturer code `0x16`, IC reference `0x17`). Memory: 66 blocks x 4 bytes = 264 bytes. Data is encrypted by the ASIC — raw dumps are high-entropy with only a cleartext header byte identifying the content ID.

## Tools Summary

| Tool | Purpose |
| --- | --- |
| `adb` | Pull APK splits, btsnoop logs from Android device |
| `unzip` | Extract APK contents |
| Il2CppDumper v6.7.46 | Dump C# class definitions from IL2CPP binary |
| `strings`, `grep`, `xxd` | Binary analysis, string search, hex dump |
| `arc-elf32-objcopy` | Wrap raw binary in ELF for disassembly |
| `arc-elf32-objdump` | Disassemble ARC EM (ARCv2) machine code |
| Docker (ubuntu:22.04) | Run x86 ARC toolchain on Apple Silicon |
| Python 3 (`struct`, `zlib`) | Parse firmware headers, decompress ROFS |
| Wireshark | Inspect BLE HCI captures |
| `curl` | Probe backend API endpoints |
| NFC phone (ISO 15693) | Scan Smart Tag EEPROM data |
