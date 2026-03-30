/**
 * Final Plaintext Map for 107-byte Ship Tags
 *
 * Validated model:
 *   identity_block(51) + timer_ref(6) + button_ref(33) = 90 bytes plaintext
 *
 * identity_block = 51 bytes:
 *   - Content identity sub-record (flag + identity bytes)
 *   - Item scan resource ref (with content_ref matching one of 5 item script params)
 *   - Possibly includes TLV/sub-record headers
 *
 * timer_ref = 6 bytes:
 *   - Minimal sub-record for timer script selection
 *   - Likely: [type:1][param:1][length:1][content_ref:2][???:1] or similar
 *   - content_ref = 24 (0x18 0x00 LE) for PAwR combat script #42
 *
 * button_ref = 33 bytes:
 *   - Larger record with full audio/animation bank references
 *   - Contains tag_byte(0x12), sub_type(0x0008), content_ref, bank_index, bank_ref
 *
 * Known bytes in the 90-byte plaintext:
 *
 * WITHIN identity_block (51 bytes, offsets 0-50):
 *   - TLV/sub-record type indicators (fixed per tag type)
 *   - type_byte = 0x06 (item) at some offset
 *   - Item scan content_ref: one of {1448, 68, 1192, 1296, 1128}
 *   - Item scan tag_byte(0x12), sub_type(0x08,0x00)
 *
 * WITHIN timer_ref (6 bytes, offsets 51-56):
 *   - content_ref = 24 → LE bytes: 0x18, 0x00
 *   - Sub-record header bytes (type, param, length)
 *
 * WITHIN button_ref (33 bytes, offsets 57-89):
 *   - tag_byte = 0x12
 *   - sub_type = 0x08, 0x00
 *   - content_ref: one of button params {104, 72, 112, 80, 88, 64, 96}
 *   - bank_index ≤ 499 (high byte 0x00 or 0x01)
 *
 * SHARED across X-Wing, TIE, Falcon, A-Wing:
 *   - All bytes in identity_block EXCEPT the 6-byte content identity itself
 *   - All bytes in timer_ref (same timer script for all)
 *   - tag_byte, sub_type, content_ref in button_ref (same button script)
 *   - bank_index and bank_ref in button_ref DIFFER (different audio/animation)
 */

const HEADER_LEN = 5;
const IV_LEN = 12;

const ships = {
    "X-Wing": "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800",
    "TIE":    "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800",
    "Falcon": "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00",
    "A-Wing": "006B010C 01724CE6 103EC87C 94C91117 3B608C0E EDC6144B E73BD6C1 7D741FB9 942BC72E D5DDF21C 112C4A95 3A486B27 ADED151E 8F72A42E 261A41A6 D2903787 64A717D5 B4E6F69D F0FCD54E 08B78505 B5E54E03 316CE69B 2C693FD9 AD916BC9 0CA8E9FD 9CF5498F 5BADC000",
};

// Also include Fuel Cargo for cross-validation
const fuel = "0065010C 017E7CC6 1279C2FB 3ADBEF45 D4FDC4AE 1174BE25 A087B9F5 979CC046 3B6C4F4B EFAF1413 B980F514 1A2D695C 24931E85 9C8E9B8E 25BEE5FB 5020022E 7ADE25EC FF6CCC2B B70A314D ED49F1ED C8C98617 D2F1600F ED891C94 E805FB14 9815F2BB C2000000";
// Han Solo for identity cross-check
const han = "0071010C 016013A1 B661B946 BB7D02E4 31DD63F7 45E4C5A6 5A3BB5E4 D0365F4D 815D05B1 D2083EFB 0DAB2F32 E9A03B90 B4A371C8 6156E294 30AC1A80 355DB811 7F24CB9D C2D2FACC 194F4C1D E62A80D9 BA9E90BF D87120BF A183C698 AD9A2989 04688BCF 2C8C382C 20CA613B 0A8A9685 3E000000";
// R2-D2 for minimal tag cross-check
const r2d2 = "004A010C 0124B410 E7C0D07D 2DFDB513 F90D499A 3CB6454F FB90BF80 5918C185 68570FCE FE3DD860 47B1C905 2B16AEA1 7C4C16B4 AFAF9482 D59FA941 69C31FF0 F9EB1313 8613E241 F1710000";

function parse(hex) { return Buffer.from(hex.replace(/\s+/g, ""), "hex"); }
function hexStr(buf) { return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" "); }

// Extract IVs and ciphertexts
function extract(hex) {
    const raw = parse(hex);
    return {
        iv: raw.slice(HEADER_LEN, HEADER_LEN + IV_LEN),
        ct: raw.slice(HEADER_LEN + IV_LEN),
    };
}

const shipData = {};
for (const [name, hex] of Object.entries(ships)) {
    shipData[name] = extract(hex);
}

console.log("=== Ship Tag Ciphertext Comparison ===\n");
console.log("All 4 ships have 90 bytes of ciphertext.\n");

// For positions where ALL 4 ships have the SAME plaintext,
// the ciphertext differences are purely keystream differences.
// For positions where plaintext DIFFERS (content identity, bank values),
// the ciphertext differences include both plaintext and keystream differences.
//
// We can't separate them, but we CAN check WHICH positions are most likely
// "same plaintext" by looking at the statistical properties of the 6 pairwise XORs.
//
// Specifically: at a "same plaintext" position, the 6 pairwise XOR values
// are all purely keystream XORs. At a "different plaintext" position,
// some XOR values also include plaintext differences.
//
// The XOR values should satisfy: XOR(A,B) ^ XOR(A,C) = XOR(B,C) always (tautology).
// But we can check if the VALUES at each position are consistent with
// the known structure.

const names = Object.keys(shipData);
const cts = names.map(n => shipData[n].ct);

// Compute all 6 pairwise XORs
const pairs = [];
for (let i = 0; i < 4; i++)
    for (let j = i + 1; j < 4; j++)
        pairs.push({ a: names[i], b: names[j], ai: i, bi: j });

console.log("--- Timer ref region (offsets 51-56) ---\n");
console.log("If timer_ref = 6 bytes at plaintext offsets 51-56, ALL bytes are");
console.log("identical across all 4 ships (same timer script, content_ref=24).\n");
console.log("Ciphertext bytes at these positions:\n");

for (let pos = 51; pos < 57; pos++) {
    const vals = cts.map(ct => ct[pos]);
    console.log(`  pos ${pos}: ${names.map((n, i) => `${n.padEnd(8)}=0x${vals[i].toString(16).padStart(2, "0")}`).join("  ")}`);
}

console.log("\n--- Button ref region (offsets 57-89) ---\n");
console.log("button_ref = 33 bytes. content_ref is shared (same button script),");
console.log("but bank_index and bank_ref differ (different audio/animation).\n");

// The button ref likely has sub-record structure.
// If it's a Layer 1 sub-record: [type:1][param:1][length:1][payload:30]
// The payload would contain the full resource ref data:
//   [sub-header:N][tag_byte(0x12)][session][sub_type(0x08,0x00)]
//   [content_ref:2][field2:2][bank_index:2][field4:2]
// Total data = 12 bytes (from firmware validation content_length=0x0C)
// Plus whatever framing. 33 - 3 (sub-record header) = 30 bytes payload.
// 30 bytes > 12 bytes of resource ref data. So there's 18 bytes of
// additional framing/sub-header/TLV wrapping.

// The timer ref is only 6 bytes total. If sub-record: 3 header + 3 payload.
// 3 bytes of payload = content_ref(2) + something(1). Very compact.
// This suggests timer refs use a DIFFERENT sub-record type than full resource refs.

console.log("--- Known constants at known relative offsets within button ref ---\n");

// Within the 33-byte button ref, the resource ref data (from disassembly at 0x52454)
// has tag_byte=0x12 and sub_type=0x0008 at specific offsets.
// The question is: what's the base offset within the 33-byte block?
//
// If the record is: [sub-record hdr: 3][TLV hdr: 4][sub-hdr: 4][tag_byte][session][sub_type:2][content_ref:2][f2:2][bank_idx:2][f4:2]
// = 3 + 4 + 4 + 1 + 1 + 2 + 2 + 2 + 2 + 2 = 23 bytes. Leaves 10 bytes unaccounted.
//
// Or: [sub-record hdr: 3][payload: 30] where payload = [TLV: 4+12=16][other: 14]
// Multiple TLV records within one sub-record payload?

// Let's look at it empirically. Within the button_ref region (offsets 57-89),
// search for positions where tag_byte 0x12 would produce consistent XOR patterns.
// If all 4 tags have 0x12 at the same position, that's a "same plaintext" byte.

console.log("At each position in range 57-89, show if all 4 ciphertexts produce");
console.log("values consistent with same plaintext (checking all pair XOR consistency):\n");

// Actually, let's just show the raw ciphertext bytes for inspection
console.log("pos | X-Wing  TIE     Falcon  A-Wing | XOR(XW,TIE) XOR(XW,Fal) XOR(XW,AW)");
console.log("----+--------------------------------+---------------------------------------");

for (let pos = 0; pos < 90; pos++) {
    const v = cts.map(ct => ct[pos]);
    const xor01 = v[0] ^ v[1];
    const xor02 = v[0] ^ v[2];
    const xor03 = v[0] ^ v[3];

    // Region markers
    let region = "";
    if (pos < 51) region = "identity_block";
    else if (pos < 57) region = "timer_ref";
    else region = "button_ref";

    // Highlight region boundaries
    const boundary = (pos === 0 || pos === 51 || pos === 57) ? " <<<" : "";

    console.log(
        ` ${pos.toString().padStart(2)} | ${v.map(b => b.toString(16).padStart(2, "0")).join("     ")} | ` +
        `${xor01.toString(16).padStart(2, "0")}          ${xor02.toString(16).padStart(2, "0")}          ${xor03.toString(16).padStart(2, "0")}` +
        `  [${region}]${boundary}`
    );
}

// Summary of known bytes
console.log("\n=== Known Plaintext Byte Summary ===\n");

console.log("TIMER_REF (6 bytes at PT offsets 51-56):");
console.log("  All 4 ships have IDENTICAL plaintext here.");
console.log("  Contains content_ref = 24 (LE: 18 00) for PAwR timer script #42.");
console.log("  If sub-record format [type:1][param:1][length:1][payload:3]:");
console.log("    PT[51]: sub-record type (unknown, but same for all)");
console.log("    PT[52]: sub-record param (unknown, but same for all)");
console.log("    PT[53]: sub-record length = 3 (if payload is 3 bytes)");
console.log("    PT[54]: 0x18 (content_ref low = 24)");
console.log("    PT[55]: 0x00 (content_ref high = 0)");
console.log("    PT[56]: unknown (flag? preset type indicator?)");
console.log();

console.log("IDENTITY_BLOCK (51 bytes at PT offsets 0-50):");
console.log("  Contains content identity (6 bytes, DIFFERS per tag)");
console.log("  Contains item scan resource ref (content_ref SAME for all 4 ships)");
console.log("  type_byte = 0x06 at some offset within this block");
console.log("  tag_byte = 0x12 at some offset within item scan ref");
console.log("  sub_type = 0x08 0x00 within item scan ref");
console.log();

console.log("BUTTON_REF (33 bytes at PT offsets 57-89):");
console.log("  Contains button resource ref with shared content_ref");
console.log("  bank_index and bank_ref DIFFER (different audio/animation)");
console.log("  tag_byte = 0x12 at some offset within this block");
console.log("  sub_type = 0x08 0x00 within this block");
console.log("  bank_index ≤ 499 (high byte 0x00 or 0x01)");

// Count known bytes
console.log("\n=== Total Known Bytes ===\n");
console.log("Firm (value known for all 4 ships):");
console.log("  PT[54] = 0x18 (timer content_ref low)");
console.log("  PT[55] = 0x00 (timer content_ref high)");
console.log("  type_byte = 0x06 (somewhere in 0-50)");
console.log("  tag_byte = 0x12 (2 occurrences: in identity_block and button_ref)");
console.log("  sub_type = 0x08, 0x00 (2 occurrences)");
console.log("  Various sub-record/TLV header bytes (type, param, length fields)");
console.log();
console.log("Constrained (value from small set):");
console.log("  Item scan content_ref: one of {1448, 68, 1192, 1296, 1128}");
console.log("  Button content_ref: one of {104, 72, 112, 80, 88, 64, 96}");
console.log("  bank_index high byte: 0x00 or 0x01");
console.log();
console.log("Same across all 4 ships (value unknown but identical):");
console.log("  ~51 bytes in identity_block (minus 6 content identity bytes) = ~45 bytes");
console.log("  All 6 bytes in timer_ref = 6 bytes");
console.log("  content_ref + structural bytes in button_ref = ~15 bytes");
console.log("  TOTAL shared: ~66 out of 90 bytes");
console.log();
console.log("Differs across ships:");
console.log("  6 bytes content identity (in identity_block)");
console.log("  ~18 bytes bank data (bank_index + bank_ref in button_ref, plus any in identity_block scan ref)");
