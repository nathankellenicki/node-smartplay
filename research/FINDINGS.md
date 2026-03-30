# LEGO Smart Play - Reverse Engineering Findings

## Protocol Overview

LEGO Smart Play ("Smart Brick") uses a BLE register-based command/response protocol over a Cypress/Wiced Smart FEF6 service. The protocol was reverse-engineered from Android HCI btsnoop captures of the `com.lego.smartassist` app.

## BLE Service & Characteristic UUIDs

| Name | UUID |
|------|------|
| Primary Service (FEF6) | `0000fef6-0000-1000-8000-00805f9b34fb` |
| Control Point | `005f0002-2ff2-4ed5-b045-4c7463617865` |
| Data Channel 1 | `005f0003-2ff2-4ed5-b045-4c7463617865` |
| Data Channel 2 | `005f0004-2ff2-4ed5-b045-4c7463617865` |
| Data Channel 3 | `005f0005-2ff2-4ed5-b045-4c7463617865` |
| Custom Service | `005f0001-3ff2-4ed5-b045-4c7463617865` |
| Bidirectional Channel | `005f000a-3ff2-4ed5-b045-4c7463617865` |
| Service Changed | `00002a05-0000-1000-8000-00805f9b34fb` |

## Command Types

| Type | Value | Description |
|------|-------|-------------|
| Read | `0x01` | Read a register |
| Write | `0x02` | Write to a register |
| Response | `0x03` | Response to a read/write |

## Register Map (from `IWdxProtocolProcessor.Properties` enum in Il2CppDumper)

### BLE Connection Properties (0x01-0x0A)

| Register | Hex | Direction | Description |
|----------|-----|-----------|-------------|
| ConnectionParameterUpdateReq | `0x01` | Write | Request BLE connection parameter update |
| CurrentConnectionParameters | `0x02` | Read | Current BLE connection parameters |
| DisconnectReq | `0x03` | Write | Request disconnect |
| ConnectionSecurityLevel | `0x04` | Read | Current connection security level |
| SecurityReq | `0x05` | Write | Request security/pairing |
| ServiceChanged | `0x06` | Read | GATT service changed indication |
| DeleteBonds | `0x07` | Write | Delete bonding information |
| CurrentAttMtu | `0x08` | Read | Current ATT MTU (usually `f400` = 244, sometimes `1400` = 20) |
| PhyUpdateReq | `0x09` | Write | Request PHY update (1M/2M/Coded) |
| CurrentPhy | `0x0A` | Read | Current PHY setting |

### Device Info (0x20-0x26)

| Register | Hex | Direction | Description |
|----------|-----|-----------|-------------|
| BatteryLevel | `0x20` | Read | Battery level (0-100%) |
| DeviceModel | `0x21` | Read | Device model identifier |
| FirmwareRevision | `0x22` | Read | Firmware version string (e.g. "2.29.2") |
| EnterDiagnosticMode | `0x23` | Write | Trigger diagnostic mode |
| DiagnosticModeComplete | `0x24` | Read | Diagnostic mode completion signal |
| DisconnectAndReset | `0x25` | Write | Disconnect and reset device |
| DisconnectConfigureFotaAndReset | `0x26` | Write | Disconnect, configure FOTA, and reset |

### Hub Properties (0x80-0x96)

| Register | Hex | Direction | Description |
|----------|-----|-----------|-------------|
| HubLocalName | `0x80` | Read | Device name (UTF-8, always "Smart Brick") |
| UserVolume | `0x81` | Read/Write | Volume level: Low=10, Medium=40, High=100 |
| CurrentWriteOffset | `0x82` | Read | Current write offset for file transfers |
| PrimaryMacAddress | `0x84` | Read | BLE MAC address (6 bytes) |
| UpgradeState | `0x85` | Read | Firmware upgrade state: 0=Ready, 1=InProgress, 2=LowBattery |
| SignedCommandNonce | `0x86` | Read | Authentication nonce (8 bytes) — triggers BLE pairing |
| SignedCommand | `0x87` | Write | Authentication payload (75 bytes, see Auth section) |
| UpdateState | `0x88` | Read | 20-byte SHA-1 hash (device identity fingerprint, same across bricks) |
| PipelineStage | `0x89` | Read | Build pipeline stage (dev/qa/staging/release) |
| UXSignal | `0x90` | Write | Keepalive / UX signal (`ea 00`, fire-and-forget) |
| OwnershipProof | `0x91` | Write | Ownership proof command |
| ChargingState | `0x93` | Read | Charging state (IsCharging flag + Rate byte) |
| FactoryReset | `0x95` | Write | Factory reset trigger (requires signed command) |
| TravelMode | `0x96` | Read/Write | Travel/shipping mode |

### Volume Levels

| Level | Value | Hex |
|-------|-------|-----|
| Low | 10 | `0x0a` |
| Medium | 40 | `0x28` |
| High | 100 | `0x64` |

## Connection Lifecycle

1. **BLE Connect** - Connect to peripheral, discover FEF6 service
2. **CCCD Subscribe** - Subscribe to characteristics in order:
   - Bidirectional channel
   - Control point
   - Data channels 1, 2, 3
   - Service changed
3. **Handshake** - Read identity registers:
   - Read 0x22 (firmware version)
   - Read 0x81 (volume)
   - Read 0x84 (MAC address)
   - Read 0x80 (device name)
4. **Setup** - Configure device:
   - Write 0x90 keepalive (`ea 00`, fire-and-forget)
   - Read 0x08 (device config)
5. **Authentication** - ECDSA challenge-response:
   - Read 0x86 (auth nonce, 16 bytes)
   - Compute ECDSA P-256 signature over `SHA256(nonce || 0x020201)`
   - Write 0x87 (64-byte signature: r || s)
6. **Polling Loop** (500ms interval):
   - Read 0x93 (connection state)
   - Write 0x90 (keepalive)
   - Read 0x20 (battery level)

## Authentication Protocol

### ECDSA P-256 Signature Scheme

The Smart Brick uses ECDSA P-256 to authenticate the controlling app.

**Nonce:** 8 bytes from register 0x86. Each brick has a pool of 4-5 fixed nonces it cycles through across sessions.

**Message signed:** `SHA256(nonce[8] || 0x020201)`

**Register 0x87 write format (75 bytes total):**
```
[0:8]   nonce echo (8 bytes, copied from register 0x86)
[8:11]  command suffix: 02 02 01
[11:43] ECDSA r value (32 bytes, big-endian)
[43:75] ECDSA s value (32 bytes, big-endian)
```

### Recovered Public Key (from captured signatures)

Using ECDSA public key recovery from 6 captured nonce/signature pairs:

```
X: 7002e81f364ee278e005f9dcbf8e4805137c6013b7cda4aab1d9c1fa3f39cd9b
Y: 2706d1bd9c81af2ab6d7ced72a4804235d1c865250fd722f8480a505388b6097
```

Uncompressed: `04 7002e81f...cd9b 2706d1bd...6097`

The public key was confirmed present in the Smart Brick firmware images bundled in the Unity Addressable asset bundles (in the firmware's crypto verification section).

### Private Key: SERVER-SIDE ONLY

**The ECDSA private key is NOT in the APK.** It lives on LEGO's backend servers. See "Signing Architecture" below.

## Manufacturer Data

The Smart Brick advertises with LEGO company identifier `0x0397` in the BLE manufacturer data field (little-endian in first 2 bytes).

---

## App Architecture (com.lego.smartassist)

The LEGO SmartAssist Android app is a **Unity IL2CPP** application:

| Component | Size | Description |
|-----------|------|-------------|
| `base.apk` | 119 MB | Unity assets, managed DLL metadata, sharedassets |
| `split_UnityDataAssetPack.apk` | 102 MB | Unity Addressable bundles (firmware images, configs) |
| `split_config.arm64_v8a.apk` | 41 MB | ARM64 native libraries (`libil2cpp.so`) |

### IL2CPP Metadata

- **Version:** 31
- **Binary:** `libil2cpp.so` (125 MB, ARM64)
- **Metadata:** `global-metadata.dat` (16 MB)
- **Il2CppDumper output:** Successfully dumped with v6.7.46 (note: "This file may be protected" warning)

---

## Signing Architecture (CONFIRMED via Il2CppDumper)

### CommandSigner Class (Full Decompiled Definition)

```csharp
// Namespace: Horizon.Services.Connection
// Source: Assets/Horizon/Services/Connection/CommandSigner.cs
public class CommandSigner : ICommandSigner
{
    // ONE field - an HTTP session facade, NOT a signing key
    private readonly ISessionFacade _sessionFacade;

    public void .ctor(ISessionFacade sessionFacade) { }

    // Signs by calling LEGO's backend API via HTTP
    public Task<byte[]> SignAsync(
        IBackendSignedCommand backendSignedCommand,
        byte[] nonce,
        byte[] elementId,
        CancellationToken token) { }
}
```

### SignAsync State Machine (reveals HTTP signing)

```csharp
private struct CommandSigner.<SignAsync>d__2 : IAsyncStateMachine
{
    public int <>1__state;
    public AsyncTaskMethodBuilder<byte[]> <>t__builder;
    public CommandSigner <>4__this;
    public byte[] nonce;
    public byte[] elementId;
    public IBackendSignedCommand backendSignedCommand;
    public CancellationToken token;
    private CloudHttpClient <httpClient>5__2;        // <-- HTTP client
    private HttpRequestMessage <requestMessage>5__3;  // <-- HTTP request
    private TaskAwaiter <>u__1;
    private TaskAwaiter<HttpResponseMessage> <>u__2;  // <-- Awaits HTTP response
    private TaskAwaiter<byte[]> <>u__3;               // <-- Gets signature bytes
}
```

**The signing flow:**
1. Create `CloudHttpClient`
2. Build `HttpRequestMessage` (to `api/v1/commands/sign`)
3. Apply authorization via `ISessionFacade.ApplyAuthorizationHeaderAsync()`
4. Send HTTP request to LEGO's backend
5. Await `HttpResponseMessage`
6. Read signature `byte[]` from response

### ISessionFacade (Authentication Session)

```csharp
// Namespace: Horizon.Services.Session
public interface ISessionFacade
{
    bool HasActiveSession { get; }
    bool HasPhotoSharingConsentBeenGiven();
    bool HasAnalyticsConsentBeenGiven();
    string GetAccessToken();
    Task<HttpResponse> RefreshSession();
    void ClearSession();
    Task ApplyAuthorizationHeaderAsync(HttpRequestMessage requestMessage);
    Task<string> GetValidAccessTokenAsync();
}
```

### API Endpoints

| Endpoint | Purpose |
|----------|---------|
| `api/v1/commands/sign` | Signs device commands (ECDSA P-256) |
| `api/v1/elements/register` | Register a brick element |
| `api/v1/elements/owned` | List owned elements |
| `api/v1/elements/deregister?element_id_format=binary` | Deregister element |
| `api/v1/elements/claim/reject?element_id_format=binary` | Reject ownership claim |
| `api/v1/elements/relation` | Element relations |
| `api/v1/onetime` | One-time operations |

Base URL pattern: `https://{0}.{1}` (dynamically constructed)
Known domains: `p11.bilbo.lego.com`, `c.scout.services.lego.com`, `scout.services.webqa.lego.com`

### EnigmaQA API (Internal QA/Crypto Service)

```
/asymmetric/sign               - Sign data with asymmetric key
/asymmetric/public/key/{key}   - Get public key
/spkit/{element_id}            - Get SPKIT bundle for element
/symmetric/encode              - Symmetric encryption
/symmetric/shared/key/{key}    - Shared symmetric key
```

Parameters: `digestFormat`, `signatureFormat`, `elementIdFormat`, `nonceFormat`, `macLength`, `macInFront`, `encodingType`, `outputFormat`

---

## WDX Protocol (Wireless Data Exchange)

### Overview

The WDX protocol is part of the LEGO Connect Kit SDK (`com.lego.sdk.dpt.connectkit@97ba24556983`). It handles secure command execution over BLE.

### Command Types

#### Backend-Signed Commands (require LEGO server)
| Type | Value | Description |
|------|-------|-------------|
| Unlock | 1 | Unlock device |
| EnableTelemetryConsent | 2 | Enable telemetry |
| FactoryReset | 3 | Factory reset |
| StartFirmwareUpgrade | 4 | Start firmware OTA |

#### Device-Signed Commands (local WDX protocol)
| Type | Value | Description |
|------|-------|-------------|
| Ownership | 1 | Ownership proof |
| ReowningSuspensionStatus | 2 | Re-ownership status |

### Key Classes (from Il2CppDumper)

```
WdxProtocolProcessor (internal)
  - Fields: bleConnected, handleConverter, uploadControl, signCommandControl,
            requestPropertyControl, verifyControl, setPropertyControl,
            rebootControl, fileEraseControl, fetchFileListControl,
            fetchFileControl, fetchFileHeaderControl, fetchRawFile, logger
  - Const: AttHeaderSize = 3
  - Methods: UploadAsync, VerifyAsync, GetFileListAsync, GetFileAsync,
             EraseFileAsync, RebootAndConfigureOTA, ExecuteSignedCommandAsync,
             CreateDeviceSignedCommand, GetAssetFirmwareInfo,
             RequestPropertyAsync, SetPropertyAsync, GetPayloadSizeAsync,
             RebootWithoutConfiguringOTA

WdxProtocolProvider (internal)
  - Fields: wdxProtocolProcessor, properties
  - Methods: ForceRebootWithFota, ForceReboot, GetFile, EraseFile,
             CreateDeviceSignedCommand, ExecuteBackendSignedCommand,
             UploadFirmware

SignCommandControl (internal)
  - Fields: logger, loggerFactory, bleConnected
  - Methods: VerifySignatureAndRunAsync, VerifySignatureAndRunWithoutResponseAsync,
             CreateSignatureAsync

CloudHttpClient
  - Fields: _httpClient (HttpClient)
  - Methods: .ctor(Uri baseAddress), SendAsync, ParseHeadersToDictionary, Dispose
```

### SignCommand WDX States

```
BackendSignedCommandRequestState
BackendSignedCommandResponseState
DeviceSignedCommandRequestState
DeviceSignedCommandResponseState
```

---

## WDX On-Device File System

The brick exposes 3 files via the WDX (Wireless Data Exchange) protocol. File list is requested via register 0x00 with payload `00000000000008000001`, and the response arrives as 128-byte notifications on the data channel (ATT handle 0x0248).

### File List Header (8 bytes)

```
Byte 0:   page/fragment index (0x00)
Byte 1:   first file handle (0x01)
Byte 2:   file count (0x03)
Bytes 3-7: reserved (zeros)
```

### File Entries (40 bytes each)

```
Bytes 0-1:   file handle (uint16 LE)
Bytes 2-3:   permissions (uint16 LE)
Bytes 4-7:   file size (uint32 LE)
Bytes 8-23:  file name (16 bytes, null-padded ASCII)
Bytes 24-39: version (16 bytes, null-padded ASCII)
```

### Files on Device

| Handle | Name | Version | Permissions | Size |
|--------|------|---------|-------------|------|
| 1 | Firmware | 1.0 | 0x0200 (read-only?) | 1,048,572 bytes (~1 MB) |
| 2 | FaultLog | 1.0 | 0x0500 (read/write?) | 0 bytes |
| 3 | Telemetry | 1.0 | 0x0500 (read/write?) | Variable (20-675 bytes) |

### Telemetry Data Format (TELM)

Telemetry data (fetched via register 0x03) starts with a TELM header:
```
Byte 0:     fragment index
Bytes 1-4:  "TELM" ASCII marker
Byte 5:     version (0x02)
Bytes 6-7:  reserved (0x0000)
Byte 8:     0x00 (padding)
Bytes 9-14: MAC address (6 bytes, reversed byte order)
Bytes 15-16: 0x00 separator
Bytes 17+:  encrypted telemetry payload
```

### CryptoData (Register 0x88)

20-byte value (SHA-1 size): `d43f4bca4cd6ef9972d7e7f31228f6a6c11b71f9`

Same value returned by all bricks tested. Likely a shared certificate hash or device family identity fingerprint.

---

## Other Interesting Finds

### FileStoreConfig (Local AES Encryption)

Found in Unity asset ScriptableObject:
- **IV (16 bytes):** `IXjMdcg67Xvyy5x6Z2Zh4g==` → `2178cc75c83aed7bf2cb9c7a676661e2`
- **AES Key (32 bytes):** `9q+N2+dPD5LNJc6bNqZyqdy5R0Rw+g6UM4WS+ygf2qk=` → `f6af8ddbe74f0f92cd25ce9b36a672a9dcb9474470fa0e94338592fb281fdaa9`

Used for local encrypted storage of app data.

### Firmware Images (in Unity Addressable Bundles)

Found in `split_UnityDataAssetPack.apk`:
- `hw4-customer_p11_smartbrick-upgrade-v0.72.1`
- `p11_smartbrick-upgrade-v0.66.1-hw4`
- `p11_smartbrick-upgrade-v0.46.0-hw4`
- Various test/bad-CRC variants

The public key (X + Y coordinates) is embedded in the firmware binary at a fixed offset, within the crypto/key verification section.

### App Configuration

- App Client ID: `lego-p11-parental-app`
- Search Key: `UKv5cJOTxIa7NkycMtIV97VfBZEPHn66oKHblSF5`
- LEGO ID OAuth: `82d723e8-d205-4dd3-a35c-c5c450f75e42`
- OAuth Scopes: `openid profile offline_access ott urn:lego-group:family-relation:relations:user.read`

### Backend Services

| Service | URL |
|---------|-----|
| Identity | `https://identity.lego.com` |
| Telemetry | `https://act.bilbo.lego.com` |
| Smart Play | `https://p11.bilbo.lego.com` |
| ADAC | `https://prod.adac.i.lego.com` |
| External | `https://external.bilbo.lego.com` |
| Error Logs | `https://parental-app-error-logs.s3.eu-central-1.amazonaws.com` |

---

## Private Key Search Log

### Approach 1: Hex Strings in IL2CPP Metadata (FAILED)

Extracted all 479 unique 64-character hex strings from `global-metadata.dat`. Tested each as a P-256 private key candidate by deriving the public key and comparing to the recovered public key.

**Result:** 0 matches out of 479 candidates.

### Approach 2: Raw Public Key Bytes in Binary (FAILED)

Searched `libil2cpp.so` (125 MB) for the first 8 bytes of the public key X coordinate in both big-endian and little-endian byte order.

**Result:** Not found in the native binary. (Later confirmed present in firmware images.)

### Approach 3: Base64-Encoded Keys in Binary (FAILED)

Used `strings` to extract all 44-character base64 strings from `libil2cpp.so`. Found no results.

### Approach 4: PEM/ECDSA String Search in Binary (FAILED)

Searched for `BEGIN.*KEY`, `signing.?key`, `ecdsa`, `p.?256`, `secp256r1`, `private.?key`, `CommandSigner` in the binary strings.

**Result:** No relevant matches (only .NET TLS cipher suite names and AWS SDK strings).

### Approach 5: Unity Asset Bundles (COMPLETED)

Pulled all 3 APK splits from Android device. Searched all Unity assets. Found configuration data, firmware images with public key, AES keys for local storage, but no ECDSA private key.

### Approach 6: Base64-Encoded Keys in Metadata (FAILED)

Found 119 base64 strings in `global-metadata.dat` that decode to exactly 32 bytes. All were coincidental matches (ASCII text that happens to be valid base64).

### Approach 7: IL2CPP String Literals (FAILED)

Extracted all 23,281 string literals from the metadata. Found only 1 hex string (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` - SHA-256 of empty string). No base64-encoded 32-byte keys. No PEM keys.

### Approach 8: Il2CppDumper Class Analysis (CONCLUSIVE)

Ran Il2CppDumper v6.7.46 to dump all class definitions. **CommandSigner has NO signing key field** - only an `ISessionFacade` for HTTP API access. The `SignAsync` state machine creates a `CloudHttpClient` and `HttpRequestMessage`, confirming the signing is done via HTTP to `api/v1/commands/sign`.

**Conclusion: The ECDSA P-256 private key never leaves LEGO's backend servers. The app sends the nonce to the backend via HTTP and receives the signed response. The key is not recoverable from the APK.**

### Approach 9: ECDSA Nonce (k) Reuse Attack (FAILED)

If the signing server reuses the random `k` value for two different messages, the private key can be recovered algebraically:
- `k = (z1 - z2) / (s1 - s2) mod n`
- `d = (s1*k - z1) / r mod n`

Extracted 6 unique ECDSA signatures from btsnoop captures (`android_hci_battery.btsnoop` and `android_hci_volume.btsnoop`). All signatures verified correctly against the known public key, confirming the extraction was correct.

**Register 0x87 write format (75 bytes):**
```
[0:8]   nonce echo (8 bytes from register 0x86)
[8:11]  command suffix: 02 02 01
[11:43] ECDSA r value (32 bytes, big-endian)
[43:75] ECDSA s value (32 bytes, big-endian)
```

**Message signed:** `SHA256(nonce[8] || 0x020201)`

**Captured signatures (all unique r values — no reuse):**

| # | Nonce | r (first 8 hex) | s (first 8 hex) |
|---|-------|-----------------|-----------------|
| 1 | `551fad8ea0992d48` | `6700ac2d...` | `321081f1...` |
| 2 | `175bbc38a67a5128` | `5b4b59d9...` | `5ba39c66...` |
| 3 | `c8397678253cb6ee` | `492942a3...` | `d4fb750d...` |
| 4 | `b0f143ae5e663ee4` | `44fd6b92...` | `c94ebfa4...` |
| 5 | `93a8021a0fd61c66` | `2fd381d3...` | `43467ba4...` |
| 6 | `04330bff43767799` | `3002032c...` | `5082d699...` |

**Result:** All 6 r values are distinct. LEGO's signing server uses proper random k values. Private key cannot be recovered from captured signatures.

---

## Overall Conclusion

The ECDSA P-256 private key is held exclusively on LEGO's backend servers (`api/v1/commands/sign` on `p11.bilbo.lego.com`). It is not present in:
- The APK native binary (`libil2cpp.so`)
- The IL2CPP metadata (`global-metadata.dat`)
- Unity asset bundles or firmware images
- The captured BLE traffic (signatures use unique random nonces)

The app authenticates to LEGO's backend via OAuth (LEGO ID), then proxies signing requests through the HTTP API. Without access to the backend or a server-side vulnerability, the private key is not recoverable.

**What works without auth:** BLE connection, handshake (firmware version, MAC, name), keepalive, battery polling, volume read. These all function without a valid signature on register 0x87.

**What requires auth:** Unlock, factory reset, firmware upgrade, telemetry consent (all `BackendSignedCommand` types).
