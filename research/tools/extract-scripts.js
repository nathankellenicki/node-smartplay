#!/usr/bin/env node

/**
 * Extract and decode play.bin scripts from the PPL (Play Preset Library).
 *
 * Usage:
 *   node examples/extract-scripts.js <play.bin> [output_dir]
 *
 * Output directory defaults to ./scripts/
 */

const fs = require("fs");
const path = require("path");

const TYPE_NAMES = {
    0x03: "identity",
    0x06: "item",
    0x09: "npm",
    0x0B: "system",
    0x0E: "timer",
    0x10: "button",
};

// 256-byte opcode translation table from firmware ROM at 0x75CF4
// We'll read it from the firmware binary if available, otherwise use extracted values
const OPCODE_NAMES = {
    1: "cond_exec",
    2: "eval_expr",
    3: "write_byte",
    4: "write_half",
    5: "write_word",
    6: "write_float",
    7: "write_typed",
    8: "write_typed2",
    9: "write_typed3",
    10: "write_typed4",
    11: "write_typed5",
    13: "if_then",
    14: "if_then_else",
    15: "counted_loop",
    16: "range_clamp",
    17: "range_signed",
    19: "nested_loop",
    20: "nested_stride",
    21: "bricknet_send",
    22: "unused_22",
    25: "type_dispatch",
};

function parsePPL(buf) {
    const magic = buf.toString("ascii", 0, 4);
    if (magic !== "\x7FPPL") {
        throw new Error(`Bad magic: expected \\x7FPPL, got ${JSON.stringify(magic)}`);
    }

    const version = buf.readUInt32LE(4);
    const numPresetTypes = buf.readUInt16LE(8);
    const numScripts = buf.readUInt16LE(0x0A);

    // Preset table at 0x10 — 3 preamble + numScripts entries
    const presetTableOff = 0x10;
    const preambleCount = 3;
    const presets = [];
    for (let i = 0; i < preambleCount + numScripts; i++) {
        const off = presetTableOff + i * 8;
        const type = buf.readUInt32LE(off);
        const param = buf.readUInt32LE(off + 4);
        presets.push({ type, param });
    }

    // Script directory follows preset table
    const dirOff = presetTableOff + (preambleCount + numScripts) * 8;
    const scripts = [];
    for (let i = 0; i < numScripts; i++) {
        const off = dirOff + i * 8;
        const scriptOff = buf.readUInt32LE(off);
        const scriptSize = buf.readUInt32LE(off + 4);
        const preset = presets[i + preambleCount];
        const data = buf.slice(scriptOff, scriptOff + scriptSize);
        scripts.push({
            index: i,
            offset: scriptOff,
            size: scriptSize,
            type: preset.type,
            typeName: TYPE_NAMES[preset.type] || `unk_0x${preset.type.toString(16)}`,
            param: preset.param,
            data,
        });
    }

    return { version, numPresetTypes, numScripts, scripts };
}

function analyzeScript(script) {
    const buf = script.data;
    if (buf.length < 12) return { childCount: 0, flags: 0, floats: [], shorts: [] };

    // Header: [size:2][01 04 00 01 02 03]
    // Sub-header: [00][10][child_count][flags]
    const childCount = buf[10];
    const flags = buf[11];

    // Scan for float32 values that look like audio/animation references
    // In the bytecode, audio clip IDs and animation bank refs appear as inline data
    const floats = [];
    const shorts = [];

    // Scan for recognizable inline values after the header
    for (let i = 12; i + 3 < buf.length; i++) {
        // Look for u16 values that could be audio clip IDs (0-330 range)
        const u16 = buf.readUInt16LE(i);
        if (u16 > 0 && u16 <= 500) {
            shorts.push({ offset: i, value: u16 });
        }

        // Look for float32 values
        if (i + 3 < buf.length) {
            const f = buf.readFloatLE(i);
            if (isFinite(f) && f > 0.01 && f < 100000 && f !== Math.floor(f)) {
                // Skip if it looks like a reasonable float (timing, frequency, etc.)
            }
        }
    }

    return { childCount, flags, shorts };
}

function hexDump(buf, maxBytes = 64) {
    const lines = [];
    const len = Math.min(buf.length, maxBytes);
    for (let i = 0; i < len; i += 16) {
        const hex = [];
        const ascii = [];
        for (let j = 0; j < 16 && i + j < len; j++) {
            const b = buf[i + j];
            hex.push(b.toString(16).padStart(2, "0"));
            ascii.push(b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".");
        }
        lines.push(`  ${(i).toString(16).padStart(4, "0")}: ${hex.join(" ").padEnd(48)} ${ascii.join("")}`);
    }
    if (buf.length > maxBytes) lines.push(`  ... (${buf.length - maxBytes} more bytes)`);
    return lines.join("\n");
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: node extract-scripts.js <play.bin> [output_dir]");
        process.exit(1);
    }

    const inputPath = args[0];
    const outputDir = args[1] || "scripts";

    const buf = fs.readFileSync(inputPath);
    console.log(`Reading ${inputPath} (${buf.length} bytes)`);

    const ppl = parsePPL(buf);
    console.log(`PPL v${ppl.version}: ${ppl.numPresetTypes} preset types, ${ppl.numScripts} scripts\n`);

    // Create output directories
    for (const typeName of Object.values(TYPE_NAMES)) {
        fs.mkdirSync(path.join(outputDir, typeName), { recursive: true });
    }

    // Extract each script
    const summary = {};
    for (const script of ppl.scripts) {
        const analysis = analyzeScript(script);
        const dir = path.join(outputDir, script.typeName);
        const basename = `script_${String(script.index).padStart(2, "0")}_${script.typeName}_param${script.param}`;

        // Write raw binary
        fs.writeFileSync(path.join(dir, `${basename}.bin`), script.data);

        // Write hex dump + analysis
        let info = "";
        info += `Script #${script.index}\n`;
        info += `Type: 0x${script.type.toString(16).padStart(2, "0")} (${script.typeName})\n`;
        info += `Param: ${script.param}\n`;
        info += `Size: ${script.size} bytes\n`;
        info += `Offset in play.bin: 0x${script.offset.toString(16)}\n`;
        info += `Child count: ${analysis.childCount}\n`;
        info += `Flags: 0x${analysis.flags.toString(16).padStart(2, "0")}\n`;
        info += `\nHex dump:\n${hexDump(script.data, script.size)}\n`;

        fs.writeFileSync(path.join(dir, `${basename}.txt`), info);

        // Track summary
        if (!summary[script.typeName]) summary[script.typeName] = [];
        summary[script.typeName].push({
            index: script.index,
            size: script.size,
            param: script.param,
            childCount: analysis.childCount,
            flags: analysis.flags,
        });

        console.log(`  #${String(script.index).padStart(2)} ${script.typeName.padEnd(8)} param=${String(script.param).padStart(5)}  ${String(script.size).padStart(5)}B  children=${analysis.childCount}  flags=0x${analysis.flags.toString(16).padStart(2, "0")}  → ${dir}/`);
    }

    // Write manifest
    const manifest = ppl.scripts.map((s) => ({
        index: s.index,
        type: s.type,
        typeName: s.typeName,
        param: s.param,
        size: s.size,
        offset: s.offset,
    }));
    fs.writeFileSync(path.join(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));

    console.log(`\nExtracted ${ppl.numScripts} scripts → ${outputDir}/`);
    console.log("\nSummary:");
    for (const [type, scripts] of Object.entries(summary)) {
        const totalBytes = scripts.reduce((s, x) => s + x.size, 0);
        const sizes = scripts.map((s) => s.size);
        console.log(`  ${type.padEnd(10)}: ${String(scripts.length).padStart(2)} scripts, ${String(totalBytes).toLocaleString().padStart(6)} bytes (${Math.min(...sizes)}–${Math.max(...sizes)})`);
    }
}

main();
