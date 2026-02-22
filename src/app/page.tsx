"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { query, fetchSetlistManifest, fetchSetlistCSV } from "@/lib/duckdb";
import { buildArtistQuery, buildTracksQuery, buildTrackSearchQuery, buildBatchTrackLookupQuery, buildScoredRandomQuery, buildTamilQuery, buildTagSectionQuery } from "@/lib/queries";
import type { RadioArtist } from "@/lib/queries";
import { getCompatibleKeys, sortByHarmonicFlow } from "@/lib/camelot";
import type { Artist, Track, SetlistTrack, ArtistFilters, SavedSetlists, SetlistManifestEntry } from "@/lib/types";
import { FilterPanel, type SectionMode } from "@/components/filter-panel";
import { ArtistList } from "@/components/artist-list";
import { TrackList } from "@/components/track-list";
import { SetlistPanel } from "@/components/setlist";
import { ImportModal } from "@/components/import-modal";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/youtube-player";
import Fuse from "fuse.js";
import hotkeys from "hotkeys-js";


import { slugify } from "@/lib/slugify";

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

function parseUrlParams(): { filters: Partial<ArtistFilters>; artist: string | null; tab: "browse" | "setlists" | null; track: string | null; autoplay: boolean } {
  if (typeof window === "undefined") return { filters: {}, artist: null, tab: null, track: null, autoplay: false };
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

  // Support both ?artist=Name and /artist/slug
  let artist = p.get("artist");
  if (!artist) {
    const match = window.location.pathname.match(/^\/artist\/([^/]+)/);
    if (match) artist = decodeURIComponent(match[1]);
  }
  const tab = p.get("tab") as "browse" | "setlists" | null;
  const track = p.get("t");
  const autoplay = p.get("autoplay") === "1";

  return { filters, artist, tab, track, autoplay };
}

function buildUrlParams(filters: ArtistFilters, artistName: string | null, tab: "browse" | "setlists", trackVideoId?: string | null): string {
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
  if (tab === "setlists") p.set("tab", "setlists");
  if (trackVideoId) p.set("t", trackVideoId);

  const basePath = artistName ? `/artist/${slugify(artistName)}` : "/";
  const str = p.toString();
  return str ? `${basePath}?${str}` : basePath;
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
  const pendingTrack = useRef<string | null>(urlInit.current.track);
  const pendingAutoplay = useRef(urlInit.current.autoplay);
  const [shareCopied, setShareCopied] = useState(false);
  const [vaultManifest, setVaultManifest] = useState<SetlistManifestEntry[]>([]);
  const [savedSetlists, setSavedSetlists] = useState<SavedSetlists>({ active: null, setlists: {} });
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [mobileSetlistOpen, setMobileSetlistOpen] = useState(false);
  const [radioMode, setRadioMode] = useState(false);
  const [setlistMode, setSetlistMode] = useState(false);
  const setlistIndexRef = useRef(-1);
  const [tamilMode, setTamilMode] = useState(false);
  const [tamilTracks, setTamilTracks] = useState<Track[]>([]);
  const [tamilSearch, setTamilSearch] = useState("");
  const [tamilBpmMin, setTamilBpmMin] = useState(0);
  const [tamilBpmMax, setTamilBpmMax] = useState(300);
  const [sectionMode, setSectionMode] = useState<SectionMode>("browse");
  const [sectionTracks, setSectionTracks] = useState<Track[]>([]);
  const [sectionSearch, setSectionSearch] = useState("");
  const [sectionBpmMin, setSectionBpmMin] = useState(0);
  const [sectionBpmMax, setSectionBpmMax] = useState(300);
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
      (a) => a.artist.toLowerCase() === name.toLowerCase() || slugify(a.artist) === name.toLowerCase()
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
        bandcampId: string | null;
      }>(sql).then((rows) => {
        setTracks(rows.map((r) => ({
          trackName: r.trackName, artistNames: r.artistNames,
          albumName: r.albumName || "",
          genres: r.genres ? r.genres.split(",").map((g) => g.trim()) : [],
          tempo: Number(r.tempo) || 0, duration: r.duration || "",
          key: Number(r.key) || 0, popularity: Number(r.popularity) || 0,
          videoId: r.videoId || "", soundcloudId: r.soundcloudId || "",
          bandcampId: r.bandcampId || "",
        })));
        setTracksLoading(false);
      }).catch(() => { setTracks([]); setTracksLoading(false); });
    }
  }, [allArtists]);

  // Resolve track from URL param (?t=videoId) once data is ready
  useEffect(() => {
    if (!pendingTrack.current || loading) return;
    const videoId = pendingTrack.current;
    pendingTrack.current = null;
    const sql = `
      SELECT
        "Track Name" as trackName,
        "Artist Name(s)" as artistNames,
        "Album Name" as albumName,
        Genres as genres,
        TRY_CAST(Tempo AS FLOAT) as tempo,
        Duration as duration,
        TRY_CAST(Key AS INT) as key,
        TRY_CAST(Popularity AS INT) as popularity,
        "Video ID" as videoId,
        "Soundcloud ID" as soundcloudId,
        "Bandcamp ID" as bandcampId
      FROM masterlist
      WHERE "Video ID" = '${videoId.replace(/'/g, "''")}'
      LIMIT 1
    `;
    query<{
      trackName: string; artistNames: string; albumName: string;
      genres: string | null; tempo: number | null; duration: string;
      key: number | null; popularity: number | null; videoId: string;
      soundcloudId: string | null; bandcampId: string | null;
    }>(sql).then((rows) => {
      if (rows.length > 0) {
        const r = rows[0];
        setNowPlaying({
          trackName: r.trackName, artistNames: r.artistNames,
          albumName: r.albumName || "",
          genres: r.genres ? r.genres.split(",").map((g) => g.trim()) : [],
          tempo: Number(r.tempo) || 0, duration: r.duration || "",
          key: Number(r.key) || 0, popularity: Number(r.popularity) || 0,
          videoId: r.videoId || "", soundcloudId: r.soundcloudId || "",
          bandcampId: r.bandcampId || "",
        });
      }
    }).catch(() => {});
  }, [loading]);

  const buildShareUrl = useCallback(() => {
    const params = buildUrlParams(filters, selectedArtist?.artist ?? null, tab);
    const base = window.location.origin;
    const sep = params.includes("?") ? "&" : "?";
    return `${base}${params}${sep}autoplay=1`;
  }, [filters, selectedArtist, tab]);

  // Sync state → URL (replaceState, no navigation)
  useEffect(() => {
    const url = buildUrlParams(filters, selectedArtist?.artist ?? null, tab, nowPlaying?.videoId);
    window.history.replaceState(null, "", url);
  }, [filters, selectedArtist, tab, nowPlaying]);

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
          bandcampId: string | null;
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
            bandcampId: r.bandcampId || "",
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
            bandcampId: "",
          }))
        );
      } catch {
        setTamilTracks([]);
      }
    })();
  }, [tamilMode, tamilSearch, tamilBpmMin, tamilBpmMax]);

  // Section mode (Downtempo / Ambient): query masterlist by tag
  useEffect(() => {
    if (sectionMode !== "downtempo" && sectionMode !== "ambient") {
      setSectionTracks([]);
      return;
    }
    const tag = sectionMode === "downtempo" ? "Downtempo" : "Ambient";
    (async () => {
      try {
        const sql = buildTagSectionQuery(tag, sectionSearch, sectionBpmMin, sectionBpmMax);
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
          bandcampId: string | null;
        }>(sql);
        setSectionTracks(
          rows.map((r) => ({
            trackName: r.trackName || "",
            artistNames: r.artistNames || "",
            albumName: r.albumName || "",
            genres: r.genres ? r.genres.split(",").map((g) => g.trim()) : [],
            tempo: Number(r.tempo) || 0,
            duration: r.duration || "",
            key: Number(r.key) || 0,
            popularity: Number(r.popularity) || 0,
            videoId: r.videoId || "",
            soundcloudId: r.soundcloudId || "",
            bandcampId: r.bandcampId || "",
          }))
        );
      } catch {
        setSectionTracks([]);
      }
    })();
  }, [sectionMode, sectionSearch, sectionBpmMin, sectionBpmMax]);

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
        bandcampId: string | null;
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
          bandcampId: r.bandcampId || "",
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
    bandcampId: string | null;
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
    bandcampId: r.bandcampId || "",
  }), []);

  type TrackRow = {
    trackName: string; artistNames: string; albumName: string;
    genres: string | null; tempo: number | null; duration: string;
    key: number | null; popularity: number | null; videoId: string;
    soundcloudId: string | null; bandcampId: string | null;
  };

  const recentExcludeKeys = useMemo(() =>
    recentlyPlayed.map((t) => `${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`),
    [recentlyPlayed]
  );

  // Helper: pick random from a track pool, avoiding recents
  const pickRandomFromPool = useCallback((pool: Track[]) => {
    if (pool.length === 0) return;
    const recentSet = new Set(recentExcludeKeys);
    const candidates = pool.filter(
      (t) => !recentSet.has(`${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`)
    );
    const finalPool = candidates.length > 0 ? candidates : pool;
    setNowPlaying(finalPool[Math.floor(Math.random() * finalPool.length)]);
  }, [recentExcludeKeys]);

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
      pickRandomFromPool(tamilTracks);
      return;
    }

    if (sectionMode === "downtempo" || sectionMode === "ambient") {
      pickRandomFromPool(sectionTracks);
      return;
    }

    if (artists.length === 0) return;
    const radioArtists: RadioArtist[] = artists.map((a) => ({ artist: a.artist, aliases: a.aliases }));

    try {
      const sql = buildScoredRandomQuery(radioArtists, 0, undefined, recentExcludeKeys);
      const rows = await query<TrackRow>(sql);
      if (rows.length > 0) setNowPlaying(rowToTrack(rows[0]));
    } catch {}
  }, [artists, recentExcludeKeys, rowToTrack, tamilMode, tamilTracks, sectionMode, sectionTracks, pickRandomFromPool]);

  // Radio next — BPM proximity + key compatibility scoring
  const playRadio = useCallback(async () => {
    // Use prefetched track if available and matches mode
    const pf = prefetchRef.current;
    if (pf && pf.forRadio) {
      prefetchRef.current = null;
      setNowPlaying(pf.track);
      return;
    }

    // Helper: pick from pool with BPM scoring
    const pickBpmScored = (pool: Track[]) => {
      if (pool.length === 0) return;
      const recentSet = new Set(recentExcludeKeys);
      const candidates = pool.filter(
        (t) => !recentSet.has(`${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`)
      );
      const finalPool = candidates.length > 0 ? candidates : pool;
      const currentBPM = nowPlaying?.tempo || 0;
      if (currentBPM > 0) {
        const scored = finalPool.map((t) => ({
          track: t,
          score: Math.max(0, 30 - Math.abs((t.tempo || 0) - currentBPM)) + Math.random() * 15,
        }));
        scored.sort((a, b) => b.score - a.score);
        setNowPlaying(scored[0].track);
      } else {
        setNowPlaying(finalPool[Math.floor(Math.random() * finalPool.length)]);
      }
    };

    if (tamilMode) {
      pickBpmScored(tamilTracks);
      return;
    }

    if (sectionMode === "downtempo" || sectionMode === "ambient") {
      pickBpmScored(sectionTracks);
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
  }, [artists, nowPlaying, recentExcludeKeys, rowToTrack, tamilMode, tamilTracks, sectionMode, sectionTracks]);

  // Autoplay from URL param (?autoplay=1) — one-shot on first load
  useEffect(() => {
    if (!pendingAutoplay.current || loading || allArtists.length === 0) return;
    if (nowPlaying) return; // already playing (e.g. ?t= was in URL)
    pendingAutoplay.current = false;
    setRadioMode(true);
    playRadio();
  }, [loading, allArtists, nowPlaying, playRadio]);

  // --- Setlist playback ---
  const playFromSetlist = useCallback((track: SetlistTrack, index: number) => {
    setSetlistMode(true);
    setRadioMode(false);
    setlistIndexRef.current = index;
    setNowPlaying(track);
  }, []);

  const playNextInSetlist = useCallback(() => {
    const nextIndex = setlistIndexRef.current + 1;
    if (nextIndex < setlist.length) {
      setlistIndexRef.current = nextIndex;
      setNowPlaying(setlist[nextIndex]);
    } else {
      // End of setlist — stop
      setSetlistMode(false);
      setlistIndexRef.current = -1;
    }
  }, [setlist]);

  // Keep ref in sync for hotkeys — next uses setlist/radio/random
  playRandomRef.current = setlistMode ? playNextInSetlist : radioMode ? playRadio : playNext;

  const handleAutoNext = useCallback(() => {
    if (setlistMode) playNextInSetlist();
    else if (radioMode) playRadio();
  }, [setlistMode, playNextInSetlist, radioMode, playRadio]);

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

      // Pick from section/tamil pool or from artist radio
      const pickFromPool = (pool: Track[]): Track | null => {
        if (pool.length === 0) return null;
        const recentSet = new Set(recentExcludeKeys);
        const candidates = pool.filter(
          (t) => !recentSet.has(`${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`)
        );
        const finalPool = candidates.length > 0 ? candidates : pool;
        if (forRadio && nowPlaying?.tempo) {
          const scored = finalPool.map((t) => ({
            track: t,
            score: Math.max(0, 30 - Math.abs((t.tempo || 0) - (nowPlaying?.tempo || 0))) + Math.random() * 15,
          }));
          scored.sort((a, b) => b.score - a.score);
          return scored[0].track;
        }
        return finalPool[Math.floor(Math.random() * finalPool.length)];
      };

      if (tamilMode) {
        nextTrack = pickFromPool(tamilTracks);
      } else if (sectionMode === "downtempo" || sectionMode === "ambient") {
        nextTrack = pickFromPool(sectionTracks);
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
  }, [artists, nowPlaying, recentExcludeKeys, rowToTrack, tamilMode, tamilTracks, sectionMode, sectionTracks, resolveVideoId]);

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
        bandcampId: string | null;
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
            bandcampId: match.bandcampId || "",
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
          bandcampId: "",
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
        bandcampId: "",
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
            bandcampId: string | null;
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
                bandcampId: match.bandcampId || "",
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
          bandcampId: "",
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
          bandcampId: "",
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

  const handleAutoSort = useCallback(() => {
    setSetlist((prev) => {
      const sorted = sortByHarmonicFlow(prev);
      return sorted.map((t, i) => ({ ...t, position: i }));
    });
  }, []);

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
            onClick={() => { playRadio(); setRadioMode(true); setSetlistMode(false); }}
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
          <button
            onClick={() => {
              navigator.clipboard.writeText(buildShareUrl());
              setShareCopied(true);
              setTimeout(() => setShareCopied(false), 1500);
            }}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors shrink-0 bg-[#111] text-[#888] hover:text-white"
            title="Copy shareable link with autoplay"
          >
            {shareCopied ? "Copied!" : "Share"}
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
              onTamilToggle={() => { setTamilMode((v) => !v); setSectionMode("browse"); }}
              tamilSearch={tamilSearch}
              onTamilSearchChange={setTamilSearch}
              tamilBpmMin={tamilBpmMin}
              tamilBpmMax={tamilBpmMax}
              onTamilBpmChange={(min, max) => { setTamilBpmMin(min); setTamilBpmMax(max); }}
              tamilTrackCount={tamilTracks.length}
              sectionMode={sectionMode}
              onSectionToggle={(section) => {
                if (section === "browse") {
                  setSectionMode("browse");
                } else {
                  setSectionMode(section);
                  setTamilMode(false);
                  setSectionSearch("");
                  setSectionBpmMin(0);
                  setSectionBpmMax(300);
                }
              }}
              sectionSearch={sectionSearch}
              onSectionSearchChange={setSectionSearch}
              sectionBpmMin={sectionBpmMin}
              sectionBpmMax={sectionBpmMax}
              onSectionBpmChange={(min, max) => { setSectionBpmMin(min); setSectionBpmMax(max); }}
              sectionTrackCount={sectionTracks.length}
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
                          onClick={() => { setSetlistMode(false); setNowPlaying(track); }}
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
            ) : (sectionMode === "downtempo" || sectionMode === "ambient") ? (
              <div className="flex-1 overflow-y-auto">
                {sectionTracks.length === 0 ? (
                  <div className="flex-1 flex items-center justify-center py-20">
                    <p className="text-[#444] text-xs uppercase tracking-widest">
                      {sectionSearch ? "No results" : `No ${sectionMode} tracks tagged yet`}
                    </p>
                  </div>
                ) : (
                  sectionTracks.map((track, i) => {
                    const isPlaying = nowPlaying && track.trackName === nowPlaying.trackName && track.artistNames === nowPlaying.artistNames;
                    const accentColor = sectionMode === "downtempo" ? "cyan" : "purple";
                    return (
                      <div
                        key={`${sectionMode}-${track.trackName}-${i}`}
                        className={`px-3 md:px-5 py-2 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-2 md:gap-3 group cursor-pointer transition-colors ${
                          isPlaying ? (sectionMode === "downtempo" ? "bg-cyan-950/30" : "bg-purple-950/30") : ""
                        }`}
                        onDoubleClick={() => addToSetlist(track)}
                      >
                        <button
                          onClick={() => { setSetlistMode(false); setNowPlaying(track); }}
                          className={`text-[#555] transition-colors text-[10px] ${
                            sectionMode === "downtempo" ? "hover:text-cyan-400" : "hover:text-purple-400"
                          }`}
                          title="Play"
                        >
                          &#9654;
                        </button>
                        <div className="flex-1 min-w-0">
                          <div className={`text-xs truncate transition-colors ${
                            isPlaying
                              ? (accentColor === "cyan" ? "text-cyan-400" : "text-purple-400")
                              : "text-[#ccc] group-hover:text-white"
                          }`}>
                            {track.trackName}
                          </div>
                          <div className="text-[10px] text-[#555] truncate">
                            {track.artistNames.split(";")[0]}{track.albumName ? ` · ${track.albumName}` : ""}
                          </div>
                        </div>
                        {track.genres && track.genres.length > 0 && (
                          <span className="text-[10px] text-[#333] hidden sm:inline truncate max-w-24">
                            {track.genres[0]}
                          </span>
                        )}
                        <span className="text-[10px] text-[#555] tabular-nums font-mono">
                          {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                        </span>
                        <button
                          onClick={() => addToSetlist(track)}
                          className={`text-[#333] transition-colors text-sm font-bold ${
                            sectionMode === "downtempo" ? "hover:text-cyan-500" : "hover:text-purple-500"
                          }`}
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
                onPlay={(track) => { setSetlistMode(false); setNowPlaying(track); }}
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
                            onClick={() => { setSetlistMode(false); setNowPlaying(track); }}
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
          onAutoSort={handleAutoSort}
          onPlay={playFromSetlist}
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
                onAutoSort={handleAutoSort}
                onPlay={playFromSetlist}
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
        onClose={() => { setNowPlaying(null); setRadioMode(false); setSetlistMode(false); }}
        radioMode={radioMode || setlistMode}
        onToggleRadio={() => {
          if (setlistMode) { setSetlistMode(false); setRadioMode(true); }
          else setRadioMode((r) => !r);
        }}
        onEnded={handleAutoNext}
        onShuffle={setlistMode ? playNextInSetlist : radioMode ? playRadio : playNext}
        onPrev={setlistMode ? () => {
          const prevIndex = setlistIndexRef.current - 1;
          if (prevIndex >= 0) {
            setlistIndexRef.current = prevIndex;
            setNowPlaying(setlist[prevIndex]);
          }
        } : recentlyPlayed.length > 1 ? () => {
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
