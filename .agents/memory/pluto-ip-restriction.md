---
name: Pluto TV datacenter IP restriction
description: Pluto's regular stitcher serves takedown-slate content to cloud/datacenter IPs; Samsung TV Plus embed stitcher bypasses this.
---

## Rule
Never use Pluto's regular stitcher (`/v2/stitch/hls/`) as the stream URL from a server-side proxy. It embeds the client IP in the session JWT and intentionally serves `ptv_takedownslates_all_1500` error video to cloud/datacenter IPs (e.g. GCP, AWS) — even with a valid session token.

**Why:** Pluto's stitcher encodes `clientIP` in the JWT. At segment-fetch time it detects datacenter CIDR blocks and routes those sessions to an error slate video rather than rejecting outright. The session token itself is valid; only the content routing differs.

**How to apply:** Use `jmp2.uk/plu-{channelId}.m3u8` URLs (from the community M3U) as the stream source instead. These redirect to `/v2/stitch/embed/hls/channel/{id}/master.m3u8?deviceType=samsung-tvplus&authToken=PARTNER_JWT` — a Samsung TV Plus partner embed that uses a static partner token with no IP check.

**Implementation pattern:**
- `fetchM3UUrlMap()` → `Map<channelId, jmp2Url>` (parse BuddyChewChew M3U)
- `fetchFromApi()` still provides schedule/metadata; just replaces `streamUrl` with `m3uUrls.get(c._id) ?? withSid(hls.url, sid)`
- Run M3U fetch + boot in parallel (`Promise.all`) so neither blocks the other
