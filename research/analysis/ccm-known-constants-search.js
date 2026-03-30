/**
 * Search for known plaintext constants at every possible ciphertext offset.
 *
 * Known constants in the decrypted tag data:
 *
 * 1. type_byte: 0x03 (identity) or 0x06 (item)
 *    - Same-type XOR = 0x00
 *    - Cross-type XOR = 0x05
 *
 * 2. TLV type_id for content identity record: 0x22, 0x00 (LE)
 *    - All tags should have this → same-type XOR bytes = 0x00, 0x00
 *
 * 3. TLV type_id for resource refs: 0x04, 0x00 (identity) or 0x06, 0x00 (item)
 *    - Same-type XOR = 0x00, 0x00
 *    - Cross-type XOR: byte0 = 0x04 ^ 0x06 = 0x02, byte1 = 0x00
 *
 * 4. Resource ref tag_byte: 0x12 (all tags)
 *    - All pairs XOR = 0x00
 *
 * 5. Resource ref sub_type: 0x08, 0x00 (all tags)
 *    - All pairs XOR = 0x00, 0x00
 *
 * 6. Content identity length in type 0x22 TLV: 0x07, 0x00 (LE, 7 bytes)
 *    - All pairs XOR = 0x00, 0x00
 *
 * For each byte position in ciphertext, test ALL constraints simultaneously.
 */

const allTags = [
    { name: "Luke",      cat: "identity", hex: "009D010C 018684CC 84C02C26 17C7F22F 6AFBFC1A EAC143C3 7BF10EE8 E42D4153 428F5968 1FB10BDD 1583B5D7 FF427A4C 29EF2B2F F7505AD1 1161D849 E26514F3 12131F33 DDBBE194 1DB0E715 6A31BA42 C612BA1E 3F72824A B7F29EC3 C3C51747 02D37913 A505D049 529FC18B 25494946 CA0D0A8D 2F539BA2 B3502B7F F493DFA6 043B474E AE60D59B 43D5D838 88B26178 C1C6831F F2030E10 572C8595 29000000" },
    { name: "Vader",     cat: "identity", hex: "00A9010C 012A7206 94F4E526 64D6CAC9 21D99698 19C2F253 7B9A87CB D0489F30 602F818A 63DAE39F 714F6A7E 77E4332E 6209F8DE 49891DD7 2C57294D BAE3E9A0 885F4757 30800964 0DC59A51 88F9DD30 88A9E603 99A3ECE7 46873AB6 EE875373 FE2230F7 6CDA7A90 54AE2A2F 11555915 2E4BA369 E3012555 214FDB4F A5F0B795 90B888B6 08573CD2 6E29A81A E2E35EA0 30117DF4 4880E803 5313DF2D 46792FC3 76248CDE 9A6584C3 3F000000" },
    { name: "Palpatine", cat: "identity", hex: "00AB010C 010724FD 045CA7E3 FD2ABD4E 942E0769 6A35FCBB 9C5531EE 6946A54E 3A4C2584 764D27FA 53AFBDE7 DF9AA555 7BF2C46B 729FE6DB 80AC0BD8 A9964657 7D12B571 AE4AEFDA B9438236 79CFD21B 6EE87659 1CD90411 24FF3A0A 21C25A9D 737A027D 3CE4D4FF 32783132 A23B7BA5 74502612 ED415BC0 BA1C6C57 3CC5CBC7 E9ADDCC8 4F9DCFD5 FCCD0001 5AC47B82 ABD3EC99 355174B5 F550EFFD B04A018A 96534D21 1E746717 2E020300" },
    { name: "Leia",      cat: "identity", hex: "009E010C 0148125F 4EB30B49 F376E96F A844DE7D DEC1FC45 92A2E9D7 9C46B8F1 A0FE430A EE8B31A2 6F6FA305 DD7821D6 BD331DC2 04212DEE 6998E3F8 1C6B8E9D E71DAED2 4B8ABC1F D1DC93B3 7C8B634B 69FDC4B0 FDBC5DE7 E22C98F2 97B28DEB 93587175 0E7E692B CEAA9343 5BE92C45 C368F2D3 E279C315 D582BCFE D855D137 687B7A4A D2B2E2F3 820F37C2 0212D358 AD53A16A 3E1B73D4 D96294E1 98950000" },
    { name: "R2D2",      cat: "identity", hex: "004A010C 0124B410 E7C0D07D 2DFDB513 F90D499A 3CB6454F FB90BF80 5918C185 68570FCE FE3DD860 47B1C905 2B16AEA1 7C4C16B4 AFAF9482 D59FA941 69C31FF0 F9EB1313 8613E241 F1710000" },
    { name: "Han",       cat: "identity", hex: "0071010C 016013A1 B661B946 BB7D02E4 31DD63F7 45E4C5A6 5A3BB5E4 D0365F4D 815D05B1 D2083EFB 0DAB2F32 E9A03B90 B4A371C8 6156E294 30AC1A80 355DB811 7F24CB9D C2D2FACC 194F4C1D E62A80D9 BA9E90BF D87120BF A183C698 AD9A2989 04688BCF 2C8C382C 20CA613B 0A8A9685 3E000000" },
    { name: "Chewie",    cat: "identity", hex: "0074010C 01B19451 307E75A9 A9B48714 6A083172 49151321 6E43560F ABD91C42 E9AB53E4 CC279604 45B5FD14 8DDDA9D1 473AADF6 8EA879DB E896B15C 7EE4A9CC D8747580 52A3F417 19812082 98C0CCAA 5CC64F9E 08DB07EE 02253028 16AF68EA 38C1C759 23686EB0 BA42C454 1D751180 E35435E1" },
    { name: "C3PO",      cat: "identity", hex: "0076010C 0151346D FB4FAD66 D8D133EE 9C5BF0B4 F9EA5517 F1950589 F1D9205E BD82746D FF5EF7AC FA53E1E1 C7AF68BF C41DB821 F260FEE1 427B1369 D44A2A15 E1F72218 AB9C1852 23C3581C C2C07BE2 222D58A9 016ED90B 89BF4A87 58B4287D 8782542C 6935886B C981CEE2 7935D2D3 7931B9A2 8FB70000" },
    { name: "Saber",     cat: "item",     hex: "007E010C 016DBCB0 506CDAED CFD2A462 5405A48D 5159FBCA 706F56FF C1D1FD22 BD52C871 1A0B5511 3E04812B 9CD2DDB0 0DC0D9F2 5BD51BBB D97A0A2A BA972F9E 8CB725DA 9D6B1082 3D2BEF36 DE8E7132 F8E2CF9F 25717886 EC48302C EE55A9D3 178093E1 517259F3 10EB6A8C 44B293C5 969FF19A 541FD387 58910DF4 01940000" },
    { name: "XWing",     cat: "item",     hex: "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800" },
    { name: "TIE",       cat: "item",     hex: "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800" },
    { name: "Falcon",    cat: "item",     hex: "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00" },
    { name: "Hyper",     cat: "item",     hex: "006D010C 01391E39 1BF963C5 6034C4E8 8087456C 3BB3B1D1 7178BC51 201F0666 3D54CD4D 9639514E BDF6947D BAFD9248 16A66AE5 CEB5FB90 54FE3D6D 06B0850C 73790DB4 8DD1B176 E49F38F6 9510BA2F 6B99F4CC E1572E09 CEEF1099 47D20F56 A90705D8 6D2EE8B5 85D1CBA8 F7000000" },
    { name: "Fuel",      cat: "item",     hex: "0065010C 017E7CC6 1279C2FB 3ADBEF45 D4FDC4AE 1174BE25 A087B9F5 979CC046 3B6C4F4B EFAF1413 B980F514 1A2D695C 24931E85 9C8E9B8E 25BEE5FB 5020022E 7ADE25EC FF6CCC2B B70A314D ED49F1ED C8C98617 D2F1600F ED891C94 E805FB14 9815F2BB C2000000" },
];

function parse(hex) { return Buffer.from(hex.replace(/\s+/g, ""), "hex"); }

const bufs = allTags.map(t => ({ ...t, buf: parse(t.hex) }));
const identities = bufs.filter(t => t.cat === "identity");
const items = bufs.filter(t => t.cat === "item");

const minLen = Math.min(...bufs.map(t => t.buf.length));

// Build all pair types
const idPairs = [];
for (let i = 0; i < identities.length; i++)
    for (let j = i + 1; j < identities.length; j++)
        idPairs.push([identities[i], identities[j]]);

const itemPairs = [];
for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
        itemPairs.push([items[i], items[j]]);

const crossPairs = [];
for (const id of identities)
    for (const it of items)
        crossPairs.push([id, it]);

console.log("=== Known Constants Search ===\n");
console.log(`Identity tags: ${identities.length}, Item tags: ${items.length}`);
console.log(`ID pairs: ${idPairs.length}, Item pairs: ${itemPairs.length}, Cross pairs: ${crossPairs.length}\n`);

// TEST 1: type_byte signature (0x03 vs 0x06)
// At the type_byte position:
//   identity XOR identity = 0x00
//   item XOR item = 0x00
//   identity XOR item = 0x05
console.log("=== Test 1: type_byte (0x03/0x06) signature ===\n");
console.log("Looking for position where ALL same-type XOR=0x00 AND ALL cross-type XOR=0x05\n");

for (let pos = 4; pos < minLen; pos++) {
    let idAllZero = true;
    for (const [a, b] of idPairs) {
        if ((a.buf[pos] ^ b.buf[pos]) !== 0x00) { idAllZero = false; break; }
    }
    let itemAllZero = true;
    for (const [a, b] of itemPairs) {
        if ((a.buf[pos] ^ b.buf[pos]) !== 0x00) { itemAllZero = false; break; }
    }
    let crossAll05 = true;
    for (const [a, b] of crossPairs) {
        if ((a.buf[pos] ^ b.buf[pos]) !== 0x05) { crossAll05 = false; break; }
    }

    if (idAllZero && itemAllZero && crossAll05) {
        console.log(`  *** MATCH at byte ${pos} *** — ALL constraints satisfied!`);
        console.log(`      Identity values: ${identities.map(t => '0x' + t.buf[pos].toString(16).padStart(2,'0')).join(', ')}`);
        console.log(`      Item values:     ${items.map(t => '0x' + t.buf[pos].toString(16).padStart(2,'0')).join(', ')}`);
    }

    // Also check partial matches
    if ((idAllZero && itemAllZero) || crossAll05) {
        const which = [];
        if (idAllZero) which.push("id=0");
        if (itemAllZero) which.push("item=0");
        if (crossAll05) which.push("cross=05");
        if (which.length >= 2) {
            console.log(`  Partial at byte ${pos}: ${which.join(', ')}`);
        }
    }
}

// TEST 2: TLV type_id for type 0x22 content identity record
// Two consecutive bytes: 0x22, 0x00 at same position in all tags
// XOR of any pair at these 2 bytes = 0x00, 0x00
console.log("\n=== Test 2: type 0x22 TLV header (22 00) ===\n");
console.log("Looking for 2 consecutive bytes where ALL pairs XOR to 00 00\n");

for (let pos = 4; pos < minLen - 1; pos++) {
    let allMatch = true;
    for (let i = 0; i < bufs.length && allMatch; i++) {
        for (let j = i + 1; j < bufs.length && allMatch; j++) {
            const minl = Math.min(bufs[i].buf.length, bufs[j].buf.length);
            if (pos + 1 >= minl) { allMatch = false; break; }
            if ((bufs[i].buf[pos] ^ bufs[j].buf[pos]) !== 0 ||
                (bufs[i].buf[pos+1] ^ bufs[j].buf[pos+1]) !== 0) {
                allMatch = false;
            }
        }
    }
    if (allMatch) {
        const vals = bufs.map(t => t.buf[pos].toString(16).padStart(2,'0') + t.buf[pos+1].toString(16).padStart(2,'0'));
        console.log(`  *** MATCH at bytes ${pos}-${pos+1}: all tags have ${vals[0]} ***`);
    }
}

// TEST 3: Resource ref constants — tag_byte 0x12 + sub_type 0x08 0x00
// Pattern: [0x12][??][0x08][0x00] at some offset
// For ALL pairs, XOR at tag_byte position = 0x00, and XOR at sub_type = 0x00, 0x00
console.log("\n=== Test 3: Resource ref pattern [12 ?? 08 00] ===\n");
console.log("Looking for positions where byte[pos] XOR=00 for all pairs (potential 0x12),");
console.log("AND byte[pos+2..pos+3] XOR=00,00 for all pairs (potential 0x08 0x00)\n");

for (let pos = 4; pos < minLen - 3; pos++) {
    let pos0ok = true, pos2ok = true, pos3ok = true;
    for (let i = 0; i < bufs.length && (pos0ok || pos2ok); i++) {
        for (let j = i + 1; j < bufs.length; j++) {
            const ml = Math.min(bufs[i].buf.length, bufs[j].buf.length);
            if (pos + 3 >= ml) { pos0ok = false; pos2ok = false; break; }
            if ((bufs[i].buf[pos] ^ bufs[j].buf[pos]) !== 0) pos0ok = false;
            if ((bufs[i].buf[pos+2] ^ bufs[j].buf[pos+2]) !== 0) pos2ok = false;
            if ((bufs[i].buf[pos+3] ^ bufs[j].buf[pos+3]) !== 0) pos3ok = false;
        }
    }
    if (pos0ok && pos2ok && pos3ok) {
        console.log(`  *** MATCH at bytes ${pos}, ${pos+2}-${pos+3} ***`);
        console.log(`      byte[${pos}]: ${bufs[0].buf[pos].toString(16).padStart(2,'0')} (tag_byte)`);
        console.log(`      byte[${pos+2}]-[${pos+3}]: ${bufs[0].buf[pos+2].toString(16).padStart(2,'0')} ${bufs[0].buf[pos+3].toString(16).padStart(2,'0')} (sub_type)`);
    }
}

// TEST 4: content_length field for type 0x22 = 0x07 0x00
// 2 consecutive bytes, ALL pairs XOR = 0x00, 0x00
// (This is the same as Test 2 but looking for different values)
// Already covered by Test 2

// TEST 5: Weaker test — for each position, what fraction of SAME-TYPE pairs have XOR=0?
// AND what fraction of CROSS-TYPE pairs have XOR=0x05?
// Show positions with above-chance rates for BOTH
console.log("\n=== Test 5: Soft type_byte search (best partial matches) ===\n");

const results = [];
for (let pos = 4; pos < minLen; pos++) {
    let idZeros = 0;
    for (const [a, b] of idPairs) if ((a.buf[pos] ^ b.buf[pos]) === 0) idZeros++;
    let itemZeros = 0;
    for (const [a, b] of itemPairs) if ((a.buf[pos] ^ b.buf[pos]) === 0) itemZeros++;
    let cross05 = 0;
    for (const [a, b] of crossPairs) if ((a.buf[pos] ^ b.buf[pos]) === 0x05) cross05++;

    const sameZeroRate = (idZeros + itemZeros) / (idPairs.length + itemPairs.length);
    const crossRate = cross05 / crossPairs.length;
    const score = sameZeroRate + crossRate;

    results.push({ pos, idZeros, itemZeros, cross05, score });
}

results.sort((a, b) => b.score - a.score);
console.log("Top 20 positions by combined score (same-type zero rate + cross-type 0x05 rate):\n");
console.log("pos | id_zero | item_zero | cross_05 | score");
console.log("----+---------+-----------+----------+------");
for (const r of results.slice(0, 20)) {
    console.log(`  ${r.pos.toString().padStart(2)} | ${r.idZeros.toString().padStart(2)}/${idPairs.length.toString().padStart(2)} | ${r.itemZeros.toString().padStart(3)}/${itemPairs.length.toString().padStart(2)} | ${r.cross05.toString().padStart(3)}/${crossPairs.length.toString().padStart(2)} | ${r.score.toFixed(3)}`);
}

// TEST 6: Look for ANY byte value that's constant across all identity tags
// (not just zero XOR — check if all 8 identity tags have the SAME byte at position X)
console.log("\n=== Test 6: Byte positions constant within category ===\n");

for (let pos = 4; pos < minLen; pos++) {
    const idVals = new Set(identities.map(t => t.buf[pos]));
    const itemVals = new Set(items.map(t => t.buf[pos]));

    if (idVals.size === 1 && itemVals.size === 1) {
        const idVal = [...idVals][0];
        const itemVal = [...itemVals][0];
        console.log(`  pos ${pos}: ALL identity=0x${idVal.toString(16).padStart(2,'0')}, ALL item=0x${itemVal.toString(16).padStart(2,'0')} ${idVal === itemVal ? '(same)' : `(diff=${(idVal^itemVal).toString(16)})`} <<<`);
    } else if (idVals.size === 1) {
        console.log(`  pos ${pos}: ALL identity=0x${[...idVals][0].toString(16).padStart(2,'0')}, items vary`);
    } else if (itemVals.size === 1) {
        console.log(`  pos ${pos}: identity varies, ALL item=0x${[...itemVals][0].toString(16).padStart(2,'0')}`);
    }
}
