#!/usr/bin/env node

/**
 * Extract individual audio clips from an AAP (Audio Assets Pack) file.
 *
 * Usage:
 *   node examples/extract-audio.js <audio.bin> [output_dir]
 *
 * Output directory defaults to ./audio_clips/
 */

const fs = require("fs");
const path = require("path");

const FORMAT_NAMES = {
    6: "blob",
    8: "patch",
    9: "patch",
    10: "seq",
    11: "seq",
};

function parseAAP(buf) {
    const magic = buf.toString("ascii", 0, 4);
    if (magic !== "\x7FAAP") {
        throw new Error(`Bad magic: expected \\x7FAAP, got ${JSON.stringify(magic)}`);
    }

    const numClips = buf.readUInt16LE(0x0a);
    const idTableOffset = 0x10;
    // Layout: header(16) + ID table(N×2) + secondary table(N×2) + metadata(N×16)
    const metaTableOffset = idTableOffset + numClips * 4;

    const clips = [];

    for (let i = 0; i < numClips; i++) {
        const id = buf.readUInt16LE(idTableOffset + i * 2);

        const metaOff = metaTableOffset + i * 16;
        const size = buf.readUInt32LE(metaOff);
        const offset = buf.readUInt32LE(metaOff + 4);
        const ref = buf.readUInt32LE(metaOff + 8);
        const format = buf.readUInt32LE(metaOff + 12);

        // Skip entries with anomalous format (e.g. last entry overlaps clip data)
        if (format !== 6 && format !== 8 && format !== 9 && format !== 10 && format !== 11) {
            continue;
        }

        // Offsets are absolute from file start
        if (offset + size > buf.length) {
            console.warn(`  Warning: clip ${i} (id=${id}) extends past EOF, skipping`);
            continue;
        }

        const data = buf.slice(offset, offset + size);

        clips.push({
            index: i,
            id,
            size,
            offset,
            ref: ref === 0xffffffff ? null : ref,
            format,
            data,
        });
    }

    return { numClips, clips };
}

function main() {
    const args = process.argv.slice(2);
    if (args.length < 1) {
        console.error("Usage: node extract-audio.js <audio.bin> [output_dir]");
        process.exit(1);
    }

    const inputPath = args[0];
    const outputDir = args[1] || "audio_clips";

    const buf = fs.readFileSync(inputPath);
    console.log(`Reading ${inputPath} (${buf.length} bytes)`);

    const aap = parseAAP(buf);
    console.log(`Found ${aap.clips.length} clips\n`);

    // Create output directories per format
    const formatDirs = {};
    for (const fmt of [6, 8, 9, 10, 11]) {
        const name = `fmt${fmt}_${FORMAT_NAMES[fmt]}`;
        const dir = path.join(outputDir, name);
        fs.mkdirSync(dir, { recursive: true });
        formatDirs[fmt] = dir;
    }

    // Summary counters
    const counts = {};
    let totalBytes = 0;

    for (const clip of aap.clips) {
        const dir = formatDirs[clip.format];
        if (!dir) continue;

        const suffix = clip.id === 0 ? "_companion" : "";
        const refStr = clip.ref !== null ? `_ref${clip.ref}` : "";
        const filename = `clip_${String(clip.index).padStart(3, "0")}_id${clip.id}${refStr}${suffix}.bin`;
        const outPath = path.join(dir, filename);

        fs.writeFileSync(outPath, clip.data);

        counts[clip.format] = (counts[clip.format] || 0) + 1;
        totalBytes += clip.size;
    }

    // Print summary
    console.log("Extracted:");
    for (const fmt of [6, 8, 9, 10, 11]) {
        const n = counts[fmt] || 0;
        if (n > 0) {
            console.log(`  Format ${String(fmt).padStart(2)} (${FORMAT_NAMES[fmt].padEnd(5)}): ${String(n).padStart(3)} clips → ${formatDirs[fmt]}/`);
        }
    }
    console.log(`\n  Total: ${aap.clips.length} clips, ${totalBytes.toLocaleString()} bytes`);

    // Write a manifest JSON
    const manifest = aap.clips.map((c) => ({
        index: c.index,
        id: c.id,
        format: c.format,
        size: c.size,
        ref: c.ref,
    }));
    const manifestPath = path.join(outputDir, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`  Manifest: ${manifestPath}`);
}

main();
