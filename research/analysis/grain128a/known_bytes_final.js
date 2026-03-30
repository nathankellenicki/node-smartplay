/**
 * Final Known Bytes Compilation
 *
 * For the 4 ship tags (X-Wing, TIE, Falcon, A-Wing), all 107 bytes:
 *
 * Raw tag layout:
 *   Bytes 0-3:    Cleartext header (00 6B 01 0C)
 *   Byte 4:       Format byte (01)
 *   Bytes 5-16:   IV (12 bytes, unique per content)
 *   Bytes 17-106: Ciphertext (90 bytes)
 *
 * Plaintext layout (90 bytes):
 *   Offsets 0-50:  identity_block (51 bytes)
 *   Offsets 51-56: timer_ref (6 bytes)
 *   Offsets 57-89: button_ref (33 bytes)
 *
 * KNOWN BYTE VALUES:
 *
 * Timer ref (offsets 51-56):
 *   All 6 bytes identical across all 4 ships.
 *   If sub-record [type:1][param:1][length:1][payload]:
 *     PT[53] might be length=3 (if 3-byte payload)
 *     Within payload, content_ref = 24 → two bytes are 0x18, 0x00
 *   PT[54] = 0x18 and PT[55] = 0x00 is our FIRMEST hypothesis.
 *
 * For EACH combination of (item_param, button_param), compute candidate
 * keystream bytes across all 4 tags and store them. When we eventually
 * get the key (or more constraints), we can verify which combination
 * is correct.
 */

const HEADER_LEN = 5;
const IV_LEN = 12;

const ships = {
    "X-Wing":  "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800",
    "TIE":     "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800",
    "Falcon":  "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00",
    "A-Wing":  "006B010C 01724CE6 103EC87C 94C91117 3B608C0E EDC6144B E73BD6C1 7D741FB9 942BC72E D5DDF21C 112C4A95 3A486B27 ADED151E 8F72A42E 261A41A6 D2903787 64A717D5 B4E6F69D F0FCD54E 08B78505 B5E54E03 316CE69B 2C693FD9 AD916BC9 0CA8E9FD 9CF5498F 5BADC000",
};

function parse(hex) { return Buffer.from(hex.replace(/\s+/g, ""), "hex"); }
function hexStr(buf) { return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" "); }

// Parse tags
const tagData = {};
for (const [name, hex] of Object.entries(ships)) {
    const raw = parse(hex);
    tagData[name] = {
        iv: raw.slice(HEADER_LEN, HEADER_LEN + IV_LEN),
        ct: raw.slice(HEADER_LEN + IV_LEN),
    };
}

// Known content_ref values
const TIMER_CONTENT_REF = 24; // PAwR combat script #42
const ITEM_PARAMS = [1448, 68, 1192, 1296, 1128];
const BUTTON_PARAMS = [104, 72, 112, 80, 88, 64, 96];

console.log("=== Final Known Bytes for Ship Tags ===\n");

// Firm known bytes: PT[54]=0x18, PT[55]=0x00 (timer content_ref=24)
console.log("--- Firm Known Bytes (timer_ref region) ---\n");
console.log("PT[54] = 0x18 (content_ref_lo = 24)");
console.log("PT[55] = 0x00 (content_ref_hi = 0)\n");

console.log("Resulting keystream bytes:\n");
console.log("Tag".padEnd(10), "IV", " ".repeat(34), "CT[54] CT[55] KS[54] KS[55]");
for (const [name, data] of Object.entries(tagData)) {
    const ks54 = data.ct[54] ^ 0x18;
    const ks55 = data.ct[55] ^ 0x00;
    console.log(
        `${name.padEnd(10)} ${hexStr(data.iv)}  ` +
        `0x${data.ct[54].toString(16).padStart(2,"0")}   0x${data.ct[55].toString(16).padStart(2,"0")}   ` +
        `0x${ks54.toString(16).padStart(2,"0")}   0x${ks55.toString(16).padStart(2,"0")}`
    );
}

// For each (item_param, button_param) combination, compute candidate KS bytes
console.log("\n--- Candidate Keystream Bytes for Each (item, button) Combo ---\n");
console.log("There are 5 × 7 = 35 possible combinations.");
console.log("The correct combination will produce keystream bytes consistent with Grain-128A.\n");

// We need to know WHERE in the plaintext the item content_ref and button content_ref sit.
// From the model:
//   identity_block[0-50]: contains item scan ref with content_ref at SOME offset
//   button_ref[57-89]: contains button content_ref at SOME offset
//
// From the disassembly (0x52454): within a resource ref record, content_ref is at
// relative offsets +12 and +13 (LE u16). But we don't know the absolute offset
// within identity_block or button_ref.
//
// However, the identity_block is 51 bytes and contains:
//   - Content identity (flag byte + 6 bytes) ≈ 7 bytes
//   - Item scan resource ref ≈ 44 bytes (51-7)
// That's a lot for one resource ref. It likely includes:
//   - Sub-record header (3 bytes)
//   - TLV header (4 bytes)
//   - Sub-header (4 bytes)
//   - Resource ref data (12 bytes from content_length=0x0C)
//   - Plus the identity record
//   Total: 7 + 3 + 4 + 4 + 12 = 30. Still 21 bytes short of 51.
//
// Clearly there's more structure than our simple model accounts for.
// The exact offsets within identity_block remain uncertain.

// What we CAN say about button_ref (33 bytes):
// Sub-record header: 3 bytes
// Payload: 30 bytes
// Within payload, resource ref data at offsets relative to the sub-record:
//   +8 from record base: tag_byte = 0x12
//   +10-11: sub_type = 0x08, 0x00
//   +12-13: content_ref (button param)
//   +14-15: content_ref_end
//   +16-17: bank_index (≤499)
//   +18-19: bank_ref
//
// Record base = button_ref start = PT offset 57
// So in absolute PT offsets:
//   PT[57+8] = PT[65]: tag_byte = 0x12
//   PT[57+10] = PT[67]: sub_type_lo = 0x08
//   PT[57+11] = PT[68]: sub_type_hi = 0x00
//   PT[57+12] = PT[69]: button content_ref_lo
//   PT[57+13] = PT[70]: button content_ref_hi
//   PT[57+16] = PT[73]: bank_index_lo (≤499)
//   PT[57+17] = PT[74]: bank_index_hi (0x00 or 0x01)

console.log("--- Button ref: hypothesized absolute PT offsets ---\n");
console.log("  PT[65] = 0x12 (tag_byte)      — SAME for all ships");
console.log("  PT[67] = 0x08 (sub_type_lo)   — SAME for all ships");
console.log("  PT[68] = 0x00 (sub_type_hi)   — SAME for all ships");
console.log("  PT[69] = button content_ref_lo — SAME for all ships (unknown which of 7)");
console.log("  PT[70] = button content_ref_hi — SAME for all ships");
console.log("  PT[73] = bank_index_lo         — DIFFERS per ship");
console.log("  PT[74] = bank_index_hi (0x00 or 0x01) — DIFFERS per ship\n");

// Verify: at PT[65]=0x12, all 4 ships should have KS byte = CT[65] ^ 0x12
console.log("If PT[65] = 0x12, keystream at position 65:");
for (const [name, data] of Object.entries(tagData)) {
    console.log(`  ${name.padEnd(10)} CT[65]=0x${data.ct[65].toString(16).padStart(2,"0")} → KS[65]=0x${(data.ct[65]^0x12).toString(16).padStart(2,"0")}`);
}

console.log("\nIf PT[67] = 0x08, keystream at position 67:");
for (const [name, data] of Object.entries(tagData)) {
    console.log(`  ${name.padEnd(10)} CT[67]=0x${data.ct[67].toString(16).padStart(2,"0")} → KS[67]=0x${(data.ct[67]^0x08).toString(16).padStart(2,"0")}`);
}

console.log("\nIf PT[68] = 0x00, keystream at position 68:");
for (const [name, data] of Object.entries(tagData)) {
    console.log(`  ${name.padEnd(10)} CT[68]=0x${data.ct[68].toString(16).padStart(2,"0")} → KS[68]=0x${(data.ct[68]^0x00).toString(16).padStart(2,"0")}`);
}

// For each button param candidate, compute KS at positions 69-70
console.log("\n--- Button param candidates → KS bytes at PT[69-70] ---\n");
for (const bp of BUTTON_PARAMS) {
    const lo = bp & 0xFF;
    const hi = (bp >> 8) & 0xFF;
    console.log(`Button param ${bp} (LE: ${lo.toString(16).padStart(2,"0")} ${hi.toString(16).padStart(2,"0")}):`);
    for (const [name, data] of Object.entries(tagData)) {
        const ks69 = data.ct[69] ^ lo;
        const ks70 = data.ct[70] ^ hi;
        console.log(`  ${name.padEnd(10)} KS[69]=0x${ks69.toString(16).padStart(2,"0")} KS[70]=0x${ks70.toString(16).padStart(2,"0")}`);
    }
    console.log();
}

// Also check PT[74] = bank_index_hi. If bank_index ≤ 499, high byte is 0x00 or 0x01.
// For each ship, CT[74] is either KS[74]^0x00 or KS[74]^0x01.
// In most cases bank_index < 256, so high byte = 0x00.
console.log("--- bank_index high byte check (PT[74]) ---\n");
console.log("If bank_index < 256: PT[74] = 0x00, so CT[74] = KS[74]");
for (const [name, data] of Object.entries(tagData)) {
    console.log(`  ${name.padEnd(10)} CT[74]=0x${data.ct[74].toString(16).padStart(2,"0")} (= KS[74] if bank_idx_hi=0x00)`);
}

// FINAL SUMMARY: all known/constrained keystream bytes per ship tag
console.log("\n=== TOTAL KNOWN KEYSTREAM BYTES PER TAG ===\n");
console.log("FIRM (exact PT value known):");
console.log("  Position 54: PT=0x18 (timer content_ref lo)");
console.log("  Position 55: PT=0x00 (timer content_ref hi)");
console.log("  Position 65: PT=0x12 (button tag_byte) *if offset hypothesis correct*");
console.log("  Position 67: PT=0x08 (button sub_type lo) *if offset hypothesis correct*");
console.log("  Position 68: PT=0x00 (button sub_type hi) *if offset hypothesis correct*");
console.log();
console.log("CONSTRAINED (from small set):");
console.log("  Position 69: PT = one of", BUTTON_PARAMS.map(p => "0x"+(p&0xFF).toString(16).padStart(2,"0")));
console.log("  Position 70: PT = one of", [...new Set(BUTTON_PARAMS.map(p => "0x"+((p>>8)&0xFF).toString(16).padStart(2,"0")))]);
console.log("  Position 74: PT = 0x00 or 0x01 (bank_index hi)");
console.log();
console.log("All timer_ref bytes (positions 51-56): SAME across all 4 ships, unknown values");
console.log("Many identity_block bytes: SAME across ships, unknown values");
console.log();

const firmCount = 5; // 54,55,65,67,68
const constrainedCount = 3; // 69,70,74
console.log(`Total firm known bytes per tag: ${firmCount}`);
console.log(`Total constrained bytes per tag: ${constrainedCount}`);
console.log(`With 4 tags: ${firmCount*4} firm + ${constrainedCount*4} constrained = ${(firmCount+constrainedCount)*4} total constraint points on the 128-bit key`);
console.log();
console.log("This gives us ~40 firm bits + ~20 constrained bits across 4 different IVs.");
console.log("Combined with the 66 shared-but-unknown bytes, the key is heavily over-determined.");
console.log("A SAT solver or algebraic attack with a better encoding might succeed.");
