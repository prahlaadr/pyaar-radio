// Build-time CSV → Parquet conversion for the masterlist.
//
// DuckDB parses a 9 MB CSV in the browser in ~1-3s (all_varchar, 84K rows), which
// gates every track list and the first genre pick. Parquet is columnar + typed +
// compressed, so the browser reads it in ~200-400ms. This runs in copy-data.sh
// (prebuild), so every deploy regenerates the parquet from the current CSV — it
// stays fresh with the daily sync without any CI change.
//
// Runs under Bun (bun.lock present → Vercel uses Bun) via duckdb-wasm's Node build.
import * as duckdb from "@duckdb/duckdb-wasm";
import Worker from "web-worker";
import { readFileSync, writeFileSync, existsSync } from "fs";

const DIST = "./node_modules/@duckdb/duckdb-wasm/dist";
const CSV = "./public/data/masterlist.csv";
const OUT = "./public/data/masterlist.parquet";

if (!existsSync(CSV)) {
  console.error(`build-parquet: ${CSV} not found`);
  process.exit(1);
}

const worker = new Worker(`${DIST}/duckdb-node-eh.worker.cjs`);
const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
await db.instantiate(`${DIST}/duckdb-eh.wasm`);
const conn = await db.connect();

await db.registerFileBuffer("masterlist.csv", new Uint8Array(readFileSync(CSV)));

// all_varchar keeps every column a string (the app TRY_CASTs numbers itself), so
// the parquet schema matches what read_csv produced. Preserve all columns as-is.
await conn.query(`
  COPY (
    SELECT * FROM read_csv('masterlist.csv', delim=',', quote='"', escape='"',
      header=true, all_varchar=true, strict_mode=false, null_padding=true)
  ) TO 'masterlist.parquet' (FORMAT PARQUET, COMPRESSION ZSTD)
`);

const buf = await db.copyFileToBuffer("masterlist.parquet");
writeFileSync(OUT, buf);

const csvMB = (readFileSync(CSV).length / 1e6).toFixed(1);
const pqMB = (buf.length / 1e6).toFixed(1);
console.log(`build-parquet: masterlist.csv ${csvMB} MB → masterlist.parquet ${pqMB} MB`);

await conn.close();
await db.terminate();
worker.terminate();
