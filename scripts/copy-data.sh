#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
DATA_DIR="${PYAAR_DATA_DIR:-$HOME/Documents/Projects/12-pyaar-radio-crate/Pyaar Radio/_data}"
OUT_DIR="$PROJECT_DIR/public/data"
DUCKDB_DIST="$PROJECT_DIR/node_modules/@duckdb/duckdb-wasm/dist"

mkdir -p "$OUT_DIR"

# Copy CSVs
if [ ! -f "$DATA_DIR/artists.csv" ]; then
  echo "ERROR: artists.csv not found at $DATA_DIR"
  exit 1
fi
if [ ! -f "$DATA_DIR/masterlist.csv" ]; then
  echo "ERROR: masterlist.csv not found at $DATA_DIR"
  exit 1
fi
cp "$DATA_DIR/artists.csv" "$OUT_DIR/artists.csv"
cp "$DATA_DIR/masterlist.csv" "$OUT_DIR/masterlist.csv"

# Copy DuckDB WASM files
cp "$DUCKDB_DIST/duckdb-mvp.wasm" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-eh.wasm" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-browser-mvp.worker.js" "$PROJECT_DIR/public/"
cp "$DUCKDB_DIST/duckdb-browser-eh.worker.js" "$PROJECT_DIR/public/"

echo "Data + WASM files copied"
