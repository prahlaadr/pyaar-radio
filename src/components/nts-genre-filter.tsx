"use client";

import { useState } from "react";
import { NTS_GENRES, NTS_SUBGENRES } from "@/lib/nts-genre-map";

// NTS genre-ontology filter (mirrors nts.live/explore/genre): top-genre chips that
// drill into the library's covered subgenres via a chevron. Shared by the browse
// filter panel and the Liked tab so both filter identically.
export function NtsGenreFilter({ genres, subgenres, onToggleGenre, onToggleSub }: {
  genres: string[];
  subgenres: string[];
  onToggleGenre: (g: string) => void;
  onToggleSub: (s: string) => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggleExpand = (t: string) =>
    setExpanded((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1 flex-wrap items-center">
        <span className="text-[9px] uppercase tracking-wider text-[#e32636] font-bold mr-0.5">NTS</span>
        {NTS_GENRES.map((top) => {
          const subs = NTS_SUBGENRES[top] || [];
          const sel = genres.includes(top);
          const exp = expanded.includes(top);
          return (
            <span key={top} className="inline-flex items-stretch">
              <button
                onClick={() => onToggleGenre(top)}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                  sel ? "bg-[#e32636] text-white" : "bg-[#0a0a0a] text-[#999] hover:text-[#ccc]"
                }`}
              >
                {top}
              </button>
              {subs.length > 0 && (
                <button
                  onClick={() => toggleExpand(top)}
                  aria-label={`${exp ? "Collapse" : "Expand"} ${top} subgenres`}
                  className={`px-1 text-[9px] border-l border-black/30 transition-colors ${
                    sel ? "bg-[#e32636] text-white" : "bg-[#0a0a0a] text-[#777] hover:text-white"
                  }`}
                >
                  {exp ? "▴" : "▾"}
                </button>
              )}
            </span>
          );
        })}
      </div>

      {NTS_GENRES.filter((t) => expanded.includes(t) && (NTS_SUBGENRES[t] || []).length > 0).map((top) => (
        <div key={top} className="flex gap-1 flex-wrap items-center pl-2 ml-1 border-l border-[#333]">
          <span className="text-[8px] uppercase tracking-wider text-[#666] mr-1">{top}</span>
          {(NTS_SUBGENRES[top] || []).map((sub) => (
            <button
              key={sub}
              onClick={() => onToggleSub(sub)}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                subgenres.includes(sub)
                  ? "bg-[#e32636] text-white"
                  : "bg-[#111] text-[#999] hover:text-[#ccc]"
              }`}
            >
              {sub}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
