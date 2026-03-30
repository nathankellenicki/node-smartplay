/**
 * Sweep all possible ciphertext start offsets.
 *
 * If the nonce is static and the keystream is shared, then at the TRUE
 * ciphertext boundary, XOR of same-type tags should show structure.
 *
 * Use the X-Wing / TIE Fighter / Millennium Falcon triplet (all 0x6B = 107 bytes,
 * all "item" category) — if keystream is shared, their XOR should show zeros
 * at positions where their plaintext is identical (e.g., TLV type_id, magic).
 *
 * Also check identity pairs at each offset.
 */

const sameLenItems = {
    "X-Wing":   "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800",
    "TIE":      "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800",
    "Falcon":   "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00",
};

const identityPair = {
    "Luke": "009D010C 018684CC 84C02C26 17C7F22F 6AFBFC1A EAC143C3 7BF10EE8 E42D4153 428F5968 1FB10BDD 1583B5D7 FF427A4C 29EF2B2F F7505AD1 1161D849 E26514F3 12131F33 DDBBE194 1DB0E715 6A31BA42 C612BA1E 3F72824A B7F29EC3 C3C51747 02D37913 A505D049 529FC18B 25494946 CA0D0A8D 2F539BA2 B3502B7F F493DFA6 043B474E AE60D59B 43D5D838 88B26178 C1C6831F F2030E10 572C8595 29000000",
    "Leia": "009E010C 0148125F 4EB30B49 F376E96F A844DE7D DEC1FC45 92A2E9D7 9C46B8F1 A0FE430A EE8B31A2 6F6FA305 DD7821D6 BD331DC2 04212DEE 6998E3F8 1C6B8E9D E71DAED2 4B8ABC1F D1DC93B3 7C8B634B 69FDC4B0 FDBC5DE7 E22C98F2 97B28DEB 93587175 0E7E692B CEAA9343 5BE92C45 C368F2D3 E279C315 D582BCFE D855D137 687B7A4A D2B2E2F3 820F37C2 0212D358 AD53A16A 3E1B73D4 D96294E1 98950000",
};

// Also add cross-type pair for the magic constant check
const crossPair = {
    "Luke":  identityPair["Luke"],
    "XWing": sameLenItems["X-Wing"],
};

function parse(hex) {
    return Buffer.from(hex.replace(/\s+/g, ""), "hex");
}

function xor(a, b) {
    const len = Math.min(a.length, b.length);
    const r = Buffer.alloc(len);
    for (let i = 0; i < len; i++) r[i] = a[i] ^ b[i];
    return r;
}

const IDENTITY_MAGIC = Buffer.from("A7E24ED1", "hex");
const ITEM_MAGIC     = Buffer.from("0BBDA113", "hex");
const CROSS_XOR      = Buffer.alloc(4);
for (let i = 0; i < 4; i++) CROSS_XOR[i] = IDENTITY_MAGIC[i] ^ ITEM_MAGIC[i];

console.log("=== Ciphertext Start Offset Sweep ===\n");
console.log("For each offset, check if the XOR shows structure consistent with shared keystream.\n");
console.log("Looking for:");
console.log("  - Same-type pairs: bytes 0-1 = 0000 (type_id), bytes 4-7 = 00000000 (magic)");
console.log("  - Cross-type pairs: bytes 4-7 = AC5FEFC2 (identity⊕item magic)\n");

const itemBufs = Object.entries(sameLenItems).map(([n, h]) => ({ name: n, buf: parse(h) }));
const idBufs = Object.entries(identityPair).map(([n, h]) => ({ name: n, buf: parse(h) }));
const crossBufs = Object.entries(crossPair).map(([n, h]) => ({ name: n, buf: parse(h) }));

// Sweep offsets 4 through 40
for (let offset = 4; offset <= 40; offset++) {
    const results = [];

    // Item triplet (same type, same length)
    for (let i = 0; i < itemBufs.length; i++) {
        for (let j = i + 1; j < itemBufs.length; j++) {
            const x = xor(itemBufs[i].buf.slice(offset), itemBufs[j].buf.slice(offset));
            if (x.length < 8) continue;
            const b01 = (x[0] === 0 && x[1] === 0);
            const b47 = x.slice(4, 8).equals(Buffer.alloc(4));
            if (b01 || b47) {
                results.push(`  ITEM ${itemBufs[i].name}⊕${itemBufs[j].name}: b[0:1]=${x[0].toString(16).padStart(2,"0")}${x[1].toString(16).padStart(2,"0")}${b01?" ✓":""} b[4:7]=${x.slice(4,8).toString("hex")}${b47?" ✓":""}`);
            }
        }
    }

    // Identity pair (same type, different length)
    {
        const x = xor(idBufs[0].buf.slice(offset), idBufs[1].buf.slice(offset));
        if (x.length >= 8) {
            const b01 = (x[0] === 0 && x[1] === 0);
            const b47 = x.slice(4, 8).equals(Buffer.alloc(4));
            if (b01 || b47) {
                results.push(`  ID   ${idBufs[0].name}⊕${idBufs[1].name}: b[0:1]=${x[0].toString(16).padStart(2,"0")}${x[1].toString(16).padStart(2,"0")}${b01?" ✓":""} b[4:7]=${x.slice(4,8).toString("hex")}${b47?" ✓":""}`);
            }
        }
    }

    // Cross-type pair
    {
        const x = xor(crossBufs[0].buf.slice(offset), crossBufs[1].buf.slice(offset));
        if (x.length >= 8) {
            const b47match = x.slice(4, 8).equals(CROSS_XOR);
            const b01 = (x[0] === 0 && x[1] === 0);
            if (b47match || b01) {
                results.push(`  CROSS ${crossBufs[0].name}⊕${crossBufs[1].name}: b[0:1]=${x[0].toString(16).padStart(2,"0")}${x[1].toString(16).padStart(2,"0")}${b01?" ✓":""} b[4:7]=${x.slice(4,8).toString("hex")}${b47match?" ✓ MAGIC":""}`);
            }
        }
    }

    if (results.length > 0) {
        console.log(`offset ${offset}:`);
        results.forEach(r => console.log(r));
    }
}

// Also do a brute-force search: for each offset, count zero bytes in first 16
// bytes of XOR across all item pairs. High zero count = possible shared keystream.
console.log("\n\n=== Zero-byte density in first 16 XOR bytes per offset ===\n");
console.log("offset | item_zeros (3 pairs, 48 bytes) | id_zeros (1 pair, 16 bytes)");
console.log("-------+--------------------------------+---------------------------");

for (let offset = 4; offset <= 60; offset++) {
    let itemZeros = 0, itemTotal = 0;
    for (let i = 0; i < itemBufs.length; i++) {
        for (let j = i + 1; j < itemBufs.length; j++) {
            const x = xor(itemBufs[i].buf.slice(offset), itemBufs[j].buf.slice(offset));
            const check = Math.min(16, x.length);
            for (let k = 0; k < check; k++) {
                if (x[k] === 0) itemZeros++;
                itemTotal++;
            }
        }
    }

    let idZeros = 0, idTotal = 0;
    const x = xor(idBufs[0].buf.slice(offset), idBufs[1].buf.slice(offset));
    const check = Math.min(16, x.length);
    for (let k = 0; k < check; k++) {
        if (x[k] === 0) idZeros++;
        idTotal++;
    }

    const itemPct = ((itemZeros / itemTotal) * 100).toFixed(1);
    const idPct = ((idZeros / idTotal) * 100).toFixed(1);
    const marker = (itemZeros > 6 || idZeros > 3) ? " <<<" : "";
    console.log(`  ${offset.toString().padStart(3)} | ${itemZeros.toString().padStart(2)}/${itemTotal} (${itemPct.padStart(5)}%) | ${idZeros.toString().padStart(2)}/${idTotal} (${idPct.padStart(5)}%)${marker}`);
}
