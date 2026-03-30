#!/usr/bin/env node

/**
 * Match play.bin scripts to opcode positions via faithful executor simulation.
 *
 * The executor at 0x4b830 takes: data_ctx, end_ptr, output_ptr, position_ptr
 * It reads ONE opcode from ROM[0x37BCF4 + *position_ptr], advances position,
 * and dispatches. Write handlers consume one value from data and return.
 * Control handlers recurse with the same position_ptr.
 *
 * Key: position_ptr is passed BY REFERENCE. Recursive calls modify it.
 * counted_loop: position advances across iterations (sequential body)
 * nested_loop/stride: position RESETS per iteration (repeated body)
 */

const fs = require("fs");
const path = require("path");

const FW_PATH = path.join(__dirname, "../randomfiles/firmware/smartbrick_v0.72.1_code.bin");
const PLAY_PATH = path.join(__dirname, "../randomfiles/firmware/play.bin");

const fw = fs.readFileSync(FW_PATH);
const playBin = fs.readFileSync(PLAY_PATH);

const OPCODE_BASE = 0x75CF4;
const LOOKUP_BASE = 0x747A8;
const STRIDE_BASE = 0x75A00;

// --- Decoder (firmware 0x51e24) ---
function decode(b) {
    if (b < 0x80) return 0;
    if (b <= 0x8F) return 0x80;
    if (b <= 0x9F) return 0x90;
    if (b <= 0xBF) return 0xA0;
    if (b <= 0xDF) return b;
    return 0xE0;
}

// --- Class function (firmware 0x51e68) ---
function classify(decoded) {
    if (decoded === 0) return 3;
    if (decoded === 0x80) return 9;
    if (decoded === 0x90) return 8;
    if (decoded === 0xA0) return 6;
    if (decoded === 0xE0) return 4;
    const t = { 0xC0:1, 0xC1:3, 0xC2:2, 0xC3:2, 0xC4:7, 0xC5:7, 0xC6:7,
        0xC7:10, 0xC8:10, 0xC9:10, 0xCA:5, 0xCB:5,
        0xCC:3, 0xCD:3, 0xCE:3, 0xCF:3,
        0xD0:4, 0xD1:4, 0xD2:4, 0xD3:4,
        0xD4:10, 0xD5:10, 0xD6:10, 0xD7:10, 0xD8:10,
        0xD9:6, 0xDA:6, 0xDB:6, 0xDC:8, 0xDD:8, 0xDE:9, 0xDF:9 };
    return t[decoded] || 3;
}

// --- Readers: return bytes consumed, or -1 on error ---

function tryReadClass(data, pos, ...validClasses) {
    if (pos >= data.length) return -1;
    const b = data[pos];
    const d = decode(b);
    const cls = classify(d);
    if (!validClasses.includes(cls)) return -1;
    // Determine byte count based on raw byte
    if (d === 0) return 1;              // positive fixint
    if (d === 0x80) return 1;           // fixmap header
    if (d === 0x90) return 1;           // fixarray
    if (d === 0xA0) return 1;           // fixstr header (NOT including payload)
    if (d === 0xE0) return 1;           // negative fixint
    // Pass-through bytes:
    switch (b) {
        case 0xC0: return 1; case 0xC1: return 1;
        case 0xC2: return 1; case 0xC3: return 1;
        case 0xC4: return 2; case 0xC5: return 3; case 0xC6: return 5;
        case 0xC7: return 3; case 0xC8: return 4; case 0xC9: return 6;
        case 0xCA: return 5; case 0xCB: return 9;
        case 0xCC: return 2; case 0xCD: return 3; case 0xCE: return 5; case 0xCF: return 9;
        case 0xD0: return 2; case 0xD1: return 3; case 0xD2: return 5; case 0xD3: return 9;
        case 0xD4: return 2; case 0xD5: return 3; case 0xD6: return 5; case 0xD7: return 6; case 0xD8: return 10;
        case 0xD9: return 2; case 0xDA: return 3; case 0xDB: return 5;
        case 0xDC: return 3; case 0xDD: return 5;
        case 0xDE: return 3; case 0xDF: return 5;
    }
    return 1;
}

// read_int: class 8 only. Returns {consumed, value} or null
function readInt(data, pos) {
    if (pos >= data.length) return null;
    const b = data[pos];
    const d = decode(b);
    if (classify(d) !== 8) return null;
    if (d === 0x90) {
        // value = ((b << 1) + 0x38) & 0xFF
        return { consumed: 1, value: ((b << 1) + 0x38) & 0xFF };
    }
    if (d === 0xDC) {
        if (pos + 2 >= data.length) return null;
        // Read u16 BE (based on firmware's read at 51c8c → u16 from next 2 bytes)
        const val = (data[pos + 1] << 8) | data[pos + 2];
        return { consumed: 3, value: val };
    }
    if (d === 0xDD) {
        if (pos + 4 >= data.length) return null;
        const val = (data[pos + 1] << 24) | (data[pos + 2] << 16) | (data[pos + 3] << 8) | data[pos + 4];
        return { consumed: 5, value: val >>> 0 };
    }
    return null;
}

// read_C0: returns {consumed, isNil}
function readC0(data, pos) {
    if (pos >= data.length) return { consumed: -1, isNil: false };
    const d = decode(data[pos]);
    if (d === 0xC0) return { consumed: 1, isNil: true };
    return { consumed: 0, isNil: false }; // peek only, don't consume
}

// --- State passed by reference ---
class ExecState {
    constructor(data, dataPos, opcodePos) {
        this.data = data;
        this.dp = dataPos;
        this.op = opcodePos;
        this.steps = 0;
        this.maxSteps = 500;
        this.error = false;
    }
    readOpcode() { return fw[OPCODE_BASE + this.op]; }
    readOpcodeAt(off) { return fw[OPCODE_BASE + off]; }
}

// Execute one "frame" of the executor. Returns true on success, false on failure.
// Modifies state.dp and state.op in place.
function execOne(state, depth) {
    if (depth > 12 || state.steps > state.maxSteps || state.error) return false;
    state.steps++;

    const opByte = state.readOpcode();
    if (opByte === 0 || opByte > 25) {
        // Terminator or out-of-range → exit
        return opByte === 0 || opByte > 25; // success for NOP/terminator
    }

    state.op++; // advance past opcode byte

    switch (opByte) {
        case 1: { // cond_exec: read_C0
            const r = readC0(state.data, state.dp);
            if (r.consumed < 0) return false;
            state.dp += r.consumed;
            return true;
        }
        case 2: { // eval_bool: read bool, write to output
            const n = tryReadClass(state.data, state.dp, 2);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 3: { // wr_u8
            const n = tryReadClass(state.data, state.dp, 3);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 4: { // wr_u16
            const n = tryReadClass(state.data, state.dp, 3);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 5: { // wr_u32
            const n = tryReadClass(state.data, state.dp, 3);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 6: { // wr_u64
            const n = tryReadClass(state.data, state.dp, 3);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 7: { // wr_s8
            const n = tryReadClass(state.data, state.dp, 3, 4);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 8: { // wr_s16
            const n = tryReadClass(state.data, state.dp, 3, 4);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 9: { // wr_s32
            const n = tryReadClass(state.data, state.dp, 3, 4);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 10: { // wr_s64
            const n = tryReadClass(state.data, state.dp, 3, 4);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 11: { // wr_variant (read_variant at 0x51598)
            // Accept class 3 or 4 (unsigned or signed)
            const n = tryReadClass(state.data, state.dp, 3, 4);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 12: { // NOP/terminator
            return true;
        }
        case 13: { // if_then: read_int(count), recurse count times
            const r = readInt(state.data, state.dp);
            if (!r) return false;
            state.dp += r.consumed;
            if (r.value === 0) return true;
            // Recurse r.value times at current op position
            for (let i = 0; i < r.value && i < 20; i++) {
                if (!execOne(state, depth + 1)) return false;
            }
            return true;
        }
        case 14: { // if_else: read_int(count), 1 inline byte (else_skip)
            const r = readInt(state.data, state.dp);
            if (!r) return false;
            state.dp += r.consumed;
            const elseSkip = state.readOpcodeAt(state.op);
            state.op++; // past inline
            if (r.value < 2) return true;
            // THEN branch: recurse at current op
            const savedOp = state.op;
            if (!execOne(state, depth + 1)) return false;
            // ELSE branch: skip elseSkip bytes in opcode stream
            const elseOp = savedOp + elseSkip;
            // Read else opcode inline byte from the opcode stream
            state.op = elseOp;
            if (!execOne(state, depth + 1)) return false;
            return true;
        }
        case 15: { // counted_loop: read_int, 3 inline (loop_count, stride_hi, stride_lo)
            const r = readInt(state.data, state.dp);
            if (!r) return false;
            state.dp += r.consumed;
            const loopCount = state.readOpcodeAt(state.op);
            state.op += 3; // skip 3 inline bytes
            if (r.value < loopCount) return false; // data count < loop count = error
            // Recurse loopCount times (sequential: op advances each iteration)
            for (let i = 0; i < loopCount && i < 50; i++) {
                if (!execOne(state, depth + 1)) return false;
            }
            return true;
        }
        case 16: { // range_check: 2 inline bytes, read_range, read_word, write to output
            state.op += 2;
            // Calls 0x519e8 then 0x519c8 — both seem to be signed/word reads
            const n1 = readInt(state.data, state.dp);
            if (!n1) return false;
            state.dp += n1.consumed;
            // Then writes value + reads output
            const n2 = tryReadClass(state.data, state.dp, 3, 4, 7);
            if (n2 >= 0) state.dp += n2;
            return true;
        }
        case 17: { // range_signed: 2 inline bytes, read_word, write
            state.op += 2;
            const n1 = tryReadClass(state.data, state.dp, 7, 3, 4);
            if (n1 < 0) return false;
            state.dp += n1;
            const n2 = tryReadClass(state.data, state.dp, 7, 3, 4);
            if (n2 >= 0) state.dp += n2;
            return true;
        }
        case 18: { // eq_check: 2 inline bytes, read_word
            state.op += 2;
            const n = tryReadClass(state.data, state.dp, 7, 3, 4);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        case 19: { // nested_loop: 2 inline (stride, count), read_int, recurse with RESET
            const r = readInt(state.data, state.dp);
            if (!r) return false;
            state.dp += r.consumed;
            const loopCount = state.readOpcodeAt(state.op + 1);
            const savedOp = state.op + 2; // after 2 inline bytes
            state.op = savedOp;
            if (r.value < loopCount) return false;
            for (let i = 0; i < loopCount && i < 20; i++) {
                state.op = savedOp; // RESET position each iteration
                if (!execOne(state, depth + 1)) return false;
            }
            return true;
        }
        case 20: { // nested_stride: 3 inline (off, stride, count), read_int, recurse RESET
            const r = readInt(state.data, state.dp);
            if (!r) return false;
            state.dp += r.consumed;
            const loopCount = state.readOpcodeAt(state.op + 2);
            const savedOp = state.op + 3;
            state.op = savedOp;
            if (r.value < loopCount) return false;
            for (let i = 0; i < loopCount && i < 50; i++) {
                state.op = savedOp; // RESET
                if (!execOne(state, depth + 1)) return false;
            }
            return true;
        }
        case 21: { // bricknet: read_int, complex
            const r = readInt(state.data, state.dp);
            if (!r) return false;
            state.dp += r.consumed;
            // read u32 target
            const n2 = tryReadClass(state.data, state.dp, 3);
            if (n2 < 0) return false;
            state.dp += n2;
            // inline bytes + complex behavior, approximate
            const inlineByte1 = state.readOpcodeAt(state.op);
            const inlineByte2 = state.readOpcodeAt(state.op + 1);
            state.op += 2;
            // Loop: alternately recurse or call bricknet_send
            // Simplified: just recurse once
            if (!execOne(state, depth + 1)) return false;
            return true;
        }
        case 22: { // cond_advance: read_C0, if not nil: write+advance+loop
            const inlineStride = state.readOpcodeAt(state.op);
            state.op++; // past inline

            // Loop: check C0, process child, repeat
            for (let safety = 0; safety < 50; safety++) {
                const r = readC0(state.data, state.dp);
                if (r.consumed < 0) return false;
                if (r.isNil) {
                    state.dp += r.consumed;
                    return true; // done
                }
                // Not nil: process next opcode
                if (!execOne(state, depth + 1)) return false;
                // After child returns, loop back (handler 22 loops to dispatch)
                // But we need another C0 check... this means we need to re-check C0 for next child
            }
            return false; // loop limit
        }
        case 23: { // recurse: 1 inline byte = target position
            const targetPos = state.readOpcodeAt(state.op);
            state.op++;
            const savedOp = state.op;
            state.op = targetPos;
            const ok = execOne(state, depth + 1);
            state.op = savedOp; // restore op after recursive call? Actually no...
            // Actually: recurse calls executor with a NEW position pointer (sp+0)
            // The parent's position pointer is not affected
            return ok;
        }
        case 24: { // recurse16: 2 inline bytes = target position
            const hi = state.readOpcodeAt(state.op);
            const lo = state.readOpcodeAt(state.op + 1);
            const targetPos = (hi << 8) | lo;
            state.op += 2;
            const savedOp = state.op;
            state.op = targetPos;
            const ok = execOne(state, depth + 1);
            state.op = savedOp;
            return ok;
        }
        case 25: { // type_dispatch: 1 inline byte, read u8
            state.op++; // skip type byte
            const n = tryReadClass(state.data, state.dp, 3);
            if (n < 0) return false;
            state.dp += n;
            return true;
        }
        default:
            return false;
    }
}

// --- Parse PPL ---
function parsePPL(buf) {
    const numScripts = buf.readUInt16LE(0x0A);
    const presetOff = 0x10;
    const dirOff = presetOff + (3 + numScripts) * 8;
    const scripts = [];
    for (let i = 0; i < numScripts; i++) {
        const type = buf.readUInt32LE(presetOff + (i + 3) * 8);
        const param = buf.readUInt32LE(presetOff + (i + 3) * 8 + 4);
        const off = buf.readUInt32LE(dirOff + i * 8);
        const sz = buf.readUInt32LE(dirOff + i * 8 + 4);
        scripts.push({ index: i, type, param, offset: off, size: sz, data: buf.slice(off, off + sz) });
    }
    return scripts;
}

const TYPE_NAMES = { 0x03:"identity", 0x06:"item", 0x09:"npm", 0x0B:"system", 0x0E:"timer", 0x10:"button" };
const HANDLER_NAMES = {
    1:"cond_exec", 2:"eval_bool", 3:"wr_u8", 4:"wr_u16", 5:"wr_u32",
    6:"wr_u64", 7:"wr_s8", 8:"wr_s16", 9:"wr_s32", 10:"wr_s64",
    11:"wr_variant", 12:"NOP", 13:"if_then", 14:"if_else", 15:"counted_loop",
    16:"range_check", 17:"range_signed", 18:"eq_check", 19:"nested_loop",
    20:"nested_stride", 21:"bricknet", 22:"cond_advance", 23:"recurse",
    24:"recurse16", 25:"type_dispatch"
};

const scripts = parsePPL(playBin);

// Get all unique opcode positions
const positions = new Set();
for (let i = 0; i < 384; i++) {
    const off = LOOKUP_BASE + i * 12;
    const field4 = fw.readUInt32LE(off + 4);
    positions.add(field4 & 0x3FFF);
}
const posArray = [...positions].sort((a, b) => a - b);

console.log(`Scripts: ${scripts.length}, Opcode positions: ${posArray.length}`);
console.log("Running simulation...\n");

for (const script of scripts) {
    const scriptData = script.data;
    const childCount = scriptData.length >= 11 ? scriptData[10] : 0;
    const flags = scriptData.length >= 12 ? scriptData[11] : 0;
    const typeName = TYPE_NAMES[script.type] || `0x${script.type.toString(16)}`;

    const matches = [];

    for (let dataOffset = 12; dataOffset <= Math.min(scriptData.length - 2, 40); dataOffset++) {
        for (const pos of posArray) {
            const state = new ExecState(scriptData, dataOffset, pos);
            const ok = execOne(state, 0);
            if (ok && !state.error) {
                const consumed = state.dp - dataOffset;
                if (consumed >= 4) {
                    matches.push({
                        pos, dataOffset, consumed,
                        remaining: scriptData.length - state.dp,
                        steps: state.steps,
                        endOp: state.op,
                        firstByte: fw[OPCODE_BASE + pos]
                    });
                }
            }
        }
    }

    // Sort by consumed (descending), then by steps (descending)
    matches.sort((a, b) => b.consumed - a.consumed || b.steps - a.steps);

    const top = matches.slice(0, 5);
    const hdr = `#${String(script.index).padStart(2)} ${typeName.padEnd(8)} param=${String(script.param).padStart(5)} ${String(script.size).padStart(5)}B ch=${childCount} fl=0x${flags.toString(16).padStart(2,"0")}`;

    if (top.length > 0) {
        console.log(hdr);
        for (const m of top) {
            const hname = HANDLER_NAMES[m.firstByte] || `?${m.firstByte}`;
            const total = scriptData.length - m.dataOffset;
            const pct = ((m.consumed / total) * 100).toFixed(0);
            console.log(`    pos=${String(m.pos).padStart(5)} off=${String(m.dataOffset).padStart(2)} ate=${String(m.consumed).padStart(4)}/${total} (${pct.padStart(3)}%) steps=${m.steps} ${hname}`);
        }
    } else {
        console.log(`${hdr}  — NO MATCH`);
    }
}
