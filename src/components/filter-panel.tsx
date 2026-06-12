import { useState } from "react";
import type { ArtistFilters } from "@/lib/types";

const SAMAY = ["Day", "Night", "Day/Night"] as const;

// Genre = primary filter (energy-ish order, chill → hype). Backed by the `vibes`
// column; every artist now has at least one genre (see scripts/backfill_genre.py).
const GENRES = [
  "Ambient", "Soul", "Future Beats", "Boom Bap", "Electronica", "Club", "Garage",
  "Afro", "Bass", "Dub", "Dubstep", "DnB", "Rave", "Trap", "Pop",
] as const;

// Mood = secondary "feel" tags.
const MOODS = ["Groove", "Soulful", "Rowdy", "Nodders", "Dark", "Percussive"] as const;

export type SectionMode = "browse" | "tamil" | "downtempo" | "ambient" | "tv";

interface Props {
  filters: ArtistFilters;
  onChange: (filters: ArtistFilters) => void;
  artistCount?: number;
  tamilMode?: boolean;
  onTamilToggle?: () => void;
  tamilSearch?: string;
  onTamilSearchChange?: (search: string) => void;
  tamilBpmMin?: number;
  tamilBpmMax?: number;
  onTamilBpmChange?: (min: number, max: number) => void;
  tamilTrackCount?: number;
  sectionMode?: SectionMode;
  onSectionToggle?: (section: SectionMode) => void;
  sectionSearch?: string;
  onSectionSearchChange?: (search: string) => void;
  sectionBpmMin?: number;
  sectionBpmMax?: number;
  onSectionBpmChange?: (min: number, max: number) => void;
  sectionTrackCount?: number;
  sectionDesi?: string;
  onSectionDesiChange?: (v: string) => void;
  ilaiyaraajaMode?: boolean;
  onIlaiyaraajaToggle?: () => void;
  onBackToTamil?: () => void;
  ilaiyaraajaSearch?: string;
  onIlaiyaraajaSearchChange?: (search: string) => void;
  ilaiyaraajaTrackCount?: number;
  hidden?: boolean;
}

const SECTION_STYLES: Record<string, { hover: string; active: string; text: string; border: string }> = {
  tamil: { hover: "hover:text-amber-400", active: "bg-amber-600 text-white", text: "text-amber-400", border: "focus:border-amber-500" },
  downtempo: { hover: "hover:text-cyan-400", active: "bg-cyan-600 text-white", text: "text-cyan-400", border: "focus:border-cyan-500" },
  ambient: { hover: "hover:text-purple-400", active: "bg-purple-600 text-white", text: "text-purple-400", border: "focus:border-purple-500" },
  ilaiyaraaja: { hover: "hover:text-red-400", active: "bg-red-600 text-white", text: "text-red-400", border: "focus:border-red-500" },
};

export function FilterPanel({
  filters, onChange, artistCount,
  tamilMode, onTamilToggle,
  tamilSearch, onTamilSearchChange,
  tamilBpmMin = 0, tamilBpmMax = 300, onTamilBpmChange,
  tamilTrackCount,
  sectionMode = "browse", onSectionToggle,
  sectionSearch, onSectionSearchChange,
  sectionBpmMin = 0, sectionBpmMax = 300, onSectionBpmChange,
  sectionTrackCount,
  sectionDesi, onSectionDesiChange,
  ilaiyaraajaMode, onIlaiyaraajaToggle, onBackToTamil,
  ilaiyaraajaSearch, onIlaiyaraajaSearchChange,
  ilaiyaraajaTrackCount,
  hidden,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const toggle = (key: keyof ArtistFilters, value: string) => {
    if (key === "channels") {
      const channels = filters.channels.includes(value)
        ? filters.channels.filter((c) => c !== value)
        : [...filters.channels, value];
      onChange({ ...filters, channels });
    } else if (key === "vibes") {
      const vibes = filters.vibes.includes(value)
        ? filters.vibes.filter((v) => v !== value)
        : [...filters.vibes, value];
      onChange({ ...filters, vibes });
    } else if (key === "pillars") {
      const cur = filters.pillars || [];
      const pillars = cur.includes(value)
        ? cur.filter((p) => p !== value)
        : [...cur, value];
      onChange({ ...filters, pillars });
    } else if (key === "samay") {
      onChange({ ...filters, samay: filters.samay === value ? null : value });
    } else if (key === "desi") {
      onChange({ ...filters, desi: filters.desi === value ? null : value });
    }
  };

  const activeFilterCount =
    (filters.pillars?.length || 0) +
    filters.channels.length +
    filters.vibes.length +
    (filters.samay ? 1 : 0) +
    (filters.desi ? 1 : 0) +
    (filters.bpmMin > 0 ? 1 : 0) +
    (filters.bpmMax < 300 ? 1 : 0);

  // TV mode and artist detail hide the filter panel entirely
  if (sectionMode === "tv" || hidden) return null;

  return (
    <div className="px-5 py-3 border-b border-[#222] space-y-3">
      {/* Search — always visible */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="SEARCH..."
          value={
            ilaiyaraajaMode ? (ilaiyaraajaSearch ?? "") :
            tamilMode ? (tamilSearch ?? "") :
            (sectionMode === "downtempo" || sectionMode === "ambient") ? (sectionSearch ?? "") :
            filters.search
          }
          onChange={(e) => {
            if (ilaiyaraajaMode && onIlaiyaraajaSearchChange) {
              onIlaiyaraajaSearchChange(e.target.value);
            } else if (tamilMode && onTamilSearchChange) {
              onTamilSearchChange(e.target.value);
            } else if ((sectionMode === "downtempo" || sectionMode === "ambient") && onSectionSearchChange) {
              onSectionSearchChange(e.target.value);
            } else {
              onChange({ ...filters, search: e.target.value });
            }
          }}
          className={`flex-1 px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider placeholder-[#999] focus:outline-none transition-colors ${
            ilaiyaraajaMode ? "focus:border-red-500" :
            tamilMode ? "focus:border-amber-500" :
            sectionMode === "downtempo" ? "focus:border-cyan-500" :
            sectionMode === "ambient" ? "focus:border-purple-500" :
            "focus:border-red-500"
          }`}
        />
        {!tamilMode && !ilaiyaraajaMode && sectionMode === "browse" && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="md:hidden px-2 py-1.5 bg-[#111] border border-[#333] text-[10px] uppercase tracking-wider text-[#999] hover:text-white transition-colors shrink-0"
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        )}
      </div>

      {/* Filter body — always visible on desktop, toggle on mobile */}
      <div className={`space-y-3 ${(ilaiyaraajaMode || tamilMode || sectionMode !== "browse") ? "" : expanded ? "" : "hidden md:block"}`}>
        {!tamilMode && !ilaiyaraajaMode && sectionMode === "browse" && (
          <>
            {/* Genre — primary filter */}
            <div className="flex gap-1 flex-wrap">
              {GENRES.map((v) => (
                <button
                  key={v}
                  onClick={() => toggle("vibes", v)}
                  className={`px-2.5 py-1 text-[11px] uppercase tracking-wider font-medium transition-colors ${
                    filters.vibes.includes(v)
                      ? "bg-red-600 text-white"
                      : "bg-[#111] text-[#bbb] hover:text-white"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Mood — secondary */}
            <div className="flex gap-1 flex-wrap">
              {MOODS.map((v) => (
                <button
                  key={v}
                  onClick={() => toggle("vibes", v)}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    filters.vibes.includes(v)
                      ? "bg-red-600 text-white"
                      : "bg-[#0a0a0a] text-[#999] hover:text-[#ccc]"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>

            {/* Desi (prominent) + Samay + Tamil/Downtempo/Ambient */}
            <div className="flex gap-1 flex-wrap items-center">
              <button
                onClick={() => toggle("desi", "Desi")}
                className={`px-2.5 py-0.5 text-[11px] uppercase tracking-wider font-medium transition-colors border ${
                  filters.desi === "Desi"
                    ? "bg-red-600 text-white border-red-600"
                    : "bg-[#111] text-[#bbb] border-[#444] hover:text-white"
                }`}
              >
                🪷 Desi
              </button>
              <div className="w-px bg-[#333] mx-1" />
              {SAMAY.map((s) => (
                <button
                  key={s}
                  onClick={() => toggle("samay", s)}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    filters.samay === s
                      ? "bg-white text-black"
                      : "bg-[#111] text-[#999] hover:text-white"
                  }`}
                >
                  {s}
                </button>
              ))}
              <div className="w-px bg-[#333] mx-1" />
              {onTamilToggle && (
                <button
                  onClick={onTamilToggle}
                  className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-[#111] text-[#999] hover:text-amber-400"
                >
                  Tamil
                </button>
              )}
              {onSectionToggle && (
                <button
                  onClick={() => onSectionToggle("ambient")}
                  className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-[#111] text-[#999] hover:text-purple-400"
                >
                  Ambient
                </button>
              )}
            </div>
          </>
        )}

        {/* Ilaiyaraaja mode header */}
        {ilaiyaraajaMode && onBackToTamil && (
          <div className="flex gap-1 flex-wrap items-center">
            <button
              onClick={onBackToTamil}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-red-600 text-white"
            >
              Ilaiyaraaja
            </button>
            <span
              className="text-[10px] text-[#999] uppercase tracking-wider ml-1 cursor-pointer hover:text-white transition-colors"
              onClick={onBackToTamil}
            >
              &larr; back to tamil
            </span>
          </div>
        )}

        {/* Tamil mode header */}
        {tamilMode && !ilaiyaraajaMode && onTamilToggle && (
          <div className="flex gap-1 flex-wrap items-center">
            <button
              onClick={onTamilToggle}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-amber-600 text-white"
            >
              Tamil
            </button>
            <span className="text-[10px] text-[#999] uppercase tracking-wider ml-1 cursor-pointer hover:text-white transition-colors" onClick={onTamilToggle}>
              &larr; back to all
            </span>
            {onIlaiyaraajaToggle && (
              <>
                <div className="w-px bg-[#333] mx-1" />
                <button
                  onClick={onIlaiyaraajaToggle}
                  className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-[#111] text-[#999] hover:text-red-400"
                >
                  Ilaiyaraaja
                </button>
              </>
            )}
          </div>
        )}

        {/* Section mode header (Downtempo / Ambient) */}
        {(sectionMode === "downtempo" || sectionMode === "ambient") && onSectionToggle && (
          <div className="flex gap-1 flex-wrap items-center">
            <button
              onClick={() => onSectionToggle("browse")}
              className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${SECTION_STYLES[sectionMode].active}`}
            >
              {sectionMode}
            </button>
            <span className="text-[10px] text-[#999] uppercase tracking-wider ml-1 cursor-pointer hover:text-white transition-colors" onClick={() => onSectionToggle("browse")}>
              &larr; back to all
            </span>
            {onSectionDesiChange && (
              <>
                <div className="w-px bg-[#333] mx-1" />
                <button
                  onClick={() => onSectionDesiChange(sectionDesi === "Desi" ? "" : "Desi")}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    sectionDesi === "Desi"
                      ? "bg-red-600 text-white"
                      : "bg-[#111] text-[#999] hover:text-white"
                  }`}
                >
                  Desi
                </button>
              </>
            )}
          </div>
        )}

        {/* BPM Range — shown in all modes except Ilaiyaraaja */}
        {!ilaiyaraajaMode && <div className="flex items-center gap-2 text-[10px] text-[#999] uppercase tracking-wider">
          <span>BPM</span>
          <input
            type="text"
            inputMode="numeric"
            value={
              tamilMode ? (tamilBpmMin || "") :
              (sectionMode === "downtempo" || sectionMode === "ambient") ? (sectionBpmMin || "") :
              (filters.bpmMin || "")
            }
            onChange={(e) => {
              const val = Number(e.target.value.replace(/\D/g, "")) || 0;
              if (tamilMode && onTamilBpmChange) {
                onTamilBpmChange(val, tamilBpmMax);
              } else if ((sectionMode === "downtempo" || sectionMode === "ambient") && onSectionBpmChange) {
                onSectionBpmChange(val, sectionBpmMax);
              } else {
                onChange({ ...filters, bpmMin: val });
              }
            }}
            placeholder="min"
            className="w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white appearance-none"
          />
          <span>&mdash;</span>
          <input
            type="text"
            inputMode="numeric"
            value={
              tamilMode ? (tamilBpmMax < 300 ? tamilBpmMax : "") :
              (sectionMode === "downtempo" || sectionMode === "ambient") ? (sectionBpmMax < 300 ? sectionBpmMax : "") :
              (filters.bpmMax < 300 ? filters.bpmMax : "")
            }
            onChange={(e) => {
              const val = Number(e.target.value.replace(/\D/g, "")) || 300;
              if (tamilMode && onTamilBpmChange) {
                onTamilBpmChange(tamilBpmMin, val);
              } else if ((sectionMode === "downtempo" || sectionMode === "ambient") && onSectionBpmChange) {
                onSectionBpmChange(sectionBpmMin, val);
              } else {
                onChange({ ...filters, bpmMax: val });
              }
            }}
            placeholder="max"
            className="w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white appearance-none"
          />
          {!tamilMode && sectionMode === "browse" && (filters.bpmMin > 0 || filters.bpmMax < 300) && (
            <button
              onClick={() => onChange({ ...filters, halfTime: !filters.halfTime })}
              className={`px-2 py-0.5 transition-colors ${
                filters.halfTime
                  ? "bg-red-600 text-white"
                  : "bg-[#111] text-[#999] hover:text-white"
              }`}
              title="Also match double/half BPM (e.g. 70 ↔ 140)"
            >
              &times;2
            </button>
          )}
        </div>}
      </div>

      {/* Count — always visible */}
      {ilaiyaraajaMode ? (
        ilaiyaraajaTrackCount !== undefined && (
          <div className="text-[10px] text-[#999] uppercase tracking-wider">
            {ilaiyaraajaTrackCount} track{ilaiyaraajaTrackCount !== 1 ? "s" : ""}
          </div>
        )
      ) : tamilMode ? (
        tamilTrackCount !== undefined && (
          <div className="text-[10px] text-[#999] uppercase tracking-wider">
            {tamilTrackCount} track{tamilTrackCount !== 1 ? "s" : ""}
          </div>
        )
      ) : (sectionMode === "downtempo" || sectionMode === "ambient") ? (
        sectionTrackCount !== undefined && (
          <div className="text-[10px] text-[#999] uppercase tracking-wider">
            {sectionTrackCount} track{sectionTrackCount !== 1 ? "s" : ""}
          </div>
        )
      ) : (
        artistCount !== undefined && (
          <div className="text-[10px] text-[#999] uppercase tracking-wider">
            {artistCount} artist{artistCount !== 1 ? "s" : ""}
          </div>
        )
      )}
    </div>
  );
}
