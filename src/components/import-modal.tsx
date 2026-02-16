"use client";

import { useState, useRef } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onImport: (lines: { track: string; artist: string }[]) => void;
}

function parseInput(text: string): { track: string; artist: string }[] {
  const results: { track: string; artist: string }[] = [];
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  // Detect CSV with header
  const firstLine = lines[0]?.toLowerCase() || "";
  const isCSV = firstLine.includes("track") && firstLine.includes("artist");

  if (isCSV) {
    // CSV format: skip header, parse columns
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      if (cols.length >= 2) {
        // Try to find track name and artist columns
        // Support both "Position,Track Name,Artist,..." and "Track Name,Artist,..."
        const hasPosition = /^\d+$/.test(cols[0].trim());
        const track = hasPosition ? cols[1] : cols[0];
        const artist = hasPosition ? cols[2] : cols[1];
        if (track && artist) {
          results.push({ track: track.trim(), artist: artist.trim() });
        }
      }
    }
  } else {
    // Freetext: "Track - Artist" or "Track by Artist"
    for (const line of lines) {
      // Skip empty lines or section headers (no separator)
      const separators = [" - ", " – ", " — ", " by "];
      let found = false;
      for (const sep of separators) {
        const idx = line.indexOf(sep);
        if (idx > 0) {
          results.push({
            track: line.slice(0, idx).trim(),
            artist: line.slice(idx + sep.length).trim(),
          });
          found = true;
          break;
        }
      }
      // Try "Artist - Track" format (less common, skip if already matched)
      if (!found && line.includes(",")) {
        const parts = line.split(",");
        if (parts.length >= 2) {
          results.push({ track: parts[0].trim(), artist: parts[1].trim() });
        }
      }
    }
  }

  return results;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function ImportModal({ open, onClose, onImport }: Props) {
  const [text, setText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setText(reader.result as string);
    };
    reader.readAsText(file);
  };

  const handleImport = () => {
    const parsed = parseInput(text);
    if (parsed.length > 0) {
      onImport(parsed);
      setText("");
      onClose();
    }
  };

  const preview = text ? parseInput(text) : [];

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center">
      <div className="bg-[#0a0a0a] border border-[#333] w-[500px] max-h-[80vh] flex flex-col">
        <div className="px-5 py-3 border-b border-[#222] flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-[0.2em]">Import</h2>
          <button
            onClick={onClose}
            className="text-[#555] hover:text-white text-sm"
          >
            &times;
          </button>
        </div>

        <div className="p-5 flex-1 overflow-y-auto space-y-3">
          <p className="text-[10px] text-[#555] uppercase tracking-wider">
            Paste tracks or upload CSV. Formats: &quot;Track - Artist&quot;, CSV, or markdown list.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Turtles - Flying Lotus\nBlack Sands - Bonobo\nAlap - Four Tet"}
            className="w-full h-48 px-3 py-2 bg-[#111] border border-[#333] text-xs text-[#ccc] font-mono resize-none focus:outline-none focus:border-red-500 transition-colors"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={() => fileRef.current?.click()}
              className="px-3 py-1 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] hover:text-white transition-colors"
            >
              Upload CSV
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt,.md"
              onChange={handleFile}
              className="hidden"
            />
            {preview.length > 0 && (
              <span className="text-[10px] text-[#555]">
                {preview.length} tracks detected
              </span>
            )}
          </div>

          {preview.length > 0 && (
            <div className="border border-[#222] max-h-40 overflow-y-auto">
              {preview.map((p, i) => (
                <div key={i} className="px-3 py-1 border-b border-[#111] text-xs flex gap-2">
                  <span className="text-[10px] text-[#333] w-5 text-right tabular-nums font-mono">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="text-[#ccc] truncate">{p.track}</span>
                  <span className="text-[#444]">&mdash;</span>
                  <span className="text-[#666] truncate">{p.artist}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-[#222] flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-1.5 text-[10px] uppercase tracking-wider bg-[#111] hover:bg-[#222] text-[#555] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={preview.length === 0}
            className="px-4 py-1.5 text-[10px] uppercase tracking-wider bg-red-600 hover:bg-red-500 text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Import {preview.length > 0 ? `(${preview.length})` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
