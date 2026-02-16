# Pyaar Setlist — DJ Set Planning Tool

Private web interface for planning DJ sets using the Pyaar Radio crate data.

## What It Does

A web UI to browse your curated artist/track library with the same filters you use in DuckDB, plus a setlist builder for planning sets.

## Data Source

Two CSVs from the Pyaar Radio Crate (`~/Documents/Projects/12-pyaar-radio-crate/Pyaar Radio/_data/`):
- **artists.csv** — 170+ curated artists with channel, vibes, samay, desi, BPM (built from Obsidian frontmatter)
- **masterlist.csv** — 40K+ tracks with genres, tempo, key, duration (synced from YT Music/Spotify)

DuckDB-WASM runs queries entirely in the browser — no backend needed. CSVs ship as static assets.

## Planned Features

### Phase 1 — Browse + Filter
- Artist browser: filter by channel (Rave/Rap/Soul), vibes, samay, desi, BPM range
- Track browser: search by artist, genre, tempo range
- Join view: curated artists enriched with their masterlist tracks
- Same query patterns as the existing DuckDB CLI, but as UI controls

### Phase 2 — Setlist Builder
- Drag tracks into a setlist sequence
- BPM flow visualization (see energy arc across the set)
- Key compatibility hints (Camelot wheel)
- Set duration tracking

### Phase 3 — Save + Share
- Save/load setlists locally (localStorage or JSON export)
- Shareable read-only links
- Print/export setlist as PDF or markdown

## Stack

- Next.js 15 + React 19 + TypeScript + Tailwind
- DuckDB-WASM (browser-side queries, no backend)
- Deploy to Vercel with password protection
- Data: static CSVs copied/symlinked from the crate

## Relationship to Pyaar Radio Crate

```
Obsidian vault (12-pyaar-radio-crate/)
  → build_index.py → artists.csv
  → masterlist.csv (symlink)
        ↓
  Copy/deploy CSVs
        ↓
Pyaar Setlist (01-web-apps/pyaar-setlist/)
  → Next.js app
  → DuckDB-WASM queries CSVs in browser
  → UI for browsing, filtering, setlist planning
```

The crate remains the source of truth. This app is the read-only consumer.
