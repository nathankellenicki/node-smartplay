/**
 * Same-Length Tag Analysis
 *
 * If the nonce is derived from the length byte (the only varying cleartext field),
 * then tags with IDENTICAL lengths should share a keystream.
 *
 * Same-length groups:
 *   0x6B (107 bytes): X-Wing, TIE Fighter, Millennium Falcon (all items)
 *   0xA9/0xAB: Vader (169), Palpatine (171) — close but different
 *   0x9D (157): Luke (identity)
 *   0x9E (158): Leia (identity)
 *
 * If X-Wing ⊕ TIE Fighter ⊕ Falcon shows structure, the length IS the nonce differentiator.
 */

const tags = {
    "X-Wing": {
        category: "item",
        blocks: "006B010C 0124D43E 829F371F 47AB8F36 36426371 D554F2B8 F4C5B5AF E910BF00 83332F74 F7CA47EF 1AB07986 414ECECA BD34F8DA A679C647 35BD1031 3C37F8DC DB4AD113 BCA30418 026CADEB 41C971CC AEC1CDDC 92798E13 259706A2 3D39E9D6 F41E339B B2B9AF46 C222E800"
    },
    "TIE Fighter": {
        category: "item",
        blocks: "006B010C 0199F493 7676DC5C CCC02D6B FABA0AF0 361974FD 2CAD33A8 402F1904 E4F47556 56AAE2FF A619B64E 2807A1D2 AC8A4386 5055E58C C55348C6 F48CD773 842CBF3C 935CDE60 9B3DA1DB 6810236D CCF0C435 1BB0BC6F 0D4BB4E3 EA818420 B1EDC6C7 2A47C61D 3A3EB800"
    },
    "Millennium Falcon": {
        category: "item",
        blocks: "006B010C 01053B22 03D9E832 4F7C45FD D0F4CDC0 B6F5A0EB BA542C9C 06764627 9AAC64D6 40B7E9C6 A1BB9BA5 C5677AC9 B314D6FB EBBB397A 24A0DB19 4DAFF80C 1E1A1097 518E7AED D42F7875 19C3AEF0 23ADE6D9 403F9494 C8EC06FF D4FF6593 B159AB57 4331D762 7A08EF00"
    }
};

function parseBlocks(blockStr) {
    return Buffer.from(blockStr.replace(/\s+/g, ""), "hex");
}

function xorBuffers(a, b) {
    const len = Math.min(a.length, b.length);
    const result = Buffer.alloc(len);
    for (let i = 0; i < len; i++) result[i] = a[i] ^ b[i];
    return result;
}

function hexDump(buf, bytesPerLine = 16) {
    const lines = [];
    for (let i = 0; i < buf.length; i += bytesPerLine) {
        const slice = buf.slice(i, Math.min(i + bytesPerLine, buf.length));
        const hex = Array.from(slice).map(b => b.toString(16).padStart(2, "0")).join(" ");
        lines.push(`  ${i.toString(16).padStart(4, "0")}: ${hex}`);
    }
    return lines.join("\n");
}

function entropy(buf) {
    const freq = new Array(256).fill(0);
    for (const b of buf) freq[b]++;
    let h = 0;
    for (const f of freq) {
        if (f === 0) continue;
        const p = f / buf.length;
        h -= p * Math.log2(p);
    }
    return h;
}

const names = Object.keys(tags);

// Test all offsets 4, 5, 6 for ciphertext start
for (const skip of [4, 5, 6]) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`CIPHERTEXT OFFSET: ${skip} (skip ${skip} header bytes)`);
    console.log(`${"=".repeat(70)}\n`);

    const cts = {};
    for (const name of names) {
        cts[name] = parseBlocks(tags[name].blocks).slice(skip);
    }

    // XOR all 3 pairs
    for (let i = 0; i < names.length; i++) {
        for (let j = i + 1; j < names.length; j++) {
            const xored = xorBuffers(cts[names[i]], cts[names[j]]);
            const ent = entropy(xored);
            const zeroCount = Array.from(xored).filter(b => b === 0).length;

            console.log(`--- ${names[i]} ⊕ ${names[j]} ---`);
            console.log(`  Length: ${xored.length} bytes`);
            console.log(`  Entropy: ${ent.toFixed(3)} bits/byte (random = ~7.0+)`);
            console.log(`  Zero bytes: ${zeroCount}/${xored.length}`);
            console.log(`  First 64 bytes:`);
            console.log(hexDump(xored.slice(0, 64)));

            // Check if bytes 0-1 (type_id) are zero — same type, same nonce → should be 0000
            const b0 = xored[0], b1 = xored[1];
            console.log(`  Bytes 0-1 (type_id XOR): ${b0.toString(16).padStart(2,"0")} ${b1.toString(16).padStart(2,"0")} ${(b0 === 0 && b1 === 0) ? "✓ MATCH" : "✗"}`);

            // Check bytes 4-7 (magic XOR) — same type → should be 00000000
            if (xored.length >= 8) {
                const m = xored.readUInt32BE(4);
                console.log(`  Bytes 4-7 (magic XOR):  ${m.toString(16).padStart(8,"0")} ${m === 0 ? "✓ MATCH" : "✗"}`);
            }

            // Look for any long runs of zeros (indicating shared keystream + shared plaintext)
            let maxRun = 0, curRun = 0, runStart = 0, maxRunStart = 0;
            for (let k = 0; k < xored.length; k++) {
                if (xored[k] === 0) {
                    if (curRun === 0) runStart = k;
                    curRun++;
                    if (curRun > maxRun) { maxRun = curRun; maxRunStart = runStart; }
                } else {
                    curRun = 0;
                }
            }
            console.log(`  Longest zero run: ${maxRun} bytes at offset 0x${maxRunStart.toString(16)}`);
            console.log();
        }
    }

    // Triple XOR: if all three share a keystream, look for byte positions where
    // all three pairwise XORs have low combined entropy
    console.log("--- Per-byte consistency check ---");
    console.log("Positions where ALL 3 pairwise XORs agree on structure:\n");

    const ct = names.map(n => cts[n]);
    const minLen = Math.min(...ct.map(c => c.length));

    let structuredPositions = 0;
    for (let pos = 0; pos < Math.min(64, minLen); pos++) {
        const xor01 = ct[0][pos] ^ ct[1][pos];
        const xor02 = ct[0][pos] ^ ct[2][pos];
        const xor12 = ct[1][pos] ^ ct[2][pos];

        // Consistency check: xor01 ^ xor02 should equal xor12 (always true for XOR)
        // More useful: are any of these zero? (same plaintext byte)
        const anyZero = (xor01 === 0 || xor02 === 0 || xor12 === 0);
        const allZero = (xor01 === 0 && xor02 === 0 && xor12 === 0);

        if (anyZero) {
            structuredPositions++;
            const matches = [];
            if (xor01 === 0) matches.push(`${names[0]}==${names[1]}`);
            if (xor02 === 0) matches.push(`${names[0]}==${names[2]}`);
            if (xor12 === 0) matches.push(`${names[1]}==${names[2]}`);
            console.log(`  byte ${pos.toString().padStart(2)}: ${allZero ? "ALL EQUAL" : matches.join(", ")}  [${xor01.toString(16).padStart(2,"0")} ${xor02.toString(16).padStart(2,"0")} ${xor12.toString(16).padStart(2,"0")}]`);
        }
    }

    if (structuredPositions === 0) {
        console.log("  No matching bytes found in first 64 positions — no shared keystream detected.");
    }
    console.log(`\n  Structured positions: ${structuredPositions}/64`);
}
