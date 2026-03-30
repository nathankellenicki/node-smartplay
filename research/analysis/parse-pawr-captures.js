/**
 * Parse PAwR PCAP captures and decrypt BrickNet messages.
 * Look for content identity data in the decrypted payloads.
 *
 * PAwR messages are wrapped in Service Data AD type (0x16) with UUID 0xFEF3.
 * Wire format: 25 bytes, first 16 XOR-encrypted, last 9 cleartext.
 */

const fs = require("fs");

const XOR_KEY = Buffer.from([0x4a, 0x17, 0x23, 0x4a, 0x59, 0x34, 0x37, 0x11,
                              0x32, 0x18, 0x25, 0x39, 0x31, 0xb5, 0x6b, 0xf6]);

// Simple PCAP parser (libpcap format)
function parsePcap(filePath) {
    const buf = fs.readFileSync(filePath);
    const magic = buf.readUInt32LE(0);

    let headerLen, readUint32, readUint16;
    if (magic === 0xa1b2c3d4) {
        // Little-endian
        readUint32 = (b, o) => b.readUInt32LE(o);
        readUint16 = (b, o) => b.readUInt16LE(o);
        headerLen = 24;
    } else if (magic === 0xd4c3b2a1) {
        // Big-endian
        readUint32 = (b, o) => b.readUInt32BE(o);
        readUint16 = (b, o) => b.readUInt16BE(o);
        headerLen = 24;
    } else {
        console.log(`Unknown PCAP magic: 0x${magic.toString(16)}`);
        return [];
    }

    const linkType = readUint32(buf, 20);
    const packets = [];
    let offset = headerLen;

    while (offset + 16 <= buf.length) {
        const tsSec = readUint32(buf, offset);
        const tsUsec = readUint32(buf, offset + 4);
        const inclLen = readUint32(buf, offset + 8);
        const origLen = readUint32(buf, offset + 12);
        offset += 16;

        if (offset + inclLen > buf.length) break;
        const data = buf.slice(offset, offset + inclLen);
        packets.push({ tsSec, tsUsec, data, linkType });
        offset += inclLen;
    }

    return packets;
}

// Search for FEF3 service data in a packet's raw bytes
function findFEF3Payloads(data) {
    const results = [];
    // Search for AD type 0x16 followed by UUID 0xFEF3 (little-endian: F3 FE)
    for (let i = 0; i < data.length - 4; i++) {
        if (data[i + 1] === 0x16 && data[i + 2] === 0xf3 && data[i + 3] === 0xfe) {
            const adLen = data[i]; // length of AD structure (excluding the length byte itself)
            const payloadStart = i + 4; // after len, type, uuid_lo, uuid_hi
            const payloadLen = adLen - 3; // subtract type(1) + uuid(2)
            if (payloadLen > 0 && payloadStart + payloadLen <= data.length) {
                results.push(data.slice(payloadStart, payloadStart + payloadLen));
            }
        }
    }
    return results;
}

// Also search for raw 25-byte BrickNet messages by looking for patterns
function findBrickNetByKey(data) {
    const results = [];
    // Look for sequences where XOR with key produces clean data
    for (let i = 0; i < data.length - 25; i++) {
        const candidate = data.slice(i, i + 16);
        const decrypted = Buffer.alloc(16);
        for (let j = 0; j < 16; j++) decrypted[j] = candidate[j] ^ XOR_KEY[j];
        // Check if decrypted looks like a valid BrickNet message
        // Byte 8 should be a known opcode
        const opcode = decrypted[8];
        if ([0x00, 0x01, 0x04, 0x06, 0x08, 0x10, 0x20, 0x30, 0x3a, 0x40, 0x60, 0x80].includes(opcode)) {
            // For non-idle messages, first 8 bytes are often mostly zero
            const firstEightZeros = Array.from(decrypted.slice(0, 8)).filter(b => b === 0).length;
            if (opcode === 0x00 && firstEightZeros === 16) continue; // Skip heartbeats for now
            if (firstEightZeros >= 4 || opcode !== 0x00) {
                // Potential match - but skip if it looks like we're in the middle of random data
            }
        }
    }
    return results;
}

function decrypt(payload) {
    const decrypted = Buffer.alloc(payload.length);
    for (let i = 0; i < Math.min(16, payload.length); i++) {
        decrypted[i] = payload[i] ^ XOR_KEY[i];
    }
    // Copy cleartext tail
    for (let i = 16; i < payload.length; i++) {
        decrypted[i] = payload[i];
    }
    return decrypted;
}

function hexStr(buf) {
    return Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join(" ");
}

// Process capture files
const files = [
    "/Users/nathankellenicki/Desktop/Projects/openbrickproject/node-smartplay/randomfiles/pawr_capture.pcap",
    "/Users/nathankellenicki/Desktop/Projects/openbrickproject/node-smartplay/randomfiles/pawr_weapon_test.pcap",
];

for (const file of files) {
    const shortName = file.split("/").pop();
    console.log(`\n${"=".repeat(70)}`);
    console.log(`Parsing: ${shortName}`);
    console.log(`${"=".repeat(70)}\n`);

    const packets = parsePcap(file);
    console.log(`Total packets: ${packets.length}`);

    // Find all FEF3 payloads
    const allPayloads = [];
    for (const pkt of packets) {
        const payloads = findFEF3Payloads(pkt.data);
        for (const p of payloads) {
            allPayloads.push({ ts: pkt.tsSec + pkt.tsUsec / 1e6, payload: p });
        }
    }

    console.log(`FEF3 payloads found: ${allPayloads.length}\n`);

    if (allPayloads.length === 0) {
        // Try broader search - look for the XOR key pattern in raw data
        console.log("No FEF3 payloads found. Searching for BrickNet patterns in raw data...\n");

        // Look for the XOR key itself (idle heartbeat = encrypted zeros = key)
        let keyMatches = 0;
        for (const pkt of packets) {
            for (let i = 0; i < pkt.data.length - 16; i++) {
                let match = true;
                for (let j = 0; j < 16; j++) {
                    if (pkt.data[i + j] !== XOR_KEY[j]) { match = false; break; }
                }
                if (match) {
                    keyMatches++;
                    if (keyMatches <= 5) {
                        const context = pkt.data.slice(Math.max(0, i - 4), Math.min(pkt.data.length, i + 28));
                        console.log(`  Key found at packet offset ${i}: ${hexStr(context)}`);
                    }
                }
            }
        }
        console.log(`  Total key pattern matches: ${keyMatches}\n`);
        continue;
    }

    // Categorize by opcode
    const byOpcode = {};
    const nonIdle = [];

    for (const { ts, payload } of allPayloads) {
        const dec = decrypt(payload);
        const opcode = dec[8];
        if (!byOpcode[opcode]) byOpcode[opcode] = [];
        byOpcode[opcode].push({ ts, raw: payload, dec });
        if (opcode !== 0x00) nonIdle.push({ ts, raw: payload, dec, opcode });
    }

    console.log("--- Opcode distribution ---");
    for (const [op, msgs] of Object.entries(byOpcode).sort((a, b) => b[1].length - a[1].length)) {
        console.log(`  opcode 0x${parseInt(op).toString(16).padStart(2, "0")}: ${msgs.length} messages`);
    }

    console.log(`\n--- All non-idle decrypted messages (${nonIdle.length}) ---\n`);
    for (const { ts, dec, opcode } of nonIdle) {
        const encPart = hexStr(dec.slice(0, 16));
        const clrPart = dec.length > 16 ? hexStr(dec.slice(16)) : "";
        console.log(`  t=${ts.toFixed(3)} op=0x${opcode.toString(16).padStart(2, "0")} | ${encPart} | ${clrPart}`);
    }

    // Look for any bytes that could be content identity
    // The content identity is 6 bytes: content_lo(u32) + content_hi(u16)
    // Look for repeated 6-byte sequences across non-idle messages
    console.log("\n--- Repeated byte patterns in non-idle messages ---\n");
    const patterns = {};
    for (const { dec } of nonIdle) {
        for (let start = 0; start < dec.length - 5; start++) {
            const pat = hexStr(dec.slice(start, start + 6));
            if (pat === "00 00 00 00 00 00") continue; // skip zeros
            patterns[pat] = (patterns[pat] || 0) + 1;
        }
    }
    const repeated = Object.entries(patterns).filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
    if (repeated.length > 0) {
        console.log("6-byte patterns appearing 3+ times:");
        for (const [pat, count] of repeated.slice(0, 20)) {
            console.log(`  ${pat}: ${count} times`);
        }
    } else {
        console.log("No 6-byte patterns appear 3+ times in non-idle messages.");
    }

    // Also look for unique non-zero data in key exchange messages (opcode 0x01, 0x04)
    const keyExchange = [...(byOpcode[0x01] || []), ...(byOpcode[0x04] || [])];
    if (keyExchange.length > 0) {
        console.log(`\n--- Key exchange messages (${keyExchange.length}) ---\n`);
        for (const { ts, dec } of keyExchange) {
            console.log(`  t=${ts.toFixed(3)} | ${hexStr(dec)}`);
        }
    }

    // Show unique encrypted+cleartext data for game events with content
    const contentEvents = nonIdle.filter(m => [0x06, 0x08, 0x0c, 0x30].includes(m.opcode));
    if (contentEvents.length > 0) {
        console.log(`\n--- Game events with potential content data ---\n`);
        for (const { ts, dec, opcode } of contentEvents) {
            console.log(`  t=${ts.toFixed(3)} op=0x${opcode.toString(16).padStart(2, "0")} | ${hexStr(dec)}`);
        }
    }
}
