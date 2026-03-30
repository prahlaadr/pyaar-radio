# Pyaar Radio

DJ music library and setlist tool. **GitHub is the source of truth** — no Obsidian vault needed.

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
               ◀── hydrate_spotify.py (genres/popularity/dates)
               ◀── manual edits (Tags, SoundCloud IDs)

artists.csv ── manually curated (273 artists, gatekeeper for imports)
```

### Three Separate Data Stores

| Store | Source | Script | Location |
|-------|--------|--------|----------|
| **masterlist.csv** | Liked songs + monthly playlists | `sync_liked.py` | `public/data/` |
| **albums/*.json** | Saved/liked albums | `sync_albums.py` | `albums/` |
| **playlists/*.json** | All 244 playlists | `sync_playlists.py` | `public/playlists/` |
| **artists.csv** | Manually curated (273) | Direct edit | `public/data/` |

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
cd ~/Documents/Projects/03-music-audio/pyaar-crate
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

### Local runs (pyaar-crate)

The pyaar-crate repo at `~/Documents/Projects/03-music-audio/pyaar-crate/` has a mirrored `sync_masterlist.py` (same 3-source approach) plus hydration scripts. It can be run manually but is not needed for daily sync — GitHub Actions handles that.

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

## USB Sync (PRAHLOUD Archive)

`sync_usb.py` syncs archive month/year playlists to `/Volumes/Lexar/RAAMI RADIO/PRAHLOUD/`.

**Usage:**
```bash
python3 sync_usb.py                          # sync all archive playlists
python3 sync_usb.py --months "March 26"      # sync specific months
python3 sync_usb.py --dry                    # preview only
python3 sync_usb.py --usb /path/to/usb      # custom USB path
```

**How it works:**
1. Reads archive playlists from `public/playlists/` (identified by month/year regex)
2. Compares against existing files on USB (fuzzy matching on title/artist)
3. Downloads missing tracks: Soulseek FLAC/320 first (`batch_grab.py`), yt-dlp MP3 fallback
4. Copies to USB folder: `2026/March 26` (2026+) or `2024-03 (March)` (pre-2026)

**Auto-trigger:** LaunchAgent `com.pyaar.sync-usb` runs on any disk mount. Logs: `/tmp/pyaar-sync-usb.log`.

**Key files:**
- `sync_usb.py` — the sync script
- `~/Library/LaunchAgents/com.pyaar.sync-usb.plist` — auto-mount trigger

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

## Pyaar.TV

Channel Surfer-inspired TV guide at `/tv`. Simulates live TV with YouTube videos.

**Live:** `pyaar-radio.vercel.app/tv` | **Docs:** `docs/pyaar-tv-requirements.md`

### How it works

- 53 channels, ~470 videos with real YouTube IDs and exact durations
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
