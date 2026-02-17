import { useRef, useCallback } from "react";
import type { Artist, Track } from "@/lib/types";
import { pitchToCamelot, getKeyCompatibility } from "@/lib/camelot";

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
                <th className="text-left px-2 py-2 font-normal">Track</th>
                <th className="text-right px-3 py-2 font-normal w-14">BPM</th>
                <th className="text-right px-3 py-2 font-normal w-12 hidden sm:table-cell">Key</th>
                <th className="text-right px-3 py-2 font-normal w-14 hidden sm:table-cell">Dur</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track, i) => (
                <tr
                  key={`${track.trackName}-${i}`}
                  className="border-b border-[#111] hover:bg-[#0a0a0a] group cursor-pointer"
                  onClick={() => handleRowClick(track, i)}
                  onDoubleClick={() => onAddToSetlist(track)}
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
