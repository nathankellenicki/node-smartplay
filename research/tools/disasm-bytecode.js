#!/usr/bin/env node
/**
 * PPL Bytecode Disassembler v4
 *
 * Interpreter at firmware 0x4B830 processes ONE opcode per call. It reads the
 * current bytecode byte at [r19+pos] where r19=0x37BCF4, and looks up the
 * opcode via the byte value. If the lookup yields a value outside 1-25,
 * the interpreter returns 0 (treated as block terminator by callers).
 *
 * Variable-length opcodes (1-14) advance the bytecode position by exactly 1
 * byte (just the opcode byte itself). Their operand values come from a
 * SEPARATE r18 data stream (not from bytecode). So in bytecode, variable
 * opcodes occupy exactly 1 byte.
 *
 * Fixed opcodes (15-25) advance by N bytes (opcode + N-1 operand bytes in
 * bytecode) per handler prologues. Some (15, 19, 20, 21, 13, 14) then
 * recursively invoke the interpreter to execute a nested body of N' opcodes,
 * where N' is determined by the opcode-specific count argument.
 *
 * This disassembler does NOT track recursive body execution — it just walks
 * bytecode linearly and reports opcodes. Nested-block structure is visible
 * through the fixed-length opcodes' operand bytes and the terminators that
 * end each block.
 */

const fs = require("fs");

const FW = "research/firmware_files/smartbrick_v0.72.1_code.bin";
const PLAY = "research/firmware_files/play.bin";
const TABLE_OFFSET = 0x75CF4;

const fw = fs.readFileSync(FW);
const play = fs.readFileSync(PLAY);
const TABLE = fw.slice(TABLE_OFFSET, TABLE_OFFSET + 256);

// Bytecode span in bytes (opcode byte + fixed operand bytes), from handler prologues.
// Variable opcodes 1-14 = 1 byte (dispatch loop's implicit +1).
// Fixed opcodes (15-25) advance additional bytes via `st r0, [r16]` with `add r0, r1, N`.
const OPCODE_INFO = {
    1:  { name: "cond_exec",      span: 1 },
    2:  { name: "eval_expr",      span: 1 },
    3:  { name: "write_byte",     span: 1 },
    4:  { name: "write_half",     span: 1 },
    5:  { name: "write_word",     span: 1 },
    6:  { name: "write_float",    span: 1 },
    7:  { name: "write_typed",    span: 1 },
    8:  { name: "write_typed2",   span: 1 },
    9:  { name: "write_op9",      span: 1 },
    10: { name: "write_op10",     span: 1 },
    11: { name: "write_op11",     span: 1 },
    12: { name: "op12_error",     span: 1 },
    13: { name: "if_then",        span: 1 },   // recursive body follows
    14: { name: "if_then_else",   span: 1 },   // recursive body follows
    15: { name: "counted_loop",   span: 4 },   // + recursive body of count opcodes
    16: { name: "op16",           span: 3 },
    17: { name: "op17",           span: 3 },
    18: { name: "op18",           span: 3 },
    19: { name: "nested_loop",    span: 3 },   // + recursive body
    20: { name: "nested_stride",  span: 4 },   // + recursive body
    21: { name: "bricknet_send",  span: 3 },   // + recursive body
    22: { name: "op22",           span: 2 },
    23: { name: "op23",           span: 2 },
    24: { name: "op24",           span: 3 },
    25: { name: "type_dispatch",  span: 2 },
};

// Opcodes that (per firmware handler) recursively invoke the interpreter
// to execute a nested body. The body is NOT part of the opcode's fixed span —
// it's a sequence of opcodes that follows in bytecode and terminates at the
// first byte with TABLE value outside 1-25.
const BLOCK_OPCODES = new Set([13, 14, 15, 19, 20, 21]);

function hex(b, w = 2) { return b.toString(16).padStart(w, "0"); }

// Build encoding index for each opcode (which byte values map to it).
const byOpcode = {};
for (let b = 0; b < 256; b++) {
    const op = TABLE[b];
    if (!byOpcode[op]) byOpcode[op] = [];
    byOpcode[op].push(b);
}

function parseScripts(buf) {
    const scripts = [];
    const presets = [];
    for (let i = 0; i < 61; i++) {
        const off = 0x10 + i * 8;
        presets.push({ type: buf.readUInt32LE(off), param: buf.readUInt32LE(off + 4) });
    }
    for (let i = 0; i < 58; i++) {
        const off = 0x1F8 + i * 8;
        const scriptOff = buf.readUInt32LE(off);
        const scriptSize = buf.readUInt32LE(off + 4);
        const preset = presets[i + 3];
        scripts.push({
            idx: i, type: preset.type, param: preset.param,
            offset: scriptOff, size: scriptSize,
            content: buf.slice(scriptOff, scriptOff + scriptSize),
        });
    }
    return scripts;
}

function disassembleScript(s) {
    const buf = s.content;
    const typeNames = { 0x03: "id", 0x06: "item", 0x09: "npm", 0x0B: "sys", 0x0E: "timer", 0x10: "btn" };
    const tn = typeNames[s.type] || hex(s.type);

    const output = [];
    output.push(`# Script #${s.idx} — type=${tn} (0x${hex(s.type)}) param=${s.param} size=${s.size}`);

    const sizeField = (buf[0] << 8) | buf[1];
    output.push(`  header[0..7]: ${Array.from(buf.slice(0, 8)).map(b => hex(b)).join(" ")}   # size=${sizeField}`);

    const childCount = buf[10];
    const flags = buf[11];
    output.push(`  subhdr[8..11]: ${Array.from(buf.slice(8, 12)).map(b => hex(b)).join(" ")}   # child_count=${childCount}, flags=0x${hex(flags)}`);

    output.push(`  body:`);

    // Walk bytecode linearly, tracking nesting depth for readability.
    // Each block opcode increases depth; each terminator (TABLE outside 1-25)
    // decreases it. This is a visual approximation of block nesting, not an
    // execution trace.
    let pos = 12;
    let depth = 0;
    let terminators = 0;
    let unknowns = 0;

    while (pos < buf.length) {
        const byte = buf[pos];
        const op = TABLE[byte];
        const indent = "  ".repeat(depth);

        if (op < 1 || op > 25) {
            // Block terminator — byte at opcode position with invalid table value.
            // In firmware: dispatch sees this, returns 0 to caller (block ends).
            output.push(`    0x${hex(pos, 3)}: ${indent}— term byte=0x${hex(byte)} table=0x${hex(op)}`);
            terminators++;
            if (depth > 0) depth--;
            pos++;
            continue;
        }

        const meta = OPCODE_INFO[op];
        if (!meta) {
            output.push(`    0x${hex(pos, 3)}: ${indent}?? byte=0x${hex(byte)} table=0x${hex(op)}`);
            unknowns++;
            pos++;
            continue;
        }

        const span = Math.min(meta.span, buf.length - pos);
        const bytes = [];
        for (let i = 0; i < span; i++) bytes.push(buf[pos + i]);

        let line = `    0x${hex(pos, 3)}: ${indent}${meta.name.padEnd(14)}`;

        if (op >= 1 && op <= 14) {
            const encodings = byOpcode[op].sort((a, b) => a - b);
            const opIdx = encodings.indexOf(byte);
            line += ` enc#${opIdx}/${encodings.length - 1}`;
        }

        line += `   bytes=[${bytes.map(b => "0x" + hex(b)).join(" ")}]`;

        if (op === 15 && bytes.length >= 4) {
            const count = bytes[1];
            const strideOff = bytes[2] | (bytes[3] << 8);
            line += ` count=${count} stride_off=0x${hex(strideOff, 4)}`;
        }
        if (op === 20 && bytes.length >= 4) {
            line += ` (operands)`;
        }
        if (op === 24 && bytes.length >= 3) {
            const val = bytes[1] | (bytes[2] << 8);
            line += ` (u16=${val})`;
        }
        if (op === 25 && bytes.length >= 2) {
            line += ` (type=0x${hex(bytes[1])})`;
        }

        output.push(line);

        if (BLOCK_OPCODES.has(op)) depth++;

        pos += span;
    }

    output.push(`  # stats: ${terminators} terminator(s), ${unknowns} unknown, final depth=${depth}`);
    return output.join("\n");
}

const scripts = parseScripts(play);

const target = process.argv[2];
if (target === "--all") {
    for (let i = 0; i < scripts.length; i++) {
        console.log(disassembleScript(scripts[i]));
        console.log();
    }
} else if (target) {
    const idx = parseInt(target);
    if (scripts[idx]) {
        console.log(disassembleScript(scripts[idx]));
    } else {
        console.error(`No script #${idx}`);
    }
} else {
    for (const idx of [33, 3, 17, 42]) {
        console.log(disassembleScript(scripts[idx]));
        console.log();
    }
}
