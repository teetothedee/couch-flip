import { createServerFn } from "@tanstack/react-start";
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
    const url = `https://api.pluto.tv/v2/channels?start=${now.toISOString()}&stop=${stop.toISOString()}`;
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "SurfTV/1.0" },
      });
      console.log("[Pluto] upstream status:", res.status);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.log("[Pluto] upstream body sample:", text.slice(0, 300));
        return [];
      }
      const data = (await res.json()) as Array<PlutoChannel & { category?: string }>;
      console.log("[Pluto] channels received:", Array.isArray(data) ? data.length : `not-array(${typeof data})`);
      let withHls = 0;
      let withTimelines = 0;
      for (const c of data) {
        if (c.stitched?.urls?.length) withHls++;
        if (c.timelines?.length) withTimelines++;
      }
      console.log("[Pluto] withHls:", withHls, "withTimelines:", withTimelines);

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
      return [...featured, ...catalog];
    } catch (err) {
      console.error("Pluto fetch failed:", err);
      return [];
    }
  },
);

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