import { useRef, useCallback, useState, useMemo, useEffect } from "react";
import type { Artist, Track } from "@/lib/types";
import { pitchToCamelot, getKeyCompatibility } from "@/lib/camelot";
import { useVirtualizer } from "@tanstack/react-virtual";

type SortCol = "track" | "bpm" | "key" | "dur" | null;
type SortDir = "asc" | "desc";
type ViewMode = "all" | "albums";
type ListItem = { type: "track"; track: Track } | { type: "album"; albumName: string; count: number };

interface Props {
  artist: Artist;
  tracks: Track[];
  loading: boolean;
  onBack: () => void;
  onAddToSetlist: (track: Track) => void;
  onPlay?: (track: Track) => void;
  nowPlaying?: Track | null;
  onFilteredTracksChange?: (tracks: Track[]) => void;
}

export function TrackList({ artist, tracks, loading, onBack, onAddToSetlist, onPlay, nowPlaying, onFilteredTracksChange }: Props) {
  const tapTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const touchStart = useRef<{ x: number; y: number; index: number } | null>(null);
  const [swipeState, setSwipeState] = useState<{ index: number; dx: number } | null>(null);
  const [swipeFlash, setSwipeFlash] = useState<{ index: number; action: "add" | "play" } | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [trackSearch, setTrackSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const toggleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === "desc") setSortDir("asc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir(col === "track" ? "asc" : "desc");
    }
  }, [sortCol, sortDir]);

  const filteredTracks = useMemo(() => {
    if (!trackSearch.trim()) return tracks;
    const q = trackSearch.toLowerCase();
    return tracks.filter((t) => t.trackName.toLowerCase().includes(q));
  }, [tracks, trackSearch]);

  useEffect(() => {
    onFilteredTracksChange?.(filteredTracks);
  }, [filteredTracks, onFilteredTracksChange]);

  const sortedTracks = useMemo(() => {
    if (!sortCol) return filteredTracks;
    const sorted = [...filteredTracks].sort((a, b) => {
      switch (sortCol) {
        case "track": return a.trackName.localeCompare(b.trackName);
        case "bpm": return (a.tempo || 0) - (b.tempo || 0);
        case "key": return (a.key || 0) - (b.key || 0);
        case "dur": {
          const parseDur = (d: string) => {
            if (!d) return 0;
            const parts = d.split(":");
            return parts.length === 2 ? +parts[0] * 60 + +parts[1] : 0;
          };
          return parseDur(a.duration) - parseDur(b.duration);
        }
        default: return 0;
      }
    });
    return sortDir === "desc" ? sorted.reverse() : sorted;
  }, [filteredTracks, sortCol, sortDir]);

  const listItems = useMemo<ListItem[]>(() => {
    if (viewMode === "all") {
      return sortedTracks.map((track) => ({ type: "track" as const, track }));
    }
    const albumMap = new Map<string, Track[]>();
    for (const track of sortedTracks) {
      const key = track.albumName || "Unknown Album";
      const arr = albumMap.get(key);
      if (arr) arr.push(track);
      else albumMap.set(key, [track]);
    }
    const items: ListItem[] = [];
    for (const [albumName, albumTracks] of albumMap) {
      items.push({ type: "album", albumName, count: albumTracks.length });
      for (const track of albumTracks) {
        items.push({ type: "track", track });
      }
    }
    return items;
  }, [sortedTracks, viewMode]);

  const rowVirtualizer = useVirtualizer({
    count: listItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => listItems[index]?.type === "album" ? 36 : 52,
    overscan: 10,
  });

  const handleTouchStart = useCallback((e: React.TouchEvent, index: number) => {
    const touch = e.touches[0];
    touchStart.current = { x: touch.clientX, y: touch.clientY, index };
    setSwipeState(null);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent, index: number) => {
    if (!touchStart.current || touchStart.current.index !== index) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStart.current.x;
    const dy = touch.clientY - touchStart.current.y;
    if (Math.abs(dy) > Math.abs(dx)) { touchStart.current = null; setSwipeState(null); return; }
    if (Math.abs(dx) > 10) setSwipeState({ index, dx });
  }, []);

  const handleTouchEnd = useCallback((track: Track, index: number) => {
    if (!swipeState || swipeState.index !== index) { touchStart.current = null; setSwipeState(null); return; }
    const dx = swipeState.dx;
    setSwipeState(null);
    touchStart.current = null;
    if (dx > 50) {
      onAddToSetlist(track);
      setSwipeFlash({ index, action: "add" });
      setTimeout(() => setSwipeFlash(null), 400);
    } else if (dx < -50) {
      onPlay?.(track);
      setSwipeFlash({ index, action: "play" });
      setTimeout(() => setSwipeFlash(null), 400);
    }
  }, [swipeState, onAddToSetlist, onPlay]);

  const handleRowClick = useCallback((track: Track, index: number) => {
    if (typeof window === "undefined") return;
    if (!window.matchMedia("(hover: none)").matches) return;
    const existing = tapTimers.current.get(index);
    if (existing) {
      clearTimeout(existing);
      tapTimers.current.delete(index);
      onAddToSetlist(track);
    } else {
      const timer = setTimeout(() => {
        tapTimers.current.delete(index);
        onPlay?.(track);
      }, 300);
      tapTimers.current.set(index, timer);
    }
  }, [onAddToSetlist, onPlay]);

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div className="px-5 py-2 border-b border-[#222] flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-[#999] hover:text-white text-xs uppercase tracking-wider transition-colors"
        >
          &larr; Back
        </button>
        <span className="text-sm font-medium">{artist.artist}</span>
        <span className="text-[10px] text-[#999] uppercase">
          {trackSearch ? `${filteredTracks.length}/` : ""}{tracks.length} tracks
        </span>
        <input
          type="text"
          value={trackSearch}
          onChange={(e) => setTrackSearch(e.target.value)}
          placeholder="FILTER..."
          className="bg-[#111] border border-[#333] px-3 py-1.5 text-xs uppercase tracking-wider text-white placeholder-[#999] focus:outline-none focus:border-red-500 w-40 sm:w-52 transition-colors"
        />
        <div className="ml-auto flex gap-1 text-[10px] uppercase tracking-wider">
          <button
            onClick={() => setViewMode("all")}
            className={`px-2 py-0.5 rounded transition-colors ${viewMode === "all" ? "bg-[#222] text-white" : "text-[#999] hover:text-white"}`}
          >
            All
          </button>
          <button
            onClick={() => setViewMode("albums")}
            className={`px-2 py-0.5 rounded transition-colors ${viewMode === "albums" ? "bg-[#222] text-white" : "text-[#999] hover:text-white"}`}
          >
            Albums
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#888] text-xs uppercase tracking-widest">No tracks in library</p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] text-[#999] uppercase tracking-wider border-b border-[#222] sticky top-0 bg-black">
              <tr>
                <th className="px-2 py-2 w-6"></th>
                <th className="text-left px-2 py-2 font-normal cursor-pointer hover:text-white transition-colors select-none" onClick={() => toggleSort("track")}>
                  Track{sortCol === "track" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
                <th className="text-right px-3 py-2 font-normal w-14 cursor-pointer hover:text-white transition-colors select-none" onClick={() => toggleSort("bpm")}>
                  BPM{sortCol === "bpm" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
                <th className="text-right px-3 py-2 font-normal w-12 hidden sm:table-cell cursor-pointer hover:text-white transition-colors select-none" onClick={() => toggleSort("key")}>
                  Key{sortCol === "key" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
                <th className="text-right px-3 py-2 font-normal w-14 hidden sm:table-cell cursor-pointer hover:text-white transition-colors select-none" onClick={() => toggleSort("dur")}>
                  Dur{sortCol === "dur" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {/* Spacer for virtual scroll offset */}
              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: rowVirtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                  <td colSpan={6} />
                </tr>
              )}
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const i = virtualRow.index;
                const item = listItems[i];
                if (item.type === "album") {
                  return (
                    <tr
                      key={`album-${item.albumName}`}
                      data-index={i}
                      ref={rowVirtualizer.measureElement}
                      className="border-b border-[#222] bg-[#0a0a0a]"
                    >
                      <td colSpan={6} className="px-2 py-2">
                        <span className="text-[10px] text-[#888] uppercase tracking-wider">{item.albumName}</span>
                        <span className="text-[10px] text-[#888] ml-2">{item.count}</span>
                      </td>
                    </tr>
                  );
                }
                const track = item.track;
                const isPlaying = nowPlaying && track.trackName === nowPlaying.trackName && track.artistNames === nowPlaying.artistNames;
                return (
                  <tr
                    key={`${track.trackName}-${i}`}
                    data-index={i}
                    ref={rowVirtualizer.measureElement}
                    className={`border-b border-[#111] hover:bg-[#0a0a0a] group cursor-pointer transition-colors ${
                      isPlaying ? "bg-red-950/40" :
                      swipeFlash?.index === i ? (swipeFlash.action === "add" ? "bg-green-900/30" : "bg-blue-900/30") : ""
                    }`}
                    style={swipeState?.index === i ? { transform: `translateX(${Math.max(-60, Math.min(60, swipeState.dx))}px)` } : undefined}
                    onClick={() => handleRowClick(track, i)}
                    onDoubleClick={() => onAddToSetlist(track)}
                    onTouchStart={(e) => handleTouchStart(e, i)}
                    onTouchMove={(e) => handleTouchMove(e, i)}
                    onTouchEnd={() => handleTouchEnd(track, i)}
                  >
                    <td className="px-2 py-1.5">
                      {onPlay && (
                        <button
                          onClick={() => onPlay(track)}
                          className="text-[#999] hover:text-white transition-colors text-[10px]"
                          title="Preview"
                        >
                          &#9654;
                        </button>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <div className={`truncate max-w-[50vw] md:max-w-md transition-colors ${
                        isPlaying ? "text-red-400" : "text-[#ccc] group-hover:text-white"
                      }`}>
                        {track.trackName}
                      </div>
                      {track.genres.length > 0 && (
                        <div className="text-[10px] text-[#999] truncate max-w-[50vw] md:max-w-md">
                          {track.genres.join(", ")}
                        </div>
                      )}
                    </td>
                    <td className="text-right px-3 py-1.5 text-[#aaa] tabular-nums text-xs">
                      {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                    </td>
                    <td className="text-right px-3 py-1.5 text-[#888] tabular-nums text-xs hidden sm:table-cell">
                      <span className="inline-flex items-center gap-1 justify-end">
                        {nowPlaying && track.key > 0 && nowPlaying.key > 0 && (() => {
                          const compat = getKeyCompatibility(nowPlaying.key, track.key);
                          if (compat === "perfect" || compat === "harmonic")
                            return <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" title="Harmonic match" />;
                          if (compat === "energy")
                            return <span className="w-1.5 h-1.5 border border-yellow-500 rounded-full shrink-0" title="Energy match" />;
                          return null;
                        })()}
                        {track.key > 0 ? pitchToCamelot(track.key) : "—"}
                      </span>
                    </td>
                    <td className="text-right px-3 py-1.5 text-[#888] text-xs hidden sm:table-cell">
                      {track.duration || "—"}
                    </td>
                    <td className="px-3 py-1.5">
                      <button
                        onClick={() => onAddToSetlist(track)}
                        className="text-[#999] hover:text-red-500 transition-colors text-sm font-bold"
                        title="Add to setlist"
                      >
                        +
                      </button>
                    </td>
                  </tr>
                );
              })}
              {/* Bottom spacer */}
              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0) }}>
                  <td colSpan={6} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
