"use client";

import { useEffect, useState, useCallback } from "react";
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

// A liked SC track → a player Track. Plays via the existing SC widget (numeric id).
function scToTrack(t: ScTrack): Track {
  return {
    trackName: t.title, artistNames: t.user, albumName: "SoundCloud", genres: t.genre ? [t.genre] : [],
    tempo: 0, duration: "", key: 0, popularity: 0, videoId: "", soundcloudId: String(t.id), bandcampId: "",
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
    try {
      const detail = await fetch(`https://api-v2.soundcloud.com/playlists/${pl.id}?client_id=${cid}`).then((r) => r.json());
      const raw: ScTrack[] = (detail.tracks || []).slice(0, 100);
      const hydrated = raw.filter((t) => t.title);
      const missing = raw.filter((t) => !t.title).map((t) => t.id);
      // Resolve id-only tracks in batches of 50.
      for (let i = 0; i < missing.length; i += 50) {
        const ids = missing.slice(i, i + 50).join(",");
        const got = await fetch(`https://api-v2.soundcloud.com/tracks?ids=${ids}&client_id=${cid}`).then((r) => r.json());
        hydrated.push(...(got || []));
      }
      // Preserve playlist order.
      const order = new Map(raw.map((t, i) => [t.id, i]));
      hydrated.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      setPlTracks(hydrated.map((t) => ({
        id: t.id, title: t.title, user: (t.user as unknown as { username?: string })?.username || t.user || "",
        artwork: t.artwork, permalink: t.permalink, duration: t.duration, genre: t.genre, streamable: t.streamable,
      })));
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
        <div className="p-5 space-y-6">
          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-[#888] mb-3">
              Playlists <span className="text-[#555]">{data.playlists.length}</span>
              <span className="text-[#555] normal-case tracking-normal ml-2">· click to open</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {data.playlists.map((p) => (
                <Card key={p.id} image={art(p.artwork)} title={p.title} subtitle={`${p.user} · ${p.trackCount}`}
                  badge={p.isAlbum ? "Album" : undefined} onClick={() => openPlaylist(p)} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-[#888] mb-3">
              Liked Tracks <span className="text-[#555]">{data.likes.length}</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {data.likes.map((t) => (
                <Card key={t.id} image={art(t.artwork)} title={t.title} subtitle={t.user} onClick={() => onPlay(scToTrack(t))} />
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
