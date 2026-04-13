"use client";

import { useState, useEffect, useCallback } from "react";

interface CrateEntry {
  artist: string;
  album: string;
  year: string;
  source: string;
  status: string;
  added_at: string;
  notes: string;
}

export default function CratePage() {
  const [entries, setEntries] = useState<CrateEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ artist: "", album: "", year: "", source: "", notes: "" });
  const [busy, setBusy] = useState<string | null>(null);

  const fetchEntries = useCallback(() => {
    fetch("/api/crate")
      .then((r) => r.json())
      .then((d) => { setEntries(d.entries || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const doAction = async (action: string, artist: string, album?: string) => {
    setBusy(artist);
    await fetch("/api/crate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, artist, album }),
    });
    fetchEntries();
    setBusy(null);
  };

  const handleAdd = async () => {
    if (!form.artist.trim()) return;
    setBusy("adding");
    await fetch("/api/crate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "add", ...form }),
    });
    setForm({ artist: "", album: "", year: "", source: "", notes: "" });
    setAdding(false);
    fetchEntries();
    setBusy(null);
  };

  const newEntries = entries.filter((e) => e.status === "new");
  const promotedEntries = entries.filter((e) => e.status === "promoted");

  return (
    <div className="min-h-screen bg-background text-white pt-[env(safe-area-inset-top)]">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#222] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href="/" className="text-[10px] text-[#999] uppercase tracking-wider hover:text-white transition-colors">
            &larr; Radio
          </a>
          <h1 className="text-sm font-bold uppercase tracking-[0.2em]">Crate</h1>
          <span className="text-[10px] text-[#999] uppercase tracking-wider">
            {newEntries.length} to explore
          </span>
        </div>
        <button
          onClick={() => setAdding(!adding)}
          className="px-3 py-1 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-red-600 hover:text-white text-[#999] transition-colors"
        >
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>

      <div className="max-w-2xl mx-auto">
        {/* Add form */}
        {adding && (
          <div className="px-5 py-4 border-b border-[#222] space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="ARTIST"
                value={form.artist}
                onChange={(e) => setForm({ ...form, artist: e.target.value })}
                className="flex-1 px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider text-white placeholder-[#999] focus:outline-none focus:border-red-500 transition-colors"
              />
              <input
                type="text"
                placeholder="ALBUM (optional)"
                value={form.album}
                onChange={(e) => setForm({ ...form, album: e.target.value })}
                className="flex-1 px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider text-white placeholder-[#999] focus:outline-none focus:border-red-500 transition-colors"
              />
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="YEAR"
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                className="w-20 px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider text-white placeholder-[#999] focus:outline-none focus:border-red-500 transition-colors"
              />
              <input
                type="text"
                placeholder="SOURCE (NTS, Bandcamp, friend...)"
                value={form.source}
                onChange={(e) => setForm({ ...form, source: e.target.value })}
                className="flex-1 px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider text-white placeholder-[#999] focus:outline-none focus:border-red-500 transition-colors"
              />
              <button
                onClick={handleAdd}
                disabled={!form.artist.trim() || busy === "adding"}
                className="px-4 py-1.5 text-[10px] uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-30"
              >
                Add
              </button>
            </div>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          </div>
        )}

        {!loading && (
          <>
            {/* New — to explore */}
            {newEntries.length > 0 && (
              <div>
                <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-red-500 uppercase tracking-wider font-semibold">
                    To Explore ({newEntries.length})
                  </span>
                </div>
                {newEntries.map((entry) => (
                  <CrateRow
                    key={`${entry.artist}-${entry.album}`}
                    entry={entry}
                    busy={busy === entry.artist}
                    onPromote={() => doAction("promote", entry.artist, entry.album)}
                    onSkip={() => doAction("skip", entry.artist, entry.album)}
                  />
                ))}
              </div>
            )}

            {/* Promoted — ready for artists.csv */}
            {promotedEntries.length > 0 && (
              <div>
                <div className="px-5 py-2 border-b border-[#222] bg-[#0a0a0a]">
                  <span className="text-[10px] text-green-500 uppercase tracking-wider font-semibold">
                    Promoted ({promotedEntries.length})
                  </span>
                  <span className="text-[10px] text-[#999] uppercase tracking-wider ml-2">
                    — add to artists.csv to curate
                  </span>
                </div>
                {promotedEntries.map((entry) => (
                  <div
                    key={`${entry.artist}-${entry.album}`}
                    className="px-5 py-3 border-b border-[#111] flex items-center gap-3 opacity-70"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-[#ccc] truncate">
                        {entry.artist}
                        {entry.album ? ` — ${entry.album}` : ""}
                      </div>
                      <div className="text-[10px] text-[#999] truncate">
                        {[entry.source, entry.year, entry.notes].filter(Boolean).join(" · ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Empty state */}
            {newEntries.length === 0 && promotedEntries.length === 0 && (
              <div className="px-5 py-20 text-center">
                <p className="text-[#888] text-xs uppercase tracking-widest">Crate is empty</p>
                <p className="text-[#888] text-[10px] uppercase tracking-wider mt-2">
                  Add artists you want to explore
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CrateRow({
  entry,
  busy,
  onPromote,
  onSkip,
}: {
  entry: CrateEntry;
  busy: boolean;
  onPromote: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="px-5 py-3 border-b border-[#111] hover:bg-[#0a0a0a] flex items-center gap-3 group transition-colors">
      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
          {entry.artist}
          {entry.album ? ` — ${entry.album}` : ""}
        </div>
        <div className="text-[10px] text-[#999] truncate">
          {[entry.source, entry.year, entry.notes].filter(Boolean).join(" · ")}
        </div>
      </div>
      <span className="text-[10px] text-[#999] tabular-nums font-mono shrink-0">{entry.added_at}</span>
      {busy ? (
        <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" />
      ) : (
        <div className="flex gap-1 shrink-0">
          <button
            onClick={onPromote}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-green-600 hover:text-white text-[#999] transition-colors"
          >
            Promote
          </button>
          <button
            onClick={onSkip}
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#999] hover:text-white transition-colors"
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
