# LEGO ConnectKit SDK Reference

Extracted from the LEGO SmartAssist APK (`com.lego.smartassist`, codename "Horizon") via Il2CppDumper.
ConnectKit version: **6.2.0-preview.234**, Unity **6000.1.17f1**.

---

## Table of Contents

1. [Hub Types](#hub-types)
2. [IO Types (Peripherals)](#io-types)
3. [Protocol Stacks](#protocol-stacks)
4. [LEGO Wireless Protocol (LWP3)](#lwp3-protocol)
5. [WDX Protocol (Wireless Data Exchange)](#wdx-protocol)
6. [OAD Protocol (Over-Air Download)](#oad-protocol)
7. [P11/RPC Protocol (JAM + MessagePack)](#p11-rpc-protocol)
8. [BLE GATT UUIDs](#ble-gatt-uuids)
9. [Hub Services](#hub-services)
10. [Motor Reference](#motor-reference)
11. [Sensor Reference](#sensor-reference)
12. [Light & Display Reference](#light--display-reference)
13. [Sound Reference](#sound-reference)
14. [Game Engine Reference](#game-engine-reference)
15. [Firmware Update Reference](#firmware-update-reference)
16. [Security & Signed Commands](#security--signed-commands)

---

## Hub Types

### HubTypeEnum

| Enum Value | ID | System Type | Name | Protocol |
|---|---|---|---|---|
| Hub32 | 0 | 0x20 | WeDo 2.0 Smart Hub | LWP3 |
| Hub33 | 1 | 0x21 | DUPLO Train Base | LWP3 |
| Hub64 | 2 | 0x40 | Boost Move Hub | LWP3 |
| Hub65 | 3 | 0x41 | City Hub (Powered Up 2-port) | LWP3 |
| Hub66 | 4 | 0x42 | Remote Control Handset | LWP3 |
| Hub67 | 5 | 0x43 | Mario Hub | LWP3/LEAF |
| Hub68 | 6 | 0x44 | Technic Large Hub (6-port) | LWP3 |
| Hub69 | 7 | 0x45 | Luigi/Peach Hub | LWP3/LEAF |
| Hub128 | 8 | 0x80 | Technic Hub / SPIKE Prime | LWP3 |
| Hub129 | 9 | 0x81 | SPIKE Essential | LWP3 |
| Hub131 | 10 | 0x83 | SPIKE Prime 2 | LWP3 |
| Hub132 | 11 | 0x84 | Hub132 | LWP3 |
| TBP | 12 | — | Testing/Bootloader Platform | — |
| AudioBrick | 13 | — | Smart Brick (DUPLO speaker) | WDX |
| HubUnknown | 14 | — | Unknown/fallback | — |

### HubTypeGroup (Protocol Families)

| Group | Protocol | Hub Types |
|---|---|---|
| **LPF2** | LEGO Wireless Protocol v3 | Hub32–Hub69, Hub128–Hub132 |
| **LEAF** | LWP3 + LEAF Game Engine | Hub67 (Mario), Hub69 (Luigi/Peach) |
| **OAD** | Over-Air Download firmware | Various (TI CC26xx-based) |
| **Wdx** | Wireless Data Exchange | AudioBrick (Smart Brick) |

### HubSystemType

| Value | Name |
|---|---|
| -1 | Unknown |
| 0 | MiscLEGO |
| 1 | LEGODuplo |
| 2 | LEGOSystem1 |
| 3 | LEGOSystem2 |
| 4 | LEGOTechnic1 |
| 5 | LEGOTechnic2 |
| 6 | LEGOThirdParty1 |
| 7 | LEGOThirdParty2 |

### Manufacturer Data (BLE Advertising)

Company ID: **0x0397** (LEGO System A/S)

Format: `[companyId_lo, companyId_hi, buttonState, systemTypeAndDevice, ...]`

Byte 3 encodes `HubSystemType` (upper bits) and device number (lower bits), used to resolve `HubTypeEnum`.

---

## IO Types

### Complete LEIOType Enum

| ID (hex) | ID (dec) | Name | Category |
|---|---|---|---|
| 0x00 | 0 | Generic | — |
| 0x01 | 1 | Motor | Basic Motor (WeDo) |
| 0x02 | 2 | TrainMotor | Train Motor |
| 0x08 | 8 | Light | Simple Light |
| 0x14 | 20 | Voltage | Voltage Sensor |
| 0x15 | 21 | Current | Current Sensor |
| 0x16 | 22 | PiezoTone | Piezo Buzzer |
| 0x17 | 23 | RGBLight | Hub RGB LED |
| 0x22 | 34 | TiltSensor | WeDo 2.0 Tilt |
| 0x23 | 35 | MotionSensor | WeDo 2.0 Motion |
| 0x25 | 37 | VisionSensor | Boost Color & Distance |
| 0x26 | 38 | MotorWithTacho | External Tacho Motor |
| 0x27 | 39 | InternalMotorWithTacho | Boost Internal Motor |
| 0x28 | 40 | InternalTiltSensorThreeAxis | Internal 3-Axis Tilt |
| 0x29 | 41 | DTMotor | DUPLO Train Motor |
| 0x2A | 42 | SoundPlayer | DUPLO Sound Player |
| 0x2B | 43 | DuploTrainColorSensor | DUPLO Train Color Sensor |
| 0x2C | 44 | MoveSensor | Move Hub Sensor |
| 0x2E | 46 | TechnicMotorL | Technic Motor L |
| 0x2F | 47 | TechnicMotorXL | Technic Motor XL |
| 0x30 | 48 | TechnicAzureAngularMotorM | Technic Azure Angular M |
| 0x31 | 49 | TechnicAzureAngularMotorL | Technic Azure Angular L |
| 0x36 | 54 | TechnicThreeAxisGestureSensor | Gesture Sensor |
| 0x37 | 55 | RemoteControlButtonSensor | Remote Button |
| 0x39 | 57 | Technic3AxisAccelerometer | Hub Accelerometer |
| 0x3A | 58 | Technic3AxisGyroSensor | Hub Gyroscope |
| 0x3B | 59 | Technic3AxisOrientationSensor | Hub Orientation |
| 0x3C | 60 | TechnicTemperatureSensor | Hub Temperature |
| 0x3D | 61 | TechnicColorSensor | SPIKE Color Sensor |
| 0x3E | 62 | TechnicDistanceSensor | SPIKE Distance Sensor |
| 0x3F | 63 | TechnicForceSensor | SPIKE Force Sensor |
| 0x40 | 64 | GeckoLEDMatrix | 3x3 LED Matrix (SPIKE Essential) |
| 0x41 | 65 | TechnicAzureAngularMotorS | Technic Azure Angular S |
| 0x42 | 66 | BoostVM | Boost Virtual Machine |
| 0x44 | 68 | DBotColorSensor | DBot Color Sensor |
| 0x46 | 70 | LEAFGameEngine | LEAF Game Engine |
| 0x47 | 71 | LEAFGesture | LEAF Gesture |
| 0x48 | 72 | LEAFDisplay | LEAF Display |
| 0x49 | 73 | LEAFTag | LEAF NFC Tag |
| 0x4A | 74 | LEAFPants | LEAF Pants |
| 0x4B | 75 | TechnicGreyAngularMotorM | Technic Grey Angular M |
| 0x4C | 76 | TechnicGreyAngularMotorL | Technic Grey Angular L |
| 0x4E | 78 | ChargingLight | Charging Indicator |
| 0x55 | 85 | LEAFFriendship | LEAF Friendship/NFC |
| 0x56 | 86 | TechnicMoveHubDriveMotor | Move Hub Drive Motor |
| 0x57 | 87 | TechnicMoveHubFrontMotor | Move Hub Front Motor |
| 0x58 | 88 | TechnicMoveHubLEDControl | Move Hub LED |
| 0x59 | 89 | PlayVM | Play Virtual Machine |
| 0x5A | 90 | JourneyGameEngine | Journey Game Engine |
| 0x5D | 93 | Technic3AxisOrientationQuaternionSensor | Quaternion Orientation |
| 0x5E | 94 | TechnicThreeAxisGestureBitmapSensor | Gesture Bitmap |
| 0xFF | 255 | JourneyColorSensor | Journey Color Sensor |

**Total: 48 IOTypes**

---

## Protocol Stacks

The ConnectKit supports three distinct BLE protocol stacks:

### 1. LWP3 (LEGO Wireless Protocol v3)
- **Service:** `00001623-1212-efde-1623-785feabcd123`
- **Used by:** All PoweredUp/Boost/Technic/SPIKE/DUPLO/LEAF hubs
- **Architecture:** Single bidirectional characteristic, message-framed, port-based I/O

### 2. WDX (Wireless Data Exchange)
- **Service:** `0000fef6-0000-1000-8000-00805f9b34fb`
- **Used by:** AudioBrick (Smart Brick), PanelCharger
- **Architecture:** 4 characteristics (control, FTC, FTD, auth), file-oriented, property get/set

### 3. P11/RPC (JAM + MessagePack)
- **Service:** `005F0001-3FF2-4ED5-B045-4C7463617865`
- **Used by:** Newer hub types (P11 platform)
- **Architecture:** Separate Tx/Rx characteristics, MessagePack-serialized RPC, hash-based procedure addressing

---

## LWP3 Protocol

### Message Types (LegoMessageType)

| ID (hex) | Name | Direction | Description |
|---|---|---|---|
| 0x01 | Property | Both | Hub property operations |
| 0x02 | Action | Both | Hub actions (shutdown, reboot, etc.) |
| 0x03 | Alert | Both | Hub alerts (low battery, high current) |
| 0x04 | AttachedIO | Upstream | Port attach/detach events |
| 0x05 | Error | Upstream | Error responses |
| 0x10 | FirmwareBootMode | Upstream | Firmware boot mode |
| 0x21 | PortInformationRequest | Downstream | Request port info |
| 0x22 | PortModeInformationRequest | Downstream | Request mode info |
| 0x41 | PortInputFormatSetupSingle | Downstream | Setup single mode subscription |
| 0x42 | PortInputFormatSetupCombined | Downstream | Setup combined mode subscription |
| 0x43 | PortInformation | Upstream | Port info response |
| 0x44 | PortModeInformation | Upstream | Mode info response |
| 0x45 | PortValueSingle | Upstream | Single mode value update |
| 0x46 | PortValueCombined | Upstream | Combined mode value update |
| 0x47 | PortInputFormatSingle | Upstream | Input format confirmation |
| 0x48 | PortInputFormatCombined | Upstream | Combined format confirmation |
| 0x61 | VirtualPortSetup | Downstream | Create/destroy virtual ports |
| 0x81 | PortOutputCommand | Downstream | Motor/light output commands |
| 0x82 | PortOutputCommandFeedback | Upstream | Command completion feedback |

### Message Framing

```
[Length, HubID, MessageType, ...Payload]
```

- **Length:** VarInt (1 byte if < 128, 2 bytes if >= 128 with high bit set)
- **HubID:** Single byte (typically 0x00)
- **MessageType:** Single byte (see table above)

### Hub Properties (HubProperty)

| ID | Name | Type | Access |
|---|---|---|---|
| 0x01 | Name | string | Read/Write |
| 0x02 | Button | bool | Read (subscribable) |
| 0x03 | FirmwareVersion | LEGORevision | Read |
| 0x04 | HardwareVersion | LEGORevision | Read |
| 0x05 | Rssi | sbyte | Read (subscribable) |
| 0x06 | BatteryVoltage | byte (0-100%) | Read (subscribable) |
| 0x07 | BatteryType | enum | Read |
| 0x08 | ManufacturerName | string | Read |
| 0x09 | RadioFirmwareVersion | string | Read |
| 0x0A | WirelessProtocolVersion | version | Read |
| 0x0B | HardwareSystemType | byte | Read |
| 0x0C | HardwareNetworkID | byte | Read/Write |
| 0x0D | PrimaryMacAddress | byte[6] | Read |
| 0x0E | SecondaryMacAddress | byte[6] | Read |
| 0x0F | HardwareNetworkFamily | byte | Read |
| 0x10 | BatteryChargingStatus | enum | Read |
| 0x11 | BatteryChargeVoltagePresent | bool | Read |
| 0x12 | SpeakerVolume | byte (0-100) | Read/Write |

### Hub Property Operations

| Value | Name | Direction |
|---|---|---|
| 0x01 | Set | Downstream |
| 0x02 | EnableUpdates | Downstream |
| 0x03 | DisableUpdates | Downstream |
| 0x04 | Reset | Downstream |
| 0x05 | RequestUpdate | Downstream |
| 0x06 | Update | Upstream |

### Hub Actions

| Value | Name | Direction |
|---|---|---|
| 0x01 | SwitchOff | Downstream |
| 0x02 | Disconnect | Downstream |
| 0x03 | VccPortControlOn | Downstream |
| 0x04 | VccPortControlOff | Downstream |
| 0x05 | ActivateBusyIndication | Downstream |
| 0x06 | DeactivateBusyIndication | Downstream |
| 0x07 | Reboot | Downstream |
| 0x30 | WillSwitchOff | Upstream |
| 0x31 | WillDisconnect | Upstream |
| 0x32 | WillGoIntoBootMode | Upstream |
| 0x33 | WillLockMem | Upstream |
| 0x34 | WillReboot | Upstream |

### Hub Alerts

| Value | Alert |
|---|---|
| 1 | LowVoltage |
| 2 | HighCurrent |
| 3 | LowSignalStrength |
| 4 | HighPowerUse |

Alert operations: EnableUpdates=1, DisableUpdates=2, RequestUpdate=3, Update=4

### Error Types

| Value | Error |
|---|---|
| 1 | Ack |
| 2 | Nack |
| 3 | BufferOverflow |
| 4 | Timeout |
| 5 | CommandNotRecognized |
| 6 | InvalidUse |

### Attached IO Events

| eventType | Name | Extra Fields |
|---|---|---|
| 0x00 | Detached | portID only |
| 0x01 | Attached | ioType (2 bytes LE), hwRevision (4 bytes), fwRevision (4 bytes) |
| 0x02 | VirtualAttached | ioType (2 bytes LE), portA, portB |

### Port Output SubCommands

| ID (hex) | Name | Description |
|---|---|---|
| 0x00 | NO_OPERATION | No-op |
| 0x02 | START_POWER_MOTOR_ONE_AND_TWO | Set power on virtual port (2 motors) |
| 0x05 | SET_ACC_TIME | Set acceleration time (ms) |
| 0x06 | SET_DEC_TIME | Set deceleration time (ms) |
| 0x07 | START_SPEED | Start at speed (single motor, -100..+100) |
| 0x08 | START_SPEED_MOTOR_ONE_AND_TWO | Start speed (virtual port, 2 motors) |
| 0x09 | SPEED_FOR_TIME | Run at speed for time (single motor) |
| 0x0A | SPEED_FOR_TIME_MOTOR_ONE_AND_TWO | Run for time (2 motors) |
| 0x0B | START_SPEED_FOR_DEGREES | Run at speed for degrees (single) |
| 0x0C | START_SPEED_FOR_DEGREES_MOTOR_ONE_AND_TWO | Run for degrees (2 motors) |
| 0x0D | START_SPEED_GOTO_ABSOLUTE_POSITION | Go to absolute position (single) |
| 0x0E | START_SPEED_GOTO_ABSOLUTE_POSITION_MOTOR_ONE_AND_TWO | Go to position (2 motors) |
| 0x14 | PRESET_ENCODER_MOTOR_ONE_AND_TWO | Reset encoder (virtual port) |
| 0x40 | SET_RGB_COLOR_NO | Set RGB light by color index |
| 0x41 | SET_RGB_RAW | Set RGB light by R, G, B bytes |
| 0x4A | ACTIVATE_BEHAVIOR | Activate behavior |
| 0x4B | DEACTIVATE_BEHAVIOR | Deactivate behavior |
| 0x50 | DIRECT_WRITE | Write to current mode |
| 0x51 | DIRECT_MODE_WRITE | Write to specific mode |

### Startup & Completion Flags

Single byte bitmask in `PortOutputCommand`:

- **High nibble (startup):** `0x00` = Buffer if Needed, `0x10` = Execute Immediately
- **Low nibble (completion):** `0x00` = No Feedback, `0x01` = Request Feedback

Common values: `0x11` (Execute + Feedback), `0x01` (Buffer + Feedback), `0x10` (Execute + No Feedback)

### Command Feedback

Feedback byte bitmask:
- Bit 0 (0x01): Buffer Empty, Command Not in Progress
- Bit 1 (0x02): Command In Progress (Busy)
- Bit 2 (0x04): Command Completed (Idle)
- Bit 3 (0x08): Current Command(s) Discarded

### Port Information Types

| Value | Name |
|---|---|
| 0 | VALUE — Current port value |
| 1 | MODE_INFO — Mode count + input/output mode bitmasks |
| 2 | ALLOWED_MODE_COMBINATIONS — Which modes can be combined |

### Mode Information Types

| Value | Name | Data |
|---|---|---|
| 0x00 | NAME | String (up to 11 chars + null) |
| 0x01 | RAW | min float, max float |
| 0x02 | PCT | min float, max float |
| 0x03 | SI | min float, max float |
| 0x04 | SYMBOL | String (unit symbol) |
| 0x05 | MAPPING | mappingOutput byte, mappingInput byte |
| 0x80 | VALUE_FORMAT | count, type, figures, decimals |

### Value Format Types

| Value | Name | Size per dataset |
|---|---|---|
| 0 | TYPE_8BIT | 1 byte |
| 1 | TYPE_16BIT | 2 bytes |
| 2 | TYPE_32BIT | 4 bytes |
| 3 | TYPE_FLOAT | 4 bytes (IEEE 754) |

### Input Format Setup (Single)

Wire: `[length, hubID, 0x41, portID, mode, deltaInterval(4 LE), notificationEnabled(1)]`

### Virtual Port Setup

- **Connect:** `[length, hubID, 0x61, 0x01, portA, portB]`
- **Disconnect:** `[length, hubID, 0x61, 0x00, portID]`

### Combined Input Format SubCommands

| Value | Name |
|---|---|
| 1 | SET_MODE_AND_DATA |
| 2 | LOCK |
| 3 | UNLOCK_AND_START_MULTI_UPDATE_ENABLED |
| 4 | UNLOCK_AND_START_MULTI_UPDATE_DISABLED |
| 6 | RESET |

### BLE Transport

- **Send strategies:** NoAck (0), SoftAck (1), HardAck (2)
- **Transmitter priority:** Queued (0), Immediately (1)
- **MTU negotiation:** Via `WriteMTUSize` / `CurrentAttMtu`

---

## WDX Protocol

### WDX Properties

| ID (hex) | ID (dec) | Name | Access |
|---|---|---|---|
| 0x01 | 1 | ConnectionParameterUpdateReq | Set |
| 0x02 | 2 | CurrentConnectionParameters | Get |
| 0x03 | 3 | DisconnectReq | Set |
| 0x04 | 4 | ConnectionSecurityLevel | Get |
| 0x05 | 5 | SecurityReq | Set |
| 0x06 | 6 | ServiceChanged | — |
| 0x07 | 7 | DeleteBonds | Set |
| 0x08 | 8 | CurrentAttMtu | Get |
| 0x09 | 9 | PhyUpdateReq | Set |
| 0x0A | 10 | CurrentPhy | Get |
| 0x20 | 32 | BatteryLevel | Get |
| 0x21 | 33 | DeviceModel | Get |
| 0x22 | 34 | FirmwareRevision | Get |
| 0x23 | 35 | EnterDiagnosticMode | Set |
| 0x24 | 36 | DiagnosticModeComplete | Get |
| 0x25 | 37 | DisconnectAndReset | Set |
| 0x26 | 38 | DisconnectConfigureFotaAndReset | Set |
| 0x80 | 128 | HubLocalName | Get/Set |
| 0x81 | 129 | UserVolume | Get/Set |
| 0x82 | 130 | CurrentWriteOffset | Get |
| 0x84 | 132 | PrimaryMacAddress | Get |
| 0x85 | 133 | UpgradeState | Get |
| 0x86 | 134 | SignedCommandNonce | Get |
| 0x87 | 135 | SignedCommand | Set (signed) |
| 0x88 | 136 | UpdateState | Get |
| 0x89 | 137 | PipelineStage | Get |
| 0x90 | 144 | UXSignal | Set |
| 0x91 | 145 | OwnershipProof | Get |
| 0x93 | 147 | ChargingState | Get |
| 0x95 | 149 | FactoryReset | Set (signed) |
| 0x96 | 150 | TravelMode | Set |

### WDX Command Byte Format

Property read: `[0x01, register]`
Property write: `[0x02, register, ...data]`
Property response: `[0x03, register, ...data]`

### WDX File System

| Handle | Name | Permissions | Purpose |
|---|---|---|---|
| FileList | FileList | Read | List all files |
| Firmware | Firmware | Write | Firmware upload |
| FaultLog | FaultLog | Read, Erase | Crash/fault data |
| Asset0 | Slot0 | Read, Write | Asset storage |
| Asset1 | Slot1 | Read, Write | Asset storage |
| Telemetry | Telemetry | Read, Erase | Usage telemetry |

### File Types

| Value | Name |
|---|---|
| 0 | Bulk (complete file) |
| 1 | Stream (streaming data) |

### File Permissions (flags)

| Bit | Name |
|---|---|
| 1 | Read |
| 2 | Write |
| 4 | Erase |
| 8 | Verify |

### WDX Transfer Constants

- **Max chunk size (FTD):** 100 bytes
- **Max asset space:** ~7 MB (7,331,280 bytes)

### WDX State Machine

```
Abort(0) → TimeoutAbort(1)
Upload(2) → PrepareChunk(3) → AwaitChunkUploadRequestResponse(5) → UploadChunk(6) → AwaitChunkUploadedResponse(7) → Done(8)
RequestFile(10) → GetFileResponse(11) → ReadData(12) → RequestData(14) → EndOfFile(19) → EndOfFileReceived(20)
PropertyRequest(21) → AwaitPropertyResponse(22) / SetProperty(23)
VerifyFile(24) → SendVerifyRequest(25) → GetVerifyResponse(26)
EraseFile(28) → SendEraseFileRequest(29) → GetEraseFileResponse(30)
GetWriteOffset(31) → AwaitWriteOffset(32)
SignCommandRequest(33) → SignCommandResponse(34)
SendReboot(27)
```

### File Verification / Erase Status

| Value | Status |
|---|---|
| 0 | Success |
| 1 | Failure |

### WDX Firmware Header

```
Format, Flags, Length, Checksum, Signature,
Product (AudioBrick=0, PanelCharger=1),
HardwareVersion, UpgradeVersion,
SegmentTableOffset, SegmentTableCount
```

### UpgradeState

| Value | Name |
|---|---|
| 0 | Ready |
| 1 | InProgress |
| 2 | LowBattery |

---

## OAD Protocol

### OAD Image Header (44 bytes)

| Offset | Size | Field |
|---|---|---|
| 0x00 | 8 | Identification (e.g., "CC26x2R1", "LEGO 33") |
| 0x08 | 4 | CRC-32 |
| 0x0C | 1 | BIM Version |
| 0x0D | 1 | Header Version |
| 0x0E | 2 | Wireless Technology |
| 0x10 | 8 | Image Information |
| 0x18 | 4 | Validation |
| 0x1C | 4 | Image Length |
| 0x20 | 8 | Program Entry Address + padding |
| 0x28 | 8 | Software Version |
| 0x30 | 4 | End Address |
| 0x34 | 2 | Header Length |
| 0x36 | 2 | Reserved |

### OAD Image Types

| Value | Name |
|---|---|
| 1 | APP |
| 2 | STACK |
| 3 | APP_STACK_MERGED |
| 4 | NETWORK_PROC |
| 5 | BLE_FACTORY_IMAGE |
| 6 | BIM |
| 17 | Journey Sound File (custom, "LEGO 33") |

### OAD Image Identification Strings

| String | Chip |
|---|---|
| `"OAD IMG "` | CC2640R2 |
| `"CC26x2R1"` | CC26x2R1 |
| `"CC13x2R1"` | CC13x2R1 |
| `"LEGO 33"` | Journey sound files |

### OAD Client States

```
Initializing(0) → PeripheralNotConnected(1) → OadServiceMissingOnPeripheral(2) → Ready(3)
→ GetDeviceTypeCommandSent(4) → GetDeviceTypeResponseReceived(5)
→ BlockSizeRequestSent(6) → GotBlockSizeResponse(7)
→ HeaderSent(8) → HeaderOk(9) / HeaderFailed(10)
→ OadProcessStartCommandSent(11) → ImageTransfer(12) → ImageTransferOk(14) / ImageTransferFailed(13)
→ EnableOadImageCommandSent(15) → CompleteFeedbackOk(16) / CompleteFeedbackFailed(17)
→ OadCompleteIncludingDisconnect(19)
```

### OAD Update Modes

| Value | Name |
|---|---|
| 0 | ViaRequestEnterBootMode (standard) |
| 1 | ViaDirectOADMode (direct, no boot mode) |

---

## P11 RPC Protocol

### RPC Message Types

| Value | Name |
|---|---|
| 0 | Request |
| 1 | Response |
| 2 | Notification |
| 3 | Event |

### RPC Request Format (MessagePack)

```
{ MsgId: uint, Hash: uint, Params: <serialized> }
```

`Hash` = CRC hash of RPC procedure name via `RpcNameHashAlgorithm.ComputeHash(string)`.

### RPC Response Format

```
{ MsgId: uint, Error: RpcResponseErrorCode?, Result: <serialized> }
```

### RPC Event Format

```
{ Hash: uint, Data: <serialized> }
```

### RPC Error Codes

| Value | Name |
|---|---|
| -1 | MethodNotFound |
| -2 | MethodParamsInvalid |
| -3 | RpcServerInternal |
| -10 | App |
| -11 | NotImplemented |
| -12 | Busy |
| -13 | Memory |
| -14 | Lookup |
| -15 | OutOfRange |
| -16 | Value |
| -17 | Timeout |

### JAM Protocol Wrapper

JAM wraps RPC messages with routing:

```
{ Channel: flags, SourceTime?: bytes, Source: bytes, Destination: bytes, Data: RPC payload }
```

Channel flags:
| Bit | Name |
|---|---|
| 1 | IsBroadcast |
| 2 | HasSrcTime |
| 4 | DoNotUse |
| 8 | SrcIsDst |
| 16-128 | Virtual4-7 |

Stack: **BLE → P11 GATT → JAM framing → MessagePack RPC**

---

## BLE GATT UUIDs

### LWP3 (LEGO Wireless Protocol v3)

| UUID | Name |
|---|---|
| `00001623-1212-efde-1623-785feabcd123` | LWP3 Service |
| `00001624-1212-efde-1623-785feabcd123` | LWP3 Characteristic (read/write/notify) |
| `00001625-1212-efde-1623-785feabcd123` | LWP3 Bootloader Service |
| `00001626-1212-efde-1623-785feabcd123` | LWP3 Bootloader Characteristic |

### WDX (Wireless Data Exchange)

| UUID | Name |
|---|---|
| `0000fef6-0000-1000-8000-00805f9b34fb` | WDX Service (current) |
| `0000fc96-0000-1000-8000-00805f9b34fb` | WDX Service (old) |
| `005f0002-2ff2-4ed5-b045-4c7463617865` | DeviceControl characteristic |
| `005f0003-2ff2-4ed5-b045-4c7463617865` | FileTransferControl (FTC) |
| `005f0004-2ff2-4ed5-b045-4c7463617865` | FileTransferData (FTD) |
| `005f0005-2ff2-4ed5-b045-4c7463617865` | Authentication |

### P11 RPC

| UUID | Name |
|---|---|
| `005F0001-3FF2-4ED5-B045-4C7463617865` | P11 Service |
| `005F0009-3FF2-4ED5-B045-4C7463617865` | P11 Tx (app → hub) |
| `005F000A-3FF2-4ED5-B045-4C7463617865` | P11 Rx (hub → app) |

### OAD (Over-Air Download)

| UUID | Name |
|---|---|
| `f000ffc0-0451-4000-b000-000000000000` | OAD Service |
| `f000ffc1-0451-4000-b000-000000000000` | ImageNotify |
| `f000ffc2-0451-4000-b000-000000000000` | ImageBlockRequest |
| `f000ffc3-0451-4000-b000-000000000000` | Count |
| `f000ffc4-0451-4000-b000-000000000000` | Status |
| `f000ffc5-0451-4000-b000-000000000000` | Control |

---

## Hub Services

### LWP3 Services (port-based, IOType-mapped)

| Service | IOType(s) | Description |
|---|---|---|
| BasicMotorService | 1, 2, 41, 86, 87 | Motor power control |
| RGBLightService | 23 | RGB LED color control |
| SoundPlayerService | 42 | Tone/sound playback |
| ColorSensorService | 43, 255 | Color detection |
| VoltageSensorService | 20 | Voltage measurement |
| CurrentSensorService | 21 | Current measurement |
| TechnicThreeAxisOrientationSensorService | 59 | Accelerometer/gyro |
| LeafGameEngineService | 70 | LEAF game engine |
| JourneyGameEngineService | 90 | Journey game engine |

### WDX Services (AudioBrick only)

| Service | Description |
|---|---|
| FirmwareUpdateService | Firmware upload, battery, charging, UXSignal, travel mode |
| TelemetryService | Download/erase telemetry |
| FaultLogService | Download/erase fault logs |
| WdxSecurityService | Ownership, factory reset, telemetry consent |

---

## Motor Reference

### BasicMotorService

```
SendPower(motorPower: int)  // -100 to +100
```

Mode 0 (DirectPower) only. Works for: WeDo Motor (1), Train Motor (2), DUPLO Train Motor (41), Move Hub Drive (86), Move Hub Front (87).

### Tacho Motors (protocol-level, no high-level service)

IOTypes: 38, 39, 46, 47, 48, 49, 65, 75, 76

Mode names:
- Mode 0: `LPF2-M-POW` (Power)
- Mode 1: `LPF2-M-SPD` (Speed feedback)
- Mode 2: `LPF2-M-POS` (Position feedback)

Move Hub internal motors (86, 87):
- Mode 0: `Power`
- Mode 1: `Speed`
- Mode 2: `Pos`

Controlled via PortOutputCommand sub-commands:
- `START_SPEED (0x07)` — speed + maxPower + endState
- `SPEED_FOR_TIME (0x09)` — speed + time(ms) + maxPower + endState
- `START_SPEED_FOR_DEGREES (0x0B)` — speed + degrees + maxPower + endState
- `GOTO_ABSOLUTE_POSITION (0x0D)` — speed + absPosition + maxPower + endState
- `SET_ACC_TIME (0x05)` — acceleration ramp time (ms)
- `SET_DEC_TIME (0x06)` — deceleration ramp time (ms)
- `PRESET_ENCODER (0x14)` — reset position to 0

End states: Float (0x00), Hold/Brake (0x01), Brake (0x7F)

---

## Sensor Reference

### ColorSensorService

IOTypes: DuploTrainColorSensor (43), JourneyColorSensor (255)

| Mode | Name | Data Type |
|---|---|---|
| 0 | Color | LightColor enum (0-10) |
| 1 | Tag | int |
| 2 | Reflection | int |
| 3 | RGBRaw | LEGOValue (float[3]) |

### VoltageSensorService

IOType: Voltage (20). Mode 0: `MilliVolts` → float

### CurrentSensorService

IOType: Current (21). Mode 0: `MilliAmp` → float

### TechnicThreeAxisOrientationSensorService

IOType: Technic3AxisOrientationSensor (59)

| Mode | Name | Data Type |
|---|---|---|
| 0 | Rotation | (float x, float y, float z) |
| 1 | Impact | float (count) |

### WeDo 2.0 Tilt Sensor (IOType 34)

| Mode | Name |
|---|---|
| 0 | LPF2-ANGLE |
| 1 | LPF2-TILT |
| 2 | LPF2-CRASH |

### WeDo 2.0 Motion Sensor (IOType 35)

| Mode | Name |
|---|---|
| 0 | LPF2-DETECT |
| 1 | LPF2-COUNT |

### Boost Vision Sensor (IOType 37)

| Mode | Name | Description |
|---|---|---|
| 0 | LPF2-COLOR | Color ID |
| 1 | LPF2-DETECT | Proximity detection |
| 2 | LPF2-COUNT | Count |
| 3 | LPF2-REFL | Reflection |
| 4 | LPF2-AMB | Ambient light |
| 5 | LPF2-COLOUT | Color output (LED control) |
| 6 | LPF2-RAWRGB | Raw RGB values |
| 7 | LPF2-IRTX | IR transmit |
| 8 | LPF2-DEBUG | Debug |
| 9 | LPF2-CAL | Calibration |

### Internal 3-Axis Tilt (IOType 40)

| Mode | Name |
|---|---|
| 0 | TILT |
| 1 | ORIENT |
| 2 | ANGLE |
| 3 | IMPACT |
| 4 | ACCEL |
| 5 | ORICFG |
| 6 | IMPCFG |
| 7 | FACCAL |

Default poll interval for all sensors: **500ms**

---

## Light & Display Reference

### RGBLightService (IOType 23)

```
SendLightColor(color: LightColor)           // Mode 0 (Discrete) — indexed color
SendRawRGB(red: byte, green: byte, blue: byte)  // Mode 1 (Absolute) — raw RGB
```

Uses sub-commands `SET_RGB_COLOR_NO (0x40)` and `SET_RGB_RAW (0x41)`.

### LightColor Enum

| Value | Name |
|---|---|
| 0 | Off / Black |
| 1 | Pink |
| 2 | Purple |
| 3 | Blue |
| 4 | Cyan |
| 5 | Green |
| 6 | LightGreen |
| 7 | Yellow |
| 8 | Orange |
| 9 | Red |
| 10 | White |

### Other Light IOTypes

- **Light (8):** Simple on/off, protocol-level only
- **ChargingLight (78):** Charging indicator, protocol-level only
- **MoveHubLEDControl (88):** Move Hub LED, protocol-level only
- **GeckoLEDMatrix (64):** 3x3 LED matrix (SPIKE Essential), protocol-level only

---

## Sound Reference

### SoundPlayerService (IOType 42)

```
PlayTone(tone: SoundPlayerTone)     // Mode 0
PlaySound(sound: SoundPlayerSound)  // Mode 1
```

### SoundPlayerTone

| Value | Name |
|---|---|
| 0 | Stop |
| 3 | Low |
| 9 | Medium |
| 10 | High |

### SoundPlayerSound

| Value | Name |
|---|---|
| 0 | Stop |
| 3 | Sound1 |
| 5 | Sound2 |
| 7 | Sound3 |
| 9 | Sound4 |
| 10 | Sound5 |

### Custom Sound Transfer (JourneyGameEngine)

Sound data is transferred via OAD:
1. Pad sound data to nearest 128 bytes
2. Wrap in OAD file (image type 17, identification "LEGO 33")
3. Transfer via WDX chunked upload

Audio sample rates: **8kHz, 16kHz, 22kHz**

---

## Game Engine Reference

### JourneyGameEngineService (IOType 90)

#### Ingress Events (App → Hub)

**Type 0xF0 (App):**

| Descriptor | Name | Payload |
|---|---|---|
| 1 | AppConnected | — |
| 2 | PowerOffTimeout | ushort timeout |

**Type 0x01 (Control):**

| Descriptor | Name | Payload |
|---|---|---|
| 1 | SetMotorSpeedForwards | sbyte speed |
| 2 | SetMotorSpeedBackwards | sbyte speed |
| 3 | StopMotor | — |
| 4 | SetLightColor | RGBColor value |
| 5 | UpdateCustomSound | — |
| 6 | SelectActionBrickBehaviour | SpecialActionBrickBehaviour value |
| 7 | StartSignalBehaviour | — |

#### Egress Events (Hub → App)

| Event | Data Type |
|---|---|
| CurrentMotorSpeed | ushort |
| SelectedLightColor | ushort |
| SelectedActionBrickBehaviour | ushort |
| PowerOffTimeout | ushort |

#### Game Engine Event Message Format (4 bytes)

```
[Type(1), Descriptor(1), Payload(2 LE)]
```

#### SpecialActionBrickBehaviour

| Value | Name |
|---|---|
| 0 | Default |
| 1 | Beach |
| 2 | Cafe |
| 3 | Lullaby |
| 4 | Birthday |
| 5 | WeatherChange |
| 6 | CustomSound |

#### RGBColor (Journey-specific palette)

| Value | Name |
|---|---|
| 0 | NoColor |
| 1 | White |
| 2 | BrightRed |
| 3 | BrightBlue |
| 4 | BrightYellow |
| 5 | DarkGreen |
| 6 | BrightGreen |
| 7 | BrightYellowishGreen |
| 8 | FlameYellowishOrange |
| 9 | DarkAzure |
| 10 | MediumLavender |
| 11 | VibrantCoral |
| 12 | ReddishOrange |

### Public Methods

```
NotifyAppConnected() → Task
SetPowerOffTimeout(timeout: ushort) → Task
SelectActionBrickBehaviour(behaviour: SpecialActionBrickBehaviour) → Task
SetMotorSpeed(speed: sbyte) → Task           // -128 to +127
StopMotor() → Task
SetLightColor(color: RGBColor) → Task
StartSignalBehaviour() → Task
TransferActionBrickSoundAsync(soundData: byte[], progress, ct) → Task
```

### LeafGameEngineService (IOType 70)

| Mode | Name | Description |
|---|---|---|
| 0 | CHAL | Challenges |
| 1 | VERS | Versions |
| 2 | EVENTS | Events (GameEngineEventMessage format) |

No additional public methods beyond base `GameEngineService`.

### GameEngineService Base

```
Versions: ServiceModeValueRequester<VersionComposite>
Events: GameEngineEventTransceiver
EnableEventsMode()
ParseVersions(legoValue: LEGOValue) → VersionComposite
```

---

## Firmware Update Reference

### FirmwareUpdateService (WDX)

```
UploadFirmwareAsync(data: byte[], progress, ct, reboot = true) → UploadFirmwareResult
GetUpdateState(ct) → byte[]           // 20-byte SHA-1 hash
GetUpgradeState(ct) → UpgradeState    // Ready=0, InProgress=1, LowBattery=2
GetPipelineStage(ct) → byte           // Pipeline stage number
GetBatteryLevel(ct) → byte            // 0-100%
GetChargingState(ct) → ChargingState  // { IsCharging: bool, Rate: byte }
SetUXSignal(signal: short, ct) → Task
SetTravelMode(ct) → Task
RebootAndConfigureOverTheAirFirmwareAsync(ct) → Task    // FOTA reboot
RebootWithoutConfiguringOverTheAirFirmwareAsync(ct) → Task  // Plain reboot
```

### Upload Flow

1. Check `GetUpgradeState()` == Ready (0)
2. `UploadFirmwareAsync(data)` → chunked WDX upload to Firmware handle
3. Verify uploaded firmware
4. `RebootAndConfigureOverTheAirFirmwareAsync()` → sets DisconnectConfigureFotaAndReset (0x26)

### UploadFirmwareResult

| Value | Name |
|---|---|
| 0 | NotReadyUpgradeState |
| 1 | NoUpdateState |
| 2 | NoAvailableFirmware |
| 3 | UploadedFirmware |

### Known Firmware Versions

| Path | Description |
|---|---|
| `hw3-customer_p11_smartbrick-upgrade-v0.72.3` | HW3 customer |
| `hw3-developer_p11_smartbrick-upgrade-v0.71.0` | HW3 developer |
| `hw4-customer_p11_smartbrick-upgrade-v0.72.1` | HW4 customer |
| `hw4-developer_p11_smartbrick-upgrade-v0.70.0` | HW4 developer |
| `pch_v1.79.0` | Panel Charger |

### WdxHeaderProduct

| Value | Product |
|---|---|
| 0 | AudioBrick |
| 1 | PanelCharger |

---

## Security & Signed Commands

### Backend-Signed Commands (require LEGO server)

| Type | Value | Description |
|---|---|---|
| Unlock | 1 | Unlock hub |
| EnableTelemetryConsent | 2 | Enable/disable telemetry |
| FactoryReset | 3 | Factory reset |
| StartFirmwareUpgrade | 4 | Start firmware upgrade |

### Device-Signed Commands (hub signs, server verifies)

| Type | Value | Description |
|---|---|---|
| Ownership | 1 | Ownership proof |
| ReowningSuspensionStatus | 2 | Check reowning cooldown |

### Signing Flow

1. App reads nonce from `SignedCommandNonce` (0x86) property
2. App sends `[nonce, elementId, command]` to LEGO cloud (`/commands/sign`)
3. Server returns ECDSA P-256 signature
4. App writes signed command to `SignedCommand` (0x87) property
5. Hub verifies and executes

### SignStatus

| Value | Name |
|---|---|
| 0 | Error |
| 1 | Verify (success) |

### Ownership

- `OwnershipProof` — hub generates device-signed command, app sends to LEGO cloud for verification
- `ReowningSuspensionStatus` — cooldown period after ownership transfer (includes `RelationId`, `Description`, `SuspensionRemaining`)

### Element Relations

| Value | Name |
|---|---|
| 0 | OwnerUnder16 |
| 1 | OwnerOver16 |
| 2 | ParentToOwnerUnder16 |
| 3 | ParentToOwnerOver16 |
| 4 | NotRelated |
| 5 | Unowned |
| 6 | P11SuperUser |
| 7 | P11RetailUser |
| 8 | Unknown |

---

## Backend APIs

| URL | Purpose |
|---|---|
| `https://p11.bilbo.lego.com` | Smart Brick backend |
| `https://aup.bilbo.lego.com` | Firmware update server |
| `https://act.bilbo.lego.com/api/v1/telemetry/upload` | Telemetry upload |
| `https://external.bilbo.lego.com/api/v1/topics/{id}/{sub}` | Content API |
| `https://identity.lego.com` | LEGO ID auth |

### Battery Types

| Value | Name |
|---|---|
| 0 | Normal |
| 1 | Rechargeable |
| 255 | Invalid |

### Battery Charging Status

| Value | Name |
|---|---|
| 0 | Charging |
| 1 | Charged |
| 255 | Invalid |

### Connection States

| Value | Name |
|---|---|
| -1 | Stale |
| 0 | Idle |
| 1 | Connecting |
| 3 | Connected |

### BLE Connection States

| Value | Name |
|---|---|
| 0 | Disconnected |
| 1 | Connecting |
| 2 | ConnectedGATTPending |
| 3 | FullyConnected |
