"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import type { Track } from "@/lib/types";
import { NTS_GENRES, NTS_GROUP_TO_TOP } from "@/lib/nts-genre-map";

interface AudioSource { url: string; source: string }
interface NtsShow { alias: string; name: string; description: string; location: string; image: string | null; ntsGenres?: string[]; url: string }
interface NtsEpisode {
  show: string; alias: string; name: string; description: string; date: string;
  location: string; image: string | null; audioSources: AudioSource[]; ntsGenres?: string[]; url: string;
}

// NTS episode/show genres arrive as {id: "genres-<group>-<sub>"} objects; roll
// each up to its NTS top-genre so they share the library's filter vocabulary.
function rollupGenres(genres: unknown): string[] {
  const out: string[] = [];
  for (const g of (genres as { id?: string }[]) || []) {
    const parts = (g.id || "").split("-");
    const top = parts.length > 1 ? NTS_GROUP_TO_TOP[parts[1]] : undefined;
    if (top && !out.includes(top)) out.push(top);
  }
  return out;
}
interface NtsData { syncedAt: string; shows: NtsShow[]; episodes: NtsEpisode[] }

// Build a player Track from an NTS episode, routing to the same source NTS uses
// (SoundCloud permalink or Mixcloud feed). Returns null if the episode has no
// playable audio yet (e.g. a show that just aired and isn't posted).
function episodeToTrack(name: string, showName: string, sources: AudioSource[]): Track | null {
  const src = sources?.[0];
  if (!src) return null;
  const base: Track = {
    trackName: name, artistNames: showName, albumName: "NTS", genres: [],
    tempo: 0, duration: "", key: 0, popularity: 0, videoId: "", soundcloudId: "", bandcampId: "",
  };
  if (src.source === "soundcloud") return { ...base, soundcloudUrl: src.url };
  if (src.source === "mixcloud") {
    try { return { ...base, mixcloudKey: new URL(src.url).pathname }; } catch { return null; }
  }
  return null;
}

function fmtDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function Card({ image, title, subtitle, badge, onClick, disabled }: {
  image: string | null; title: string; subtitle?: string; badge?: string;
  onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group text-left flex flex-col ${disabled ? "opacity-40 cursor-default" : "cursor-pointer"}`}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-[#111]">
        {image && (
          <img src={image} alt="" loading="lazy"
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
        )}
        {badge && (
          <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider bg-black/70 text-white">
            {badge}
          </span>
        )}
        {!disabled && (
          <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30">
            <span className="text-white text-2xl">▶</span>
          </span>
        )}
      </div>
      <div className="mt-1.5 text-xs text-white leading-tight line-clamp-2">{title}</div>
      {subtitle && <div className="text-[10px] text-[#888] mt-0.5 truncate">{subtitle}</div>}
    </button>
  );
}

export function NtsPanel({ onPlay }: { onPlay: (t: Track) => void }) {
  const [data, setData] = useState<NtsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [host, setHost] = useState<NtsShow | null>(null);
  const [hostEpisodes, setHostEpisodes] = useState<NtsEpisode[] | null>(null);
  const [loadingHost, setLoadingHost] = useState(false);
  const [hostTotal, setHostTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [genre, setGenre] = useState<string | null>(null);

  // Genre chips = the NTS top-genres actually present across saved hosts +
  // episodes, in NTS's canonical order.
  const genresPresent = useMemo(() => {
    if (!data) return [];
    const set = new Set<string>();
    data.shows.forEach((s) => (s.ntsGenres || []).forEach((g) => set.add(g)));
    data.episodes.forEach((e) => (e.ntsGenres || []).forEach((g) => set.add(g)));
    return NTS_GENRES.filter((g) => set.has(g));
  }, [data]);
  const matchesGenre = useCallback((g?: string[]) => !genre || (g || []).includes(genre), [genre]);

  useEffect(() => {
    fetch("/data/nts.json")
      .then((r) => { if (!r.ok) throw new Error("nts.json not found"); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);

  // Drill into a host: fetch its recent episodes live from NTS's public API.
  // NTS returns a fixed 12 per page, so paginate via offset (metadata has the total).
  const openHost = useCallback(async (show: NtsShow) => {
    setHost(show); setHostEpisodes(null); setLoadingHost(true); setHostTotal(0);
    try {
      const r = await fetch(`https://www.nts.live/api/v2/shows/${show.alias}/episodes?offset=0`);
      const j = await r.json();
      setHostEpisodes(mapHostEpisodes(show.alias, j.results));
      setHostTotal(j?.metadata?.resultset?.count || 0);
    } catch {
      setHostEpisodes([]);
    } finally {
      setLoadingHost(false);
    }
  }, []);

  const loadMoreEpisodes = useCallback(async () => {
    if (!host || !hostEpisodes) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`https://www.nts.live/api/v2/shows/${host.alias}/episodes?offset=${hostEpisodes.length}`);
      const j = await r.json();
      setHostEpisodes((prev) => [...(prev || []), ...mapHostEpisodes(host.alias, j.results)]);
    } catch { /* keep what we have */ } finally {
      setLoadingMore(false);
    }
  }, [host, hostEpisodes]);

  const playEpisode = useCallback((ep: NtsEpisode) => {
    const t = episodeToTrack(ep.name, ep.show, ep.audioSources);
    if (t) onPlay(t);
    else window.open(ep.url, "_blank"); // not yet posted → open on NTS
  }, [onPlay]);

  if (error) return <div className="flex-1 flex items-center justify-center text-[#888] text-sm">NTS: {error}</div>;
  if (!data) return <div className="flex-1 flex items-center justify-center text-[#888] text-sm">Loading NTS favourites…</div>;

  return (
    <div className="flex-1 overflow-y-auto">
      {/* NTS genre filter (same vocabulary as the track library) */}
      {genresPresent.length > 0 && (
        <div className="px-5 py-2.5 border-b border-[#222] sticky top-0 bg-background z-10 flex items-center gap-1.5 flex-wrap">
          <button onClick={() => setGenre(null)}
            className={`px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors ${
              !genre ? "bg-[#e32636] text-white" : "bg-[#111] text-[#888] hover:text-white"}`}>All</button>
          {genresPresent.map((g) => (
            <button key={g} onClick={() => setGenre(genre === g ? null : g)}
              className={`px-2.5 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                genre === g ? "bg-[#e32636] text-white" : "bg-[#111] text-[#888] hover:text-white"}`}>{g}</button>
          ))}
        </div>
      )}

      {/* Host drill-down overlay */}
      {host && (
        <div className="px-5 py-3 border-b border-[#222] bg-[#0a0a0a]">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => { setHost(null); setHostEpisodes(null); }}
              className="text-[10px] text-[#888] hover:text-white uppercase tracking-wider">← Hosts</button>
            <div className="text-sm text-white">{host.name}</div>
            {host.location && <div className="text-[10px] text-[#888]">{host.location}</div>}
            <a href={host.url} target="_blank" rel="noreferrer" className="text-[10px] text-[#e32636] hover:underline ml-auto">Open on NTS ↗</a>
          </div>
          {loadingHost ? (
            <div className="text-[#888] text-xs py-6">Loading recent episodes…</div>
          ) : hostEpisodes && hostEpisodes.length > 0 ? (
            <>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {hostEpisodes.filter((ep) => matchesGenre(ep.ntsGenres)).map((ep) => {
                  const src = ep.audioSources?.[0]?.source;
                  return <Card key={`${ep.alias}`} image={ep.image} title={ep.name} subtitle={fmtDate(ep.date)}
                    badge={src === "mixcloud" ? "Mixcloud" : undefined}
                    disabled={!ep.audioSources?.length} onClick={() => playEpisode(ep)} />;
                })}
              </div>
              {hostEpisodes.length < hostTotal && (
                <button onClick={loadMoreEpisodes} disabled={loadingMore}
                  className="mt-4 px-4 py-1.5 text-[10px] uppercase tracking-wider bg-[#111] text-[#888] hover:text-white border border-[#222] transition-colors">
                  {loadingMore ? "Loading…" : `Load more (${hostEpisodes.length} of ${hostTotal})`}
                </button>
              )}
            </>
          ) : (
            <div className="text-[#888] text-xs py-6">No recent episodes found.</div>
          )}
        </div>
      )}

      {!host && (
        <div className="p-5 space-y-6">
          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-[#888] mb-3">
              Hosts <span className="text-[#555]">{data.shows.filter((s) => matchesGenre(s.ntsGenres)).length}</span>
              <span className="text-[#555] normal-case tracking-normal ml-2">· click to dig into recent episodes</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {data.shows.filter((s) => matchesGenre(s.ntsGenres)).map((s) => (
                <Card key={s.alias} image={s.image} title={s.name} subtitle={s.location || undefined}
                  onClick={() => openHost(s)} />
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-[11px] uppercase tracking-wider text-[#888] mb-3">
              Saved Episodes <span className="text-[#555]">{data.episodes.filter((e) => matchesGenre(e.ntsGenres)).length}</span>
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {data.episodes.filter((e) => matchesGenre(e.ntsGenres)).map((ep) => {
                const src = ep.audioSources?.[0]?.source;
                return <Card key={`${ep.show}/${ep.alias}`} image={ep.image} title={ep.name}
                  subtitle={fmtDate(ep.date)}
                  badge={src === "mixcloud" ? "Mixcloud" : undefined}
                  disabled={!ep.audioSources?.length} onClick={() => playEpisode(ep)} />;
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function mapHostEpisodes(alias: string, results: unknown): NtsEpisode[] {
  return ((results as Record<string, unknown>[]) || []).map((e) => ({
    show: alias,
    alias: (e.episode_alias as string) || "",
    name: (e.name as string) || "",
    description: (e.description as string) || "",
    date: (e.broadcast as string) || "",
    location: "",
    image: pickImage(e.media as Record<string, string> | undefined),
    audioSources: (e.audio_sources as AudioSource[]) || [],
    ntsGenres: rollupGenres(e.genres),
    url: `https://www.nts.live/shows/${alias}/episodes/${e.episode_alias}`,
  }));
}

function pickImage(media?: Record<string, string>): string | null {
  if (!media) return null;
  for (const k of ["picture_medium_large", "picture_large", "background_large", "picture_medium"]) {
    if (media[k]) return media[k];
  }
  return null;
}
