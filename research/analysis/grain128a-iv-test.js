/**
 * Grain-128A IV Hypothesis Test
 *
 * Grain-128A: 128-bit key, 96-bit IV (12 bytes)
 * ISO 29167-13 defines optional MAC of 32 or 64 bits (4 or 8 bytes)
 *
 * Hypothesized tag layout:
 *   [00 LEN 01 0C] [01] [IV: 12 bytes] [ciphertext: M bytes] [MAC: T bytes]
 *   where T = 4 or 8 (Grain-128A MAC) or 0 (no MAC)
 *
 * Tests:
 * 1. Show the 12-byte IV region for each tag — are they all unique?
 * 2. Check if (payload_len - 1 - 12 - MAC_len) gives consistent content sizes
 *    for tags of similar type (identity vs item)
 * 3. For each MAC length candidate (0, 4, 8), compute the plaintext size
 *    and check if it's consistent with expected TLV content
 * 4. Do any tags share the same 12-byte IV? (would indicate keystream reuse)
 */

const allTags = [
    { name: "R2-D2",      cat: "identity", hex: "004A010C 0124B410 E7C0D07D 2DFDB513 F90D499A 3CB6454F FB90BF80 5918C185 68570FCE FE3DD860 47B1C905 2B16AEA1 7C4C16B4 AFAF9482 D59FA941 69C31FF0 F9EB1313 8613E241 F1710000" },
    { name: "Fuel Cargo",  cat: "item",     hex: "0065010C 017E7CC6 1279C2FB 3ADBEF45 D4FDC4AE 1174BE25 A087B9F5 979CC046 3B6C4F4B EFAF1413 B980F514 1A2D695C 24931E85 9C8E9B8E 25BEE5FB 5020022E 7ADE25EC FF6CCC2B B70A314D ED49F1ED C8C98617 D2F1600F ED891C94 E805FB14 9815F2BB C2000000" },
    { name: "X-Wing",      cat: "item",     hex: "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800" },
    { name: "TIE Fighter",cat: "item",     hex: "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800" },
    { name: "Falcon",      cat: "item",     hex: "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00" },
    { name: "Hyperdrive",  cat: "item",     hex: "006D010C 01391E39 1BF963C5 6034C4E8 8087456C 3BB3B1D1 7178BC51 201F0666 3D54CD4D 9639514E BDF6947D BAFD9248 16A66AE5 CEB5FB90 54FE3D6D 06B0850C 73790DB4 8DD1B176 E49F38F6 9510BA2F 6B99F4CC E1572E09 CEEF1099 47D20F56 A90705D8 6D2EE8B5 85D1CBA8 F7000000" },
    { name: "Han Solo",    cat: "identity", hex: "0071010C 016013A1 B661B946 BB7D02E4 31DD63F7 45E4C5A6 5A3BB5E4 D0365F4D 815D05B1 D2083EFB 0DAB2F32 E9A03B90 B4A371C8 6156E294 30AC1A80 355DB811 7F24CB9D C2D2FACC 194F4C1D E62A80D9 BA9E90BF D87120BF A183C698 AD9A2989 04688BCF 2C8C382C 20CA613B 0A8A9685 3E000000" },
    { name: "Chewbacca",   cat: "identity", hex: "0074010C 01B19451 307E75A9 A9B48714 6A083172 49151321 6E43560F ABD91C42 E9AB53E4 CC279604 45B5FD14 8DDDA9D1 473AADF6 8EA879DB E896B15C 7EE4A9CC D8747580 52A3F417 19812082 98C0CCAA 5CC64F9E 08DB07EE 02253028 16AF68EA 38C1C759 23686EB0 BA42C454 1D751180 E35435E1" },
    { name: "C-3PO",       cat: "identity", hex: "0076010C 0151346D FB4FAD66 D8D133EE 9C5BF0B4 F9EA5517 F1950589 F1D9205E BD82746D FF5EF7AC FA53E1E1 C7AF68BF C41DB821 F260FEE1 427B1369 D44A2A15 E1F72218 AB9C1852 23C3581C C2C07BE2 222D58A9 016ED90B 89BF4A87 58B4287D 8782542C 6935886B C981CEE2 7935D2D3 7931B9A2 8FB70000" },
    { name: "Lightsaber",  cat: "item",     hex: "007E010C 016DBCB0 506CDAED CFD2A462 5405A48D 5159FBCA 706F56FF C1D1FD22 BD52C871 1A0B5511 3E04812B 9CD2DDB0 0DC0D9F2 5BD51BBB D97A0A2A BA972F9E 8CB725DA 9D6B1082 3D2BEF36 DE8E7132 F8E2CF9F 25717886 EC48302C EE55A9D3 178093E1 517259F3 10EB6A8C 44B293C5 969FF19A 541FD387 58910DF4 01940000" },
    { name: "Luke",        cat: "identity", hex: "009D010C 018684CC 84C02C26 17C7F22F 6AFBFC1A EAC143C3 7BF10EE8 E42D4153 428F5968 1FB10BDD 1583B5D7 FF427A4C 29EF2B2F F7505AD1 1161D849 E26514F3 12131F33 DDBBE194 1DB0E715 6A31BA42 C612BA1E 3F72824A B7F29EC3 C3C51747 02D37913 A505D049 529FC18B 25494946 CA0D0A8D 2F539BA2 B3502B7F F493DFA6 043B474E AE60D59B 43D5D838 88B26178 C1C6831F F2030E10 572C8595 29000000" },
    { name: "Leia",        cat: "identity", hex: "009E010C 0148125F 4EB30B49 F376E96F A844DE7D DEC1FC45 92A2E9D7 9C46B8F1 A0FE430A EE8B31A2 6F6FA305 DD7821D6 BD331DC2 04212DEE 6998E3F8 1C6B8E9D E71DAED2 4B8ABC1F D1DC93B3 7C8B634B 69FDC4B0 FDBC5DE7 E22C98F2 97B28DEB 93587175 0E7E692B CEAA9343 5BE92C45 C368F2D3 E279C315 D582BCFE D855D137 687B7A4A D2B2E2F3 820F37C2 0212D358 AD53A16A 3E1B73D4 D96294E1 98950000" },
    { name: "Vader",       cat: "identity", hex: "00A9010C 012A7206 94F4E526 64D6CAC9 21D99698 19C2F253 7B9A87CB D0489F30 602F818A 63DAE39F 714F6A7E 77E4332E 6209F8DE 49891DD7 2C57294D BAE3E9A0 885F4757 30800964 0DC59A51 88F9DD30 88A9E603 99A3ECE7 46873AB6 EE875373 FE2230F7 6CDA7A90 54AE2A2F 11555915 2E4BA369 E3012555 214FDB4F A5F0B795 90B888B6 08573CD2 6E29A81A E2E35EA0 30117DF4 4880E803 5313DF2D 46792FC3 76248CDE 9A6584C3 3F000000" },
    { name: "Palpatine",   cat: "identity", hex: "00AB010C 010724FD 045CA7E3 FD2ABD4E 942E0769 6A35FCBB 9C5531EE 6946A54E 3A4C2584 764D27FA 53AFBDE7 DF9AA555 7BF2C46B 729FE6DB 80AC0BD8 A9964657 7D12B571 AE4AEFDA B9438236 79CFD21B 6EE87659 1CD90411 24FF3A0A 21C25A9D 737A027D 3CE4D4FF 32783132 A23B7BA5 74502612 ED415BC0 BA1C6C57 3CC5CBC7 E9ADDCC8 4F9DCFD5 FCCD0001 5AC47B82 ABD3EC99 355174B5 F550EFFD B04A018A 96534D21 1E746717 2E020300" },
];

function parse(hex) { return Buffer.from(hex.replace(/\s+/g, ""), "hex"); }
function hexStr(buf) { return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" "); }

const HEADER_LEN = 5; // 00 LEN 01 0C 01
const IV_LEN = 12;    // Grain-128A: 96-bit IV

const bufs = allTags.map(t => {
    const raw = parse(t.hex);
    const payloadLen = raw[1]; // header byte 1 = payload length
    // Actual data bytes after header (excluding trailing zeros)
    const dataAfterHeader = raw.slice(HEADER_LEN);
    return { ...t, raw, payloadLen, dataAfterHeader };
});

// Sort by payload size
bufs.sort((a, b) => a.payloadLen - b.payloadLen);

console.log("=== Grain-128A IV Hypothesis ===\n");
console.log("Grain-128A: 128-bit key, 96-bit IV (12 bytes)");
console.log("ISO 29167-13 MAC: 32-bit (4 bytes) or 64-bit (8 bytes) or none\n");

// Part 1: Show IV region and size breakdown for each tag
console.log("--- Tag layout analysis ---\n");
console.log("Tag".padEnd(14), "PayLen", "Cat".padEnd(8), "IV (12 bytes)".padEnd(38), "| CT len (MAC=0/4/8)");
console.log("-".repeat(95));

for (const t of bufs) {
    const iv = t.dataAfterHeader.slice(0, IV_LEN);
    const afterIV = t.payloadLen - 1 - IV_LEN; // -1 for format byte
    const ctMAC0 = afterIV;
    const ctMAC4 = afterIV - 4;
    const ctMAC8 = afterIV - 8;
    console.log(
        `${t.name.padEnd(14)} ${t.payloadLen.toString().padStart(3)}   ${t.cat.padEnd(8)} ${hexStr(iv)} | ${ctMAC0}/${ctMAC4}/${ctMAC8}`
    );
}

// Part 2: Check for shared IVs
console.log("\n--- IV uniqueness check ---\n");
const ivMap = {};
for (const t of bufs) {
    const ivHex = hexStr(t.dataAfterHeader.slice(0, IV_LEN));
    if (!ivMap[ivHex]) ivMap[ivHex] = [];
    ivMap[ivHex].push(t.name);
}
const shared = Object.entries(ivMap).filter(([, names]) => names.length > 1);
if (shared.length > 0) {
    console.log("SHARED IVs found (keystream reuse!):");
    for (const [iv, names] of shared) {
        console.log(`  ${iv}: ${names.join(", ")}`);
    }
} else {
    console.log("All 14 IVs are unique. ✓ (Consistent with per-tag IV)");
}

// Part 3: Check content sizes for consistency
console.log("\n--- Content size analysis (assuming MAC=8, Grain-128A default) ---\n");

const MAC_LEN = 8; // 64-bit MAC is Grain-128A default in ISO 29167-13
for (const t of bufs) {
    const contentLen = t.payloadLen - 1 - IV_LEN - MAC_LEN; // format(1) + IV(12) + MAC(8)
    const minContent = 7 + 3 + 12; // content_identity(7) + 1 resource_ref sub-record header(3) + resource_ref payload(~12)
    const refsEstimate = Math.floor((contentLen - 7 - 3) / (3 + 12)); // subtract identity, divide by ref size
    console.log(
        `${t.name.padEnd(14)} payload=${t.payloadLen.toString().padStart(3)} - fmt(1) - IV(12) - MAC(8) = ${contentLen.toString().padStart(3)} bytes content | ~${refsEstimate} resource refs`
    );
}

console.log("\n--- Content size analysis (assuming MAC=4) ---\n");

for (const t of bufs) {
    const contentLen = t.payloadLen - 1 - IV_LEN - 4;
    const refsEstimate = Math.floor((contentLen - 7 - 3) / (3 + 12));
    console.log(
        `${t.name.padEnd(14)} payload=${t.payloadLen.toString().padStart(3)} - fmt(1) - IV(12) - MAC(4) = ${contentLen.toString().padStart(3)} bytes content | ~${refsEstimate} resource refs`
    );
}

console.log("\n--- Content size analysis (assuming MAC=0, no authentication) ---\n");

for (const t of bufs) {
    const contentLen = t.payloadLen - 1 - IV_LEN;
    const refsEstimate = Math.floor((contentLen - 7 - 3) / (3 + 12));
    console.log(
        `${t.name.padEnd(14)} payload=${t.payloadLen.toString().padStart(3)} - fmt(1) - IV(12) - MAC(0) = ${contentLen.toString().padStart(3)} bytes content | ~${refsEstimate} resource refs`
    );
}

// Part 4: Check last N bytes of each tag for MAC patterns
console.log("\n--- Last 8 bytes of each tag (potential MAC region) ---\n");
for (const t of bufs) {
    // Get the actual data (non-zero) portion
    const raw = t.raw;
    // Find last non-zero byte
    let lastNonZero = raw.length - 1;
    while (lastNonZero > 0 && raw[lastNonZero] === 0) lastNonZero--;
    const dataEnd = lastNonZero + 1;
    const last8 = raw.slice(Math.max(HEADER_LEN, dataEnd - 8), dataEnd);
    console.log(`${t.name.padEnd(14)} ends at byte ${dataEnd}, last 8: ${hexStr(last8)}`);
}

// Part 5: Verify payload length matches actual data
console.log("\n--- Payload length verification ---\n");
for (const t of bufs) {
    const raw = t.raw;
    let lastNonZero = raw.length - 1;
    while (lastNonZero > 0 && raw[lastNonZero] === 0) lastNonZero--;
    const actualDataLen = lastNonZero + 1 - 4; // subtract 4-byte block 0 header
    const headerPayloadLen = t.payloadLen;
    const match = actualDataLen === headerPayloadLen;
    console.log(`${t.name.padEnd(14)} header says ${headerPayloadLen}, actual non-zero = ${actualDataLen} ${match ? "✓" : `✗ (diff=${actualDataLen - headerPayloadLen})`}`);
}
