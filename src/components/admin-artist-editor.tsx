"use client";

import { useState } from "react";
import type { Artist, PillarName, Zone } from "@/lib/types";
import { PILLARS_V2 } from "@/lib/types";
import { saveOverride, exportOverrides } from "@/lib/artist-overrides";

const ZONES: Zone[] = ["", "ambient", "beats", "soul", "dub", "dnb", "leftfield", "rave", "support"];

interface Props {
  artist: Artist;
  onSaved: () => void; // re-fetch artists so the change reflects everywhere
}

export function AdminArtistEditor({ artist, onSaved }: Props) {
  const [pillars, setPillars] = useState<PillarName[]>(artist.pillars as PillarName[]);
  const [zone, setZone] = useState<Zone>((artist.zone || "") as Zone);
  const [desi, setDesi] = useState<"Desi" | "Non-Desi">(artist.desi);
  const [status, setStatus] = useState<"" | "saving" | "local" | "saved">("");

  const togglePillar = (p: PillarName) =>
    setPillars((cur) => (cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]));

  const dirty =
    JSON.stringify([...pillars].sort()) !== JSON.stringify([...artist.pillars].sort()) ||
    zone !== (artist.zone || "") ||
    desi !== artist.desi;

  const save = async () => {
    setStatus("saving");
    const { persisted } = await saveOverride(artist.artist, { pillars, zone, desi });
    setStatus(persisted ? "saved" : "local");
    onSaved();
  };

  return (
    <div className="mt-3 p-3 border border-amber-700/40 bg-amber-950/20 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-amber-500 font-semibold">Admin · re-label</span>
        <button
          onClick={exportOverrides}
          className="text-[9px] uppercase tracking-wider text-[#888] hover:text-white transition-colors"
          title="Download pending local overrides as a JSON patch to commit"
        >
          Export overrides ↓
        </button>
      </div>

      {/* Pillars */}
      <div className="flex flex-wrap gap-1">
        {PILLARS_V2.map((p) => {
          const on = pillars.includes(p.name);
          return (
            <button
              key={p.name}
              onClick={() => togglePillar(p.name)}
              title={p.desc}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors border"
              style={
                on
                  ? { background: p.color, color: "#111", borderColor: p.color }
                  : { background: "transparent", color: p.color, borderColor: `${p.color}55` }
              }
            >
              {p.name}
            </button>
          );
        })}
      </div>

      {/* Zone + Desi */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={zone}
          onChange={(e) => setZone(e.target.value as Zone)}
          className="bg-[#111] border border-[#333] text-[10px] uppercase tracking-wider text-white px-2 py-0.5"
        >
          {ZONES.map((z) => (
            <option key={z} value={z}>{z || "— no zone —"}</option>
          ))}
        </select>
        <button
          onClick={() => setDesi(desi === "Desi" ? "Non-Desi" : "Desi")}
          className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
            desi === "Desi" ? "bg-red-600 text-white" : "bg-[#111] text-[#888] hover:text-white"
          }`}
        >
          {desi === "Desi" ? "🪷 Desi" : "Non-Desi"}
        </button>

        <button
          onClick={save}
          disabled={!dirty || status === "saving"}
          className="ml-auto px-3 py-0.5 text-[10px] uppercase tracking-wider transition-colors bg-white text-black disabled:opacity-30"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
      </div>

      {status === "saved" && <div className="text-[9px] text-green-500 uppercase tracking-wider">Written to artists.csv ✓ (commit to deploy)</div>}
      {status === "local" && <div className="text-[9px] text-amber-500 uppercase tracking-wider">Saved locally (read-only host) — Export overrides to commit</div>}
    </div>
  );
}
