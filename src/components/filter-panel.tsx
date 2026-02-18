import { useState } from "react";
import type { ArtistFilters } from "@/lib/types";

const CHANNELS = ["Rave", "Rap", "Soul"] as const;
const SAMAY = ["Day", "Night", "Day/Night"] as const;
const VIBES = [
  "Groove", "Soulful", "Rowdy", "Nodders", "Rave", "Psych",
  "Bass", "Percussive", "Club", "Future Beats", "Pop", "Dark",
  "Trap", "Boom Bap", "UKG",
] as const;

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
}

export function FilterPanel({
  filters, onChange, artistCount,
  tamilMode, onTamilToggle,
  tamilSearch, onTamilSearchChange,
  tamilBpmMin = 0, tamilBpmMax = 300, onTamilBpmChange,
  tamilTrackCount,
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
    } else if (key === "samay") {
      onChange({ ...filters, samay: filters.samay === value ? null : value });
    } else if (key === "desi") {
      onChange({ ...filters, desi: filters.desi === value ? null : value });
    }
  };

  const activeFilterCount =
    filters.channels.length +
    filters.vibes.length +
    (filters.samay ? 1 : 0) +
    (filters.desi ? 1 : 0) +
    (filters.bpmMin > 0 ? 1 : 0) +
    (filters.bpmMax < 300 ? 1 : 0);

  return (
    <div className="px-5 py-3 border-b border-[#222] space-y-3">
      {/* Search — always visible */}
      <div className="flex gap-2 items-center">
        <input
          type="text"
          placeholder="SEARCH..."
          value={tamilMode ? (tamilSearch ?? "") : filters.search}
          onChange={(e) => {
            if (tamilMode && onTamilSearchChange) {
              onTamilSearchChange(e.target.value);
            } else {
              onChange({ ...filters, search: e.target.value });
            }
          }}
          className={`flex-1 px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider placeholder-[#666] focus:outline-none transition-colors ${
            tamilMode ? "focus:border-amber-500" : "focus:border-red-500"
          }`}
        />
        {!tamilMode && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="md:hidden px-2 py-1.5 bg-[#111] border border-[#333] text-[10px] uppercase tracking-wider text-[#888] hover:text-white transition-colors shrink-0"
          >
            Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
          </button>
        )}
      </div>

      {/* Filter body — always visible on desktop, toggle on mobile */}
      <div className={`space-y-3 ${tamilMode ? "" : expanded ? "" : "hidden md:block"}`}>
        {!tamilMode && (
          <>
            {/* Channels */}
            <div className="flex gap-1">
              {CHANNELS.map((ch) => (
                <button
                  key={ch}
                  onClick={() => toggle("channels", ch)}
                  className={`px-3 py-1 text-xs uppercase tracking-wider font-medium transition-colors ${
                    filters.channels.includes(ch)
                      ? "bg-white text-black"
                      : "bg-[#111] text-[#888] hover:text-white"
                  }`}
                >
                  {ch}
                </button>
              ))}
            </div>

            {/* Samay + Desi + Tamil */}
            <div className="flex gap-1 flex-wrap">
              {SAMAY.map((s) => (
                <button
                  key={s}
                  onClick={() => toggle("samay", s)}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    filters.samay === s
                      ? "bg-white text-black"
                      : "bg-[#111] text-[#888] hover:text-white"
                  }`}
                >
                  {s}
                </button>
              ))}
              <div className="w-px bg-[#333] mx-1" />
              <button
                onClick={() => toggle("desi", "Desi")}
                className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                  filters.desi === "Desi"
                    ? "bg-red-600 text-white"
                    : "bg-[#111] text-[#888] hover:text-white"
                }`}
              >
                Desi
              </button>
              <div className="w-px bg-[#333] mx-1" />
              {onTamilToggle && (
                <button
                  onClick={onTamilToggle}
                  className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-[#111] text-[#888] hover:text-amber-400"
                >
                  Tamil
                </button>
              )}
            </div>

            {/* Vibes */}
            <div className="flex gap-1 flex-wrap">
              {VIBES.map((v) => (
                <button
                  key={v}
                  onClick={() => toggle("vibes", v)}
                  className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
                    filters.vibes.includes(v)
                      ? "bg-red-600 text-white"
                      : "bg-[#0a0a0a] text-[#777] hover:text-[#bbb]"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Tamil mode header */}
        {tamilMode && onTamilToggle && (
          <div className="flex gap-1 flex-wrap items-center">
            <button
              onClick={onTamilToggle}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-amber-600 text-white"
            >
              Tamil
            </button>
            <span className="text-[10px] text-[#555] uppercase tracking-wider ml-1">
              &larr; back to vault
            </span>
          </div>
        )}

        {/* BPM Range — shown in both modes */}
        <div className="flex items-center gap-2 text-[10px] text-[#888] uppercase tracking-wider">
          <span>BPM</span>
          <input
            type="text"
            inputMode="numeric"
            value={tamilMode ? (tamilBpmMin || "") : (filters.bpmMin || "")}
            onChange={(e) => {
              const val = Number(e.target.value.replace(/\D/g, "")) || 0;
              if (tamilMode && onTamilBpmChange) {
                onTamilBpmChange(val, tamilBpmMax);
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
            value={tamilMode ? (tamilBpmMax < 300 ? tamilBpmMax : "") : (filters.bpmMax < 300 ? filters.bpmMax : "")}
            onChange={(e) => {
              const val = Number(e.target.value.replace(/\D/g, "")) || 300;
              if (tamilMode && onTamilBpmChange) {
                onTamilBpmChange(tamilBpmMin, val);
              } else {
                onChange({ ...filters, bpmMax: val });
              }
            }}
            placeholder="max"
            className="w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white appearance-none"
          />
          {!tamilMode && (filters.bpmMin > 0 || filters.bpmMax < 300) && (
            <button
              onClick={() => onChange({ ...filters, halfTime: !filters.halfTime })}
              className={`px-2 py-0.5 transition-colors ${
                filters.halfTime
                  ? "bg-red-600 text-white"
                  : "bg-[#111] text-[#888] hover:text-white"
              }`}
              title="Also match double/half BPM (e.g. 70 ↔ 140)"
            >
              &times;2
            </button>
          )}
        </div>
      </div>

      {/* Count — always visible */}
      {tamilMode ? (
        tamilTrackCount !== undefined && (
          <div className="text-[10px] text-amber-600/70 uppercase tracking-wider">
            {tamilTrackCount} track{tamilTrackCount !== 1 ? "s" : ""}
          </div>
        )
      ) : (
        artistCount !== undefined && (
          <div className="text-[10px] text-[#666] uppercase tracking-wider">
            {artistCount} artist{artistCount !== 1 ? "s" : ""}
          </div>
        )
      )}
    </div>
  );
}
