const { SmartPlay, Register } = require("../dist");

// Undocumented registers found in firmware but not in the ConnectKit SDK.
// 0x92 is the most interesting — its backing RAM (0x807A78) is written by
// the tag ASIC driver. It may reflect tag reader state.
const UNDOCUMENTED_REGISTERS = [
    { id: 0x83, name: "0x83 (internal state)" },
    { id: 0x92, name: "0x92 (ASIC/tag status)" },
    { id: 0x94, name: "0x94 (hardware timer)" },
];

// Known registers to read alongside for context
const CONTEXT_REGISTERS = [
    { id: Register.ChargingState, name: "0x93 (ChargingState)" },
];

const ALL_REGISTERS = [...UNDOCUMENTED_REGISTERS, ...CONTEXT_REGISTERS];

const POLL_MS = 500;
const DURATION_S = parseInt(process.argv[2], 10) || 60;

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

        // Initial read of all registers
        console.log("--- Initial register values ---\n");
        for (const reg of ALL_REGISTERS) {
            try {
                const data = await device.readRawRegister(reg.id);
                console.log(`  ${reg.name}: ${formatHex(data)}`);
            } catch (err) {
                console.log(`  ${reg.name}: ERROR ${err.message}`);
            }
        }

        console.log(`\n--- Polling every ${POLL_MS}ms for ${DURATION_S}s ---`);
        console.log("Place/remove Smart Tags and Smart Minifigs on the brick.\n");

        // Track previous values to detect changes
        const prev = {};

        const startTime = Date.now();
        const interval = setInterval(async () => {
            if (Date.now() - startTime > DURATION_S * 1000) {
                clearInterval(interval);
                console.log("\nDone. Disconnecting.");
                device.disconnect();
                process.exit(0);
                return;
            }

            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1).padStart(6);
            const parts = [];

            for (const reg of ALL_REGISTERS) {
                try {
                    const data = await device.readRawRegister(reg.id);
                    const hex = formatHex(data);
                    const key = `0x${reg.id.toString(16)}`;
                    const changed = prev[key] !== undefined && prev[key] !== hex;
                    parts.push(`${key}=${hex}${changed ? " ***" : ""}`);
                    prev[key] = hex;
                } catch {
                    parts.push(`${reg.id.toString(16)}=ERR`);
                }
            }

            console.log(`[${elapsed}s] ${parts.join("  ")}`);
        }, POLL_MS);

        // Listen for unsolicited notifications (access private connection)
        device.connection.on("notification", (notification) => {
            const elapsed = ((Date.now() - startTime) / 1000).toFixed(1).padStart(6);
            const reg = "0x" + notification.register.toString(16).padStart(2, "0");
            console.log(`[${elapsed}s] NOTIFICATION reg=${reg}: ${formatHex(notification.data)}`);
        });

    } catch (err) {
        console.error(`Failed: ${err.message}`);
        process.exit(1);
    }
});

console.log("Scanning for Smart Play devices...");
console.log(`Will poll undocumented registers for ${DURATION_S}s (pass seconds as arg)\n`);
smartPlay.scan();
