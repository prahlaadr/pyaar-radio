# Pyaar Radio

DJ music library and setlist tool. **GitHub is the source of truth** — no Obsidian vault needed.

## README Maintenance

When making changes to the Pyaar ecosystem (Radio, Radar, Crate, or Core), update the relevant README before committing:

| Change to | Update |
|-----------|--------|
| Radio features, data, automation | `README.md` |
| Radar CLI, release detection, triage | `radar/README.md` |
| Crate discovery flow | `radar/README.md` (Crate section) |
| Core hydration scripts | `~/03-music-audio/pyaar-core/README.md` |
| Ecosystem-wide changes | `README.md` (ecosystem diagram) |

**Live:** [pyaar-radio.vercel.app](https://pyaar-radio.vercel.app) | **Branch:** `main` | **Vercel:** auto-deploys on push

## Architecture Overview

```
YouTube Music (Pyaar Radio account, @PyaarRadio)
  │
  ├─ Liked Music (9,370+ songs)
  ├─ Monthly Playlists (53, e.g. "Feb 26", "Mirch 26", "Jooli '25")
  │     │
  │     ▼
  │   sync_liked.py ──▶ public/data/masterlist.csv (40K+ tracks)
  │     │                  Append-only, dedup by Video ID
  │     └─ Runs daily at 3 AM EST via GitHub Actions
  │
  ├─ Saved Albums (500+)
  │     │
  │     ▼
  │   sync_albums.py ──▶ albums/*.json (each album as JSON, incremental)
  │     │
  │     └─ Runs daily via GitHub Actions
  │
  └─ 244 Playlists (all playlists)
        │
        ▼
      sync_playlists.py ──▶ public/playlists/*.json (incremental snapshot)
        │                      Browser-accessible for playlist picker
        └─ Runs daily via GitHub Actions

masterlist.csv ◀── hydrate_bpm.py (BPM/Key via essentia)
               ◀── hydrate_release_date.py (Release Date from album JSONs, no API)
               ◀── manual edits (Tags, SoundCloud IDs)

artists.csv ── manually curated (294 artists, gatekeeper for imports)
```

### Three Separate Data Stores

| Store | Source | Script | Location |
|-------|--------|--------|----------|
| **masterlist.csv** | Liked songs + monthly playlists | `sync_liked.py` | `public/data/` |
| **albums/*.json** | Saved/liked albums | `sync_albums.py` | `albums/` |
| **playlists/*.json** | All 244 playlists | `sync_playlists.py` | `public/playlists/` |
| **artists.csv** | Manually curated (294, see PRs for additions) | Direct edit | `public/data/` |

Each is synced independently. They never bleed into each other.

### What goes in the masterlist

The masterlist is composed of two YT Music sources, merged and deduped by Video ID:
1. **Liked songs** — everything in the "Liked Music" library
2. **Monthly playlists** — personal playlists named by month+year (e.g. "Feb 26", "Mirch 26", "Jooli '25", "Dec 25")

Monthly playlists are identified by regex patterns that match both standard month abbreviations and creative spellings (Mirch, Febyouary, Jooli, etc.).

### What does NOT go in the masterlist

- **Saved albums** → `albums/*.json` (each album as its own JSON file with tracks)
- **Other playlists** (e.g. "shroomy (goated)", "Four Tet's Crate") → `playlists/*.json`

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
cd ~/Documents/Projects/03-music-audio/pyaar-core
.venv/bin/python setup_browser_auth.py --from-file <(pbpaste)
```
7. Copy to pyaar-radio: `cp browser.json ~/Documents/Projects/01-web-apps/pyaar-radio/`
8. Update GitHub Secret: `cat browser.json | gh secret set YTMUSIC_BROWSER_AUTH --repo prahlaadr/pyaar-radio`

### sync_liked.py (daily, automated)

Fetches liked songs and monthly playlists from YT Music and appends new ones to `masterlist.csv`.

- **Two sources**: liked songs + monthly playlists (identified by regex)
- **Append-only**: existing rows are never modified or deleted
- **Deduplicates by Video ID**: same song won't be added twice
- **Backs up** before every write to `backups/`

```bash
python sync_liked.py --yes          # Auto-confirm + push
python sync_liked.py --dry          # Preview only
python sync_liked.py --yes --no-push # Sync without git push (CI mode)
```

### sync_albums.py (daily, automated)

Fetches all saved albums and saves each as a JSON file in `albums/`. Incremental — only fetches albums not already synced.

```bash
python sync_albums.py        # Incremental sync
python sync_albums.py --full # Force re-fetch all albums
python sync_albums.py --dry  # Preview only
```

Output structure:
```
albums/
  _index.json              # Metadata: album names, artists, track counts
  MPREb_abc123....json     # Each album's tracks
```

### sync_playlists.py (daily, automated)

Fetches all 244 playlists and saves each as a JSON file. Incremental — only re-fetches playlists whose track count changed.

```bash
python sync_playlists.py        # Incremental sync
python sync_playlists.py --full # Force re-fetch all playlists
python sync_playlists.py --dry  # Preview only
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

The Action:
1. Verifies auth before syncing (catches expired cookies early)
2. Runs masterlist sync (liked + monthly playlists)
3. Runs album sync (saved albums → `albums/*.json`, incremental)
4. Runs playlist sync (all playlists → `playlists/*.json`, incremental)
5. Commits and pushes if there are changes
6. On failure: auto-creates a GitHub Issue labeled `sync-failure` with a link to the failed run

### Local runs (pyaar-core)

The pyaar-core repo at `~/Documents/Projects/03-music-audio/pyaar-core/` has a mirrored `sync_masterlist.py` (same 3-source approach) plus hydration scripts. It can be run manually but is not needed for daily sync — GitHub Actions handles that.

### History of sync approaches (for context)

1. **ytmusicapi + OAuth** (Jan–Feb 2026): Broke when Google blocked OAuth for InnerTube API. Every run returned 0 songs.
2. **Playwright browser automation** (Feb–Mar 2026): Worked but only captured ~1,400 of 9,370 songs due to DOM virtualization during scrolling.
3. **ytmusicapi + browser cookies** (Mar 2026, current): Fetches all 9,370 songs reliably via direct API calls. No browser needed.

## Playlist Picker (Setlists Tab)

The Setlists tab includes a **Playlist Picker** that lets you browse and load any of your 238 YT Music playlists as a setlist.

**How it works:**
1. Playlist JSONs live in `public/playlists/` (deployed with the app, synced daily)
2. `_index.json` is fetched on mount, individual playlist JSONs fetched on click
3. Tracks are batch-matched against masterlist via DuckDB for BPM/key enrichment (chunked in groups of 200)
4. Unmatched tracks are kept as playable stubs (they have video IDs from YT Music)
5. Loaded playlist auto-saves as a browser setlist

**Sections** (categorized automatically):
| Section | Color | Contents | Sort |
|---------|-------|----------|------|
| Archive | amber | Month/year playlists (Mar 26, Febyouary '22, etc.) | Newest first |
| Pyaar Radio | red | PYAAR.Radio sets (001, 002, 003) | As-is |
| DJ Sets | purple | Goated playlists, DJ-themed, USB sets | As-is |
| Curated | green | Mood/vibe playlists (10+ tracks) | As-is |
| Discovery | blue | External/large playlists (NTS, RA, Four Tet, 500+ tracks) | As-is |
| Other | gray | Small misc playlists (<10 tracks) | As-is |

**Key files:**
- `src/components/playlist-picker.tsx` — UI component with categorization logic
- `src/lib/playlists.ts` — fetch utilities (cached index, individual playlist fetch)
- `src/lib/types.ts` — `PlaylistIndexEntry`, `PlaylistData` interfaces

## Drive Model: V3 master, V1 subset + staging

**V3** (vision 3.0, `/music/RAAMI RADIO/`) is the canonical archive — every track ever downloaded lives here. **V1** (vision 1, `/DJ/`) plays two roles:
1. **Subset** — curated folders pulled for upcoming DJ sets (`./pull`)
2. **Staging** — downloads land here when V3 isn't plugged in, then get promoted to V3 on next reconnect (`./uplift`)

V3 (~155 GB and growing) exceeds V1's 115 GB by design — there is **no full mirror**. Drive paths come from `~/.config/pyaar-sync/drives.json` (override via `PYAAR_V1_ROOT` / `PYAAR_V3_ROOT` env vars) — never hardcoded. The resolver is `pyaar_drives.py`; `get_write_root()` returns V3 if mounted else V1.

### Three commands

| Direction | Command | When |
|---|---|---|
| V3 → V1 | `./pull "<subpath>"` | Before a set, pulling a folder onto the working drive |
| external → V3 (or V1 fallback) | `sync_usb.py`, `dive*.py`, `chart_to_setlist.py` | New music arriving |
| V1 → V3 | `./uplift` | After V3 reconnects, promote V1-staged downloads |

### `./pull` — V3 → V1 selective copy

```bash
./pull --list                                    # show V3 top-level + 2nd-level paths with sizes
./pull "Setlists/Underground ATL"                # pull one folder
./pull "Crates/Trivia Night" "Setlists/Charcoal" # pull multiple
./pull --dry "In Focus/Producers/Hudson Mohawke" # preview first
```

Wraps `sync_v1_v3.py` → `rsync -au --inplace --exclude='._*' --exclude='.DS_Store'`. No `--delete`. Pre-flight free-space check aborts if V1 would overflow (5% buffer). Refuses to full-mirror — explicit folder args required.

### `./uplift` — V1 → V3 promotion (additive)

```bash
./uplift                          # walk all 4 canonical V1 folders
./uplift "PYAAR.Radio/Monthlys"   # restrict to one subpath
./uplift --dry                    # preview only
./uplift --verbose                # log every file (incl. skips)
```

Walks only the 4 V3-canonical V1 folders (Crates, In Focus, PYAAR.Radio, Setlists) — V1-only content (Engine Library etc.) is left alone. Dedup is exact-path AND same-directory canonical-stem (so V1 `Track (168).mp3` is recognized as already-on-V3 `Track.mp3` and skipped). V1 files stay after uplift (no destructive ops).

### Monthly archive auto-download chain

`sync_monthlys.sh` orchestrates:
1. `git pull` — catches GitHub Action commits from daily cron
2. `sync_monthly_playlists.py` — **targeted incremental fetch of only "Month YY" playlists** (faster than walking all 244)
3. `sync_usb.py --flat` — downloads to V3 PYAAR.Radio/Monthlys/ (or V1 fallback)

```bash
.venv/bin/python sync_usb.py --dry                                    # preview
.venv/bin/python sync_usb.py --months "March 26"                      # one month
.venv/bin/python sync_monthly_playlists.py <playlist_id>              # one-shot ID fetch (fastest)
.venv/bin/python sync_usb.py --usb /override/path                     # override target
```

### LaunchAgents

| Plist | Status | What it does |
|---|---|---|
| `com.pyaar.sync-v1-v3.plist` | **DELETED 2026-06-01** | Full mirror is impossible by design. Use `./pull` manually. |
| `com.pyaar.sync-monthlys.plist` | UNLOADED | Auto-fires `sync_monthlys.sh` on disk mount. Re-enable with `launchctl load`. |
| `com.pyaar.uplift-on-v3-mount.plist` | UNLOADED | Auto-fires `uplift_to_v3.py` on V3 mount (safe — additive). Re-enable with `launchctl load`. |
| `com.pyaar.sync-usb.plist` | unchanged | Separate agent for the old PRAHLOUD USB drive (independent). |

### Key files (this repo)

- `sync_v1_v3.py` + `pull` — V3 → V1 selective pull
- `uplift_to_v3.py` + `uplift` — V1 → V3 staged-uplift with canonical-stem dedup
- `sync_usb.py` — YT Music → V3 (or V1 fallback) Monthlys downloader
- `sync_monthly_playlists.py` — targeted monthly-playlist sync (cheap)
- `sync_monthlys.sh` — chain wrapper (git pull → monthly sync → usb download)
- `pyaar_drives.py` — `get_root()`, `get_root_optional()`, `get_write_root()` (V3-then-V1)
- `scripts/in_focus_audit.py` — drive-resolved producer-list audit
- `~/.config/pyaar-sync/drives.json` — canonical drive paths config

## Quick Reference — What to Do When User Says...

| Request | What to do |
|---------|------------|
| "Add a song" / "Add this track" | Add row to `public/data/masterlist.csv` — fill Artist Name(s), Track Name, and either Video ID (YouTube) or Soundcloud ID |
| "Add an artist" | Add row to `public/data/artists.csv` — fill artist, channel, samay, desi, vibes, bpm_low, bpm_high |
| "Change vibes for X" | Edit the `vibes` column in `artists.csv` (pipe-separated) |
| "Tag tracks" | Edit the `Tags` column in `masterlist.csv` (pipe-separated) |
| "Add BPM/key" | Edit `Tempo` and `Key` columns in `masterlist.csv` |
| "Sync from YT Music" | Run `python sync_liked.py --yes` in pyaar-radio, or trigger the GitHub Action |
| "Triage new releases" | Open the GH issue auto-opened by radar-scan, then either click through `/radar` UI or run the bulk HTML triage. See "Radar & Triage Pipeline" section. |
| "Apply my triage picks" | Commit export to `triage-runs/YYYY-MM-DD.json`, then `gh workflow run triage-apply.yml -f triage_path=… -f mode=apply -f run_sync=true` |
| "Find missing albums" | Local: `.venv/bin/python -m radar audit --save` (or without `--save` for report-only). Heavy — runs against full discographies. |
| "Refresh In Focus producer albums" | Local: `.venv/bin/python scripts/in_focus_audit.py` → writes `triage-runs/in-focus-YYYY-MM-DD.json`. Then `gh workflow run triage-apply.yml -f triage_path=… -f mode=apply -f run_sync=true`. Producer list: `data/in_focus_producers.txt`. Multi-source: Discogs → MusicBrainz → YT artist page. |
| "Run radar manually" | `gh workflow run radar-scan.yml --repo prahlaadr/pyaar-radio` |
| "Sync playlists" | Run `python sync_playlists.py` or trigger Action with `sync_playlists=true` |
| "Hydrate metadata" | Run hydration scripts in pyaar-core (see below) |
| "Deploy" | Just push to `main` — Vercel auto-deploys |
| "Here's an export" / CSV of songs | **Only add tracks whose artist is already in `artists.csv`**. Match artist names (+ aliases) against the export. Ignore everything else. Set `Source` to the platform (SoundCloud, Tamil, etc.) |
| "Add this artist and their songs" | First add to `artists.csv`, then pull matching tracks from any provided export into `masterlist.csv` |
| "Auth expired" / "Sync returning 0" | Follow the "Refreshing auth" steps above |
| "Add a TV channel" | Add to `STANDARD_CHANNELS` in `scripts/build-tv-channels.py`, run `python3 scripts/build-tv-channels.py` |
| "Add this YouTube channel to TV" | Same as above — use `https://www.youtube.com/@handle/videos` as source |
| "I liked a video, add it to TV" | Add playlist URL to `PRIORITY_PLAYLISTS` in `build-tv-channels.py`, or add video directly to `channels.json` |
| "Refresh TV channels" | Run `python3 scripts/build-tv-channels.py` or trigger `sync-tv-channels` Action |

### Import Rule

**`artists.csv` is the gatekeeper.** When importing tracks from any source (SoundCloud export, Bandcamp, manual list):
1. Match against artists already in `artists.csv` (check aliases too)
2. Only add tracks for matched artists to `masterlist.csv`
3. New artists must be added to `artists.csv` FIRST before their tracks can enter
4. Always set the `Source` column (`SoundCloud`, `Tamil`, `YT Music`, etc.)
5. Never bulk-import unmatched tracks — the masterlist is curated, not a dump

## Data Files

All in `public/data/`:

### masterlist.csv (40K+ tracks)
Auto-synced from YT Music daily at 3AM (liked songs + monthly playlists). **Safe-to-edit columns:**

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

### artists.csv (294 curated artists)
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

Located in `~/Documents/Projects/03-music-audio/pyaar-core/`:

```bash
cd ~/Documents/Projects/03-music-audio/pyaar-core
.venv/bin/python sync_masterlist.py --yes      # Full sync + auto-push to deck
.venv/bin/python sync_masterlist.py --no-push   # Sync without pushing
.venv/bin/python sync_masterlist.py --dry        # Preview only
.venv/bin/python hydrate_bpm.py --vault-only     # BPM+Key for curated artists
# hydrate_spotify.py removed 2026-04-27 — Spotify Premium required on dev account
# For Release Date use: cd ~/Documents/Projects/01-web-apps/pyaar-radio && .venv/bin/python hydrate_release_date.py --apply
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

## Radar & Triage Pipeline

How new music gets into the library. Three-stage loop: **scan → triage → apply**.

### Stage 1: Scan (automatic, monthly)

`.github/workflows/radar-scan.yml` runs on the 1st of each month at 9 AM EST. It:

1. Loads the 294 artists in `public/data/artists.csv`
2. For each, fetches their latest album/EP from YT Music
3. Filters out noise (compilations, anniversary editions, instrumentals — see `radar/release.py:NOISE_PATTERN`)
4. Compares against `known_albums` table in `radar/state.db` (DuckDB)
5. New ones get logged to `release_alerts` and exported to `public/data/radar-alerts.json`
6. Commits + pushes (Vercel auto-deploys)
7. **Auto-opens a GitHub issue** titled *"Radar Triage Ready: N new albums (YYYY-MM)"* with the new alerts as a checklist + run instructions

### Stage 2: Triage (manual, monthly)

When the issue lands:

**Option A — `/radar` UI** (fast, single-album-at-a-time): Visit `radio.pyaarproject.org/radar` and click Save / Skip. Save calls YT Music directly via `yt.rate_playlist`. Only handles the radar's monthly delta.

**Option B — Bulk HTML triage** (combines radar + audit + manual catch-up): Regenerate `~/Desktop/pyaar-triage.html` (the standalone keyboard-driven triage tool). Combines:
- Fresh radar alerts (`public/data/radar-alerts.json`)
- Audit gaps (full discography sweep — see Stage 3 below)
- Manual additions

Spacebar saves, `x` skips, `↑/↓` (or `j/k`) navigates. Persists in localStorage. Click *Export picks ↓* to download `pyaar-triage-YYYY-MM-DD.json`.

### Stage 3: Apply (semi-automatic)

Commit the exported triage JSON to `triage-runs/YYYY-MM-DD.json`, then run the apply workflow:

```bash
gh workflow run triage-apply.yml --repo prahlaadr/pyaar-radio \
  -f triage_path=triage-runs/2026-05-15.json -f mode=dry
# review the .log.json that gets committed
gh workflow run triage-apply.yml --repo prahlaadr/pyaar-radio \
  -f triage_path=triage-runs/2026-05-15.json -f mode=apply -f run_sync=true
```

`scripts/triage_apply.py` does the work:
- For each album: searches YT Music (or uses `browseId` if from radar), then `yt.get_album → yt.rate_playlist(audioPlaylistId, "LIKE")`
- For each single: searches → `yt.rate_song(videoId, "LIKE")`
- Writes `triage-runs/YYYY-MM-DD.log.json` with every match decision + status (`saved` / `liked` / `no-match` / `error`)
- With `run_sync=true`, immediately runs `sync_liked.py` + `sync_albums.py` to refresh CSVs (instead of waiting for the 3 AM daily sync)

**Both modes require auth** — unauthenticated YT Music search misses ~85% of albums. The workflow always writes `browser.json` from the `YTMUSIC_BROWSER_AUTH` secret.

### The `in_focus_audit.py` script (curated-list sweep)

`scripts/in_focus_audit.py` runs a multi-source album sweep against a curated producer list (default `data/in_focus_producers.txt`, mirrors `/Volumes/vision 1/DJ/In Focus/Producers/`). Different from `radar audit` — which walks every artist in `artists.csv` — this targets a specific producer list and is the right tool for "make sure all my favorite producers have catalog in Pyaar Radio".

```bash
cd ~/Documents/Projects/01-web-apps/pyaar-radio
.venv/bin/python scripts/in_focus_audit.py                  # default: top 5, min 3 tracks
.venv/bin/python scripts/in_focus_audit.py --top-n 3        # tighter
.venv/bin/python scripts/in_focus_audit.py --lexar-cross-check  # also scan Lexar folder filenames for held-back albums
```

Output: `triage-runs/in-focus-YYYY-MM-DD.json` — feeds directly into `triage-apply.yml` (same as radar triage). Pipeline: Discogs (artist-ID disambiguated, format=Album) → MusicBrainz (release-groups, album+ep) → YT Music artist page → optional Lexar folder filenames. Filters to `trackCount >= min_tracks` to drop singles. Dedupes against existing `albums.csv` + `albums/_index.json`.

To refresh the producer list from Lexar:
```bash
ls "/Volumes/vision 1/DJ/In Focus/Producers/" | grep -v "^\." > data/in_focus_producers.txt
```

### The `audit` command (deeper sweep, local-only)

`radar audit` walks every artist's full discography (not just the latest), flags every album not in `known_albums`. Use this to catch up on back-catalogue, not for monthly cadence. **Local only** (CI doesn't run audit — too heavy).

```bash
cd ~/Documents/Projects/01-web-apps/pyaar-radio
.venv/bin/python -m radar audit                     # full discography sweep
.venv/bin/python -m radar audit --since 2010        # year-bound
.venv/bin/python -m radar audit --artist "Yaeji"    # single artist
.venv/bin/python -m radar audit --save              # save every gap (use sparingly)
.venv/bin/python -m radar classify --dismiss        # bulk-clean derivative/comp noise
```

Audit output drops into `release_alerts` with `release_type='audit_gap'` so it filters separately from monthly release alerts. The standalone `~/Desktop/pyaar-triage.html` reads from a one-off `~/Desktop/missing-albums.md` produced by an audit run (regenerate as needed).

### Triage troubleshooting

| Failure mode | Cause | Fix |
|---|---|---|
| Album → `error: no audioPlaylistId` | Album is unreleased / pre-save / placeholder ("Upcoming Album") | Skip; re-triage next month after release |
| Album → `error: Unable to find 'contents' using path …` | YT Music returned an unexpected schema | Try `yt.get_album(browseId)` manually; usually a single-track release misclassified as album |
| Album → `NO MATCH` | Search returned no result with matching artist+title | Save manually in YT Music, or check spelling/aliases in artists.csv |
| Workflow → `auth failed` | Browser cookies expired (~2 years) | Refresh per "Refreshing auth" section above + update `YTMUSIC_BROWSER_AUTH` secret |
| All matches NO MATCH in dry-run | Script ran without auth | Already fixed in `de5517d` — dry-mode now requires auth too |

### Workflow orchestration (one place)

| Workflow | Schedule | Purpose | Output |
|---|---|---|---|
| `sync-masterlist.yml` | Daily 3 AM EST | Pull liked + monthly playlists + saved albums + all playlists from YT Music | `masterlist.csv`, `albums.csv`, `albums/*.json`, `public/playlists/*.json` |
| `radar-scan.yml` | Monthly 1st @ 9 AM EST | Find new releases from 294 tracked artists; open triage issue | `radar-alerts.json` + GitHub issue |
| `triage-apply.yml` | Manual dispatch | Apply triage picks (save albums, like singles); refresh CSVs | YT Music library mutations + `triage-runs/*.log.json` |
| `sync-tv-channels.yml` | Weekly Sunday 7 AM EST | Refresh Pyaar.TV channel videos | `public/data/tv/channels.json` |

All workflows: `permissions: contents: write` (commit), `issues: write` (open issues on failure or triage-ready). Both monthly + apply use `YTMUSIC_BROWSER_AUTH` secret for YT Music auth.

## Pyaar.TV

Channel Surfer-inspired TV guide at `/tv`. Simulates live TV with YouTube videos.

**Live:** `pyaar-radio.vercel.app/tv` | **Docs:** `docs/pyaar-tv-requirements.md`

### How it works

- 85 channels, ~1770 videos with real YouTube IDs and exact durations
- "Live" scheduling: `position = Date.now() % totalPlaylistDuration` — everyone sees the same content at the same time
- Skip button to advance to next video in playlist
- TV button in header bar, hides setlist sidebar when active
- Auto-refreshed weekly via GitHub Actions (`sync-tv-channels.yml`)

### Channel data pipeline

```
artists.csv (294 curated artists)
  │
  ├─ Standard channels: yt-dlp pulls latest from YouTube channel URLs
  │
  ├─ Personalized channels (6): cross-references artists.csv
  │     Boiler Room, Tiny Desk, COLORS, Like a Version, KEXP, Coke Studio
  │     For each artist → ytsearch "{artist} {platform}" → validate artist in title
  │
  ├─ Priority playlists: user's YouTube liked videos playlists
  │     Videos matched to channels by keywords (e.g. "tiny desk" → Tiny Desk channel)
  │     Checked BEFORE artist search — liked videos get priority
  │
  └─ Output: public/data/tv/channels.json
```

### Adding channels/videos

| Task | How |
|------|-----|
| Add a new channel | Add entry to `STANDARD_CHANNELS` in `scripts/build-tv-channels.py`, run script |
| Add a personalized channel | Add to `PERSONALIZED_CHANNELS` with platform query + min duration |
| Add a priority playlist | Add YouTube playlist URL to `PRIORITY_PLAYLISTS` in the script |
| Refresh all channels | `python3 scripts/build-tv-channels.py` (or wait for weekly Action) |
| Add a single video to existing channel | Edit `public/data/tv/channels.json` directly |

### Key files

| File | Purpose |
|------|---------|
| `scripts/build-tv-channels.py` | Channel builder — source of truth for channel definitions |
| `public/data/tv/channels.json` | Generated output — real video IDs + exact durations |
| `.github/workflows/sync-tv-channels.yml` | Weekly auto-refresh (Sundays 7 AM EST) |
| `src/components/tv-player.tsx` | Full-size YouTube player with skip button |
| `src/components/tv-guide.tsx` | Channel guide with live progress bars |
| `src/lib/tv-types.ts` | TypeScript interfaces |
| `src/lib/tv-schedule.ts` | Scheduling algorithm |
| `src/lib/youtube-api.ts` | Shared YouTube IFrame API loader |
| `docs/pyaar-tv-requirements.md` | Full feature spec and architecture docs |
