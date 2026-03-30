const { SmartPlay, Register } = require("../dist");

const smartPlay = new SmartPlay();

// Registers we haven't read yet
const EXPLORE_REGISTERS = [
    { id: Register.DeviceModel, name: "DeviceModel (0x21)" },
    { id: Register.CurrentConnectionParameters, name: "CurrentConnectionParameters (0x02)" },
    { id: Register.ConnectionSecurityLevel, name: "ConnectionSecurityLevel (0x04)" },
    { id: Register.CurrentPhy, name: "CurrentPhy (0x0A)" },
    { id: Register.UpdateState, name: "UpdateState (0x88)" },
    { id: Register.PipelineStage, name: "PipelineStage (0x89)" },
    { id: Register.OwnershipProof, name: "OwnershipProof (0x91)" },
];

smartPlay.on("discover", async (device) => {
    try {
        await device.connect();
        const info = device.info;
        console.log(`Connected to ${info.name} (${info.mac})\n`);
        console.log(`  Firmware: ${info.firmware}`);
        console.log(`  Battery:  ${device.battery}%`);
        console.log(`  Volume:   ${device.volume}\n`);

        console.log("--- Exploring registers ---\n");

        for (const reg of EXPLORE_REGISTERS) {
            try {
                const response = await device.readRawRegister(reg.id);
                const hex = Array.from(response).map((b) => b.toString(16).padStart(2, "0")).join(" ");
                const ascii = Array.from(response).map((b) => (b >= 0x20 && b < 0x7f) ? String.fromCharCode(b) : ".").join("");
                console.log(`  ${reg.name}`);
                console.log(`    Hex:   ${hex}`);
                console.log(`    ASCII: ${ascii}`);
                console.log(`    Bytes: ${response.length}\n`);
            } catch (err) {
                console.log(`  ${reg.name}`);
                console.log(`    ERROR: ${err.message}\n`);
            }
        }

        device.disconnect();
        process.exit(0);
    } catch (err) {
        console.error(`Failed: ${err.message}`);
        process.exit(1);
    }
});

console.log("Scanning for Smart Play devices...\n");
smartPlay.scan();
