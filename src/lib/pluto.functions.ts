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
      if (!res.ok) return [];
      const data = (await res.json()) as PlutoChannel[];
      const wanted = new Set(Object.keys(TARGETS));
      const picked = data.filter((c) => wanted.has(c.name));

      const out: Channel[] = [];
      for (const c of picked) {
        const meta = TARGETS[c.name];
        const hls = c.stitched?.urls?.find((u) => u.type === "hls" || u.url.endsWith(".m3u8"));
        if (!hls) continue;
        const timelines = (c.timelines ?? []).slice(0, 4);
        if (timelines.length === 0) continue;
        const slug = c.slug || c.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        out.push({
          id: meta.id,
          name: meta.displayName,
          emoji: meta.emoji,
          color: meta.color,
          schedule: timelines.map(toShow),
          streamUrl: hls.url,
          embedUrl: `https://pluto.tv/en/live-tv/${slug}`,
          source: "Pluto TV",
          genres: meta.genres,
        });
      }
      // Preserve the TARGETS ordering for a stable dial
      const order = Object.values(TARGETS).map((m) => m.id);
      out.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
      return out;
    } catch (err) {
      console.error("Pluto fetch failed:", err);
      return [];
    }
  },
);