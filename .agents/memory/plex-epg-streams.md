---
name: Plex EPG streams
description: How to get live stream URLs from Plex's free TV (EPG) for the Surf TV app — and two proxy bugs that break playback
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
For items with `Media.Part.key` (with or without `.m3u8`):
```
const abs = partKey.startsWith("http") ? partKey : `${EPG_BASE}${partKey}`;
return `${abs}?X-Plex-Token=${encodeURIComponent(token)}&X-Plex-Client-Identifier=${CLIENT_ID}`;
```
Items without `Media.Part.key` are **skipped** — the transcoding endpoint on `epg.provider.plex.tv` does not work (it's a metadata server, not a transcoder).

## HLS proxy: token stripping bug
`rewriteManifest` calls `new URL(relative, base)` which **drops the base query string**.
So `X-Plex-Token` and `X-Plex-Client-Identifier` are silently stripped from all rewritten
relative segment/variant URLs → segments get 401s.

**Fix:** `appendStickyParams` in `hls.ts` re-attaches auth params to every rewritten URL when `isPlexHost()` is true. Pass a `stickyParams: URLSearchParams` with the two Plex params extracted from `targetUrl` into `rewriteManifest`.

**Pattern applies to:** any upstream that embeds auth in URL query params where manifests use relative segment references.

## Channel display
- `defaultOff` should be `false` (or omitted) so Plex channels appear immediately after login.
- Use `item.grandparentTitle` as channel name for episodes; `item.title` as the current schedule title.

**Why:** The EPG hub items contain real `.m3u8` part URLs embedded in `Media.Part.key`, but the 500-char log truncation cut them off, causing early confusion that no stream URL was available. Two silent bugs (broken transcoding + token stripping) caused a subset of channels to fail in playback even when the URL was present.

**How to apply:** When refreshing Plex channels, call `epg.provider.plex.tv/hubs` first to get hub keys, then fetch `whatsOnNow?count=100` and extract `Media.Part.key` from each item.
