# Canonical Drive Structure

The Lexar layout, finalized 2026-06-01. **V3** (`vision 3.0`,
`/music/RAAMI RADIO/`) is the master archive; **V1** (`vision 1`, `/DJ/`) is a
subset + staging area. Both use the same 4-folder top level. Snapshot of the
machine-readable skeleton lives in `structure.txt` (what `restore.sh` recreates).

```
<drive root>/
├── Crates/                          # DJ crates & rip collections
│   ├── Dar Disku FM
│   ├── Intros, Interludes, Loops, Waves   # synced from a YT playlist
│   ├── Soundcloud Rips
│   ├── Trivia Night
│   ├── beatsss
│   └── jungle usb
├── In Focus/                        # artist/producer deep catalogs
│   ├── Artists
│   └── Producers/<NAME>/            # ← sync_producer.py target
├── PYAAR.Radio/                     # the radio brand sets + monthly archive
│   ├── 001 Harini Iyer
│   ├── 002 KALKI
│   ├── 003 RAANI
│   └── Monthlys/YYYY-MM (Month)/    # ← sync_monthlys auto-sync target
└── Setlists/                        # materialized DJ setlists
    ├── 001-harini
    ├── Aisle 5
    ├── Beltline
    ├── Black Women R&B
    ├── Charcoal
    ├── Clubby
    ├── Daytimers
    ├── Harini
    ├── Snaps
    ├── Underground ATL
    ├── carnatic drummer boy
    ├── new electronica
    └── savage-videogame-nights
```

## How each branch gets repopulated

| Folder | Source | Re-downloadable? |
|---|---|---|
| `PYAAR.Radio/Monthlys/` | YT Music month-named playlists → `sync_usb.py` | ✅ yes |
| `In Focus/Producers/` | producer discography → `scripts/sync_producer.py` | ✅ mostly (YouTube-available tracks); rare tracks ❌ |
| `Setlists/` | Pyaar Radio CSVs → `/sync-setlist` | ✅ mostly; Soulseek-only tracks ❌ |
| `Crates/` | mixed (YT playlists, SoundCloud rips, hand-curated) | ⚠️ partial — rips & curated content are often rare-tier |
| `In Focus/Artists/` | `/deep-dive-artist` (Soulseek FLAC first) | ⚠️ HQ rips are rare-tier |

**Rare-tier** content (Soulseek FLAC, lucida Qobuz, no-YouTube tracks) is the
part the repo cannot rebuild — see `RECOVERY.md`.

## V3 ↔ V1 relationship

- V3 holds **everything**; V1 holds a **curated subset** pulled for sets
  (`./pull`) plus **staged downloads** awaiting promotion (`./uplift`).
- V3 capacity (~155 GB) exceeds V1 (~115 GB) **by design** — there is no full
  mirror. So V1 is never a complete backup of V3.
- Losing V1 → recover via `./pull` from V3. Losing V3 → rare tier is at risk
  unless separately backed up.
