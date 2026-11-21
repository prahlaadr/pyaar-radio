# Playlist Sources

A **source** turns some corner of the internet into **one YouTube Music playlist**,
on a monthly schedule, idempotently. pi.fyi was the first; Tempa the second; the
point is that the next one is a ~40-line file plus a config row.

Lives in [`sources/`](../../sources). Each source's playlist is a normal YTM
playlist on the Pyaar Radio account, so it already flows into the app through the
daily `sync_playlists.py` like every other playlist. The player never changes.

## The shape (why it's replicable)

Every source is the same machine except one swappable part:

```
adapter.list_groups(cfg)        cheap: list the units of work (threads / releases)
        │
        ▼  for each not-yet-sealed group
adapter.fetch_queries(cfg, g)   the only expensive, source-specific scrape
        │   -> ["Title - Artist", "bare phrase", ...]
        ▼
core: match each to a real YTM song (strict gate, no blind-adds)
      -> dedup (normalized text + videoId)
      -> batch-add to the source's playlist
      -> seal the group, persist state   (all shared, in core.py)
```

- **`core.py`** is written once and shared. Matching, dedup, playlist add/retry,
  the review + obvious-promotion gate, and `state/<id>.json` idempotency.
- An **adapter** (`adapters/<name>.py`) only has to answer two questions:
  `list_groups(cfg)` (what are the units of work) and `fetch_queries(cfg, g)`
  (the candidate strings for one unit). That is the entire per-source surface.
- **`sources.json`** is the registry: one row per source (playlist, adapter,
  schedule, knobs).

The match gate handles two adapter shapes without any branching:
- **catalog** sources emit clean `"Title - Artist"` pairs (both parts must match
  a result, order-agnostic) → high-confidence auto-adds. *(Tempa.)*
- **feed** sources emit messy free-text mentions → bare single phrases are parked
  in `review`, and a final pass promotes the obvious ones (named an exact artist,
  or an exact multi-word title) and leaves genuinely ambiguous single words
  parked. *(pi.fyi.)*

## Registry fields (`sources.json`)

| field | meaning |
|---|---|
| `adapter` | module in `sources/adapters/` providing `list_groups` + `fetch_queries` |
| `playlist_id` | existing YTM playlist id, or `null` to create on first run (then stored in state) |
| `playlist_name` / `playlist_desc` | used when creating the playlist |
| `rescan_days` | re-scan groups younger than this each run (late additions); `0` = seal immediately (immutable catalogs) |
| `since` | ignore groups older than `YYYY-MM-DD`; `null` = all |
| anything else | passed through to the adapter (e.g. `subdomain` for a Bandcamp label) |

## Run

```bash
cd sources
python core.py               # every source, sequentially (never two YTM jobs at once)
python core.py tempa         # one source
python core.py pifyi --dry   # match + report, create/modify nothing
```

Auth = `browser.json` at the repo root (the Pyaar Radio account, same cookie file
as the other syncs; `YTMUSIC_BROWSER_AUTH` secret in CI). State is committed so a
cloud run resumes exactly where the last left off.

## Schedule

[`.github/workflows/sources.yml`](../../.github/workflows/sources.yml) runs all
sources monthly (1st) and commits the updated `state/` + `threads.json`. Also
`workflow_dispatch` with a `source` input to run one on demand.

## Adding a source (the whole recipe)

1. Write `sources/adapters/<name>.py` with `list_groups(cfg)` and
   `fetch_queries(cfg, group)`. (For any Bandcamp label, reuse `bandcamp_label`
   and just set `subdomain` — no new code.)
2. Add a row to `sources.json` (adapter, playlist, `rescan_days`, knobs).
3. First run locally (`python core.py <name>`) so the heavy backfill happens on a
   residential IP; commit the resulting `state/<name>.json`.
4. Add a `docs/sources/<name>.md` entry.

The monthly workflow picks it up automatically.

## Current sources

| id | what | playlist | docs |
|---|---|---|---|
| `pifyi` | pi.fyi weekly "what have you been listening to?" threads | [perfectly imperfect sync](https://music.youtube.com/playlist?list=PLIpg0r7aJSXc) | [pifyi.md](./pifyi.md) |
| `tempa` | Tempa Records full Bandcamp discography | [tempa ltd](https://music.youtube.com/playlist?list=PLLkUBUz5Ma94) | [tempa.md](./tempa.md) |
