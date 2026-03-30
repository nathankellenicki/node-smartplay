/**
 * Offset Validation v2: Variable-Length Record Analysis
 *
 * Since records are variable-length TLVs, we can't assume fixed sizes.
 * Instead, analyze payload size differences between tags to find:
 *
 * 1. Common base sizes within categories (identity vs item)
 * 2. Size differences that correspond to adding/removing record types
 * 3. Whether the differences match known record type structures
 *
 * Also: test a new hypothesis. Maybe the encrypted data is NOT the
 * Layer 2 TLV format, but rather the raw ASIC output before TLV parsing.
 * The ASIC deposits into registers:
 *   - 4 × 20-byte blocks (regs 0x04-0x07) = 80 bytes
 *   - 3 × 100-byte buffers (regs 0x2A-0x2C) = 300 bytes
 *   - 1 × 24-byte repacked (reg 0x2E) = 24 bytes
 * Total: 404 bytes max. But tags are much smaller (57-154 bytes of ciphertext).
 * So the encrypted data is compactly encoded, not register-layout format.
 */

const tags = [
    { name: "R2-D2",       cat: "identity", payloadLen: 74 },
    { name: "Fuel Cargo",   cat: "item",     payloadLen: 101 },
    { name: "X-Wing",       cat: "item",     payloadLen: 107 },
    { name: "TIE Fighter",  cat: "item",     payloadLen: 107 },
    { name: "Falcon",       cat: "item",     payloadLen: 107 },
    { name: "Hyperdrive",   cat: "item",     payloadLen: 109 },
    { name: "Han Solo",     cat: "identity", payloadLen: 113 },
    { name: "Chewbacca",    cat: "identity", payloadLen: 116 },
    { name: "C-3PO",        cat: "identity", payloadLen: 118 },
    { name: "Lightsaber",   cat: "item",     payloadLen: 126 },
    { name: "Luke",         cat: "identity", payloadLen: 157 },
    { name: "Leia",         cat: "identity", payloadLen: 158 },
    { name: "Vader",        cat: "identity", payloadLen: 169 },
    { name: "Palpatine",    cat: "identity", payloadLen: 171 },
];

// payloadLen includes the 4-byte block 0 header
// encrypted data = payloadLen - 5 (header + format byte)

console.log("=== Payload Size Analysis ===\n");

// For various IV/MAC combos, show plaintext sizes
for (const [ivLen, macLen, label] of [[12, 0, "Grain-128A IV=12, no MAC"], [12, 4, "Grain-128A IV=12, MAC=4"], [12, 8, "Grain-128A IV=12, MAC=8"], [0, 0, "No IV, no MAC"]]) {
    console.log(`--- ${label} ---`);
    console.log(`Plaintext = payloadLen - 5(header) - ${ivLen}(IV) - ${macLen}(MAC)\n`);

    const identitySizes = [];
    const itemSizes = [];

    for (const t of tags) {
        const pt = t.payloadLen - 5 - ivLen - macLen;
        const group = t.cat === "identity" ? identitySizes : itemSizes;
        group.push({ name: t.name, pt });
        console.log(`  ${t.name.padEnd(14)} ${t.cat.padEnd(8)} pt=${pt.toString().padStart(3)}`);
    }

    // Compute pairwise differences within categories
    console.log("\n  Identity pairwise differences:");
    const idSorted = identitySizes.sort((a, b) => a.pt - b.pt);
    for (let i = 1; i < idSorted.length; i++) {
        const diff = idSorted[i].pt - idSorted[i-1].pt;
        console.log(`    ${idSorted[i-1].name} (${idSorted[i-1].pt}) → ${idSorted[i].name} (${idSorted[i].pt}): +${diff}`);
    }

    console.log("\n  Item pairwise differences:");
    const itemSorted = itemSizes.sort((a, b) => a.pt - b.pt);
    for (let i = 1; i < itemSorted.length; i++) {
        const diff = itemSorted[i].pt - itemSorted[i-1].pt;
        console.log(`    ${itemSorted[i-1].name} (${itemSorted[i-1].pt}) → ${itemSorted[i].name} (${itemSorted[i].pt}): +${diff}`);
    }

    // Find GCD of all sizes within each category
    function gcd(a, b) { return b === 0 ? a : gcd(b, a % b); }

    // Check if sizes modulo various bases cluster
    console.log("\n  Modular analysis (identity plaintext sizes mod N):");
    for (const mod of [8, 10, 12, 14, 15, 16, 18, 20]) {
        const remainders = idSorted.map(s => s.pt % mod);
        const uniqueRemainders = [...new Set(remainders)];
        if (uniqueRemainders.length <= 3) {
            console.log(`    mod ${mod.toString().padStart(2)}: remainders = [${remainders.join(", ")}] — ${uniqueRemainders.length} unique`);
        }
    }

    console.log("\n  Modular analysis (item plaintext sizes mod N):");
    for (const mod of [8, 10, 12, 14, 15, 16, 18, 20]) {
        const remainders = itemSorted.map(s => s.pt % mod);
        const uniqueRemainders = [...new Set(remainders)];
        if (uniqueRemainders.length <= 3) {
            console.log(`    mod ${mod.toString().padStart(2)}: remainders = [${remainders.join(", ")}] — ${uniqueRemainders.length} unique`);
        }
    }

    // Cross-category: what's the smallest identity - smallest item?
    if (idSorted.length > 0 && itemSorted.length > 0) {
        console.log(`\n  Smallest identity (${idSorted[0].name}): ${idSorted[0].pt}`);
        console.log(`  Smallest item (${itemSorted[0].name}): ${itemSorted[0].pt}`);
        console.log(`  Difference: ${idSorted[0].pt - itemSorted[0].pt}`);
    }

    console.log("\n");
}

// Try a completely different model: content_identity is always the same size,
// but each resource ref type has a different size. Tags carry different
// combinations of ref types.
console.log("=== Known Tag Capabilities ===\n");
console.log("From SCRIPTS.md param cross-references and PAwR analysis:\n");

// What we know about each tag's resource ref types:
const tagCapabilities = {
    "R2-D2":     { identity: true, timer: false, button: false, npm: false, notes: "Smallest — minimal interaction" },
    "Fuel Cargo": { item: true, timer: false, button: false, npm: false, notes: "Simple item tile" },
    "X-Wing":     { item: true, timer: true, button: false, npm: false, notes: "PAwR combat (timer=24)" },
    "TIE Fighter":{ item: true, timer: true, button: false, npm: false, notes: "PAwR combat (timer=24)" },
    "Falcon":     { item: true, timer: true, button: false, npm: false, notes: "PAwR combat (timer=24, probably)" },
    "Hyperdrive": { item: true, timer: true, button: false, npm: false, notes: "Slightly larger than X-Wing triplet" },
    "Han Solo":   { identity: true, timer: true, button: true, npm: false, notes: "Falcon set character" },
    "Chewbacca":  { identity: true, timer: true, button: true, npm: false, notes: "Falcon set character" },
    "C-3PO":      { identity: true, timer: true, button: true, npm: false, notes: "Falcon set character" },
    "Lightsaber": { item: true, timer: true, button: true, npm: false, notes: "Largest item — most interaction modes" },
    "Luke":       { identity: true, timer: true, button: true, npm: true, notes: "Full capability minifig" },
    "Leia":       { identity: true, timer: true, button: true, npm: true, notes: "Full capability minifig" },
    "Vader":      { identity: true, timer: true, button: true, npm: true, notes: "Full capability minifig" },
    "Palpatine":  { identity: true, timer: true, button: true, npm: true, notes: "Full capability — largest tag" },
};

// Using IV=12, MAC=0 plaintext sizes (our best guess for now)
const IV_LEN = 12;
const MAC_LEN = 0;

console.log("Tag".padEnd(14), "PT", "Caps", "Cap count", "Notes");
console.log("-".repeat(100));
for (const t of tags) {
    const pt = t.payloadLen - 5 - IV_LEN - MAC_LEN;
    const caps = tagCapabilities[t.name] || {};
    const capList = Object.entries(caps)
        .filter(([k, v]) => v === true)
        .map(([k]) => k);
    const capCount = capList.length;
    console.log(
        `${t.name.padEnd(14)} ${pt.toString().padStart(3)} ${capList.join("+").padEnd(30)} ${capCount}     ${caps.notes || ""}`
    );
}

// Group by capability count and compute average size per capability
console.log("\n--- Average plaintext bytes per capability count ---\n");
const byCapCount = {};
for (const t of tags) {
    const pt = t.payloadLen - 5 - IV_LEN - MAC_LEN;
    const caps = tagCapabilities[t.name] || {};
    const capCount = Object.values(caps).filter(v => v === true).length;
    if (!byCapCount[capCount]) byCapCount[capCount] = [];
    byCapCount[capCount].push({ name: t.name, pt });
}

for (const [count, entries] of Object.entries(byCapCount).sort((a, b) => a[0] - b[0])) {
    const sizes = entries.map(e => e.pt);
    const avg = (sizes.reduce((a, b) => a + b, 0) / sizes.length).toFixed(1);
    const names = entries.map(e => `${e.name}(${e.pt})`).join(", ");
    console.log(`  ${count} caps: avg=${avg}, tags: ${names}`);
}

// Compute the incremental cost of each capability type
console.log("\n--- Incremental cost per capability ---\n");
console.log("Compare tags that differ by exactly one capability:\n");

// 1 cap (R2-D2=57, Fuel=84) vs 2 cap (X-Wing/TIE/Falcon=90, Hyper=92)
// Adding timer to item: Fuel(84,item) → X-Wing(90,item+timer) = +6?? That's very small
// Adding timer to item: Fuel(84,item) → Hyper(92,item+timer) = +8

// 3 cap (Han=96, Chewie=99, C3PO=101) vs 2 cap (X-Wing=90)
// identity+timer+button vs item+timer

// 4 cap (Luke=140, Leia=141, Vader=152, Palp=154)
// identity+timer+button+npm

// Fuel(1 cap, 84) → X-Wing(2 cap, 90): timer adds 6 bytes
// X-Wing(2 cap, 90) → Lightsaber(3 cap, 109): button adds 19 bytes? Hmm
// Han(3 cap, 96) → Luke(4 cap, 140): npm adds 44 bytes?? Too much

console.log("Item tags:");
console.log(`  1→2 caps: Fuel(${84}) → X-Wing(${90}): +${90-84} (add timer?)`);
console.log(`  1→2 caps: Fuel(${84}) → Hyper(${92}): +${92-84} (add timer?)`);
console.log(`  2→3 caps: X-Wing(${90}) → Lightsaber(${109}): +${109-90} (add button?)`);
console.log();
console.log("Identity tags:");
console.log(`  1→3 caps: R2-D2(${57}) → Han(${96}): +${96-57} (add timer+button)`);
console.log(`  1→3 caps: R2-D2(${57}) → Chewie(${99}): +${99-57} (add timer+button)`);
console.log(`  1→3 caps: R2-D2(${57}) → C3PO(${101}): +${101-57} (add timer+button)`);
console.log(`  3→4 caps: Han(${96}) → Luke(${140}): +${140-96} (add npm)`);
console.log(`  3→4 caps: Chewie(${99}) → Leia(${141}): +${141-99} (add npm)`);
console.log(`  3→4 caps: C3PO(${101}) → Vader(${152}): +${152-101} (add npm)`);
console.log(`  3→4 caps: C3PO(${101}) → Palp(${154}): +${154-101} (add npm)`);
console.log();
console.log("NOTE: These size differences include ALL the data in the resource ref");
console.log("record for that capability, not just the content_ref. Each record includes");
console.log("TLV framing + tag_byte + session + sub_type + content_ref + bank_index + bank_ref.");
