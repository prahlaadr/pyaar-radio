import React, { useState, useCallback } from "react";
import type { SetlistTrack, Track } from "@/lib/types";
import { pitchToCamelot, getKeyCompatibility } from "@/lib/camelot";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Props {
  tracks: SetlistTrack[];
  setlistName: string | null;
  nowPlaying?: Track | null;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
  onImport: () => void;
  onOpen: () => void;
  onSave: () => void;
  onNew: () => void;
  onRename: (name: string) => void;
  onAutoSort?: () => void;
}

function getBPMStats(tracks: SetlistTrack[]): { min: number; max: number; avg: number } | null {
  const bpms = tracks.map((t) => t.tempo).filter((b) => b > 0);
  if (bpms.length === 0) return null;
  return {
    min: Math.round(Math.min(...bpms)),
    max: Math.round(Math.max(...bpms)),
    avg: Math.round(bpms.reduce((a, b) => a + b, 0) / bpms.length),
  };
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

function SortableTrack({
  track,
  index,
  isPlaying,
  onRemove,
}: {
  track: SetlistTrack;
  index: number;
  isPlaying: boolean;
  onRemove: (id: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: track.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`px-4 py-2 border-b border-[#111] flex items-center gap-2 group hover:bg-[#0a0a0a] transition-all ${
        isPlaying ? "border-l-2 border-l-red-500" : ""
      } ${isDragging ? "opacity-30 bg-[#111]" : ""}`}
      onDoubleClick={() => onRemove(track.id)}
    >
      <span
        {...attributes}
        {...listeners}
        className="text-[10px] text-[#333] group-hover:text-[#555] w-5 text-right tabular-nums font-mono select-none cursor-grab active:cursor-grabbing touch-none"
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate text-[#ccc]">{track.trackName}</div>
        <div className="text-[10px] text-[#888] truncate">
          {track.artistNames.split(";")[0]}
        </div>
      </div>
      <span className="text-[10px] text-[#aaa] tabular-nums font-mono w-8 text-right">
        {track.tempo > 0 ? Math.round(track.tempo) : "—"}
      </span>
      <span className="text-[10px] text-[#888] tabular-nums font-mono w-6 text-right">
        {track.key > 0 ? pitchToCamelot(track.key) : "—"}
      </span>
      <span className="text-[10px] text-[#777] w-10 text-right">
        {track.duration || "—"}
      </span>
      <button
        onClick={() => onRemove(track.id)}
        className="text-[#222] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all text-xs"
      >
        &times;
      </button>
    </div>
  );
}

function TransitionIndicator({
  track,
  next,
}: {
  track: SetlistTrack;
  next: SetlistTrack;
}) {
  const bpmDelta = track.tempo > 0 && next.tempo > 0 ? Math.round(next.tempo - track.tempo) : null;
  const keyCompat = track.key > 0 && next.key > 0 ? getKeyCompatibility(track.key, next.key) : null;
  const bpmColor = bpmDelta !== null
    ? Math.abs(bpmDelta) <= 5 ? "text-green-500" : Math.abs(bpmDelta) <= 15 ? "text-yellow-500" : "text-red-500"
    : "text-[#333]";
  const keyDot = keyCompat === "perfect" || keyCompat === "harmonic"
    ? "bg-green-500"
    : keyCompat === "energy"
    ? "bg-yellow-500"
    : keyCompat === "incompatible"
    ? "bg-red-500"
    : null;

  return (
    <div className="flex items-center justify-center gap-2 py-0.5 border-b border-[#0a0a0a]">
      <div className="w-px h-2 bg-[#222]" />
      {bpmDelta !== null && (
        <span className={`text-[9px] tabular-nums font-mono ${bpmColor}`}>
          {bpmDelta > 0 ? `+${bpmDelta}` : bpmDelta}
        </span>
      )}
      {keyDot && <span className={`w-1.5 h-1.5 rounded-full ${keyDot}`} />}
      <div className="w-px h-2 bg-[#222]" />
    </div>
  );
}

export function SetlistPanel({
  tracks,
  setlistName,
  nowPlaying,
  onRemove,
  onReorder,
  onClear,
  onImport,
  onOpen,
  onSave,
  onNew,
  onRename,
  onAutoSort,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const bpmStats = getBPMStats(tracks);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const fromIndex = tracks.findIndex((t) => t.id === active.id);
    const toIndex = tracks.findIndex((t) => t.id === over.id);
    if (fromIndex !== -1 && toIndex !== -1) {
      onReorder(fromIndex, toIndex);
    }
  }, [tracks, onReorder]);

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
    <div className="flex flex-col h-full md:h-screen">
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
            {bpmStats && (
              <> &middot; <span className="tabular-nums font-mono">{bpmStats.min === bpmStats.max ? bpmStats.min : `${bpmStats.min}–${bpmStats.max}`}</span> BPM (avg {bpmStats.avg})</>
            )}
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
          {onAutoSort && tracks.length >= 3 && (
            <button
              onClick={onAutoSort}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors"
              title="Sort by harmonic flow (BPM + key)"
            >
              Sort
            </button>
          )}
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
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={tracks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {tracks.map((track, i) => {
                const isPlaying = !!(nowPlaying && track.trackName === nowPlaying.trackName && track.artistNames === nowPlaying.artistNames);
                return (
                  <React.Fragment key={track.id}>
                    <SortableTrack
                      track={track}
                      index={i}
                      isPlaying={isPlaying}
                      onRemove={onRemove}
                    />
                    {i < tracks.length - 1 && (
                      <TransitionIndicator track={track} next={tracks[i + 1]} />
                    )}
                  </React.Fragment>
                );
              })}
            </SortableContext>
          </DndContext>
        </div>
      )}
    </div>
  );
}
