import { useRef, useCallback, useState, useMemo } from "react";
import type { Track } from "@/lib/types";
import { pitchToCamelot } from "@/lib/camelot";
import { useVirtualizer } from "@tanstack/react-virtual";

type SortCol = "recency" | "track" | "artist" | "album" | "bpm" | "dur";
type SortDir = "asc" | "desc";

const SORT_LABELS: Record<SortCol, string> = {
  recency: "Recently Liked",
  track: "A-Z Track",
  artist: "A-Z Artist",
  album: "A-Z Album",
  bpm: "BPM",
  dur: "Duration",
};

interface Props {
  title: string;
  subtitle?: string;
  tracks: Track[];
  onAddToSetlist: (track: Track) => void;
  onPlay?: (track: Track) => void;
  onArtistClick?: (artistName: string) => void;
  nowPlaying?: Track | null;
  /** Sort options to expose in the dropdown. Order shown matches array order. */
  sortOptions?: SortCol[];
  defaultSort?: SortCol;
  emptyMessage?: string;
}

export function LibraryTrackList({
  title,
  subtitle,
  tracks,
  onAddToSetlist,
  onPlay,
  onArtistClick,
  nowPlaying,
  sortOptions = ["recency", "track", "artist", "album"],
  defaultSort = "recency",
  emptyMessage = "No tracks",
}: Props) {
  const [search, setSearch] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>(defaultSort);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const scrollRef = useRef<HTMLDivElement>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tracks;
    return tracks.filter((t) =>
      t.trackName.toLowerCase().includes(q) ||
      t.artistNames.toLowerCase().includes(q) ||
      (t.albumName || "").toLowerCase().includes(q)
    );
  }, [tracks, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortCol) {
        case "recency": {
          // null/undefined sort to the end (no recency data yet)
          const ap = a.likedPosition ?? Number.MAX_SAFE_INTEGER;
          const bp = b.likedPosition ?? Number.MAX_SAFE_INTEGER;
          cmp = ap - bp;
          break;
        }
        case "track": cmp = a.trackName.localeCompare(b.trackName); break;
        case "artist": cmp = a.artistNames.localeCompare(b.artistNames); break;
        case "album": cmp = (a.albumName || "").localeCompare(b.albumName || ""); break;
        case "bpm": cmp = (a.tempo || 0) - (b.tempo || 0); break;
        case "dur": {
          const parse = (d: string) => {
            const p = (d || "").split(":");
            return p.length === 2 ? +p[0] * 60 + +p[1] : 0;
          };
          cmp = parse(a.duration) - parse(b.duration);
          break;
        }
      }
      return sortDir === "desc" ? -cmp : cmp;
    });
    return arr;
  }, [filtered, sortCol, sortDir]);

  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 12,
  });

  const handleSortChange = useCallback((col: SortCol) => {
    if (col === sortCol) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      // recency/bpm/dur default desc-ish? recency uses asc (0=newest first); A-Z uses asc
      setSortDir("asc");
    }
  }, [sortCol]);

  return (
    <div className="flex-1 overflow-hidden flex flex-col min-h-0">
      {/* Toolbar: title + count + search + sort */}
      <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a] flex items-center gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 shrink-0">
          <span className="text-sm font-medium text-white">{title}</span>
          <span className="text-[10px] text-[#999] uppercase tracking-wider">
            {search ? `${filtered.length}/` : ""}{tracks.length.toLocaleString()}
          </span>
        </div>
        {subtitle && <span className="text-[10px] text-[#888] truncate">{subtitle}</span>}
        <input
          type="text"
          placeholder="SEARCH TRACK / ARTIST / ALBUM..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[12rem] bg-[#111] border border-[#333] px-3 py-1.5 text-xs uppercase tracking-wider text-white placeholder-[#666] focus:outline-none focus:border-red-500 transition-colors"
        />
        <div className="flex items-center gap-1 ml-auto">
          <span className="text-[10px] text-[#999] uppercase tracking-wider mr-1">Sort</span>
          <select
            value={sortCol}
            onChange={(e) => handleSortChange(e.target.value as SortCol)}
            className="bg-[#111] border border-[#333] text-xs text-white px-2 py-1 focus:outline-none focus:border-red-500"
          >
            {sortOptions.map((opt) => (
              <option key={opt} value={opt}>{SORT_LABELS[opt]}</option>
            ))}
          </select>
          <button
            onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
            className="text-[10px] text-[#888] hover:text-white transition-colors w-6 text-center"
            title={sortDir === "asc" ? "Ascending" : "Descending"}
          >
            {sortDir === "asc" ? "↑" : "↓"}
          </button>
        </div>
      </div>

      {sorted.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#666] text-xs uppercase tracking-widest">{emptyMessage}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full text-sm">
            <thead className="text-[10px] text-[#999] uppercase tracking-wider border-b border-[#222] sticky top-0 bg-background z-10">
              <tr>
                <th className="px-2 py-2 w-6"></th>
                <th className="text-left px-2 py-2 font-normal">Track</th>
                <th className="text-left px-2 py-2 font-normal hidden md:table-cell">Artist</th>
                <th className="text-left px-2 py-2 font-normal hidden lg:table-cell">Album</th>
                <th className="text-right px-3 py-2 font-normal w-14">BPM</th>
                <th className="text-right px-3 py-2 font-normal w-12 hidden sm:table-cell">Key</th>
                <th className="text-right px-3 py-2 font-normal w-14 hidden sm:table-cell">Dur</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: rowVirtualizer.getVirtualItems()[0]?.start ?? 0 }}>
                  <td colSpan={8} />
                </tr>
              )}
              {rowVirtualizer.getVirtualItems().map((vr) => {
                const track = sorted[vr.index];
                if (!track) return null;
                const isPlaying = nowPlaying && track.videoId === nowPlaying.videoId;
                return (
                  <tr
                    key={`${track.videoId}-${vr.index}`}
                    data-index={vr.index}
                    ref={rowVirtualizer.measureElement}
                    className={`border-b border-[#111] hover:bg-[#0a0a0a] group transition-colors ${
                      isPlaying ? "bg-red-950/40" : ""
                    }`}
                  >
                    <td className="px-0 py-0">
                      {onPlay && (
                        <button
                          onClick={() => onPlay(track)}
                          className="text-[#999] hover:text-white transition-colors text-[10px] min-w-[36px] min-h-[36px] flex items-center justify-center"
                          title="Play"
                        >
                          ▶
                        </button>
                      )}
                    </td>
                    <td
                      className="px-2 py-1.5 cursor-pointer"
                      onClick={() => onPlay?.(track)}
                    >
                      <div className={`truncate max-w-[40vw] md:max-w-[18rem] transition-colors ${
                        isPlaying ? "text-red-400" : "text-[#ccc] group-hover:text-white"
                      }`}>
                        {track.trackName}
                      </div>
                      {/* Mobile: artist + album under track name (table cells hidden < md) */}
                      <div className="md:hidden text-[10px] text-[#888] truncate max-w-[40vw]">
                        {track.artistNames.replace(/;/g, ", ")}
                        {track.albumName ? ` · ${track.albumName}` : ""}
                      </div>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-[#aaa] hidden md:table-cell max-w-[14rem]">
                      <span className="truncate inline-block max-w-full">
                        {track.artistNames.split(";").map((name, i, all) => (
                          <span key={i}>
                            {onArtistClick ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); onArtistClick(name.trim()); }}
                                className="hover:text-white transition-colors"
                              >
                                {name.trim()}
                              </button>
                            ) : name.trim()}
                            {i < all.length - 1 && <span className="text-[#555]">, </span>}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-[#888] hidden lg:table-cell max-w-[14rem]">
                      <span className="truncate inline-block max-w-full">
                        {track.albumName || "—"}
                      </span>
                    </td>
                    <td className="text-right px-3 py-1.5 text-[#aaa] tabular-nums text-xs">
                      {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                    </td>
                    <td className="text-right px-3 py-1.5 text-[#888] tabular-nums text-xs hidden sm:table-cell">
                      {track.key > 0 ? pitchToCamelot(track.key) : "—"}
                    </td>
                    <td className="text-right px-3 py-1.5 text-[#888] text-xs hidden sm:table-cell">
                      {track.duration || "—"}
                    </td>
                    <td className="px-0 py-0">
                      <button
                        onClick={() => onAddToSetlist(track)}
                        className="text-[#999] hover:text-red-500 transition-colors text-sm font-bold min-w-[36px] min-h-[36px] flex items-center justify-center"
                        title="Add to setlist"
                      >
                        +
                      </button>
                    </td>
                  </tr>
                );
              })}
              {rowVirtualizer.getVirtualItems().length > 0 && (
                <tr style={{ height: rowVirtualizer.getTotalSize() - (rowVirtualizer.getVirtualItems().at(-1)?.end ?? 0) }}>
                  <td colSpan={8} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
