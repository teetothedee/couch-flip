import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Range",
  "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
};

// Only allow proxying to known streaming hosts to avoid SSRF abuse.
const ALLOWED_HOST_SUFFIXES = [
  "pluto.tv",
  "plutotv.net",
  "cloudfront.net",
  "akamaized.net",
  "akamaihd.net",
  "fastly.net",
  "jmp2.uk",
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

  const fwdHeaders: Record<string, string> = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://pluto.tv/",
    Origin: "https://pluto.tv",
  };
  const range = request.headers.get("range");
  if (range) fwdHeaders["Range"] = range;

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl.toString(), { headers: fwdHeaders, redirect: "follow" });
  } catch (err) {
    console.error("hls proxy fetch failed:", err);
    return new Response("Upstream fetch failed", { status: 502, headers: CORS });
  }

  const ctype = (upstream.headers.get("content-type") ?? "").toLowerCase();
  const isManifest =
    ctype.includes("mpegurl") ||
    ctype.includes("application/x-mpegurl") ||
    targetUrl.pathname.toLowerCase().endsWith(".m3u8");

  if (isManifest && upstream.ok) {
    const text = await upstream.text();
    // Use the final URL (after redirects) as the base when available.
    const baseUrl = new URL(upstream.url || targetUrl.toString());
    const rewritten = rewriteManifest(text, baseUrl, reqUrl.origin);
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