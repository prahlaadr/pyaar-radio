import { useState } from "react";
import type { SetlistTrack } from "@/lib/types";

const CAMELOT: Record<number, string> = {
  0: "8B", 1: "3B", 2: "10B", 3: "5B", 4: "12B", 5: "7B",
  6: "2B", 7: "9B", 8: "4B", 9: "11B", 10: "6B", 11: "1B",
};

function formatKey(key: number): string {
  return CAMELOT[key] || "—";
}

interface Props {
  tracks: SetlistTrack[];
  setlistName: string | null;
  onRemove: (id: string) => void;
  onMove: (index: number, direction: "up" | "down") => void;
  onClear: () => void;
  onImport: () => void;
  onOpen: () => void;
  onSave: () => void;
  onNew: () => void;
  onRename: (name: string) => void;
}

function formatTotalDuration(tracks: SetlistTrack[]): string {
  let totalSeconds = 0;
  for (const t of tracks) {
    if (!t.duration) continue;
    const parts = t.duration.split(":");
    if (parts.length === 2) {
      totalSeconds += parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else if (parts.length === 3) {
      totalSeconds += parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
    }
  }
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function exportCSV(tracks: SetlistTrack[], name: string | null) {
  const header = "Position,Track Name,Artist,BPM,Key,Duration";
  const rows = tracks.map((t, i) => {
    const trackName = `"${t.trackName.replace(/"/g, '""')}"`;
    const artist = `"${t.artistNames.replace(/"/g, '""')}"`;
    return `${i + 1},${trackName},${artist},${t.tempo > 0 ? Math.round(t.tempo) : ""},${t.key || ""},${t.duration}`;
  });
  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  const slug = name ? name.replace(/\s+/g, "-").toLowerCase() : `setlist-${new Date().toISOString().slice(0, 10)}`;
  a.download = `${slug}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function SetlistPanel({
  tracks,
  setlistName,
  onRemove,
  onMove,
  onClear,
  onImport,
  onOpen,
  onSave,
  onNew,
  onRename,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");

  const startRename = () => {
    setEditValue(setlistName || "");
    setEditing(true);
  };

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== setlistName) {
      onRename(trimmed);
    }
    setEditing(false);
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="px-5 py-3 border-b border-[#222]">
        <div className="flex items-center justify-between mb-1">
          {editing ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditing(false);
              }}
              className="text-sm font-bold uppercase tracking-[0.2em] bg-transparent border-b border-red-500 outline-none text-white w-full"
            />
          ) : (
            <h2
              className="text-sm font-bold uppercase tracking-[0.2em] cursor-pointer hover:text-red-400 transition-colors truncate"
              onClick={startRename}
              title={setlistName ? "Click to rename" : "Untitled setlist"}
            >
              {setlistName || "Set"}
            </h2>
          )}
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-[#555] uppercase tracking-wider">
            {tracks.length} tracks &middot; {formatTotalDuration(tracks)}
          </span>
          <div className="flex gap-1.5">
            <button
              onClick={onOpen}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors"
            >
              Open
            </button>
            <button
              onClick={onNew}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors"
            >
              New
            </button>
            <button
              onClick={onSave}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors"
              title="Save to browser"
            >
              Save
            </button>
          </div>
        </div>
        <div className="flex gap-1.5 mt-1.5">
          <button
            onClick={onImport}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors"
          >
            Import
          </button>
          {tracks.length > 0 && (
            <>
              <button
                onClick={() => exportCSV(tracks, setlistName)}
                className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                Export
              </button>
              <button
                onClick={onClear}
                className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] transition-colors"
              >
                Clear
              </button>
            </>
          )}
        </div>
      </div>

      {tracks.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-[#333] text-xs uppercase tracking-widest text-center px-8">
            Add tracks to<br />build your set
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tracks.map((track, i) => (
            <div
              key={track.id}
              className="px-4 py-2 border-b border-[#111] flex items-center gap-2 group hover:bg-[#0a0a0a] cursor-pointer"
              onDoubleClick={() => onRemove(track.id)}
            >
              <span className="text-[10px] text-[#333] w-5 text-right tabular-nums font-mono">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs truncate text-[#ccc]">{track.trackName}</div>
                <div className="text-[10px] text-[#444] truncate">
                  {track.artistNames.split(";")[0]}
                </div>
              </div>
              <span className="text-[10px] text-[#555] tabular-nums font-mono w-8 text-right">
                {track.tempo > 0 ? Math.round(track.tempo) : "—"}
              </span>
              <span className="text-[10px] text-[#444] tabular-nums font-mono w-6 text-right">
                {track.key > 0 ? formatKey(track.key) : "—"}
              </span>
              <span className="text-[10px] text-[#333] w-10 text-right">
                {track.duration || "—"}
              </span>
              <div className="flex flex-col opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onMove(i, "up")}
                  disabled={i === 0}
                  className="text-[#444] hover:text-white text-[10px] disabled:text-[#1a1a1a] leading-none"
                >
                  &#9650;
                </button>
                <button
                  onClick={() => onMove(i, "down")}
                  disabled={i === tracks.length - 1}
                  className="text-[#444] hover:text-white text-[10px] disabled:text-[#1a1a1a] leading-none"
                >
                  &#9660;
                </button>
              </div>
              <button
                onClick={() => onRemove(track.id)}
                className="text-[#222] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all text-xs"
              >
                &times;
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
