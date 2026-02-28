import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Track } from "@/lib/types";

interface Props {
  tracks: Track[];
  label: string;
  search: string;
  onSearchChange: (v: string) => void;
  accentColor: "amber" | "cyan" | "purple" | "red";
  nowPlaying?: Track | null;
  onPlay: (track: Track) => void;
  onAddToSetlist: (track: Track) => void;
  emptyMessage: string;
  showGenre?: boolean;
}

const accentClasses = {
  amber: { bg: "bg-amber-950/30", text: "text-amber-400", hoverText: "hover:text-amber-400", hoverBtn: "hover:text-amber-500" },
  cyan: { bg: "bg-cyan-950/30", text: "text-cyan-400", hoverText: "hover:text-cyan-400", hoverBtn: "hover:text-cyan-500" },
  purple: { bg: "bg-purple-950/30", text: "text-purple-400", hoverText: "hover:text-purple-400", hoverBtn: "hover:text-purple-500" },
  red: { bg: "bg-red-950/30", text: "text-red-400", hoverText: "hover:text-red-400", hoverBtn: "hover:text-red-500" },
};

export function SectionTrackList({ tracks, label, search, onSearchChange, accentColor, nowPlaying, onPlay, onAddToSetlist, emptyMessage, showGenre }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const accent = accentClasses[accentColor];

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 48,
    overscan: 15,
  });

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-3 md:px-5 py-2 border-b border-[#222] flex items-center gap-3">
        <span className="text-[10px] text-[#555] uppercase tracking-wider">{label}</span>
        <span className="text-[10px] text-[#444]">{tracks.length} tracks</span>
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="FILTER..."
          className="bg-[#111] border border-[#333] px-3 py-1.5 text-xs uppercase tracking-wider text-white placeholder-[#666] focus:outline-none focus:border-red-500 w-40 sm:w-52 transition-colors"
        />
      </div>
      {tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-20">
          <p className="text-[#444] text-xs uppercase tracking-widest">{emptyMessage}</p>
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
            {virtualizer.getVirtualItems().map((vRow) => {
              const track = tracks[vRow.index];
              const isPlaying = nowPlaying && track.trackName === nowPlaying.trackName && track.artistNames === nowPlaying.artistNames;
              return (
                <div
                  key={vRow.index}
                  data-index={vRow.index}
                  ref={virtualizer.measureElement}
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vRow.start}px)` }}
                  className={`px-3 md:px-5 py-2 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-2 md:gap-3 group cursor-pointer transition-colors ${
                    isPlaying ? accent.bg : ""
                  }`}
                  onDoubleClick={() => onAddToSetlist(track)}
                >
                  <button
                    onClick={() => onPlay(track)}
                    className={`text-[#555] transition-colors text-[10px] ${accent.hoverText}`}
                    title="Play"
                  >
                    &#9654;
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className={`text-xs truncate transition-colors ${
                      isPlaying ? accent.text : "text-[#ccc] group-hover:text-white"
                    }`}>
                      {track.trackName}
                    </div>
                    <div className="text-[10px] text-[#555] truncate">
                      {track.artistNames.split(";")[0]}{track.albumName ? ` · ${track.albumName}` : ""}
                    </div>
                  </div>
                  {showGenre && track.genres && track.genres.length > 0 && (
                    <span className="text-[10px] text-[#333] hidden sm:inline truncate max-w-24">
                      {track.genres[0]}
                    </span>
                  )}
                  <span className="text-[10px] text-[#555] tabular-nums font-mono">
                    {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                  </span>
                  <button
                    onClick={() => onAddToSetlist(track)}
                    className={`text-[#333] transition-colors text-sm font-bold ${accent.hoverBtn}`}
                    title="Add to setlist"
                  >
                    +
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
