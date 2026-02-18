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

  const artistsBuf = new Uint8Array(await artistsResp.arrayBuffer());
  const masterlistBuf = new Uint8Array(await masterlistResp.arrayBuffer());

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

  conn = await db.connect();

  await conn.query(`
    CREATE TABLE artists AS SELECT * FROM read_csv_auto('artists.csv')
  `);
  await conn.query(`
    CREATE TABLE masterlist AS SELECT * FROM read_csv_auto('masterlist.csv', all_varchar=true)
  `);
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
