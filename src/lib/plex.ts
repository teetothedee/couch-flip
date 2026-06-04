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
  // Open the popup synchronously so it inherits the user gesture.
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

  // Poll every 2s for up to ~15 min.
  const start = Date.now();
  while (Date.now() - start < 15 * 60 * 1000) {
    if (popup.closed) {
      // The user may have closed without finishing — keep polling a bit more
      // in case the token is already issued.
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
  // Plex brand-ish saturated palette
  const sat = 65;
  const light = 48;
  // hsl -> hex
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

type PlexHubsResponse = {
  MediaContainer?: {
    Hub?: Array<{
      hubIdentifier?: string;
      title?: string;
      type?: string;
      Metadata?: Array<{ title?: string; year?: number; genre?: string }>;
    }>;
  };
};

type PlexResourcesResponse = Array<{
  name?: string;
  clientIdentifier?: string;
  provides?: string;
  owned?: boolean;
  product?: string;
}>;

/**
 * Fetch free Plex streaming hubs and turn each hub into a Channel whose
 * "schedule" lists the next few items.
 */
export async function fetchPlexHubChannels(token: string): Promise<Channel[]> {
  const res = await fetch("https://vod.provider.plex.tv/hubs", {
    headers: { ...PLEX_HEADERS, "X-Plex-Token": token },
  });
  if (!res.ok) throw new Error(`Plex hubs failed (${res.status})`);
  const data: PlexHubsResponse = await res.json();
  console.log("[Plex] /hubs response:", data);
  const hubs = data.MediaContainer?.Hub ?? [];
  return hubs
    .map((h) => {
      const title = h.title || h.hubIdentifier || "Plex Hub";
      const id = `plex:${h.hubIdentifier || title}`;
      const meta = h.Metadata ?? [];
      return {
        id,
        name: title,
        emoji: "🎞️",
        color: colorFromString(id),
        source: "Plex",
        genres: ["Plex"],
        defaultOff: true,
        schedule:
          meta.length > 0
            ? meta.slice(0, 4).map((m) => ({
                title: m.title ?? "Untitled",
                year: m.year,
                genre: m.genre,
              }))
            : [{ title: title, genre: "Plex Hub" }],
      } satisfies Channel;
    });
}

/** Fetch the user's owned Plex media servers and map each to a Channel. */
export async function fetchPlexServerChannels(token: string): Promise<Channel[]> {
  const res = await fetch(
    "https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1",
    { headers: { ...PLEX_HEADERS, "X-Plex-Token": token } },
  );
  if (!res.ok) throw new Error(`Plex resources failed (${res.status})`);
  const data: PlexResourcesResponse = await res.json();
  console.log("[Plex] /resources response:", data);
  return data
    .filter((r) => (r.provides || "").includes("server"))
    .map((r) => {
      const id = `plex-server:${r.clientIdentifier || r.name}`;
      const name = r.name || "Plex Server";
      return {
        id,
        name,
        emoji: "🗄️",
        color: colorFromString(id),
        source: "Plex",
        genres: ["Plex Library"],
        defaultOff: true,
        schedule: [{ title: `${name} library`, genre: r.product || "Plex Media Server" }],
      } satisfies Channel;
    });
}

export async function fetchAllPlexChannels(token: string): Promise<Channel[]> {
  const [hubs, servers] = await Promise.all([
    fetchPlexHubChannels(token).catch((e) => {
      console.error("[Plex] hubs failed:", e);
      return [] as Channel[];
    }),
    fetchPlexServerChannels(token).catch((e) => {
      console.error("[Plex] resources failed:", e);
      return [] as Channel[];
    }),
  ]);
  return [...hubs, ...servers];
}