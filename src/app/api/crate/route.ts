import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";

const CRATE_PATH = join(process.cwd(), "public", "data", "crate.csv");

interface CrateEntry {
  artist: string;
  album: string;
  year: string;
  source: string;
  status: string;
  added_at: string;
  notes: string;
}

function parseCSV(text: string): CrateEntry[] {
  const lines = text.trim().split("\n");
  if (lines.length <= 1) return [];
  return lines.slice(1).filter(Boolean).map((line) => {
    const [artist, album, year, source, status, added_at, notes] = line.split(",").map((s) => s.trim());
    return { artist: artist || "", album: album || "", year: year || "", source: source || "", status: status || "new", added_at: added_at || "", notes: notes || "" };
  });
}

function toCSV(entries: CrateEntry[]): string {
  const header = "artist,album,year,source,status,added_at,notes";
  const rows = entries.map((e) => `${e.artist},${e.album},${e.year},${e.source},${e.status},${e.added_at},${e.notes}`);
  return [header, ...rows, ""].join("\n");
}

export async function GET() {
  try {
    const raw = await readFile(CRATE_PATH, "utf-8");
    const entries = parseCSV(raw);
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ entries: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, artist, album, year, source, notes, status } = body;

    const raw = await readFile(CRATE_PATH, "utf-8");
    let entries = parseCSV(raw);

    if (action === "add") {
      const exists = entries.some((e) => e.artist.toLowerCase() === artist.toLowerCase() && e.album.toLowerCase() === (album || "").toLowerCase());
      if (exists) {
        return NextResponse.json({ error: "Already in crate" }, { status: 409 });
      }
      entries.push({
        artist,
        album: album || "",
        year: year || "",
        source: source || "",
        status: "new",
        added_at: new Date().toISOString().split("T")[0],
        notes: notes || "",
      });
    } else if (action === "promote" || action === "skip") {
      entries = entries.map((e) =>
        e.artist.toLowerCase() === artist.toLowerCase() ? { ...e, status: action === "promote" ? "promoted" : "skipped" } : e
      );
    } else if (action === "remove") {
      entries = entries.filter((e) => !(e.artist.toLowerCase() === artist.toLowerCase() && e.album.toLowerCase() === (album || "").toLowerCase()));
    }

    await writeFile(CRATE_PATH, toCSV(entries), "utf-8");
    return NextResponse.json({ ok: true, count: entries.length });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
