import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Props = {
  src: string;
  title: string;
  channelName: string;
  onClose: () => void;
};

export function VideoPlayer({ src, title, channelName, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;

    const proxied =
      typeof window !== "undefined"
        ? `${window.location.origin}/api/public/hls?url=${encodeURIComponent(src)}`
        : src;
    console.log("[SurfTV] VideoPlayer loading", { original: src, proxied });

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Safari / iOS native HLS
      video.src = proxied;
      video.play().catch(() => {});
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true });
      hls.loadSource(proxied);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          console.error("[SurfTV] VideoPlayer HLS fatal error", data);
          setError(data.details || "Stream error");
        } else {
          console.warn("[SurfTV] VideoPlayer HLS error", data.type, data.details);
        }
      });
    } else {
      setError("HLS playback is not supported in this browser.");
    }

    return () => {
      hls?.destroy();
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [src]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[60] bg-black">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full bg-black object-contain"
        controls
        autoPlay
        playsInline
      />

      {/* Top bar */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between bg-gradient-to-b from-black/80 to-transparent p-5 md:p-8">
        <div className="pointer-events-auto">
          <div className="text-[10px] uppercase tracking-[0.3em] text-white/60">
            {channelName}
          </div>
          <div
            className="mt-1 text-2xl md:text-3xl text-white"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "0.04em" }}
          >
            {title}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close player"
          className="pointer-events-auto flex h-11 w-11 items-center justify-center rounded-full border border-white/30 bg-black/50 text-white backdrop-blur transition hover:border-white/70 hover:bg-black/80"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <line x1="6" y1="6" x2="18" y2="18" />
            <line x1="18" y1="6" x2="6" y2="18" />
          </svg>
        </button>
      </div>

      {error && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-sm border border-white/20 bg-black/80 px-6 py-4 text-center text-sm text-white">
          <div className="mb-1 text-xs uppercase tracking-[0.25em] text-white/60">
            Playback error
          </div>
          {error}
        </div>
      )}
    </div>
  );
}