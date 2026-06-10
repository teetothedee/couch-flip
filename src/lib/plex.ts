// Client-side Plex integration. Runs in the browser because the Plex.tv
// public API supports CORS for these endpoints and the auth flow needs a
// popup window tied to the user gesture.

import type { Channel } from "./channels";

const CLIENT_ID = "surftv-app";
const PRODUCT = "Surf TV";
const TOKEN_KEY = "surf-tv:plex-token";

const PLEX_HEADERS = {
  "X-Plex-Client-Identifier": CLIENT_ID,
  "X-Plex-Product": PRODUCT,
  "X-Plex-Platform": "Web",
  "X-Plex-Version": "1.0.0",
  Accept: "application/json",
};

export function getStoredPlexToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setStoredPlexToken(token: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore quota */
  }
}

type PlexPin = { id: number; code: string; authToken: string | null };

async function requestPin(): Promise<PlexPin> {
  const res = await fetch("https://plex.tv/api/v2/pins?strong=true", {
    method: "POST",
    headers: PLEX_HEADERS,
  });
  if (!res.ok) throw new Error(`Plex PIN request failed (${res.status})`);
  return res.json();
}

async function checkPin(id: number): Promise<PlexPin> {
  const res = await fetch(`https://plex.tv/api/v2/pins/${id}`, {
    headers: PLEX_HEADERS,
  });
  if (!res.ok) throw new Error(`Plex PIN poll failed (${res.status})`);
  return res.json();
}

/**
 * Run the full Plex PIN auth flow. Must be called from a user gesture so the
 * popup is not blocked. Resolves with the authToken once the user logs in.
 */
export async function connectPlex(): Promise<string> {
  const popup = window.open("about:blank", "plex-auth", "width=520,height=720");
  if (!popup) throw new Error("Popup blocked — allow popups to connect Plex.");

  let pin: PlexPin;
  try {
    pin = await requestPin();
  } catch (err) {
    popup.close();
    throw err;
  }

  const authUrl = `https://app.plex.tv/auth#?clientID=${encodeURIComponent(
    CLIENT_ID,
  )}&code=${encodeURIComponent(pin.code)}&context%5Bdevice%5D%5Bproduct%5D=${encodeURIComponent(PRODUCT)}`;
  popup.location.href = authUrl;

  const start = Date.now();
  while (Date.now() - start < 15 * 60 * 1000) {
    if (popup.closed) {
      /* keep polling briefly */
    }
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const status = await checkPin(pin.id);
      if (status.authToken) {
        if (!popup.closed) popup.close();
        setStoredPlexToken(status.authToken);
        console.log("[Plex] auth token stored:", status.authToken);
        return status.authToken;
      }
    } catch {
      /* transient, keep polling */
    }
    if (popup.closed) break;
  }
  if (!popup.closed) popup.close();
  throw new Error("Plex login timed out.");
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
    return Math.round(255 * c)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// Live-channel fetching — uses Plex's EPG provider for their free FAST lineup
// ---------------------------------------------------------------------------

const EPG_BASE = "https://epg.provider.plex.tv";
const LINEAR_BASE = "https://linear.provider.plex.tv";

type EpgSection = { key: string; type?: string; title?: string };
type EpgItem = {
  ratingKey?: string;
  title?: string;
  studio?: string;
  thumb?: string;
  Media?: Array<{
    Part?: Array<{ key?: string }>;
  }>;
};

function buildStreamUrl(base: string, item: EpgItem, token: string): string | undefined {
  const partKey = item.Media?.[0]?.Part?.[0]?.key;
  if (!partKey) return undefined;

  // Direct .m3u8 path — append token and return
  if (partKey.includes(".m3u8")) {
    const sep = partKey.includes("?") ? "&" : "?";
    return (partKey.startsWith("http") ? partKey : `${base}${partKey}`) +
      `${sep}X-Plex-Token=${encodeURIComponent(token)}&X-Plex-Client-Identifier=${CLIENT_ID}`;
  }

  // Non-.m3u8 key — route through Plex's HLS transcoder
  const p = new URLSearchParams({
    path: partKey,
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
  return `${base}/video/:/transcode/universal/start.m3u8?${p}`;
}

/** Fetch Plex's free live/FAST channels from the EPG provider. */
async function fetchEpgChannels(token: string): Promise<Channel[]> {
  const headers = { ...PLEX_HEADERS, "X-Plex-Token": token };

  // 1. Discover sections
  let sections: EpgSection[] = [];
  try {
    const r = await fetch(`${EPG_BASE}/library/sections`, { headers });
    if (r.ok) {
      const d = await r.json();
      sections = d?.MediaContainer?.Directory ?? [];
      console.log(
        "[Plex] EPG sections:",
        sections.map((s) => ({ key: s.key, type: s.type, title: s.title })),
      );
    } else {
      console.warn("[Plex] EPG /library/sections:", r.status);
    }
  } catch (err) {
    console.warn("[Plex] EPG sections fetch failed:", err);
  }

  // Prefer a section explicitly typed/named "live"; fall back to first
  const liveSection =
    sections.find((s) => s.type === "live" || /live/i.test(s.title ?? "")) ??
    sections[0];

  if (!liveSection) {
    console.warn("[Plex] No EPG section found");
    return [];
  }

  // 2. Fetch channels from that section (type=1 = channel)
  const channelsUrl =
    `${EPG_BASE}/library/sections/${encodeURIComponent(liveSection.key)}/all` +
    `?type=1&offset=0`;
  let items: EpgItem[] = [];
  try {
    const r = await fetch(channelsUrl, { headers });
    if (r.ok) {
      const d = await r.json();
      items = d?.MediaContainer?.Metadata ?? [];
      console.log(`[Plex] EPG channels from section "${liveSection.key}": ${items.length}`);
      if (items.length > 0) {
        console.log("[Plex] EPG first channel sample:", JSON.stringify(items[0]).slice(0, 400));
      }
    } else {
      const body = await r.text().catch(() => "");
      console.warn("[Plex] EPG channels fetch:", r.status, body.slice(0, 200));
    }
  } catch (err) {
    console.warn("[Plex] EPG channels fetch failed:", err);
  }

  return items
    .map((item) => {
      const streamUrl = buildStreamUrl(EPG_BASE, item, token);
      const id = `plex-live:${item.ratingKey ?? item.title}`;
      return {
        id,
        name: item.title ?? "Plex Channel",
        emoji: "📺",
        color: colorFromString(id),
        source: "Plex",
        genres: [item.studio ?? "Live TV"],
        streamUrl,
        defaultOff: true,
        schedule: [{ title: item.title ?? "Live", genre: item.studio ?? "Live TV" }],
      } satisfies Channel;
    })
    .filter((c) => !!c.streamUrl);
}

/**
 * Fetch Plex's linear / FAST-channel hubs.
 * These are the always-on curated channels Plex streams for free.
 */
async function fetchLinearChannels(token: string): Promise<Channel[]> {
  const headers = { ...PLEX_HEADERS, "X-Plex-Token": token };

  type Hub = {
    hubIdentifier?: string;
    title?: string;
    Metadata?: EpgItem[];
    key?: string;
  };

  let hubs: Hub[] = [];
  try {
    const r = await fetch(`${LINEAR_BASE}/hubs?includeContent=1`, { headers });
    if (r.ok) {
      const d = await r.json();
      hubs = d?.MediaContainer?.Hub ?? [];
      console.log("[Plex] Linear hubs:", hubs.length);
      if (hubs.length > 0) {
        console.log("[Plex] Linear first hub sample:", JSON.stringify(hubs[0]).slice(0, 400));
      }
    } else {
      console.warn("[Plex] Linear /hubs:", r.status);
    }
  } catch (err) {
    console.warn("[Plex] Linear hubs fetch failed:", err);
  }

  const channels: Channel[] = [];
  for (const hub of hubs) {
    for (const item of hub.Metadata ?? []) {
      const streamUrl = buildStreamUrl(LINEAR_BASE, item, token);
      if (!streamUrl) continue;
      const id = `plex-linear:${item.ratingKey ?? item.title}`;
      channels.push({
        id,
        name: item.title ?? hub.title ?? "Plex Channel",
        emoji: "📺",
        color: colorFromString(id),
        source: "Plex",
        genres: [item.studio ?? "Live TV"],
        streamUrl,
        defaultOff: true,
        schedule: [{ title: item.title ?? "Live", genre: item.studio ?? "Live TV" }],
      });
    }
  }
  return channels;
}

/**
 * Main entry point called from SurfTV after login.
 * Tries EPG live sections first, then falls back to linear hubs.
 */
export async function fetchAllPlexChannels(token: string): Promise<Channel[]> {
  const [epg, linear] = await Promise.all([
    fetchEpgChannels(token).catch((e) => {
      console.error("[Plex] EPG failed:", e);
      return [] as Channel[];
    }),
    fetchLinearChannels(token).catch((e) => {
      console.error("[Plex] Linear failed:", e);
      return [] as Channel[];
    }),
  ]);

  // Merge, deduplicate by id
  const seen = new Set<string>();
  const merged: Channel[] = [];
  for (const ch of [...epg, ...linear]) {
    if (!seen.has(ch.id)) {
      seen.add(ch.id);
      merged.push(ch);
    }
  }

  console.log(`[Plex] total live channels: ${merged.length} (epg:${epg.length} linear:${linear.length})`);
  return merged;
}
