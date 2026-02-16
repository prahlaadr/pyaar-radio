"use client";

import { useState, useEffect, useCallback } from "react";
import { query } from "@/lib/duckdb";
import { buildArtistQuery, buildTracksQuery } from "@/lib/queries";
import type { Artist, Track, SetlistTrack, ArtistFilters } from "@/lib/types";
import { FilterPanel } from "@/components/filter-panel";
import { ArtistList } from "@/components/artist-list";
import { TrackList } from "@/components/track-list";
import { SetlistPanel } from "@/components/setlist";

const DEFAULT_FILTERS: ArtistFilters = {
  channels: [],
  samay: null,
  desi: null,
  vibes: [],
  bpmMin: 0,
  bpmMax: 300,
  search: "",
};

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [artists, setArtists] = useState<Artist[]>([]);
  const [filters, setFilters] = useState<ArtistFilters>(DEFAULT_FILTERS);
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [setlist, setSetlist] = useState<SetlistTrack[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("pyaar-setlist");
      if (saved) setSetlist(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("pyaar-setlist", JSON.stringify(setlist));
  }, [setlist]);

  const fetchArtists = useCallback(async () => {
    try {
      const sql = buildArtistQuery(filters);
      const rows = await query<{
        artist: string;
        aliases: string | null;
        channel: string;
        samay: string;
        desi: string;
        vibes: string;
        bpm_low: number;
        bpm_high: number;
      }>(sql);

      setArtists(
        rows.map((r) => ({
          artist: r.artist,
          aliases: r.aliases ? r.aliases.split("|") : [],
          channel: r.channel as Artist["channel"],
          samay: r.samay as Artist["samay"],
          desi: r.desi as Artist["desi"],
          vibes: r.vibes ? r.vibes.split("|") : [],
          bpmLow: Number(r.bpm_low) || 0,
          bpmHigh: Number(r.bpm_high) || 0,
        }))
      );
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data");
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchArtists();
  }, [fetchArtists]);

  const handleSelectArtist = useCallback(async (artist: Artist | null) => {
    setSelectedArtist(artist);
    if (!artist) {
      setTracks([]);
      return;
    }
    setTracksLoading(true);
    try {
      const sql = buildTracksQuery(artist.artist, artist.aliases);
      const rows = await query<{
        trackName: string;
        artistNames: string;
        albumName: string;
        genres: string | null;
        tempo: number | null;
        duration: string;
        key: number | null;
        popularity: number | null;
        videoId: string;
      }>(sql);

      setTracks(
        rows.map((r) => ({
          trackName: r.trackName,
          artistNames: r.artistNames,
          albumName: r.albumName || "",
          genres: r.genres ? r.genres.split(",").map((g) => g.trim()) : [],
          tempo: Number(r.tempo) || 0,
          duration: r.duration || "",
          key: Number(r.key) || 0,
          popularity: Number(r.popularity) || 0,
          videoId: r.videoId || "",
        }))
      );
    } catch {
      setTracks([]);
    }
    setTracksLoading(false);
  }, []);

  const addToSetlist = useCallback((track: Track) => {
    setSetlist((prev) => {
      const id = `${track.trackName}-${track.artistNames}-${Date.now()}`;
      return [...prev, { ...track, id, position: prev.length }];
    });
  }, []);

  const removeFromSetlist = useCallback((id: string) => {
    setSetlist((prev) =>
      prev.filter((t) => t.id !== id).map((t, i) => ({ ...t, position: i }))
    );
  }, []);

  const moveTrack = useCallback((index: number, direction: "up" | "down") => {
    setSetlist((prev) => {
      const next = [...prev];
      const targetIndex = direction === "up" ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next.map((t, i) => ({ ...t, position: i }));
    });
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-black">
        <div className="text-center">
          <h1 className="text-sm font-bold text-red-500 uppercase tracking-widest mb-2">Error</h1>
          <p className="text-[#666] text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-black">
      {/* Left: Browse */}
      <div className="flex-1 min-w-0 border-r border-[#222] flex flex-col">
        <div className="px-5 py-3 border-b border-[#222] flex items-baseline gap-3">
          <h1 className="text-sm font-bold uppercase tracking-[0.2em]">Pyaar Setlist</h1>
          {!loading && (
            <span className="text-xs text-[#666]">{artists.length} artists</span>
          )}
        </div>

        <FilterPanel filters={filters} onChange={setFilters} />

        {loading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mx-auto mb-3" />
              <p className="text-[#666] text-xs uppercase tracking-widest">Loading</p>
            </div>
          </div>
        ) : selectedArtist ? (
          <TrackList
            artist={selectedArtist}
            tracks={tracks}
            loading={tracksLoading}
            onBack={() => handleSelectArtist(null)}
            onAddToSetlist={addToSetlist}
          />
        ) : (
          <ArtistList artists={artists} onSelect={handleSelectArtist} />
        )}
      </div>

      {/* Right: Setlist */}
      <div className="w-[380px] shrink-0 flex flex-col bg-black">
        <SetlistPanel
          tracks={setlist}
          onRemove={removeFromSetlist}
          onMove={moveTrack}
          onClear={() => setSetlist([])}
        />
      </div>
    </div>
  );
}
