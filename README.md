# Pyaar Radio

DJ setlist planning tool. Browse a curated artist/track library, filter by channel/vibes/BPM/tags, preview tracks via YouTube/SoundCloud, and build setlists with harmonic mixing indicators.

**Stack:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 + DuckDB WASM + YouTube IFrame API

**Live:** [pyaar-radio.vercel.app](https://pyaar-radio.vercel.app) (password-protected)

---

## Features

### Browse & Filter
- Curated artists with channel/samay/vibe metadata
- Filter by channel (Rave/Rap/Soul), samay (Day/Night), desi, vibes (15 tags), BPM range
- **Tag filters** pull from all 40K masterlist tracks (YT Music playlist tags)
- **Fuzzy search** across artists and tracks (fuse.js)

### Radio Mode
- Shuffle play from filtered artists
- **BPM-aware**: next track within ±10/20/30 BPM of current
- **Key-compatible**: prefers Camelot-harmonic transitions
- **Tag radio**: when tags are active, draws from full 40K-track masterlist
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

### Data Flow

```
  YT Music (40K+ tracks)
         |
  sync_masterlist.py (daily 3AM via launchd)
         |
  pyaar-crate/masterlist.csv
         |
  auto-copy + git push to this repo
         |
  public/data/masterlist.csv ──── public/data/artists.csv
  (tracks, auto-synced)           (artists, manually curated)
         |                                  |
         +──────── DuckDB WASM (in browser) ────────+
                           |
                       React UI
```

### Source of Truth

| Data | File | Updated by |
|------|------|------------|
| Tracks (40K+) | `public/data/masterlist.csv` | Auto-synced from YT Music daily, pushed automatically |
| Artists (curated) | `public/data/artists.csv` | Edit directly in this repo (GitHub, Claude Code, anywhere) |
| Tamil artists | `public/data/tamil.csv` | Edit directly in this repo |
| Setlists | `public/data/setlists.json` | Edit directly in this repo |

**GitHub is the source of truth.** No Obsidian vault or intermediate build step needed.

### Adding New Content

**New tracks (YouTube):**
- Add songs to your YT Music playlists or liked songs
- `sync_masterlist.py` picks them up on the next daily run
- Masterlist auto-pushes to this repo, Vercel auto-deploys

**New tracks (SoundCloud):**
- Add a row to `masterlist.csv` with the `Soundcloud ID` column filled in
- Leave `Video ID` blank (or fill both if the track exists on both platforms)

**New artists:**
- Add a row to `public/data/artists.csv` with columns: name, channel, samay, desi, vibes, BPM range, aliases
- Commit and push — Vercel auto-deploys

### File Structure

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
```

### Key Patterns

- **All state in page.tsx** as `useState` hooks — no global store
- **DuckDB WASM** runs SQL in the browser against CSV data
- **Masterlist loaded with `all_varchar=true`** — numbers cast with `TRY_CAST`
- **Artist-to-track join** via case-insensitive name match + alias expansion
- **Camelot key system** maps pitch class (0-11) to Camelot notation for harmonic mixing

### Taxonomy

| Dimension | Values |
|-----------|--------|
| Channels | Rave, Rap, Soul |
| Samay | Day, Night, Day/Night |
| Desi | Desi, Non-Desi |
| Vibes (15) | Groove, Soulful, Rowdy, Nodders, Rave, Psych, Bass, Percussive, Club, Future Beats, Pop, Dark, Trap, Boom Bap, UKG |

---

## Data

Two CSVs in `public/data/`:

- **masterlist.csv** — 40K+ tracks with tempo, key, duration, genres, popularity, tags, Video ID, Soundcloud ID
- **artists.csv** — curated artists with channel, vibes, samay, desi, BPM range, aliases

DuckDB WASM queries them in the browser. No server-side database.

### Masterlist Columns

| Column | Auto-synced | Safe to edit |
|--------|-------------|--------------|
| Track Name, Artist Name(s), Album Name | Yes | No (overwritten) |
| Liked, Playlist 1-5, Playlist Count, Video ID | Yes | No (overwritten) |
| Genres, Tempo, Key, Popularity, Release Date, Instrumentalness | No | Yes |
| Tags | No | Yes (pipe-separated) |
| Soundcloud ID | No | Yes |
| Source | No | Yes (`YT Music`, `SoundCloud`, `Tamil`) |

## Development

```bash
bun install
bun run dev          # Start dev server
bun run build        # Production build
```

**Runtime:** Bun (not npm)

**Deploy:** Auto-deploys on push to `main` via Vercel.

### Updating Your Library

1. Tracks sync automatically from YT Music daily (via `pyaar-crate/sync_masterlist.py`)
2. To add/edit artists: edit `public/data/artists.csv`, commit, push
3. To add SoundCloud tracks: add rows to `masterlist.csv` with `Soundcloud ID`
4. Vercel auto-deploys on push

### Manual sync

```bash
cd ~/Documents/Projects/03-music-audio/pyaar-crate
.venv/bin/python3.13 sync_masterlist.py --yes    # sync + auto-push to deck
.venv/bin/python3.13 sync_masterlist.py --no-push # sync without pushing
```
