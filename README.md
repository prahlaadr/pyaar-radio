# Pyaar Radio

Private DJ set planning tool and music library version control.

## What It Does

- **Browse** 170+ curated artists filtered by channel (Rave/Rap/Soul), vibes, samay, desi, BPM range
- **Drill into tracks** — 40K+ tracks with BPM, key, duration, genres
- **Build setlists** — add tracks, reorder, remove, track total duration
- **Export CSV** — download setlist for use in DJ software
- **Version your library** — every update to your masterlist is tracked in git

## Stack

- Next.js 16 + React 19 + TypeScript + Tailwind
- DuckDB-WASM (browser-side SQL queries, no backend)
- NTS Radio-themed UI (black/red/minimal)
- Vercel deployment with auto-deploy on push

## Data

Two CSVs from the Pyaar Radio Crate (`~/Documents/Projects/12-pyaar-radio-crate/Pyaar Radio/_data/`):

- **artists.csv** — curated artists with channel, vibes, samay, desi, BPM range
- **masterlist.csv** — all tracks with tempo, key, duration, genres, popularity

CSVs are committed to the repo for version control. DuckDB-WASM queries them in the browser.

## Development

```bash
bun install
bun run dev
```

The build script (`scripts/copy-data.sh`) copies fresh CSVs from the Obsidian vault if available, otherwise uses the committed versions.

## Updating Your Library

1. Update your crate in Obsidian (add artists, process playlists)
2. `bash scripts/copy-data.sh` to pull latest CSVs
3. `git add public/data/ && git commit -m "update library" && git push`

Vercel auto-deploys on push to `main`.

## Live

https://pyaar-radio.vercel.app
