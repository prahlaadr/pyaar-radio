"use client";

import { useState, useEffect, useCallback } from "react";
import { query } from "@/lib/duckdb";
import { buildArtistQuery, buildTracksQuery, buildTrackSearchQuery, buildBatchTrackLookupQuery } from "@/lib/queries";
import type { Artist, Track, SetlistTrack, ArtistFilters } from "@/lib/types";
import { FilterPanel } from "@/components/filter-panel";
import { ArtistList } from "@/components/artist-list";
import { TrackList } from "@/components/track-list";
import { SetlistPanel } from "@/components/setlist";
import { ImportModal } from "@/components/import-modal";

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
  const [searchTracks, setSearchTracks] = useState<Track[]>([]);
  const [setlist, setSetlist] = useState<SetlistTrack[]>([]);
  const [importOpen, setImportOpen] = useState(false);

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

      // Also search tracks when there's a search term
      if (filters.search && filters.search.length >= 2) {
        const trackSql = buildTrackSearchQuery(filters.search);
        const trackRows = await query<{
          trackName: string;
          artistNames: string;
          albumName: string;
          genres: string | null;
          tempo: number | null;
          duration: string;
          key: number | null;
          popularity: number | null;
          videoId: string;
        }>(trackSql);
        setSearchTracks(
          trackRows.map((r) => ({
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
      } else {
        setSearchTracks([]);
      }

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

  const handleImport = useCallback(async (lines: { track: string; artist: string }[]) => {
    // Try to match against masterlist for metadata
    try {
      const sql = buildBatchTrackLookupQuery(lines);
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

      // Build lookup map: lowercase track name -> row
      const lookup = new Map<string, typeof rows[0]>();
      for (const r of rows) {
        lookup.set(r.trackName.toLowerCase(), r);
      }

      const newTracks: SetlistTrack[] = lines.map((line, i) => {
        const match = lookup.get(line.track.toLowerCase());
        const id = `${line.track}-${line.artist}-${Date.now()}-${i}`;
        if (match) {
          return {
            trackName: match.trackName,
            artistNames: match.artistNames,
            albumName: match.albumName || "",
            genres: match.genres ? match.genres.split(",").map((g) => g.trim()) : [],
            tempo: Number(match.tempo) || 0,
            duration: match.duration || "",
            key: Number(match.key) || 0,
            popularity: Number(match.popularity) || 0,
            videoId: match.videoId || "",
            id,
            position: i,
          };
        }
        // No match — use raw input
        return {
          trackName: line.track,
          artistNames: line.artist,
          albumName: "",
          genres: [],
          tempo: 0,
          duration: "",
          key: 0,
          popularity: 0,
          videoId: "",
          id,
          position: i,
        };
      });

      setSetlist(newTracks);
    } catch {
      // Fallback: just add without metadata
      const newTracks: SetlistTrack[] = lines.map((line, i) => ({
        trackName: line.track,
        artistNames: line.artist,
        albumName: "",
        genres: [],
        tempo: 0,
        duration: "",
        key: 0,
        popularity: 0,
        videoId: "",
        id: `${line.track}-${line.artist}-${Date.now()}-${i}`,
        position: i,
      }));
      setSetlist(newTracks);
    }
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
          <div className="flex-1 overflow-y-auto flex flex-col">
            {searchTracks.length > 0 && (
              <>
                <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-[#555] uppercase tracking-wider">
                    Tracks ({searchTracks.length})
                  </span>
                </div>
                <div className="border-b border-[#222]">
                  {searchTracks.slice(0, 15).map((track, i) => (
                    <div
                      key={`${track.trackName}-${i}`}
                      className="px-5 py-1.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 group"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate text-[#ccc] group-hover:text-white transition-colors">
                          {track.trackName}
                        </div>
                        <div className="text-[10px] text-[#444] truncate">
                          {track.artistNames.split(";")[0]}
                        </div>
                      </div>
                      <span className="text-[10px] text-[#555] tabular-nums font-mono">
                        {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                      </span>
                      <span className="text-[10px] text-[#333]">
                        {track.duration || "—"}
                      </span>
                      <button
                        onClick={() => addToSetlist(track)}
                        className="text-[#333] hover:text-red-500 transition-colors text-sm font-bold"
                        title="Add to setlist"
                      >
                        +
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {artists.length > 0 && (
              <>
                {searchTracks.length > 0 && (
                  <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                    <span className="text-[10px] text-[#555] uppercase tracking-wider">
                      Artists ({artists.length})
                    </span>
                  </div>
                )}
                <ArtistList artists={artists} onSelect={handleSelectArtist} />
              </>
            )}
            {searchTracks.length === 0 && artists.length === 0 && (
              <div className="flex-1 flex items-center justify-center">
                <p className="text-[#444] text-xs uppercase tracking-widest">No results</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Right: Setlist */}
      <div className="w-[380px] shrink-0 flex flex-col bg-black">
        <SetlistPanel
          tracks={setlist}
          onRemove={removeFromSetlist}
          onMove={moveTrack}
          onClear={() => setSetlist([])}
          onImport={() => setImportOpen(true)}
        />
        <ImportModal
          open={importOpen}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
        />
      </div>
    </div>
  );
}
