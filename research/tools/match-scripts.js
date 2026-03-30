#!/usr/bin/env node

/**
 * Dual-stream script↔opcode matcher.
 *
 * The EM9305 play-engine executor at ROM 0x4B830 uses two separate streams:
 *   1. Opcode stream — ROM at 0x37BCF4 (file offset 0x75CF4). Contains handler IDs
 *      (1-25), inline operands, and terminators (0).
 *   2. Data stream — play.bin script data (after 12-byte header). Contains
 *      MessagePack-encoded values consumed by handler reader functions.
 *
 * This script tries every unique opcode position from the 384-entry lookup table
 * against each of the 58 scripts and reports exact matches (data fully consumed).
 */

const fs = require("fs");
const path = require("path");

const CODE_PATH = path.resolve(__dirname, "../randomfiles/firmware/smartbrick_v0.72.1_code.bin");
const PLAY_PATH = path.resolve(__dirname, "../randomfiles/firmware/play.bin");

const code = fs.readFileSync(CODE_PATH);
const play = fs.readFileSync(PLAY_PATH);

// --- Opcode stream (ROM) ---
const OPCODE_BASE = 0x75CF4;  // file offset for ROM 0x37BCF4
const opStream = code;  // index with OPCODE_BASE + position

// --- Stride table (ROM 0x37BA00, file offset 0x75A00) ---
const STRIDE_BASE = 0x75A00;

// --- 384-entry lookup table ---
const LOOKUP_OFF = 0x747A8;
const uniquePositions = new Set();
const lookupEntries = [];
for (let i = 0; i < 384; i++) {
    const off = LOOKUP_OFF + i * 12;
    const key = code.readUInt32LE(off);
    const posField = code.readUInt32LE(off + 4);
    const field2 = code.readUInt32LE(off + 8);
    const pos = posField & 0x3FFF;
    lookupEntries.push({ index: i, key, posField, field2, pos });
    uniquePositions.add(pos);
}
const positions = Array.from(uniquePositions).sort((a, b) => a - b);
console.log(`Lookup: ${lookupEntries.length} entries, ${positions.length} unique positions (${positions[0]}-${positions[positions.length - 1]})`);

// --- Parse scripts from play.bin ---
const NUM_SCRIPTS = play.readUInt16LE(0x0A);
const SCRIPT_DIR = 0x1F8;
const PRESET_OFF = 0x10;
const PREAMBLE = 3;

const TYPE_NAMES = { 0x03: "ContentA", 0x06: "ContentB", 0x09: "NPM", 0x0B: "System", 0x0E: "Timer", 0x10: "Button" };

const scripts = [];
for (let i = 0; i < NUM_SCRIPTS; i++) {
    const off = SCRIPT_DIR + i * 8;
    const sOff = play.readUInt32LE(off);
    const sSize = play.readUInt32LE(off + 4);
    const pOff = PRESET_OFF + (PREAMBLE + i) * 8;
    const type = play.readUInt32LE(pOff);
    const param = play.readUInt32LE(pOff + 4);
    const data = play.subarray(sOff + 12, sOff + sSize);
    scripts.push({ index: i, type, param, typeName: TYPE_NAMES[type] || `0x${type.toString(16)}`, data });
}
console.log(`Scripts: ${scripts.length}\n`);

// === Value readers (data stream) ===

/** Read unsigned value (class 3). Returns { value, consumed } or null. */
function readUnsigned(data, pos) {
    if (pos >= data.length) return null;
    const b = data[pos];
    if (b <= 0x7F) return { value: b, consumed: 1 };
    if (b === 0xCC) {
        if (pos + 1 >= data.length) return null;
        return { value: data[pos + 1], consumed: 2 };
    }
    if (b === 0xCD) {
        if (pos + 2 >= data.length) return null;
        return { value: (data[pos + 1] << 8) | data[pos + 2], consumed: 3 };
    }
    if (b === 0xCE) {
        if (pos + 4 >= data.length) return null;
        return { value: data.readUInt32BE(pos + 1), consumed: 5 };
    }
    if (b === 0xCF) {
        if (pos + 8 >= data.length) return null;
        return { value: Number(data.readBigUInt64BE(pos + 1)), consumed: 9 };
    }
    return null;
}

/** Read integer (class 8: 0x90, 0xDC, 0xDD). Returns { value, consumed } or null. */
function readInt(data, pos) {
    if (pos >= data.length) return null;
    const b = data[pos];
    if (b === 0x90) {
        if (pos + 1 >= data.length) return null;
        const next = data[pos + 1];
        let value;
        if (next > 0x8F) {
            value = ((next * 2) + 0x38) & 0xFF;
        } else {
            value = next;  // direct value for <= 0x8F
        }
        return { value, consumed: 2 };
    }
    if (b === 0xDC) {
        if (pos + 2 >= data.length) return null;
        return { value: (data[pos + 1] << 8) | data[pos + 2], consumed: 3 };
    }
    if (b === 0xDD) {
        if (pos + 4 >= data.length) return null;
        return { value: data.readUInt32BE(pos + 1), consumed: 5 };
    }
    return null;
}

/** Read C0 nil marker (class 1). */
function readC0(data, pos) {
    if (pos >= data.length) return null;
    if (data[pos] !== 0xC0) return null;
    return { value: null, consumed: 1 };
}

/** Read boolean (class 2: 0xC2=false, 0xC3=true). */
function readBool(data, pos) {
    if (pos >= data.length) return null;
    const b = data[pos];
    if (b === 0xC2) return { value: false, consumed: 1 };
    if (b === 0xC3) return { value: true, consumed: 1 };
    return null;
}

/** Read signed value (class 3 + class 4: positive fixint, uint prefixes, negative fixint, signed prefixes). */
function readSigned(data, pos) {
    if (pos >= data.length) return null;
    const b = data[pos];
    // Class 3: positive fixint + uint prefixes
    if (b <= 0x7F) return { value: b, consumed: 1 };
    if (b === 0xCC) {
        if (pos + 1 >= data.length) return null;
        return { value: data[pos + 1], consumed: 2 };
    }
    if (b === 0xCD) {
        if (pos + 2 >= data.length) return null;
        return { value: (data[pos + 1] << 8) | data[pos + 2], consumed: 3 };
    }
    if (b === 0xCE) {
        if (pos + 4 >= data.length) return null;
        return { value: data.readInt32BE(pos + 1), consumed: 5 };
    }
    // Class 4: negative fixint
    if (b >= 0xE0) return { value: b - 256, consumed: 1 };
    // Signed prefixes
    if (b === 0xD0) {
        if (pos + 1 >= data.length) return null;
        return { value: data.readInt8(pos + 1), consumed: 2 };
    }
    if (b === 0xD1) {
        if (pos + 2 >= data.length) return null;
        return { value: data.readInt16BE(pos + 1), consumed: 3 };
    }
    if (b === 0xD2) {
        if (pos + 4 >= data.length) return null;
        return { value: data.readInt32BE(pos + 1), consumed: 5 };
    }
    return null;
}

/**
 * Read "word" value (class 7). Used by handlers 16, 17.
 * 0xC4 = bin8 (2 bytes), 0xC5 = bin16 (3 bytes), 0xC6 = bin32 (5 bytes).
 */
function readWord(data, pos) {
    if (pos >= data.length) return null;
    const b = data[pos];
    if (b === 0xC4) {
        if (pos + 1 >= data.length) return null;
        return { value: data[pos + 1], consumed: 2 };
    }
    if (b === 0xC5) {
        if (pos + 2 >= data.length) return null;
        return { value: (data[pos + 1] << 8) | data[pos + 2], consumed: 3 };
    }
    if (b === 0xC6) {
        if (pos + 4 >= data.length) return null;
        return { value: data.readUInt32BE(pos + 1), consumed: 5 };
    }
    return null;
}

/**
 * Read "range value" used by handler 15. Called via 0x519e8.
 * This might be a variant reader — try unsigned first, then signed.
 */
function readRangeValue(data, pos) {
    // Try unsigned first (most common)
    const u = readUnsigned(data, pos);
    if (u) return u;
    // Try signed
    return readSigned(data, pos);
}

/**
 * Read "variant" value used by handler 10. Called via 0x51598.
 * Accept any valid encoding.
 */
function readVariant(data, pos) {
    const u = readUnsigned(data, pos);
    if (u) return u;
    const s = readSigned(data, pos);
    if (s) return s;
    const b = readBool(data, pos);
    if (b) return b;
    const c = readC0(data, pos);
    if (c) return c;
    return null;
}

// === Executor simulation ===

/**
 * Execute from opcode position `opcPos`, consuming data from `data` starting at `dPos`.
 * Returns { opcPos, dPos } after execution, or null on failure.
 */
function execute(opcPos, data, dPos, depth) {
    if (depth > 500) return null;
    const absOpc = OPCODE_BASE + opcPos;
    if (absOpc >= code.length) return null;

    const handler = code[absOpc] - 1;
    if (handler < 0 || handler > 24) return null;  // terminator or invalid

    // Advance opcode position past handler byte (all handlers do this)
    let oPos = opcPos + 1;

    switch (handler) {
        case 0: { // cond_exec — read_C0 from data, + 1 inline byte (output advance)
            // From disasm: handler 21 (byte=22) at 0x4b8c2
            // Wait, that's handler index 21, not 0.
            // Handler 0 (byte=1) at 0x4b8e2: just calls read_C0, goto common_tail
            const r = readC0(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 1: { // eval_expr — read_bool from data
            const r = readBool(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 2: { // wr_u8 — read_u8 from data
            const r = readUnsigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 3: { // wr_u16 — read_u16 from data
            const r = readUnsigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 4: { // wr_u32 — read_u32 from data
            const r = readUnsigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 5: { // wr_u64 — read_u64 from data
            const r = readUnsigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 6: { // wr_s8 — read_signed from data
            const r = readSigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 7: { // wr_s16 — read_signed from data
            const r = readSigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 8: { // wr_s32 — read_signed from data
            const r = readSigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 9: { // wr_s64 — read_signed from data
            const r = readSigned(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 10: { // variant — read_variant from data
            const r = readVariant(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 11: { // dead handler
            return null;
        }

        case 12: { // if_then — read_int from data, execute 1 child
            // Position +1 (no inline bytes). Read read_int, then 1 recursive child.
            const r = readInt(data, dPos);
            if (!r) return null;
            if (r.value === 0) return null;  // firmware checks != 0
            const child = execute(oPos, data, dPos + r.consumed, depth + 1);
            if (!child) return null;
            return { opcPos: child.opcPos, dPos: child.dPos };
        }

        case 13: { // if_else — read_int from data, 1 inline byte, 2 children
            // Position +2 (1 inline byte = else output offset). Read read_int, then 2 children.
            const r = readInt(data, dPos);
            if (!r) return null;
            if (r.value < 2) return null;  // firmware checks >= 2
            const inlineOff = OPCODE_BASE + oPos;
            if (inlineOff >= code.length) return null;
            oPos += 1;  // skip inline byte
            // Execute THEN child
            const then_ = execute(oPos, data, dPos + r.consumed, depth + 1);
            if (!then_) return null;
            // Execute ELSE child
            const else_ = execute(then_.opcPos, data, then_.dPos, depth + 1);
            if (!else_) return null;
            return { opcPos: else_.opcPos, dPos: else_.dPos };
        }

        case 14: { // counted_loop — 3 inline bytes, read_int from data, loop N children
            // Position +4 (3 inline: [max_count, stride_lo, stride_hi])
            const inlineBase = OPCODE_BASE + oPos;
            if (inlineBase + 2 >= code.length) return null;
            const maxCount = code[inlineBase];
            const strideLo = code[inlineBase + 1];
            const strideHi = code[inlineBase + 2];
            const strideIdx = (strideHi << 8) | strideLo;
            oPos += 3;

            const r = readInt(data, dPos);
            if (!r) return null;
            const count = r.value;
            if (count > maxCount) return null;  // firmware validates
            let dp = dPos + r.consumed;

            // Execute child `count` times. Child opcode advances on each call.
            let childOpc = oPos;
            for (let i = 0; i < count; i++) {
                const child = execute(childOpc, data, dp, depth + 1);
                if (!child) return null;
                if (i === 0) childOpc = child.opcPos;  // first iteration sets the opcode extent
                dp = child.dPos;
            }
            // If count is 0, we still need to determine opcode extent by scanning
            if (count === 0) {
                // Skip the child opcode tree structure
                const child = skipOpcodeTree(childOpc);
                if (child === null) return null;
                childOpc = child;
            }
            return { opcPos: childOpc, dPos: dp };
        }

        case 15: { // range_check — 2 inline bytes, reads value from data + 4 more bytes
            // Position +3 (2 inline: limit_lo, limit_hi). Reads via 0x519e8 then 0x519c8.
            const inlineBase = OPCODE_BASE + oPos;
            if (inlineBase + 1 >= code.length) return null;
            oPos += 2;

            const r = readRangeValue(data, dPos);
            if (!r) return null;
            // After the first value, reads 4 more bytes via 0x519c8
            // (stores value at output[0:4], then reads more at output[4:8])
            // The 0x519c8 reader likely reads a u32 — 4 bytes of output suggests it reads a word
            let dp = dPos + r.consumed;
            const r2 = readUnsigned(data, dp);
            if (!r2) return null;
            dp += r2.consumed;
            return { opcPos: oPos, dPos: dp };
        }

        case 16: { // range_word — 2 inline bytes, read_word from data + more
            const inlineBase = OPCODE_BASE + oPos;
            if (inlineBase + 1 >= code.length) return null;
            oPos += 2;

            const r = readWord(data, dPos);
            if (!r) return null;
            let dp = dPos + r.consumed;
            // Reads 4 more bytes via 0x51498
            const r2 = readUnsigned(data, dp);
            if (!r2) return null;
            dp += r2.consumed;
            return { opcPos: oPos, dPos: dp };
        }

        case 17: { // exact_match — 2 inline bytes, read_word from data + 0x51470
            const inlineBase = OPCODE_BASE + oPos;
            if (inlineBase + 1 >= code.length) return null;
            oPos += 2;

            const r = readWord(data, dPos);
            if (!r) return null;
            let dp = dPos + r.consumed;
            // 0x51470 reads something — likely a variant/any value
            const r2 = readVariant(data, dp);
            if (!r2) return null;
            dp += r2.consumed;
            return { opcPos: oPos, dPos: dp };
        }

        case 18: { // nested_loop — 2 inline bytes [stride, max_count], read_int, loop with reset
            const inlineBase = OPCODE_BASE + oPos;
            if (inlineBase + 1 >= code.length) return null;
            const stride = code[inlineBase];
            const maxCount = code[inlineBase + 1];
            oPos += 2;

            const r = readInt(data, dPos);
            if (!r) return null;
            const count = r.value;
            if (count !== maxCount) return null;  // firmware checks exact match!
            let dp = dPos + r.consumed;

            const childStartOpc = oPos;
            let childEndOpc = null;
            for (let i = 0; i < count; i++) {
                // RESET opcode position for each iteration
                const child = execute(childStartOpc, data, dp, depth + 1);
                if (!child) return null;
                if (childEndOpc === null) childEndOpc = child.opcPos;
                dp = child.dPos;
            }
            if (count === 0) {
                const skip = skipOpcodeTree(childStartOpc);
                if (skip === null) return null;
                childEndOpc = skip;
            }
            return { opcPos: childEndOpc, dPos: dp };
        }

        case 19: { // nested_stride — 3 inline [initial_off, stride, max_count], read_int, loop with reset
            const inlineBase = OPCODE_BASE + oPos;
            if (inlineBase + 2 >= code.length) return null;
            const initialOff = code[inlineBase];
            const stride = code[inlineBase + 1];
            const maxCount = code[inlineBase + 2];
            oPos += 3;

            const r = readInt(data, dPos);
            if (!r) return null;
            const count = r.value;
            if (count > maxCount) return null;
            let dp = dPos + r.consumed;

            const childStartOpc = oPos;
            let childEndOpc = null;
            for (let i = 0; i < count; i++) {
                const child = execute(childStartOpc, data, dp, depth + 1);
                if (!child) return null;
                if (childEndOpc === null) childEndOpc = child.opcPos;
                dp = child.dPos;
            }
            if (count === 0) {
                const skip = skipOpcodeTree(childStartOpc);
                if (skip === null) return null;
                childEndOpc = skip;
            }
            return { opcPos: childEndOpc, dPos: dp };
        }

        case 20: { // bricknet_send — 2 inline bytes, read_int (must=2) + read_u32, complex loop
            const inlineBase = OPCODE_BASE + oPos;
            if (inlineBase + 1 >= code.length) return null;
            const loopCount = code[inlineBase];  // inline byte 1
            const outAdvance = code[inlineBase + 1];  // inline byte 2
            oPos += 2;

            const ri = readInt(data, dPos);
            if (!ri) return null;
            if (ri.value !== 2) return null;
            let dp = dPos + ri.consumed;

            const ru = readUnsigned(data, dp);
            if (!ru) return null;
            dp += ru.consumed;

            // The handler does complex loop with bricknet calls.
            // For matching purposes: it advances opcode position by loopCount,
            // and executes one child opcode per loop iteration.
            // The child opcode position is set to current + loopCount.
            oPos += loopCount;  // skip past inline data

            // Execute loopCount iterations of child
            const childStartOpc = oPos;
            let childEndOpc = null;
            for (let i = 0; i < loopCount; i++) {
                if (i === 0) {
                    // First iteration: execute child opcode
                    const child = execute(childStartOpc, data, dp, depth + 1);
                    if (!child) return null;
                    childEndOpc = child.opcPos;
                    dp = child.dPos;
                } else {
                    // Subsequent iterations: bricknet send (no data consumed)
                    // Actually they DO consume data via the executor
                    const child = execute(childStartOpc, data, dp, depth + 1);
                    if (!child) return null;
                    dp = child.dPos;
                }
            }
            if (loopCount === 0) {
                childEndOpc = childStartOpc;
            }
            return { opcPos: childEndOpc || childStartOpc, dPos: dp };
        }

        case 21: { // eval_advance — 1 inline byte (output advance), read_C0 from data
            // Position +2 (1 inline byte)
            if (OPCODE_BASE + oPos >= code.length) return null;
            oPos += 1;
            const r = readC0(data, dPos);
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        case 22: { // literal_u8 — 1 inline byte, recursive child
            if (OPCODE_BASE + oPos >= code.length) return null;
            oPos += 1;
            const child = execute(oPos, data, dPos, depth + 1);
            if (!child) return null;
            return { opcPos: child.opcPos, dPos: child.dPos };
        }

        case 23: { // literal_u16 — 2 inline bytes, recursive child
            if (OPCODE_BASE + oPos + 1 >= code.length) return null;
            oPos += 2;
            const child = execute(oPos, data, dPos, depth + 1);
            if (!child) return null;
            return { opcPos: child.opcPos, dPos: child.dPos };
        }

        case 24: { // type_dispatch — 1 inline type byte, dispatches to reader
            if (OPCODE_BASE + oPos >= code.length) return null;
            const typeByte = code[OPCODE_BASE + oPos];
            oPos += 1;

            let r;
            if (typeByte === 1) r = readC0(data, dPos);
            else if (typeByte === 2) r = readBool(data, dPos);
            else if (typeByte === 4) r = readUnsigned(data, dPos);
            else if (typeByte === 8) r = readUnsigned(data, dPos);
            else if (typeByte > 128) {
                // Type > 128: special handling — might read signed or variant
                r = readVariant(data, dPos);
            }
            else return null;
            if (!r) return null;
            return { opcPos: oPos, dPos: dPos + r.consumed };
        }

        default:
            return null;
    }
}

/**
 * Skip past an opcode tree without consuming data. Used when loop count is 0
 * but we still need to advance the opcode position past the child structure.
 */
function skipOpcodeTree(opcPos) {
    const absOpc = OPCODE_BASE + opcPos;
    if (absOpc >= code.length) return null;
    const handler = code[absOpc] - 1;
    if (handler < 0 || handler > 24) return null;

    let oPos = opcPos + 1;

    // Leaf handlers: just skip past the handler byte
    if (handler <= 10) return oPos;

    switch (handler) {
        case 12: return skipOpcodeTree(oPos);  // if_then: skip 1 child
        case 13: {  // if_else: skip inline byte + 2 children
            oPos += 1;
            const c1 = skipOpcodeTree(oPos);
            if (c1 === null) return null;
            return skipOpcodeTree(c1);
        }
        case 14: {  // counted_loop: 3 inline + 1 child
            oPos += 3;
            return skipOpcodeTree(oPos);
        }
        case 15: return oPos + 2;  // range_check: 2 inline, no children
        case 16: return oPos + 2;  // range_word: 2 inline
        case 17: return oPos + 2;  // exact_match: 2 inline
        case 18: {  // nested_loop: 2 inline + 1 child
            oPos += 2;
            return skipOpcodeTree(oPos);
        }
        case 19: {  // nested_stride: 3 inline + 1 child
            oPos += 3;
            return skipOpcodeTree(oPos);
        }
        case 20: {  // bricknet: 2 inline + dynamic + 1 child
            const loopCount = code[OPCODE_BASE + oPos];
            oPos += 2 + loopCount;
            return skipOpcodeTree(oPos);
        }
        case 21: return oPos + 1;  // eval_advance: 1 inline
        case 22: {  // literal_u8: 1 inline + 1 child
            oPos += 1;
            return skipOpcodeTree(oPos);
        }
        case 23: {  // literal_u16: 2 inline + 1 child
            oPos += 2;
            return skipOpcodeTree(oPos);
        }
        case 24: return oPos + 1;  // type_dispatch: 1 inline
        default: return null;
    }
}

/**
 * Execute a full script starting from opcPos.
 * The executor loops at the top level until it hits a terminator.
 */
function tryScript(opcPos, data) {
    let dp = 0;
    let oPos = opcPos;
    let steps = 0;

    while (dp < data.length && steps < 5000) {
        const absOpc = OPCODE_BASE + oPos;
        if (absOpc >= code.length) return null;
        const b = code[absOpc];
        if (b === 0 || b > 25) break;  // terminator

        const result = execute(oPos, data, dp, 0);
        if (!result) return null;
        oPos = result.opcPos;
        dp = result.dPos;
        steps++;
    }

    if (dp === data.length) return { opcEnd: oPos, steps };
    return null;
}

// === Main matching loop ===
console.log("Matching scripts to opcode positions...\n");

const results = [];
for (let si = 0; si < scripts.length; si++) {
    const s = scripts[si];
    const matches = [];

    for (const pos of positions) {
        const r = tryScript(pos, s.data);
        if (r) {
            matches.push({ pos, opcEnd: r.opcEnd, steps: r.steps });
        }
    }

    const label = `Script ${si.toString().padStart(2)}: ${s.typeName.padEnd(9)} param=${s.param.toString().padStart(4)}  data=${s.data.length.toString().padStart(4)}B`;

    if (matches.length === 0) {
        console.log(`${label}  NO MATCH`);
    } else if (matches.length === 1) {
        const m = matches[0];
        const lkEntries = lookupEntries.filter(e => e.pos === m.pos);
        console.log(`${label}  pos=${m.pos.toString().padStart(5)}  opcEnd=${m.opcEnd.toString().padStart(5)}  steps=${m.steps.toString().padStart(3)}  (${lkEntries.length} lookup entries)`);
    } else {
        console.log(`${label}  MULTIPLE (${matches.length}):`);
        for (const m of matches) {
            console.log(`    pos=${m.pos.toString().padStart(5)}  opcEnd=${m.opcEnd.toString().padStart(5)}  steps=${m.steps.toString().padStart(3)}`);
        }
    }

    results.push({ si, matches });
}

// Summary
const matched = results.filter(r => r.matches.length > 0);
const multi = results.filter(r => r.matches.length > 1);
console.log(`\n--- Summary ---`);
console.log(`Matched:   ${matched.length} / ${scripts.length}`);
console.log(`Multiple:  ${multi.length}`);

// Show partial matches for unmatched
if (matched.length < scripts.length) {
    console.log(`\n--- Partial match analysis (unmatched scripts) ---`);
    const unmatched = results.filter(r => r.matches.length === 0);
    for (const r of unmatched.slice(0, 5)) {
        const s = scripts[r.si];
        // Try each position and report how far it got
        let bestPos = -1, bestConsumed = 0, bestSteps = 0;
        for (const pos of positions) {
            let dp = 0, oPos = pos, steps = 0;
            while (dp < s.data.length && steps < 5000) {
                const absOpc = OPCODE_BASE + oPos;
                if (absOpc >= code.length) break;
                const b = code[absOpc];
                if (b === 0 || b > 25) break;
                const result = execute(oPos, s.data, dp, 0);
                if (!result) break;
                oPos = result.opcPos;
                dp = result.dPos;
                steps++;
            }
            if (dp > bestConsumed) {
                bestPos = pos;
                bestConsumed = dp;
                bestSteps = steps;
            }
        }
        const pct = (bestConsumed / s.data.length * 100).toFixed(1);
        console.log(`  Script ${r.si}: best pos=${bestPos} consumed ${bestConsumed}/${s.data.length} (${pct}%) in ${bestSteps} steps`);
    }
}
