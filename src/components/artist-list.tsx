import type { Artist } from "@/lib/types";

interface Props {
  artists: Artist[];
  onSelect: (artist: Artist) => void;
}

export function ArtistList({ artists, onSelect }: Props) {
  if (artists.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-[#444] text-xs uppercase tracking-widest">No results</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {artists.map((artist) => (
        <button
          key={artist.artist}
          onClick={() => onSelect(artist)}
          className="w-full text-left px-5 py-2.5 hover:bg-[#111] border-b border-[#151515] transition-colors group"
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
  );
}
