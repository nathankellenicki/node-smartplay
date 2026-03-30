meta:
  id: p11_ppl
  title: "LEGO Smart Play PPL (Play Preset Library)"
  file-extension: bin
  endian: le
  license: MIT

doc: "PPL format from play.bin inside ROFS. Contains play scripts grouped by preset type. Magic is 0x7F PPL."

seq:
  - id: header
    type: header
  - id: preset_descriptors
    type: preset_descriptor
    repeat: expr
    repeat-expr: header.num_preset_descriptors
  - id: script_offsets
    type: script_offset
    repeat: expr
    repeat-expr: header.num_presets

types:
  header:
    seq:
      - id: magic
        contents: [0x7F, 0x50, 0x50, 0x4C]
        doc: "Magic bytes: 0x7F P P L"
      - id: version
        type: u4
        doc: "PPL format version (observed: 1)"
      - id: num_preset_types
        type: u2
        doc: "Number of unique preset types (observed: 5)"
      - id: num_presets
        type: u2
        doc: "Number of play scripts (observed: 58)"
      - id: reserved
        type: u4
        doc: "Always 0"
    instances:
      num_preset_descriptors:
        value: "num_presets + 3"
        doc: "Total descriptor entries: 3 system/default entries plus num_presets"

  preset_descriptor:
    doc: "8-byte entry mapping a preset to its type. First 3 entries are system defaults (type 0x0B), followed by num_presets script entries."
    seq:
      - id: preset_type
        type: u4
        doc: "Preset type ID: 0x03=Identity/minifig, 0x06=Item/tile, 0x09=NPM/proximity, 0x0B=System/default, 0x0E=Timer/idle, 0x10=Button/shake"
      - id: param
        type: u4
        doc: "Script parameter or configuration value"

  script_offset:
    doc: "8-byte entry pointing to script data within this file"
    seq:
      - id: offset
        type: u4
        doc: "Absolute file offset to script data"
      - id: size
        type: u4
        doc: "Script data size in bytes"
