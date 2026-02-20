#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUT_DIR="$PROJECT_DIR/public/data"
DUCKDB_DIST="$PROJECT_DIR/node_modules/@duckdb/duckdb-wasm/dist"

# Copy CSVs from data source (local dev only — skip if already present)
DATA_DIR="${PYAAR_DATA_DIR:-$PROJECT_DIR/public/data}"
if [ -f "$DATA_DIR/artists.csv" ]; then
  mkdir -p "$OUT_DIR"
  cp "$DATA_DIR/artists.csv" "$OUT_DIR/artists.csv"
  cp "$DATA_DIR/masterlist.csv" "$OUT_DIR/masterlist.csv"

  # Copy setlist CSVs and generate manifest
  SETLISTS_SRC="$DATA_DIR/setlists"
  SETLISTS_OUT="$OUT_DIR/setlists"
  if [ -d "$SETLISTS_SRC" ] && ls "$SETLISTS_SRC"/*.csv 1>/dev/null 2>&1; then
    mkdir -p "$SETLISTS_OUT"
    cp "$SETLISTS_SRC"/*.csv "$SETLISTS_OUT/"

    # Generate setlists.json manifest
    MANIFEST="$OUT_DIR/setlists.json"
    echo "[" > "$MANIFEST"
    first=true
    for csv_file in "$SETLISTS_SRC"/*.csv; do
      filename=$(basename "$csv_file" .csv)
      # Display name: replace hyphens with spaces
      display_name=$(echo "$filename" | tr '-' ' ')
      # Count data rows (subtract 1 for header)
      track_count=$(($(wc -l < "$csv_file") - 1))
      if [ "$first" = true ]; then
        first=false
      else
        echo "," >> "$MANIFEST"
      fi
      printf '  {"id":"%s","name":"%s","file":"setlists/%s.csv","trackCount":%d}' \
        "$filename" "$display_name" "$filename" "$track_count" >> "$MANIFEST"
    done
    echo "" >> "$MANIFEST"
    echo "]" >> "$MANIFEST"
    echo "Setlists copied + manifest generated"
  else
    # No setlists — write empty manifest
    echo "[]" > "$OUT_DIR/setlists.json"
    echo "No setlists found, empty manifest written"
  fi

  echo "CSVs copied from data source"
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
