# Radar Rosters DESIGN (My Artists + Pyaar Records)

The "how" for `docs/pyaar-records-SPEC.md`. Two roster tabs, one scan, built on
the existing Radar.

## Two data models, one scan (do NOT merge them)

- **My Artists** stays the existing **delta radar**: `release_alerts` (DuckDB) ->
  `public/data/radar-alerts.json`, consumed by `/radar` and by `radar doctor`'s
  parity check. That shape is unchanged; we only expand its **roster**.
- **Pyaar Records** is a **computed grid**, not a delta: per roster artist, the 3
  latest projects each with a saved boolean. It gets its own artifact
  (`public/data/records-grid.json`) and its own page (`/radar/records`), and
  reuses the reconcile + Save/Apply plumbing but NOT `release_alerts`.

Rationale: forcing a "latest 3 + saved" grid into the delta-alert schema would
contort the table and risk the radar + health check just hardened. Two clean
shapes beat one overloaded one.

## Roster abstraction

- **Curated** = `artists.csv` (names + aliases). The gatekeeper; drives the whole
  app (filters, TV). Unchanged.
- **Derived (My Artists auto-grow)** = artists with `>= 2` saved albums in
  `albums/_index.json`, MINUS curated (normalized name/alias), MINUS a small
  aggregator denylist. Computed live from `_index.json` (committed + daily
  synced), so the cloud scan auto-includes them. ~340 today.
- **My Artists scan roster** = curated UNION derived.
- **Records roster** = Rolodex snapshot (`Source = pyaar.radio`, `Circle =
  Artist/Creator`), music-resolved, ambiguous matches to a review bucket.
  (Phase 2+.)

## Release-active gate = the scan-time recency window, not a membership pre-gate

Membership is cheap: `>= 2` saved albums, minus curated, minus denylist. We do
NOT pre-gate on saved-album recency. "Release-active" is enforced where the scan
already does it: `find_latest_releases` only surfaces releases within the
recency window. A legacy artist (ABBA, 2Pac) in the roster simply surfaces
nothing, a wasted fetch, never a junk alert. The window is the single tunable
knob (`RECENCY_YEARS_BACK` in `release.py`).

Why not pre-gate on saved recency: it would drop the prime discovery target, an
artist collected years ago whose newest saved album is old but who just dropped
a new one. That is exactly the album we most want to surface.

## Denylist stays tiny

You do not deliberately save 2+ albums from a label/aggregator channel, so the
`>= 2` bar is already the strongest filter. Seed the denylist with the two known
offenders (RAAJA BEATS, CHOR BAZAAR) and let real data say if more are needed.
Prolific real artists (A. R. Rahman) are NOT noise; the denylist targets
aggregator channels with implausible catalogs, not prolific individuals.

## Promote

Derived artists are radar-only; they are never auto-written into `artists.csv`
(which needs curated metadata for the app's filters/TV). A one-click **promote**
adds a curated row on demand (Phase 3).

## Phasing

- **P1 (this change):** `radar/roster.py` (curated/derived/union loaders +
  denylist), a `radar roster` inspector, and wiring the full release scan to the
  union. Backend only, over existing data, verifiable against the ~340.
- **P2:** Records resolution spike (~30 follows) to measure precision; then the
  Rolodex query -> music resolve -> review-bucket pipeline and the
  `records-grid.json` artifact.
- **P3:** UI. My Artists tab (the existing `/radar`, now over the expanded
  roster) + a new `/radar/records` grid tab + the promote action + the
  review-bucket UI.

## Files

- `radar/roster.py` (new, P1): roster loaders + denylist.
- `radar/__main__.py` (P1): `roster` subcommand; full release scan uses the union.
- `radar/release.py` (P1): recency window extracted to `RECENCY_YEARS_BACK`.
- `radar/records.py` (P2, new): Rolodex query + resolve + grid builder.
- `public/data/records-grid.json` (P2): the Records artifact.
- `src/app/radar/records/page.tsx` + promote API (P3).
