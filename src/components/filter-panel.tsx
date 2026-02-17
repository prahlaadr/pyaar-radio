import { useState } from "react";
import type { ArtistFilters } from "@/lib/types";

const CHANNELS = ["Rave", "Rap", "Soul"] as const;
const SAMAY = ["Day", "Night", "Day/Night"] as const;
const VIBES = [
  "Groove", "Soulful", "Rowdy", "Nodders", "Rave", "Psych",
  "Bass", "Percussive", "Club", "Future Beats", "Pop", "Lo-Fi", "Dark", "Global",
  "Trap", "Boom Bap", "UKG",
] as const;

interface Props {
  filters: ArtistFilters;
  onChange: (filters: ArtistFilters) => void;
  artistCount?: number;
}

export function FilterPanel({ filters, onChange, artistCount }: Props) {
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
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className="flex-1 px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider placeholder-[#666] focus:outline-none focus:border-red-500 transition-colors"
        />
        <button
          onClick={() => setExpanded(!expanded)}
          className="md:hidden px-2 py-1.5 bg-[#111] border border-[#333] text-[10px] uppercase tracking-wider text-[#888] hover:text-white transition-colors shrink-0"
        >
          Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}
        </button>
      </div>

      {/* Filter body — always visible on desktop, toggle on mobile */}
      <div className={`space-y-3 ${expanded ? "" : "hidden md:block"}`}>
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

        {/* Samay + Desi */}
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

        {/* BPM Range */}
        <div className="flex items-center gap-2 text-[10px] text-[#888] uppercase tracking-wider">
          <span>BPM</span>
          <input
            type="text"
            inputMode="numeric"
            value={filters.bpmMin || ""}
            onChange={(e) => onChange({ ...filters, bpmMin: Number(e.target.value.replace(/\D/g, "")) || 0 })}
            placeholder="min"
            className="w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white appearance-none"
          />
          <span>&mdash;</span>
          <input
            type="text"
            inputMode="numeric"
            value={filters.bpmMax < 300 ? filters.bpmMax : ""}
            onChange={(e) => onChange({ ...filters, bpmMax: Number(e.target.value.replace(/\D/g, "")) || 300 })}
            placeholder="max"
            className="w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white appearance-none"
          />
          {(filters.bpmMin > 0 || filters.bpmMax < 300) && (
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

        {/* Artist count */}
        {artistCount !== undefined && (
          <div className="text-[10px] text-[#666] uppercase tracking-wider">
            {artistCount} artist{artistCount !== 1 ? "s" : ""}
          </div>
        )}
      </div>
    </div>
  );
}
