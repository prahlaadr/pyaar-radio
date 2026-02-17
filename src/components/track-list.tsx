import { useRef, useCallback, useState, useMemo } from "react";
import type { Artist, Track } from "@/lib/types";
import { pitchToCamelot, getKeyCompatibility } from "@/lib/camelot";

type SortCol = "track" | "bpm" | "key" | "dur" | null;
type SortDir = "asc" | "desc";

interface Props {
  artist: Artist;
  tracks: Track[];
  loading: boolean;
  onBack: () => void;
  onAddToSetlist: (track: Track) => void;
  onPlay?: (track: Track) => void;
  nowPlaying?: Track | null;
}

export function TrackList({ artist, tracks, loading, onBack, onAddToSetlist, onPlay, nowPlaying }: Props) {
  const tapTimers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  const touchStart = useRef<{ x: number; y: number; index: number } | null>(null);
  const [swipeState, setSwipeState] = useState<{ index: number; dx: number } | null>(null);
  const [swipeFlash, setSwipeFlash] = useState<{ index: number; action: "add" | "play" } | null>(null);
  const [sortCol, setSortCol] = useState<SortCol>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const toggleSort = useCallback((col: SortCol) => {
    if (sortCol === col) {
      if (sortDir === "asc") setSortDir("desc");
      else { setSortCol(null); setSortDir("asc"); }
    } else {
      setSortCol(col);
      setSortDir(col === "track" ? "asc" : "desc");
    }
  }, [sortCol, sortDir]);

  const sortedTracks = useMemo(() => {
    if (!sortCol) return tracks;
    const sorted = [...tracks].sort((a, b) => {
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
  }, [tracks, sortCol, sortDir]);

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
          className="text-[#555] hover:text-white text-xs uppercase tracking-wider transition-colors"
        >
          &larr; Back
        </button>
        <span className="text-sm font-medium">{artist.artist}</span>
        <span className="text-[10px] text-[#555] uppercase">
          {tracks.length} tracks
        </span>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#444] text-xs uppercase tracking-widest">No tracks in library</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] text-[#555] uppercase tracking-wider border-b border-[#222] sticky top-0 bg-black">
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
              {sortedTracks.map((track, i) => (
                <tr
                  key={`${track.trackName}-${i}`}
                  className={`border-b border-[#111] hover:bg-[#0a0a0a] group cursor-pointer transition-colors ${
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
                        className="text-[#666] hover:text-white transition-colors text-[10px]"
                        title="Preview"
                      >
                        &#9654;
                      </button>
                    )}
                  </td>
                  <td className="px-2 py-1.5">
                    <div className="truncate max-w-[50vw] md:max-w-md text-[#ccc] group-hover:text-white transition-colors">
                      {track.trackName}
                    </div>
                    {track.genres.length > 0 && (
                      <div className="text-[10px] text-[#666] truncate max-w-[50vw] md:max-w-md">
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
                          return <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />;
                        if (compat === "energy")
                          return <span className="w-1.5 h-1.5 rounded-full bg-yellow-500 shrink-0" />;
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
                      className="text-[#666] hover:text-red-500 transition-colors text-sm font-bold"
                      title="Add to setlist"
                    >
                      +
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
