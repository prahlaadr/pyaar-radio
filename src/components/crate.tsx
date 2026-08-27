"use client";

import { useState } from "react";
import type { SetlistTrack, Track } from "@/lib/types";

// Lightweight crate panel: a named, reorderable track list you drop songs into.
// Three of these stack in the sidebar (crate mode) so you can sort tracks across
// several sets at once. The full DJ builder (chapters/arc/harmonic) stays on the
// Setlists tab. Drop is native HTML5 DnD (track rows set an x-track payload).
export function Crate({
  name, tracks, active, onActivate, onDropTrack, onRemove, onPlay, onOpen, onNew, onSave,
}: {
  name: string;
  tracks: SetlistTrack[];
  active: boolean;
  onActivate: () => void;
  onDropTrack: (track: Track) => void;
  onRemove: (id: string) => void;
  onPlay: (track: SetlistTrack, index: number) => void;
  onOpen: () => void;
  onNew: () => void;
  onSave: () => void;
}) {
  const [over, setOver] = useState(false);

  const mins = Math.round(
    tracks.reduce((s, t) => {
      const [m, sec] = (t.duration || "0:0").split(":").map(Number);
      return s + (m || 0) * 60 + (sec || 0);
    }, 0) / 60,
  );

  return (
    <div
      onClick={onActivate}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false);
        const raw = e.dataTransfer.getData("application/x-track");
        if (raw) { try { onDropTrack(JSON.parse(raw)); } catch {} }
      }}
      className={`flex-1 flex flex-col min-h-0 border transition-colors cursor-pointer ${
        over ? "border-[#e32636] bg-[#e32636]/10"
        : active ? "border-[#e32636]/60 bg-[#0a0a0a]" : "border-[#222] bg-[#080808] hover:border-[#333]"
      }`}
    >
      <div className="px-3 py-2 border-b border-[#1a1a1a] shrink-0">
        <div className="flex items-center gap-2">
          {/* Plain label — clicking it activates the crate (rename lives on the Setlists page). */}
          <span className="flex-1 text-[11px] font-bold uppercase tracking-wider text-white truncate">{name}</span>
          {active && <span className="text-[8px] uppercase tracking-wider text-[#e32636] shrink-0">active</span>}
        </div>
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] text-[#666] uppercase tracking-wider">{tracks.length} tracks · {mins}m</span>
          <div className="flex gap-1.5" onClick={(e) => e.stopPropagation()}>
            {(["Open", "New", "Save"] as const).map((label, i) => (
              <button key={label} onClick={[onOpen, onNew, onSave][i]}
                className="text-[9px] uppercase tracking-wider text-[#888] hover:text-white transition-colors">{label}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        {tracks.length === 0 ? (
          <div className="h-full flex items-center justify-center px-3 py-6 text-center text-[10px] text-[#555] uppercase tracking-wider">
            {over ? "drop to add" : active ? "drop or + tracks here" : "drop tracks here"}
          </div>
        ) : (
          tracks.map((t, i) => (
            <div key={t.id}
              className="group flex items-center gap-2 px-3 py-1.5 border-b border-[#111] hover:bg-[#111]">
              <button onClick={(e) => { e.stopPropagation(); onPlay(t, i); }}
                className="text-[#666] hover:text-white text-[10px] shrink-0">▶</button>
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-[#ccc] truncate">{t.trackName}</div>
                <div className="text-[9px] text-[#666] truncate">{t.artistNames}</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); onRemove(t.id); }}
                className="text-[#555] hover:text-[#e32636] text-xs opacity-0 group-hover:opacity-100 shrink-0">✕</button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
