#!/usr/bin/env node

/**
 * Best-guess synthesizer for format 10 audio clips.
 *
 * Format 10 clips are sparse register writes to the DA000001-01 ASIC's analog
 * synthesizer. We don't have the register datasheet, so this uses heuristics:
 *
 *   - Values 20–8000 at known frequency addresses → oscillator pitches
 *   - 13-float table at 0x0104 → harmonic/partial amplitudes (additive synthesis)
 *   - Values 0–1 at amplitude addresses → gain/mix levels
 *   - Timing-range values → envelope shaping
 *
 * Usage:
 *   node examples/synth-format10.js <clip.bin> [output.wav]
 *   node examples/synth-format10.js --all <fmt10_dir> <output_dir>
 */

const fs = require("fs");
const path = require("path");

const SAMPLE_RATE = 15625;
const DURATION = 2.0; // seconds
const CHANNELS = 1;
const BITS = 16;

// --- Register address classification (from statistical analysis) ---

// Primary frequency addresses (most likely to contain the fundamental pitch)
const FREQ_ADDRS_PRIMARY = [0x00D4, 0x0274, 0x02C4, 0x0488, 0x0300];
// Secondary frequency addresses
const FREQ_ADDRS_SECONDARY = [0x00DC, 0x018C, 0x01C4, 0x0258, 0x02D8, 0x0320, 0x035C, 0x041C, 0x0440];
// Harmonic table
const HARMONIC_ADDR = 0x0104;
// Amplitude / gain addresses (consistently 0–1)
const AMP_ADDRS = [0x013C, 0x033C, 0x03A8, 0x03C0, 0x0304];
// Timing addresses (values suggest envelope in seconds or rate)
const TIMING_ADDRS = [0x0348, 0x0450, 0x0324];
// Detuning (int8 values at 0x004C)
const DETUNE_ADDR = 0x004C;

// Default harmonic series (if 0x0104 not present)
const DEFAULT_HARMONICS = [1.0, 0.5, 0.3, 0.2, 0.15, 0.1, 0.08, 0.06, 0.04, 0.03, 0.02, 0.01, 0.005];

function parseRegisters(buf) {
    const records = new Map();
    let off = 0;
    while (off + 3 <= buf.length) {
        const addr = buf.readUInt16LE(off);
        const len = buf[off + 2];
        if (off + 3 + len > buf.length) break;
        const data = Buffer.from(buf.slice(off + 3, off + 3 + len));
        records.set(addr, data);
        off += 3 + len;
    }
    return records;
}

function readFloat(data, offset = 0) {
    if (offset + 4 <= data.length) return data.readFloatLE(offset);
    return null;
}

function readFloatArray(data) {
    const arr = [];
    for (let i = 0; i + 3 < data.length; i += 4) {
        arr.push(data.readFloatLE(i));
    }
    return arr;
}

function extractFrequencies(regs) {
    const freqs = [];

    // Try primary frequency addresses first
    for (const addr of FREQ_ADDRS_PRIMARY) {
        const data = regs.get(addr);
        if (!data) continue;
        const floats = readFloatArray(data);
        for (const f of floats) {
            if (isFinite(f) && f >= 20 && f <= 8000) {
                freqs.push(f);
            }
        }
    }

    // If no primary freqs, try secondary
    if (freqs.length === 0) {
        for (const addr of FREQ_ADDRS_SECONDARY) {
            const data = regs.get(addr);
            if (!data) continue;
            const floats = readFloatArray(data);
            for (const f of floats) {
                if (isFinite(f) && f >= 20 && f <= 8000) {
                    freqs.push(f);
                }
            }
        }
    }

    // Last resort: scan ALL registers for musical frequencies
    if (freqs.length === 0) {
        for (const [addr, data] of regs) {
            const floats = readFloatArray(data);
            for (const f of floats) {
                if (isFinite(f) && f >= 50 && f <= 4000) {
                    freqs.push(f);
                }
            }
        }
    }

    return freqs;
}

function extractHarmonics(regs) {
    const data = regs.get(HARMONIC_ADDR);
    if (data && data.length >= 52) {
        return readFloatArray(data);
    }
    return DEFAULT_HARMONICS;
}

function extractAmplitude(regs) {
    let sum = 0;
    let count = 0;
    for (const addr of AMP_ADDRS) {
        const data = regs.get(addr);
        if (!data) continue;
        const v = readFloat(data);
        if (v !== null && isFinite(v) && v >= 0 && v <= 1) {
            sum += v;
            count++;
        }
    }
    return count > 0 ? sum / count : 0.5;
}

function extractDetune(regs) {
    const data = regs.get(DETUNE_ADDR);
    if (!data) return [];
    const offsets = [];
    for (let i = 0; i < data.length; i++) {
        offsets.push(data.readInt8(i));
    }
    return offsets;
}

function extractEnvelope(regs) {
    // Try to find attack/decay/sustain/release-like values
    let attack = 0.05;
    let decay = 0.2;
    let sustain = 0.6;
    let release = 0.3;

    for (const addr of TIMING_ADDRS) {
        const data = regs.get(addr);
        if (!data) continue;
        const floats = readFloatArray(data);
        // Use first few timing values as envelope params
        if (floats.length >= 1 && floats[0] >= 0 && floats[0] <= 10) attack = Math.max(0.01, floats[0] * 0.1);
        if (floats.length >= 2 && floats[1] >= 0 && floats[1] <= 10) decay = Math.max(0.01, floats[1] * 0.1);
        if (floats.length >= 3 && floats[2] >= 0 && floats[2] <= 1) sustain = floats[2];
    }

    return { attack, decay, sustain, release };
}

function synthesize(regs) {
    const freqs = extractFrequencies(regs);
    const harmonics = extractHarmonics(regs);
    const amplitude = extractAmplitude(regs);
    const detuneOffsets = extractDetune(regs);
    const env = extractEnvelope(regs);

    if (freqs.length === 0) {
        console.warn("  No frequencies found — generating silence");
        return Buffer.alloc(SAMPLE_RATE * DURATION * 2);
    }

    // Use up to 3 fundamental frequencies
    const fundamentals = freqs.slice(0, 3);
    const numSamples = Math.floor(SAMPLE_RATE * DURATION);
    const samples = new Float64Array(numSamples);

    for (const fund of fundamentals) {
        // Apply detuning if available
        const detuneCount = Math.max(1, detuneOffsets.length);
        for (let d = 0; d < detuneCount; d++) {
            const detuneCents = detuneOffsets[d] || 0;
            const detuneRatio = Math.pow(2, detuneCents / 1200);
            const baseFreq = fund * detuneRatio;

            // Additive synthesis with harmonic series
            for (let h = 0; h < harmonics.length; h++) {
                const harmAmp = harmonics[h];
                if (Math.abs(harmAmp) < 0.001) continue;
                const freq = baseFreq * (h + 1);
                if (freq > SAMPLE_RATE / 2) break; // Nyquist

                const phaseInc = (2 * Math.PI * freq) / SAMPLE_RATE;
                for (let i = 0; i < numSamples; i++) {
                    samples[i] += Math.sin(phaseInc * i) * harmAmp / detuneCount / fundamentals.length;
                }
            }
        }
    }

    // Apply ADSR envelope
    const attackSamples = Math.floor(env.attack * SAMPLE_RATE);
    const decaySamples = Math.floor(env.decay * SAMPLE_RATE);
    const releaseSamples = Math.floor(env.release * SAMPLE_RATE);
    const sustainEnd = numSamples - releaseSamples;

    for (let i = 0; i < numSamples; i++) {
        let envVal;
        if (i < attackSamples) {
            envVal = i / attackSamples;
        } else if (i < attackSamples + decaySamples) {
            const t = (i - attackSamples) / decaySamples;
            envVal = 1.0 - t * (1.0 - env.sustain);
        } else if (i < sustainEnd) {
            envVal = env.sustain;
        } else {
            const t = (i - sustainEnd) / releaseSamples;
            envVal = env.sustain * (1.0 - t);
        }
        samples[i] *= envVal * amplitude;
    }

    // Normalize and convert to 16-bit PCM
    let peak = 0;
    for (let i = 0; i < numSamples; i++) {
        peak = Math.max(peak, Math.abs(samples[i]));
    }
    const scale = peak > 0 ? 0.9 / peak : 1;

    const pcm = Buffer.alloc(numSamples * 2);
    for (let i = 0; i < numSamples; i++) {
        const val = Math.max(-1, Math.min(1, samples[i] * scale));
        pcm.writeInt16LE(Math.round(val * 32767), i * 2);
    }
    return pcm;
}

function writeWav(pcmData, outputPath) {
    const numSamples = pcmData.length / 2;
    const dataSize = pcmData.length;
    const header = Buffer.alloc(44);

    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * CHANNELS * (BITS / 8), 28);
    header.writeUInt16LE(CHANNELS * (BITS / 8), 32);
    header.writeUInt16LE(BITS, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataSize, 40);

    fs.writeFileSync(outputPath, Buffer.concat([header, pcmData]));
}

function processClip(inputPath, outputPath) {
    const buf = fs.readFileSync(inputPath);
    const regs = parseRegisters(buf);

    if (regs.size === 0) {
        console.warn(`  ${path.basename(inputPath)}: failed to parse registers`);
        return false;
    }

    const freqs = extractFrequencies(regs);
    const harmonics = extractHarmonics(regs);
    const amp = extractAmplitude(regs);

    console.log(`  ${path.basename(inputPath)}: ${regs.size} regs, freqs=[${freqs.slice(0, 3).map(f => f.toFixed(0) + "Hz").join(", ")}], amp=${amp.toFixed(2)}, harmonics=${harmonics.length}`);

    const pcm = synthesize(regs);
    writeWav(pcm, outputPath);
    return true;
}

function main() {
    const args = process.argv.slice(2);

    if (args[0] === "--all" && args.length >= 2) {
        const inputDir = args[1];
        const outputDir = args[2] || "synth_output";
        fs.mkdirSync(outputDir, { recursive: true });

        const files = fs.readdirSync(inputDir).filter(f => f.endsWith(".bin"));
        let ok = 0;
        for (const f of files) {
            const outName = f.replace(/\.bin$/, ".wav");
            if (processClip(path.join(inputDir, f), path.join(outputDir, outName))) ok++;
        }
        console.log(`\nSynthesized ${ok}/${files.length} clips → ${outputDir}/`);
    } else if (args.length >= 1) {
        const inputPath = args[0];
        const outputPath = args[1] || inputPath.replace(/\.bin$/, ".wav");
        processClip(inputPath, outputPath);
        console.log(`→ ${outputPath}`);
    } else {
        console.error("Usage:");
        console.error("  node synth-format10.js <clip.bin> [output.wav]");
        console.error("  node synth-format10.js --all <fmt10_dir> [output_dir]");
        process.exit(1);
    }
}

main();
