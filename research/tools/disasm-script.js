#!/usr/bin/env node

/**
 * Disassembler for play.bin PPL scripts.
 *
 * Uses the 256-byte translation table from firmware ROM at 0x75CF4
 * and handler byte-consumption patterns traced from the executor at 0x4B830.
 *
 * Usage:
 *   node examples/disasm-script.js <play.bin> [script_index]
 *   node examples/disasm-script.js <script.bin>
 *   node examples/disasm-script.js --all <play.bin> [output_dir]
 */

const fs = require("fs");
const path = require("path");

// --- Load translation table from firmware ---
const FW_PATH = path.join(__dirname, "../randomfiles/firmware/smartbrick_v0.72.1_code.bin");
let TRANSLATE;
try {
    const fw = fs.readFileSync(FW_PATH);
    TRANSLATE = fw.slice(0x75CF4, 0x75CF4 + 256);
} catch (e) {
    console.error("Cannot load firmware for translation table:", e.message);
    process.exit(1);
}

const HANDLER_NAMES = {
    0: "cond_exec",
    1: "eval_expr",
    2: "write_u8",
    3: "write_u16",
    4: "write_u32",
    5: "write_float",
    6: "write_typed_u8",
    7: "write_typed_u16",
    8: "write_typed_u32",
    9: "write_typed_u64",
    10: "write_typed_float",
    11: "NOP",
    12: "if_then",
    13: "if_then_else",
    14: "counted_loop",
    15: "range_check",
    16: "range_signed",
    17: "eq_check",
    18: "nested_loop",
    19: "nested_stride",
    20: "bricknet_send",
    21: "cond_skip",
    22: "recurse",
    23: "recurse16",
    24: "type_dispatch",
};

const TYPE_NAMES = {
    0x03: "identity", 0x06: "item", 0x09: "npm",
    0x0B: "system", 0x0E: "timer", 0x10: "button",
};

class Disassembler {
    constructor(data, startOffset = 12) {
        this.data = data;
        this.pos = startOffset; // skip 8-byte header + 4-byte sub-header
        this.output = [];
        this.indent = 0;
        this.writeOffset = 0; // tracks output buffer position
    }

    byte(off) {
        if (off === undefined) off = this.pos;
        return off < this.data.length ? this.data[off] : 0;
    }

    readByte() {
        return this.data[this.pos++];
    }

    peekByte() {
        return this.data[this.pos];
    }

    emit(str) {
        this.output.push("  ".repeat(this.indent) + str);
    }

    // Variable-length value decoder
    readValue() {
        const startPos = this.pos;
        const b = this.readByte();

        if (b === 0xDC) {
            // 3 bytes: DC + u16 big-endian
            const hi = this.readByte();
            const lo = this.readByte();
            const val = (hi << 8) | lo;
            return { type: "u16", value: val, bytes: this.pos - startPos };
        }
        if (b === 0xDD) {
            // 5 bytes: DD + u32
            const b0 = this.readByte();
            const b1 = this.readByte();
            const b2 = this.readByte();
            const b3 = this.readByte();
            const val = ((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) >>> 0;
            return { type: "u32", value: val, bytes: this.pos - startPos };
        }
        if (b === 0xDE) {
            // 9 bytes: DE + f64/u64
            const bytes = [];
            for (let i = 0; i < 8; i++) bytes.push(this.readByte());
            const buf = Buffer.from(bytes);
            const val = buf.readDoubleBE(0);
            return { type: "f64", value: val, bytes: this.pos - startPos };
        }
        if (b === 0xE0) {
            return { type: "marker", value: "E0", bytes: 1 };
        }
        if (b === 0xE1) {
            return { type: "end", value: "E1", bytes: 1 };
        }
        if (b === 0xC0) {
            return { type: "true", value: 1, bytes: 1 };
        }
        if (b >= 0xC1 && b <= 0xCF) {
            return { type: "const", value: b, bytes: 1 };
        }

        // Default: single byte value
        return { type: "byte", value: b, bytes: 1 };
    }

    formatValue(v) {
        if (v.type === "u16") return `${v.value} (0x${v.value.toString(16)})`;
        if (v.type === "u32") return `0x${v.value.toString(16).padStart(8, "0")}`;
        if (v.type === "f64") return `${v.value.toFixed(4)}`;
        if (v.type === "marker" || v.type === "end") return v.value;
        if (v.type === "true") return "TRUE";
        if (v.type === "const") return `0x${v.value.toString(16)}`;
        return `${v.value} (0x${v.value.toString(16)})`;
    }

    // Decode one instruction, return false if stream ended
    decodeOne() {
        if (this.pos >= this.data.length) return false;

        const instrPos = this.pos;
        const b = this.readByte();
        const tableVal = TRANSLATE[b];

        if (tableVal === 0) {
            // Data byte — shouldn't be reached as instruction
            this.emit(`[${instrPos.toString(16).padStart(4, "0")}] DATA 0x${b.toString(16).padStart(2, "0")}`);
            return true;
        }

        const handler = tableVal - 1;
        if (handler > 24) {
            // Operand byte — shouldn't be reached as instruction
            this.emit(`[${instrPos.toString(16).padStart(4, "0")}] OPERAND 0x${b.toString(16).padStart(2, "0")} (table=${tableVal})`);
            return true;
        }

        const name = HANDLER_NAMES[handler] || `handler_${handler}`;
        const prefix = `[${instrPos.toString(16).padStart(4, "0")}]`;

        switch (handler) {
            case 0: { // cond_exec
                const v = this.readValue();
                this.emit(`${prefix} cond_exec ${this.formatValue(v)}`);
                break;
            }

            case 1: { // eval_expr
                const v = this.readValue();
                this.emit(`${prefix} eval_expr ${this.formatValue(v)}`);
                break;
            }

            case 2: case 3: case 4: case 5:
            case 6: case 7: case 8: case 9: case 10: {
                // write_* handlers
                const v = this.readValue();
                this.emit(`${prefix} ${name} ${this.formatValue(v)}  @out+${this.writeOffset}`);
                break;
            }

            case 11: { // NOP/SKIP
                this.emit(`${prefix} NOP`);
                break;
            }

            case 12: { // if_then
                const cond = this.readValue();
                this.emit(`${prefix} if_then ${this.formatValue(cond)} {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`}`);
                break;
            }

            case 13: { // if_then_else
                const cond = this.readValue();
                const elseOffset = this.readByte();
                this.emit(`${prefix} if_then_else ${this.formatValue(cond)} else_skip=${elseOffset} {`);
                this.indent++;
                // Then block: decode elseOffset bytes
                const thenEnd = this.pos + elseOffset;
                while (this.pos < thenEnd && this.pos < this.data.length) {
                    if (!this.decodeOne()) break;
                }
                this.indent--;
                this.emit(`} else {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`}`);
                break;
            }

            case 14: { // counted_loop
                const count = this.readByte();
                const tableHi = this.readByte();
                const tableLo = this.readByte();
                const tableIdx = (tableHi << 8) | tableLo;
                const cond = this.readValue();
                this.emit(`${prefix} counted_loop count=${count} table=0x${tableIdx.toString(16)} cond=${this.formatValue(cond)} {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`} × ${count}`);
                break;
            }

            case 15: { // range_check
                const limHi = this.readByte();
                const limLo = this.readByte();
                const v = this.readValue();
                this.emit(`${prefix} range_check limit=${(limHi << 8) | limLo} val=${this.formatValue(v)}`);
                break;
            }

            case 16: { // range_signed
                const limHi = this.readByte();
                const limLo = this.readByte();
                const v = this.readValue();
                this.emit(`${prefix} range_signed limit=${(limHi << 8) | limLo} val=${this.formatValue(v)}`);
                break;
            }

            case 17: { // eq_check
                const expHi = this.readByte();
                const expLo = this.readByte();
                const v = this.readValue();
                this.emit(`${prefix} eq_check expect=${(expHi << 8) | expLo} val=${this.formatValue(v)}`);
                break;
            }

            case 18: { // nested_loop
                const stride = this.readByte();
                const count = this.readByte();
                const cond = this.readValue();
                this.emit(`${prefix} nested_loop stride=${stride} count=${count} cond=${this.formatValue(cond)} {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`} × ${count}`);
                break;
            }

            case 19: { // nested_stride
                const offset = this.readByte();
                const stride = this.readByte();
                const count = this.readByte();
                const cond = this.readValue();
                this.emit(`${prefix} nested_stride offset=${offset} stride=${stride} count=${count} cond=${this.formatValue(cond)} {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`} × ${count}`);
                break;
            }

            case 20: { // bricknet_send
                const advance = this.readByte();
                const outOffset = this.readByte();
                const cond = this.readValue();
                const target = this.readValue();
                this.emit(`${prefix} BRICKNET_SEND advance=${advance} out=${outOffset} cond=${this.formatValue(cond)} target=${this.formatValue(target)} {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`}`);
                break;
            }

            case 21: { // cond_skip
                const skipLen = this.readByte();
                this.emit(`${prefix} cond_skip skip=${skipLen}`);
                break;
            }

            case 22: { // recurse
                const count = this.readByte();
                this.emit(`${prefix} recurse count=${count} {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`}`);
                break;
            }

            case 23: { // recurse16
                const lo = this.readByte();
                const hi = this.readByte();
                const count = (hi << 8) | lo;
                this.emit(`${prefix} recurse16 count=${count} {`);
                this.indent++;
                this.decodeBlock();
                this.indent--;
                this.emit(`}`);
                break;
            }

            case 24: { // type_dispatch
                const typeSel = this.readByte();
                const v = this.readValue();
                this.emit(`${prefix} type_dispatch type=${typeSel} val=${this.formatValue(v)}`);
                break;
            }

            default:
                this.emit(`${prefix} UNKNOWN handler=${handler} byte=0x${b.toString(16)}`);
                break;
        }

        return true;
    }

    // Decode instructions until end of data or a natural break
    decodeBlock() {
        // In recursive calls, we decode one "unit" of the block
        // For simplicity, decode one instruction (the recursive handlers
        // handle their own child blocks)
        if (this.pos < this.data.length) {
            this.decodeOne();
        }
    }

    // Decode entire script
    decodeAll() {
        // Parse header
        if (this.data.length < 12) {
            this.emit("Script too short");
            return this.output;
        }
        const size = this.data.readUInt16LE(0);
        const childCount = this.data[10];
        const flags = this.data[11];
        this.emit(`; size=${size} children=${childCount} flags=0x${flags.toString(16).padStart(2, "0")}`);
        this.emit("");

        this.pos = 12;
        let safety = 0;
        while (this.pos < this.data.length && safety < 2000) {
            if (!this.decodeOne()) break;
            safety++;
        }
        if (safety >= 2000) {
            this.emit("; WARNING: decode limit reached");
        }

        return this.output;
    }
}

// --- PPL Parser ---
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
        scripts.push({
            index: i, type, param, offset: off, size: sz,
            typeName: TYPE_NAMES[type] || `unk_0x${type.toString(16)}`,
            data: buf.slice(off, off + sz),
        });
    }
    return scripts;
}

function disasmScript(script) {
    const d = new Disassembler(script.data);
    const lines = d.decodeAll();
    const header = `; Script #${script.index} — ${script.typeName} (type=0x${script.type.toString(16)}, param=${script.param}, ${script.size} bytes)`;
    return [header, ...lines].join("\n");
}

function main() {
    const args = process.argv.slice(2);

    if (args[0] === "--all" && args.length >= 2) {
        const pplBuf = fs.readFileSync(args[1]);
        const outDir = args[2] || "disasm";
        fs.mkdirSync(outDir, { recursive: true });

        const scripts = parsePPL(pplBuf);
        for (const s of scripts) {
            const text = disasmScript(s);
            const fname = `script_${String(s.index).padStart(2, "0")}_${s.typeName}_param${s.param}.asm`;
            fs.writeFileSync(path.join(outDir, fname), text + "\n");
            const lineCount = text.split("\n").length;
            console.log(`  #${String(s.index).padStart(2)} ${s.typeName.padEnd(8)} ${String(s.size).padStart(5)}B → ${fname} (${lineCount} lines)`);
        }
        console.log(`\nDisassembled ${scripts.length} scripts → ${outDir}/`);
    } else if (args.length >= 1) {
        const inputPath = args[0];
        const buf = fs.readFileSync(inputPath);

        // Check if this is a play.bin or a single script
        if (buf.toString("ascii", 0, 4) === "\x7FPPL") {
            const scripts = parsePPL(buf);
            const idx = args[1] !== undefined ? parseInt(args[1]) : 0;
            if (idx < 0 || idx >= scripts.length) {
                console.error(`Script index ${idx} out of range (0-${scripts.length - 1})`);
                process.exit(1);
            }
            console.log(disasmScript(scripts[idx]));
        } else {
            // Raw script binary
            const d = new Disassembler(buf);
            console.log(d.decodeAll().join("\n"));
        }
    } else {
        console.error("Usage:");
        console.error("  node disasm-script.js <play.bin> [script_index]");
        console.error("  node disasm-script.js <script.bin>");
        console.error("  node disasm-script.js --all <play.bin> [output_dir]");
        process.exit(1);
    }
}

main();
