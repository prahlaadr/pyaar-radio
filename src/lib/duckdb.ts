import * as duckdb from "@duckdb/duckdb-wasm";

let db: duckdb.AsyncDuckDB | null = null;
let conn: duckdb.AsyncDuckDBConnection | null = null;
let initPromise: Promise<void> | null = null;

async function init() {
  // Use local WASM files copied by webpack plugin
  const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: {
      mainModule: "/duckdb-mvp.wasm",
      mainWorker: "/duckdb-browser-mvp.worker.js",
    },
    eh: {
      mainModule: "/duckdb-eh.wasm",
      mainWorker: "/duckdb-browser-eh.worker.js",
    },
  };

  const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
  const worker = new Worker(bundle.mainWorker!);
  const logger = new duckdb.ConsoleLogger();
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);

  // Fetch and register CSVs
  const [artistsResp, masterlistResp] = await Promise.all([
    fetch("/data/artists.csv"),
    fetch("/data/masterlist.csv"),
  ]);

  const artistsBufRaw = new Uint8Array(await artistsResp.arrayBuffer());
  const masterlistBuf = new Uint8Array(await masterlistResp.arrayBuffer());

  // Normalize line endings to \n — mixed \r\n and \n breaks DuckDB's strict parser
  const artistsBuf = artistsBufRaw.filter((b) => b !== 0x0d);

  await db.registerFileBuffer("artists.csv", artistsBuf);
  await db.registerFileBuffer("masterlist.csv", masterlistBuf);

  // Tamil CSV — non-blocking so failures don't break the main app
  try {
    const tamilResp = await fetch("/data/tamil.csv");
    if (tamilResp.ok) {
      const tamilBuf = new Uint8Array(await tamilResp.arrayBuffer());
      await db.registerFileBuffer("tamil.csv", tamilBuf);
    }
  } catch {
    console.warn("Failed to fetch tamil.csv");
  }

  // Ilaiyaraaja CSV — non-blocking
  try {
    const irResp = await fetch("/data/ilaiyaraaja.csv");
    if (irResp.ok) {
      const irBuf = new Uint8Array(await irResp.arrayBuffer());
      await db.registerFileBuffer("ilaiyaraaja.csv", irBuf);
    }
  } catch {
    console.warn("Failed to fetch ilaiyaraaja.csv");
  }

  conn = await db.connect();

  await conn.query(`
    CREATE TABLE artists AS
    SELECT artist, aliases, channel, samay, desi, vibes,
           TRY_CAST(bpm_low AS INT) AS bpm_low,
           TRY_CAST(bpm_high AS INT) AS bpm_high
    FROM read_csv('artists.csv', delim=',', header=true, all_varchar=true, strict_mode=false, null_padding=true)
  `);
  await conn.query(`
    CREATE TABLE masterlist AS SELECT * FROM read_csv('masterlist.csv', delim=',', quote='"', escape='"', header=true, all_varchar=true, strict_mode=false, null_padding=true)
  `);
  // Add pre-computed lowercase artist column for faster matching
  await conn.query(`ALTER TABLE masterlist ADD COLUMN _artists_lower VARCHAR`);
  await conn.query(`UPDATE masterlist SET _artists_lower = ';' || LOWER("Artist Name(s)") || ';'`);
  // Ensure Bandcamp ID column exists (may be missing from CSV)
  try {
    await conn.query(`ALTER TABLE masterlist ADD COLUMN "Bandcamp ID" VARCHAR DEFAULT ''`);
  } catch { /* column already exists */ }
  // Ensure Liked Position column exists (added 2026-04 for ♥ Liked recency sort).
  // Empty until next sync runs and backfills.
  try {
    await conn.query(`ALTER TABLE masterlist ADD COLUMN "Liked Position" VARCHAR DEFAULT ''`);
  } catch { /* column already exists */ }
  try {
    await conn.query(`
      CREATE TABLE tamil AS SELECT * FROM read_csv_auto('tamil.csv', all_varchar=true)
    `);
  } catch (e) {
    console.warn("Failed to load tamil.csv:", e);
    await conn.query(`CREATE TABLE tamil (
      "Track Name" VARCHAR, "Artist" VARCHAR, "Album" VARCHAR,
      "Tempo" VARCHAR, "Duration" VARCHAR, "Video ID" VARCHAR
    )`);
  }
  try {
    await conn.query(`
      CREATE TABLE ilaiyaraaja AS SELECT * FROM read_csv_auto('ilaiyaraaja.csv', all_varchar=true)
    `);
  } catch (e) {
    console.warn("Failed to load ilaiyaraaja.csv:", e);
    await conn.query(`CREATE TABLE ilaiyaraaja (
      "Track Name" VARCHAR, "Film" VARCHAR, "Video ID" VARCHAR
    )`);
  }
}

export async function getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
  if (!initPromise) {
    initPromise = init();
  }
  await initPromise;
  return conn!;
}

export async function query<T = Record<string, unknown>>(
  sql: string
): Promise<T[]> {
  const c = await getConnection();
  const result = await c.query(sql);
  return result.toArray().map((row) => row.toJSON() as T);
}

export async function fetchSetlistManifest(): Promise<
  { id: string; name: string; file: string; trackCount: number }[]
> {
  try {
    const resp = await fetch("/data/setlists.json");
    if (!resp.ok) return [];
    return await resp.json();
  } catch {
    return [];
  }
}

export async function fetchSetlistCSV(
  file: string
): Promise<{ track: string; artist: string; bpm: string; key: string; duration: string }[]> {
  const resp = await fetch(`/data/${file}`);
  if (!resp.ok) throw new Error(`Failed to fetch ${file}`);
  const text = await resp.text();
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];

  // Skip header row, parse CSV
  const results: { track: string; artist: string; bpm: string; key: string; duration: string }[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    // Position,Track Name,Artist,BPM,Key,Duration
    if (cols.length >= 3) {
      results.push({
        track: cols[1] || "",
        artist: cols[2] || "",
        bpm: cols[3] || "",
        key: cols[4] || "",
        duration: cols[5] || "",
      });
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
