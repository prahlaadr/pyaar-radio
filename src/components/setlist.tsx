import React, { useState, useCallback, useMemo } from "react";
import type { SetlistTrack, Track, SetlistChapter, ChapterType } from "@/lib/types";
import { CHAPTER_TYPES } from "@/lib/types";
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

const CHAPTER_COLORS: Record<ChapterType, string> = {
  intro: "text-blue-400 border-blue-400/30",
  buildup: "text-amber-400 border-amber-400/30",
  cruise: "text-green-400 border-green-400/30",
  peak: "text-red-400 border-red-400/30",
  comedown: "text-purple-400 border-purple-400/30",
  closer: "text-cyan-400 border-cyan-400/30",
};

const CHAPTER_BG: Record<ChapterType, string> = {
  intro: "bg-blue-400/5",
  buildup: "bg-amber-400/5",
  cruise: "bg-green-400/5",
  peak: "bg-red-400/5",
  comedown: "bg-purple-400/5",
  closer: "bg-cyan-400/5",
};

// Default arc suggestion: what chapter type makes sense after each type
const NEXT_CHAPTER_SUGGESTIONS: Record<ChapterType, ChapterType[]> = {
  intro: ["buildup"],
  buildup: ["cruise", "peak"],
  cruise: ["peak", "buildup"],
  peak: ["cruise", "comedown"],
  comedown: ["cruise", "closer"],
  closer: [],
};

interface Props {
  tracks: SetlistTrack[];
  setlistName: string | null;
  nowPlaying?: Track | null;
  chapters: SetlistChapter[];
  suggestions: Track[];
  suggestingForChapter: string | null;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onClear: () => void;
  onImport: () => void;
  onOpen: () => void;
  onSave: () => void;
  onNew: () => void;
  onRename: (name: string) => void;
  onAutoSort?: () => void;
  onPlay?: (track: SetlistTrack, index: number) => void;
  onChaptersChange: (chapters: SetlistChapter[]) => void;
  onRequestSuggestions: (chapterId: string) => void;
  onAddSuggestion: (track: Track) => void;
  onToggleSeed: (chapterId: string, trackId: string) => void;
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

function exportCSV(tracks: SetlistTrack[], name: string | null, chapters: SetlistChapter[]) {
  const chapterAt = new Map<number, SetlistChapter>();
  for (const ch of chapters) chapterAt.set(ch.startIndex, ch);

  const header = "Position,Chapter,Track Name,Artist,BPM,Key,Duration,Seed";
  const rows = tracks.map((t, i) => {
    const trackName = `"${t.trackName.replace(/"/g, '""')}"`;
    const artist = `"${t.artistNames.replace(/"/g, '""')}"`;
    const ch = chapterAt.get(i);
    const chapterLabel = ch ? ch.type.toUpperCase() : "";
    const isSeed = chapters.some((c) => c.seedTrackIds.includes(t.id));
    return `${i + 1},${chapterLabel},${trackName},${artist},${t.tempo > 0 ? Math.round(t.tempo) : ""},${t.key || ""},${t.duration},${isSeed ? "Y" : ""}`;
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
  isSeed,
  onRemove,
  onPlay,
  onToggleSeed,
}: {
  track: SetlistTrack;
  index: number;
  isPlaying: boolean;
  isSeed: boolean;
  onRemove: (id: string) => void;
  onPlay?: () => void;
  onToggleSeed?: () => void;
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
      {onToggleSeed && (
        <button
          onClick={onToggleSeed}
          className={`text-[10px] transition-colors w-3 ${isSeed ? "text-amber-400" : "text-[#222] hover:text-[#555]"}`}
          title={isSeed ? "Seed track (click to unmark)" : "Mark as seed track"}
        >
          {isSeed ? "\u2605" : "\u2606"}
        </button>
      )}
      {onPlay && (
        <button
          onClick={onPlay}
          className={`text-[10px] transition-colors ${isPlaying ? "text-red-400" : "text-[#555] hover:text-white"}`}
          title="Play"
        >
          &#9654;
        </button>
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xs truncate text-[#ccc]">{track.trackName}</div>
        <div className="text-[10px] text-[#888] truncate">
          {track.artistNames.split(";")[0]}
        </div>
      </div>
      <span className="text-[10px] text-[#aaa] tabular-nums font-mono w-8 text-right">
        {track.tempo > 0 ? Math.round(track.tempo) : "\u2014"}
      </span>
      <span className="text-[10px] text-[#888] tabular-nums font-mono w-6 text-right">
        {track.key > 0 ? pitchToCamelot(track.key) : "\u2014"}
      </span>
      <span className="text-[10px] text-[#777] w-10 text-right">
        {track.duration || "\u2014"}
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

function ChapterDivider({
  chapter,
  trackCount,
  chapterStats,
  isLast,
  nextSuggestions,
  onChangeType,
  onRemoveChapter,
  onAddChapter,
  onRequestSuggestions,
  suggestingForChapter,
}: {
  chapter: SetlistChapter;
  trackCount: number;
  chapterStats: { avgBpm: number; trackCount: number } | null;
  isLast: boolean;
  nextSuggestions: ChapterType[];
  onChangeType: (type: ChapterType) => void;
  onRemoveChapter: () => void;
  onAddChapter: (type: ChapterType, afterIndex: number) => void;
  onRequestSuggestions: () => void;
  suggestingForChapter: string | null;
}) {
  const [showTypeMenu, setShowTypeMenu] = useState(false);
  const colors = CHAPTER_COLORS[chapter.type];

  return (
    <div className={`border-t border-b ${colors.split(" ")[1]} ${CHAPTER_BG[chapter.type]}`}>
      <div className="px-4 py-1.5 flex items-center gap-2">
        <button
          onClick={() => setShowTypeMenu(!showTypeMenu)}
          className={`text-[10px] font-bold uppercase tracking-[0.15em] ${colors.split(" ")[0]} hover:opacity-80 transition-opacity`}
        >
          {chapter.type}
        </button>
        {chapterStats && (
          <span className="text-[9px] text-[#555] tabular-nums font-mono">
            {chapterStats.trackCount}t &middot; {Math.round(chapterStats.avgBpm)} avg
          </span>
        )}
        <div className="flex-1" />
        <button
          onClick={onRequestSuggestions}
          className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 transition-colors ${
            suggestingForChapter === chapter.id
              ? "text-amber-400 bg-amber-400/10"
              : "text-[#444] hover:text-[#888]"
          }`}
          title="Get 3 track suggestions for next chapter"
        >
          Suggest
        </button>
        <button
          onClick={onRemoveChapter}
          className="text-[#333] hover:text-red-500 transition-colors text-[10px]"
          title="Remove chapter divider"
        >
          &times;
        </button>
      </div>
      {showTypeMenu && (
        <div className="px-4 pb-1.5 flex flex-wrap gap-1">
          {CHAPTER_TYPES.map((type) => (
            <button
              key={type}
              onClick={() => { onChangeType(type); setShowTypeMenu(false); }}
              className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 transition-colors ${
                type === chapter.type
                  ? `${CHAPTER_COLORS[type].split(" ")[0]} bg-white/5`
                  : "text-[#555] hover:text-white"
              }`}
            >
              {type}
            </button>
          ))}
        </div>
      )}
      {isLast && nextSuggestions.length > 0 && trackCount > 0 && (
        <div className="px-4 pb-1.5 flex items-center gap-1">
          <span className="text-[9px] text-[#333] uppercase tracking-wider">next:</span>
          {nextSuggestions.map((type) => (
            <button
              key={type}
              onClick={() => onAddChapter(type, -1)}
              className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 ${CHAPTER_COLORS[type].split(" ")[0]} opacity-50 hover:opacity-100 transition-opacity`}
            >
              + {type}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SuggestionPanel({
  suggestions,
  onAdd,
}: {
  suggestions: Track[];
  onAdd: (track: Track) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <div className="border-t border-amber-400/20 bg-amber-400/5">
      <div className="px-4 py-1 text-[9px] text-amber-400/60 uppercase tracking-wider">
        Suggestions
      </div>
      {suggestions.map((track, i) => (
        <div
          key={`sug-${track.trackName}-${i}`}
          className="px-4 py-1.5 flex items-center gap-2 hover:bg-amber-400/10 transition-colors cursor-pointer border-b border-amber-400/10"
          onClick={() => onAdd(track)}
        >
          <span className="text-[10px] text-amber-400/40 w-4">+</span>
          <div className="flex-1 min-w-0">
            <div className="text-[11px] truncate text-amber-200/80">{track.trackName}</div>
            <div className="text-[10px] text-amber-200/40 truncate">
              {track.artistNames.split(";")[0]}
            </div>
          </div>
          <span className="text-[10px] text-amber-200/50 tabular-nums font-mono">
            {track.tempo > 0 ? Math.round(track.tempo) : ""}
          </span>
          <span className="text-[10px] text-amber-200/30 tabular-nums font-mono">
            {track.key > 0 ? pitchToCamelot(track.key) : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function SetlistPanel({
  tracks,
  setlistName,
  nowPlaying,
  chapters,
  suggestions,
  suggestingForChapter,
  onRemove,
  onReorder,
  onClear,
  onImport,
  onOpen,
  onSave,
  onNew,
  onRename,
  onAutoSort,
  onPlay,
  onChaptersChange,
  onRequestSuggestions,
  onAddSuggestion,
  onToggleSeed,
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

  // Build a map of startIndex -> chapter for rendering
  const chapterAtIndex = useMemo(() => {
    const map = new Map<number, SetlistChapter>();
    for (const ch of chapters) map.set(ch.startIndex, ch);
    return map;
  }, [chapters]);

  // Compute per-chapter stats (tracks in each chapter = from startIndex to next chapter's startIndex)
  const chapterStats = useMemo(() => {
    const stats = new Map<string, { avgBpm: number; trackCount: number }>();
    const sorted = [...chapters].sort((a, b) => a.startIndex - b.startIndex);
    for (let ci = 0; ci < sorted.length; ci++) {
      const ch = sorted[ci];
      const endIndex = ci < sorted.length - 1 ? sorted[ci + 1].startIndex : tracks.length;
      const chTracks = tracks.slice(ch.startIndex, endIndex);
      const bpms = chTracks.map((t) => t.tempo).filter((b) => b > 0);
      stats.set(ch.id, {
        avgBpm: bpms.length > 0 ? bpms.reduce((a, b) => a + b, 0) / bpms.length : 0,
        trackCount: chTracks.length,
      });
    }
    return stats;
  }, [chapters, tracks]);

  // Find which chapter a track belongs to (for seed toggle)
  const trackChapterMap = useMemo(() => {
    const map = new Map<string, string>(); // trackId -> chapterId
    const sorted = [...chapters].sort((a, b) => a.startIndex - b.startIndex);
    for (let ci = 0; ci < sorted.length; ci++) {
      const ch = sorted[ci];
      const endIndex = ci < sorted.length - 1 ? sorted[ci + 1].startIndex : tracks.length;
      for (let i = ch.startIndex; i < endIndex; i++) {
        if (tracks[i]) map.set(tracks[i].id, ch.id);
      }
    }
    return map;
  }, [chapters, tracks]);

  const seedTrackIds = useMemo(() => {
    const set = new Set<string>();
    for (const ch of chapters) {
      for (const id of ch.seedTrackIds) set.add(id);
    }
    return set;
  }, [chapters]);

  const addChapter = useCallback((type: ChapterType, atIndex: number) => {
    const idx = atIndex === -1 ? tracks.length : atIndex;
    const newChapter: SetlistChapter = {
      id: `ch-${Date.now()}`,
      type,
      startIndex: idx,
      seedTrackIds: [],
    };
    onChaptersChange([...chapters, newChapter]);
  }, [chapters, tracks.length, onChaptersChange]);

  const removeChapter = useCallback((chapterId: string) => {
    onChaptersChange(chapters.filter((c) => c.id !== chapterId));
  }, [chapters, onChaptersChange]);

  const changeChapterType = useCallback((chapterId: string, type: ChapterType) => {
    onChaptersChange(chapters.map((c) => c.id === chapterId ? { ...c, type } : c));
  }, [chapters, onChaptersChange]);

  // Find the last chapter to determine next suggestions
  const lastChapter = useMemo(() => {
    if (chapters.length === 0) return null;
    return [...chapters].sort((a, b) => b.startIndex - a.startIndex)[0];
  }, [chapters]);

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
        <div className="text-[10px] text-[#555] uppercase tracking-wider mb-1.5">
          {tracks.length} tracks &middot; {formatTotalDuration(tracks)}
          {bpmStats && (
            <> &middot; <span className="tabular-nums font-mono">{bpmStats.min === bpmStats.max ? bpmStats.min : `${bpmStats.min}\u2013${bpmStats.max}`}</span> BPM (avg {bpmStats.avg})</>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button onClick={onOpen} className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors">Open</button>
          <button onClick={onNew} className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors">New</button>
          <button onClick={onSave} className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors" title="Save to browser">Save</button>
          <button onClick={onImport} className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors">Import</button>
          {onAutoSort && tracks.length >= 3 && (
            <button onClick={onAutoSort} className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors" title="Sort by harmonic flow (BPM + key)">Sort</button>
          )}
          {tracks.length > 0 && (
            <>
              <button onClick={() => exportCSV(tracks, setlistName, chapters)} className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white transition-colors">Export</button>
              <button onClick={onClear} className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] transition-colors">Clear</button>
            </>
          )}
        </div>
        {/* Chapter arc overview */}
        {chapters.length > 0 && (
          <div className="flex gap-1 mt-2">
            {[...chapters].sort((a, b) => a.startIndex - b.startIndex).map((ch) => {
              const stats = chapterStats.get(ch.id);
              return (
                <div
                  key={ch.id}
                  className={`text-[8px] uppercase tracking-wider px-1.5 py-0.5 ${CHAPTER_COLORS[ch.type].split(" ")[0]} ${CHAPTER_BG[ch.type]} rounded-sm`}
                  title={stats ? `${stats.trackCount} tracks, ${Math.round(stats.avgBpm)} avg BPM` : ""}
                >
                  {ch.type.slice(0, 3)}
                  {stats ? ` ${stats.trackCount}` : ""}
                </div>
              );
            })}
          </div>
        )}
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
                const chapter = chapterAtIndex.get(i);
                const chapterId = trackChapterMap.get(track.id);
                const isLastChapter = chapter && lastChapter && chapter.id === lastChapter.id;

                return (
                  <React.Fragment key={track.id}>
                    {chapter && (
                      <ChapterDivider
                        chapter={chapter}
                        trackCount={chapterStats.get(chapter.id)?.trackCount || 0}
                        chapterStats={chapterStats.get(chapter.id) || null}
                        isLast={!!isLastChapter}
                        nextSuggestions={NEXT_CHAPTER_SUGGESTIONS[chapter.type]}
                        onChangeType={(type) => changeChapterType(chapter.id, type)}
                        onRemoveChapter={() => removeChapter(chapter.id)}
                        onAddChapter={addChapter}
                        onRequestSuggestions={() => onRequestSuggestions(chapter.id)}
                        suggestingForChapter={suggestingForChapter}
                      />
                    )}
                    <SortableTrack
                      track={track}
                      index={i}
                      isPlaying={isPlaying}
                      isSeed={seedTrackIds.has(track.id)}
                      onRemove={onRemove}
                      onPlay={onPlay ? () => onPlay(track, i) : undefined}
                      onToggleSeed={chapterId ? () => onToggleSeed(chapterId, track.id) : undefined}
                    />
                    {i < tracks.length - 1 && !chapterAtIndex.has(i + 1) && (
                      <TransitionIndicator track={track} next={tracks[i + 1]} />
                    )}
                  </React.Fragment>
                );
              })}
            </SortableContext>
          </DndContext>

          {/* Suggestion panel at bottom when active */}
          {suggestions.length > 0 && (
            <SuggestionPanel
              suggestions={suggestions}
              onAdd={onAddSuggestion}
            />
          )}

          {/* Next chapter suggestions at bottom of setlist */}
          {lastChapter && tracks.length > 0 && NEXT_CHAPTER_SUGGESTIONS[lastChapter.type].length > 0 && (
            <div className="px-4 py-2 border-t border-[#222] flex items-center gap-1.5">
              <span className="text-[9px] text-[#333] uppercase tracking-wider">Next chapter:</span>
              {NEXT_CHAPTER_SUGGESTIONS[lastChapter.type].map((type) => (
                <button
                  key={type}
                  onClick={() => addChapter(type, tracks.length)}
                  className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 ${CHAPTER_COLORS[type].split(" ")[0]} opacity-50 hover:opacity-100 transition-opacity`}
                >
                  + {type}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
