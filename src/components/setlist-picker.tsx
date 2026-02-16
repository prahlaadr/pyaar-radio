"use client";

import type { SetlistManifestEntry, SetlistTrack } from "@/lib/types";

interface BrowserSetlist {
  id: string;
  name: string;
  trackCount: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  vaultSetlists: SetlistManifestEntry[];
  browserSetlists: BrowserSetlist[];
  onLoadVault: (entry: SetlistManifestEntry) => void;
  onLoadBrowser: (id: string) => void;
  onDeleteBrowser: (id: string) => void;
}

export function SetlistPicker({
  open,
  onClose,
  vaultSetlists,
  browserSetlists,
  onLoadVault,
  onLoadBrowser,
  onDeleteBrowser,
}: Props) {
  if (!open) return null;

  const hasVault = vaultSetlists.length > 0;
  const hasBrowser = browserSetlists.length > 0;
  const empty = !hasVault && !hasBrowser;

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-[#0a0a0a] border border-[#333] w-[400px] max-h-[70vh] flex flex-col">
        <div className="px-5 py-3 border-b border-[#222] flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-[0.2em]">Open Setlist</h2>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-white text-sm"
          >
            &times;
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {empty && (
            <div className="px-5 py-8 text-center">
              <p className="text-[#444] text-xs uppercase tracking-widest">No saved setlists</p>
            </div>
          )}

          {hasVault && (
            <>
              <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                <span className="text-[10px] text-[#555] uppercase tracking-wider">
                  Saved ({vaultSetlists.length})
                </span>
              </div>
              {vaultSetlists.map((entry) => (
                <div
                  key={entry.id}
                  className="px-5 py-2 border-b border-[#111] hover:bg-[#111] flex items-center gap-3 cursor-pointer group"
                  onClick={() => {
                    onLoadVault(entry);
                    onClose();
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
                      {entry.name}
                    </div>
                  </div>
                  <span className="text-[10px] text-[#444] tabular-nums">
                    {entry.trackCount} tracks
                  </span>
                </div>
              ))}
            </>
          )}

          {hasBrowser && (
            <>
              <div className="px-5 py-1.5 border-b border-[#222] bg-[#0a0a0a]">
                <span className="text-[10px] text-[#555] uppercase tracking-wider">
                  Browser ({browserSetlists.length})
                </span>
              </div>
              {browserSetlists.map((entry) => (
                <div
                  key={entry.id}
                  className="px-5 py-2 border-b border-[#111] hover:bg-[#111] flex items-center gap-3 cursor-pointer group"
                  onClick={() => {
                    onLoadBrowser(entry.id);
                    onClose();
                  }}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-[#444] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[#ccc] group-hover:text-white transition-colors truncate">
                      {entry.name}
                    </div>
                  </div>
                  <span className="text-[10px] text-[#444] tabular-nums">
                    {entry.trackCount} tracks
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteBrowser(entry.id);
                    }}
                    className="text-[#222] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all text-xs"
                  >
                    &times;
                  </button>
                </div>
              ))}
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#222] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
