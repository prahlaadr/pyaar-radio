#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$PROJECT_DIR/public/data"
DUCKDB_DIST="$PROJECT_DIR/node_modules/@duckdb/duckdb-wasm/dist"

# Copy CSVs from Obsidian vault (local dev only — skip if already present)
DATA_DIR="${PYAAR_DATA_DIR:-$HOME/Documents/Projects/12-pyaar-radio-crate/Pyaar Radio/_data}"
if [ -f "$DATA_DIR/artists.csv" ]; then
  mkdir -p "$OUT_DIR"
  cp "$DATA_DIR/artists.csv" "$OUT_DIR/artists.csv"
  cp "$DATA_DIR/masterlist.csv" "$OUT_DIR/masterlist.csv"
  echo "CSVs copied from vault"
elif [ -f "$OUT_DIR/artists.csv" ]; then
  echo "CSVs already in public/data (CI/deploy)"
else
  echo "ERROR: No data files found"
  exit 1
fi

# Copy DuckDB WASM files
cp "$DUCKDB_DIST/duckdb-mvp.wasm" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-eh.wasm" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-browser-mvp.worker.js" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-browser-eh.worker.js" "$PROJECT_DIR/public/"

echo "Data + WASM files copied"
