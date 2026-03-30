/**
 * CCM Nonce Reuse Analysis
 *
 * If AES-128-CCM uses the same nonce for all tags, then the keystream is
 * identical and XORing two ciphertexts cancels it out:
 *   C1 ⊕ C2 = P1 ⊕ P2
 *
 * We know the decrypted plaintext starts with a TLV:
 *   - 2 bytes: type_id
 *   - 2 bytes: content_len
 *   - 4 bytes: magic (0xA7E24ED1 for identity, 0x0BBDA113 for item)
 *
 * Test: for two identity tags, bytes 4-7 of plaintext are identical,
 * so C1[4:7] ⊕ C2[4:7] should be 0x00000000.
 * For identity ⊕ item, it should be 0xA7E24ED1 ⊕ 0x0BBDA113 = 0xAC5FEFC2.
 */

// All 14 unique tag dumps — block data as hex strings (block 0 = cleartext header)
const tags = [
    {
        name: "Luke Skywalker",
        category: "identity",
        blocks: "009D010C 018684CC 84C02C26 17C7F22F 6AFBFC1A EAC143C3 7BF10EE8 E42D4153 428F5968 1FB10BDD 1583B5D7 FF427A4C 29EF2B2F F7505AD1 1161D849 E26514F3 12131F33 DDBBE194 1DB0E715 6A31BA42 C612BA1E 3F72824A B7F29EC3 C3C51747 02D37913 A505D049 529FC18B 25494946 CA0D0A8D 2F539BA2 B3502B7F F493DFA6 043B474E AE60D59B 43D5D838 88B26178 C1C6831F F2030E10 572C8595 29000000"
    },
    {
        name: "Darth Vader",
        category: "identity",
        blocks: "00A9010C 012A7206 94F4E526 64D6CAC9 21D99698 19C2F253 7B9A87CB D0489F30 602F818A 63DAE39F 714F6A7E 77E4332E 6209F8DE 49891DD7 2C57294D BAE3E9A0 885F4757 30800964 0DC59A51 88F9DD30 88A9E603 99A3ECE7 46873AB6 EE875373 FE2230F7 6CDA7A90 54AE2A2F 11555915 2E4BA369 E3012555 214FDB4F A5F0B795 90B888B6 08573CD2 6E29A81A E2E35EA0 30117DF4 4880E803 5313DF2D 46792FC3 76248CDE 9A6584C3 3F000000"
    },
    {
        name: "Emperor Palpatine",
        category: "identity",
        blocks: "00AB010C 010724FD 045CA7E3 FD2ABD4E 942E0769 6A35FCBB 9C5531EE 6946A54E 3A4C2584 764D27FA 53AFBDE7 DF9AA555 7BF2C46B 729FE6DB 80AC0BD8 A9964657 7D12B571 AE4AEFDA B9438236 79CFD21B 6EE87659 1CD90411 24FF3A0A 21C25A9D 737A027D 3CE4D4FF 32783132 A23B7BA5 74502612 ED415BC0 BA1C6C57 3CC5CBC7 E9ADDCC8 4F9DCFD5 FCCD0001 5AC47B82 ABD3EC99 355174B5 F550EFFD B04A018A 96534D21 1E746717 2E020300"
    },
    {
        name: "Leia",
        category: "identity",
        blocks: "009E010C 0148125F 4EB30B49 F376E96F A844DE7D DEC1FC45 92A2E9D7 9C46B8F1 A0FE430A EE8B31A2 6F6FA305 DD7821D6 BD331DC2 04212DEE 6998E3F8 1C6B8E9D E71DAED2 4B8ABC1F D1DC93B3 7C8B634B 69FDC4B0 FDBC5DE7 E22C98F2 97B28DEB 93587175 0E7E692B CEAA9343 5BE92C45 C368F2D3 E279C315 D582BCFE D855D137 687B7A4A D2B2E2F3 820F37C2 0212D358 AD53A16A 3E1B73D4 D96294E1 98950000"
    },
    {
        name: "R2-D2",
        category: "identity",
        blocks: "004A010C 0124B410 E7C0D07D 2DFDB513 F90D499A 3CB6454F FB90BF80 5918C185 68570FCE FE3DD860 47B1C905 2B16AEA1 7C4C16B4 AFAF9482 D59FA941 69C31FF0 F9EB1313 8613E241 F1710000"
    },
    {
        name: "Han Solo",
        category: "identity",
        blocks: "0071010C 016013A1 B661B946 BB7D02E4 31DD63F7 45E4C5A6 5A3BB5E4 D0365F4D 815D05B1 D2083EFB 0DAB2F32 E9A03B90 B4A371C8 6156E294 30AC1A80 355DB811 7F24CB9D C2D2FACC 194F4C1D E62A80D9 BA9E90BF D87120BF A183C698 AD9A2989 04688BCF 2C8C382C 20CA613B 0A8A9685 3E000000"
    },
    {
        name: "Chewbacca",
        category: "identity",
        blocks: "0074010C 01B19451 307E75A9 A9B48714 6A083172 49151321 6E43560F ABD91C42 E9AB53E4 CC279604 45B5FD14 8DDDA9D1 473AADF6 8EA879DB E896B15C 7EE4A9CC D8747580 52A3F417 19812082 98C0CCAA 5CC64F9E 08DB07EE 02253028 16AF68EA 38C1C759 23686EB0 BA42C454 1D751180 E35435E1"
    },
    {
        name: "C-3PO",
        category: "identity",
        blocks: "0076010C 0151346D FB4FAD66 D8D133EE 9C5BF0B4 F9EA5517 F1950589 F1D9205E BD82746D FF5EF7AC FA53E1E1 C7AF68BF C41DB821 F260FEE1 427B1369 D44A2A15 E1F72218 AB9C1852 23C3581C C2C07BE2 222D58A9 016ED90B 89BF4A87 58B4287D 8782542C 6935886B C981CEE2 7935D2D3 7931B9A2 8FB70000"
    },
    {
        name: "Lightsaber",
        category: "item",
        blocks: "007E010C 016DBCB0 506CDAED CFD2A462 5405A48D 5159FBCA 706F56FF C1D1FD22 BD52C871 1A0B5511 3E04812B 9CD2DDB0 0DC0D9F2 5BD51BBB D97A0A2A BA972F9E 8CB725DA 9D6B1082 3D2BEF36 DE8E7132 F8E2CF9F 25717886 EC48302C EE55A9D3 178093E1 517259F3 10EB6A8C 44B293C5 969FF19A 541FD387 58910DF4 01940000"
    },
    {
        name: "X-Wing",
        category: "item",
        blocks: "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800"
    },
    {
        name: "TIE Fighter",
        category: "item",
        blocks: "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800"
    },
    {
        name: "Millennium Falcon",
        category: "item",
        blocks: "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00"
    },
    {
        name: "Hyperdrive",
        category: "item",
        blocks: "006D010C 01391E39 1BF963C5 6034C4E8 8087456C 3BB3B1D1 7178BC51 201F0666 3D54CD4D 9639514E BDF6947D BAFD9248 16A66AE5 CEB5FB90 54FE3D6D 06B0850C 73790DB4 8DD1B176 E49F38F6 9510BA2F 6B99F4CC E1572E09 CEEF1099 47D20F56 A90705D8 6D2EE8B5 85D1CBA8 F7000000"
    },
    {
        name: "Fuel Cargo",
        category: "item",
        blocks: "0065010C 017E7CC6 1279C2FB 3ADBEF45 D4FDC4AE 1174BE25 A087B9F5 979CC046 3B6C4F4B EFAF1413 B980F514 1A2D695C 24931E85 9C8E9B8E 25BEE5FB 5020022E 7ADE25EC FF6CCC2B B70A314D ED49F1ED C8C98617 D2F1600F ED891C94 E805FB14 9815F2BB C2000000"
    }
];

// Parse hex blocks into byte buffers
function parseBlocks(blockStr) {
    const hex = blockStr.replace(/\s+/g, "");
    return Buffer.from(hex, "hex");
}

// XOR two buffers up to the shorter length
function xorBuffers(a, b) {
    const len = Math.min(a.length, b.length);
    const result = Buffer.alloc(len);
    for (let i = 0; i < len; i++) {
        result[i] = a[i] ^ b[i];
    }
    return result;
}

// Strip the 5-byte cleartext header (00 XX 01 0C 01) to get ciphertext
function getCiphertext(tag) {
    const raw = parseBlocks(tag.blocks);
    // Header: bytes 0-3 (block 0) + byte 4 (format byte 0x01)
    return raw.slice(5);
}

// Expected magic XOR values
const IDENTITY_MAGIC = 0xA7E24ED1;
const ITEM_MAGIC     = 0x0BBDA113;
const CROSS_XOR      = (IDENTITY_MAGIC ^ ITEM_MAGIC) >>> 0; // 0xAC5FEFC2

console.log("=== AES-128-CCM Nonce Reuse Analysis ===\n");
console.log(`Identity magic: 0x${IDENTITY_MAGIC.toString(16).toUpperCase()}`);
console.log(`Item magic:     0x${ITEM_MAGIC.toString(16).toUpperCase()}`);
console.log(`Cross XOR:      0x${CROSS_XOR.toString(16).toUpperCase()}\n`);

// Extract ciphertext for all tags
const ciphertexts = tags.map(t => ({
    name: t.name,
    category: t.category,
    ct: getCiphertext(t)
}));

console.log("--- Tag ciphertext lengths ---");
for (const t of ciphertexts) {
    console.log(`  ${t.name.padEnd(20)} [${t.category.padEnd(8)}] ${t.ct.length} bytes`);
}
console.log();

// Analyze all pairs
console.log("=== XOR Analysis at Magic Offset (bytes 4-7 of plaintext) ===\n");
console.log("If nonce is shared, same-type pairs should show 00000000 at bytes 4-7,");
console.log("and cross-type pairs should show AC5FEFC2.\n");

let sameTypeMatches = 0;
let sameTypePairs = 0;
let crossTypeMatches = 0;
let crossTypePairs = 0;

// Also test with different ciphertext start offsets (in case our header assumption is wrong)
const offsets = [
    { label: "offset 4 (skip block 0 only)", skip: 4 },
    { label: "offset 5 (skip block 0 + format byte)", skip: 5 },
    { label: "offset 6 (skip block 0 + 2 bytes)", skip: 6 },
];

for (const offsetConfig of offsets) {
    console.log(`\n--- Testing with ciphertext starting at ${offsetConfig.label} ---`);
    console.log(`    Magic at plaintext bytes 4-7 → ciphertext bytes ${4}-${7}\n`);

    let sameOK = 0, sameTot = 0, crossOK = 0, crossTot = 0;

    for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
            const raw_i = parseBlocks(tags[i].blocks).slice(offsetConfig.skip);
            const raw_j = parseBlocks(tags[j].blocks).slice(offsetConfig.skip);
            const xored = xorBuffers(raw_i, raw_j);

            if (xored.length < 8) continue;

            const xorMagicBytes = xored.slice(4, 8);
            const xorMagicVal = xorMagicBytes.readUInt32BE(0);

            const sameType = tags[i].category === tags[j].category;
            const expectedXor = sameType ? 0x00000000 : CROSS_XOR;
            const match = xorMagicVal === expectedXor;

            if (sameType) { sameTot++; if (match) sameOK++; }
            else { crossTot++; if (match) crossOK++; }

            // Show first 16 bytes of XOR for all pairs
            const xorHex = xored.slice(0, 16).toString("hex").match(/.{2}/g).join(" ");
            const marker = match ? "✓" : "✗";
            const pairType = sameType ?
                `${tags[i].category}⊕${tags[j].category}` :
                `${tags[i].category}⊕${tags[j].category}`;

            console.log(`  ${marker} ${tags[i].name.padEnd(18)} ⊕ ${tags[j].name.padEnd(18)} [${pairType.padEnd(17)}] XOR[0:16]: ${xorHex}  magic[4:7]=0x${xorMagicVal.toString(16).toUpperCase().padStart(8, "0")}`);
        }
    }

    console.log(`\n  Same-type  magic match: ${sameOK}/${sameTot}`);
    console.log(`  Cross-type magic match: ${crossOK}/${crossTot}`);
    console.log(`  Total match rate: ${sameOK + crossOK}/${sameTot + crossTot}`);
}

// Deep dive: if offset 5 looks promising, show full XOR patterns
console.log("\n\n=== Detailed XOR Analysis (offset 5) ===\n");
console.log("Looking for patterns in XOR of same-type pairs (should be structured if nonce reused):\n");

// Pick a few identity pairs and show full XOR
const identityTags = ciphertexts.filter(t => t.category === "identity");
const itemTags = ciphertexts.filter(t => t.category === "item");

console.log("--- Identity ⊕ Identity (first 3 pairs, first 32 bytes) ---\n");
for (let i = 0; i < Math.min(3, identityTags.length); i++) {
    for (let j = i + 1; j < Math.min(i + 2, identityTags.length); j++) {
        const xored = xorBuffers(identityTags[i].ct, identityTags[j].ct);
        const hexLines = [];
        for (let k = 0; k < Math.min(32, xored.length); k += 16) {
            const line = xored.slice(k, Math.min(k + 16, xored.length));
            hexLines.push(Array.from(line).map(b => b.toString(16).padStart(2, "0")).join(" "));
        }
        console.log(`  ${identityTags[i].name} ⊕ ${identityTags[j].name}:`);
        hexLines.forEach(l => console.log(`    ${l}`));
        console.log();
    }
}

console.log("--- Item ⊕ Item (first 3 pairs, first 32 bytes) ---\n");
for (let i = 0; i < Math.min(3, itemTags.length); i++) {
    for (let j = i + 1; j < Math.min(i + 2, itemTags.length); j++) {
        const xored = xorBuffers(itemTags[i].ct, itemTags[j].ct);
        const hexLines = [];
        for (let k = 0; k < Math.min(32, xored.length); k += 16) {
            const line = xored.slice(k, Math.min(k + 16, xored.length));
            hexLines.push(Array.from(line).map(b => b.toString(16).padStart(2, "0")).join(" "));
        }
        console.log(`  ${itemTags[i].name} ⊕ ${itemTags[j].name}:`);
        hexLines.forEach(l => console.log(`    ${l}`));
        console.log();
    }
}

// Entropy analysis of XOR results — if nonce is reused, XOR of same-type
// pairs should have low entropy in structured regions
console.log("--- Byte-position analysis across all same-type identity pairs ---\n");
console.log("For each byte position, count how many unique XOR values appear across all pairs.");
console.log("Low unique count = structured plaintext difference. High = random (different nonce per tag).\n");

const maxLen = Math.min(...identityTags.map(t => t.ct.length));
const positions = [];
for (let pos = 0; pos < Math.min(32, maxLen); pos++) {
    const xorValues = new Set();
    for (let i = 0; i < identityTags.length; i++) {
        for (let j = i + 1; j < identityTags.length; j++) {
            xorValues.add(identityTags[i].ct[pos] ^ identityTags[j].ct[pos]);
        }
    }
    positions.push({ pos, unique: xorValues.size, values: [...xorValues] });
    const valStr = [...xorValues].map(v => v.toString(16).padStart(2, "0")).join(",");
    console.log(`  byte ${pos.toString().padStart(2)}: ${xorValues.size.toString().padStart(2)} unique values  [${valStr}]`);
}

// Check byte 0-1 (type_id) — should all be 0x00 for same-type if nonce shared
console.log("\n--- Key test: bytes 0-1 of XOR (type_id field) ---");
console.log("If nonce shared + same category, type_id XOR should be 0x0000:\n");
let byte01AllZero = true;
for (let i = 0; i < identityTags.length; i++) {
    for (let j = i + 1; j < identityTags.length; j++) {
        const x0 = identityTags[i].ct[0] ^ identityTags[j].ct[0];
        const x1 = identityTags[i].ct[1] ^ identityTags[j].ct[1];
        const ok = (x0 === 0 && x1 === 0);
        if (!ok) byte01AllZero = false;
        console.log(`  ${identityTags[i].name.padEnd(18)} ⊕ ${identityTags[j].name.padEnd(18)}: ${x0.toString(16).padStart(2,"0")} ${x1.toString(16).padStart(2,"0")} ${ok ? "✓" : "✗"}`);
    }
}
console.log(`\n  All zeros: ${byte01AllZero ? "YES — consistent with shared nonce!" : "NO — nonce likely differs per tag"}`);
