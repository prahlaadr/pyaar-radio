"use client";

import { useState } from "react";
import { NTS_GENRES, NTS_SUBGENRES, NTS_GENRE_TOKENS, NTS_SUBGENRE_TOKENS, NTS_TOKEN_TO_TOP } from "@/lib/nts-genre-map";

// Reverse maps: a raw Genres token → its NTS top-genre / subgenre display name.
// Covers both album tokens (already NTS names, via NTS_TOKEN_TO_TOP) and the
// library's free-text tokens (via the generated NTS_GENRE/SUBGENRE_TOKENS).
const TOKEN_TOP: Record<string, string> = { ...NTS_TOKEN_TO_TOP };
for (const [top, toks] of Object.entries(NTS_GENRE_TOKENS)) for (const t of toks) if (!TOKEN_TOP[t]) TOKEN_TOP[t] = top;
const TOKEN_SUB: Record<string, string> = {};
for (const [sub, toks] of Object.entries(NTS_SUBGENRE_TOKENS)) for (const t of toks) if (!TOKEN_SUB[t]) TOKEN_SUB[t] = sub;

// Which NTS facets (top genres + subgenres) are present across a set of items'
// genre tokens. Keys: "T:<top>" and "S:<subDisplay>". Used to grey out filter
// chips that would yield zero results given the current selection (faceted).
export function availableFacets(itemGenres: string[][]): Set<string> {
  const set = new Set<string>();
  for (const genres of itemGenres) for (const raw of genres) {
    const t = raw.trim().toLowerCase();
    const top = TOKEN_TOP[t];
    if (top) set.add("T:" + top);
    const sub = TOKEN_SUB[t];
    if (sub) set.add("S:" + sub);
  }
  return set;
}

// NTS genre-ontology filter (mirrors nts.live/explore/genre): top-genre chips that
// drill into the library's covered subgenres via a chevron. Shared by the browse
// filter panel, the Liked tab, and the Albums page. When `available` is provided,
// chips not present in the current (already-filtered) result set are greyed out.
export function NtsGenreFilter({ genres, subgenres, onToggleGenre, onToggleSub, available }: {
  genres: string[];
  subgenres: string[];
  onToggleGenre: (g: string) => void;
  onToggleSub: (s: string) => void;
  available?: Set<string>;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const toggleExpand = (t: string) =>
    setExpanded((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const topActive = (top: string) => !available || genres.includes(top) || available.has("T:" + top);
  const subActive = (sub: string) => !available || subgenres.includes(sub) || available.has("S:" + sub);

  return (
    <div className="space-y-1.5">
      <div className="flex gap-1 flex-wrap items-center">
        <span className="text-[9px] uppercase tracking-wider text-[#e32636] font-bold mr-0.5">NTS</span>
        {NTS_GENRES.map((top) => {
          const subs = NTS_SUBGENRES[top] || [];
          const sel = genres.includes(top);
          const exp = expanded.includes(top);
          const on = topActive(top);
          return (
            <span key={top} className={`inline-flex items-stretch ${on ? "" : "opacity-30"}`}>
              <button
                onClick={() => on && onToggleGenre(top)}
                disabled={!on}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                  sel ? "bg-[#e32636] text-white" : on ? "bg-[#0a0a0a] text-[#999] hover:text-[#ccc]" : "bg-[#0a0a0a] text-[#666] cursor-not-allowed"
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
          {(NTS_SUBGENRES[top] || []).map((sub) => {
            const sel = subgenres.includes(sub);
            const on = subActive(sub);
            return (
              <button
                key={sub}
                onClick={() => on && onToggleSub(sub)}
                disabled={!on}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                  sel ? "bg-[#e32636] text-white" : on ? "bg-[#111] text-[#999] hover:text-[#ccc]" : "bg-[#111] text-[#555] opacity-40 cursor-not-allowed"
                }`}
              >
                {sub}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
