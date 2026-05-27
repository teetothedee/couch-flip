import { useCallback, useEffect, useState } from "react";
import { CHANNELS, TIME_SLOTS, type Channel, type Show } from "../../lib/channels";

const ACCENT = "#e85d26";
const STORAGE_KEY = "surf-tv:channel-order:v1";

function loadChannels(): Channel[] {
  if (typeof window === "undefined") return CHANNELS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return CHANNELS;
    const ids = JSON.parse(raw);
    if (!Array.isArray(ids)) return CHANNELS;
    const byId = new Map(CHANNELS.map((c) => [c.id, c]));
    const restored = ids
      .filter((id): id is string => typeof id === "string" && byId.has(id))
      .map((id) => byId.get(id)!);
    return restored.length > 0 ? restored : CHANNELS;
  } catch {
    return CHANNELS;
  }
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

type Props = Record<string, never>;

export function SurfTV(_props: Props = {} as Props) {
  const [channels, setChannels] = useState<Channel[]>(CHANNELS);

  // Hydrate from localStorage after mount to avoid SSR mismatches.
  useEffect(() => {
    const stored = loadChannels();
    setChannels(stored);
  }, []);

  // Persist channel order/membership whenever it changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(channels.map((c) => c.id)),
      );
    } catch {
      // ignore quota / private-mode errors
    }
  }, [channels]);

  const [index, setIndex] = useState(0);
  const [showGuide, setShowGuide] = useState(false);
  const [parked, setParked] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<string | null>(null);

  const channel = channels[index % channels.length];
  const current: Show | undefined = channel?.schedule[0];

  const flip = useCallback(
    (dir: 1 | -1) => {
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
      if (showGuide && e.key === "Escape") {
        setShowGuide(false);
        return;
      }
      if (showGuide) return;
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
  }, [flip, showGuide]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  const handlePark = () => {
    if (!channel) return;
    setParked((p) => ({ ...p, [channel.id]: Math.floor(Math.random() * 60 * 40) }));
    setToast(`Parked ${channel.schedule[0].title}`);
  };

  const handleRemove = () => {
    if (channels.length <= 1) {
      setToast("Can't remove your last channel");
      return;
    }
    const removed = channel;
    setChannels((cs) => cs.filter((c) => c.id !== removed.id));
    setIndex((i) => i % (channels.length - 1));
    setToast(`Removed ${removed.name}`);
  };

  const handleWatch = () => {
    if (!channel) return;
    setToast(`Now watching ${channel.schedule[0].title}`);
  };

  if (!channel) return null;

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#08080a] text-white font-sans flex flex-col" style={{ fontFamily: 'var(--font-sans)' }}>
      {/* Now Playing area */}
      <div className="relative flex-1 overflow-hidden">
        <ChannelBackground channel={channel} />

        {/* Top-left: channel + live */}
        <div className="absolute top-6 left-6 md:top-10 md:left-10 z-10 flex items-center gap-3">
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
              <span>Live · Channel {String(index + 1).padStart(2, '0')}</span>
            </div>
          </div>
        </div>

        {/* Full guide button top-right */}
        <div className="absolute top-6 right-6 md:top-10 md:right-10 z-10">
          <button
            onClick={() => setShowGuide(true)}
            className="rounded-sm border border-white/20 bg-black/30 px-4 py-2 text-xs uppercase tracking-[0.25em] backdrop-blur transition hover:border-white/50 hover:bg-black/50"
          >
            Full Guide
          </button>
        </div>

        {/* Right-edge flip buttons */}
        <div className="absolute right-4 md:right-8 top-1/2 z-10 flex -translate-y-1/2 flex-col gap-3">
          <FlipButton dir="up" onClick={() => flip(-1)} />
          <FlipButton dir="down" onClick={() => flip(1)} />
        </div>

        {/* Bottom-left: title meta + buttons */}
        <div className="absolute bottom-8 left-6 md:bottom-12 md:left-10 z-10 max-w-2xl">
          {current && (
            <>
              <div className="text-xs uppercase tracking-[0.3em] text-white/60">Now Playing</div>
              <h1
                className="mt-2 text-5xl md:text-7xl leading-[0.95]"
                style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.02em' }}
              >
                {current.title}
              </h1>
              <div className="mt-3 flex items-center gap-3 text-sm text-white/75">
                <span>{current.year}</span>
                <span className="h-1 w-1 rounded-full bg-white/40" />
                <span>{current.genre}</span>
                {parked[channel.id] !== undefined && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-white/40" />
                    <span style={{ color: ACCENT }}>Parked</span>
                  </>
                )}
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  onClick={handleWatch}
                  className="rounded-sm px-6 py-3 text-sm font-semibold uppercase tracking-[0.2em] text-white transition hover:brightness-110"
                  style={{ backgroundColor: ACCENT }}
                >
                  Watch Now
                </button>
                <button
                  onClick={handlePark}
                  className="rounded-sm border border-white/25 bg-white/5 px-5 py-3 text-sm font-medium uppercase tracking-[0.2em] text-white transition hover:bg-white/10"
                >
                  Park It
                </button>
                <button
                  onClick={handleRemove}
                  className="rounded-sm border border-white/15 px-5 py-3 text-sm font-medium uppercase tracking-[0.2em] text-white/70 transition hover:border-white/40 hover:text-white"
                >
                  Remove This
                </button>
              </div>
            </>
          )}
        </div>

        {toast && (
          <div className="pointer-events-none absolute top-24 left-1/2 z-20 -translate-x-1/2 rounded-sm bg-black/70 px-4 py-2 text-xs uppercase tracking-[0.2em] backdrop-blur">
            {toast}
          </div>
        )}
      </div>

      {/* Channel strip */}
      <div className="relative z-10 border-t border-white/10 bg-black/60 backdrop-blur">
        <div className="flex items-center gap-2 overflow-x-auto px-4 py-3 md:px-8 md:py-4">
          {channels.map((c, i) => {
            const active = i === index;
            return (
              <button
                key={c.id}
                onClick={() => setIndex(i)}
                className={`group flex shrink-0 items-center gap-2 rounded-sm border px-3 py-2 transition ${
                  active
                    ? "border-white/80 bg-white text-black"
                    : "border-white/10 bg-white/5 text-white/80 hover:border-white/30 hover:text-white"
                }`}
                style={active ? { boxShadow: `0 0 0 2px ${ACCENT}` } : undefined}
              >
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ backgroundColor: c.color }}
                />
                <span className="text-base">{c.emoji}</span>
                <span
                  className="text-sm uppercase tracking-[0.15em] whitespace-nowrap"
                  style={{ fontFamily: 'var(--font-display)', letterSpacing: '0.12em' }}
                >
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {showGuide && (
        <FullGuide
          channels={channels}
          activeId={channel.id}
          onPick={(channelId, slotIdx) => {
            const newIdx = channels.findIndex((c) => c.id === channelId);
            if (newIdx >= 0) setIndex(newIdx);
            setShowGuide(false);
            const ch = channels[newIdx];
            setToast(`${ch.name} · ${TIME_SLOTS[slotIdx]}`);
          }}
          onClose={() => setShowGuide(false)}
          onRestore={(channelId) => {
            setChannels((cs) => {
              if (cs.some((c) => c.id === channelId)) return cs;
              // Re-insert preserving the original CHANNELS order
              const next = CHANNELS.filter(
                (c) => c.id === channelId || cs.some((x) => x.id === c.id),
              );
              return next;
            });
            const restored = CHANNELS.find((c) => c.id === channelId);
            if (restored) setToast(`Restored ${restored.name}`);
          }}
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
  activeId,
  onPick,
  onClose,
  onRestore,
}: {
  channels: Channel[];
  activeId: string;
  onPick: (channelId: string, slotIdx: number) => void;
  onClose: () => void;
  onRestore: (channelId: string) => void;
}) {
  const removed = CHANNELS.filter((c) => !channels.some((x) => x.id === c.id));
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
                  {c.schedule.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => onPick(c.id, i)}
                      className="group flex flex-col items-start rounded-sm border border-white/10 bg-white/[0.03] px-3 py-3 text-left transition hover:border-white/40 hover:bg-white/10"
                    >
                      <div className="line-clamp-1 text-sm font-medium text-white group-hover:text-white">
                        {s.title}
                      </div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/50">
                        {s.year} · {s.genre}
                      </div>
                      {i === 0 && (
                        <div className="mt-2 flex items-center gap-1.5 text-[10px] uppercase tracking-[0.25em]" style={{ color: ACCENT }}>
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
                          Live
                        </div>
                      )}
                    </button>
                  ))}
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
                {channels.length} active · {removed.length} removed
              </span>
            </div>
            <p className="mt-1 text-xs uppercase tracking-[0.25em] text-white/40">
              Bring back anything you've cut from the dial
            </p>

            <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {CHANNELS.map((c) => {
                const isActive = channels.some((x) => x.id === c.id);
                return (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 rounded-sm border border-white/10 bg-white/[0.03] px-3 py-3"
                  >
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
                        <div className="mt-0.5 text-[10px] uppercase tracking-[0.25em] text-white/40">
                          {isActive ? 'On the dial' : 'Removed'}
                        </div>
                      </div>
                    </div>
                    {isActive ? (
                      <span className="shrink-0 rounded-sm border border-white/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.25em] text-white/50">
                        Active
                      </span>
                    ) : (
                      <button
                        onClick={() => onRestore(c.id)}
                        className="shrink-0 rounded-sm px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.25em] text-white transition hover:brightness-110"
                        style={{ backgroundColor: ACCENT }}
                      >
                        + Add
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}