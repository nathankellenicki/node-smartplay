meta:
  id: p11_aap
  title: "LEGO Smart Play AAP (Audio Assets Pack)"
  file-extension: bin
  endian: le
  license: MIT

doc: "AAP format from audio.bin inside ROFS. Contains ASIC synthesizer instructions indexed by clip ID. Magic is 0x7F AAP."

seq:
  - id: header
    type: header
  - id: clip_ids
    type: u4
    repeat: expr
    repeat-expr: header.num_clips
    doc: "Sparse audio clip ID table (values 4-330)"
  - id: bank_descriptors
    type: audio_descriptor
    repeat: expr
    repeat-expr: header.num_banks
    doc: "Per-bank descriptors with data offset, size, and sample rate"
  - id: remaining_data
    size-eos: true
    doc: "Clip descriptors (16 bytes each, same format as bank descriptors) followed by raw synthesizer instruction data"

types:
  header:
    seq:
      - id: magic
        contents: [0x7F, 0x41, 0x41, 0x50]
        doc: "Magic bytes: 0x7F A A P"
      - id: version_flags
        type: u4
        doc: "Version or flags (observed: 0)"
      - id: num_banks
        type: u2
        doc: "Number of audio banks (observed: 3)"
      - id: num_clips
        type: u2
        doc: "Number of audio clips (observed: 154)"
      - id: reserved
        type: u4
        doc: "Always 0"

  audio_descriptor:
    doc: "16-byte descriptor for a bank or clip resource"
    seq:
      - id: data_size
        type: u4
        doc: "Size of associated audio data"
      - id: data_offset
        type: u4
        doc: "Offset to audio data"
      - id: marker
        type: u4
        doc: "Always 0xFFFFFFFF"
      - id: param
        type: u4
        doc: "Parameter (sample rate divisor or flags)"
