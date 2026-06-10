// Server-side Plex live-channel fetching. Runs on the server so CORS
// restrictions on *.provider.plex.tv subdomains are irrelevant.

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Channel } from "./channels";

const CLIENT_ID = "surftv-app";
const PRODUCT = "Surf TV";
const EPG_BASE = "https://epg.provider.plex.tv";

function plexHeaders(token: string) {
  return {
    "X-Plex-Client-Identifier": CLIENT_ID,
    "X-Plex-Product": PRODUCT,
    "X-Plex-Platform": "Web",
    "X-Plex-Version": "1.0.0",
    "X-Plex-Token": token,
    Accept: "application/json",
  };
}

function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const sat = 65;
  const light = 48;
  const a = (sat / 100) * Math.min(light / 100, 1 - light / 100);
  const f = (n: number) => {
    const k = (n + hue / 30) % 12;
    const c = light / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MediaItem = {
  ratingKey?: string;
  key?: string;
  title?: string;
  studio?: string;
  type?: string;
  grandparentTitle?: string;
  Media?: Array<{ Part?: Array<{ key?: string }> }>;
};

type EpgHub = {
  hubIdentifier?: string;
  title?: string;
  key?: string;
  Metadata?: MediaItem[];
};

type EpgContainer = {
  librarySectionID?: string;
  Hub?: EpgHub[];
  Metadata?: MediaItem[];
};

// ---------------------------------------------------------------------------
// Stream URL construction
// ---------------------------------------------------------------------------

function transcodingUrl(path: string, token: string): string {
  const p = new URLSearchParams({
    path,
    hasMDE: "1",
    mediaIndex: "0",
    partIndex: "0",
    protocol: "hls",
    fastSeek: "1",
    directPlay: "0",
    directStream: "1",
    copyts: "1",
    "X-Plex-Platform": "Web",
    "X-Plex-Product": PRODUCT,
    "X-Plex-Client-Identifier": CLIENT_ID,
    "X-Plex-Token": token,
  });
  return `${EPG_BASE}/video/:/transcode/universal/start.m3u8?${p}`;
}

function buildStreamUrl(item: MediaItem, token: string): string | undefined {
  // Option 1: explicit Media.Part.key (channel item with media directly attached)
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  if (partKey) {
    if (partKey.includes(".m3u8")) {
      const abs = partKey.startsWith("http") ? partKey : `${EPG_BASE}${partKey}`;
      const sep = abs.includes("?") ? "&" : "?";
      return `${abs}${sep}X-Plex-Token=${encodeURIComponent(token)}&X-Plex-Client-Identifier=${CLIENT_ID}`;
    }
    return transcodingUrl(partKey, token);
  }

  // Option 2: EPG episode — use item.key with transcoding endpoint
  // "What's On Now" hub items have key=/library/metadata/{ratingKey}
  if (item.key) {
    return transcodingUrl(item.key, token);
  }

  return undefined;
}

function itemToChannel(item: MediaItem, token: string, prefix: string): Channel | null {
  const streamUrl = buildStreamUrl(item, token);
  if (!streamUrl) return null;

  const id = `${prefix}:${item.ratingKey ?? item.title}`;

  // For episodes: use show name as the channel name (lean-back TV experience)
  // For other types: use the item title
  const isEpisode = item.type === "episode";
  const channelName = isEpisode
    ? (item.grandparentTitle ?? item.title ?? "Plex Live")
    : (item.title ?? "Plex Channel");
  const scheduleTitle = isEpisode
    ? (item.title ?? item.grandparentTitle ?? "Live")
    : (item.title ?? "Live");

  return {
    id,
    name: channelName,
    emoji: "📺",
    color: colorFromString(id),
    source: "Plex",
    genres: [item.studio ?? "Live TV"],
    streamUrl,
    schedule: [{ title: scheduleTitle, genre: item.studio ?? "Live TV" }],
  };
}

// ---------------------------------------------------------------------------
// EPG channel fetching
// ---------------------------------------------------------------------------

async function fetchEpgChannels(token: string): Promise<Channel[]> {
  const headers = plexHeaders(token);

  // Step 1: get hubs to discover section ID and hub keys
  let sectionId = "home";
  let hubKeys: string[] = [];

  try {
    const r = await fetch(`${EPG_BASE}/hubs`, { headers });
    if (r.ok) {
      const d = await r.json() as { MediaContainer?: EpgContainer };
      const c = d.MediaContainer;
      if (c?.librarySectionID) sectionId = c.librarySectionID;
      hubKeys = (c?.Hub ?? []).map((h) => h.key ?? "").filter(Boolean);
      console.log(`[Plex] EPG sectionId="${sectionId}" hubs:${c?.Hub?.length ?? 0}`);
    } else {
      console.warn("[Plex] EPG /hubs:", r.status);
    }
  } catch (err) {
    console.warn("[Plex] EPG /hubs error:", err);
  }

  // Step 2: try section-based channel listing (types Plex uses for live channels)
  for (const type of [4, 1, 2]) {
    try {
      const r = await fetch(
        `${EPG_BASE}/library/sections/${sectionId}/all?type=${type}&offset=0`,
        { headers },
      );
      if (!r.ok) continue;
      const d = await r.json() as { MediaContainer?: EpgContainer };
      const items = d.MediaContainer?.Metadata ?? [];
      if (items.length === 0) continue;
      const channels = items
        .map((item) => itemToChannel(item, token, "plex-epg"))
        .filter((c): c is Channel => !!c);
      if (channels.length > 0) {
        console.log(`[Plex] EPG section type=${type} channels:`, channels.length);
        return channels;
      }
    } catch {
      /* try next type */
    }
  }

  // Step 3: fallback — fetch "What's On Now" and other live hubs
  // Prioritise hubs with live/now keywords; try up to 4 hubs total
  const liveFirst = [
    ...hubKeys.filter((k) => /whatsOn|airingNow|live|now/i.test(k)),
    ...hubKeys.filter((k) => !/whatsOn|airingNow|live|now/i.test(k)),
  ].slice(0, 4);

  for (const hubKey of liveFirst) {
    try {
      const r = await fetch(`${EPG_BASE}${hubKey}?count=100`, { headers });
      if (!r.ok) continue;
      const d = await r.json() as { MediaContainer?: EpgContainer };
      const items = d.MediaContainer?.Metadata ?? [];
      if (items.length === 0) continue;
      const channels = items
        .map((item) => itemToChannel(item, token, "plex-epg-hub"))
        .filter((c): c is Channel => !!c);
      if (channels.length > 0) {
        console.log(`[Plex] EPG hub "${hubKey}" channels:`, channels.length);
        return channels;
      }
    } catch {
      /* try next hub */
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Server function — callable from the browser, runs server-side
// ---------------------------------------------------------------------------
export const fetchAllPlexChannels = createServerFn({ method: "POST" })
  .inputValidator(z.object({ token: z.string() }))
  .handler(async ({ data }): Promise<Channel[]> => {
    const { token } = data;
    const channels = await fetchEpgChannels(token).catch((e) => {
      console.error("[Plex] EPG failed:", e);
      return [] as Channel[];
    });
    console.log(`[Plex] total channels: ${channels.length}`);
    return channels;
  });
