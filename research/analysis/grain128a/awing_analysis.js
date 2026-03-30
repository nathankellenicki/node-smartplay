/**
 * A-Wing Tag Analysis
 *
 * A-Wing has payload length 0x6B = 107 bytes — same as X-Wing, TIE Fighter, and Falcon!
 * All four are item tags with PAwR combat. Same scripts, different audio/animation.
 *
 * This means their resource ref records have IDENTICAL content_ref values.
 * We now have 4 tags with same structure, same content_refs, different IVs.
 */

const tags = {
    "X-Wing": {
        hex: "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800",
    },
    "TIE Fighter": {
        hex: "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800",
    },
    "Millennium Falcon": {
        hex: "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00",
    },
    "A-Wing": {
        hex: "006B010C 01724CE6 103EC87C 94C91117 3B608C0E EDC6144B E73BD6C1 7D741FB9 942BC72E D5DDF21C 112C4A95 3A486B27 ADED151E 8F72A42E 261A41A6 D2903787 64A717D5 B4E6F69D F0FCD54E 08B78505 B5E54E03 316CE69B 2C693FD9 AD916BC9 0CA8E9FD 9CF5498F 5BADC000",
    },
};

function parse(hex) { return Buffer.from(hex.replace(/\s+/g, ""), "hex"); }
function hexStr(buf) { return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" "); }

const IV_LEN = 12;
const HEADER_LEN = 5; // 00 6B 01 0C 01

console.log("=== Four Same-Structure Item Tags (107 bytes, PAwR combat) ===\n");

// Parse all tags
const parsed = {};
for (const [name, tag] of Object.entries(tags)) {
    const raw = parse(tag.hex);
    const iv = raw.slice(HEADER_LEN, HEADER_LEN + IV_LEN);
    const ct = raw.slice(HEADER_LEN + IV_LEN);
    parsed[name] = { raw, iv, ct };
    console.log(`${name}:`);
    console.log(`  IV:  ${hexStr(iv)}`);
    console.log(`  CT:  ${ct.length} bytes`);
    console.log(`  CT:  ${hexStr(ct.slice(0, 32))}...`);
    console.log();
}

// All 4 tags have identical content_ref values at the same positions.
// At content_ref positions: plaintext is SAME, keystream differs
// At bank positions: plaintext DIFFERS, keystream differs
//
// XOR of two tags' ciphertext:
//   At content_ref pos: ct_A ^ ct_B = ks_A ^ ks_B (plaintext cancels)
//   At bank pos: ct_A ^ ct_B = (P_A ^ P_B) ^ (ks_A ^ ks_B)
//
// With 4 tags we have 6 pairs. For content_ref positions, ALL 6 pairwise
// XORs should satisfy the XOR transitivity relation perfectly:
//   XOR(A,B) ^ XOR(A,C) = XOR(B,C)
// This is always true by definition... BUT the VARIANCE across pairs tells us something.
//
// Better test: for positions where plaintext is the SAME across all 4 tags,
// the pairwise XOR values only depend on keystream differences.
// For positions where plaintext DIFFERS, the XOR values include both
// plaintext and keystream differences.
//
// If we compute ALL 6 pairwise XORs at each byte position, and look for
// positions where the XOR values have LOW VARIANCE relative to the keystream
// differences... actually no, keystream differences are random either way.

// The real test: given 4 tags with same structure but different IVs,
// we can check which positions have IDENTICAL ciphertext bytes across
// specific tag pairs. If two tags happen to have the same keystream byte
// at position P (probability 1/256), and the plaintext is also the same
// (content_ref), then ct_A[P] == ct_B[P]. But if plaintext differs (bank),
// the probability drops.
//
// With 6 pairs, finding a position where ALL pairs that share content_ref
// show coincidental matches is extremely unlikely. Not useful.

// Let's instead focus on what we CAN determine:
// 1. The IV for the A-Wing (new data!)
// 2. Size confirmation (107 bytes, same as the other three)
// 3. Whether A-Wing shares any ciphertext bytes with the others
//    (would only happen if same keystream byte AND same plaintext byte)

console.log("=== Byte-by-byte comparison of all 4 ciphertexts ===\n");
const names = Object.keys(parsed);
const cts = names.map(n => parsed[n].ct);
const minLen = Math.min(...cts.map(c => c.length));

// For each position, check if any pair shares the same byte
console.log("Positions where 2+ tags share the same ciphertext byte:\n");
for (let pos = 0; pos < minLen; pos++) {
    const vals = cts.map(c => c[pos]);
    const groups = {};
    vals.forEach((v, i) => {
        if (!groups[v]) groups[v] = [];
        groups[v].push(names[i]);
    });
    const matches = Object.entries(groups).filter(([, ns]) => ns.length >= 2);
    if (matches.length > 0) {
        for (const [val, ns] of matches) {
            console.log(`  pos ${pos.toString().padStart(2)}: 0x${parseInt(val).toString(16).padStart(2, "0")} shared by ${ns.join(", ")}`);
        }
    }
}

// XOR all 6 pairs and show the full XOR for each
console.log("\n=== Pairwise XOR of ciphertexts (first 48 bytes) ===\n");
for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
        const xor = Buffer.alloc(minLen);
        for (let k = 0; k < minLen; k++) xor[k] = cts[i][k] ^ cts[j][k];
        console.log(`${names[i]} ⊕ ${names[j]}:`);
        console.log(`  ${hexStr(xor.slice(0, 24))}`);
        console.log(`  ${hexStr(xor.slice(24, 48))}`);
        console.log();
    }
}

// Now try to determine the item script param.
// The 5 item script params are: 1448, 68, 1192, 1296, 1128
// As u16 LE:
//   1448 = 0x05A8 -> A8 05
//   68   = 0x0044 -> 44 00
//   1192 = 0x04A8 -> A8 04
//   1296 = 0x0510 -> 10 05
//   1128 = 0x0468 -> 68 04
// Timer script #42 param = 24 = 0x0018 -> 18 00

console.log("=== Item script param candidates (u16 LE) ===\n");
const itemParams = [
    { script: 16, param: 1448, le: [0xA8, 0x05] },
    { script: 17, param: 68,   le: [0x44, 0x00] },
    { script: 18, param: 1192, le: [0xA8, 0x04] },
    { script: 19, param: 1296, le: [0x10, 0x05] },
    { script: 20, param: 1128, le: [0x68, 0x04] },
];
const timerParam = { script: 42, param: 24, le: [0x18, 0x00] };

for (const p of itemParams) {
    console.log(`  Script #${p.script}: param=${p.param} -> LE bytes: ${p.le.map(b => b.toString(16).padStart(2,"0")).join(" ")}`);
}
console.log(`  Timer #${timerParam.script}: param=${timerParam.param} -> LE bytes: ${timerParam.le.map(b => b.toString(16).padStart(2,"0")).join(" ")}`);

console.log("\n=== Known plaintext summary for these 4 tags ===\n");
console.log("All 4 share (same bytes at same position in plaintext):");
console.log("  - Content identity TLV header: 22 00 07 00");
console.log("  - type_byte: 06 (item)");
console.log("  - tag_byte: 12 (in each resource ref)");
console.log("  - sub_type: 08 00 (in each resource ref)");
console.log("  - content_ref for item script: one of [A8 05, 44 00, A8 04, 10 05, 68 04]");
console.log("  - content_ref for timer script: 18 00");
console.log("  - content_length per ref: 0C 00");
console.log();
console.log("They DIFFER in:");
console.log("  - Content identity (6 bytes, unique per tag content)");
console.log("  - bank_index (u16 LE, ≤ 499, different animations)");
console.log("  - bank_ref (u16 LE, different audio)");
