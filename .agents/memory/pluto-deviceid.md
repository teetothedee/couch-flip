---
name: Pluto session + deviceId
description: Pluto TV requires a boot session token (sid) AND a stable UUID deviceId — both must be present in stitcher URLs or it returns "no longer available on this device"
---

## The rules
1. Call `boot.pluto.tv/v4/start?...&clientID={deviceId}&...` first to get a `sessionToken`.
2. Pass `&sid={sessionToken}` in `api.pluto.tv/v2/channels?...` — the returned stitcher URLs will then have `sid` filled in.
3. Use `withSid(url, sid)` as a safety net to inject `sid` into any stitcher URL where it came back empty.
4. Cache the session token for 55 min to avoid re-booting on every channel refresh.

## `PLUTO_DEVICE_ID`
Generated once per process via `crypto.randomUUID()` (stable within a server session). Used as `clientID` in boot and `deviceId` in channels API.

## Without sid
Pluto's stitcher serves an error slate video ("no longer available on this device") instead of real content. This is NOT an HTTP error — it's a silent content substitution. The stream will "play" but show the error message.

**Why:** Pluto's stitcher is authenticated at the session level. Without `sid`, the device is treated as anonymous/unregistered and gets blocked content.

**How to apply:** Always call `getSessionToken()` before `fetchFromApi()`. The session cache handles 55-min TTL automatically.
