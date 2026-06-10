---
name: Pluto deviceId fix
description: Pluto TV requires a stable UUID deviceId in API requests or it returns "device not available"
---

## The rule
All Pluto TV stitcher API calls must include `&deviceId={UUID}` where UUID is a real stable v4 UUID.

## Implementation
A constant `PLUTO_DEVICE_ID` UUID is defined in `src/lib/pluto.functions.ts` and appended to every stitcher URL.

**Why:** Without a valid UUID deviceId, Pluto's stitcher returns an error indicating the device is not registered/available.

**How to apply:** Always append `&deviceId=${PLUTO_DEVICE_ID}` to Pluto stitcher API request URLs.
