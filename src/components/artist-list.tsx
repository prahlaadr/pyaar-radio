import { useRef } from "react";
import type { Artist } from "@/lib/types";
import { useVirtualizer } from "@tanstack/react-virtual";

interface Props {
  artists: Artist[];
  onSelect: (artist: Artist) => void;
}

export function ArtistList({ artists, onSelect }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: artists.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 56,
    overscan: 10,
  });

  if (artists.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[#999] text-xs uppercase tracking-widest">No results</p>
      </div>
    );
  }

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const artist = artists[vr.index];
          if (!artist) return null;
          return (
            <button
              key={artist.artist}
              data-index={vr.index}
              ref={virtualizer.measureElement}
              onClick={() => onSelect(artist)}
              className="w-full text-left px-5 py-2.5 hover:bg-[#111] border-b border-[#151515] transition-colors group absolute left-0 right-0 top-0"
              style={{ transform: `translateY(${vr.start}px)` }}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium group-hover:text-red-500 transition-colors">
                  {artist.artist}
                </span>
                <span className="text-[10px] text-[#999] uppercase tracking-wider">
                  {artist.channel}
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
                  <span key={v} className="text-[10px] text-[#999]">
                    {v}
                  </span>
                ))}
                <span className="text-[10px] text-[#999]">&middot;</span>
                <span className="text-[10px] text-[#999]">{artist.samay}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
