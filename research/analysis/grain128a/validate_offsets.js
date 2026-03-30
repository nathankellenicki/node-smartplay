/**
 * Validate Plaintext Structure Offsets
 *
 * The plaintext (after IV, before MAC) should be:
 *   [content_identity: F bytes] + [N × resource_ref: R bytes each]
 *
 * For each combination of (IV_len, MAC_len, identity_size, ref_size),
 * check if ALL 14 tags produce integer N (whole number of resource refs).
 *
 * This is a structural test that doesn't require the key.
 *
 * Note: payload_len in the header INCLUDES the 4-byte block 0 header.
 * So actual encrypted data starts at byte 5 and has length = payload_len - 5.
 * Then: encrypted_data = [IV: iv_len] + [ciphertext: ct_len] + [MAC: mac_len]
 * And: plaintext = [identity: F] + [refs: N×R]
 * Where: ct_len = payload_len - 5 - iv_len - mac_len
 * And: ct_len = F + N×R (ciphertext = encrypted plaintext, same length for stream cipher)
 */

// All 14 tags with header payload lengths
// Note: payload_len is byte 1 of header, which is TOTAL tag data size including 4-byte header
// BUT: we need to check this assumption. Let's test both interpretations.
const tags = [
    { name: "R2-D2",       cat: "identity", payloadLen: 0x4A }, // 74
    { name: "Fuel Cargo",   cat: "item",     payloadLen: 0x65 }, // 101
    { name: "X-Wing",       cat: "item",     payloadLen: 0x6B }, // 107
    { name: "TIE Fighter",  cat: "item",     payloadLen: 0x6B }, // 107
    { name: "Falcon",       cat: "item",     payloadLen: 0x6B }, // 107
    { name: "Hyperdrive",   cat: "item",     payloadLen: 0x6D }, // 109
    { name: "Han Solo",     cat: "identity", payloadLen: 0x71 }, // 113
    { name: "Chewbacca",    cat: "identity", payloadLen: 0x74 }, // 116
    { name: "C-3PO",        cat: "identity", payloadLen: 0x76 }, // 118
    { name: "Lightsaber",   cat: "item",     payloadLen: 0x7E }, // 126
    { name: "Luke",         cat: "identity", payloadLen: 0x9D }, // 157
    { name: "Leia",         cat: "identity", payloadLen: 0x9E }, // 158
    { name: "Vader",        cat: "identity", payloadLen: 0xA9 }, // 169
    { name: "Palpatine",    cat: "identity", payloadLen: 0xAB }, // 171
];

// Header interpretation options:
// A) payloadLen counts from byte 0 (total size including 4-byte header)
//    → encrypted data length = payloadLen - 5 (subtract header + format byte)
// B) payloadLen counts from byte 2 (after 00 LEN, i.e. the 01 0C 01 + encrypted)
//    → encrypted data length = payloadLen - 3
// C) payloadLen counts from byte 4 (just the format byte + encrypted data)
//    → encrypted data length = payloadLen - 1

const headerInterpretations = [
    { name: "LEN = total size (from byte 0)",     encLen: (pl) => pl - 5 },
    { name: "LEN = from byte 1 onward",           encLen: (pl) => pl - 4 },
    { name: "LEN = from byte 2 onward (01 0C...)", encLen: (pl) => pl - 3 },
    { name: "LEN = from byte 4 onward (01 + enc)", encLen: (pl) => pl - 1 },
    { name: "LEN = encrypted data only",           encLen: (pl) => pl },
];

// Parameters to sweep
const ivLens = [0, 7, 8, 12, 13, 16];
const macLens = [0, 2, 4, 8, 16];
// Identity record sizes to try (Layer 1 vs Layer 2 formats)
const identitySizes = [7, 10, 11, 14, 15, 16];
// Resource ref record sizes to try
const refSizes = [8, 10, 12, 14, 15, 16, 18, 20, 22, 24];

console.log("=== Structure Validation: Size Consistency Test ===\n");
console.log(`Testing ${tags.length} tags × ${headerInterpretations.length} header interpretations`);
console.log(`× ${ivLens.length} IV lengths × ${macLens.length} MAC lengths`);
console.log(`× ${identitySizes.length} identity sizes × ${refSizes.length} ref sizes\n`);

const results = [];

for (const hi of headerInterpretations) {
    for (const ivLen of ivLens) {
        for (const macLen of macLens) {
            for (const idSize of identitySizes) {
                for (const refSize of refSizes) {
                    let allMatch = true;
                    let totalRefs = 0;
                    let minRefs = Infinity;
                    let maxRefs = 0;

                    for (const tag of tags) {
                        const encDataLen = hi.encLen(tag.payloadLen);
                        if (encDataLen <= 0) { allMatch = false; break; }

                        const ptLen = encDataLen - ivLen - macLen;
                        if (ptLen <= 0) { allMatch = false; break; }

                        const refsBytes = ptLen - idSize;
                        if (refsBytes < 0) { allMatch = false; break; }

                        const numRefs = refsBytes / refSize;
                        if (!Number.isInteger(numRefs)) { allMatch = false; break; }
                        if (numRefs < 1) { allMatch = false; break; }

                        totalRefs += numRefs;
                        minRefs = Math.min(minRefs, numRefs);
                        maxRefs = Math.max(maxRefs, numRefs);
                    }

                    if (allMatch) {
                        results.push({
                            header: hi.name,
                            ivLen, macLen, idSize, refSize,
                            minRefs, maxRefs,
                            avgRefs: (totalRefs / tags.length).toFixed(1)
                        });
                    }
                }
            }
        }
    }
}

console.log(`\nFound ${results.length} valid combinations where ALL 14 tags have integer refs.\n`);

if (results.length === 0) {
    console.log("No perfect matches found! Trying with tolerance...\n");

    // Retry allowing 1-2 tags to not match
    const tolerantResults = [];
    for (const hi of headerInterpretations) {
        for (const ivLen of ivLens) {
            for (const macLen of macLens) {
                for (const idSize of identitySizes) {
                    for (const refSize of refSizes) {
                        let matchCount = 0;
                        let failNames = [];

                        for (const tag of tags) {
                            const encDataLen = hi.encLen(tag.payloadLen);
                            if (encDataLen <= 0) { failNames.push(tag.name); continue; }

                            const ptLen = encDataLen - ivLen - macLen;
                            if (ptLen <= 0) { failNames.push(tag.name); continue; }

                            const refsBytes = ptLen - idSize;
                            if (refsBytes < 0) { failNames.push(tag.name); continue; }

                            const numRefs = refsBytes / refSize;
                            if (Number.isInteger(numRefs) && numRefs >= 1) {
                                matchCount++;
                            } else {
                                failNames.push(tag.name);
                            }
                        }

                        if (matchCount >= 12) { // allow up to 2 failures
                            tolerantResults.push({
                                header: hi.name,
                                ivLen, macLen, idSize, refSize,
                                matchCount, failNames: failNames.join(", ")
                            });
                        }
                    }
                }
            }
        }
    }

    tolerantResults.sort((a, b) => b.matchCount - a.matchCount);

    console.log(`Found ${tolerantResults.length} combinations matching 12+ of 14 tags.\n`);
    console.log("Top results:\n");
    console.log("Header".padEnd(35), "IV", "MAC", "ID", "Ref", "Match", "Failures");
    console.log("-".repeat(100));
    for (const r of tolerantResults.slice(0, 40)) {
        console.log(
            `${r.header.padEnd(35)} ${r.ivLen.toString().padStart(2)}  ${r.macLen.toString().padStart(3)}  ${r.idSize.toString().padStart(2)}  ${r.refSize.toString().padStart(3)}  ${r.matchCount.toString().padStart(2)}/14  ${r.failNames}`
        );
    }
} else {
    // Show all perfect matches
    console.log("Header".padEnd(35), "IV", "MAC", "ID", "Ref", "Refs(min-max)", "Avg");
    console.log("-".repeat(95));
    for (const r of results) {
        console.log(
            `${r.header.padEnd(35)} ${r.ivLen.toString().padStart(2)}  ${r.macLen.toString().padStart(3)}  ${r.idSize.toString().padStart(2)}  ${r.refSize.toString().padStart(3)}  ${r.minRefs}-${r.maxRefs}`.padEnd(75),
            r.avgRefs
        );
    }

    // Highlight Grain-128A compatible results (IV=12)
    const grain = results.filter(r => r.ivLen === 12);
    if (grain.length > 0) {
        console.log(`\n--- Grain-128A compatible (IV=12) ---\n`);
        for (const r of grain) {
            console.log(`  Header: ${r.header}`);
            console.log(`  IV=${r.ivLen}, MAC=${r.macLen}, Identity=${r.idSize}B, RefRecord=${r.refSize}B`);
            console.log(`  Refs per tag: ${r.minRefs}-${r.maxRefs} (avg ${r.avgRefs})\n`);

            // Show breakdown per tag
            for (const tag of tags) {
                const encDataLen = headerInterpretations.find(h => h.name === r.header).encLen(tag.payloadLen);
                const ptLen = encDataLen - r.ivLen - r.macLen;
                const numRefs = (ptLen - r.idSize) / r.refSize;
                console.log(`    ${tag.name.padEnd(14)} payload=${tag.payloadLen.toString().padStart(3)} pt=${ptLen.toString().padStart(3)} refs=${numRefs}`);
            }
            console.log();
        }
    }
}
