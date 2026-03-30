meta:
  id: p11_firmware
  title: LEGO Smart Play (~P11) Firmware Container
  file-extension: bin
  endian: le
  license: MIT

doc: >
  Firmware container format used by LEGO Smart Play (P11) devices.
  Contains ARC EM (ARCv2) machine code for the EM9305 BLE SoC and a
  zlib-compressed ROFS (Read-Only File System) with play scripts,
  audio synth data, and LED animations. Magic is ~P11 (0x7E503131).

seq:
  - id: header
    type: header
  - id: segment_descriptors
    type: segment_descriptor
    repeat: expr
    repeat-expr: header.segment_count

instances:
  code_segment:
    type: code_segment
    doc: "Parsed code segment at fixed offset 0x80"
  rofs_segment:
    type: rofs_segment
    doc: "Parsed ROFS segment at fixed offset 0xA0"

types:
  header:
    seq:
      - id: magic
        contents: "~P11"
      - id: version
        type: u4
        doc: "Container format version (always 1)"
      - id: flags
        type: u4
      - id: total_file_length
        type: u4
      - id: ecdsa_signature
        size: 48
        doc: "ECDSA signature (48 bytes, likely P-192). Per-code-version, not per-ROFS."
      - id: signature_extra
        size: 16
        doc: "Additional per-code-version signing data (bytes 0x40-0x4F)"
      - id: build_id
        type: u4
        doc: "Per-code-version build identifier (bytes 0x50-0x53)"
      - id: reserved
        type: u4
        doc: "Always 0 (bytes 0x54-0x57)"
      - id: hardware_version
        type: u4
        doc: "Hardware revision (3=hw3, 4=hw4)"
      - id: code_version
        type: u4
        doc: "Code version identifier, increases with code revision (e.g. 0x21d00)"
      - id: segment_table_offset
        type: u4
        doc: "File offset of segment descriptor table (always 0x80)"
      - id: segment_count
        type: u4
        doc: "Number of segments (always 2)"
      - id: build_hash
        size: 20
        doc: "20-byte build hash (not SHA1 of code)"
      - id: build_hash_tail
        type: u4
        doc: "4 bytes after build hash (e.g. 0x04 for hw4)"

  segment_descriptor:
    seq:
      - id: descriptor_data
        size: 32
    instances:
      is_rofs:
        value: "descriptor_data[0] == 0x52 and descriptor_data[1] == 0x4F and descriptor_data[2] == 0x46 and descriptor_data[3] == 0x53"
        doc: "True if this descriptor starts with ROFS magic"

  code_segment:
    doc: "Parsed view of the code segment descriptor at offset 0x80"
    instances:
      descriptor:
        type: code_segment_descriptor
        io: _root._io
        pos: 0x80
      sub_header:
        type: code_sub_header
        io: _root._io
        pos: 0xB8
      code:
        pos: 0xF8
        size: _root.code_segment.sub_header.code_length
        io: _root._io

  rofs_segment:
    doc: "Parsed view of the ROFS segment descriptor at offset 0xA0"
    instances:
      descriptor:
        type: rofs_segment_descriptor
        io: _root._io
        pos: 0xA0
      compressed_data:
        io: _root._io
        pos: _root.rofs_segment.descriptor.file_offset
        size: _root.rofs_segment.descriptor.compressed_size

  code_segment_descriptor:
    doc: "Segment 0: ARC EM machine code with 64-byte sub-header"
    seq:
      - id: padding
        size: 12
        doc: "Zero padding"
      - id: file_offset
        type: u4
        doc: "File offset of code sub-header (always 0xB8)"
      - id: code_size_with_subheader
        type: u4
        doc: "Total size including 64-byte sub-header"
      - id: flash_address
        type: u4
        doc: "Target flash address range end (0x306000)"
      - id: raw_code_size
        type: u4
        doc: "Same as code_size_with_subheader (redundant)"
      - id: segment_type
        type: u4
        doc: "Segment type (always 1 = code)"

  code_sub_header:
    doc: "64-byte sub-header preceding the code segment"
    seq:
      - id: magic
        contents: [0x7F, 0x50, 0x31, 0x31]
        doc: "Sub-header magic (0x7F P 1 1)"
      - id: sub_header_size
        type: u4
        doc: "Size of this sub-header (always 0x40 = 64)"
      - id: code_length
        type: u4
        doc: "Length of code following this sub-header"
      - id: code_crc32
        type: u4
        doc: "CRC32 of code content"
      - id: build_hash
        size: 20
        doc: "20-byte build hash (matches outer header build_hash at 0x68)"
      - id: hardware_version
        type: u4
        doc: "Hardware version (matches header value)"
      - id: ff_padding
        size: 24
        doc: "0xFF padding to fill 64 bytes"

  rofs_segment_descriptor:
    doc: "Segment 1: zlib-compressed ROFS (Read-Only File System)"
    seq:
      - id: magic
        contents: "ROFS"
      - id: version
        type: u4
        doc: "ROFS version (always 1)"
      - id: file_offset
        type: u4
        doc: "File offset of compressed ROFS data"
      - id: compressed_size
        type: u4
        doc: "Size of zlib-compressed data"
      - id: reserved
        type: u4
        doc: "Always 0"
      - id: decompressed_size
        type: u4
        doc: "Size after zlib decompression"
      - id: sub_header_ref
        size: 8
        doc: "References back to code sub-header (0x7fP11, 0x40)"

  rofs:
    doc: "Decompressed ROFS filesystem with play, audio, animation, and version files"
    seq:
      - id: magic
        contents: "ROFS"
      - id: version
        type: u4
      - id: crc32
        type: u4
        doc: "CRC32 of filesystem contents"
      - id: first_file_offset
        type: u4
        doc: "Offset to first file entry (0x40)"
      - id: content_hash
        size: 8
        doc: "64-bit hash of content"
      - id: total_content_size
        type: u4
      - id: num_files
        type: u4
        doc: "Number of files (typically 4)"
      - id: file_table
        type: rofs_file_entry
        repeat: expr
        repeat-expr: num_files

  rofs_file_entry:
    doc: "File table entry (12 bytes) pointing to file content within the ROFS"
    seq:
      - id: crc32
        type: u4
      - id: content_offset
        type: u4
        doc: "Offset to file content, relative to 0x50 (end of header + file table). A 72-byte file header (64-byte filename + 8-byte hash) precedes content at this offset."
      - id: content_size
        type: u4
        doc: "Size of file content only (excludes 72-byte header)"

  ppl:
    doc: "play.bin: PPL (Play Preset Library) with play scripts per preset type"
    seq:
      - id: magic
        size: 4
        doc: "Magic 0x7F P P L"
      - id: version_flags
        type: u4
      - id: num_preset_types
        type: u2
      - id: num_presets
        type: u2

  aap:
    doc: "audio.bin: AAP (Audio Assets Pack) with ASIC synthesizer instructions"
    seq:
      - id: magic
        size: 4
        doc: "Magic 0x7F A A P"
      - id: version_flags
        type: u4
      - id: num_banks
        type: u2
      - id: num_clips
        type: u2
      - id: padding
        size: 4
      - id: clip_ids
        type: u4
        repeat: expr
        repeat-expr: num_clips
        doc: "Audio clip ID table (sparse, values 4-330)"

  ani:
    doc: "animation.bin: ANI (Animation Data) with LED animation sequences"
    seq:
      - id: magic
        size: 4
        doc: "Magic 0x7F A N I"
      - id: num_banks
        type: u2
      - id: num_clips
        type: u2
      - id: clip_ids
        type: u4
        repeat: expr
        repeat-expr: num_clips
        doc: "Clip IDs as [bank:8][type:8][index:8][reserved:8]"
