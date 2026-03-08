# Pyaar Radio

DJ setlist planning tool. Browse a curated artist/track library, filter by channel/vibes/BPM/tags, preview tracks via YouTube/SoundCloud, and build setlists with harmonic mixing indicators.

**Stack:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 + DuckDB WASM + YouTube IFrame API

**Live:** [pyaar-radio.vercel.app](https://pyaar-radio.vercel.app) (password-protected)

---

## Features

### Browse & Filter
- Curated artists with channel/samay/vibe metadata
- Filter by channel (Rave/Rap/Soul), samay (Day/Night), desi, vibes (20 tags), BPM range
- **Tag filters** pull from all masterlist tracks (YT Music playlist tags)
- **Fuzzy search** across artists and tracks (fuse.js)

### Radio Mode
- Shuffle play from filtered artists
- **BPM-aware**: next track within ±10/20/30 BPM of current
- **Key-compatible**: prefers Camelot-harmonic transitions
- **Tag radio**: when tags are active, draws from full masterlist
- Recently played tracking (avoids repeats)

### YouTube Preview
- Play any track via YouTube IFrame API
- Auto-search for tracks without Video ID (innertube API, no key needed)
- SoundCloud tracks supported via Soundcloud ID column
- Volume control with localStorage persistence
- Quick-add to setlist from player bar

### Setlist Builder
- **Drag-and-drop reorder** (dnd-kit), import from CSV/text, export to CSV
- **Transition preview**: BPM delta + Camelot key compatibility between adjacent tracks
- BPM range/average in header, currently playing track highlighted
- Multiple named setlists with localStorage persistence
- **Keyboard shortcuts** (hotkeys-js): space to play/pause, n for next, escape to close

### Mobile
- Responsive layout with collapsible filters and bottom-sheet setlist
- **Tap to play** / **double-tap to add** to setlist
- **Swipe right** to add, **swipe left** to play preview

---

## Architecture

### Data Pipeline

```
YouTube Music (Pyaar Radio account, @PyaarRadio)
  │
  ├─ Liked Music (9,370+ songs)
  ├─ Saved Albums (500+ albums)
  ├─ Monthly Playlists (53 playlists, e.g. "Feb 26", "Mirch 26")
  │     │
  │     ▼
  │   sync_liked.py ──▶ public/data/masterlist.csv (29K+ tracks)
  │     │                  Append-only, dedup by Video ID
  │     │                  Combines liked + albums + monthly playlists
  │     │
  │     ├─ Runs daily at 3 AM EST via GitHub Actions
  │     └─ Also runs locally via macOS LaunchAgent (backup)
  │
  └─ 244 Playlists (all playlists)
        │
        ▼
      sync_playlists.py ──▶ playlists/*.json (full snapshot)
        │                      Separate from masterlist, for analytics/search
        └─ Manual trigger via GitHub Actions (workflow_dispatch)

masterlist.csv ◀── hydrate_bpm.py (BPM/Key via essentia)
               ◀── hydrate_spotify.py (genres/popularity/dates)
               ◀── manual edits (Tags, SoundCloud IDs)

artists.csv ── manually curated (273 artists, gatekeeper for imports)
```

### Source of Truth

| Data | File | Updated by |
|------|------|------------|
| Tracks (29K+) | `public/data/masterlist.csv` | Auto-synced from YT Music daily via `sync_liked.py` |
| Artists (curated) | `public/data/artists.csv` | Edit directly in this repo |
| Playlists (244) | `playlists/*.json` | Manual trigger via `sync_playlists.py` |
| Setlists | `public/data/setlists.json` | Edit directly in this repo |

**GitHub is the source of truth.** No Obsidian vault or intermediate build step needed.

### What goes in the masterlist

The masterlist is composed of three YT Music sources, merged and deduped by Video ID:
1. **Liked songs** — everything in the "Liked Music" library
2. **Saved albums** — all albums saved/liked in the library
3. **Monthly playlists** — personal playlists named by month+year (e.g. "Feb 26", "Mirch 26", "Jooli '25", "Dec 25")

### What does NOT go in the masterlist

All other playlists (e.g. "shroomy (goated)", "Four Tet's Crate", genre playlists) live only in `playlists/*.json`. They are synced separately and never merged into the masterlist.

### Playlist Sync

All 244 YT Music playlists (including monthly ones) are saved as individual JSON files for analytics and search:

```
playlists/
  _index.json              # Metadata: playlist names, track counts, sync time
  PL6LTKg9AoNs2lITk....json  # Each playlist's full track list
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
    {"title": "...", "artist": "...", "album": "...", "videoId": "...", "duration": "..."}
  ]
}
```

### YouTube Music Sync

Both sync scripts use **ytmusicapi** with **browser cookie authentication** (not OAuth — Google killed OAuth for YT Music's InnerTube API in late 2024).

The browser cookies are extracted from a Chrome incognito session signed into the **Pyaar Radio** brand account (not the personal `@prah1aadr` account). Cookies last ~2 years.

#### Auth files

| File | Location | Purpose |
|------|----------|---------|
| `browser.json` | repo root (gitignored) | Browser cookies for local runs |
| `YTMUSIC_BROWSER_AUTH` | GitHub Secret | Same cookies for CI runs |

#### GitHub Actions

**Workflow:** `.github/workflows/sync-masterlist.yml`

| Trigger | What runs |
|---------|-----------|
| Daily cron (3 AM EST) | Masterlist sync + all playlists to JSON |
| Manual dispatch | Same as above |

### Adding New Content

**New tracks (YouTube):**
- Like songs, save albums, or add to monthly playlists in YT Music
- `sync_liked.py` picks them up on the next daily run
- Masterlist auto-pushes to this repo, Vercel auto-deploys

**New tracks (SoundCloud):**
- Add a row to `masterlist.csv` with the `Soundcloud ID` column filled in

**New artists:**
- Add a row to `public/data/artists.csv` with columns: name, channel, samay, desi, vibes, BPM range, aliases
- Commit and push — Vercel auto-deploys

---

## Data

### masterlist.csv (29K+ tracks)

Auto-synced from YT Music daily at 3AM (liked songs + saved albums + monthly playlists).

| Column | Auto-synced | Safe to edit |
|--------|-------------|--------------|
| Track Name, Artist Name(s), Album Name | Yes | No (overwritten) |
| Liked, Playlist 1-5, Playlist Count, Video ID | Yes | No (overwritten) |
| Genres, Tempo, Key, Popularity, Release Date, Instrumentalness | No | Yes |
| Tags | No | Yes (pipe-separated) |
| Soundcloud ID | No | Yes |
| Source | No | Yes (`YT Music`, `SoundCloud`, `Tamil`) |

### artists.csv (273 curated artists)

| Column | Format | Example |
|--------|--------|---------|
| artist | text | `Flying Lotus` |
| aliases | pipe-separated | `FlyLo\|Steven Ellison` |
| channel | Rave/Rap/Soul | `Rave` |
| samay | Day/Night/Day/Night | `Night` |
| desi | Desi/Non-Desi | `Non-Desi` |
| vibes | pipe-separated | `Bass\|Psych\|Future Beats` |
| bpm_low, bpm_high | number | `80`, `170` |

### Taxonomy

| Dimension | Values |
|-----------|--------|
| Channels | Rave, Rap, Soul |
| Samay | Day, Night, Day/Night |
| Desi | Desi, Non-Desi |
| Vibes (20) | Groove, Soulful, Rowdy, Nodders, Dark, Percussive, Rave, Bass, Dubstep, DnB, Dub, Club, Garage, Future Beats, Electronica, Ambient, Trap, Boom Bap, Pop |

DuckDB WASM queries both CSVs in the browser. No server-side database.

---

## File Structure

```
src/
├── app/
│   ├── page.tsx              # Main page, all state
│   ├── layout.tsx            # Root layout
│   ├── globals.css           # Tailwind + CSS vars
│   ├── login/page.tsx        # Password login
│   └── api/
│       ├── login/route.ts    # Auth API
│       ├── search-yt/route.ts # YouTube search proxy
│       └── search-sc/route.ts # SoundCloud search proxy
├── components/
│   ├── filter-panel.tsx      # Channel/samay/vibe/tag/BPM filters
│   ├── artist-list.tsx       # Scrollable artist list (virtualized)
│   ├── track-list.tsx        # Track table with key compatibility
│   ├── setlist.tsx           # Setlist sidebar with transitions
│   ├── setlist-picker.tsx    # Setlist name/switch UI
│   ├── youtube-player.tsx    # Fixed bottom player bar
│   └── import-modal.tsx      # Import setlist from text/CSV
├── lib/
│   ├── duckdb.ts             # DuckDB WASM init + query helper
│   ├── queries.ts            # SQL query builders
│   ├── camelot.ts            # Camelot key system utilities
│   └── types.ts              # TypeScript interfaces
└── middleware.ts             # Cookie-based auth

sync_liked.py                 # Daily sync: liked + albums + monthly → masterlist
sync_playlists.py             # Manual sync: all playlists → playlists/*.json
playlists/                    # Playlist JSON snapshots (gitignored from masterlist)
public/data/masterlist.csv    # 29K+ tracks
public/data/artists.csv       # 273 curated artists
```

---

## Development

```bash
bun install
bun run dev          # Start dev server
bun run build        # Production build
```

**Runtime:** Bun (not npm)

**Deploy:** Auto-deploys on push to `main` via Vercel.

### Manual sync

```bash
# In pyaar-radio repo:
python sync_liked.py --yes          # Sync liked + albums + monthly, auto-confirm + push
python sync_liked.py --dry          # Preview only
python sync_liked.py --yes --no-push # Sync without git push (CI mode)

python sync_playlists.py            # Sync all 244 playlists to JSON
python sync_playlists.py --dry      # Preview only

# In pyaar-crate repo (for hydration):
cd ~/Documents/Projects/03-music-audio/pyaar-crate
.venv/bin/python hydrate_bpm.py --vault-only     # BPM+Key via essentia
.venv/bin/python hydrate_spotify.py              # Genres/popularity/dates
.venv/bin/python sync_masterlist.py --yes        # Push hydrated data back
```
