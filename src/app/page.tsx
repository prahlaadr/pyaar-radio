"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { query, fetchSetlistManifest, fetchSetlistCSV } from "@/lib/duckdb";
import { buildArtistQuery, buildTracksQuery, buildTrackSearchQuery, buildBatchTrackLookupQuery, buildScoredRandomQuery, buildTamilQuery, buildIlaiyaraajaQuery, buildTagSectionQuery, buildFilteredTracksQuery, buildChapterSuggestionQuery, buildLikedTracksQuery, buildAlbumTracksQuery } from "@/lib/queries";

type SavedAlbum = { position: number | null; browseId: string; title: string; artist: string; year: string; trackCount: number };
type AlbumSort = "recency" | "release" | "title" | "artist";
import type { RadioArtist } from "@/lib/queries";
import { getCompatibleKeys, sortByHarmonicFlow, getMostCommonKey } from "@/lib/camelot";
import type { Artist, Track, SetlistTrack, ArtistFilters, SavedSetlists, SetlistManifestEntry, SetlistChapter, ChapterType } from "@/lib/types";
import { FilterPanel, type SectionMode } from "@/components/filter-panel";
import { ArtistList } from "@/components/artist-list";
import { TrackList } from "@/components/track-list";
import { LibraryTrackList } from "@/components/library-track-list";
import { SectionTrackList } from "@/components/section-track-list";
import { SetlistPanel } from "@/components/setlist";
import { ImportModal } from "@/components/import-modal";
import { PlaylistPicker } from "@/components/playlist-picker";
import { fetchPlaylistIndex, fetchPlaylist } from "@/lib/playlists";
import type { PlaylistIndexEntry } from "@/lib/types";
import { YouTubePlayer, type YouTubePlayerHandle } from "@/components/youtube-player";
import Fuse from "fuse.js";
import hotkeys from "hotkeys-js";


import { slugify } from "@/lib/slugify";
import { applyOverrides, loadOverrides } from "@/lib/artist-overrides";
import { AdminArtistEditor } from "@/components/admin-artist-editor";
import type { TVChannel, TVChannelData } from "@/lib/tv-types";
import { getNowPlaying } from "@/lib/tv-schedule";
import { TvPlayer, type TvPlayerHandle } from "@/components/tv-player";
import { TvGuide } from "@/components/tv-guide";

const DEFAULT_FILTERS: ArtistFilters = {
  channels: [],
  samay: null,
  desi: null,
  vibes: [],
  tags: [],
  pillars: [],
  bpmMin: 0,
  bpmMax: 300,
  halfTime: false,
  search: "",
};

function parseUrlParams(): { filters: Partial<ArtistFilters>; artist: string | null; tab: "browse" | "setlists" | "liked" | "albums" | null; track: string | null; autoplay: boolean; tamil: boolean; ilaiyaraaja: boolean; section: SectionMode; view: "artists" | "tracks"; tvChannel: string | null; tvVideo: string | null; tvTime: number } {
  if (typeof window === "undefined") return { filters: {}, artist: null, tab: null, track: null, autoplay: false, tamil: false, ilaiyaraaja: false, section: "browse", view: "artists", tvChannel: null, tvVideo: null, tvTime: 0 };
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

  const pillar = p.get("pillar");
  if (pillar) filters.pillars = pillar.split(",").filter(Boolean);

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
  const tab = p.get("tab") as "browse" | "setlists" | "liked" | "albums" | null;
  const track = p.get("t");
  const autoplay = p.get("autoplay") === "1";
  const pathname = window.location.pathname;
  const ilaiyaraaja = pathname === "/tamil/ilaiyaraaja";
  const tamil = pathname === "/tamil" || ilaiyaraaja;
  const section: SectionMode = pathname === "/tv" ? "tv" : pathname === "/ambient" ? "ambient" : pathname === "/downtempo" ? "downtempo" : "browse";
  const view = p.get("view") === "tracks" ? "tracks" as const : "artists" as const;
  const tvChannel = p.get("ch");
  const tvVideo = p.get("v");
  const tvTime = Number(p.get("t")) || 0;

  return { filters, artist, tab, track, autoplay, tamil, ilaiyaraaja, section, view, tvChannel, tvVideo, tvTime };
}

function buildUrlParams(filters: ArtistFilters, artistName: string | null, tab: "browse" | "setlists" | "liked" | "albums", trackVideoId?: string | null, tamil?: boolean, browseView?: "artists" | "tracks", section?: SectionMode, ilaiyaraaja?: boolean, tvChannelId?: string | null, tvVideoId?: string | null, tvTimeOffset?: number): string {
  const p = new URLSearchParams();
  if (section === "tv") {
    if (tvChannelId) p.set("ch", tvChannelId);
    if (tvVideoId) p.set("v", tvVideoId);
    if (tvTimeOffset && tvTimeOffset > 0) p.set("t", String(Math.floor(tvTimeOffset)));
    const str = p.toString();
    return str ? `/tv?${str}` : "/tv";
  }
  if (filters.channels.length > 0) p.set("channel", filters.channels.join(","));
  if (filters.samay) p.set("samay", filters.samay);
  if (filters.desi) p.set("desi", filters.desi);
  if (filters.vibes.length > 0) p.set("vibe", filters.vibes.join(","));
  if (filters.pillars && filters.pillars.length > 0) p.set("pillar", filters.pillars.join(","));
  if (filters.bpmMin > 0 || filters.bpmMax < 300) {
    p.set("bpm", filters.bpmMin === filters.bpmMax ? `${filters.bpmMin}` : `${filters.bpmMin}-${filters.bpmMax}`);
  }
  if (filters.halfTime) p.set("x2", "1");
  if (filters.search) p.set("q", filters.search);
  if (tab === "setlists") p.set("tab", "setlists");
  if (tab === "liked") p.set("tab", "liked");
  if (tab === "albums") p.set("tab", "albums");
  if (trackVideoId) p.set("t", trackVideoId);
  if (browseView === "tracks") p.set("view", "tracks");

  const basePath = ilaiyaraaja ? "/tamil/ilaiyaraaja" : tamil ? "/tamil" : section === "ambient" ? "/ambient" : section === "downtempo" ? "/downtempo" : artistName ? `/artist/${slugify(artistName)}` : "/";
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
  const [artistFilteredTracks, setArtistFilteredTracks] = useState<Track[] | null>(null);
  const [tracksLoading, setTracksLoading] = useState(false);
  const [searchTracks, setSearchTracks] = useState<Track[]>([]);
  const [setlist, setSetlist] = useState<SetlistTrack[]>([]);
  const [setlistName, setSetlistName] = useState<string | null>(null);
  const [setlistId, setSetlistId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [tab, setTab] = useState<"browse" | "setlists" | "liked" | "albums">(urlInit.current.tab || "browse");
  const [likedTracks, setLikedTracks] = useState<Track[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [albumsSearch, setAlbumsSearch] = useState("");
  const [albumsSort, setAlbumsSort] = useState<AlbumSort>("recency");
  const [selectedAlbum, setSelectedAlbum] = useState<SavedAlbum | null>(null);
  const [albumTracks, setAlbumTracks] = useState<Track[]>([]);
  const pendingArtist = useRef<string | null>(urlInit.current.artist);
  const pendingTrack = useRef<string | null>(urlInit.current.track);
  const pendingAutoplay = useRef(urlInit.current.autoplay);
  const pendingTvChannel = useRef<string | null>(urlInit.current.tvChannel);
  const pendingTvVideo = useRef<string | null>(urlInit.current.tvVideo);
  const pendingTvTime = useRef(urlInit.current.tvTime);
  const [shareCopied, setShareCopied] = useState(false);
  const [vaultManifest, setVaultManifest] = useState<SetlistManifestEntry[]>([]);
  const [savedSetlists, setSavedSetlists] = useState<SavedSetlists>({ active: null, setlists: {} });
  const [playlistIndex, setPlaylistIndex] = useState<PlaylistIndexEntry[]>([]);
  const [playlistLoading, setPlaylistLoading] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<Track | null>(null);
  const [mobileSetlistOpen, setMobileSetlistOpen] = useState(false);
  const [radioMode, setRadioMode] = useState(false);
  const [setlistMode, setSetlistMode] = useState(false);
  const [admin, setAdmin] = useState(false);
  const setlistIndexRef = useRef(-1);
  const [chapters, setChapters] = useState<SetlistChapter[]>([]);
  const [chapterSuggestions, setChapterSuggestions] = useState<Track[]>([]);
  const [suggestingForChapter, setSuggestingForChapter] = useState<string | null>(null);
  const [tamilMode, setTamilMode] = useState(urlInit.current.tamil);
  const [tamilTracks, setTamilTracks] = useState<Track[]>([]);
  const [tamilSearch, setTamilSearch] = useState("");
  const [tamilBpmMin, setTamilBpmMin] = useState(0);
  const [tamilBpmMax, setTamilBpmMax] = useState(300);
  const [ilaiyaraajaMode, setIlaiyaraajaMode] = useState(urlInit.current.ilaiyaraaja);
  const [ilaiyaraajaTracks, setIlaiyaraajaTracks] = useState<Track[]>([]);
  const [ilaiyaraajaSearch, setIlaiyaraajaSearch] = useState("");
  const [browseView, setBrowseView] = useState<"artists" | "tracks">(urlInit.current.view);
  const [filteredTracks, setFilteredTracks] = useState<Track[]>([]);
  const [filteredTracksLoading, setFilteredTracksLoading] = useState(false);
  const [sectionMode, setSectionMode] = useState<SectionMode>(urlInit.current.section);
  const [sectionTracks, setSectionTracks] = useState<Track[]>([]);
  const [sectionSearch, setSectionSearch] = useState("");
  const [sectionBpmMin, setSectionBpmMin] = useState(0);
  const [sectionBpmMax, setSectionBpmMax] = useState(300);
  const [sectionDesi, setSectionDesi] = useState("");
  const prevSectionMode = useRef<SectionMode>("browse");
  const [recentlyPlayed, setRecentlyPlayed] = useState<Track[]>([]);
  const [recentExpanded, setRecentExpanded] = useState(false);
  const [featuredArtists, setFeaturedArtists] = useState<Artist[]>([]);
  // TV state
  const [tvChannels, setTvChannels] = useState<TVChannel[]>([]);
  const [tvCurrentChannel, setTvCurrentChannel] = useState<TVChannel | null>(null);
  const [tvVideoId, setTvVideoId] = useState<string | null>(null);
  const [tvOffsetSeconds, setTvOffsetSeconds] = useState(0);
  const [tvVideoTitle, setTvVideoTitle] = useState("");
  const tvAdvanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tvVideoIndexRef = useRef(0);
  const tvPlayerRef = useRef<TvPlayerHandle | null>(null);
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
    const params = buildUrlParams(filters, selectedArtist?.artist ?? null, tab, null, tamilMode, browseView, sectionMode, ilaiyaraajaMode);
    const base = window.location.origin;
    const sep = params.includes("?") ? "&" : "?";
    return `${base}${params}${sep}autoplay=1`;
  }, [filters, selectedArtist, tab, tamilMode, browseView, sectionMode, ilaiyaraajaMode]);

  // Sync state → URL (replaceState, no navigation)
  useEffect(() => {
    const url = buildUrlParams(filters, selectedArtist?.artist ?? null, tab, nowPlaying?.videoId, tamilMode, browseView, sectionMode, ilaiyaraajaMode, tvCurrentChannel?.id, tvVideoId, tvOffsetSeconds);
    window.history.replaceState(null, "", url);
  }, [filters, selectedArtist, tab, nowPlaying, tamilMode, browseView, sectionMode, ilaiyaraajaMode, tvCurrentChannel, tvVideoId, tvOffsetSeconds]);

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
    // Admin re-label mode toggle (owner-only; also enabled via ?admin=1)
    hotkeys("shift+ctrl+a", (e) => {
      e.preventDefault();
      setAdmin((v) => {
        const next = !v;
        try { localStorage.setItem("pyaar-admin", next ? "1" : "0"); } catch {}
        return next;
      });
    });
    return () => {
      hotkeys.unbind("space");
      hotkeys.unbind("n");
      hotkeys.unbind("escape");
      hotkeys.unbind("shift+ctrl+a");
    };
  }, []);

  // Enable admin from ?admin=1 or a prior session
  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("admin") === "1" || localStorage.getItem("pyaar-admin") === "1") setAdmin(true);
    } catch {}
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
      setChapters(active.chapters || []);
    }
  }, []);

  // Load vault manifest and playlist index on mount
  useEffect(() => {
    fetchSetlistManifest().then(setVaultManifest);
    fetchPlaylistIndex().then(setPlaylistIndex).catch(() => {});
  }, []);

  // Persist to localStorage whenever setlist changes
  useEffect(() => {
    if (setlistId && savedSetlists.setlists[setlistId]) {
      const updated: SavedSetlists = {
        active: setlistId,
        setlists: {
          ...savedSetlists.setlists,
          [setlistId]: { name: setlistName || "Untitled", tracks: setlist, chapters },
        },
      };
      saveSavedSetlists(updated);
    }
  }, [setlist, setlistName, chapters]);

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
  }), [filters.channels, filters.pillars, filters.samay, filters.desi, filters.vibes, filters.bpmMin, filters.bpmMax, filters.halfTime, filters.tags]);

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
        pillar: string | null;
        pillar_v2: string | null;
        zone: string | null;
        desi_bool: string | null;
      }>(sql);

      const parsed: Artist[] = rows.map((r) => ({
        artist: r.artist,
        aliases: r.aliases ? r.aliases.split("|") : [],
        channel: r.channel as Artist["channel"],
        samay: r.samay as Artist["samay"],
        // desi is now orthogonal (desi_bool); fall back to the legacy column.
        desi: (r.desi_bool ? r.desi_bool === "true" : r.desi === "Desi") ? "Desi" : "Non-Desi",
        vibes: r.vibes ? r.vibes.split("|") : [],
        bpmLow: Number(r.bpm_low) || 0,
        bpmHigh: Number(r.bpm_high) || 0,
        // pillar_v2 is the __laad spine; fall back to legacy pillar.
        pillars: (r.pillar_v2 || r.pillar) ? (r.pillar_v2 || r.pillar)!.split("|") : [],
        zone: (r.zone || "") as Artist["zone"],
      }));

      // Apply the admin override layer (localStorage) on top of CSV data.
      setAllArtists(applyOverrides(parsed, loadOverrides()));

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

  // Ilaiyaraaja mode: query ilaiyaraaja table
  useEffect(() => {
    if (!ilaiyaraajaMode) return;
    (async () => {
      try {
        const sql = buildIlaiyaraajaQuery(ilaiyaraajaSearch);
        const rows = await query<{
          trackName: string;
          artistNames: string;
          albumName: string;
          tempo: number | null;
          duration: string;
          videoId: string;
        }>(sql);
        if (rows.length === 0) {
          console.warn("[Ilaiyaraaja] query returned 0 rows. SQL:", sql);
        }
        setIlaiyaraajaTracks(
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
      } catch (e) {
        console.error("[Ilaiyaraaja] query failed:", e);
        setIlaiyaraajaTracks([]);
      }
    })();
  }, [ilaiyaraajaMode, ilaiyaraajaSearch]);

  // Filtered tracks view: all tracks for current filtered artists + BPM
  useEffect(() => {
    if (browseView !== "tracks" || artists.length === 0 || selectedArtist || tamilMode || sectionMode !== "browse") {
      if (browseView === "tracks" && (selectedArtist || tamilMode || sectionMode !== "browse")) {
        setBrowseView("artists");
      }
      setFilteredTracks([]);
      return;
    }
    setFilteredTracksLoading(true);
    const radioArtists: RadioArtist[] = artists.map((a) => ({ artist: a.artist, aliases: a.aliases }));
    const sql = buildFilteredTracksQuery(radioArtists, filters.bpmMin, filters.bpmMax, filters.halfTime);
    (async () => {
      try {
        const rows = await query<{
          trackName: string; artistNames: string; albumName: string;
          genres: string | null; tempo: number | null; duration: string;
          key: number | null; popularity: number | null; videoId: string;
          soundcloudId: string | null; bandcampId: string | null;
        }>(sql);
        setFilteredTracks(rows.map((r) => ({
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
        })));
      } catch {
        setFilteredTracks([]);
      }
      setFilteredTracksLoading(false);
    })();
  }, [browseView, artists, filters.bpmMin, filters.bpmMax, filters.halfTime, selectedArtist, tamilMode, sectionMode]);

  // Section mode (Downtempo / Ambient): query masterlist by tag
  useEffect(() => {
    if (sectionMode !== "downtempo" && sectionMode !== "ambient") {
      setSectionTracks([]);
      return;
    }
    const tag = sectionMode === "downtempo" ? "Downtempo" : "Ambient";
    (async () => {
      try {
        const sql = buildTagSectionQuery(tag, sectionSearch, sectionBpmMin, sectionBpmMax, sectionDesi || undefined);
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
  }, [sectionMode, sectionSearch, sectionBpmMin, sectionBpmMax, sectionDesi]);

  // TV: load channels when TV mode is active
  useEffect(() => {
    if (sectionMode !== "tv") {
      setTvChannels([]);
      setTvCurrentChannel(null);
      setTvVideoId(null);
      if (tvAdvanceTimerRef.current) clearTimeout(tvAdvanceTimerRef.current);
      return;
    }
    fetch("/data/tv/channels.json")
      .then((r) => r.json())
      .then((data: TVChannelData) => {
        setTvChannels(data.channels);
        // Restore TV state from URL
        const chId = pendingTvChannel.current;
        if (chId) {
          pendingTvChannel.current = null;
          const channel = data.channels.find((c) => c.id === chId);
          if (channel) {
            const vid = pendingTvVideo.current;
            const time = pendingTvTime.current;
            pendingTvVideo.current = null;
            pendingTvTime.current = 0;
            if (vid) {
              // Deep-link to specific video + timestamp
              const videoIdx = channel.videos.findIndex((v) => v.videoId === vid);
              if (videoIdx >= 0) {
                setTvCurrentChannel(channel);
                setTvVideoId(vid);
                setTvOffsetSeconds(time);
                setTvVideoTitle(channel.videos[videoIdx].title);
                tvVideoIndexRef.current = videoIdx;
                // Wait for player to be ready, then play
                setTimeout(() => tvPlayerRef.current?.playVideo(vid, time), 500);
                return;
              }
            }
            // Just tune into the channel (live schedule)
            tvTuneIn(channel);
          }
        }
      })
      .catch(() => setTvChannels([]));
  }, [sectionMode]);

  const tvTuneIn = useCallback((channel: TVChannel) => {
    const np = getNowPlaying(channel);
    if (!np) return;
    setTvCurrentChannel(channel);
    setTvVideoId(np.video.videoId);
    setTvOffsetSeconds(np.offsetSeconds);
    setTvVideoTitle(np.video.title);
    tvVideoIndexRef.current = np.videoIndex;
    tvPlayerRef.current?.playVideo(np.video.videoId, np.offsetSeconds);
    if (tvAdvanceTimerRef.current) clearTimeout(tvAdvanceTimerRef.current);
    tvAdvanceTimerRef.current = setTimeout(() => tvAdvanceToNext(channel), np.secondsUntilNext * 1000);
  }, []);

  const tvAdvanceToNext = useCallback((channel: TVChannel) => {
    const np = getNowPlaying(channel);
    if (!np) return;
    setTvVideoId(np.video.videoId);
    setTvOffsetSeconds(np.offsetSeconds);
    setTvVideoTitle(np.video.title);
    tvVideoIndexRef.current = np.videoIndex;
    tvPlayerRef.current?.playVideo(np.video.videoId, np.offsetSeconds);
    if (tvAdvanceTimerRef.current) clearTimeout(tvAdvanceTimerRef.current);
    tvAdvanceTimerRef.current = setTimeout(() => tvAdvanceToNext(channel), np.secondsUntilNext * 1000);
  }, []);

  const tvSkip = useCallback(() => {
    if (!tvCurrentChannel || tvCurrentChannel.videos.length === 0) return;
    const nextIndex = (tvVideoIndexRef.current + 1) % tvCurrentChannel.videos.length;
    const nextVideo = tvCurrentChannel.videos[nextIndex];
    tvVideoIndexRef.current = nextIndex;
    const maxOffset = Math.max(0, nextVideo.durationSeconds - 30);
    const randomOffset = maxOffset > 0 ? Math.floor(Math.random() * maxOffset) : 0;
    setTvOffsetSeconds(randomOffset);
    setTvVideoId(nextVideo.videoId);
    setTvVideoTitle(nextVideo.title);
    // Directly tell the player to load and seek — no prop/effect dependency
    tvPlayerRef.current?.playVideo(nextVideo.videoId, randomOffset);
    if (tvAdvanceTimerRef.current) clearTimeout(tvAdvanceTimerRef.current);
  }, [tvCurrentChannel]);

  const tvHandleEnded = useCallback(() => {
    if (!tvCurrentChannel) return;
    const nextIndex = (tvVideoIndexRef.current + 1) % tvCurrentChannel.videos.length;
    const nextVideo = tvCurrentChannel.videos[nextIndex];
    tvVideoIndexRef.current = nextIndex;
    setTvVideoId(nextVideo.videoId);
    setTvOffsetSeconds(0);
    setTvVideoTitle(nextVideo.title);
    tvPlayerRef.current?.playVideo(nextVideo.videoId, 0);
  }, [tvCurrentChannel]);

  const fetchLikedTracks = useCallback(async () => {
    try {
      // Fetch the pre-built liked.csv directly — much faster than waiting for
      // DuckDB to parse the full 74K-row masterlist. liked.csv is generated by
      // sync_liked.py with rows already sorted by Liked Position.
      const resp = await fetch("/data/liked.csv");
      if (!resp.ok) throw new Error("liked.csv not found");
      const text = await resp.text();
      const lines = text.trim().split("\n");
      if (lines.length < 2) { setLikedTracks([]); return; }

      // Parse header so column order changes don't break us.
      const parseLine = (line: string): string[] => {
        const cells: string[] = [];
        let cur = "", inQ = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') {
            if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
            else inQ = !inQ;
          } else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
          else cur += ch;
        }
        cells.push(cur);
        return cells;
      };
      const header = parseLine(lines[0]);
      const idx = (name: string) => header.indexOf(name);
      const iTrack = idx("Track Name"), iArtist = idx("Artist Name(s)"),
            iAlbum = idx("Album Name"), iTempo = idx("Tempo"), iDur = idx("Duration"),
            iKey = idx("Key"), iPos = idx("Liked Position"), iVid = idx("Video ID"),
            iSc = idx("Soundcloud ID"),
            iFla = idx("First Liked At"), iEnergy = idx("Energy"),
            iDance = idx("Danceability"), iVal = idx("Valence");

      const num = (s: string | undefined): number | null => {
        if (!s || !s.trim()) return null;
        const n = parseFloat(s);
        return Number.isFinite(n) ? n : null;
      };

      const tracks: Track[] = [];
      for (let i = 1; i < lines.length; i++) {
        const c = parseLine(lines[i]);
        if (!c[iVid]) continue;
        const posStr = c[iPos] || "";
        const pos = posStr ? parseInt(posStr, 10) : null;
        tracks.push({
          trackName: c[iTrack] || "",
          artistNames: c[iArtist] || "",
          albumName: c[iAlbum] || "",
          genres: [],
          tempo: parseFloat(c[iTempo] || "0") || 0,
          duration: c[iDur] || "",
          key: parseInt(c[iKey] || "0", 10) || 0,
          popularity: 0,
          videoId: c[iVid] || "",
          soundcloudId: c[iSc] || "",
          bandcampId: "",
          likedPosition: Number.isFinite(pos as number) ? pos : null,
          firstLikedAt: iFla >= 0 ? (c[iFla] || null) : null,
          energy: iEnergy >= 0 ? num(c[iEnergy]) : null,
          danceability: iDance >= 0 ? num(c[iDance]) : null,
          valence: iVal >= 0 ? num(c[iVal]) : null,
        });
      }
      setLikedTracks(tracks);
    } catch {
      setLikedTracks([]);
    }
  }, []);

  useEffect(() => {
    if (tab === "liked" && likedTracks.length === 0) fetchLikedTracks();
  }, [tab, likedTracks.length, fetchLikedTracks]);

  useEffect(() => {
    if (tab !== "albums" || savedAlbums.length > 0) return;
    fetch("/data/albums.csv")
      .then((r) => r.text())
      .then((csv) => {
        const allLines = csv.trim().split("\n");
        const header = (allLines[0] || "").split(",");
        const hasPosition = header[0] === "position";
        const lines = allLines.slice(1);
        const albums: SavedAlbum[] = lines.map((line) => {
          const cells: string[] = [];
          let cur = "", inQ = false;
          for (const ch of line) {
            if (ch === '"') inQ = !inQ;
            else if (ch === "," && !inQ) { cells.push(cur); cur = ""; }
            else cur += ch;
          }
          cells.push(cur);
          // New format (after sync_albums.py update): position, browseId, title, artist, year, trackCount
          // Old format: browseId, title, artist, year, trackCount  (position will be null until next sync)
          const offset = hasPosition ? 1 : 0;
          const positionStr = hasPosition ? cells[0] : "";
          const position = positionStr ? parseInt(positionStr, 10) : null;
          return {
            position: Number.isFinite(position as number) ? position : null,
            browseId: cells[offset] || "",
            title: cells[offset + 1] || "",
            artist: cells[offset + 2] || "",
            year: cells[offset + 3] || "",
            trackCount: parseInt(cells[offset + 4] || "0", 10),
          };
        }).filter((a) => a.title && a.artist);
        setSavedAlbums(albums);
      })
      .catch(() => setSavedAlbums([]));
  }, [tab, savedAlbums.length]);

  const fetchAlbumTracks = useCallback(async (album: SavedAlbum) => {
    try {
      const sql = buildAlbumTracksQuery(album.title, album.artist);
      const rows = await query<{
        trackName: string; artistNames: string; albumName: string;
        genres: string | null; tempo: number | null; duration: string;
        key: number | null; popularity: number | null;
        videoId: string; soundcloudId: string | null; bandcampId: string | null;
      }>(sql);
      setAlbumTracks(rows.map((r) => ({
        trackName: r.trackName, artistNames: r.artistNames, albumName: r.albumName || "",
        genres: r.genres ? r.genres.split(",").map((g) => g.trim()) : [],
        tempo: Number(r.tempo) || 0, duration: r.duration || "",
        key: Number(r.key) || 0, popularity: Number(r.popularity) || 0,
        videoId: r.videoId || "", soundcloudId: r.soundcloudId || "", bandcampId: r.bandcampId || "",
      })));
    } catch {
      setAlbumTracks([]);
    }
  }, []);

  useEffect(() => {
    if (selectedAlbum) fetchAlbumTracks(selectedAlbum);
    else setAlbumTracks([]);
  }, [selectedAlbum, fetchAlbumTracks]);

  const albumsScrollRef = useRef<HTMLDivElement>(null);
  const browseScrollRef = useRef<HTMLDivElement>(null);

  const filteredAlbums = useMemo(() => {
    const q = albumsSearch.trim().toLowerCase();
    const filtered = q
      ? savedAlbums.filter((a) =>
          a.title.toLowerCase().includes(q) ||
          a.artist.toLowerCase().includes(q)
        )
      : savedAlbums;
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (albumsSort) {
        case "recency": {
          // null position sorts to end (no recency data yet — pre-backfill rows)
          const ap = a.position ?? Number.MAX_SAFE_INTEGER;
          const bp = b.position ?? Number.MAX_SAFE_INTEGER;
          if (ap !== bp) return ap - bp;
          // tiebreak: newest year first
          return (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
        }
        case "release": {
          // Newest album release year first; tiebreak by artist alpha
          const yd = (parseInt(b.year) || 0) - (parseInt(a.year) || 0);
          if (yd !== 0) return yd;
          return a.artist.localeCompare(b.artist);
        }
        case "title": return a.title.localeCompare(b.title);
        case "artist": return a.artist.localeCompare(b.artist);
      }
    });
    return sorted;
  }, [savedAlbums, albumsSearch, albumsSort]);

  const albumsVirtualizer = useVirtualizer({
    count: filteredAlbums.length,
    getScrollElement: () => albumsScrollRef.current,
    estimateSize: () => 56,
    overscan: 12,
  });

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
        releaseDate: string | null;
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
          releaseDate: r.releaseDate || "",
        }))
      );
    } catch {
      setTracks([]);
    }
    setTracksLoading(false);
  }, []);

  const handleSelectArtist = useCallback(async (artist: Artist | null) => {
    setSelectedArtist(artist);
    if (artist) {
      prevSectionMode.current = sectionMode;
      setBrowseView("artists");
    }
    if (!artist) {
      setTracks([]);
      setArtistFilteredTracks(null);
      return;
    }
    fetchTracks(artist, filters.bpmMin, filters.bpmMax, filters.halfTime);
  }, [fetchTracks, filters.bpmMin, filters.bpmMax, filters.halfTime, sectionMode]);

  // Navigate to artist by name — finds in allArtists or creates a temporary artist object
  const navigateToArtist = useCallback((artistName: string) => {
    const found = allArtists.find((a) =>
      a.artist.toLowerCase() === artistName.toLowerCase() ||
      a.aliases.some((alias) => alias.toLowerCase() === artistName.toLowerCase())
    );
    if (found) {
      setSectionMode("browse");
      setTamilMode(false);
      handleSelectArtist(found);
    } else {
      const tempArtist: Artist = {
        artist: artistName,
        aliases: [],
        channel: "Soul",
        samay: "Day/Night",
        desi: "Non-Desi",
        vibes: [],
        bpmLow: 0,
        bpmHigh: 300,
        pillars: [],
      };
      setSectionMode("browse");
      setTamilMode(false);
      handleSelectArtist(tempArtist);
    }
  }, [allArtists, handleSelectArtist]);

  // Re-fetch tracks when BPM filters change while viewing an artist
  useEffect(() => {
    if (selectedArtist) {
      fetchTracks(selectedArtist, filters.bpmMin, filters.bpmMax, filters.halfTime);
    }
  }, [filters.bpmMin, filters.bpmMax, filters.halfTime]);

  const addToSetlist = useCallback((track: Track) => {
    setSetlist((prev) => {
      // Auto-create intro chapter when first track is added
      if (prev.length === 0) {
        setChapters([{ id: `ch-${Date.now()}`, type: "intro", startIndex: 0, seedTrackIds: [] }]);
      }
      const id = `${track.trackName}-${track.artistNames}-${Date.now()}`;
      return [...prev, { ...track, id, position: prev.length }];
    });
  }, []);

  const removeFromSetlist = useCallback((id: string) => {
    setSetlist((prev) => {
      const idx = prev.findIndex((t) => t.id === id);
      const next = prev.filter((t) => t.id !== id).map((t, i) => ({ ...t, position: i }));
      // Adjust chapter startIndexes
      if (idx >= 0) {
        setChapters((chs) => chs
          .map((ch) => ({
            ...ch,
            startIndex: ch.startIndex > idx ? ch.startIndex - 1 : ch.startIndex,
            seedTrackIds: ch.seedTrackIds.filter((sid) => sid !== id),
          }))
          .filter((ch) => ch.startIndex < next.length || next.length === 0)
        );
      }
      return next;
    });
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

    if (ilaiyaraajaMode) {
      if (ilaiyaraajaTracks.length === 0) return;
      if (nowPlaying) {
        const idx = ilaiyaraajaTracks.findIndex(
          (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
        );
        const next = idx >= 0 && idx < ilaiyaraajaTracks.length - 1 ? ilaiyaraajaTracks[idx + 1] : ilaiyaraajaTracks[0];
        setNowPlaying(next);
      } else {
        setNowPlaying(ilaiyaraajaTracks[0]);
      }
      return;
    }

    if (tamilMode) {
      if (tamilTracks.length === 0) return;
      if (nowPlaying) {
        const idx = tamilTracks.findIndex(
          (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
        );
        const next = idx >= 0 && idx < tamilTracks.length - 1 ? tamilTracks[idx + 1] : tamilTracks[0];
        setNowPlaying(next);
      } else {
        setNowPlaying(tamilTracks[0]);
      }
      return;
    }

    if (sectionMode === "downtempo" || sectionMode === "ambient") {
      // Play next track sequentially in the list
      if (sectionTracks.length === 0) return;
      if (nowPlaying) {
        const idx = sectionTracks.findIndex(
          (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
        );
        const next = idx >= 0 && idx < sectionTracks.length - 1 ? sectionTracks[idx + 1] : sectionTracks[0];
        setNowPlaying(next);
      } else {
        setNowPlaying(sectionTracks[0]);
      }
      return;
    }

    // Artist detail view — play from filtered tracks if filter is active, otherwise all artist tracks
    if (selectedArtist) {
      const pool = artistFilteredTracks && artistFilteredTracks.length < tracks.length
        ? artistFilteredTracks
        : tracks;
      if (pool.length > 0) {
        pickRandomFromPool(pool);
        return;
      }
    }

    if (browseView === "tracks" && filteredTracks.length > 0) {
      pickRandomFromPool(filteredTracks);
      return;
    }

    if (artists.length === 0) return;
    const radioArtists: RadioArtist[] = artists.map((a) => ({ artist: a.artist, aliases: a.aliases }));

    try {
      const sql = buildScoredRandomQuery(radioArtists, 0, undefined, recentExcludeKeys);
      const rows = await query<TrackRow>(sql);
      if (rows.length > 0) setNowPlaying(rowToTrack(rows[0]));
    } catch {}
  }, [artists, recentExcludeKeys, rowToTrack, ilaiyaraajaMode, ilaiyaraajaTracks, tamilMode, tamilTracks, sectionMode, sectionTracks, pickRandomFromPool, browseView, filteredTracks, selectedArtist, artistFilteredTracks, tracks]);

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

    if (ilaiyaraajaMode) {
      pickBpmScored(ilaiyaraajaTracks);
      return;
    }

    if (tamilMode) {
      pickBpmScored(tamilTracks);
      return;
    }

    if (sectionMode === "downtempo" || sectionMode === "ambient") {
      pickBpmScored(sectionTracks);
      return;
    }

    // Artist detail view — play from filtered tracks if filter is active
    if (selectedArtist) {
      const pool = artistFilteredTracks && artistFilteredTracks.length < tracks.length
        ? artistFilteredTracks
        : tracks;
      if (pool.length > 0) {
        pickBpmScored(pool);
        return;
      }
    }

    if (browseView === "tracks" && filteredTracks.length > 0) {
      pickBpmScored(filteredTracks);
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
  }, [artists, nowPlaying, recentExcludeKeys, rowToTrack, ilaiyaraajaMode, ilaiyaraajaTracks, tamilMode, tamilTracks, sectionMode, sectionTracks, browseView, filteredTracks, selectedArtist, artistFilteredTracks, tracks]);

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

      if (ilaiyaraajaMode) {
        if (forRadio) {
          nextTrack = pickFromPool(ilaiyaraajaTracks);
        } else {
          const idx = nowPlaying ? ilaiyaraajaTracks.findIndex(
            (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
          ) : -1;
          nextTrack = idx >= 0 && idx < ilaiyaraajaTracks.length - 1 ? ilaiyaraajaTracks[idx + 1] : ilaiyaraajaTracks[0];
        }
      } else if (tamilMode) {
        if (forRadio) {
          nextTrack = pickFromPool(tamilTracks);
        } else {
          const idx = nowPlaying ? tamilTracks.findIndex(
            (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
          ) : -1;
          nextTrack = idx >= 0 && idx < tamilTracks.length - 1 ? tamilTracks[idx + 1] : tamilTracks[0];
        }
      } else if (sectionMode === "downtempo" || sectionMode === "ambient") {
        if (forRadio) {
          nextTrack = pickFromPool(sectionTracks);
        } else {
          // Sequential next for non-radio
          const idx = nowPlaying ? sectionTracks.findIndex(
            (t) => t.trackName === nowPlaying.trackName && t.artistNames === nowPlaying.artistNames
          ) : -1;
          nextTrack = idx >= 0 && idx < sectionTracks.length - 1 ? sectionTracks[idx + 1] : sectionTracks[0];
        }
      } else if (browseView === "tracks" && filteredTracks.length > 0) {
        nextTrack = pickFromPool(filteredTracks);
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
  }, [artists, nowPlaying, recentExcludeKeys, rowToTrack, ilaiyaraajaMode, ilaiyaraajaTracks, tamilMode, tamilTracks, sectionMode, sectionTracks, resolveVideoId, browseView, filteredTracks]);

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
        [id]: { name, tracks: setlist, chapters },
      },
    };
    setSavedSetlists(updated);
    saveSavedSetlists(updated);
    setSetlistId(id);
    setSetlistName(name);
  }, [setlistId, setlistName, setlist, chapters, savedSetlists]);

  const handleNew = useCallback(() => {
    const name = prompt("Setlist name:");
    if (!name) return;

    const id = `setlist-${Date.now()}`;
    setSetlist([]);
    setSetlistName(name);
    setSetlistId(id);
    setChapters([]);
    setChapterSuggestions([]);
    setSuggestingForChapter(null);

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
    setChapters(entry.chapters || []);
    setChapterSuggestions([]);
    setSuggestingForChapter(null);

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
      setChapters([]);
      setChapterSuggestions([]);
      setSuggestingForChapter(null);

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

  const handleLoadPlaylist = useCallback(async (playlistId: string, title: string) => {
    try {
      setPlaylistLoading(playlistId);
      const playlist = await fetchPlaylist(playlistId);
      const lines = playlist.tracks.map((t) => ({ track: t.title, artist: t.artist }));

      let hydratedTracks: SetlistTrack[];

      if (lines.length > 0) {
        try {
          // Batch lookup in chunks to handle large playlists
          const CHUNK = 200;
          type MasterlistRow = { trackName: string; artistNames: string; albumName: string; genres: string | null; tempo: number | null; duration: string; key: number | null; popularity: number | null; videoId: string; soundcloudId: string | null; bandcampId: string | null };
          const lookup = new Map<string, MasterlistRow>();

          for (let i = 0; i < lines.length; i += CHUNK) {
            const chunk = lines.slice(i, i + CHUNK);
            const sql = buildBatchTrackLookupQuery(chunk);
            const rows = await query<MasterlistRow>(sql);
            for (const r of rows) {
              lookup.set(r.trackName.toLowerCase(), r);
            }
          }

          hydratedTracks = playlist.tracks.map((pt, i) => {
            const match = lookup.get(pt.title.toLowerCase());
            const id = `pl-${playlistId}-${i}`;
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
                videoId: match.videoId || pt.videoId || "",
                soundcloudId: match.soundcloudId || "",
                bandcampId: match.bandcampId || "",
                id,
                position: i,
              };
            }
            return {
              trackName: pt.title,
              artistNames: pt.artist,
              albumName: pt.album || "",
              genres: [],
              tempo: 0,
              duration: pt.duration || "",
              key: 0,
              popularity: 0,
              videoId: pt.videoId || "",
              soundcloudId: "",
              bandcampId: "",
              id,
              position: i,
            };
          });
        } catch {
          hydratedTracks = playlist.tracks.map((pt, i) => ({
            trackName: pt.title,
            artistNames: pt.artist,
            albumName: pt.album || "",
            genres: [],
            tempo: 0,
            duration: pt.duration || "",
            key: 0,
            popularity: 0,
            videoId: pt.videoId || "",
            soundcloudId: "",
            bandcampId: "",
            id: `pl-${playlistId}-${i}`,
            position: i,
          }));
        }
      } else {
        hydratedTracks = [];
      }

      const newId = `playlist-${playlistId}-${Date.now()}`;
      setSetlist(hydratedTracks);
      setSetlistName(title);
      setSetlistId(newId);
      setChapters([]);
      setChapterSuggestions([]);
      setSuggestingForChapter(null);

      const updated: SavedSetlists = {
        active: newId,
        setlists: {
          ...savedSetlists.setlists,
          [newId]: { name: title, tracks: hydratedTracks },
        },
      };
      setSavedSetlists(updated);
      saveSavedSetlists(updated);
      setTab("browse");
    } catch (e) {
      console.error("Failed to load playlist:", e);
    } finally {
      setPlaylistLoading(null);
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
      setChapters([]);
      setChapterSuggestions([]);
      setSuggestingForChapter(null);
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

  // --- Chapter operations ---

  const handleRequestSuggestions = useCallback(async (chapterId: string) => {
    const chapter = chapters.find((c) => c.id === chapterId);
    if (!chapter) return;

    // Find the tracks in this chapter
    const sorted = [...chapters].sort((a, b) => a.startIndex - b.startIndex);
    const ci = sorted.findIndex((c) => c.id === chapterId);
    const endIndex = ci < sorted.length - 1 ? sorted[ci + 1].startIndex : setlist.length;
    const chapterTracks = setlist.slice(chapter.startIndex, endIndex);

    if (chapterTracks.length === 0) {
      setChapterSuggestions([]);
      setSuggestingForChapter(null);
      return;
    }

    // Compute chapter averages
    const bpms = chapterTracks.map((t) => t.tempo).filter((b) => b > 0);
    const avgBpm = bpms.length > 0 ? bpms.reduce((a, b) => a + b, 0) / bpms.length : 120;
    const keys = chapterTracks.map((t) => t.key).filter((k) => k > 0);
    const dominantKey = getMostCommonKey(keys);
    const compatKeys = dominantKey > 0 ? getCompatibleKeys(dominantKey) : [];

    // Determine target chapter type: use the NEXT chapter's type if it exists, otherwise same type
    const nextChapter = ci < sorted.length - 1 ? sorted[ci + 1] : null;
    const targetType = nextChapter ? nextChapter.type : chapter.type;

    // Exclude current setlist tracks
    const excludeKeys = setlist.map((t) =>
      `${t.trackName.toLowerCase()}:::${t.artistNames.toLowerCase()}`
    );

    try {
      const sql = buildChapterSuggestionQuery(avgBpm, compatKeys, targetType, excludeKeys);
      const rows = await query<Track>(sql);
      setChapterSuggestions(rows);
      setSuggestingForChapter(chapterId);
    } catch (e) {
      console.error("Failed to get chapter suggestions:", e);
    }
  }, [chapters, setlist]);

  const handleAddSuggestion = useCallback((track: Track) => {
    addToSetlist(track);
    // Remove this track from suggestions
    setChapterSuggestions((prev) => prev.filter((t) => t.trackName !== track.trackName || t.artistNames !== track.artistNames));
  }, [addToSetlist]);

  const handleToggleSeed = useCallback((chapterId: string, trackId: string) => {
    setChapters((prev) => prev.map((ch) => {
      if (ch.id !== chapterId) return ch;
      const seeds = ch.seedTrackIds.includes(trackId)
        ? ch.seedTrackIds.filter((id) => id !== trackId)
        : [...ch.seedTrackIds, trackId];
      return { ...ch, seedTrackIds: seeds };
    }));
  }, []);

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
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="text-center">
          <h1 className="text-sm font-bold text-red-500 uppercase tracking-widest mb-2">Error</h1>
          <p className="text-[#999] text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex h-screen overflow-hidden bg-background pt-[env(safe-area-inset-top)] ${nowPlaying ? "pb-56 md:pb-10" : ""}`}>
      {/* Left: Browse / Setlists */}
      <div className="flex-1 min-w-0 md:border-r border-[#222] flex flex-col min-h-0">
        <div className="px-3 md:px-5 py-3 border-b border-[#222] flex items-center justify-between gap-2 flex-wrap">
          <h1
            className="text-sm font-bold uppercase tracking-[0.2em] cursor-pointer hover:text-red-400 transition-colors shrink-0"
            onClick={() => { handleSelectArtist(null); setTab("browse"); setSectionMode("browse"); prevSectionMode.current = "browse"; }}
          >{sectionMode === "tv" ? "Pyaar TV" : "Pyaar Radio"}</h1>
          <button
            onClick={() => { setSectionMode("tv"); setTamilMode(false); setIlaiyaraajaMode(false); }}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors shrink-0 ${
              sectionMode === "tv"
                ? "bg-red-600 text-white"
                : "bg-[#111] text-[#888] hover:text-red-400"
            }`}
          >
            TV
          </button>
          <button
            onClick={() => { playRadio(); setRadioMode(true); setSetlistMode(false); }}
            disabled={artists.length === 0}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors shrink-0 ${
              radioMode
                ? "bg-red-600 text-white"
                : "bg-[#111] text-[#888] hover:text-white disabled:text-[#888]"
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
              onClick={() => { setTab("liked"); handleSelectArtist(null); }}
              className={`px-3 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                tab === "liked"
                  ? "bg-red-600 text-white"
                  : "bg-[#111] text-[#888] hover:text-white"
              }`}
              title="All liked songs"
            >
              ♥ Liked
            </button>
            <button
              onClick={() => { setTab("albums"); setSelectedAlbum(null); handleSelectArtist(null); }}
              className={`px-3 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                tab === "albums"
                  ? "bg-red-600 text-white"
                  : "bg-[#111] text-[#888] hover:text-white"
              }`}
              title="Saved albums"
            >
              Albums
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
                <span className="ml-1.5 text-[#999]">{browserSetlistsList.length}</span>
              )}
            </button>
          </div>
        </div>

        {tab === "albums" ? (
          selectedAlbum ? (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a] flex items-center gap-3">
                <button
                  onClick={() => setSelectedAlbum(null)}
                  className="text-[10px] text-[#888] hover:text-white uppercase tracking-wider transition-colors shrink-0"
                >
                  ← Albums
                </button>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-white truncate">{selectedAlbum.title}</div>
                  <div className="text-[10px] text-[#888] truncate">
                    {selectedAlbum.artist}{selectedAlbum.year ? ` · ${selectedAlbum.year}` : ""} · {albumTracks.length}/{selectedAlbum.trackCount} tracks
                  </div>
                </div>
              </div>
              <LibraryTrackList
                title={selectedAlbum.title}
                subtitle={`${selectedAlbum.artist}${selectedAlbum.year ? ` · ${selectedAlbum.year}` : ""}`}
                tracks={albumTracks}
                onAddToSetlist={addToSetlist}
                onPlay={(track) => { setSetlistMode(false); setNowPlaying(track); }}
                onArtistClick={navigateToArtist}
                nowPlaying={nowPlaying}
                sortOptions={["track", "artist", "bpm", "dur"]}
                defaultSort="track"
                emptyMessage="No tracks loaded — try syncing the album"
              />
            </div>
          ) : (
            <div className="flex-1 overflow-hidden flex flex-col">
              <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a] flex items-center gap-3 flex-wrap">
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="text-sm font-medium text-white">Saved Albums</span>
                  <span className="text-[10px] text-[#999] uppercase tracking-wider">
                    {albumsSearch ? `${filteredAlbums.length}/` : ""}{savedAlbums.length.toLocaleString()}
                  </span>
                </div>
                <input
                  type="text"
                  placeholder="SEARCH ALBUM / ARTIST..."
                  value={albumsSearch}
                  onChange={(e) => setAlbumsSearch(e.target.value)}
                  className="flex-1 min-w-[12rem] bg-[#111] border border-[#333] px-3 py-1.5 text-xs uppercase tracking-wider text-white placeholder-[#666] focus:outline-none focus:border-red-500 transition-colors"
                />
                <div className="flex items-center gap-1 ml-auto">
                  <span className="text-[10px] text-[#999] uppercase tracking-wider mr-1">Sort</span>
                  <select
                    value={albumsSort}
                    onChange={(e) => setAlbumsSort(e.target.value as AlbumSort)}
                    className="bg-[#111] border border-[#333] text-xs text-white px-2 py-1 focus:outline-none focus:border-red-500"
                  >
                    <option value="recency">Recently Saved</option>
                    <option value="release">Latest Release</option>
                    <option value="artist">A-Z Artist</option>
                    <option value="title">A-Z Title</option>
                  </select>
                </div>
              </div>
              <div ref={albumsScrollRef} className="flex-1 overflow-y-auto">
                {filteredAlbums.length === 0 ? (
                  <div className="px-5 py-8 text-center text-xs text-[#666]">
                    {albumsSearch ? "No albums match search" : "No saved albums"}
                  </div>
                ) : (
                  <div style={{ height: `${albumsVirtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
                    {albumsVirtualizer.getVirtualItems().map((vr) => {
                      const album = filteredAlbums[vr.index];
                      if (!album) return null;
                      return (
                        <div
                          key={album.browseId}
                          data-index={vr.index}
                          ref={albumsVirtualizer.measureElement}
                          onClick={() => setSelectedAlbum(album)}
                          className="px-5 py-2.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 cursor-pointer group absolute left-0 right-0 top-0"
                          style={{ transform: `translateY(${vr.start}px)` }}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
                              {album.title}
                            </div>
                            <div className="text-[10px] text-[#888] truncate mt-0.5">
                              {album.artist}{album.year ? ` · ${album.year}` : ""}
                            </div>
                          </div>
                          <span className="text-[10px] text-[#888] tabular-nums shrink-0">
                            {album.trackCount} tr
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )
        ) : tab === "liked" ? (
          <LibraryTrackList
            title="♥ Liked Songs"
            tracks={likedTracks}
            onAddToSetlist={addToSetlist}
            onPlay={(track) => { setSetlistMode(false); setNowPlaying(track); }}
            onArtistClick={navigateToArtist}
            nowPlaying={nowPlaying}
            sortOptions={["recency", "track", "artist", "album", "energy", "danceability", "valence", "bpm"]}
            defaultSort="recency"
            emptyMessage="No liked songs yet — like tracks in YT Music and they'll appear here after the next sync"
          />
        ) : tab === "setlists" ? (
          <div className="flex-1 overflow-y-auto">
            {vaultManifest.length > 0 && (
              <>
                <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-[#999] uppercase tracking-wider">
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
                    <span className="text-[10px] text-[#888] tabular-nums">
                      {entry.trackCount} tracks
                    </span>
                  </div>
                ))}
              </>
            )}
            {browserSetlistsList.length > 0 && (
              <>
                <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-[#999] uppercase tracking-wider">
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
                    <span className="text-[10px] text-[#888] tabular-nums mr-1">
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
            {vaultManifest.length === 0 && browserSetlistsList.length === 0 && playlistIndex.length === 0 && (
              <div className="flex-1 flex items-center justify-center py-20">
                <p className="text-[#888] text-xs uppercase tracking-widest text-center px-8">
                  No saved setlists<br />Use Save to store a setlist
                </p>
              </div>
            )}
            {playlistIndex.length > 0 && (
              <PlaylistPicker
                playlists={playlistIndex}
                loading={playlistLoading}
                onSelect={handleLoadPlaylist}
              />
            )}
          </div>
        ) : (
          <>
            <FilterPanel
              filters={filters}
              onChange={setFilters}
              artistCount={artists.length}
              hidden={!!selectedArtist}
              tamilMode={tamilMode}
              onTamilToggle={() => { setTamilMode((v) => !v); setIlaiyaraajaMode(false); setSectionMode("browse"); }}
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
                  setSectionDesi("");
                }
              }}
              sectionSearch={sectionSearch}
              onSectionSearchChange={setSectionSearch}
              sectionBpmMin={sectionBpmMin}
              sectionBpmMax={sectionBpmMax}
              onSectionBpmChange={(min, max) => { setSectionBpmMin(min); setSectionBpmMax(max); }}
              sectionTrackCount={sectionTracks.length}
              sectionDesi={sectionDesi}
              onSectionDesiChange={setSectionDesi}
              ilaiyaraajaMode={ilaiyaraajaMode}
              onIlaiyaraajaToggle={() => {
                setIlaiyaraajaMode((v) => {
                  if (!v) { setTamilMode(true); setSectionMode("browse"); }
                  return !v;
                });
              }}
              onBackToTamil={() => { setIlaiyaraajaMode(false); setTamilMode(true); }}
              ilaiyaraajaSearch={ilaiyaraajaSearch}
              onIlaiyaraajaSearchChange={setIlaiyaraajaSearch}
              ilaiyaraajaTrackCount={ilaiyaraajaTracks.length}
            />

            {loading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse mx-auto mb-3" />
                  <p className="text-[#999] text-xs uppercase tracking-widest">Loading</p>
                </div>
              </div>
            ) : ilaiyaraajaMode ? (
              <SectionTrackList
                tracks={ilaiyaraajaTracks}
                label="Ilaiyaraaja"
                search={ilaiyaraajaSearch}
                onSearchChange={setIlaiyaraajaSearch}
                accentColor="red"
                nowPlaying={nowPlaying}
                onPlay={(track) => { setSetlistMode(false); setNowPlaying(track); }}
                onAddToSetlist={addToSetlist}
                emptyMessage={ilaiyaraajaSearch ? "No results" : "No tracks loaded"}
              />
            ) : tamilMode ? (
              <SectionTrackList
                tracks={tamilTracks}
                label="Tamil"
                search={tamilSearch}
                onSearchChange={setTamilSearch}
                accentColor="amber"
                nowPlaying={nowPlaying}
                onPlay={(track) => { setSetlistMode(false); setNowPlaying(track); }}
                onAddToSetlist={addToSetlist}
                emptyMessage={tamilSearch ? "No results" : "No Tamil tracks loaded"}
                onArtistClick={navigateToArtist}
              />
            ) : sectionMode === "tv" ? (
              <div className="flex-1 flex flex-col min-h-0">
                {/* TV section header */}
                <div className="px-5 py-2 border-b border-[#222] flex items-center gap-2">
                  <button
                    onClick={() => setSectionMode("browse")}
                    className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-red-600 text-white"
                  >
                    Pyaar.TV
                  </button>
                  <span className="text-[10px] text-[#999] uppercase tracking-wider cursor-pointer hover:text-white transition-colors" onClick={() => setSectionMode("browse")}>
                    &larr; back to all
                  </span>
                </div>
                {/* TV player + guide layout */}
                <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
                  {/* Player */}
                  <div className="md:flex-1 md:min-w-0">
                    <TvPlayer
                      ref={tvPlayerRef}
                      onEnded={tvHandleEnded}
                      onSkip={tvSkip}
                      channelName={tvCurrentChannel?.name}
                      videoTitle={tvVideoTitle}
                    />
                  </div>
                  {/* Guide */}
                  <div className="flex-1 md:flex-none md:w-[340px] md:border-l border-[#222] overflow-y-auto">
                    <TvGuide
                      channels={tvChannels}
                      activeChannelId={tvCurrentChannel?.id ?? null}
                      onSelectChannel={tvTuneIn}
                    />
                  </div>
                </div>
              </div>
            ) : (sectionMode === "downtempo" || sectionMode === "ambient") ? (
              <SectionTrackList
                tracks={sectionTracks}
                label={sectionMode === "downtempo" ? "Downtempo" : "Ambient"}
                search={sectionSearch}
                onSearchChange={setSectionSearch}
                accentColor={sectionMode === "downtempo" ? "cyan" : "purple"}
                nowPlaying={nowPlaying}
                onPlay={(track) => { setSetlistMode(false); setNowPlaying(track); }}
                onAddToSetlist={addToSetlist}
                emptyMessage={sectionSearch ? "No results" : `No ${sectionMode} tracks tagged yet`}
                showGenre
                onArtistClick={navigateToArtist}
              />
            ) : selectedArtist ? (
              <div className="flex-1 min-h-0 flex flex-col">
                {admin && (
                  <div className="px-5 pt-3 shrink-0">
                    <AdminArtistEditor artist={selectedArtist} onSaved={fetchArtists} />
                  </div>
                )}
                <TrackList
                  artist={selectedArtist}
                  tracks={tracks}
                  loading={tracksLoading}
                  onBack={() => { handleSelectArtist(null); if (prevSectionMode.current !== "browse") { setSectionMode(prevSectionMode.current); } }}
                  onAddToSetlist={addToSetlist}
                  onPlay={(track) => { setSetlistMode(false); setNowPlaying(track); }}
                  nowPlaying={nowPlaying}
                  onFilteredTracksChange={setArtistFilteredTracks}
                />
              </div>
            ) : (
              <div ref={browseScrollRef} className="flex-1 overflow-y-auto min-h-0 flex flex-col">
                {/* Featured artists — visible only on cold start */}
                {!filtersActive && featuredArtists.length > 0 && (
                  <div className="border-b border-[#222]">
                    <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a] flex items-center justify-between">
                      <span className="text-[10px] text-[#999] uppercase tracking-wider">
                        Discover
                      </span>
                      <button
                        onClick={() => {
                          const shuffled = [...allArtists].sort(() => Math.random() - 0.5);
                          setFeaturedArtists(shuffled.slice(0, 5));
                        }}
                        className="text-[10px] text-[#888] hover:text-white uppercase tracking-wider transition-colors"
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
                          {artist.desi === "Desi" && (
                            <span className="text-[10px] text-red-600 uppercase tracking-wider">
                              Desi
                            </span>
                          )}
                          <span className="text-[10px] text-[#999] ml-auto tabular-nums">
                            {artist.bpmLow}&ndash;{artist.bpmHigh}
                          </span>
                        </div>
                        <div className="flex gap-2 mt-0.5">
                          {artist.vibes.map((v) => (
                            <span key={v} className="text-[10px] text-[#888]">
                              {v}
                            </span>
                          ))}
                          <span className="text-[10px] text-[#999]">&middot;</span>
                          <span className="text-[10px] text-[#999]">{artist.samay}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {searchTracks.length > 0 && (
                  <>
                    <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                      <span className="text-[10px] text-[#999] uppercase tracking-wider">
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
                            className="text-[#999] hover:text-white transition-colors text-[10px]"
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
                            <div className="text-[10px] text-[#888] truncate">
                              {track.artistNames.split(";")[0]}
                            </div>
                          </div>
                          <span className="text-[10px] text-[#999] tabular-nums font-mono">
                            {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                          </span>
                          <span className="text-[10px] text-[#888] hidden sm:inline">
                            {track.duration || "—"}
                          </span>
                          <button
                            onClick={() => addToSetlist(track)}
                            className="text-[#888] hover:text-red-500 transition-colors text-sm font-bold"
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
                    <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a] flex items-center justify-between">
                      <span className="text-[10px] text-[#999] uppercase tracking-wider">
                        {browseView === "tracks"
                          ? `Tracks (${filteredTracksLoading ? "…" : filteredTracks.length})`
                          : searchTracks.length > 0
                            ? `Artists (${artists.length})`
                            : filtersActive
                              ? `${artists.length} Artists`
                              : "All Artists"
                        }
                      </span>
                      {filtersActive && !filters.search && (
                        <div className="flex gap-0.5">
                          <button
                            onClick={() => setBrowseView("artists")}
                            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                              browseView === "artists"
                                ? "bg-[#333] text-white"
                                : "bg-[#111] text-[#999] hover:text-[#ccc]"
                            }`}
                          >
                            Artists
                          </button>
                          <button
                            onClick={() => setBrowseView("tracks")}
                            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                              browseView === "tracks"
                                ? "bg-[#333] text-white"
                                : "bg-[#111] text-[#999] hover:text-[#ccc]"
                            }`}
                          >
                            Tracks
                          </button>
                        </div>
                      )}
                    </div>
                    {browseView === "tracks" && filtersActive && !filters.search ? (
                      <div className="flex-1">
                        {filteredTracksLoading ? (
                          <div className="flex items-center justify-center py-12">
                            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                          </div>
                        ) : filteredTracks.length === 0 ? (
                          <div className="flex items-center justify-center py-12">
                            <p className="text-[#888] text-xs uppercase tracking-widest">No tracks match</p>
                          </div>
                        ) : (
                          filteredTracks.map((track, i) => {
                            const isPlaying = nowPlaying && track.trackName === nowPlaying.trackName && track.artistNames === nowPlaying.artistNames;
                            return (
                              <div
                                key={`ft-${track.trackName}-${track.artistNames}-${i}`}
                                className={`px-3 md:px-5 py-1.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-2 md:gap-3 group cursor-pointer transition-colors ${
                                  isPlaying ? "bg-red-950/40" : ""
                                }`}
                                onDoubleClick={() => addToSetlist(track)}
                              >
                                <button
                                  onClick={() => { setSetlistMode(false); setNowPlaying(track); }}
                                  className="text-[#999] hover:text-white transition-colors text-[10px]"
                                  title="Play"
                                >
                                  &#9654;
                                </button>
                                <div className="flex-1 min-w-0">
                                  <div className={`text-xs truncate transition-colors ${
                                    isPlaying ? "text-red-400" : "text-[#ccc] group-hover:text-white"
                                  }`}>
                                    {track.trackName}
                                  </div>
                                  <div className="text-[10px] text-[#888] truncate">
                                    {track.artistNames.split(";")[0]}
                                  </div>
                                </div>
                                <span className="text-[10px] text-[#999] tabular-nums font-mono">
                                  {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                                </span>
                                <span className="text-[10px] text-[#888] hidden sm:inline">
                                  {track.duration || "—"}
                                </span>
                                <button
                                  onClick={() => addToSetlist(track)}
                                  className="text-[#888] hover:text-red-500 transition-colors text-sm font-bold"
                                  title="Add to setlist"
                                >
                                  +
                                </button>
                              </div>
                            );
                          })
                        )}
                      </div>
                    ) : (
                      <ArtistList artists={artists} onSelect={handleSelectArtist} scrollElementRef={browseScrollRef} />
                    )}
                  </>
                )}
                {searchTracks.length === 0 && artists.length === 0 && (
                  <div className="flex-1 flex items-center justify-center">
                    <p className="text-[#888] text-xs uppercase tracking-widest">No results</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Right: Setlist — desktop (hidden in TV mode) */}
      <div className={`${sectionMode === "tv" ? "hidden" : "hidden md:flex"} w-[380px] shrink-0 flex-col bg-background`}>
        <SetlistPanel
          tracks={setlist}
          setlistName={setlistName}
          nowPlaying={nowPlaying}
          chapters={chapters}
          suggestions={chapterSuggestions}
          suggestingForChapter={suggestingForChapter}
          onRemove={removeFromSetlist}
          onReorder={reorderTrack}
          onClear={() => { setSetlist([]); setChapters([]); setChapterSuggestions([]); setSuggestingForChapter(null); }}
          onImport={() => setImportOpen(true)}
          onOpen={() => setTab("setlists")}
          onSave={handleSave}
          onNew={handleNew}
          onRename={handleRename}
          onAutoSort={handleAutoSort}
          onPlay={playFromSetlist}
          onChaptersChange={setChapters}
          onRequestSuggestions={handleRequestSuggestions}
          onAddSuggestion={handleAddSuggestion}
          onToggleSeed={handleToggleSeed}
        />
        {recentlyPlayed.length > 0 && (
          <div className="border-t border-[#222]">
            <button
              onClick={() => setRecentExpanded((v) => !v)}
              className="w-full px-4 py-1.5 flex items-center justify-between text-[10px] text-[#999] uppercase tracking-wider hover:text-[#ccc] transition-colors"
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
                      <div className="text-[10px] text-[#888] truncate">
                        {track.artistNames.split(";")[0]}
                      </div>
                    </div>
                    <span className="text-[10px] text-[#888] tabular-nums font-mono shrink-0">
                      {track.tempo > 0 ? Math.round(track.tempo) : ""}
                    </span>
                    <button
                      onClick={() => addToSetlist(track)}
                      className="text-[#888] hover:text-red-500 transition-colors text-sm font-bold shrink-0"
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

      {/* Mobile: setlist toggle button (hidden in TV mode) */}
      <button
        onClick={() => setMobileSetlistOpen(true)}
        className={`${sectionMode === "tv" ? "hidden" : "md:hidden"} fixed bottom-12 right-4 z-30 bg-red-600 hover:bg-red-500 text-white w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-colors`}
        style={{ bottom: nowPlaying ? "3.5rem" : "1rem" }}
      >
        <span className="text-lg font-bold">{setlist.length || "+"}</span>
      </button>

      {/* Mobile: setlist drawer */}
      {mobileSetlistOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col">
          <div className="flex-shrink-0 bg-background/80 h-16" onClick={() => setMobileSetlistOpen(false)} />
          <div className="flex-1 bg-background border-t border-[#222] flex flex-col overflow-hidden">
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
                chapters={chapters}
                suggestions={chapterSuggestions}
                suggestingForChapter={suggestingForChapter}
                onRemove={removeFromSetlist}
                onReorder={reorderTrack}
                onClear={() => { setSetlist([]); setChapters([]); setChapterSuggestions([]); setSuggestingForChapter(null); }}
                onImport={() => setImportOpen(true)}
                onOpen={() => { setTab("setlists"); setMobileSetlistOpen(false); }}
                onSave={handleSave}
                onNew={handleNew}
                onRename={handleRename}
                onAutoSort={handleAutoSort}
                onPlay={playFromSetlist}
                onChaptersChange={setChapters}
                onRequestSuggestions={handleRequestSuggestions}
                onAddSuggestion={handleAddSuggestion}
                onToggleSeed={handleToggleSeed}
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
        onArtistClick={navigateToArtist}
      />
    </div>
  );
}
