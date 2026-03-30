/**
 * Plaintext Template v2 — Combining Disassembly Trace + Gameplay Observations
 *
 * What we now know about the four 107-byte ship tags (X-Wing, TIE, Falcon, A-Wing):
 * - All have 3 resource reference records: item scan + timer(PAwR) + button(IMU)
 * - All share identical content_ref values (same scripts)
 * - They differ in bank_index (animations) and bank_ref (audio)
 * - type_byte = 0x06 (item)
 *
 * From disassembly:
 * - Sub-record format: [type:u8][param:s8][length:u8][payload]
 * - Content identity: flag byte + 6 or 12 bytes depending on format
 * - Resource ref within TLV: tag_byte(0x12) at +8, sub_type(0x0008) at +10-11,
 *   content_ref at +12-13, fields at +14-19. Content_length = 0x0C.
 * - bank_index (at +16-17 within TLV) must be ≤ 499
 *
 * Payload breakdown (107-byte tag):
 * - Header: bytes 0-3 (00 6B 01 0C)
 * - Format byte: byte 4 (01)
 * - If Grain-128A: IV = bytes 5-16 (12 bytes)
 * - Ciphertext: bytes 17-106 (90 bytes)
 * - Plaintext = 90 bytes = identity record + 3 resource refs
 *
 * Item script params (one of these is the content_ref for item scan):
 *   #16: 1448  #17: 68  #18: 1192  #19: 1296  #20: 1128
 *
 * Timer script #42 (PAwR combat) param: 24
 *
 * Button script params: 104, 72, 112, 80, 88, 64, 96
 * Ships would use one of these for the swoosh/IMU response.
 */

const HEADER_LEN = 5;
const IV_LEN = 12;

// All four ship tags
const ships = {
    "X-Wing": "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800",
    "TIE":    "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800",
    "Falcon": "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00",
    "A-Wing": "006B010C 01724CE6 103EC87C 94C91117 3B608C0E EDC6144B E73BD6C1 7D741FB9 942BC72E D5DDF21C 112C4A95 3A486B27 ADED151E 8F72A42E 261A41A6 D2903787 64A717D5 B4E6F69D F0FCD54E 08B78505 B5E54E03 316CE69B 2C693FD9 AD916BC9 0CA8E9FD 9CF5498F 5BADC000",
};

function parse(hex) { return Buffer.from(hex.replace(/\s+/g, ""), "hex"); }
function hexStr(buf) { return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" "); }

// Parse and extract ciphertext
const parsed = {};
for (const [name, hex] of Object.entries(ships)) {
    const raw = parse(hex);
    const iv = raw.slice(HEADER_LEN, HEADER_LEN + IV_LEN);
    const ct = raw.slice(HEADER_LEN + IV_LEN);
    parsed[name] = { iv, ct };
}

// Ciphertext is 90 bytes for all four ships
const CT_LEN = 90;

console.log("=== Plaintext Template v2 ===\n");
console.log(`Ciphertext: ${CT_LEN} bytes (bytes 17-106 of raw tag)\n`);

// The plaintext must fit: identity record + 3 resource ref records = 90 bytes
//
// From the sub-record iterator (0x10706):
//   Each sub-record: [type:1][param:1][length:1][payload:length]
//
// From the TLV parser (0x4EC58):
//   Each TLV: [type_id:2][content_length:2][payload]
//
// The question is: is the 90-byte plaintext in sub-record format (Layer 1)
// or TLV format (Layer 2)?
//
// Key clue: the resource ref extraction at 0x52454 reads tag_byte at offset +8
// from its base pointer, and content_length must be 0x0C (12). The TLV header
// is 4 bytes, so:
//   - TLV header bytes 0-3: [type_id_lo, type_id_hi, len_lo=0x0C, len_hi=0x00]
//   - TLV payload bytes 4-15: 12 bytes of content
//   - Within payload: tag_byte at payload[4] = offset 8 from TLV start
//   - sub_type at payload[6-7] = offset 10-11 from TLV start
//   - content_ref at payload[8-9] = offset 12-13 from TLV start
//   - bank fields at payload[10-15] = offset 14-19 from TLV start
//   Total TLV record: 4 header + 12 payload = 16 bytes
//
// Wait — payload[4] is offset 8 from TLV start (4 header + 4). So the first
// 4 payload bytes (offsets 4-7) are something else before tag_byte.
//
// Actually: content_length = 12, meaning payload is 12 bytes (offsets 4-15).
// tag_byte is at PAYLOAD offset 4 (= TLV offset 8). So payload bytes 0-3
// are a sub-header within the resource ref payload.
// But 4 sub-header + 1 tag_byte + 1 session + 2 sub_type + 2 content_ref +
// 2 bank_idx + 2 bank_ref + 2 field4 = 16 bytes. That's more than 12.
//
// Unless content_length doesn't count the sub-header. Let me reconsider.
// r14 might point to the OUTER record start (before the TLV header).
// If the check is content_length == 0x0C, and the resource ref data starts
// at offset 8 from r14, then:
//   r14[0-3]: outer framing (could be sub-record header or TLV header)
//   r14[4-7]: more framing
//   r14[8]: tag_byte = 0x12
//   r14[9]: session
//   r14[10-11]: sub_type = 0x0008
//   r14[12-13]: content_ref
//   r14[14-15]: field2
//   r14[16-17]: bank_index (≤ 499)
//   r14[18-19]: field4
//
// Total from r14: 20 bytes per resource ref record
//
// For the content identity TLV (type 0x22):
// From 0xED74: reads content_lo(u32) at +0, content_hi(u16) at +4, type_byte at +6
// This is 7 bytes, but the pointer is to the reassembled payload after TLV parsing.
// The TLV header adds 4 bytes: [22 00 07 00] + 7 bytes = 11 bytes
//
// BUT: the content identity extraction at 0x4FC58 uses a DIFFERENT format
// with a flag byte. The actual sub-record for identity is:
//   [flag:1][content_hi:2][content_lo:4] = 7 bytes (compact)
// or
//   [flag:1][???:6][content_hi:2][content_lo:4] = 13 bytes (extended)
//
// This suggests the raw encrypted data uses the sub-record format, not TLV.

// Let's try BOTH layout models and see which fits 90 bytes:

console.log("=== Layout Model A: Layer 1 Sub-Records ===\n");
console.log("Each sub-record: [type:1][param:1][length:1][payload:length]\n");

// Identity sub-record (compact): 3 header + 7 payload = 10 bytes
// Identity sub-record (extended): 3 header + 13 payload = 16 bytes
// Resource ref sub-record: 3 header + ??? payload
//   The resource ref at 0x52454 reads from offsets 8-19 relative to its base.
//   If base = sub-record start, then offset 8 is payload byte 5 (after 3-byte header).
//   payload[0-4]: sub-header (5 bytes)
//   payload[5]: tag_byte
//   etc.
//   Total payload: at least 17 bytes (5 sub-header + 12 data). Sub-record: 3+17 = 20

// Model A1: compact identity (10) + 3 × resource ref sub-records
// 10 + 3*R = 90 → R = 80/3 = 26.67 — not integer. Try R as sub-record total.
// If each resource ref sub-record is variable... let me just try fixed sizes.

for (const idSize of [7, 10, 13, 16]) {
    for (const refSize of [14, 16, 17, 18, 20, 22, 24, 26, 27]) {
        const total = idSize + 3 * refSize;
        if (total === 90) {
            console.log(`  Identity=${idSize}B + 3 × Ref=${refSize}B = ${total} ✓`);
        }
    }
}

console.log("\n=== Layout Model B: Layer 2 TLVs ===\n");
console.log("Each TLV: [type_id:2][content_length:2][payload:content_length]\n");

// Identity TLV: 4 header + 7 payload = 11 bytes
// Resource ref TLV: 4 header + 12 payload = 16 bytes (if content_length=12)
// But the extraction reads up to offset 19, which is 20 bytes from base...
// Unless base != TLV start

for (const idSize of [11, 15, 17]) {
    for (const refSize of [16, 20, 24]) {
        const total = idSize + 3 * refSize;
        if (total === 90) {
            console.log(`  Identity=${idSize}B + 3 × Ref=${refSize}B = ${total} ✓`);
        }
    }
}

console.log("\n=== Layout Model C: Mixed / With Outer Framing ===\n");
// Maybe there's an outer container header before the records
for (const outerHeader of [0, 2, 4, 6, 8]) {
    for (const idSize of [7, 10, 11, 13, 16]) {
        for (const refSize of [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) {
            const total = outerHeader + idSize + 3 * refSize;
            if (total === 90) {
                console.log(`  Header=${outerHeader}B + Identity=${idSize}B + 3 × Ref=${refSize}B = ${total} ✓`);
            }
        }
    }
}

// Now check same models against Fuel Cargo (101 bytes, 1 cap = item scan only)
// CT = 101 - 5 - 12 = 84 bytes (assuming IV=12, no MAC)
// If Fuel has just 1 resource ref: identity + 1*ref = 84
// If Fuel has 2 refs (item + timer): identity + 2*ref = 84

console.log("\n=== Cross-check against Fuel Cargo (84 bytes plaintext) ===\n");
console.log("Fuel has item scan only (no PAwR, no button). Probably 1 ref.\n");

for (const outerHeader of [0, 2, 4, 6, 8]) {
    for (const idSize of [7, 10, 11, 13, 16]) {
        for (const refSize of [14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26]) {
            // Ships: header + id + 3*ref = 90
            // Fuel: header + id + 1*ref = 84 (just item scan)
            const shipTotal = outerHeader + idSize + 3 * refSize;
            const fuelTotal = outerHeader + idSize + 1 * refSize;
            if (shipTotal === 90 && fuelTotal === 84) {
                console.log(`  *** MATCH: Header=${outerHeader}B + Identity=${idSize}B + Ref=${refSize}B ***`);
                console.log(`    Ships: ${outerHeader} + ${idSize} + 3×${refSize} = ${shipTotal}`);
                console.log(`    Fuel:  ${outerHeader} + ${idSize} + 1×${refSize} = ${fuelTotal}`);

                // Cross-check with Hyperdrive (109 bytes = 92 CT, item+timer = 2 refs)
                const hyperPT = 109 - 5 - 12; // 92
                const hyperTotal = outerHeader + idSize + 2 * refSize;
                const hyperMatch = hyperTotal === hyperPT;
                console.log(`    Hyper: ${outerHeader} + ${idSize} + 2×${refSize} = ${hyperTotal} (expected ${hyperPT}) ${hyperMatch ? "✓" : "✗"}`);

                // Cross-check with Lightsaber (126 bytes = 109 CT, item+timer+button = 3 refs)
                const saberPT = 126 - 5 - 12; // 109
                const saberTotal = outerHeader + idSize + 3 * refSize;
                const saberMatch = saberTotal === saberPT;
                console.log(`    Saber: ${outerHeader} + ${idSize} + 3×${refSize} = ${saberTotal} (expected ${saberPT}) ${saberMatch ? "✓" : "✗"}`);

                // Cross-check R2-D2 (74 bytes = 57 CT, identity = 1 ref only?)
                const r2PT = 74 - 5 - 12; // 57
                for (let nRefs = 1; nRefs <= 4; nRefs++) {
                    const r2Total = outerHeader + idSize + nRefs * refSize;
                    if (r2Total === r2PT) {
                        console.log(`    R2-D2: ${outerHeader} + ${idSize} + ${nRefs}×${refSize} = ${r2Total} ✓ (${nRefs} refs)`);
                    }
                }

                // Cross-check Luke (157 bytes = 140 CT, identity+timer+button+npm = 4+ refs)
                const lukePT = 157 - 5 - 12; // 140
                for (let nRefs = 3; nRefs <= 8; nRefs++) {
                    const lukeTotal = outerHeader + idSize + nRefs * refSize;
                    if (lukeTotal === lukePT) {
                        console.log(`    Luke:  ${outerHeader} + ${idSize} + ${nRefs}×${refSize} = ${lukeTotal} ✓ (${nRefs} refs)`);
                    }
                }

                // Vader (169 = 152 CT)
                const vaderPT = 169 - 5 - 12; // 152
                for (let nRefs = 3; nRefs <= 10; nRefs++) {
                    const vaderTotal = outerHeader + idSize + nRefs * refSize;
                    if (vaderTotal === vaderPT) {
                        console.log(`    Vader: ${outerHeader} + ${idSize} + ${nRefs}×${refSize} = ${vaderTotal} ✓ (${nRefs} refs)`);
                    }
                }

                console.log();
            }
        }
    }
}
