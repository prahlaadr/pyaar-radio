import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

// Write-through endpoint for admin re-labelling.
// Updates the pillar_v2 / zone / desi_bool columns for one artist in artists.csv.
// Works only where the filesystem is writable (local dev). On Vercel this 500s and
// the client falls back to its localStorage override layer — see lib/artist-overrides.ts.

const CSV_PATH = join(process.cwd(), "public", "data", "artists.csv");

// --- minimal RFC-4180 CSV (handles quoted fields w/ embedded commas + quotes) ---
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field); field = "";
    } else if (c === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (c === "\r") {
      /* skip */
    } else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

function serializeField(s: string): string {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function serializeCSV(rows: string[][]): string {
  // Match the repo convention (Python csv.writer default) — CRLF line endings —
  // so admin edits don't churn line endings against backfill/manual edits.
  return rows.map((r) => r.map(serializeField).join(",")).join("\r\n") + "\r\n";
}

export async function PATCH(req: NextRequest) {
  try {
    const { artist, pillars, zone, desi } = await req.json();
    if (!artist || typeof artist !== "string") {
      return NextResponse.json({ error: "artist required" }, { status: 400 });
    }

    const raw = await readFile(CSV_PATH, "utf-8");
    const rows = parseCSV(raw);
    if (rows.length === 0) return NextResponse.json({ error: "empty csv" }, { status: 500 });

    const header = rows[0];
    const col = (name: string) => header.indexOf(name);
    const iArtist = col("artist");
    const iPillarV2 = col("pillar_v2");
    const iZone = col("zone");
    const iDesiBool = col("desi_bool");
    if ([iArtist, iPillarV2, iZone, iDesiBool].some((i) => i < 0)) {
      return NextResponse.json({ error: "missing v2 columns — run backfill_pillars_v2.py --apply" }, { status: 500 });
    }

    const idx = rows.findIndex((r, n) => n > 0 && r[iArtist] === artist);
    if (idx < 0) return NextResponse.json({ error: `artist not found: ${artist}` }, { status: 404 });

    const row = rows[idx];
    if (Array.isArray(pillars)) row[iPillarV2] = pillars.join("|");
    if (typeof zone === "string") row[iZone] = zone;
    if (desi === "Desi" || desi === "Non-Desi") row[iDesiBool] = desi === "Desi" ? "true" : "false";

    await writeFile(CSV_PATH, serializeCSV(rows), "utf-8");
    return NextResponse.json({
      ok: true,
      artist,
      pillar_v2: row[iPillarV2],
      zone: row[iZone],
      desi_bool: row[iDesiBool],
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
