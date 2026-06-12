# Plan: remove the deprecated `channel` column

`channel` (Rave/Rap/Soul) was a per-artist station tag that overlapped with the
`__laad` pillars. The UI no longer uses it — **Stations** are now derived saved-filter
slices (`src/lib/stations.ts`). The column still lingers in `artists.csv`, the
`Artist` type, and a few queries. This plan scopes a clean removal. **Not yet executed.**

## Why it's safe to remove
- No UI control reads/writes `channel` anymore (pillars + stations replaced it).
- It's sparse/inconsistent already (~199 of 589 blank).
- Stations cover every meaningful channel slice via pillar filters.

## Current references (audit before executing)
| Location | Use | Action |
|---|---|---|
| `public/data/artists.csv` | `channel` column | Drop the column (additive-safe: drop last? no — it's mid-table, rewrite header+rows) |
| `src/lib/types.ts` | `Artist.channel` field | Remove field |
| `src/lib/duckdb.ts` | `SELECT * REPLACE(...)` | No change needed — `*` just stops seeing it once CSV drops it |
| `src/lib/queries.ts` | `buildArtistQuery` `channels` filter (`channel IN (...)`) | Remove the `filters.channels` branch |
| `src/app/page.tsx` | `filters.channels` (URL parse/build, `structuralFilters`, parse `r.channel`) | Remove channel parsing + URL param + dep |
| `src/lib/types.ts` | `ArtistFilters.channels` | Remove field (or keep as no-op for back-compat URLs) |
| `scripts/build-tv-channels.py` | reads `artists.csv` | Verify it doesn't depend on the `channel` column (it keys off `artist`) |
| `radar/*.py` | `csv.DictReader` | Safe — ignores missing keys |

## Steps (ordered, each independently verifiable)
1. **Grep sweep**: `grep -rn "channel" src` — enumerate every `.channel`/`channels` ref and confirm each is the artist-station meaning (not TV channels, which are unrelated).
2. **Code first, data last** (so the app tolerates both states):
   a. `queries.ts` — delete the `channels` filter branch.
   b. `page.tsx` — remove `r.channel` parse, the `channel` URL param read/write, and `filters.channels` from `structuralFilters` deps + `filtersActive`.
   c. `types.ts` — remove `Artist.channel`; keep `ArtistFilters.channels` as optional no-op for one release if old shared URLs (`?channel=`) matter, else remove.
3. **Data**: rewrite `artists.csv` dropping the `channel` column (Python `csv` round-trip, preserve CRLF). `SELECT *` in `duckdb.ts` auto-adjusts.
4. **Verify in-browser**: 589 artists load, pillar + station filters work, no binder error, no `undefined` channel labels.
5. **TV check**: run `python3 scripts/build-tv-channels.py --help`-level smoke or confirm it reads `artist` only.
6. Commit; auto-deploys.

## Risk / rollback
- Low risk: column is unused by UI. Main gotcha is the shared-URL `?channel=` param — decide keep-as-no-op vs hard-remove.
- Fully git-reversible. Do it on a branch, browser-verify, then merge.

## Estimate
~1 focused session. The data rewrite is trivial; the care is in the `page.tsx`
filter plumbing (channel is threaded through URL parse/build + memo deps).
