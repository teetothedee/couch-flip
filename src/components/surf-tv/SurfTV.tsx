import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import Hls from "hls.js";
import {
  ALL_GENRES,
  ALL_SOURCES,
  CHANNELS,
  TIME_SLOTS,
  type Channel,
  type Show,
} from "../../lib/channels";
import { fetchPlutoChannels } from "../../lib/pluto.functions";
import { fetchHiyahChannels } from "../../lib/hiyah.functions";

const ACCENT = "#e85d26";
const STORAGE_KEY = "surf-tv:state:v2";

type StoredState = { order: string[]; removed: string[] };

function loadStored(): StoredState {
  if (typeof window === "undefined") return { order: [], removed: [] };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { order: [], removed: [] };
    const p = JSON.parse(raw);
    return {
      order: Array.isArray(p.order)
        ? p.order.filter((x: unknown): x is string => typeof x === "string")
        : [],
      removed: Array.isArray(p.removed)
        ? p.removed.filter((x: unknown): x is string => typeof x === "string")
        : [],
    };
  } catch {
    return { order: [], removed: [] };
  }
}

function formatStart(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function hexToRgb(hex: string) {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return { r, g, b };
}

function ChannelBackground({ channel }: { channel: Channel }) {
  const { r, g, b } = hexToRgb(channel.color);
  return (
    <div
      className="absolute inset-0 transition-colors duration-500"
      style={{
        background: `radial-gradient(150% 130% at 30% 20%, rgba(${r},${g},${b},0.6) 0%, rgba(${r},${g},${b},0.35) 40%, rgba(${r},${g},${b},0.15) 70%, rgba(8,8,10,0.9) 100%), #08080a`,
      }}
    >
      <div className="absolute inset-0 opacity-[0.08] mix-blend-overlay" style={{
        backgroundImage:
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.6) 0 1px, transparent 1px 3px)",
      }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[28rem] leading-none opacity-15 select-none">
        {channel.emoji}
      </div>
    </div>
  );
}

function LiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: ACCENT }} />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ACCENT }} />
    </span>
  );
}

function InlineStream({
  src,
  muted,
  proxy,
  onError,
  onReady,
}: {
  src: string;
  muted: boolean;
  proxy: boolean;
  onError: () => void;
  onReady: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | null = null;

    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    };

    const playUrl =
      proxy && typeof window !== "undefined"
        ? `${window.location.origin}/api/public/hls?url=${encodeURIComponent(src)}`
        : src;
    console.log("[SurfTV] InlineStream loading", { original: src, playUrl, proxy });

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playUrl;
      video.addEventListener("loadeddata", onReady, { once: true });
      video.addEventListener("error", onError, { once: true });
      tryPlay();
    } else if (Hls.isSupported()) {
      hls = new Hls({ enableWorker: true, lowLatencyMode: false });
      hls.loadSource(playUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        onReady();
        tryPlay();
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          console.error("[SurfTV] HLS fatal error", data);
        } else {
          console.warn("[SurfTV] HLS error", data.type, data.details);
        }
        if (!data.fatal) return;
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            hls?.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            hls?.recoverMediaError();
            break;
          default:
            hls?.destroy();
            onError();
        }
      });
    } else {
      onError();
    }

    return () => {
      hls?.destroy();
      if (video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
      }
    };
  }, [src, proxy, onError, onReady]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted]);

  return (
    <video
      ref={videoRef}
      className="absolute inset-0 h-full w-full bg-black object-cover"
      autoPlay
      muted={muted}
      playsInline
    />
  );
}

type Props = Record<string, never>;

export function SurfTV(_props: Props = {} as Props) {
  const [pluto, setPluto] = useState<Channel[]>([]);
  const [hiyah, setHiyah] = useState<Channel[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  const fetchPlutoFn = useServerFn(fetchPlutoChannels);
  const fetchHiyahFn = useServerFn(fetchHiyahChannels);

  // Hydrate persisted state + fetch real Pluto channels on mount.
  useEffect(() => {
    const s = loadStored();
    setOrder(s.order);
    setRemoved(new Set(s.removed));
    setHydrated(true);
    fetchPlutoFn()
      .then((list) => setPluto(list))
      .catch((err) => {
        console.error("Could not load Pluto channels:", err);
      });
    fetchHiyahFn()
      .then((list) => setHiyah(list))
      .catch((err) => {
        console.error("Could not load Hi-YAH! channels:", err);
      });
  }, [fetchPlutoFn, fetchHiyahFn]);

  const pool: Channel[] = useMemo(() => [...CHANNELS, ...pluto, ...hiyah], [pluto, hiyah]);

  const channels: Channel[] = useMemo(() => {
    const byId = new Map(pool.map((c) => [c.id, c]));
    const seen = new Set<string>();
    const out: Channel[] = [];
    for (const id of order) {
      const c = byId.get(id);
      if (c && !removed.has(id) && !seen.has(id)) {
        out.push(c);
        seen.add(id);
      }
    }
    for (const c of pool) {
      if (!seen.has(c.id) && !removed.has(c.id)) out.push(c);
    }
    return out;
  }, [pool, order, removed]);

  // Persist order + removed whenever it changes (after hydration).
  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    try {
      const payload: StoredState = {
        order: channels.map((c) => c.id),
        removed: [...removed],
      };
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore quota / private-mode errors
    }
  }, [channels, removed, hydrated]);

  const [index, setIndex] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const [showManage, setShowManage] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [muted, setMuted] = useState(true);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [streamFailed, setStreamFailed] = useState(false);

  const channel = channels.length > 0 ? channels[index % channels.length] : undefined;
  const current: Show | undefined = channel?.schedule[0];

  // Reset failure state whenever the active channel/stream changes
  useEffect(() => {
    setStreamFailed(false);
  }, [channel?.id]);

  const handleStreamError = useCallback(() => setStreamFailed(true), []);
  const handleStreamReady = useCallback(() => setStreamFailed(false), []);

  const flip = useCallback(
    (dir: 1 | -1) => {
      setMuted(false);
      setIndex((i) => {
        const n = channels.length;
        if (n === 0) return 0;
        return (i + dir + n) % n;
      });
    },
    [channels.length],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (showManage && e.key === "Escape") {
        setShowManage(false);
        return;
      }
      if (showGuide && e.key === "Escape") {
        setShowGuide(false);
        return;
      }
      if (showGuide || showManage) return;
      if (e.key === "ArrowUp") {
        e.preventDefault();
        flip(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        flip(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flip, showGuide, showManage]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const removeChannel = (id: string) => {
    setRemoved((r) => {
      const n = new Set(r);
      n.add(id);
      return n;
    });
    const removedCh = pool.find((c) => c.id === id);
    if (removedCh) setToast(`Removed ${removedCh.name}`);
    setIndex((i) => {
      const remaining = Math.max(1, channels.length - 1);
      return i % remaining;
    });
  };

  const addChannel = (id: string) => {
    setRemoved((r) => {
      const n = new Set(r);
      n.delete(id);
      return n;
    });
    const added = pool.find((c) => c.id === id);
    if (added) setToast(`Added ${added.name}`);
  };

  // Overlay auto-hide after 4s of inactivity (only when guide is closed)
  useEffect(() => {
    if (showGuide || showManage) {
      setOverlayVisible(true);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const reset = () => {
      setOverlayVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setOverlayVisible(false), 4000);
    };
    const events: (keyof WindowEventMap)[] = ["mousemove", "touchstart", "keydown", "click", "wheel"];
    events.forEach((e) => window.addEventListener(e, reset, { passive: true }));
    reset();
    return () => {
      if (timer) clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [showGuide, showManage]);

  if (!channel) return null;

  return (
    <div
      className="h-screen w-screen overflow-hidden bg-[#08080a] text-white font-sans relative"
      style={{ fontFamily: 'var(--font-sans)', cursor: overlayVisible ? "default" : "none" }}
    >
      {/* Background: channel art always; live stream overlays when available */}
      <ChannelBackground channel={channel} />
      {channel.streamUrl && !streamFailed && (
        <InlineStream
          key={channel.id}
          src={channel.streamUrl}
          muted={muted}
          proxy={channel.source === "Pluto TV"}
          onError={handleStreamError}
          onReady={handleStreamReady}
        />
      )}
      {channel.streamUrl && streamFailed && (
        <div className="pointer-events-none absolute bottom-32 left-1/2 -translate-x-1/2 text-xs uppercase tracking-[0.3em] text-white/45">
          Stream unavailable
        </div>
      )}

      {/* Subtle vignette for legibility */}
      <div
        className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${overlayVisible ? "opacity-100" : "opacity-0"}`}
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0) 25%, rgba(0,0,0,0) 60%, rgba(0,0,0,0.7) 100%)",
        }}
      />

      {/* Overlay layer */}
      <div
        className={`absolute inset-0 transition-opacity duration-500 ${overlayVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
      >
        {/* Top-left: channel + live */}
        <div className="absolute top-6 left-6 md:top-10 md:left-10 flex items-center gap-3">
          <div className="text-3xl md:text-4xl">{channel.emoji}</div>
          <div>
            <div
              className="text-2xl md:text-4xl tracking-wide leading-none"
              style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.06em' }}
            >
              {channel.name}
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-xs uppercase tracking-[0.25em] text-white/70">
              <LiveDot />
              <span>Live</span>
              {muted && channel.streamUrl && (
                <>
                  <span className="h-1 w-1 rounded-full bg-white/40" />
                  <span className="text-white/55">Muted · flip to unmute</span>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Full guide button top-right */}
        <div className="absolute top-6 right-6 md:top-10 md:right-10">
          <button
            onClick={() => setShowGuide(true)}
            className="rounded-sm border border-white/20 bg-black/30 px-4 py-2 text-xs uppercase tracking-[0.25em] backdrop-blur transition hover:border-white/50 hover:bg-black/50"
          >
            Full Guide
          </button>
        </div>

        {/* Right-edge flip buttons */}
        <div className="absolute right-4 md:right-8 top-1/2 flex -translate-y-1/2 flex-col gap-3">
          <FlipButton dir="up" onClick={() => flip(-1)} />
          <FlipButton dir="down" onClick={() => flip(1)} />
        </div>

        {/* Bottom-left: title + metadata only */}
        <div className="absolute bottom-8 left-6 md:bottom-12 md:left-10 max-w-2xl">
          {current && (
            <>
              <h1
                className="text-5xl md:text-7xl leading-[0.95]"
                style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}
              >
                {current.title}
              </h1>
              <div className="mt-3 flex items-center gap-3 text-sm text-white/75">
                {current.year && <span>{current.year}</span>}
                {current.year && current.genre && <span className="h-1 w-1 rounded-full bg-white/40" />}
                {current.genre && <span>{current.genre}</span>}
                {current.startTime && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-white/40" />
                    <span className="uppercase tracking-[0.2em] text-white/55 text-xs">
                      Since {formatStart(current.startTime)}
                    </span>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {toast && (
        <div className="pointer-events-none absolute top-24 left-1/2 z-30 -translate-x-1/2 rounded-sm bg-black/70 px-4 py-2 text-xs uppercase tracking-[0.2em] backdrop-blur">
          {toast}
        </div>
      )}

      {showGuide && (
        <FullGuide
          channels={channels}
          activeId={channel.id}
          onPick={(channelId, slotIdx) => {
            const newIdx = channels.findIndex((c) => c.id === channelId);
            if (newIdx >= 0) {
              setMuted(false);
              setIndex(newIdx);
            }
            setShowGuide(false);
            const ch = channels[newIdx];
            setToast(`${ch.name} · ${TIME_SLOTS[slotIdx]}`);
          }}
          onClose={() => setShowGuide(false)}
          onOpenManage={() => setShowManage(true)}
        />
      )}

      {showManage && (
        <ManageChannels
          channels={channels}
          pool={pool}
          onAdd={addChannel}
          onRemove={removeChannel}
          onClose={() => setShowManage(false)}
        />
      )}
    </div>
  );
}

function FlipButton({ dir, onClick }: { dir: "up" | "down"; onClick: () => void }) {
  return (
    <button
      aria-label={dir === "up" ? "Channel up" : "Channel down"}
      onClick={onClick}
      className="group flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur transition hover:border-white/60 hover:bg-black/70"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: dir === "down" ? "rotate(180deg)" : "none" }}
      >
        <polyline points="6 15 12 9 18 15" />
      </svg>
    </button>
  );
}

function FullGuide({
  channels,
  pool,
  activeId,
  onPick,
  onClose,
  onAdd,
  onRemove,
}: {
  channels: Channel[];
  pool: Channel[];
  activeId: string;
  onPick: (channelId: string, slotIdx: number) => void;
  onClose: () => void;
  onAdd: (channelId: string) => void;
  onRemove: (channelId: string) => void;
}) {
  const available = pool.filter((c) => !channels.some((x) => x.id === c.id));
  const slotOffsetsMin = [0, 30, 60, 90];
  const slotTimes = slotOffsetsMin.map((mins) => {
    const d = new Date(Date.now() + mins * 60 * 1000);
    d.setMinutes(Math.round(d.getMinutes() / 5) * 5, 0, 0);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  });
  const [genreFilters, setGenreFilters] = useState<Set<string>>(new Set());
  const [sourceFilters, setSourceFilters] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, value: string, setter: (s: Set<string>) => void) => {
    const n = new Set(set);
    if (n.has(value)) n.delete(value);
    else n.add(value);
    setter(n);
  };

  const filteredAvailable = available.filter((c) => {
    const genreOk = genreFilters.size === 0 || c.genres.some((g) => genreFilters.has(g));
    const sourceOk = sourceFilters.size === 0 || sourceFilters.has(c.source);
    return genreOk && sourceOk;
  });

  return (
    <div className="fixed inset-0 z-50 bg-[#08080a]/97 backdrop-blur-md">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-5 md:px-10">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-white/60">Surf TV</div>
            <h2
              className="text-3xl md:text-4xl"
              style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}
            >
              Full Guide
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close guide"
            className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 text-white transition hover:border-white/60 hover:bg-white/10"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="18" y1="6" x2="6" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 py-6 md:px-10">
          {/* Header row */}
          <div className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] gap-2 pb-3 text-xs uppercase tracking-[0.25em] text-white/50">
            <div>Channel</div>
            {TIME_SLOTS.map((t) => (
              <div key={t}>{t}</div>
            ))}
          </div>

          <div className="space-y-2">
            {channels.map((c) => {
              const isActive = c.id === activeId;
              return (
                <div
                  key={c.id}
                  className="grid grid-cols-[220px_repeat(4,minmax(0,1fr))] gap-2"
                >
                  <div
                    className="flex items-center gap-3 rounded-sm border border-white/10 bg-white/5 px-3 py-3"
                    style={isActive ? { borderColor: ACCENT } : undefined}
                  >
                    <span className="text-xl">{c.emoji}</span>
                    <div className="min-w-0">
                      <div
                        className="truncate text-base"
                        style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.08em' }}
                      >
                        {c.name}
                      </div>
                      <div
                        className="mt-0.5 inline-block h-1 w-8 rounded-full"
                        style={{ backgroundColor: c.color }}
                      />
                    </div>
                  </div>
                  {Array.from({ length: 4 }).map((_, i) => {
                    const s = c.schedule[i];
                    if (!s) {
                      return (
                        <div
                          key={i}
                          className="rounded-sm border border-white/5 bg-white/[0.02] px-3 py-3 text-[11px] uppercase tracking-[0.2em] text-white/30"
                        >
                          —
                        </div>
                      );
                    }
                    const meta = [s.year, s.genre].filter(Boolean).join(" · ");
                    const startLabel = formatStart(s.startTime) ?? slotTimes[i];
                    return (
                      <button
                        key={i}
                        onClick={() => onPick(c.id, i)}
                        className="group flex flex-col items-start rounded-sm border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/40 hover:bg-white/10"
                      >
                        <div className="line-clamp-1 text-sm font-medium text-white group-hover:text-white">
                          {s.title}
                        </div>
                        {meta && (
                          <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/50">
                            {meta}
                          </div>
                        )}
                        {i === 0 ? (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em]" style={{ color: ACCENT }}>
                            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
                            Live{s.startTime ? ` · since ${startLabel}` : ""}
                          </div>
                        ) : (
                          <div className="mt-2 text-[10px] uppercase tracking-[0.25em] text-white/50">
                            Starts {startLabel}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {/* Manage Channels */}
          <div className="mt-12 border-t border-white/10 pt-6">
            <div className="flex items-baseline justify-between">
              <h3
                className="text-2xl md:text-3xl"
                style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.04em' }}
              >
                Manage Channels
              </h3>
              <span className="text-xs uppercase tracking-[0.25em] text-white/50">
                {channels.length} active · {available.length} available
              </span>
            </div>

            {/* Active Channels */}
            <div className="mt-6">
              <div className="text-xs uppercase tracking-[0.3em] text-white/50">
                Active Channels
              </div>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {channels.map((c) => (
                  <ChannelRow
                    key={c.id}
                    channel={c}
                    action={
                      <button
                        onClick={() => onRemove(c.id)}
                        disabled={channels.length <= 1}
                        className="shrink-0 rounded-sm border border-white/20 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/80 transition hover:border-white/60 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Remove
                      </button>
                    }
                  />
                ))}
              </div>
            </div>

            {/* Available Channels */}
            <div className="mt-10">
              <div className="flex items-baseline justify-between">
                <div className="text-xs uppercase tracking-[0.3em] text-white/50">
                  Available Channels
                </div>
                {(genreFilters.size > 0 || sourceFilters.size > 0) && (
                  <button
                    onClick={() => {
                      setGenreFilters(new Set());
                      setSourceFilters(new Set());
                    }}
                    className="text-[10px] uppercase tracking-[0.25em] text-white/50 transition hover:text-white"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {/* Filters */}
              <div className="mt-3 space-y-2">
                <FilterRow
                  label="Genre"
                  options={[...ALL_GENRES]}
                  selected={genreFilters}
                  onToggle={(v) => toggle(genreFilters, v, setGenreFilters)}
                />
                <FilterRow
                  label="Source"
                  options={[...ALL_SOURCES]}
                  selected={sourceFilters}
                  onToggle={(v) => toggle(sourceFilters, v, setSourceFilters)}
                />
              </div>

              <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredAvailable.length === 0 ? (
                  <div className="col-span-full rounded-sm border border-white/10 bg-white/[0.02] px-4 py-6 text-center text-xs uppercase tracking-[0.25em] text-white/40">
                    {available.length === 0
                      ? "Everything available is already on your dial"
                      : "No channels match those filters"}
                  </div>
                ) : (
                  filteredAvailable.map((c) => (
                    <ChannelRow
                      key={c.id}
                      channel={c}
                      action={
                        <button
                          onClick={() => onAdd(c.id)}
                          className="shrink-0 rounded-sm px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-white transition hover:brightness-110"
                          style={{ backgroundColor: ACCENT }}
                        >
                          + Add
                        </button>
                      }
                    />
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChannelRow({ channel: c, action }: { channel: Channel; action: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{ backgroundColor: c.color }}
        />
        <span className="text-xl">{c.emoji}</span>
        <div className="min-w-0">
          <div
            className="truncate text-sm"
            style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.1em' }}
          >
            {c.name}
          </div>
          <div className="mt-0.5 truncate text-[10px] uppercase tracking-[0.25em] text-white/40">
            {c.source}
            {c.genres.length > 0 ? ` · ${c.genres.join(", ")}` : ""}
          </div>
        </div>
      </div>
      {action}
    </div>
  );
}

function FilterRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: Set<string>;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-[10px] uppercase tracking-[0.3em] text-white/40">{label}</span>
      {options.map((opt) => {
        const active = selected.has(opt);
        return (
          <button
            key={opt}
            onClick={() => onToggle(opt)}
            className={`rounded-sm border px-2.5 py-1 text-[10px] uppercase tracking-[0.2em] transition ${
              active
                ? "border-transparent text-white"
                : "border-white/15 bg-white/[0.03] text-white/60 hover:border-white/40 hover:text-white"
            }`}
            style={active ? { backgroundColor: ACCENT } : undefined}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}