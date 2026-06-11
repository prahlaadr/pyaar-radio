// Admin re-label override layer.
//
// Edits made in the GUI are stored here as a per-artist patch keyed by artist name.
// They are applied on top of the CSV-derived Artist objects at load time, so they
// take effect instantly and work on the deployed (read-only) site. When running
// locally, edits are ALSO written through to public/data/artists.csv via /api/artists
// so they become permanent, committable changes — see saveOverride().

import type { Artist, PillarName, Zone } from "./types";

const KEY = "pyaar-artist-overrides-v1";

export interface ArtistOverride {
  pillars?: string[];      // __laad pillar names
  zone?: Zone;
  desi?: "Desi" | "Non-Desi";
}

export type OverrideMap = Record<string, ArtistOverride>;

export function loadOverrides(): OverrideMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function writeOverrides(map: OverrideMap) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(map));
}

/** Merge a single override into the store and persist locally (instant). */
export function setLocalOverride(artist: string, patch: ArtistOverride): OverrideMap {
  const map = loadOverrides();
  map[artist] = { ...map[artist], ...patch };
  writeOverrides(map);
  return map;
}

export function clearOverride(artist: string): OverrideMap {
  const map = loadOverrides();
  delete map[artist];
  writeOverrides(map);
  return map;
}

/** Apply the override layer over a list of artists. */
export function applyOverrides(artists: Artist[], map: OverrideMap): Artist[] {
  if (!map || Object.keys(map).length === 0) return artists;
  return artists.map((a) => {
    const o = map[a.artist];
    if (!o) return a;
    return {
      ...a,
      ...(o.pillars ? { pillars: o.pillars } : {}),
      ...(o.zone !== undefined ? { zone: o.zone } : {}),
      ...(o.desi ? { desi: o.desi } : {}),
    };
  });
}

/**
 * Persist an edit: write through to artists.csv (local dev) AND keep a localStorage
 * copy so the change survives on deployed/prod where the filesystem is read-only.
 * Returns { persisted: true } when the server write succeeded.
 */
export async function saveOverride(
  artist: string,
  patch: { pillars?: PillarName[]; zone?: Zone; desi?: "Desi" | "Non-Desi" },
): Promise<{ persisted: boolean }> {
  setLocalOverride(artist, patch);
  try {
    const res = await fetch("/api/artists", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ artist, ...patch }),
    });
    if (res.ok) {
      // Keep the localStorage echo: DuckDB loaded artists.csv into memory at startup,
      // so an in-session re-fetch won't see the file write. The echo keeps the UI
      // consistent until a full reload re-imports the (now-updated) CSV. Identical
      // values then, so it's harmless. Use Export/clear if you need to reset.
      return { persisted: true };
    }
  } catch {
    /* read-only host (Vercel) — localStorage override remains the source */
  }
  return { persisted: false };
}

/** Download all pending local overrides as a JSON patch to commit. */
export function exportOverrides() {
  const map = loadOverrides();
  const blob = new Blob([JSON.stringify(map, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pyaar-artist-overrides-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}
