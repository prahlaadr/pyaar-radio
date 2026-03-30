"use client";

import { useState } from "react";
import type { PlaylistIndexEntry } from "@/lib/types";

interface Props {
  playlists: PlaylistIndexEntry[];
  loading: string | null;
  onSelect: (playlistId: string, title: string) => void;
}

export function PlaylistPicker({ playlists, loading, onSelect }: Props) {
  const [search, setSearch] = useState("");

  const filtered = search
    ? playlists.filter((p) => p.title.toLowerCase().includes(search.toLowerCase()))
    : playlists;

  return (
    <>
      <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a] flex items-center justify-between">
        <span className="text-[10px] text-[#555] uppercase tracking-wider">
          Playlists ({playlists.length})
        </span>
      </div>
      <div className="px-5 py-2 border-b border-[#222]">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search playlists..."
          className="w-full px-2.5 py-1.5 bg-[#111] border border-[#333] text-xs text-[#ccc] focus:outline-none focus:border-red-500 transition-colors"
        />
      </div>
      {filtered.map((p) => (
        <div
          key={p.playlistId}
          className="px-5 py-2.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 cursor-pointer group"
          onClick={() => onSelect(p.playlistId, p.title)}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
              {p.title}
            </div>
          </div>
          {loading === p.playlistId ? (
            <span className="text-[10px] text-amber-500 animate-pulse">Loading...</span>
          ) : (
            <span className="text-[10px] text-[#444] tabular-nums">
              {p.trackCount} tracks
            </span>
          )}
        </div>
      ))}
      {filtered.length === 0 && search && (
        <div className="px-5 py-4 text-center">
          <p className="text-[#444] text-[10px] uppercase tracking-widest">No matches</p>
        </div>
      )}
    </>
  );
}
