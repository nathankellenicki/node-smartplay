const { SmartPlay } = require("../dist");

// PAwR-related registers from HARDWARE.md
// 0x1B, 0x1C, 0x25, 0x26 manage PAwR sessions
// Also probe nearby registers for context
const PAWR_REGISTERS = [
    0x1A, 0x1B, 0x1C, 0x1D, 0x1E, 0x1F,
    0x25, 0x26, 0x27, 0x28,
];

// Also try a wider scan for anything PAwR/BrickNet related
const EXTENDED_SCAN = [];
for (let i = 0x10; i <= 0x30; i++) {
    if (!PAWR_REGISTERS.includes(i)) {
        EXTENDED_SCAN.push(i);
    }
}

function formatHex(buf) {
    return Array.from(buf).map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

const smartPlay = new SmartPlay();

smartPlay.on("discover", async (device) => {
    try {
        await device.connect();
        const info = device.info;
        console.log(`Connected to ${info.name} (${info.mac})`);
        console.log(`Firmware: ${info.firmware}  Battery: ${device.battery}%\n`);

        console.log("=== PAwR Registers (0x1B, 0x1C, 0x25, 0x26 + neighbors) ===\n");
        for (const reg of PAWR_REGISTERS) {
            try {
                const data = await device.readRawRegister(reg);
                console.log(`  0x${reg.toString(16).padStart(2, "0")}: [${data.length}] ${formatHex(data)}`);
            } catch (err) {
                console.log(`  0x${reg.toString(16).padStart(2, "0")}: ${err.message}`);
            }
        }

        console.log("\n=== Extended scan (0x10-0x30 range) ===\n");
        for (const reg of EXTENDED_SCAN) {
            try {
                const data = await device.readRawRegister(reg);
                console.log(`  0x${reg.toString(16).padStart(2, "0")}: [${data.length}] ${formatHex(data)}`);
            } catch (err) {
                // Only print if it's not a simple "not found" error
                if (!err.message.includes("Timeout") && !err.message.includes("timeout")) {
                    console.log(`  0x${reg.toString(16).padStart(2, "0")}: ${err.message}`);
                }
            }
        }

        // If we found data on 0x1B or 0x1C, poll them to see changes
        console.log("\n=== Polling PAwR registers (10s) ===\n");
        const prev = {};
        const start = Date.now();
        const interval = setInterval(async () => {
            if (Date.now() - start > 10000) {
                clearInterval(interval);
                console.log("\nDone. Disconnecting.");
                device.disconnect();
                process.exit(0);
                return;
            }

            const parts = [];
            for (const reg of [0x1B, 0x1C, 0x25, 0x26]) {
                try {
                    const data = await device.readRawRegister(reg);
                    const hex = formatHex(data);
                    const key = `0x${reg.toString(16)}`;
                    const changed = prev[key] !== undefined && prev[key] !== hex;
                    parts.push(`${key}=[${data.length}]${hex}${changed ? " ***" : ""}`);
                    prev[key] = hex;
                } catch {
                    // skip
                }
            }
            if (parts.length > 0) {
                const elapsed = ((Date.now() - start) / 1000).toFixed(1);
                console.log(`[${elapsed}s] ${parts.join("  ")}`);
            }
        }, 500);

    } catch (err) {
        console.error(`Failed: ${err.message}`);
        process.exit(1);
    }
});

console.log("Scanning for Smart Play devices...");
console.log("Make sure a brick is ON and in PAwR mode (multi-brick play active)\n");
smartPlay.scan();
