# LEGO Smart Play — Backend API

> **Note:** Backend details come from the SmartAssist APK (Il2CppDumper class dumps, Unity asset configs) and direct probing of the Bilbo API's unauthenticated endpoints. The OpenAPI spec is publicly exposed at `/openapi.json`. Authenticated endpoint behaviour is inferred from class definitions, not direct observation. Some details may be wrong.

## Overview

The companion app communicates with LEGO's backend at `p11.bilbo.lego.com` — a FastAPI (Python/uvicorn) server internally called "CPL Bilbo API". The full OpenAPI spec is exposed at `/openapi.json` and documentation at `/redoc`.

Authentication is via JWT bearer tokens from LEGO ID (`identity.lego.com`, OpenID Connect). The app's OAuth client ID is `lego-p11-parental-app`.

## Endpoints

| Method | Path | Auth Required | Description |
| --- | --- | --- | --- |
| `POST` | `/commands/sign` | Yes | Sign a command — returns raw ECDSA signature bytes |
| `POST` | `/elements/register` | Yes | Claim ownership of a brick (starts reowning suspension if already owned) |
| `DELETE` | `/elements/deregister` | Yes | Deregister an owned brick |
| `POST` | `/elements/relation` | Yes | Get ownership relation for a list of element IDs |
| `POST` | `/elements/owned` | **No** | Check if bricks are owned — accepts MAC addresses |
| `POST` | `/elements/claim/reject` | Yes | Reject an ownership claim |
| `POST` | `/telemetry/upload` | Yes | Upload telemetry file (multipart, stored in S3) |
| `GET` | `/update/{current_state}/probe` | **No** | Check for firmware updates |
| `GET` | `/update/{current_state}/download` | Yes | Download firmware update |
| `GET` | `/releases/{update_state}/probe` | **No** | Get release info |
| `GET` | `/releases/{update_state}/download` | Yes | Download firmware bundle |
| `POST` | `/topics/{topic_name}/{locale}` | Yes | Fetch topic/content data |

## Element Identification

Bricks are identified by their MAC address (from register `0x84`) in colon-separated hex format, e.g. `"9C:9A:C0:46:68:4A"`. The OUI prefix `9C:9A:C0` is LEGO-specific.

## Command Signing

The `/commands/sign` endpoint is how the app obtains ECDSA P-256 signatures for brick authentication. The app sends the nonce (from register `0x86`) and element ID to the backend, and receives the 64-byte signature to write to register `0x87`. See [PROTOCOL.md](PROTOCOL.md) for the BLE-side authentication flow.

**The ECDSA private key is held exclusively on LEGO's servers.** It is not in the APK, the firmware images, or the BLE traffic. Decompilation of the app's `CommandSigner` class confirms it's just an HTTP client — no key material. It posts to `/commands/sign` with an OAuth header and returns the signature bytes. Analysis of 6 captured signatures confirmed proper random `k` values (all `r` values distinct), ruling out nonce-reuse recovery. This is the main barrier to third-party implementations of locked features (unlock, factory reset, firmware upgrade, telemetry consent).

## Ownership Model

The API defines 8 ownership relations:

| Relation | ID | Description |
| --- | --- | --- |
| `OWNER_O16` | 1 | Owner (over 16) |
| `OWNER_U16` | 2 | Owner (under 16) |
| `PARENT_TO_OWNER_U16` | 3 | Parent of under-16 owner |
| `PARENT_TO_OWNER_O16` | 4 | Parent of over-16 owner |
| `NOT_RELATED` | 5 | No relation |
| `UNOWNED` | 6 | Brick is not owned |
| `P11_SUPER_USER` | 128 | Super user |
| `P11_RETAIL_USER` | 129 | Retail user |

There is a "reowning suspension" flow when transferring ownership between accounts.

## Unauthenticated Endpoints

`/elements/owned` responds without authentication — given a list of brick MAC addresses, it returns whether each is registered:

```
POST /elements/owned
Content-Type: application/json

{"element_ids": ["9C:9A:C0:46:68:4A"]}

→ {"message": "OK", "status_code": 200, "ownership_map": {"9C:9A:C0:46:68:4A": true}}
```

`/update/{current_state}/probe` and `/releases/{update_state}/probe` also respond without auth but currently return "No new update available" and "Release does not exist" respectively for all tested version strings.

## Other Known Backend Services

| Service | URL |
| --- | --- |
| Identity / OAuth | `https://identity.lego.com` |
| Telemetry | `https://act.bilbo.lego.com` |
| Smart Play | `https://p11.bilbo.lego.com` |
| External Content | `https://external.bilbo.lego.com` |
