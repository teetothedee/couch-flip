import { createServerFn } from "@tanstack/react-start";
import type { Channel, Show } from "./channels";

type SearchDoc = {
  identifier: string;
  title?: string | string[];
  year?: string | number;
  date?: string;
};

type MetadataFile = {
  name: string;
  format?: string;
  source?: string;
  size?: string;
  length?: string;
};

type ChannelSpec = {
  id: string;
  name: string;
  emoji: string;
  color: string;
  genres: string[];
  query: string;
};

const SPECS: ChannelSpec[] = [
  {
    id: "archive-kung-fu",
    name: "Archive · Kung Fu",
    emoji: "🐲",
    color: "#7f1d1d",
    genres: ["Kung Fu"],
    query: '(subject:"martial arts" OR subject:"kung fu") AND mediatype:movies',
  },
  {
    id: "archive-cartoons",
    name: "Archive · Classic Cartoons",
    emoji: "🎨",
    color: "#9333ea",
    genres: ["Animation"],
    query: '(subject:"animation" OR subject:"cartoons") AND mediatype:movies',
  },
  {
    id: "archive-scifi",
    name: "Archive · Classic Sci-Fi",
    emoji: "🛸",
    color: "#0369a1",
    genres: ["World Cinema"],
    query: 'subject:"science fiction" AND mediatype:movies',
  },
];

function firstString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function yearFromDoc(d: SearchDoc): number | undefined {
  if (typeof d.year === "number") return d.year;
  if (typeof d.year === "string") {
    const n = parseInt(d.year, 10);
    if (!isNaN(n)) return n;
  }
  if (d.date) {
    const n = new Date(d.date).getUTCFullYear();
    if (!isNaN(n) && n > 1800) return n;
  }
  return undefined;
}

function pickPlayableFile(files: MetadataFile[]): string | null {
  // Prefer "derivative" h.264 MP4s — these are the optimized web-ready files.
  const mp4s = files.filter(
    (f) => f.name.toLowerCase().endsWith(".mp4") || f.format === "h.264" || f.format === "MPEG4",
  );
  if (mp4s.length === 0) return null;

  const score = (f: MetadataFile) => {
    let s = 0;
    if (f.format === "h.264") s += 5; // standard web derivative
    if (f.format === "MPEG4") s += 3;
    if (f.source === "derivative") s += 2;
    if (f.source === "original") s += 1;
    // Avoid huge originals when possible — sort by smaller size as tiebreaker.
    return s;
  };
  mp4s.sort((a, b) => score(b) - score(a));
  return mp4s[0].name;
}

async function fetchOne(spec: ChannelSpec): Promise<Channel | null> {
  const searchUrl =
    "https://archive.org/advancedsearch.php" +
    `?q=${encodeURIComponent(spec.query)}` +
    "&fl[]=identifier&fl[]=title&fl[]=year&fl[]=date" +
    "&sort[]=downloads+desc" +
    "&rows=20&page=1&output=json";

  let docs: SearchDoc[] = [];
  try {
    const res = await fetch(searchUrl, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const json = (await res.json()) as { response?: { docs?: SearchDoc[] } };
    docs = json.response?.docs ?? [];
  } catch (err) {
    console.error("Archive search failed:", spec.id, err);
    return null;
  }
  if (docs.length === 0) return null;

  // Resolve metadata in parallel; keep first one with a playable file as "now playing".
  const resolved = await Promise.all(
    docs.map(async (d) => {
      try {
        const m = await fetch(`https://archive.org/metadata/${d.identifier}`);
        if (!m.ok) return null;
        const j = (await m.json()) as { files?: MetadataFile[] };
        const file = pickPlayableFile(j.files ?? []);
        if (!file) return null;
        return {
          identifier: d.identifier,
          title: firstString(d.title) ?? d.identifier,
          year: yearFromDoc(d),
          url: `https://archive.org/download/${d.identifier}/${encodeURIComponent(file)}`,
        };
      } catch {
        return null;
      }
    }),
  );
  const playable = resolved.filter((x): x is NonNullable<typeof x> => x !== null);
  if (playable.length === 0) return null;

  const now = playable[0];
  const schedule: Show[] = playable.slice(0, 4).map((p) => ({
    title: p.title,
    year: p.year,
    genre: spec.genres[0],
  }));

  return {
    id: spec.id,
    name: spec.name,
    emoji: spec.emoji,
    color: spec.color,
    source: "Internet Archive",
    genres: spec.genres,
    streamUrl: now.url,
    schedule,
    defaultOff: true,
  };
}

export const fetchArchiveChannels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Channel[]> => {
    const results = await Promise.all(SPECS.map(fetchOne));
    return results.filter((c): c is Channel => c !== null);
  },
);