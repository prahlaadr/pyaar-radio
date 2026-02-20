#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$PROJECT_DIR/public/data"
DUCKDB_DIST="$PROJECT_DIR/node_modules/@duckdb/duckdb-wasm/dist"

# Data lives in public/data/ in the repo — no copy needed
if [ -f "$OUT_DIR/artists.csv" ]; then
  echo "Data files present in public/data/"
else
  echo "ERROR: No data files found in public/data/"
  exit 1
fi

# Copy DuckDB WASM files
cp "$DUCKDB_DIST/duckdb-mvp.wasm" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-eh.wasm" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-browser-mvp.worker.js" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-browser-eh.worker.js" "$PROJECT_DIR/public/"

echo "Data + WASM files copied"
