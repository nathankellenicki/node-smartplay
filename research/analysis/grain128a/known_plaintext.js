/**
 * Known Plaintext Compilation for LEGO Smart Play Tags
 *
 * Compiles everything we know about the decrypted plaintext structure,
 * specific tag-to-script mappings, and known constant bytes.
 *
 * Goal: build a byte-level template for at least one tag (X-Wing)
 * with known values at specific positions, to verify Grain-128A.
 */

// ============================================================
// WHAT WE KNOW ABOUT PLAINTEXT STRUCTURE
// ============================================================

// After ASIC decryption, the firmware sees Layer 2 TLV records:
//
// RECORD TYPE 0x22 — Content Identity (one per tag)
//   [type_id: u16 LE = 0x0022]  → bytes: 22 00
//   [content_length: u16 LE = 0x0007]  → bytes: 07 00
//   [content_lo: u32 LE]  → 4 bytes, unique per content
//   [content_hi: u16 LE]  → 2 bytes, unique per content
//   [type_byte: u8]  → 0x03 (identity) or 0x06 (item)
//   TOTAL: 11 bytes
//
// RECORD TYPE 4 or 6 — Resource Reference (multiple per tag)
//   [type_id: u16 LE = 0x0004 or 0x0006]  → bytes: 04 00 or 06 00
//   [content_length: u16 LE]  → varies
//   [padding/header: 4 bytes]  → TLV sub-header
//   [tag_byte: u8 = 0x12]  → constant
//   [session_counter: u8]  → varies
//   [sub_type: u16 LE = 0x0008]  → bytes: 08 00
//   [content_ref_start: u16 LE]  → matches PPL preset param
//   [content_ref_end: u16 LE]  → >= start
//   [bank_index: u16 LE]  → 0-499
//   [bank_ref: u16 LE]  → 10-3200
//   TOTAL: 20 bytes per record

// ============================================================
// KNOWN TAG → SCRIPT MAPPINGS
// ============================================================

const PPL_PRESETS = {
    // Identity scripts (type 0x03) — tag scan
    identity: [
        { script: 0,  param: 1168 },
        { script: 1,  param: 256 },
        { script: 2,  param: 1152 },
        { script: 3,  param: 1024 },
        { script: 4,  param: 304 },
        { script: 5,  param: 64 },
        { script: 6,  param: 1104 },
        { script: 7,  param: 432 },
        { script: 8,  param: 72 },
        { script: 9,  param: 4 },
        { script: 10, param: 384 },
        { script: 11, param: 400 },
        { script: 12, param: 336 },
        { script: 13, param: 272 },
        { script: 14, param: 264, notes: "PAwR-capable" },
        { script: 15, param: 288 },
    ],
    // Item scripts (type 0x06) — tag scan
    item: [
        { script: 16, param: 1448 },
        { script: 17, param: 68 },
        { script: 18, param: 1192 },
        { script: 19, param: 1296 },
        { script: 20, param: 1128 },
    ],
    // Timer scripts (type 0x0E)
    timer: [
        { script: 35, param: 266 },
        { script: 36, param: 82 },
        { script: 37, param: 101 },
        { script: 38, param: 118 },
        { script: 39, param: 96 },
        { script: 40, param: 302 },
        { script: 41, param: 1068 },
        { script: 42, param: 24, notes: "PAwR combat — largest script" },
        { script: 43, param: 1228 },
        { script: 44, param: 73 },
        { script: 45, param: 1484 },
        { script: 46, param: 97 },
        { script: 47, param: 1868 },
        { script: 48, param: 1356 },
        { script: 49, param: 116 },
        { script: 50, param: 1612 },
    ],
    // Button scripts (type 0x10)
    button: [
        { script: 51, param: 104 },
        { script: 52, param: 72 },
        { script: 53, param: 112 },
        { script: 54, param: 80 },
        { script: 55, param: 88 },
        { script: 56, param: 64 },
        { script: 57, param: 96 },
    ],
    // NPM scripts (type 0x09)
    npm: [
        { script: 21, param: 384 },
        { script: 22, param: 448 },
        { script: 23, param: 336 },
        { script: 24, param: 400 },
        { script: 25, param: 288 },
        { script: 26, param: 272 },
        { script: 27, param: 320 },
        { script: 28, param: 416 },
        { script: 29, param: 480 },
        { script: 30, param: 352 },
        { script: 31, param: 256 },
    ],
};

// Cross-reference: shared params link scripts across types
const PARAM_CROSS_REF = {
    64:  { identity: 5,  button: 56 },
    72:  { identity: 8,  button: 52 },
    96:  { timer: 39,    button: 57 },
    256: { identity: 1,  npm: 31 },
    272: { identity: 13, npm: 26 },
    288: { identity: 15, npm: 25 },
    304: { identity: 4 },
    336: { identity: 12, npm: 23 },
    384: { identity: 10, npm: 21 },
    400: { identity: 11, npm: 24 },
    432: { identity: 7 },
};

// ============================================================
// TAG-SPECIFIC KNOWLEDGE
// ============================================================

console.log("=== Known Plaintext for Each Tag ===\n");

// X-Wing: item, triggers PAwR combat
// - type_byte = 0x06
// - Has resource ref with content_ref = 24 (timer script #42, PAwR combat)
// - Has one of the item script params (1448, 68, 1192, 1296, 1128)
// - TIE Fighter and Falcon also trigger PAwR → same timer content_ref = 24

// For any tag, the known bytes in the plaintext are:
// 1. Content identity TLV header: 22 00 07 00 (4 bytes)
// 2. type_byte: 03 or 06 (1 byte)
// 3. Per resource ref: tag_byte 12, sub_type 08 00 (3 bytes)
// 4. content_ref values: specific params as u16 LE (2 bytes each)

// Let's estimate the number of resource refs per tag based on size
function estimateRefs(payloadLen, ivLen, macLen) {
    // payload = format(1) + IV + ciphertext + MAC
    // ciphertext = content_identity(11) + N * resource_ref(20)
    const ctLen = payloadLen - 1 - ivLen - macLen;
    const refsBytes = ctLen - 11; // subtract content identity TLV
    return Math.floor(refsBytes / 20);
}

const tags = [
    {
        name: "X-Wing", cat: "item", payloadLen: 107,
        knownRefs: [
            { type: "item",  note: "one of params 1448/68/1192/1296/1128" },
            { type: "timer", param: 24, note: "PAwR combat script #42" },
        ]
    },
    {
        name: "TIE Fighter", cat: "item", payloadLen: 107,
        knownRefs: [
            { type: "item",  note: "one of params 1448/68/1192/1296/1128" },
            { type: "timer", param: 24, note: "PAwR combat script #42" },
        ]
    },
    {
        name: "Falcon", cat: "item", payloadLen: 107,
        knownRefs: [
            { type: "item",  note: "one of params 1448/68/1192/1296/1128 (Millennium Falcon set)" },
            { type: "timer", param: 24, note: "PAwR combat script #42 (if PAwR capable)" },
        ]
    },
    {
        name: "R2-D2", cat: "identity", payloadLen: 74,
        knownRefs: [
            { type: "identity", note: "one of 16 identity params" },
        ]
    },
    {
        name: "Luke", cat: "identity", payloadLen: 157,
        knownRefs: [
            { type: "identity", note: "one of 16 identity params" },
            { type: "timer",    note: "one of 16 timer params" },
            { type: "button",   note: "one of 7 button params" },
            { type: "npm",      note: "one of 11 npm params (if NPM capable)" },
        ]
    },
    {
        name: "Vader", cat: "identity", payloadLen: 169,
        knownRefs: [
            { type: "identity", note: "one of 16 identity params" },
            { type: "timer",    note: "one of 16 timer params" },
            { type: "button",   note: "one of 7 button params" },
            { type: "npm",      note: "one of 11 npm params (likely)" },
        ]
    },
];

for (const tag of tags) {
    const iv12 = estimateRefs(tag.payloadLen, 12, 8);
    const iv12m4 = estimateRefs(tag.payloadLen, 12, 4);
    const iv12m0 = estimateRefs(tag.payloadLen, 12, 0);

    console.log(`${tag.name} (${tag.cat}, ${tag.payloadLen} bytes):`);
    console.log(`  type_byte = 0x${tag.cat === "identity" ? "03" : "06"}`);
    console.log(`  Est. resource refs: ${iv12} (MAC=8) / ${iv12m4} (MAC=4) / ${iv12m0} (MAC=0)`);
    console.log(`  Known resource refs:`);
    for (const ref of tag.knownRefs) {
        if (ref.param) {
            const le = Buffer.alloc(2);
            le.writeUInt16LE(ref.param);
            console.log(`    ${ref.type}: content_ref = ${ref.param} (LE: ${le[0].toString(16).padStart(2,'0')} ${le[1].toString(16).padStart(2,'0')}) — ${ref.note}`);
        } else {
            console.log(`    ${ref.type}: ${ref.note}`);
        }
    }
    console.log();
}

// ============================================================
// COMPILE KNOWN BYTES
// ============================================================

console.log("=== Summary: Known Plaintext Bytes ===\n");

console.log("UNIVERSAL (all tags):");
console.log("  Content identity TLV header: 22 00 07 00 (at some fixed offset)");
console.log("  Per resource ref record:");
console.log("    tag_byte:  12");
console.log("    sub_type:  08 00");
console.log();

console.log("PER CATEGORY:");
console.log("  Identity tags: type_byte = 03");
console.log("  Item tags:     type_byte = 06");
console.log();

console.log("X-WING SPECIFIC:");
console.log("  type_byte = 06");
console.log("  Resource ref: content_ref_start = 24 (LE: 18 00) — PAwR timer script #42");
console.log("  At least 2 resource ref records (item scan + timer)");
console.log();

console.log("TIE FIGHTER SPECIFIC:");
console.log("  type_byte = 06");
console.log("  Resource ref: content_ref_start = 24 (LE: 18 00) — PAwR timer script #42");
console.log();

// ============================================================
// PLAINTEXT TEMPLATE FOR X-WING
// ============================================================

console.log("=== Hypothesized Plaintext Layout (X-Wing, assuming IV=12, MAC=8) ===\n");
console.log("Encrypted payload: 90 bytes (107 - 1_fmt - 12_IV - 4_possible_MAC)");
console.log("(or 86 with MAC=8, or 82 with MAC=12)\n");

// Best guess layout:
// Offset 0-10:  Content Identity TLV (22 00 07 00 [4b content_lo] [2b content_hi] 06)
// Offset 11-30: Resource Ref 1 (item scan: type_id, len, [12 ?? 08 00 XX XX XX XX XX XX XX XX])
// Offset 31-50: Resource Ref 2 (timer: [12 ?? 08 00 18 00 ...])
// Offset 51-70: Resource Ref 3 (button or NPM?)
// Offset 71-77: Resource Ref 4?
// Offset 78-85: MAC? or more data

const template = [];
const addKnown = (offset, value, desc) => template.push({ offset, value, desc });

// Content Identity TLV
addKnown(0, 0x22, "TLV type_id low (type 0x22)");
addKnown(1, 0x00, "TLV type_id high");
addKnown(2, 0x07, "content_length low (7 bytes)");
addKnown(3, 0x00, "content_length high");
// offset 4-7: content_lo (unknown)
// offset 8-9: content_hi (unknown)
addKnown(10, 0x06, "type_byte (item)");

// Resource Ref 1 (item scan script)
// Assuming 20-byte records starting at offset 11
// First 8 bytes = TLV header for type 4/6 record
// Then: tag_byte(0x12), session, sub_type(0x0008), content_ref, ...
addKnown(19, 0x12, "tag_byte in resource ref 1");
// offset 20: session counter (unknown)
addKnown(21, 0x08, "sub_type low in ref 1");
addKnown(22, 0x00, "sub_type high in ref 1");
// offset 23-24: content_ref_start for item script (one of 1448/68/1192/1296/1128)

// Resource Ref 2 (timer/PAwR script #42, content_ref = 24)
// Starts at offset 31 (11 + 20)
addKnown(39, 0x12, "tag_byte in resource ref 2");
// offset 40: session counter
addKnown(41, 0x08, "sub_type low in ref 2");
addKnown(42, 0x00, "sub_type high in ref 2");
addKnown(43, 0x18, "content_ref_start low = 24 (PAwR timer)");
addKnown(44, 0x00, "content_ref_start high = 0");

console.log("Known plaintext bytes (offsets relative to start of ciphertext/plaintext):\n");
console.log("Offset | Value | Description");
console.log("-------+-------+------------");
for (const { offset, value, desc } of template.sort((a, b) => a.offset - b.offset)) {
    console.log(`  ${offset.toString().padStart(3)}  |  0x${value.toString(16).padStart(2, '0')} | ${desc}`);
}

console.log(`\nTotal known bytes: ${template.length} out of ~86-90 plaintext bytes`);
console.log(`\nNOTE: These offsets assume a specific record ordering and that the`);
console.log(`Layer 2 TLV format is what's encrypted. The actual layout depends on`);
console.log(`whether the ASIC encrypts Layer 1 sub-records or Layer 2 TLVs.`);
console.log(`The offsets may need adjustment — but the BYTE VALUES are firm.`);

// ============================================================
// KEYSTREAM BYTES FOR X-WING (if plaintext is correct)
// ============================================================

console.log("\n=== Candidate Keystream Bytes (X-Wing) ===\n");

const xwingPayload = Buffer.from(
    "24 d4 3e 82 9f 37 1f 47 ab 8f 36 36 42 63 71 d5 54 f2 b8 f4 c5 b5 af e9 10 bf 00 83 33 2f 74 f7 ca 47 ef 1a b0 79 86 41 4e ce ca bd 34 f8 da a6 79 c6 47 35 bd 10 31 3c 37 f8 dc db 4a d1 13 bc a3 04 18 02 6c ad eb 41 c9 71 cc ae c1 cd dc 92 79 8e 13 25 97 06 a2 3d 39 e9 d6 f4 1e 33 9b b2 b9 af 46 c2 22 e8"
        .replace(/ /g, ""), "hex"
);

const iv = xwingPayload.slice(0, 12);
const ct = xwingPayload.slice(12);

console.log(`IV:         ${Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
console.log(`CT length:  ${ct.length} bytes\n`);

console.log("If our plaintext template is correct, the keystream at these positions is:\n");
console.log("Offset | CT byte | PT byte | KS byte | Description");
console.log("-------+---------+---------+---------+------------");
for (const { offset, value, desc } of template.sort((a, b) => a.offset - b.offset)) {
    if (offset < ct.length) {
        const ctByte = ct[offset];
        const ksByte = ctByte ^ value;
        console.log(`  ${offset.toString().padStart(3)}  |   0x${ctByte.toString(16).padStart(2, '0')}  |   0x${value.toString(16).padStart(2, '0')}  |   0x${ksByte.toString(16).padStart(2, '0')}  | ${desc}`);
    }
}

console.log("\nThese keystream bytes should be producible by Grain-128A(key, IV) for some 128-bit key.");
console.log("If we can also derive keystream bytes for TIE Fighter and Falcon (same structure,");
console.log("different IVs), we have multiple (IV, keystream) pairs constraining the same key.");
