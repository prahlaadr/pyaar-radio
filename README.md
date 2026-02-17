# Pyaar Deck

DJ setlist planning tool. Browse a curated artist/track library, filter by channel/vibes/BPM/tags, preview tracks via YouTube, and build setlists with harmonic mixing indicators.

**Stack:** Next.js 16 + React 19 + TypeScript + Tailwind CSS v4 + DuckDB WASM + YouTube IFrame API

**Live:** [pyaar-deck.vercel.app](https://pyaar-deck.vercel.app) (password-protected)

---

## Features

### Browse & Filter
- **203 curated artists** from the Pyaar Radio Obsidian vault
- Filter by channel (Rave/Rap/Soul), samay (Day/Night), desi, vibes (17 tags), BPM range
- **Tag filters** pull from all 40K masterlist tracks (YT Music playlist tags)
- Full-text search across artists and tracks

### Radio Mode
- Shuffle play from filtered artists
- **BPM-aware**: next track within ±10/20/30 BPM of current
- **Key-compatible**: prefers Camelot-harmonic transitions
- **Tag radio**: when tags are active, draws from full 40K-track masterlist
- Recently played tracking (avoids repeats)

### YouTube Preview
- Play any track via YouTube IFrame API
- Auto-search for tracks without Video ID (innertube API, no key needed)
- Volume control with localStorage persistence
- Quick-add to setlist from player bar

### Setlist Builder
- Reorder, import from CSV/text, export to CSV
- **Transition preview**: BPM delta + Camelot key compatibility between adjacent tracks
- BPM range/average in header, currently playing track highlighted
- Multiple named setlists with localStorage persistence

### Mobile
- Responsive layout with collapsible filters and bottom-sheet setlist
- **Tap to play** / **double-tap to add** to setlist
- **Swipe right** to add, **swipe left** to play preview

---

## Architecture

### Data Flow

```
Vault (_data/artists.csv)     Crate (masterlist.csv)
203 curated artists            40K+ tracks
         |                              |
         +------ copy-data.sh ---------+
                      |
              public/data/*.csv
                      |
              DuckDB WASM (in browser)
                      |
              React UI
```

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
│       └── search-yt/route.ts # YouTube search proxy
├── components/
│   ├── filter-panel.tsx      # Channel/samay/vibe/tag/BPM filters
│   ├── artist-list.tsx       # Scrollable artist list
│   ├── track-list.tsx        # Track table with key compatibility
│   ├── setlist.tsx           # Setlist sidebar with transitions
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
| Vibes (17) | Groove, Soulful, Rowdy, Nodders, Rave, Psych, Bass, Percussive, Club, Future Beats, Pop, Lo-Fi, Dark, Global, Trap, Boom Bap, UKG |

---

## Data

Two CSVs from the Pyaar Radio Crate:

- **artists.csv** — curated artists with channel, vibes, samay, desi, BPM range
- **masterlist.csv** — all tracks with tempo, key, duration, genres, popularity, tags, video ID

CSVs are copied from the Obsidian vault at build time. DuckDB WASM queries them in the browser.

## Development

```bash
bun install
bun run dev          # Start dev server (copies data first)
bun run build        # Production build
bunx vercel --prod --yes  # Deploy to Vercel
```

**Runtime:** Bun (not npm)

**Data source:** CSVs copied from `~/Documents/Projects/12-pyaar-vault/Pyaar Vault/_data/` at build time via `scripts/copy-data.sh`. Set `PYAAR_DATA_DIR` env var to override.

### Updating Your Library

1. Update your crate in Obsidian (add artists, process playlists)
2. `bash scripts/copy-data.sh` to pull latest CSVs
3. `git add public/data/ && git commit -m "update library" && git push`

Vercel auto-deploys on push to `main`.
