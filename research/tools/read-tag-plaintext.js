/**
 * Read Tag Plaintext via BLE Register Probing
 *
 * Connects to a Smart Brick, waits for a tag to be placed,
 * then reads every register looking for decrypted tag content.
 *
 * Key targets:
 *   0x92 — ASIC/tag status (backed by RAM 0x807A78, near tag data at 0x807A60)
 *   0x83 — Internal firmware state
 *   0x94 — Hardware timer
 *   Plus a broad sweep of undocumented registers 0x10-0x7F and 0x97-0xFF
 *
 * Usage: node examples/read-tag-plaintext.js
 *
 * 1. Shake the brick to wake it
 * 2. Script connects via BLE
 * 3. Baseline snapshot of all registers (no tag)
 * 4. "Place a tag now" — waits 10 seconds
 * 5. Reads all registers again, shows differences
 * 6. Polls changed registers for 20 more seconds
 */

const { SmartPlay, Register } = require("../dist");

const WAIT_FOR_TAG_MS = 10000;
const POLL_AFTER_TAG_MS = 20000;
const POLL_INTERVAL_MS = 500;

function formatHex(buf) {
    if (!buf || buf.length === 0) return "(empty)";
    return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

function formatAscii(buf) {
    return Array.from(buf).map((b) => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
}

function buffersEqual(a, b) {
    if (!a && !b) return true;
    if (!a || !b) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// All registers to probe — documented + undocumented + broad sweep
const KNOWN_REGISTERS = [
    { id: 0x20, name: "BatteryLevel" },
    { id: 0x21, name: "DeviceModel" },
    { id: 0x22, name: "FirmwareRevision" },
    { id: 0x80, name: "HubLocalName" },
    { id: 0x81, name: "UserVolume" },
    { id: 0x82, name: "CurrentWriteOffset" },
    { id: 0x83, name: "InternalState" },
    { id: 0x84, name: "PrimaryMacAddress" },
    { id: 0x85, name: "UpgradeState" },
    { id: 0x88, name: "UpdateState" },
    { id: 0x89, name: "PipelineStage" },
    { id: 0x90, name: "UXSignal" },
    { id: 0x91, name: "OwnershipProof" },
    { id: 0x92, name: "ASIC/TagStatus" },
    { id: 0x93, name: "ChargingState" },
    { id: 0x94, name: "HardwareTimer" },
    { id: 0x96, name: "TravelMode" },
];

// Targeted sweep of registers known to exist in the firmware dispatch table
// Avoid registers that cause timeouts (0x0B, 0x86 triggers pairing, 0x87 etc.)
const SWEEP_RANGES = [
    0x1B, 0x1C,         // PAwR session
    0x25, 0x26,         // PAwR config
];

// Build combined list (deduplicated)
const allRegIds = new Set([
    ...KNOWN_REGISTERS.map(r => r.id),
    ...SWEEP_RANGES,
]);
const ALL_REGISTERS = [...allRegIds].sort((a, b) => a - b).map(id => {
    const known = KNOWN_REGISTERS.find(r => r.id === id);
    return { id, name: known ? known.name : `0x${id.toString(16).padStart(2, "0")}` };
});

// Catch unhandled rejections globally to prevent crashes
process.on("unhandledRejection", () => {});

async function readRegisterSafe(device, regId) {
    try {
        // Use the connection directly with a short timeout
        const response = await Promise.race([
            device.readRawRegister(regId),
            new Promise((_, reject) => setTimeout(() => reject(new Error("skip")), 3000))
        ]);
        return response;
    } catch {
        return null;
    }
}

async function snapshotAllRegisters(device) {
    const snapshot = {};
    for (const reg of ALL_REGISTERS) {
        const data = await readRegisterSafe(device, reg.id);
        snapshot[reg.id] = data;
    }
    return snapshot;
}

const smartPlay = new SmartPlay();

smartPlay.on("discover", async (device) => {
    try {
        await device.connect();
        const info = device.info;
        console.log(`\nConnected to ${info.name} (${info.mac})`);
        console.log(`Firmware: ${info.firmware}  Battery: ${device.battery}%\n`);

        // Phase 1: Baseline snapshot (no tag)
        console.log("=== Phase 1: Baseline (no tag) ===\n");
        console.log("Reading all registers...\n");

        const baseline = await snapshotAllRegisters(device);

        let readableCount = 0;
        for (const reg of ALL_REGISTERS) {
            const data = baseline[reg.id];
            if (data && data.length > 0) {
                readableCount++;
                console.log(`  ${reg.name.padEnd(20)} (0x${reg.id.toString(16).padStart(2, "0")}): ${formatHex(data)}  [${data.length}B]`);
            }
        }
        console.log(`\n${readableCount}/${ALL_REGISTERS.length} registers readable.\n`);

        // Phase 2: Wait for tag
        console.log("=== Phase 2: Place a tag on the brick NOW ===");
        console.log(`Waiting ${WAIT_FOR_TAG_MS / 1000} seconds...\n`);

        await new Promise(resolve => setTimeout(resolve, WAIT_FOR_TAG_MS));

        // Send keepalive to maintain connection
        await device.connection.writeRegister(Register.UXSignal, [0xea, 0x00], false);

        // Phase 3: Read all registers again
        console.log("=== Phase 3: Post-tag snapshot ===\n");

        const postTag = await snapshotAllRegisters(device);

        // Compare and show changes
        const changedRegs = [];
        console.log("--- Changed registers ---\n");

        for (const reg of ALL_REGISTERS) {
            const before = baseline[reg.id];
            const after = postTag[reg.id];

            // New data appeared
            if (!before && after && after.length > 0) {
                console.log(`  NEW  ${reg.name.padEnd(20)} (0x${reg.id.toString(16).padStart(2, "0")}): ${formatHex(after)}  [${after.length}B]`);
                console.log(`       ASCII: ${formatAscii(after)}`);
                changedRegs.push(reg);
            }
            // Data changed
            else if (before && after && !buffersEqual(before, after)) {
                console.log(`  CHG  ${reg.name.padEnd(20)} (0x${reg.id.toString(16).padStart(2, "0")}):`);
                console.log(`       Before: ${formatHex(before)}`);
                console.log(`       After:  ${formatHex(after)}`);
                if (after.length >= 6) {
                    console.log(`       ASCII:  ${formatAscii(after)}`);
                }
                changedRegs.push(reg);
            }
            // Data disappeared
            else if (before && before.length > 0 && (!after || after.length === 0)) {
                console.log(`  GONE ${reg.name.padEnd(20)} (0x${reg.id.toString(16).padStart(2, "0")}): was ${formatHex(before)}`);
                changedRegs.push(reg);
            }
        }

        if (changedRegs.length === 0) {
            console.log("  No registers changed! Tag may not have been detected.");
            console.log("  (Make sure the tag is placed on the brick's NFC area.)\n");
        } else {
            console.log(`\n${changedRegs.length} registers changed.\n`);
        }

        // Also show full dump of any registers > 6 bytes (potential tag data)
        console.log("--- All registers with > 6 bytes (potential tag data) ---\n");
        for (const reg of ALL_REGISTERS) {
            const data = postTag[reg.id];
            if (data && data.length > 6) {
                console.log(`  ${reg.name.padEnd(20)} (0x${reg.id.toString(16).padStart(2, "0")}): ${formatHex(data)}  [${data.length}B]`);
            }
        }

        // Phase 4: Poll changed registers
        if (changedRegs.length > 0) {
            console.log(`\n=== Phase 4: Polling ${changedRegs.length} changed registers for ${POLL_AFTER_TAG_MS / 1000}s ===`);
            console.log("(Remove and replace the tag to see changes)\n");

            const pollStart = Date.now();
            const prev = {};
            for (const reg of changedRegs) {
                prev[reg.id] = postTag[reg.id];
            }

            const pollInterval = setInterval(async () => {
                if (Date.now() - pollStart > POLL_AFTER_TAG_MS) {
                    clearInterval(pollInterval);
                    console.log("\nDone. Disconnecting.");
                    device.disconnect();
                    process.exit(0);
                    return;
                }

                // Keepalive
                try {
                    await device.connection.writeRegister(Register.UXSignal, [0xea, 0x00], false);
                } catch {}

                const elapsed = ((Date.now() - pollStart) / 1000).toFixed(1).padStart(6);

                for (const reg of changedRegs) {
                    const data = await readRegisterSafe(device, reg.id);
                    if (data && !buffersEqual(prev[reg.id], data)) {
                        console.log(`[${elapsed}s] ${reg.name} (0x${reg.id.toString(16).padStart(2, "0")}): ${formatHex(data)}`);
                        prev[reg.id] = data;
                    }
                }
            }, POLL_INTERVAL_MS);
        } else {
            console.log("No changed registers to poll. Disconnecting.");
            device.disconnect();
            process.exit(0);
        }

        // Listen for unsolicited notifications
        device.connection.on("notification", (notification) => {
            const elapsed = ((Date.now() - Date.now()) / 1000).toFixed(1);
            const reg = "0x" + notification.register.toString(16).padStart(2, "0");
            console.log(`[NOTIF] reg=${reg}: ${formatHex(notification.data)}`);
        });

    } catch (err) {
        console.error(`Failed: ${err.message}`);
        process.exit(1);
    }
});

console.log("=== Smart Brick Tag Plaintext Reader ===\n");
console.log("1. Shake the brick to wake it up");
console.log("2. Wait for BLE connection");
console.log("3. Do NOT place a tag yet — baseline will be captured first");
console.log("4. When prompted, place a tag on the brick\n");
console.log("Scanning for Smart Play devices...\n");
smartPlay.scan();
