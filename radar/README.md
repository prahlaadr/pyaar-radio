# Pyaar Radar

Release tracking for curated artists. Detects new albums/EPs and saves them to your YT Music library.

## Setup

```bash
cd ~/Documents/Projects/01-web-apps/pyaar-radio
uv venv && uv pip install duckdb ytmusicapi
```

Requires `browser.json` in the repo root (YT Music auth cookies). See main CLAUDE.md for refresh steps.

## Commands

```bash
# Scan all curated artists, report new releases
.venv/bin/python -m radar release

# Scan + auto-save new albums to YT Music library
.venv/bin/python -m radar release --save

# Check a single artist
.venv/bin/python -m radar release --artist "Flying Lotus"

# Seed known albums from albums/*.json (first run or reset)
.venv/bin/python -m radar seed

# View release alert history
.venv/bin/python -m radar report

# Ad-hoc DuckDB query against state
.venv/bin/python -m radar query "SELECT artist, COUNT(*) FROM known_albums GROUP BY artist ORDER BY 2 DESC LIMIT 10"
```

## Triage Frontend

```bash
bun run dev
# open localhost:3000/radar
```

Shows new releases with Save/Skip buttons. Save adds the album to your YT Music library directly. Only works locally (needs `browser.json`).

## How It Works

1. Loads 294 curated artists from `public/data/artists.csv`
2. For each artist, searches YT Music for their artist page
3. Gets the latest album/EP from the albums section
4. Compares against `known_albums` table in `state.db` (DuckDB)
5. New albums get logged as `release_alerts` and exported to `public/data/radar-alerts.json`
6. With `--save`, new albums are also saved to YT Music library via `yt.rate_playlist()`
7. Next daily sync picks up saved albums into `albums/` and `masterlist.csv` automatically

## Filters

- **Albums and EPs only** — singles are skipped (too noisy: features, remixes, loosies)
- **Last 2 years only** — albums older than `current_year - 1` are skipped (avoids old rereleases)

## State

`radar/state.db` (gitignored) — DuckDB database with three tables:

| Table | Purpose |
|-------|---------|
| `known_albums` | Every album we've seen (seeded from `albums/*.json`, ~3,067 rows) |
| `release_alerts` | Log of detected new releases with status (new/saved/dismissed) |
| `discovery_suggestions` | Future: artist discovery candidates |

If `state.db` is lost, run `python -m radar seed` to rebuild from the album JSONs.

## Files

```
radar/
  __init__.py
  __main__.py      # CLI entrypoint
  db.py            # DuckDB schema, seed, helpers
  release.py       # Release detection + YT Music save
  state.db         # DuckDB state (gitignored)
```

Frontend:
- `src/app/radar/page.tsx` — triage UI
- `src/app/api/radar/triage/route.ts` — save/dismiss API (calls YT Music)
- `public/data/radar-alerts.json` — exported alerts for frontend
