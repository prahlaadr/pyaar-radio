"use client";

import { useState, useMemo } from "react";
import type { PlaylistIndexEntry } from "@/lib/types";

interface Props {
  playlists: PlaylistIndexEntry[];
  loading: string | null;
  onSelect: (playlistId: string, title: string) => void;
}

// Match month/year archive playlists and extract a sortable date
const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  // Creative spellings
  mirch: 3, feeb: 2, febyouary: 2, jooli: 7, joon: 6, apreel: 4, aprul: 4,
  agust: 8, ock: 10, okt: 10, simptember: 9, decembrrr: 12, novemburr: 11,
  mai: 5, juun: 6, deck: 12, murch: 3, march: 3, june: 6, july: 7, august: 8,
  april: 4, november: 11, september: 9, october: 10, february: 2, january: 1, december: 12,
};

const MONTH_RE = /^(\w+)\s*'?(\d{2})\b/i;

function parseArchiveDate(title: string): { month: number; year: number } | null {
  const m = title.match(MONTH_RE);
  if (!m) return null;
  const monthKey = m[1].toLowerCase();
  const month = MONTH_MAP[monthKey];
  if (!month) return null;
  const year = parseInt(m[2], 10) + 2000;
  return { month, year };
}

interface Section {
  label: string;
  color: string;
  playlists: PlaylistIndexEntry[];
}

function categorize(playlists: PlaylistIndexEntry[]): Section[] {
  const archive: (PlaylistIndexEntry & { _sort: number })[] = [];
  const pyaarRadio: PlaylistIndexEntry[] = [];
  const dj: PlaylistIndexEntry[] = [];
  const curated: PlaylistIndexEntry[] = [];
  const external: PlaylistIndexEntry[] = [];
  const misc: PlaylistIndexEntry[] = [];

  for (const p of playlists) {
    const t = p.title.trim();
    const tl = t.toLowerCase();

    // Archive month/year playlists
    const date = parseArchiveDate(t);
    if (date) {
      archive.push({ ...p, _sort: date.year * 100 + date.month });
      continue;
    }

    // Pyaar Radio sets
    if (tl.includes("pyaar")) {
      pyaarRadio.push(p);
      continue;
    }

    // DJ / personal sets (goated, themed DJ playlists)
    if (tl.includes("(goated)") || tl.startsWith("dj ") || tl.includes("usb")) {
      dj.push(p);
      continue;
    }

    // External / discovery playlists (large, from other sources)
    if (
      tl.includes("nts") || tl.includes("soulection") || tl.includes("resident advisor") ||
      tl.includes("ra ") || tl.includes("grammy") || tl.includes("cole bennett") ||
      tl.includes("four tet") || tl.includes("timeboy") || tl.includes("kenny beats") ||
      tl.includes("daytimers") || tl.includes("soup to nuts") || tl.includes("nai palm") ||
      tl.includes("hk discord") || tl.includes("dar disku") || tl.includes("leftfield bass") ||
      p.trackCount >= 500
    ) {
      external.push(p);
      continue;
    }

    // Curated mood/vibe playlists (medium size, themed)
    if (p.trackCount >= 10) {
      curated.push(p);
      continue;
    }

    // Small / misc
    misc.push(p);
  }

  // Sort archive newest first
  archive.sort((a, b) => b._sort - a._sort);

  const sections: Section[] = [];
  if (archive.length > 0) sections.push({ label: "Archive", color: "bg-amber-500", playlists: archive });
  if (pyaarRadio.length > 0) sections.push({ label: "Pyaar Radio", color: "bg-red-600", playlists: pyaarRadio });
  if (dj.length > 0) sections.push({ label: "DJ Sets", color: "bg-purple-500", playlists: dj });
  if (curated.length > 0) sections.push({ label: "Curated", color: "bg-emerald-500", playlists: curated });
  if (external.length > 0) sections.push({ label: "Discovery", color: "bg-blue-500", playlists: external });
  if (misc.length > 0) sections.push({ label: "Other", color: "bg-[#444]", playlists: misc });

  return sections;
}

function PlaylistRow({ p, loading, dotColor, onSelect }: { p: PlaylistIndexEntry; loading: string | null; dotColor: string; onSelect: (id: string, title: string) => void }) {
  return (
    <div
      className="px-5 py-2.5 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 cursor-pointer group"
      onClick={() => onSelect(p.playlistId, p.title)}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
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
  );
}

export function PlaylistPicker({ playlists, loading, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const sections = useMemo(() => categorize(playlists), [playlists]);

  const filteredSections = useMemo(() => {
    if (!search) return sections;
    const q = search.toLowerCase();
    return sections
      .map((s) => ({ ...s, playlists: s.playlists.filter((p) => p.title.toLowerCase().includes(q)) }))
      .filter((s) => s.playlists.length > 0);
  }, [sections, search]);

  const totalCount = filteredSections.reduce((sum, s) => sum + s.playlists.length, 0);

  const toggle = (label: string) => setCollapsed((c) => ({ ...c, [label]: !c[label] }));

  return (
    <>
      <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a] flex items-center justify-between">
        <span className="text-[10px] text-[#555] uppercase tracking-wider">
          Playlists ({totalCount})
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
      {filteredSections.map((section) => (
        <div key={section.label}>
          <div
            className="px-5 py-1.5 border-b border-[#222] bg-[#060606] flex items-center gap-2 cursor-pointer hover:bg-[#0a0a0a] select-none"
            onClick={() => toggle(section.label)}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${section.color} shrink-0`} />
            <span className="text-[10px] text-[#666] uppercase tracking-wider flex-1">
              {section.label} ({section.playlists.length})
            </span>
            <span className="text-[10px] text-[#333]">
              {collapsed[section.label] ? "+" : "−"}
            </span>
          </div>
          {!collapsed[section.label] &&
            section.playlists.map((p) => (
              <PlaylistRow key={p.playlistId} p={p} loading={loading} dotColor={section.color} onSelect={onSelect} />
            ))}
        </div>
      ))}
      {filteredSections.length === 0 && search && (
        <div className="px-5 py-4 text-center">
          <p className="text-[#444] text-[10px] uppercase tracking-widest">No matches</p>
        </div>
      )}
    </>
  );
}
