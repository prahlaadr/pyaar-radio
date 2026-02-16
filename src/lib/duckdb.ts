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

  conn = await db.connect();

  await conn.query(`
    CREATE TABLE artists AS SELECT * FROM read_csv_auto('artists.csv')
  `);
  await conn.query(`
    CREATE TABLE masterlist AS SELECT * FROM read_csv_auto('masterlist.csv', all_varchar=true)
  `);
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
