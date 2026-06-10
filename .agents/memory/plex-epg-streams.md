---
name: Plex EPG streams
description: How to get live stream URLs from Plex's free TV (EPG) for the Surf TV app
---

## The rule
`linear.provider.plex.tv` → DNS ENOTFOUND (dead hostname — do not use).
Use `epg.provider.plex.tv` instead.

## How to get channels
1. `GET https://epg.provider.plex.tv/hubs?X-Plex-Token={token}` → returns `MediaContainer.Hub[]` with `librarySectionID` (usually `"home"`) and hub `key` paths.
2. `library/sections/{sectionId}/all?type=N` endpoints all return 404 for the "home" section.
3. Best fallback: fetch the "whatsOnNow" hub — `GET https://epg.provider.plex.tv/hubs/sections/home/whatsOnNow?count=100` → returns up to 15 `MediaItem[]` objects.
4. Items are `type:"episode"` with `Media[0].Part[0].key` = `/library/parts/{id}-{timestamp}.m3u8` (direct HLS, works!).

## Stream URL construction
For items with `Media.Part.key` ending in `.m3u8`:
```
const abs = `${EPG_BASE}${partKey}`;
return `${abs}?X-Plex-Token=${encodeURIComponent(token)}&X-Plex-Client-Identifier=${CLIENT_ID}`;
```
The proxy (`plex.tv` suffix in ALLOWED_HOST_SUFFIXES) covers `epg.provider.plex.tv`.

## Channel display
- `defaultOff` should be `false` (or omitted) so Plex channels appear immediately after login.
- Use `item.grandparentTitle` as channel name for episodes; `item.title` as the current schedule title.

**Why:** The EPG hub items contain real `.m3u8` part URLs embedded in `Media.Part.key`, but the 500-char log truncation cut them off, causing early confusion that no stream URL was available.

**How to apply:** When refreshing Plex channels, call `epg.provider.plex.tv/hubs` first to get hub keys, then fetch `whatsOnNow?count=100` and extract `Media.Part.key` from each item.
