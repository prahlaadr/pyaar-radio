# Pyaar Radio

DJ music library and setlist tool. **GitHub is the source of truth** — no Obsidian vault needed.

**Live:** [pyaar-radio.vercel.app](https://pyaar-radio.vercel.app) | **Branch:** `main` | **Vercel:** auto-deploys on push

## Architecture Overview

```
YouTube Music (Pyaar Radio account, @PyaarRadio)
  │
  ├─ Liked Music (9,370+ songs)
  ├─ Saved Albums (500+ albums)
  ├─ Monthly Playlists (53 playlists, e.g. "Feb 26", "Mirch 26", "Jooli '25")
  │     │
  │     ▼
  │   sync_liked.py ──▶ public/data/masterlist.csv (append-only, dedup by Video ID)
  │     │                  Combines all three sources into one masterlist
  │     │
  │     ├─ Runs daily at 3 AM EST via GitHub Actions
  │     └─ Also runs locally via macOS LaunchAgent (backup)
  │
  └─ 244 Playlists (all playlists, including non-monthly ones)
        │
        ▼
      sync_playlists.py ──▶ playlists/*.json (full snapshot, separate from masterlist)
        │
        └─ Manual trigger via GitHub Actions (workflow_dispatch)

masterlist.csv ◀── hydrate_bpm.py (BPM/Key via essentia)
               ◀── hydrate_spotify.py (genres/popularity/dates)
               ◀── manual edits (Tags, SoundCloud IDs)

artists.csv ── manually curated (273 artists, gatekeeper for imports)
```

### Key Separation

- **masterlist.csv** = Liked songs + Saved albums + Monthly playlists. This is the app's data source.
- **playlists/*.json** = ALL YT Music playlists (for analytics/search). Synced separately, never written to the masterlist.
- **artists.csv** = curated artist list. Gatekeeper for any imports from external sources.

### What goes in the masterlist

The masterlist is composed of three YT Music sources, merged and deduped by Video ID:
1. **Liked songs** — everything in the "Liked Music" library
2. **Saved albums** — all albums saved/liked in the library
3. **Monthly playlists** — personal playlists named by month+year (e.g. "Feb 26", "Mirch 26", "Jooli '25", "Dec 25")

Monthly playlists are identified by regex patterns that match both standard month abbreviations and creative spellings (Mirch, Febyouary, Jooli, etc.).

### What does NOT go in the masterlist

All other playlists (e.g. "shroomy (goated)", "Four Tet's Crate", genre playlists) live only in `playlists/*.json`. They are never merged into the masterlist.

## YouTube Music Sync

### How it works

Both sync scripts use **ytmusicapi** with **browser cookie authentication** (not OAuth — Google killed OAuth for YT Music's InnerTube API in late 2024).

The browser cookies are extracted from a Chrome incognito session signed into the **Pyaar Radio** brand account (not the personal `@prah1aadr` account). Cookies last ~2 years.

### Auth files

| File | Location | Purpose |
|------|----------|---------|
| `browser.json` | repo root (gitignored) | Browser cookies for local runs |
| `YTMUSIC_BROWSER_AUTH` | GitHub Secret | Same cookies for CI runs |

### Refreshing auth (when cookies expire)

1. Open **incognito** Chrome window
2. Go to `music.youtube.com`, sign in
3. **Switch to Pyaar Radio account** (profile icon → Switch account)
4. Open DevTools → Network tab → click around → filter by `browse`
5. Right-click a POST request → Copy → Copy as cURL (bash)
6. Run:
```bash
cd ~/Documents/Projects/03-music-audio/pyaar-crate
.venv/bin/python setup_browser_auth.py --from-file <(pbpaste)
```
7. Copy to pyaar-radio: `cp browser.json ~/Documents/Projects/01-web-apps/pyaar-radio/`
8. Update GitHub Secret: `cat browser.json | gh secret set YTMUSIC_BROWSER_AUTH --repo prahlaadr/pyaar-radio`

### sync_liked.py (daily, automated)

Fetches liked songs, saved albums, and monthly playlists from YT Music and appends new ones to `masterlist.csv`.

- **Three sources**: liked songs + saved albums + monthly playlists (identified by regex)
- **Append-only**: existing rows are never modified or deleted
- **Deduplicates by Video ID**: same song won't be added twice across any source
- **Backs up** before every write to `backups/`

```bash
python sync_liked.py --yes          # Auto-confirm + push
python sync_liked.py --dry          # Preview only
python sync_liked.py --yes --no-push # Sync without git push (CI mode)
```

### sync_playlists.py (manual trigger)

Fetches all 244 playlists and saves each as a JSON file.

```bash
python sync_playlists.py       # Sync all playlists
python sync_playlists.py --dry # Preview only
```

Output structure:
```
playlists/
  _index.json              # Metadata: playlist names, track counts, sync time
  PL6LTKg9AoNs2lITk....json  # Each playlist's full track list
  PL6LTKg9AoNs2YPrW....json
  ...
```

Each playlist JSON contains:
```json
{
  "playlistId": "PL6LTKg9...",
  "title": "shroomy (goated)",
  "trackCount": 496,
  "syncedAt": "2026-03-08T...",
  "tracks": [
    {"title": "...", "artist": "...", "album": "...", "videoId": "...", "duration": "..."},
    ...
  ]
}
```

### GitHub Actions

**Workflow:** `.github/workflows/sync-masterlist.yml`

| Trigger | What runs |
|---------|-----------|
| Daily cron (3 AM EST) | Masterlist sync + all playlists to JSON |
| Manual dispatch | Same as above |

The Action installs Python + ytmusicapi, writes `browser.json` from the GitHub Secret, runs the sync, commits and pushes if there are changes, then deletes `browser.json`.

### Local backup (macOS LaunchAgent)

A LaunchAgent at `~/Library/LaunchAgents/com.masterlist-sync.daily.plist` also runs the sync at 3 AM when the laptop is on. Source plist lives in `~/Documents/Projects/03-music-audio/pyaar-crate/`. Uses the pyaar-crate venv and its own copy of `sync_masterlist.py` + `browser.json`.

Both local and GitHub Action can run safely — append-only + Video ID dedup means no conflicts.

### History of sync approaches (for context)

1. **ytmusicapi + OAuth** (Jan–Feb 2026): Broke when Google blocked OAuth for InnerTube API. Every run returned 0 songs.
2. **Playwright browser automation** (Feb–Mar 2026): Worked but only captured ~1,400 of 9,370 songs due to DOM virtualization during scrolling.
3. **ytmusicapi + browser cookies** (Mar 2026, current): Fetches all 9,370 songs reliably via direct API calls. No browser needed.

## Quick Reference — What to Do When User Says...

| Request | What to do |
|---------|------------|
| "Add a song" / "Add this track" | Add row to `public/data/masterlist.csv` — fill Artist Name(s), Track Name, and either Video ID (YouTube) or Soundcloud ID |
| "Add an artist" | Add row to `public/data/artists.csv` — fill artist, channel, samay, desi, vibes, bpm_low, bpm_high |
| "Change vibes for X" | Edit the `vibes` column in `artists.csv` (pipe-separated) |
| "Tag tracks" | Edit the `Tags` column in `masterlist.csv` (pipe-separated) |
| "Add BPM/key" | Edit `Tempo` and `Key` columns in `masterlist.csv` |
| "Sync from YT Music" | Run `python sync_liked.py --yes` in pyaar-radio, or trigger the GitHub Action |
| "Sync playlists" | Run `python sync_playlists.py` or trigger Action with `sync_playlists=true` |
| "Hydrate metadata" | Run hydration scripts in pyaar-crate (see below) |
| "Deploy" | Just push to `main` — Vercel auto-deploys |
| "Here's an export" / CSV of songs | **Only add tracks whose artist is already in `artists.csv`**. Match artist names (+ aliases) against the export. Ignore everything else. Set `Source` to the platform (SoundCloud, Tamil, etc.) |
| "Add this artist and their songs" | First add to `artists.csv`, then pull matching tracks from any provided export into `masterlist.csv` |
| "Auth expired" / "Sync returning 0" | Follow the "Refreshing auth" steps above |

### Import Rule

**`artists.csv` is the gatekeeper.** When importing tracks from any source (SoundCloud export, Bandcamp, manual list):
1. Match against artists already in `artists.csv` (check aliases too)
2. Only add tracks for matched artists to `masterlist.csv`
3. New artists must be added to `artists.csv` FIRST before their tracks can enter
4. Always set the `Source` column (`SoundCloud`, `Tamil`, `YT Music`, etc.)
5. Never bulk-import unmatched tracks — the masterlist is curated, not a dump

## Data Files

All in `public/data/`:

### masterlist.csv (29K+ tracks)
Auto-synced from YT Music daily at 3AM (liked songs + saved albums + monthly playlists). **Safe-to-edit columns:**

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
- **Vibes (20):** Groove, Soulful, Rowdy, Nodders, Dark, Percussive, Rave, Bass, Dubstep, DnB, Dub, Club, Garage, Future Beats, Electronica, Ambient, Trap, Boom Bap, Pop

## Crate Scripts (for hydration/sync)

Located in `~/Documents/Projects/03-music-audio/pyaar-crate/`:

```bash
cd ~/Documents/Projects/03-music-audio/pyaar-crate
.venv/bin/python sync_masterlist.py --yes      # Full sync + auto-push to deck
.venv/bin/python sync_masterlist.py --no-push   # Sync without pushing
.venv/bin/python sync_masterlist.py --dry        # Preview only
.venv/bin/python hydrate_bpm.py --vault-only     # BPM+Key for curated artists
.venv/bin/python hydrate_spotify.py              # Genres/popularity/dates
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
