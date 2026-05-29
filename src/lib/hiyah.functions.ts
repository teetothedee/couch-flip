import { createServerFn } from "@tanstack/react-start";
import type { Channel } from "./channels";

// Hi-YAH! is a martial arts FAST channel from Well Go USA, distributed
// free on Plex / Xumo / Samsung TV Plus. There is no official public
// EPG endpoint, so we surface their 24/7 feed with a static "marathon"
// schedule. The HLS stream is served with permissive CORS, so we play
// it directly (no proxy) — exactly what the user wants in order to test
// HLS.js against a non-Pluto source.
const HIYAH_STREAM_URL =
  "https://linear-59.frequency.stream/dist/plex/59/hls/master/playlist.m3u8";

export const fetchHiyahChannels = createServerFn({ method: "GET" }).handler(
  async (): Promise<Channel[]> => {
    try {
      // Sanity-check the stream is reachable before exposing it to the UI.
      const res = await fetch(HIYAH_STREAM_URL, { method: "HEAD", redirect: "follow" });
      if (!res.ok) {
        console.warn("Hi-YAH! stream HEAD non-ok:", res.status);
      }
    } catch (err) {
      console.error("Hi-YAH! stream HEAD failed:", err);
      return [];
    }

    const channel: Channel = {
      id: "hiyah-247",
      name: "Hi-YAH! 24/7",
      emoji: "🥋",
      color: "#ea580c",
      source: "Hi-YAH!",
      genres: ["Kung Fu"],
      streamUrl: HIYAH_STREAM_URL,
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