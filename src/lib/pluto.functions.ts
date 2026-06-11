import { createServerFn } from "@tanstack/react-start";
import type { Channel, Show } from "./channels";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Stable per-process UUID used as the Pluto device identifier.
const PLUTO_DEVICE_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });

const PLUTO_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Referer: "https://pluto.tv/",
  Origin: "https://pluto.tv",
};

// ---------------------------------------------------------------------------
// Boot / session-token flow
//
// Pluto's stitcher rejects any playback request where the `sid` query param
// is missing or empty, returning an error slate ("no longer available on this
// device").  A valid session token is obtained by calling boot.pluto.tv/v4/start
// BEFORE the channels API.  We cache it for 55 minutes so the server doesn't
// re-boot on every channel refresh.
// ---------------------------------------------------------------------------

type PlutoBootResponse = {
  sessionToken?: string;
  stitcherURL?: string;
};

let sessionCache: { token: string; expiresAt: number } | null = null;

async function getSessionToken(): Promise<string> {
  const now = Date.now();
  if (sessionCache && sessionCache.expiresAt > now) {
    return sessionCache.token;
  }

  const params = new URLSearchParams({
    appName: "web",
    appVersion: "5.0.0",
    deviceVersion: "1",
    deviceType: "web",
    deviceMake: "Chrome",
    deviceModel: "web",
    clientID: PLUTO_DEVICE_ID,
    clientModelNumber: "1.0.0",
    serverSideAds: "true",
    marketingRegion: "US",
    userId: "",
    deviceLat: "40.71",
    deviceLon: "-74.01",
  });

  const res = await fetch(`https://boot.pluto.tv/v4/start?${params}`, {
    headers: PLUTO_HEADERS,
    redirect: "follow",
  });

  if (!res.ok) throw new Error(`Pluto boot returned HTTP ${res.status}`);

  const data = (await res.json()) as PlutoBootResponse;
  const token = data.sessionToken;
  if (!token) throw new Error("Pluto boot response missing sessionToken");

  sessionCache = { token, expiresAt: now + 55 * 60 * 1000 };
  console.log("[Pluto] session token obtained");
  return token;
}

// Inject `sid` into a stitcher URL that has `sid=` (empty) as a safety net in
// case the channels API doesn't fill it when we pass &sid=… in the query.
function withSid(url: string, sid: string): string {
  if (!sid) return url;
  // Replace empty sid= in query string
  if (url.includes("sid=&") || url.endsWith("sid=")) {
    return url.replace(/([\?&]sid=)(&|$)/, `$1${encodeURIComponent(sid)}$2`);
  }
  // Append if completely absent
  if (!url.includes("sid=")) {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}sid=${encodeURIComponent(sid)}`;
  }
  return url;
}

// ---------------------------------------------------------------------------
// Channel target map
// ---------------------------------------------------------------------------

const TARGETS: Record<
  string,
  { id: string; emoji: string; color: string; displayName: string; genres: string[] }
> = {
  "NonStop Kung Fu": {
    id: "pluto-kung-fu",
    emoji: "🥋",
    color: "#dc2626",
    displayName: "Pluto · Kung Fu",
    genres: ["Kung Fu"],
  },
  "Happy Days": {
    id: "pluto-classic-tv",
    emoji: "📻",
    color: "#0d9488",
    displayName: "Pluto · Classic TV",
    genres: ["Classic TV"],
  },
  "CBS News 24/7": {
    id: "pluto-news",
    emoji: "📰",
    color: "#2563eb",
    displayName: "Pluto · News 24/7",
    genres: ["News"],
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type PlutoTimeline = {
  start: string;
  stop: string;
  title: string;
  episode?: {
    genre?: string;
    subGenre?: string;
    clip?: { originalReleaseDate?: string };
  };
};

type PlutoChannel = {
  name: string;
  slug?: string;
  category?: string;
  stitched?: { urls?: Array<{ type?: string; url: string }> };
  timelines?: PlutoTimeline[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function yearFrom(t: PlutoTimeline): number | undefined {
  const d = t.episode?.clip?.originalReleaseDate;
  if (!d) return undefined;
  const y = new Date(d).getUTCFullYear();
  return y > 1900 ? y : undefined;
}

function toShow(t: PlutoTimeline): Show {
  const colonIdx = t.title.indexOf(": ");
  const title = colonIdx > 0 ? t.title.slice(colonIdx + 2) : t.title;
  return {
    title,
    year: yearFrom(t),
    genre: t.episode?.subGenre || t.episode?.genre,
    startTime: t.start,
  };
}

function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return hslToHex(h % 360, 55, 42);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
      .toString(16)
      .padStart(2, "0");
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ---------------------------------------------------------------------------
// Primary: Pluto channels API (with boot session)
// ---------------------------------------------------------------------------

async function fetchFromApi(sid: string): Promise<Channel[]> {
  const now = new Date();
  const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  const params = new URLSearchParams({
    start: now.toISOString(),
    stop: stop.toISOString(),
    deviceLat: "40.71",
    deviceLon: "-74.01",
    appName: "web",
    appVersion: "5.0.0",
    deviceType: "web",
    deviceMake: "Chrome",
    deviceModel: "web",
    deviceVersion: "1",
    deviceId: PLUTO_DEVICE_ID,
    sid,
  });

  const res = await fetch(`https://api.pluto.tv/v2/channels?${params}`, {
    headers: PLUTO_HEADERS,
  });
  if (!res.ok) {
    console.warn("[Pluto] channels API returned", res.status);
    return [];
  }

  const data = (await res.json()) as PlutoChannel[];
  const featured: Channel[] = [];
  const catalog: Channel[] = [];

  for (const c of data) {
    const hls = c.stitched?.urls?.find((u) => u.type === "hls" || u.url.endsWith(".m3u8"));
    if (!hls) continue;
    const timelines = (c.timelines ?? []).slice(0, 4);
    if (timelines.length === 0) continue;

    // Ensure sid is present in the stitcher URL
    const streamUrl = withSid(hls.url, sid);

    const meta = TARGETS[c.name];
    if (meta) {
      featured.push({
        id: meta.id,
        name: meta.displayName,
        emoji: meta.emoji,
        color: meta.color,
        schedule: timelines.map(toShow),
        streamUrl,
        source: "Pluto TV",
        genres: meta.genres,
      });
    } else {
      catalog.push({
        id: `pluto-${c.slug ?? c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        name: c.name,
        emoji: "📺",
        color: colorFromString(c.name),
        schedule: timelines.map(toShow),
        streamUrl,
        source: "Pluto TV",
        genres: [c.category?.trim() || "General"],
        defaultOff: true,
      });
    }
  }

  const order = Object.values(TARGETS).map((m) => m.id);
  featured.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  catalog.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`[Pluto] API: ${featured.length} featured + ${catalog.length} catalog channels`);
  return [...featured, ...catalog];
}

// ---------------------------------------------------------------------------
// Fallback: community M3U playlist (no session required, no sid)
// ---------------------------------------------------------------------------

async function fetchFromM3U(): Promise<Channel[]> {
  const url =
    "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/plutotv_us.m3u";
  try {
    const res = await fetch(url, { headers: { Accept: "text/plain" } });
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    const featured: Channel[] = [];
    const catalog: Channel[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith("#EXTINF")) continue;
      const commaIdx = line.lastIndexOf(",");
      if (commaIdx < 0) continue;
      const name = line.slice(commaIdx + 1).trim();
      const groupMatch = /group-title="([^"]*)"/.exec(line);
      const idMatch = /channel-id="([^"]*)"/.exec(line);
      const category = groupMatch?.[1]?.trim() || "General";
      const chId = idMatch?.[1] || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      let streamUrl: string | undefined;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next || next.startsWith("#")) continue;
        streamUrl = next;
        i = j;
        break;
      }
      if (!streamUrl) continue;

      const schedule: Show[] = [{ title: name, genre: category }];
      const meta = TARGETS[name];
      if (meta) {
        featured.push({
          id: meta.id,
          name: meta.displayName,
          emoji: meta.emoji,
          color: meta.color,
          schedule,
          streamUrl,
          source: "Pluto TV",
          genres: meta.genres,
        });
      } else {
        catalog.push({
          id: `pluto-${chId}`,
          name,
          emoji: "📺",
          color: colorFromString(name),
          schedule,
          streamUrl,
          source: "Pluto TV",
          genres: [category],
          defaultOff: true,
        });
      }
    }

    const order = Object.values(TARGETS).map((m) => m.id);
    featured.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    catalog.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[Pluto] M3U: ${featured.length} featured + ${catalog.length} catalog channels`);
    return [...featured, ...catalog];
  } catch (err) {
    console.error("[Pluto] M3U fallback failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Server function
// ---------------------------------------------------------------------------

export const fetchPlutoChannels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Channel[]> => {
    let sid = "";
    try {
      sid = await getSessionToken();
    } catch (err) {
      console.warn("[Pluto] boot failed, continuing without session token:", err);
    }

    try {
      const channels = await fetchFromApi(sid);
      if (channels.length > 0) return channels;
      console.warn("[Pluto] API returned no channels, trying M3U fallback");
    } catch (err) {
      console.error("[Pluto] API fetch failed:", err);
    }

    return fetchFromM3U();
  },
);

// ---------------------------------------------------------------------------
// Stream resolver (server-side redirect follower for Pluto stitcher URLs)
// ---------------------------------------------------------------------------

import { z } from "zod";

const PLUTO_STREAM_HEADERS: Record<string, string> = {
  Accept: "*/*",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  Origin: "https://pluto.tv",
  Referer: "https://pluto.tv/",
};

export const resolvePlutoStream = createServerFn({ method: "POST" })
  .inputValidator(z.object({ url: z.string().url() }))
  .handler(async ({ data }): Promise<{ url: string }> => {
    try {
      const res = await fetch(data.url, {
        headers: PLUTO_STREAM_HEADERS,
        redirect: "follow",
      });
      if (!res.ok) {
        console.warn("[Pluto] resolve non-ok", res.status, data.url);
        return { url: data.url };
      }
      const finalUrl = res.url || data.url;
      const ctype = (res.headers.get("content-type") ?? "").toLowerCase();
      const looksLikeManifest =
        ctype.includes("mpegurl") || finalUrl.toLowerCase().includes(".m3u8");
      if (!looksLikeManifest) return { url: finalUrl };

      const text = await res.text();
      for (const [i, line] of text.split(/\r?\n/).entries()) {
        if (!line.startsWith("#EXT-X-STREAM-INF")) continue;
        const lines = text.split(/\r?\n/);
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j].trim();
          if (!next || next.startsWith("#")) continue;
          try {
            const abs = new URL(next, finalUrl).toString();
            console.log("[Pluto] resolved variant", { input: data.url, resolved: abs });
            return { url: abs };
          } catch {
            return { url: finalUrl };
          }
        }
      }
      return { url: finalUrl };
    } catch (err) {
      console.error("[Pluto] resolve failed", err);
      return { url: data.url };
    }
  });
