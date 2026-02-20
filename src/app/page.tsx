"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { query, fetchSetlistManifest, fetchSetlistCSV } from "@/lib/duckdb";
import { buildArtistQuery, buildTracksQuery, buildTrackSearchQuery, buildBatchTrackLookupQuery, buildScoredRandomQuery, buildTamilQuery } from "@/lib/queries";
import type { RadioArtist } from "@/lib/queries";
import { getCompatibleKeys } from "@/lib/camelot";
import type { Artist, Track, SetlistTrack, ArtistFilters, SavedSetlists, SetlistManifestEntry } from "@/lib/types";
import { FilterPanel } from "@/components/filter-panel";
import { ArtistList } from "@/components/artist-list";
import { TrackList } from "@/components/track-list";
import { SetlistPanel } from "@/components/setlist";
import { ImportModal } from "@/components/import-modal";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/youtube-player";
import Fuse from "fuse.js";
import hotkeys from "hotkeys-js";


const DEFAULT_FILTERS: ArtistFilters = {
  channels: [],
  samay: null,
  desi: null,
  vibes: [],
  tags: [],
  bpmMin: 0,
  bpmMax: 300,
  halfTime: false,
  search: "",
};

function parseUrlParams(): { filters: Partial<ArtistFilters>; artist: string | null; tab: "browse" | "setlists" | null } {
  if (typeof window === "undefined") return { filters: {}, artist: null, tab: null };
  const p = new URLSearchParams(window.location.search);
  const filters: Partial<ArtistFilters> = {};

  const channel = p.get("channel");
  if (channel) filters.channels = channel.split(",").filter(Boolean) as ArtistFilters["channels"];

  const samay = p.get("samay");
  if (samay) filters.samay = samay as ArtistFilters["samay"];

  const desi = p.get("desi");
  if (desi) filters.desi = desi as ArtistFilters["desi"];

  const vibe = p.get("vibe");
  if (vibe) filters.vibes = vibe.split(",").filter(Boolean);

  const bpm = p.get("bpm");
  if (bpm) {
    const parts = bpm.split("-");
    filters.bpmMin = Number(parts[0]) || 0;
    filters.bpmMax = parts.length > 1 ? Number(parts[1]) || 300 : Number(parts[0]) || 300;
  }

  if (p.get("x2") === "1") filters.halfTime = true;

  const q = p.get("q");
  if (q) filters.search = q;

  const artist = p.get("artist");
  const tab = p.get("tab") as "browse" | "setlists" | null;

  return { filters, artist, tab };
}

function buildUrlParams(filters: ArtistFilters, artistName: string | null, tab: "browse" | "setlists"): string {
  const p = new URLSearchParams();

  if (filters.channels.length > 0) p.set("channel", filters.channels.join(","));
  if (filters.samay) p.set("samay", filters.samay);
  if (filters.desi) p.set("desi", filters.desi);
  if (filters.vibes.length > 0) p.set("vibe", filters.vibes.join(","));
  if (filters.bpmMin > 0 || filters.bpmMax < 300) {
    p.set("bpm", filters.bpmMin === filters.bpmMax ? `${filters.bpmMin}` : `${filters.bpmMin}-${filters.bpmMax}`);
  }
  if (filters.halfTime) p.set("x2", "1");
  if (filters.search) p.set("q", filters.search);
  if (artistName) p.set("artist", artistName);
  if (tab === "setlists") p.set("tab", "setlists");

  const str = p.toString();
  return str ? `?${str}` : window.location.pathname;
}

const STORAGE_KEY = "pyaar-setlists";
const PLAY_COUNTS_KEY = "pyaar-play-counts";

interface PlayCounts {
  tracks: Record<string, number>;
  artists: Record<string, number>;
}

function incrementPlayCount(track: Track) {
  try {
    const raw = localStorage.getItem(PLAY_COUNTS_KEY);
    const counts: PlayCounts = raw ? JSON.parse(raw) : { tracks: {}, artists: {} };
    const trackKey = `${track.trackName}:::${track.artistNames}`;
    counts.tracks[trackKey] = (counts.tracks[trackKey] || 0) + 1;
    const primaryArtist = track.artistNames.split(";")[0].trim();
    if (primaryArtist) {
      counts.artists[primaryArtist] = (counts.artists[primaryArtist] || 0) + 1;
    }
    localStorage.setItem(PLAY_COUNTS_KEY, JSON.stringify(counts));
  } catch {}
}

function loadSavedSetlists(): SavedSetlists {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.setlists) return parsed;
    }
    // Migrate from old single-setlist format
    const old = localStorage.getItem("pyaar-setlist");
    if (old) {
      const tracks = JSON.parse(old) as SetlistTrack[];
      if (tracks.length > 0) {
        const id = `migrated-${Date.now()}`;
        return {
          active: id,
          setlists: { [id]: { name: "Untitled", tracks } },
        };
      }
    }
  } catch {}
  return { active: null, setlists: {} };
}

function saveSavedSetlists(data: SavedSetlists) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export default function Home() {
  const urlInit = useRef(parseUrlParams());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allArtists, setAllArtists] = useState<Artist[]>([]);
  const [filters, setFilters] = useState<ArtistFilters>({ ...DEFAULT_FILTERS, ...urlInit.current.filters });
  const [selectedArtist, setSelectedArtist] = useState<Artist | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [searchTracks, setSearchTracks] = useState<Track[]>([]);
  const [setlist, setSetlist] = useState<SetlistTrack[]>([]);
  const [setlistName, setSetlistName] = useState<string | null>(null);
  const [setlistId, setSetlistId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<"browse" | "setlists">(urlInit.current.tab || "browse");
  const pendingArtist = useRef<string | null>(urlInit.current.artist);
  const [vaultManifest, setVaultManifest] = useState<SetlistManifestEntry[]>([]);
  const [savedSetlists, setSavedSetlists] = useState<SavedSetlists>({ active: null, setlists: {} });
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [mobileSetlistOpen, setMobileSetlistOpen] = useState(false);
  const [radioMode, setRadioMode] = useState(false);
  const [tamilMode, setTamilMode] = useState(false);
  const [tamilTracks, setTamilTracks] = useState<Track[]>([]);
  const [tamilSearch, setTamilSearch] = useState("");
  const [tamilBpmMin, setTamilBpmMin] = useState(0);
  const [tamilBpmMax, setTamilBpmMax] = useState(300);
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [featuredArtists, setFeaturedArtists] = useState<Artist[]>([]);
  const playerRef = useRef<YouTubePlayerHandle | null>(null);
  const playRandomRef = useRef<(() => void) | null>(null);
  const prefetchRef = useRef<{ track: Track; forRadio: boolean } | null>(null);
  const prefetchAbortRef = useRef<AbortController | null>(null);

  // Pick 5 random featured artists on first load
  const featuredInitialized = useRef(false);
  useEffect(() => {
    if (featuredInitialized.current || allArtists.length === 0) return;
    featuredInitialized.current = true;
    const shuffled = [...allArtists].sort(() => Math.random() - 0.5);
    setFeaturedArtists(shuffled.slice(0, 5));
  }, [allArtists]);

  // Resolve artist from URL param once artists are loaded
  useEffect(() => {
    if (!pendingArtist.current || allArtists.length === 0) return;
    const name = pendingArtist.current;
    pendingArtist.current = null;
    const match = allArtists.find(
      (a) => a.artist.toLowerCase() === name.toLowerCase()
    );
    if (match) {
      setSelectedArtist(match);
      // fetchTracks will be called by the BPM effect or we trigger it here
      const { bpmMin, bpmMax, halfTime } = filters;
      const sql = buildTracksQuery(match.artist, match.aliases, bpmMin, bpmMax, halfTime);
      setTracksLoading(true);
      query<{
        trackName: string; artistNames: string; albumName: string;
        genres: string | null; tempo: number | null; duration: string;
        key: number | null; popularity: number | null; videoId: string;
        soundcloudId: string | null;
      }>(sql).then((rows) => {
        setTracks(rows.map((r) => ({
          trackName: r.trackName, artistNames: r.artistNames,
          albumName: r.albumName || "",
          genres: r.genres ? r.genres.split(",").map((g) => g.trim()) : [],
          tempo: Number(r.tempo) || 0, duration: r.duration || "",
          key: Number(r.key) || 0, popularity: Number(r.popularity) || 0,
          videoId: r.videoId || "", soundcloudId: r.soundcloudId || "",
        })));
        setTracksLoading(false);
      }).catch(() => { setTracks([]); setTracksLoading(false); });
    }
  }, [allArtists]);

  // Sync state → URL (replaceState, no navigation)
  useEffect(() => {
    const url = buildUrlParams(filters, selectedArtist?.artist ?? null, tab);
    window.history.replaceState(null, "", url);
  }, [filters, selectedArtist, tab]);

  // Are filters pristine? (no search, no filters applied)
  const filtersActive = useMemo(() => {
    return (
      filters.search.length > 0 ||
      filters.channels.length > 0 ||
      filters.vibes.length > 0 ||
      filters.samay !== null ||
      filters.desi !== null ||
      filters.bpmMin > 0 ||
      filters.bpmMax < 300
    );
  }, [filters]);

  // Fuse.js: fuzzy search on artist list (client-side)
  const fuseIndex = useMemo(
    () =>
      new Fuse(allArtists, {
        keys: [
          { name: "artist", weight: 2 },
          { name: "aliases", weight: 1 },
        ],
        threshold: 0.3,
        useExtendedSearch: true,
      }),
    [allArtists]
  );

  const artists = useMemo(() => {
    if (!filters.search || filters.search.length < 2) return allArtists;
    return fuseIndex.search(filters.search).map((r) => r.item);
  }, [allArtists, filters.search, fuseIndex]);

  // Keyboard shortcuts
  useEffect(() => {
    hotkeys.filter = () => true; // allow hotkeys even in inputs (we check manually)
    hotkeys("space", (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      playerRef.current?.toggle();
    });
    hotkeys("n", (e) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      playRandomRef.current?.();
    });
    hotkeys("escape", () => {
      setNowPlaying(null);
      setRadioMode(false);
    });
    return () => {
      hotkeys.unbind("space");
      hotkeys.unbind("n");
      hotkeys.unbind("escape");
    };
  }, []);

  // Load saved setlists from localStorage on mount
  useEffect(() => {
    const saved = loadSavedSetlists();
    setSavedSetlists(saved);
    if (saved.active && saved.setlists[saved.active]) {
      const active = saved.setlists[saved.active];
      setSetlist(active.tracks);
      setSetlistName(active.name);
      setSetlistId(saved.active);
    }
  }, []);

  // Load vault manifest on mount
  useEffect(() => {
    fetchSetlistManifest().then(setVaultManifest);
  }, []);

  // Persist to localStorage whenever setlist changes
  useEffect(() => {
    if (setlistId && savedSetlists.setlists[setlistId]) {
      const updated: SavedSetlists = {
        active: setlistId,
        setlists: {
          ...savedSetlists.setlists,
          [setlistId]: { name: setlistName || "Untitled", tracks: setlist },
        },
      };
      saveSavedSetlists(updated);
    }
  }, [setlist, setlistName]);

  // --- B4: Track play counts in localStorage ---
  useEffect(() => {
    if (nowPlaying) incrementPlayCount(nowPlaying);
  }, [nowPlaying]);

  // Track recently played (last 20)
  useEffect(() => {
    if (!nowPlaying) return;
    setRecentlyPlayed((prev) => {
      const isDupe = prev.some(
        (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
      );
      if (isDupe) return prev;
      return [nowPlaying, ...prev].slice(0, 20);
    });
  }, [nowPlaying]);

  // Structured filters (excluding search) for DuckDB artist query
  const structuralFilters = useMemo(() => ({
    ...filters,
    search: "", // search handled by Fuse.js client-side
  }), [filters.channels, filters.samay, filters.desi, filters.vibes, filters.bpmMin, filters.bpmMax, filters.halfTime, filters.tags]);

  const fetchArtists = useCallback(async () => {
    try {
      const sql = buildArtistQuery(structuralFilters);
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

      setAllArtists(
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
  }, [structuralFilters]);

  useEffect(() => {
    fetchArtists();
  }, [fetchArtists]);

  // Track search via DuckDB (separate from artist search)
  useEffect(() => {
    if (!filters.search || filters.search.length < 2) {
      setSearchTracks([]);
      return;
    }
    const searchText = filters.search;
    (async () => {
      try {
        const trackSql = buildTrackSearchQuery(searchText);
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
          soundcloudId: string | null;
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
            soundcloudId: r.soundcloudId || "",
          }))
        );
      } catch {
        setSearchTracks([]);
      }
    })();
  }, [filters.search]);

  // Tamil mode: query tamil table
  useEffect(() => {
    if (!tamilMode) return;
    (async () => {
      try {
        const sql = buildTamilQuery(tamilSearch, tamilBpmMin, tamilBpmMax);
        const rows = await query<{
          trackName: string;
          artistNames: string;
          albumName: string;
          tempo: number | null;
          duration: string;
          videoId: string;
        }>(sql);
        setTamilTracks(
          rows.map((r) => ({
            trackName: r.trackName || "",
            artistNames: r.artistNames || "",
            albumName: r.albumName || "",
            genres: [],
            tempo: Number(r.tempo) || 0,
            duration: r.duration || "",
            key: 0,
            popularity: 0,
            videoId: r.videoId || "",
            soundcloudId: "",
          }))
        );
      } catch {
        setTamilTracks([]);
      }
    })();
  }, [tamilMode, tamilSearch, tamilBpmMin, tamilBpmMax]);

  const fetchTracks = useCallback(async (artist: Artist, bpmMin: number, bpmMax: number, halfTime: boolean) => {
    setTracksLoading(true);
    try {
      const sql = buildTracksQuery(artist.artist, artist.aliases, bpmMin, bpmMax, halfTime);
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
        soundcloudId: string | null;
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
          soundcloudId: r.soundcloudId || "",
        }))
      );
    } catch {
      setTracks([]);
    }
    setTracksLoading(false);
  }, []);

  const handleSelectArtist = useCallback(async (artist: Artist | null) => {
    setSelectedArtist(artist);
    if (!artist) {
      setTracks([]);
      return;
    }
    fetchTracks(artist, filters.bpmMin, filters.bpmMax, filters.halfTime);
  }, [fetchTracks, filters.bpmMin, filters.bpmMax, filters.halfTime]);

  // Re-fetch tracks when BPM filters change while viewing an artist
  useEffect(() => {
    if (selectedArtist) {
      fetchTracks(selectedArtist, filters.bpmMin, filters.bpmMax, filters.halfTime);
    }
  }, [filters.bpmMin, filters.bpmMax, filters.halfTime]);

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

  const reorderTrack = useCallback((fromIndex: number, toIndex: number) => {
    setSetlist((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next.map((t, i) => ({ ...t, position: i }));
    });
  }, []);

  const rowToTrack = useCallback((r: {
    trackName: string;
    artistNames: string;
    albumName: string;
    genres: string | null;
    tempo: number | null;
    duration: string;
    key: number | null;
    popularity: number | null;
    videoId: string;
    soundcloudId: string | null;
  }): Track => ({
    trackName: r.trackName,
    artistNames: r.artistNames,
    albumName: r.albumName || "",
    genres: r.genres ? r.genres.split(",").map((g) => g.trim()) : [],
    tempo: Number(r.tempo) || 0,
    duration: r.duration || "",
    key: Number(r.key) || 0,
    popularity: Number(r.popularity) || 0,
    videoId: r.videoId || "",
    soundcloudId: r.soundcloudId || "",
  }), []);

  type TrackRow = {
    trackName: string; artistNames: string; albumName: string;
    genres: string | null; tempo: number | null; duration: string;
    key: number | null; popularity: number | null; videoId: string;
    soundcloudId: string | null;
  };

  const recentExcludeKeys = useMemo(() =>
    recentlyPlayed.map((t) => `${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`),
    [recentlyPlayed]
  );

  // Pure random — no BPM/key scoring, just surprise me
  const playNext = useCallback(async () => {
    // Use prefetched track if available and matches mode
    const pf = prefetchRef.current;
    if (pf && !pf.forRadio) {
      prefetchRef.current = null;
      setNowPlaying(pf.track);
      return;
    }

    if (tamilMode) {
      if (tamilTracks.length === 0) return;
      const recentSet = new Set(recentExcludeKeys);
      const candidates = tamilTracks.filter(
        (t) => !recentSet.has(`${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`)
      );
      const pool = candidates.length > 0 ? candidates : tamilTracks;
      setNowPlaying(pool[Math.floor(Math.random() * pool.length)]);
      return;
    }

    if (artists.length === 0) return;
    const radioArtists: RadioArtist[] = artists.map((a) => ({ artist: a.artist, aliases: a.aliases }));

    try {
      const sql = buildScoredRandomQuery(radioArtists, 0, undefined, recentExcludeKeys);
      const rows = await query<TrackRow>(sql);
      if (rows.length > 0) setNowPlaying(rowToTrack(rows[0]));
    } catch {}
  }, [artists, recentExcludeKeys, rowToTrack, tamilMode, tamilTracks]);

  // Radio next — BPM proximity + key compatibility scoring
  const playRadio = useCallback(async () => {
    // Use prefetched track if available and matches mode
    const pf = prefetchRef.current;
    if (pf && pf.forRadio) {
      prefetchRef.current = null;
      setNowPlaying(pf.track);
      return;
    }

    if (tamilMode) {
      if (tamilTracks.length === 0) return;
      const currentBPM = nowPlaying?.tempo || 0;
      const recentSet = new Set(recentExcludeKeys);
      const candidates = tamilTracks.filter(
        (t) => !recentSet.has(`${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`)
      );
      const pool = candidates.length > 0 ? candidates : tamilTracks;

      if (currentBPM > 0) {
        // Score by BPM proximity + randomness
        const scored = pool.map((t) => ({
          track: t,
          score: Math.max(0, 30 - Math.abs((t.tempo || 0) - currentBPM)) + Math.random() * 15,
        }));
        scored.sort((a, b) => b.score - a.score);
        setNowPlaying(scored[0].track);
      } else {
        setNowPlaying(pool[Math.floor(Math.random() * pool.length)]);
      }
      return;
    }

    if (artists.length === 0) return;
    const radioArtists: RadioArtist[] = artists.map((a) => ({ artist: a.artist, aliases: a.aliases }));
    const currentBPM = nowPlaying?.tempo || 0;
    const currentKey = nowPlaying?.key;
    const compatKeys = currentKey != null && currentKey >= 0 ? getCompatibleKeys(currentKey) : undefined;

    try {
      const sql = buildScoredRandomQuery(radioArtists, currentBPM, compatKeys, recentExcludeKeys);
      const rows = await query<TrackRow>(sql);
      if (rows.length > 0) setNowPlaying(rowToTrack(rows[0]));
    } catch {}
  }, [artists, nowPlaying, recentExcludeKeys, rowToTrack, tamilMode, tamilTracks]);

  // Keep ref in sync for hotkeys — next uses radio when radio is on
  playRandomRef.current = radioMode ? playRadio : playNext;

  const handleRadioNext = useCallback(() => {
    if (radioMode) playRadio();
  }, [radioMode, playRadio]);

  // --- Prefetch next track in background ---
  const resolveVideoId = useCallback(async (trackName: string, artistNames: string): Promise<string | null> => {
    const artist = artistNames.split(";")[0].trim();
    const q = `${trackName} ${artist}`;
    try {
      const res = await fetch(`/api/search-yt?q=${encodeURIComponent(q)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.videoId || null;
    } catch { return null; }
  }, []);

  const prefetchNext = useCallback(async (forRadio: boolean) => {
    prefetchAbortRef.current?.abort();
    const abort = new AbortController();
    prefetchAbortRef.current = abort;

    try {
      let nextTrack: Track | null = null;

      if (tamilMode) {
        if (tamilTracks.length === 0) return;
        const recentSet = new Set(recentExcludeKeys);
        const candidates = tamilTracks.filter(
          (t) => !recentSet.has(`${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`)
        );
        const pool = candidates.length > 0 ? candidates : tamilTracks;
        if (forRadio && nowPlaying?.tempo) {
          const scored = pool.map((t) => ({
            track: t,
            score: Math.max(0, 30 - Math.abs((t.tempo || 0) - (nowPlaying?.tempo || 0))) + Math.random() * 15,
          }));
          scored.sort((a, b) => b.score - a.score);
          nextTrack = scored[0].track;
        } else {
          nextTrack = pool[Math.floor(Math.random() * pool.length)];
        }
      } else {
        if (artists.length === 0) return;
        const radioArtists: RadioArtist[] = artists.map((a) => ({ artist: a.artist, aliases: a.aliases }));
        const currentBPM = forRadio ? (nowPlaying?.tempo || 0) : 0;
        const currentKey = forRadio ? nowPlaying?.key : undefined;
        const compatKeys = currentKey != null && currentKey >= 0 ? getCompatibleKeys(currentKey) : undefined;
        const sql = buildScoredRandomQuery(radioArtists, currentBPM, compatKeys, recentExcludeKeys);
        const rows = await query<TrackRow>(sql);
        if (rows.length > 0) nextTrack = rowToTrack(rows[0]);
      }

      if (abort.signal.aborted || !nextTrack) return;

      // Pre-resolve videoId if missing
      if (!nextTrack.videoId) {
        const vid = await resolveVideoId(nextTrack.trackName, nextTrack.artistNames);
        if (abort.signal.aborted) return;
        if (vid) nextTrack = { ...nextTrack, videoId: vid };
      }

      if (!abort.signal.aborted) {
        prefetchRef.current = { track: nextTrack, forRadio };
      }
    } catch {}
  }, [artists, nowPlaying, recentExcludeKeys, rowToTrack, tamilMode, tamilTracks, resolveVideoId]);

  // Trigger prefetch when song starts playing
  useEffect(() => {
    if (!nowPlaying) return;
    const timer = setTimeout(() => prefetchNext(radioMode), 1000);
    return () => clearTimeout(timer);
  }, [nowPlaying, radioMode, prefetchNext]);

  // --- Lock screen / MediaSession controls ---
  const playNextRef = useRef(playNext);
  const playRadioRef = useRef(playRadio);
  playNextRef.current = playNext;
  playRadioRef.current = playRadio;

  useEffect(() => {
    if (!("mediaSession" in navigator) || !nowPlaying) return;
    const artist = nowPlaying.artistNames.split(";")[0].trim();
    navigator.mediaSession.metadata = new MediaMetadata({
      title: nowPlaying.trackName,
      artist,
      album: nowPlaying.albumName || undefined,
    });
    navigator.mediaSession.setActionHandler("play", () => playerRef.current?.toggle());
    navigator.mediaSession.setActionHandler("pause", () => playerRef.current?.toggle());
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      if (radioMode) playRadioRef.current();
      else playNextRef.current();
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      const idx = recentlyPlayed.findIndex(
        (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
      );
      const prev = recentlyPlayed[idx + 1] || recentlyPlayed[1];
      if (prev) setNowPlaying(prev);
    });
  }, [nowPlaying, radioMode, recentlyPlayed]);

  const handleImport = useCallback(async (lines: { track: string; artist: string }[]) => {
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
        soundcloudId: string | null;
      }>(sql);

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
            soundcloudId: match.soundcloudId || "",
            id,
            position: i,
          };
        }
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
          soundcloudId: "",
          id,
          position: i,
        };
      });

      setSetlist(newTracks);
    } catch {
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
        soundcloudId: "",
        id: `${line.track}-${line.artist}-${Date.now()}-${i}`,
        position: i,
      }));
      setSetlist(newTracks);
    }
  }, []);

  // --- Multi-setlist operations ---

  const handleSave = useCallback(() => {
    const id = setlistId || `setlist-${Date.now()}`;
    const name = setlistName || "Untitled";

    const updated: SavedSetlists = {
      active: id,
      setlists: {
        ...savedSetlists.setlists,
        [id]: { name, tracks: setlist },
      },
    };
    setSavedSetlists(updated);
    saveSavedSetlists(updated);
    setSetlistId(id);
    setSetlistName(name);
  }, [setlistId, setlistName, setlist, savedSetlists]);

  const handleNew = useCallback(() => {
    const name = prompt("Setlist name:");
    if (!name) return;

    const id = `setlist-${Date.now()}`;
    setSetlist([]);
    setSetlistName(name);
    setSetlistId(id);

    const updated: SavedSetlists = {
      active: id,
      setlists: {
        ...savedSetlists.setlists,
        [id]: { name, tracks: [] },
      },
    };
    setSavedSetlists(updated);
    saveSavedSetlists(updated);
  }, [savedSetlists]);

  const handleLoadBrowser = useCallback((id: string) => {
    const entry = savedSetlists.setlists[id];
    if (!entry) return;
    setSetlist(entry.tracks);
    setSetlistName(entry.name);
    setSetlistId(id);

    const updated = { ...savedSetlists, active: id };
    setSavedSetlists(updated);
    saveSavedSetlists(updated);
  }, [savedSetlists]);

  const handleLoadVault = useCallback(async (entry: SetlistManifestEntry) => {
    try {
      const csvRows = await fetchSetlistCSV(entry.file);

      // Hydrate from masterlist via DuckDB
      const lines = csvRows.map((r) => ({ track: r.track, artist: r.artist }));
      let hydratedTracks: SetlistTrack[];

      if (lines.length > 0) {
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
            soundcloudId: string | null;
          }>(sql);

          const lookup = new Map<string, typeof rows[0]>();
          for (const r of rows) {
            lookup.set(r.trackName.toLowerCase(), r);
          }

          hydratedTracks = csvRows.map((csvRow, i) => {
            const match = lookup.get(csvRow.track.toLowerCase());
            const id = `vault-${entry.id}-${i}`;
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
                soundcloudId: match.soundcloudId || "",
                id,
                position: i,
              };
            }
            // Use CSV data as fallback
            return {
              trackName: csvRow.track,
              artistNames: csvRow.artist,
              albumName: "",
              genres: [],
              tempo: csvRow.bpm ? Number(csvRow.bpm) : 0,
              duration: csvRow.duration || "",
              key: csvRow.key ? Number(csvRow.key) : 0,
              popularity: 0,
              videoId: "",
          soundcloudId: "",
              id,
              position: i,
            };
          });
        } catch {
          // Fallback: use CSV data directly
          hydratedTracks = csvRows.map((csvRow, i) => ({
            trackName: csvRow.track,
            artistNames: csvRow.artist,
            albumName: "",
            genres: [],
            tempo: csvRow.bpm ? Number(csvRow.bpm) : 0,
            duration: csvRow.duration || "",
            key: csvRow.key ? Number(csvRow.key) : 0,
            popularity: 0,
            videoId: "",
          soundcloudId: "",
            id: `vault-${entry.id}-${i}`,
            position: i,
          }));
        }
      } else {
        hydratedTracks = [];
      }

      // Load as a new browser copy
      const newId = `vault-${entry.id}-${Date.now()}`;
      setSetlist(hydratedTracks);
      setSetlistName(entry.name);
      setSetlistId(newId);

      const updated: SavedSetlists = {
        active: newId,
        setlists: {
          ...savedSetlists.setlists,
          [newId]: { name: entry.name, tracks: hydratedTracks },
        },
      };
      setSavedSetlists(updated);
      saveSavedSetlists(updated);
    } catch (e) {
      console.error("Failed to load vault setlist:", e);
    }
  }, [savedSetlists]);

  const handleDeleteBrowser = useCallback((id: string) => {
    const { [id]: _, ...rest } = savedSetlists.setlists;
    const updated: SavedSetlists = {
      active: savedSetlists.active === id ? null : savedSetlists.active,
      setlists: rest,
    };
    setSavedSetlists(updated);
    saveSavedSetlists(updated);

    // If we deleted the active setlist, clear the UI
    if (setlistId === id) {
      setSetlist([]);
      setSetlistName(null);
      setSetlistId(null);
    }
  }, [savedSetlists, setlistId]);

  const handleRename = useCallback((name: string) => {
    setSetlistName(name);
    if (setlistId && savedSetlists.setlists[setlistId]) {
      const updated: SavedSetlists = {
        ...savedSetlists,
        setlists: {
          ...savedSetlists.setlists,
          [setlistId]: { ...savedSetlists.setlists[setlistId], name },
        },
      };
      setSavedSetlists(updated);
      saveSavedSetlists(updated);
    }
  }, [setlistId, savedSetlists]);

  const browserSetlistsList = Object.entries(savedSetlists.setlists).map(([id, data]) => ({
    id,
    name: data.name,
    trackCount: data.tracks.length,
  }));

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
    <div className={`flex min-h-screen bg-black pt-[env(safe-area-inset-top)] ${nowPlaying ? "pb-24 md:pb-10" : ""}`}>
      {/* Left: Browse / Setlists */}
      <div className="flex-1 min-w-0 md:border-r border-[#222] flex flex-col">
        <div className="px-3 md:px-5 py-3 border-b border-[#222] flex items-center justify-between gap-2">
          <h1
            className="text-sm font-bold uppercase tracking-[0.2em] cursor-pointer hover:text-red-400 transition-colors shrink-0"
            onClick={() => { handleSelectArtist(null); setTab("browse"); }}
          >Pyaar Radio</h1>
          <button
            onClick={() => { playRadio(); setRadioMode(true); }}
            disabled={artists.length === 0}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors shrink-0 ${
              radioMode
                ? "bg-red-600 text-white"
                : "bg-[#111] text-[#888] hover:text-white disabled:text-[#333]"
            }`}
            title="Shuffle play from filtered artists"
          >
            Radio
          </button>
          <div className="flex gap-1">
            <button
              onClick={() => setTab("browse")}
              className={`px-3 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                tab === "browse"
                  ? "bg-[#222] text-white"
                  : "bg-[#111] text-[#888] hover:text-white"
              }`}
            >
              Browse
            </button>
            <button
              onClick={() => setTab("setlists")}
              className={`px-3 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                tab === "setlists"
                  ? "bg-[#222] text-white"
                  : "bg-[#111] text-[#888] hover:text-white"
              }`}
            >
              Setlists
              {browserSetlistsList.length > 0 && (
                <span className="ml-1.5 text-[#555]">{browserSetlistsList.length}</span>
              )}
            </button>
          </div>
        </div>

        {tab === "setlists" ? (
          <div className="flex-1 overflow-y-auto">
            {vaultManifest.length > 0 && (
              <>
                <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-[#555] uppercase tracking-wider">
                    Saved ({vaultManifest.length})
                  </span>
                </div>
                {vaultManifest.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-5 py-2.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 cursor-pointer group"
                    onClick={() => {
                      handleLoadVault(entry);
                      setTab("browse");
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
                        {entry.name}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#444] tabular-nums">
                      {entry.trackCount} tracks
                    </span>
                  </div>
                ))}
              </>
            )}
            {browserSetlistsList.length > 0 && (
              <>
                <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-[#555] uppercase tracking-wider">
                    Browser ({browserSetlistsList.length})
                  </span>
                </div>
                {browserSetlistsList.map((entry) => (
                  <div
                    key={entry.id}
                    className="px-5 py-2.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 cursor-pointer group"
                    onClick={() => {
                      handleLoadBrowser(entry.id);
                      setTab("browse");
                    }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-[#444] shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
                        {entry.name}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#444] tabular-nums mr-1">
                      {entry.trackCount} tracks
                    </span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBrowser(entry.id);
                      }}
                      className="text-[#222] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all text-xs"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </>
            )}
            {vaultManifest.length === 0 && browserSetlistsList.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-20">
                <p className="text-[#333] text-xs uppercase tracking-widest text-center px-8">
                  No saved setlists<br />Use Save to store a setlist
                </p>
              </div>
            )}
          </div>
        ) : (
          <>
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              artistCount={artists.length}
              tamilMode={tamilMode}
              onTamilToggle={() => setTamilMode((v) => !v)}
              tamilSearch={tamilSearch}
              onTamilSearchChange={setTamilSearch}
              tamilBpmMin={tamilBpmMin}
              tamilBpmMax={tamilBpmMax}
              onTamilBpmChange={(min, max) => { setTamilBpmMin(min); setTamilBpmMax(max); }}
              tamilTrackCount={tamilTracks.length}
            />

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mx-auto mb-3" />
                  <p className="text-[#666] text-xs uppercase tracking-widest">Loading</p>
                </div>
              </div>
            ) : tamilMode ? (
              <div className="flex-1 overflow-y-auto">
                {tamilTracks.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center py-20">
                    <p className="text-[#444] text-xs uppercase tracking-widest">
                      {tamilSearch ? "No results" : "No Tamil tracks loaded"}
                    </p>
                  </div>
                ) : (
                  tamilTracks.map((track, i) => {
                    const isPlaying = nowPlaying && track.trackName === nowPlaying.trackName && track.artistNames === nowPlaying.artistNames;
                    return (
                      <div
                        key={`tamil-${track.trackName}-${i}`}
                        className={`px-3 md:px-5 py-2 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-2 md:gap-3 group cursor-pointer transition-colors ${
                          isPlaying ? "bg-amber-950/30" : ""
                        }`}
                        onDoubleClick={() => addToSetlist(track)}
                      >
                        <button
                          onClick={() => setNowPlaying(track)}
                          className="text-[#555] hover:text-amber-400 transition-colors text-[10px]"
                          title="Play"
                        >
                          &#9654;
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs truncate transition-colors ${
                            isPlaying ? "text-amber-400" : "text-[#ccc] group-hover:text-white"
                          }`}>
                            {track.trackName}
                          </div>
                          <div className="text-[10px] text-[#555] truncate">
                            {track.artistNames}{track.albumName ? ` · ${track.albumName}` : ""}
                          </div>
                        </div>
                        <span className="text-[10px] text-[#555] tabular-nums font-mono">
                          {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                        </span>
                        <button
                          onClick={() => addToSetlist(track)}
                          className="text-[#333] hover:text-amber-500 transition-colors text-sm font-bold"
                          title="Add to setlist"
                        >
                          +
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            ) : selectedArtist ? (
              <TrackList
                artist={selectedArtist}
                tracks={tracks}
                loading={tracksLoading}
                onBack={() => handleSelectArtist(null)}
                onAddToSetlist={addToSetlist}
                onPlay={setNowPlaying}
                nowPlaying={nowPlaying}
              />
            ) : (
              <div className="flex-1 overflow-y-auto flex flex-col">
                {/* Featured artists — visible only on cold start */}
                {!filtersActive && featuredArtists.length > 0 && (
                  <div className="border-b border-[#222]">
                    <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a] flex items-center justify-between">
                      <span className="text-[10px] text-[#555] uppercase tracking-wider">
                        Discover
                      </span>
                      <button
                        onClick={() => {
                          const shuffled = [...allArtists].sort(() => Math.random() - 0.5);
                          setFeaturedArtists(shuffled.slice(0, 5));
                        }}
                        className="text-[10px] text-[#444] hover:text-white uppercase tracking-wider transition-colors"
                        title="Shuffle"
                      >
                        &#8635;
                      </button>
                    </div>
                    {featuredArtists.map((artist) => (
                      <button
                        key={artist.artist}
                        onClick={() => handleSelectArtist(artist)}
                        className="w-full text-left px-5 py-3 hover:bg-[#111] border-b border-[#151515] transition-colors group"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium group-hover:text-red-500 transition-colors">
                            {artist.artist}
                          </span>
                          <span className="text-[10px] text-[#888] uppercase tracking-wider">
                            {artist.channel}
                          </span>
                          {artist.desi === "Desi" && (
                            <span className="text-[10px] text-red-600 uppercase tracking-wider">
                              Desi
                            </span>
                          )}
                          <span className="text-[10px] text-[#777] ml-auto tabular-nums">
                            {artist.bpmLow}&ndash;{artist.bpmHigh}
                          </span>
                        </div>
                        <div className="flex gap-2 mt-0.5">
                          {artist.vibes.map((v) => (
                            <span key={v} className="text-[10px] text-[#888]">
                              {v}
                            </span>
                          ))}
                          <span className="text-[10px] text-[#555]">&middot;</span>
                          <span className="text-[10px] text-[#777]">{artist.samay}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchTracks.length > 0 && (
                  <>
                    <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                      <span className="text-[10px] text-[#555] uppercase tracking-wider">
                        Tracks ({searchTracks.length})
                      </span>
                    </div>
                    <div className="border-b border-[#222]">
                      {searchTracks.slice(0, 15).map((track, i) => {
                        const isPlaying = nowPlaying && track.trackName === nowPlaying.trackName && track.artistNames === nowPlaying.artistNames;
                        return (
                        <div
                          key={`${track.trackName}-${i}`}
                          className={`px-3 md:px-5 py-1.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-2 md:gap-3 group cursor-pointer transition-colors ${
                            isPlaying ? "bg-red-950/40" : ""
                          }`}
                          onDoubleClick={() => addToSetlist(track)}
                        >
                          <button
                            onClick={() => setNowPlaying(track)}
                            className="text-[#555] hover:text-white transition-colors text-[10px]"
                            title="Preview"
                          >
                            &#9654;
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className={`text-xs truncate transition-colors ${
                              isPlaying ? "text-red-400" : "text-[#ccc] group-hover:text-white"
                            }`}>
                              {track.trackName}
                            </div>
                            <div className="text-[10px] text-[#444] truncate">
                              {track.artistNames.split(";")[0]}
                            </div>
                          </div>
                          <span className="text-[10px] text-[#555] tabular-nums font-mono">
                            {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                          </span>
                          <span className="text-[10px] text-[#333] hidden sm:inline">
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
                        );
                      })}
                    </div>
                  </>
                )}
                {artists.length > 0 && (
                  <>
                    {(searchTracks.length > 0 || (!filtersActive && featuredArtists.length > 0)) && (
                      <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                        <span className="text-[10px] text-[#555] uppercase tracking-wider">
                          {searchTracks.length > 0 ? `Artists (${artists.length})` : "All Artists"}
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
          </>
        )}
      </div>

      {/* Right: Setlist — desktop */}
      <div className="hidden md:flex w-[380px] shrink-0 flex-col bg-black">
        <SetlistPanel
          tracks={setlist}
          setlistName={setlistName}
          nowPlaying={nowPlaying}
          onRemove={removeFromSetlist}
          onReorder={reorderTrack}
          onClear={() => setSetlist([])}
          onImport={() => setImportOpen(true)}
          onOpen={() => setTab("setlists")}
          onSave={handleSave}
          onNew={handleNew}
          onRename={handleRename}
        />
        {recentlyPlayed.length > 0 && (
          <div className="border-t border-[#222]">
            <button
              onClick={() => setRecentExpanded((v) => !v)}
              className="w-full px-4 py-1.5 flex items-center justify-between text-[10px] text-[#555] uppercase tracking-wider hover:text-[#888] transition-colors"
            >
              <span>Recently Played ({recentlyPlayed.length})</span>
              <span>{recentExpanded ? "−" : "+"}</span>
            </button>
            {recentExpanded && (
              <div className="max-h-48 overflow-y-auto">
                {recentlyPlayed.map((track, i) => (
                  <div
                    key={`recent-${track.trackName}-${i}`}
                    className="px-4 py-1 border-t border-[#111] hover:bg-[#0a0a0a] flex items-center gap-2 group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-[#888] truncate group-hover:text-[#ccc] transition-colors">
                        {track.trackName}
                      </div>
                      <div className="text-[10px] text-[#444] truncate">
                        {track.artistNames.split(";")[0]}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#444] tabular-nums font-mono shrink-0">
                      {track.tempo > 0 ? Math.round(track.tempo) : ""}
                    </span>
                    <button
                      onClick={() => addToSetlist(track)}
                      className="text-[#444] hover:text-red-500 transition-colors text-sm font-bold shrink-0"
                      title="Add to setlist"
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile: setlist toggle button */}
      <button
        onClick={() => setMobileSetlistOpen(true)}
        className="md:hidden fixed bottom-12 right-4 z-30 bg-red-600 hover:bg-red-500 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors"
        style={{ bottom: nowPlaying ? "3.5rem" : "1rem" }}
      >
        <span className="text-lg font-bold">{setlist.length || "+"}</span>
      </button>

      {/* Mobile: setlist drawer */}
      {mobileSetlistOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col">
          <div className="flex-shrink-0 bg-black/80 h-16" onClick={() => setMobileSetlistOpen(false)} />
          <div className="flex-1 bg-black border-t border-[#222] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#222]">
              <span className="text-[10px] text-[#888] uppercase tracking-wider">Setlist</span>
              <button
                onClick={() => setMobileSetlistOpen(false)}
                className="text-[#888] hover:text-white text-lg"
              >
                &times;
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SetlistPanel
                tracks={setlist}
                setlistName={setlistName}
                nowPlaying={nowPlaying}
                onRemove={removeFromSetlist}
                onReorder={reorderTrack}
                onClear={() => setSetlist([])}
                onImport={() => setImportOpen(true)}
                onOpen={() => { setTab("setlists"); setMobileSetlistOpen(false); }}
                onSave={handleSave}
                onNew={handleNew}
                onRename={handleRename}
              />
            </div>
          </div>
        </div>
      )}

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={handleImport}
      />

      <YouTubePlayer
        ref={playerRef}
        track={nowPlaying}
        onClose={() => { setNowPlaying(null); setRadioMode(false); }}
        radioMode={radioMode}
        onToggleRadio={() => setRadioMode((r) => !r)}
        onEnded={handleRadioNext}
        onShuffle={radioMode ? playRadio : playNext}
        onPrev={recentlyPlayed.length > 1 ? () => {
          const idx = recentlyPlayed.findIndex(
            (t) => t.trackName === nowPlaying?.trackName && t.artistNames === nowPlaying?.artistNames
          );
          const prev = recentlyPlayed[idx + 1] || recentlyPlayed[1];
          if (prev) setNowPlaying(prev);
        } : undefined}
        onAddToSetlist={addToSetlist}
      />
    </div>
  );
}
