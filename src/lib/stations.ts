// Stations = derived views, not an artist property.
//
// In the old model "channel" (Rave/Rap/Soul) was stored per-artist and overlapped
// with pillars. A station is really just a saved filter over the __laad spine + desi.
// Defining them here makes each station a single source of truth the UI can apply.

import type { ArtistFilters } from "./types";

export interface Station {
  name: string;
  color: string; // hex, for the chip
  desc: string;
  filters: Partial<ArtistFilters>;
}

export const STATIONS: Station[] = [
  // The three legacy channels, re-expressed as pillar slices.
  { name: "Soul",  color: "#9B72CF", desc: "Mellow → soulful (Soullaad)",          filters: { pillars: ["Soullaad"] } },
  { name: "Rave",  color: "#E05252", desc: "Club → bass → rave (Hypelaad+Rowdylaad)", filters: { pillars: ["Hypelaad", "Rowdylaad"] } },
  { name: "Rap",   color: "#E08A52", desc: "Underground + crowd rap (Traplaad+Crowdlaad)", filters: { pillars: ["Traplaad", "Crowdlaad"] } },
  // Set-shaped presets that cut across the spine.
  { name: "Daybreaker", color: "#E2C044", desc: "Desi, daytime, mellow → uptempo", filters: { pillars: ["Soullaad", "Hypelaad"], desi: "Desi", samay: "Day" } },
  { name: "Percussive", color: "#C4835A", desc: "Global percussive floor (Perclaad)", filters: { pillars: ["Perclaad"] } },
];

/** Whether the active filters exactly match a station's filter set (for highlight). */
export function isStationActive(s: Station, f: ArtistFilters): boolean {
  const sp = [...(s.filters.pillars ?? [])].sort();
  const fp = [...(f.pillars ?? [])].sort();
  const pillarsMatch = sp.length === fp.length && sp.every((p, i) => p === fp[i]);
  const desiMatch = (s.filters.desi ?? null) === (f.desi ?? null);
  const samayMatch = (s.filters.samay ?? null) === (f.samay ?? null);
  return pillarsMatch && desiMatch && samayMatch;
}
