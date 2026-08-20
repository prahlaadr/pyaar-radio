"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { Track } from "@/lib/types";

interface ScTrack {
  id: number; title: string; user: string; artwork: string | null;
  permalink: string; duration: number; genre: string; streamable: boolean;
}
interface ScPlaylist {
  id: number; title: string; user: string; artwork: string | null;
  trackCount: number; permalink: string; isAlbum: boolean;
}
interface ScData { syncedAt: string; clientId: string; likes: ScTrack[]; playlists: ScPlaylist[] }

// SoundCloud artworks come back at 100x100 (-large); bump to 500x500 for the grid.
function art(url: string | null): string | null {
  return url ? url.replace("-large.", "-t500x500.") : null;
}

// A liked SC track → a player Track. Route via soundcloudUrl (the permalink) so
// the player hands it straight to the SC widget — playTrack checks soundcloudUrl
// BEFORE its YouTube-search fallback, which a bare numeric soundcloudId would hit.
function scToTrack(t: ScTrack): Track {
  return {
    trackName: t.title, artistNames: t.user, albumName: "SoundCloud", genres: t.genre ? [t.genre] : [],
    tempo: 0, duration: "", key: 0, popularity: 0, videoId: "", soundcloudId: String(t.id), bandcampId: "",
    soundcloudUrl: t.permalink || undefined,
  };
}

function Card({ image, title, subtitle, badge, onClick }: {
  image: string | null; title: string; subtitle?: string; badge?: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="group text-left flex flex-col cursor-pointer">
      <div className="relative aspect-square w-full overflow-hidden bg-[#111]">
        {image && (
          <img src={image} alt="" loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        {badge && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider bg-black/70 text-white">{badge}</span>
        )}
        <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
          <span className="text-white text-2xl">▶</span>
        </span>
      </div>
      <div className="mt-1.5 text-xs text-white leading-tight line-clamp-2">{title}</div>
      {subtitle && <div className="text-[10px] text-[#888] mt-0.5 truncate">{subtitle}</div>}
    </button>
  );
}

export function ScPanel({ onPlay }: { onPlay: (t: Track) => void }) {
  const [data, setData] = useState<ScData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<ScPlaylist | null>(null);
  const [plTracks, setPlTracks] = useState<ScTrack[] | null>(null);
  const [loadingPl, setLoadingPl] = useState(false);
  const [subtab, setSubtab] = useState<"likes" | "playlists">("likes");
  const [q, setQ] = useState("");

  const filteredLikes = useMemo(() => {
    const likes = data?.likes || [];
    const needle = q.trim().toLowerCase();
    if (!needle) return likes;
    return likes.filter((t) =>
      t.title.toLowerCase().includes(needle) ||
      t.user.toLowerCase().includes(needle) ||
      t.genre.toLowerCase().includes(needle));
  }, [data, q]);

  useEffect(() => {
    fetch("/data/sc.json")
      .then((r) => { if (!r.ok) throw new Error("sc.json not found — run the SoundCloud sync"); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  // Drill into a playlist: fetch its tracks, hydrating the id-only entries.
  const openPlaylist = useCallback(async (pl: ScPlaylist) => {
    setPlaylist(pl); setPlTracks(null); setLoadingPl(true);
    const cid = data?.clientId;
    // Map a raw api-v2 track object (artwork_url / permalink_url / user.username)
    // to our compact ScTrack shape.
    type RawTrack = { id: number; title?: string; artwork_url?: string; permalink_url?: string;
      duration?: number; genre?: string; streamable?: boolean; user?: { username?: string } };
    const toSc = (t: RawTrack): ScTrack => ({
      id: t.id, title: t.title || "", user: t.user?.username || "", artwork: t.artwork_url || null,
      permalink: t.permalink_url || "", duration: t.duration || 0, genre: t.genre || "", streamable: !!t.streamable,
    });
    try {
      const detail = await fetch(`https://api-v2.soundcloud.com/playlists/${pl.id}?client_id=${cid}`).then((r) => r.json());
      const raw: RawTrack[] = (detail.tracks || []).slice(0, 100);
      const hydrated: RawTrack[] = raw.filter((t) => t.title);
      const missing = raw.filter((t) => !t.title).map((t) => t.id);
      // Resolve id-only tracks in batches of 50.
      for (let i = 0; i < missing.length; i += 50) {
        const ids = missing.slice(i, i + 50).join(",");
        const got = await fetch(`https://api-v2.soundcloud.com/tracks?ids=${ids}&client_id=${cid}`).then((r) => r.json());
        hydrated.push(...(got || []));
      }
      // Preserve playlist order.
      const order = new Map(raw.map((t, i) => [t.id, i]));
      hydrated.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
      setPlTracks(hydrated.map(toSc));
    } catch {
      setPlTracks([]);
    } finally {
      setLoadingPl(false);
    }
  }, [data]);

  if (error) return <div className="flex-1 flex items-center justify-center text-[#888] text-sm">SoundCloud: {error}</div>;
  if (!data) return <div className="flex-1 flex items-center justify-center text-[#888] text-sm">Loading SoundCloud…</div>;

  return (
    <div className="flex-1 overflow-y-auto">
      {playlist && (
        <div className="px-5 py-3 border-b border-[#222] bg-[#0a0a0a]">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => { setPlaylist(null); setPlTracks(null); }}
              className="text-[10px] text-[#888] hover:text-white uppercase tracking-wider">← Playlists</button>
            <div className="text-sm text-white truncate">{playlist.title}</div>
            <div className="text-[10px] text-[#888] shrink-0">{playlist.user} · {playlist.trackCount} tracks</div>
            <a href={playlist.permalink} target="_blank" rel="noreferrer" className="text-[10px] text-[#ff5500] hover:underline ml-auto shrink-0">Open ↗</a>
          </div>
          {loadingPl ? (
            <div className="text-[#888] text-xs py-6">Loading tracks…</div>
          ) : plTracks && plTracks.length > 0 ? (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {plTracks.map((t) => (
                  <Card key={t.id} image={art(t.artwork)} title={t.title} subtitle={t.user} onClick={() => onPlay(scToTrack(t))} />
                ))}
              </div>
              {playlist.trackCount > plTracks.length && (
                <div className="text-[10px] text-[#555] mt-3">Showing first {plTracks.length} of {playlist.trackCount}.</div>
              )}
            </>
          ) : (
            <div className="text-[#888] text-xs py-6">Couldn&apos;t load tracks.</div>
          )}
        </div>
      )}

      {!playlist && (
        <div>
          {/* Subtabs */}
          <div className="px-5 pt-4 pb-3 flex items-center gap-4 border-b border-[#222] sticky top-0 bg-background z-10">
            {(["likes", "playlists"] as const).map((s) => (
              <button key={s} onClick={() => setSubtab(s)}
                className={`text-[11px] uppercase tracking-wider transition-colors ${
                  subtab === s ? "text-white border-b-2 border-[#ff5500] pb-1" : "text-[#888] hover:text-white pb-1"
                }`}>
                {s === "likes" ? "Liked Tracks" : "Playlists"}
                <span className="text-[#555] ml-1.5">{s === "likes" ? data.likes.length : data.playlists.length}</span>
              </button>
            ))}
            {subtab === "likes" && (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Filter by title, artist, genre…"
                className="ml-auto w-56 max-w-[45%] bg-[#111] border border-[#222] px-3 py-1 text-xs text-white placeholder-[#666] focus:outline-none focus:border-[#ff5500]"
              />
            )}
          </div>

          <div className="p-5">
            {subtab === "likes" ? (
              filteredLikes.length > 0 ? (
                <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                  {filteredLikes.map((t) => (
                    <Card key={t.id} image={art(t.artwork)} title={t.title} subtitle={t.user} onClick={() => onPlay(scToTrack(t))} />
                  ))}
                </div>
              ) : (
                <div className="text-[#888] text-xs py-8 text-center">No liked tracks match &ldquo;{q}&rdquo;.</div>
              )
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
                {data.playlists.map((p) => (
                  <Card key={p.id} image={art(p.artwork)} title={p.title} subtitle={`${p.user} · ${p.trackCount}`}
                    badge={p.isAlbum ? "Album" : undefined} onClick={() => openPlaylist(p)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
