import type { Artist, Track } from "@/lib/types";

interface Props {
  artist: Artist;
  tracks: Track[];
  loading: boolean;
  onBack: () => void;
  onAddToSetlist: (track: Track) => void;
  onPlay?: (track: Track) => void;
}

export function TrackList({ artist, tracks, loading, onBack, onAddToSetlist, onPlay }: Props) {
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
                <th className="text-right px-3 py-2 font-normal w-12">Key</th>
                <th className="text-right px-3 py-2 font-normal w-14">Dur</th>
                <th className="px-3 py-2 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {tracks.map((track, i) => (
                <tr
                  key={`${track.trackName}-${i}`}
                  className="border-b border-[#111] hover:bg-[#0a0a0a] group cursor-pointer"
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
                    <div className="truncate max-w-md text-[#ccc] group-hover:text-white transition-colors">
                      {track.trackName}
                    </div>
                    {track.genres.length > 0 && (
                      <div className="text-[10px] text-[#666] truncate max-w-md">
                        {track.genres.join(", ")}
                      </div>
                    )}
                  </td>
                  <td className="text-right px-3 py-1.5 text-[#aaa] tabular-nums text-xs">
                    {track.tempo > 0 ? Math.round(track.tempo) : "—"}
                  </td>
                  <td className="text-right px-3 py-1.5 text-[#888] tabular-nums text-xs">
                    {track.key || "—"}
                  </td>
                  <td className="text-right px-3 py-1.5 text-[#888] text-xs">
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
