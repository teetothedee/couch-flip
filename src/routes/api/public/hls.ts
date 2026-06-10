import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
};

// Only allow proxying to known streaming hosts to avoid SSRF abuse.
const ALLOWED_HOST_SUFFIXES = [
  // Pluto TV
  "pluto.tv",
  "plutotv.net",
  "jmp2.uk",
  // Common CDNs (used by Pluto, Tubi, and others)
  "cloudfront.net",
  "akamaized.net",
  "akamaihd.net",
  "fastly.net",
  // Hi-YAH! / Frequency (Plex FAST channels) and AWS MediaTailor
  "frequency.stream",
  "amazonaws.com",
  // Tubi and related CDNs
  "tubitv.com",
  "tubi.io",
  "tubi.video",
  "llnw.net",
  "llnwd.net",
  "edgecastcdn.net",
  // Community stream aggregators
  "streamlive.to",
  "cdnapi.eu",
  // Miscellaneous FAST channel CDNs
  "wurl.tv",
  "wurl.com",
  "limelight.net",
];

function hostAllowed(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  return ALLOWED_HOST_SUFFIXES.some((s) => host === s || host.endsWith("." + s));
}

function proxied(originalAbs: string, selfOrigin: string): string {
  return `${selfOrigin}/api/public/hls?url=${encodeURIComponent(originalAbs)}`;
}

function rewriteManifest(text: string, playlistUrl: URL, selfOrigin: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (let line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      out.push(line);
      continue;
    }
    if (trimmed.startsWith("#")) {
      // Rewrite URI="..." attributes (EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA, etc.)
      line = line.replace(/URI="([^"]+)"/g, (_m, uri) => {
        try {
          const abs = new URL(uri, playlistUrl).toString();
          return `URI="${proxied(abs, selfOrigin)}"`;
        } catch {
          return _m;
        }
      });
      out.push(line);
      continue;
    }
    // Segment / variant playlist URL line
    try {
      const abs = new URL(trimmed, playlistUrl).toString();
      out.push(proxied(abs, selfOrigin));
    } catch {
      out.push(line);
    }
  }
  return out.join("\n");
}

/**
 * Returns true if the target host belongs to Pluto TV's infrastructure,
 * including the jmp2.uk redirect service used in community M3U playlists.
 */
function isPlutoHost(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  return ["pluto.tv", "plutotv.net", "jmp2.uk"].some(
    (s) => host === s || host.endsWith("." + s),
  );
}

/**
 * Build upstream request headers appropriate for the target domain.
 *
 * - Pluto TV domains: spoof Origin + Referer to bypass their device check.
 * - All other domains: send only generic browser headers so CDNs don't reject
 *   an unexpected Origin header from a different service.
 */
function buildUpstreamHeaders(
  targetUrl: URL,
  rangeHeader: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  if (isPlutoHost(targetUrl)) {
    headers["Referer"] = "https://pluto.tv/";
    headers["Origin"] = "https://pluto.tv";
  }

  if (rangeHeader) headers["Range"] = rangeHeader;
  return headers;
}

async function handle(request: Request): Promise<Response> {
  const reqUrl = new URL(request.url);
  const target = reqUrl.searchParams.get("url");
  if (!target) {
    return new Response("Missing url param", { status: 400, headers: CORS });
  }

  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return new Response("Invalid url", { status: 400, headers: CORS });
  }
  if (targetUrl.protocol !== "https:" && targetUrl.protocol !== "http:") {
    return new Response("Bad protocol", { status: 400, headers: CORS });
  }
  if (!hostAllowed(targetUrl)) {
    return new Response("Host not allowed", { status: 403, headers: CORS });
  }

  const fwdHeaders = buildUpstreamHeaders(targetUrl, request.headers.get("range"));

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), {
      headers: fwdHeaders,
      redirect: "follow",
    });
  } catch (err) {
    console.error("hls proxy fetch failed:", err);
    return new Response("Upstream fetch failed", { status: 502, headers: CORS });
  }

  // After following redirects the final URL may differ — update targetUrl for
  // header decisions and base-URL rewriting.
  const finalUrlStr = upstream.url || targetUrl.toString();
  let finalUrl: URL;
  try {
    finalUrl = new URL(finalUrlStr);
  } catch {
    finalUrl = targetUrl;
  }

  const ctype = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const isManifest =
    ctype.includes("mpegurl") ||
    ctype.includes("application/x-mpegurl") ||
    finalUrl.pathname.toLowerCase().endsWith(".m3u8") ||
    targetUrl.pathname.toLowerCase().endsWith(".m3u8");

  if (isManifest && upstream.ok) {
    const text = await upstream.text();
    const rewritten = rewriteManifest(text, finalUrl, reqUrl.origin);
    return new Response(rewritten, {
      status: upstream.status,
      headers: {
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "no-store",
        ...CORS,
      },
    });
  }

  // Pass-through for segments, keys, init files.
  const passHeaders = new Headers();
  const copy = ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"];
  for (const h of copy) {
    const v = upstream.headers.get(h);
    if (v) passHeaders.set(h, v);
  }
  for (const [k, v] of Object.entries(CORS)) passHeaders.set(k, v);

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: passHeaders,
  });
}

export const Route = createFileRoute("/api/public/hls")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => handle(request),
    },
  },
});
