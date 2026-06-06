import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import type { Channel, Show } from "./channels";

// Three Pluto channels we surface in Surf TV.
// Mapping: exact Pluto channel name -> Surf TV presentation.
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
  stitched?: { urls?: Array<{ type?: string; url: string }> };
  timelines?: PlutoTimeline[];
};

function yearFrom(t: PlutoTimeline): number | undefined {
  const d = t.episode?.clip?.originalReleaseDate;
  if (!d) return undefined;
  const y = new Date(d).getUTCFullYear();
  return y > 1900 ? y : undefined;
}

function toShow(t: PlutoTimeline): Show {
  // Strip the leading "Show: " prefix Pluto adds (e.g. "Happy Days: The Duel" -> "The Duel")
  const colonIdx = t.title.indexOf(": ");
  const title = colonIdx > 0 ? t.title.slice(colonIdx + 2) : t.title;
  return {
    title,
    year: yearFrom(t),
    genre: t.episode?.subGenre || t.episode?.genre,
    startTime: t.start,
  };
}

export const fetchPlutoChannels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Channel[]> => {
    const now = new Date();
    const stop = new Date(now.getTime() + 2 * 60 * 60 * 1000);
    // Include deviceLat/deviceLon (NYC) + appName so Pluto returns the US lineup
    // when called from regions where the default lookup yields zero channels
    // (e.g. Cloudflare Workers in non-US PoPs).
    const url =
      `https://api.pluto.tv/v2/channels?start=${now.toISOString()}&stop=${stop.toISOString()}` +
      `&deviceLat=40.71&deviceLon=-74.01&appName=web&appVersion=5.0.0&deviceType=web&deviceMake=Chrome&deviceModel=web&deviceVersion=1`;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
          Referer: "https://pluto.tv/",
        },
      });
      if (!res.ok) return [];
      const data = (await res.json()) as Array<PlutoChannel & { category?: string }>;

      const featured: Channel[] = [];
      const catalog: Channel[] = [];

      for (const c of data) {
        const hls = c.stitched?.urls?.find((u) => u.type === "hls" || u.url.endsWith(".m3u8"));
        if (!hls) continue;
        const timelines = (c.timelines ?? []).slice(0, 4);
        if (timelines.length === 0) continue;

        const meta = TARGETS[c.name];
        if (meta) {
          featured.push({
            id: meta.id,
            name: meta.displayName,
            emoji: meta.emoji,
            color: meta.color,
            schedule: timelines.map(toShow),
            streamUrl: hls.url,
            source: "Pluto TV",
            genres: meta.genres,
          });
          continue;
        }

        const category = c.category?.trim() || "General";
        catalog.push({
          id: `pluto-${c.slug ?? c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
          name: c.name,
          emoji: "📺",
          color: colorFromString(c.name),
          schedule: timelines.map(toShow),
          streamUrl: hls.url,
          source: "Pluto TV",
          genres: [category],
          defaultOff: true,
        });
      }

      // Featured first (in TARGETS order), then the rest alphabetically.
      const order = Object.values(TARGETS).map((m) => m.id);
      featured.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      catalog.sort((a, b) => a.name.localeCompare(b.name));
      const combined = [...featured, ...catalog];
      if (combined.length > 0) return combined;
      // API returned no playable channels (geo-restricted from this region);
      // fall through to the community M3U fallback below.
    } catch (err) {
      console.error("Pluto fetch failed:", err);
    }
    return await fetchPlutoFromM3U();
  },
);

async function fetchPlutoFromM3U(): Promise<Channel[]> {
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
      // Find next non-empty, non-comment line as the stream URL.
      let streamUrl: string | undefined;
      for (let j = i + 1; j < lines.length; j++) {
        const next = lines[j].trim();
        if (!next) continue;
        if (next.startsWith("#")) continue;
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
    return [...featured, ...catalog];
  } catch (err) {
    console.error("[Pluto] M3U fallback failed:", err);
    return [];
  }
}

function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  // Deterministic HSL → hex
  return hslToHex(hue, 55, 42);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))))).toString(16).padStart(2, "0");
  return `#${f(0)}${f(8)}${f(4)}`;
}

// Resolve a Pluto stream URL to the final, playable variant URL.
// - Follows redirects (jmp2.uk → stitcher.pluto.tv → siloh CDN) server-side
//   with the Origin/Referer headers Pluto's edge requires.
// - If the response is a master HLS playlist, picks the first variant URL and
//   returns its absolute CDN URL — bypassing stitcher.pluto.tv entirely so the
//   browser fetches segments directly from the CDN.
const PLUTO_FETCH_HEADERS: Record<string, string> = {
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
        headers: PLUTO_FETCH_HEADERS,
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
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].startsWith("#EXT-X-STREAM-INF")) continue;
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