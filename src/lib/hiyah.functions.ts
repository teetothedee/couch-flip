import { createServerFn } from "@tanstack/react-start";
import type { Channel } from "./channels";

// Hi-YAH! is a martial arts FAST channel from Well Go USA, distributed
// free on Plex / Xumo / Samsung TV Plus. The frequency.stream URL slug
// can rotate; we probe several known patterns and use the first live one.
const CANDIDATES = [
  // Current primary
  "https://linear-59.frequency.stream/dist/plex/59/hls/master/playlist.m3u8",
  // Alternative slug formats
  "https://linear-59.frequency.stream/dist/hiyah/59/hls/master/playlist.m3u8",
  "https://linear-59.frequency.stream/dist/plex/59/index.m3u8",
  // Xumo / Samsung variants (same CDN, different path)
  "https://linear-59.frequency.stream/hiyah/hls/master/playlist.m3u8",
];

async function findLiveUrl(): Promise<string | null> {
  for (const url of CANDIDATES) {
    try {
      const res = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (res.ok) {
        console.log("[Hi-YAH!] live URL:", url);
        return url;
      }
      console.warn("[Hi-YAH!] HEAD non-ok:", res.status, url);
    } catch (err) {
      console.warn("[Hi-YAH!] HEAD error:", url, err);
    }
  }
  return null;
}

export const fetchHiyahChannels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Channel[]> => {
    const streamUrl = await findLiveUrl();
    if (!streamUrl) return [];

    const channel: Channel = {
      id: "hiyah-247",
      name: "Hi-YAH! 24/7",
      emoji: "🥋",
      color: "#ea580c",
      source: "Hi-YAH!",
      genres: ["Kung Fu"],
      streamUrl,
      schedule: [
        { title: "Hi-YAH! Martial Arts Marathon", genre: "Martial Arts" },
        { title: "Hi-YAH! Martial Arts Marathon", genre: "Martial Arts" },
        { title: "Hi-YAH! Martial Arts Marathon", genre: "Martial Arts" },
        { title: "Hi-YAH! Martial Arts Marathon", genre: "Martial Arts" },
      ],
    };
    return [channel];
  },
);
