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

# Full discography audit — flags every album not already in your library
.venv/bin/python -m radar audit

# Audit a single artist, only flag gaps from 2010+
.venv/bin/python -m radar audit --artist "Flying Lotus" --since 2010

# Audit + auto-save every gap (use sparingly — can save hundreds)
.venv/bin/python -m radar audit --save

# Classify audit_gap rows by signal quality (read-only report)
.venv/bin/python -m radar classify

# Bulk-dismiss derivative/compilation/themed_comp rows (clear noise)
.venv/bin/python -m radar classify --dismiss

# Dismiss every row from known label-channel artists (RAAJA BEATS, CHOR BAZAAR)
.venv/bin/python -m radar classify --dismiss-label-channels

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

## Monthly Workflow

A GitHub Action (`.github/workflows/radar-scan.yml`) runs on the **1st of every month**:

1. Scans all 294 curated artists for new albums/EPs
2. Exports new alerts to `radar-alerts.json`
3. Commits and pushes — Vercel deploys with updated triage list

Then when you're ready to triage:

```bash
bun run dev
# open localhost:3000/radar
# Save or Skip each album
```

Or save everything at once:
```bash
.venv/bin/python -m radar release --save
```

You can also trigger a scan manually from GitHub Actions → "Radar Monthly Scan" → "Run workflow".

## How It Works

1. Loads 294 curated artists from `public/data/artists.csv`
2. For each artist, searches YT Music for their artist page
3. Gets the latest album/EP from the albums section
4. Compares against `known_albums` table in `state.db` (DuckDB)
5. New albums get logged as `release_alerts` and exported to `public/data/radar-alerts.json`
6. With `--save`, new albums are also saved to YT Music library via `yt.rate_playlist()`
7. Next daily sync picks up saved albums into `albums/` and `masterlist.csv` automatically

## After Saving Albums

Run album sync to immediately update `albums.csv`:
```bash
.venv/bin/python sync_albums.py
```
Or wait for the daily 3 AM sync to pick them up automatically.

## Filters

- **Albums and EPs only** — singles are skipped (too noisy: features, remixes, loosies)
- **`release` command:** Last 2 years only — older albums skipped (avoids rereleases for monthly scan). Walks down the album list to find the first non-noise release.
- **`audit` command:** No year filter by default — fetches the *full* discography per artist via `get_artist_albums` and flags every album not in `known_albums`. Use `--since YEAR` to constrain. Audit gaps log with `release_type = 'audit_gap'` so they can be filtered separately from monthly release alerts.
- **Noise filter (both commands):** Titles matching derivative patterns (`(Instrumentals)`, `Deluxe Edition`, `Remastered`), compilation patterns (`Greatest Hits`, `Best Of`, `Anthology`, `20th Century Masters`), and themed-comp patterns (`Christmas`, `Workout`, `Eid Mubarak`, `Maestro Melodies`, etc.) are skipped at scan time. Patterns live in `release.py:NOISE_PATTERN`; the `classify` command mirrors the same patterns for retroactive cleanup of existing alerts.

## Cleanup workflow (when audit produces too much noise)

```bash
# 1. See the breakdown
.venv/bin/python -m radar classify

# 2. Dismiss the obvious noise
.venv/bin/python -m radar classify --dismiss

# 3. If a label-channel artist (e.g. an aggregator/film-composer label) is in artists.csv, drop it
#    and clear its queue:
.venv/bin/python -m radar classify --dismiss-label-channels
```

Dismissals update `release_alerts.status='dismissed'` and re-export `radar-alerts.json` so the triage UI reflects the cleanup immediately.

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

## Pyaar Crate (Discovery)

The Crate is a holding zone for artists/albums you want to explore but haven't committed to yet.

```bash
python -m radar crate                                    # List entries
python -m radar crate add "Artist" --source "NTS"        # Add to crate
python -m radar crate add "Artist" --album "Album Title" # With album
python -m radar crate promote "Artist"                   # Ready for artists.csv
python -m radar crate skip "Artist"                      # Dismiss
```

Frontend at `localhost:3000/crate` — add, promote, or skip with the same UI pattern.

Data lives in `public/data/crate.csv` with columns: artist, album, year, source, status, added_at, notes.

**Promote** marks an artist as ready — you then manually add them to `artists.csv` with channel, samay, desi, vibes, and BPM range to fully curate them.
