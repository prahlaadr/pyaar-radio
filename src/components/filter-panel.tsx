import type { ArtistFilters } from "@/lib/types";

const CHANNELS = ["Rave", "Rap", "Soul"] as const;
const SAMAY = ["Day", "Night", "Day/Night"] as const;
const VIBES = [
  "Groove", "Soulful", "Rowdy", "Nodders", "Rave", "Psych",
  "Bass", "Percussive", "Club", "Future Beats", "Pop", "Lo-Fi", "Dark", "Global",
] as const;

interface Props {
  filters: ArtistFilters;
  onChange: (filters: ArtistFilters) => void;
  artistCount?: number;
}

export function FilterPanel({ filters, onChange, artistCount }: Props) {
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

  return (
    <div className="px-5 py-3 border-b border-[#222] space-y-3">
      {/* Search */}
      <input
        type="text"
        placeholder="SEARCH..."
        value={filters.search}
        onChange={(e) => onChange({ ...filters, search: e.target.value })}
        className="w-full px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider placeholder-[#666] focus:outline-none focus:border-red-500 transition-colors"
      />

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
          type="number"
          value={filters.bpmMin || ""}
          onChange={(e) => onChange({ ...filters, bpmMin: Number(e.target.value) || 0 })}
          placeholder="min"
          className="w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white"
        />
        <span>&mdash;</span>
        <input
          type="number"
          value={filters.bpmMax < 300 ? filters.bpmMax : ""}
          onChange={(e) => onChange({ ...filters, bpmMax: Number(e.target.value) || 300 })}
          placeholder="max"
          className="w-14 px-2 py-0.5 bg-[#111] border border-[#333] text-xs text-white"
        />
      </div>

      {/* Artist count */}
      {artistCount !== undefined && (
        <div className="text-[10px] text-[#666] uppercase tracking-wider">
          {artistCount} artist{artistCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
