const { SmartPlay } = require("../dist");

const smartPlay = new SmartPlay();

smartPlay.on("discover", async (device) => {
    console.log("Found Smart Brick, connecting...");

    try {
        await device.connect();

        const info = device.info;
        console.log(`  Name:     ${info.name}`);
        console.log(`  MAC:      ${info.mac}`);
        console.log(`  Firmware: ${info.firmware}`);
        console.log(`  Battery:  ${device.battery}%`);
        console.log(`  Volume:   ${device.volume}`);
        console.log();

        device.disconnect();
    } catch (err) {
        console.error(`  Failed to connect: ${err.message}`);
    }
});

console.log("Scanning for Smart Bricks...\n");
smartPlay.scan();
