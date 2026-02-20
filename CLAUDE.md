# Pyaar Radio

DJ music library and setlist tool. **GitHub is the source of truth** — no Obsidian vault needed.

**Live:** [pyaar-radio.vercel.app](https://pyaar-radio.vercel.app) | **Branch:** `main` | **Vercel:** auto-deploys on push

## Quick Reference — What to Do When User Says...

| Request | What to do |
|---------|------------|
| "Add a song" / "Add this track" | Add row to `public/data/masterlist.csv` — fill Artist Name(s), Track Name, and either Video ID (YouTube) or Soundcloud ID |
| "Add an artist" | Add row to `public/data/artists.csv` — fill artist, channel, samay, desi, vibes, bpm_low, bpm_high |
| "Change vibes for X" | Edit the `vibes` column in `artists.csv` (pipe-separated) |
| "Tag tracks" | Edit the `Tags` column in `masterlist.csv` (pipe-separated) |
| "Add BPM/key" | Edit `Tempo` and `Key` columns in `masterlist.csv` |
| "Sync from YT Music" | Run `.venv/bin/python3.13 sync_masterlist.py --yes` in `~/Documents/Projects/03-music-audio/pyaar-crate/` |
| "Hydrate metadata" | Run hydration scripts in pyaar-crate (see below) |
| "Deploy" | Just push to `main` — Vercel auto-deploys |

## Data Files

All in `public/data/`:

### masterlist.csv (41K+ tracks)
Auto-synced from YT Music daily at 3AM. **Safe-to-edit columns:**

| Column | Format | Notes |
|--------|--------|-------|
| Genres | text | From Spotify hydration |
| Tempo | number | BPM, from essentia hydration |
| Key | text | Musical key, from essentia hydration |
| Popularity | number | From Spotify hydration |
| Release Date | date | From Spotify hydration |
| Instrumentalness | number | From Spotify hydration |
| Tags | pipe-separated | YT Music playlist names, e.g. `Chill\|Late Night` |
| Soundcloud ID | number | SoundCloud track ID for SC-only tracks |
| Source | text | Provenance: `YT Music`, `SoundCloud`, or `Tamil` |

**Do NOT edit:** Track Name, Artist Name(s), Album Name, Liked, Playlist 1-5, Playlist Count, Video ID — these are overwritten by daily sync.

### artists.csv (273 curated artists)
Edited directly. Columns:

| Column | Format | Example |
|--------|--------|---------|
| artist | text | `Flying Lotus` |
| aliases | pipe-separated | `FlyLo\|Steven Ellison` (for matching tracks with alternate artist names) |
| channel | Rave/Rap/Soul | `Rave` |
| samay | Day/Night/Day/Night | `Night` |
| desi | Desi/Non-Desi | `Non-Desi` |
| vibes | pipe-separated | `Bass\|Psych\|Future Beats` |
| bpm_low | number | `80` |
| bpm_high | number | `170` |

### Taxonomy

- **Channels:** Rave, Rap, Soul
- **Samay:** Day, Night, Day/Night
- **Vibes (15):** Groove, Soulful, Rowdy, Nodders, Rave, Psych, Bass, Percussive, Club, Future Beats, Pop, Dark, Trap, Boom Bap, UKG

## Crate Scripts (for hydration/sync)

Located in `~/Documents/Projects/03-music-audio/pyaar-crate/`. Use Python 3.13 from the venv:

```bash
cd ~/Documents/Projects/03-music-audio/pyaar-crate
.venv/bin/python3.13 sync_masterlist.py --yes      # Full sync + auto-push to deck
.venv/bin/python3.13 sync_masterlist.py --no-push   # Sync without pushing
.venv/bin/python3.13 sync_masterlist.py --dry        # Preview only
.venv/bin/python3.13 hydrate_bpm.py --vault-only     # BPM+Key for curated artists
.venv/bin/python3.13 hydrate_spotify.py              # Genres/popularity/dates
```

After hydration, `sync_masterlist.py --yes` will push the updated masterlist to this repo automatically.

## Stack

- **Runtime:** Bun (not npm)
- **Framework:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4
- **Data:** DuckDB WASM (SQL in browser against CSVs)
- **Player:** YouTube IFrame API + SoundCloud
- **UI libs:** fuse.js, @tanstack/react-virtual, hotkeys-js, dnd-kit
- **Auth:** Cookie-based, `SITE_PASSWORD` env var
- **State:** All in `page.tsx` as `useState` — no global store

## Key Patterns

- Masterlist loaded with `all_varchar=true` — numbers cast with `TRY_CAST` in SQL
- Artist-to-track join via case-insensitive name match + alias expansion
- Camelot key system for harmonic mixing transitions
- YouTube search via innertube API (`/api/search-yt`), no API key needed
