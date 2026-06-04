import { createServerFn } from "@tanstack/react-start";
import type { Channel } from "./channels";

const PLAYLIST_URL =
  "https://raw.githubusercontent.com/BuddyChewChew/app-m3u-generator/main/playlists/tubi_all.m3u";

function parseAttrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out[m[1]] = m[2];
  return out;
}

function colorFromString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  const hue = Math.abs(h) % 360;
  const sat = 60;
  const light = 42;
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

function parseM3u(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.startsWith("#EXTINF")) continue;
    const commaIdx = line.indexOf(",");
    if (commaIdx < 0) continue;
    const attrs = parseAttrs(line.substring(0, commaIdx));
    const name = line.substring(commaIdx + 1).trim();
    // find next non-comment, non-empty line as URL
    let url = "";
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (!l) continue;
      if (l.startsWith("#")) continue;
      url = l;
      i = j;
      break;
    }
    if (!url || !name) continue;
    const genre = attrs["group-title"] || "Live";
    const tvgId = attrs["tvg-id"] || name;
    const id = `tubi:${tvgId}:${name}`.replace(/\s+/g, "-").toLowerCase();
    channels.push({
      id,
      name,
      emoji: "📡",
      color: colorFromString(id),
      source: "Tubi",
      genres: [genre],
      streamUrl: url,
      defaultOff: true,
      schedule: [{ title: name, genre }],
    });
  }
  return channels;
}

export const fetchTubiChannels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Channel[]> => {
    try {
      const res = await fetch(PLAYLIST_URL, {
        headers: { Accept: "text/plain, */*" },
      });
      if (!res.ok) {
        console.error(`[Tubi] playlist fetch failed: ${res.status}`);
        return [];
      }
      const text = await res.text();
      const list = parseM3u(text);
      console.log(`[Tubi] parsed ${list.length} live channels`);
      return list;
    } catch (err) {
      console.error("[Tubi] fetch failed:", err);
      return [];
    }
  },
);