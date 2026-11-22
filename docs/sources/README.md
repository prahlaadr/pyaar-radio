# Playlist Sources

A **source** turns some corner of the internet into **one YouTube Music playlist**,
on a monthly schedule, idempotently. pi.fyi was the first; Tempa the second; the
point is that the next one is a ~40-line file plus a config row.

Lives in [`sources/`](../../sources). Each source's playlist is a normal YTM
playlist on the Pyaar Radio account, so it already flows into the app through the
daily `sync_playlists.py` like every other playlist. The player never changes.

## Sources, playlists, channels

```
SOURCE (scraped)                  PLAYLIST (YT Music, [sync])        CHANNEL (app)
pi.fyi threads  ─ sync engine ─▶  perfectly imperfect sync   ─────▶  "Perfectly Imperfect"
Tempa Bandcamp  ─ sync engine ─▶  tempa ltd                  ─────▶  "Tempa"
(future labels/feeds)          ─▶  …                          ─────▶  …
                                  a playlist you already made ─────▶  "<your channel>"
```

A **channel** is any YT Music playlist surfaced in the app's Channels tab (to
browse and add songs to Liked / other playlists). A **synced source** is a channel
whose playlist the framework *auto-maintains*. The two are decoupled:

- **Scraped source → synced channel** — the framework scrapes and keeps the
  playlist fresh (pi.fyi, Tempa). Registered in `sources/sources.json`.
- **Existing playlist → manual channel** — a playlist you already made and curate
  yourself; the app just surfaces it. No source, no sync.

Both are listed in [`public/data/channels.json`](../../public/data/channels.json)
(the display registry the Channels tab reads). `synced:true` channels point at a
`source`; `synced:false` channels are yours to maintain.

### Register an existing playlist as a channel (no code)

Add a row to `public/data/channels.json`:

```json
{ "id": "my-label", "playlistId": "PLxxxx", "name": "My Label",
  "blurb": "…", "kind": "label", "synced": false }
```

### Add a new scraped source (becomes a synced channel)

1. Write the adapter + `sources.json` row (see below), first-run the backfill.
2. Add a `channels.json` row with `"synced": true, "source": "<id>"`.

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

Every framework-maintained playlist is named with a trailing **`[sync]`** so you
can tell at a glance it is auto-synced (core appends it on create).

| id | what | playlist | docs |
|---|---|---|---|
| `pifyi` | pi.fyi weekly "what have you been listening to?" threads | [perfectly imperfect sync \[sync\]](https://music.youtube.com/playlist?list=PLIpg0r7aJSXc) | [pifyi.md](./pifyi.md) |
| `tempa` | Tempa Records full Bandcamp discography | [tempa ltd \[sync\]](https://music.youtube.com/playlist?list=PLLkUBUz5Ma94) | [tempa.md](./tempa.md) |

## Channels (the app tab)

The **Channels** tab in the app (a nav item) reads
[`public/data/channels.json`](../../public/data/channels.json) and shows every
`[sync]`-marked playlist as a browsable channel: click one, see its songs, play,
and **♥ add to Liked**. Browse-to-curate, separate from Setlists.

Three kinds of channel today (29):
- **feed** — `pifyi` (this repo's pi.fyi source)
- **label** — `tempa` (this repo's Bandcamp source)
- **artist** — 27 inspo sets (what each artist plays out), synced by the external
  **Crate Maker** agent (`source: "crate-maker"`). This repo only surfaces them; it
  does not maintain them. That is the channel-vs-synced-source split in practice.

### Curate (♥ like)

`/api/channels/like` likes a song on YT Music two ways (same split as radar):
- **Local** (`browser.json` present): writes directly via the venv Python.
- **Deployed**: dispatches [`channels-like.yml`](../../.github/workflows/channels-like.yml),
  which likes it from the cloud using the `YTMUSIC_BROWSER_AUTH` secret (needs
  `GITHUB_DISPATCH_TOKEN`, same as radar).

## Testing

`python sources/test_sources.py` (offline, deterministic) proves the match gate,
both adapters' parsing, the registry, and the channels wiring (including the
no-em-dash rule and the pifyi 2025 floor). Runs in CI on every change via
[`test-sources.yml`](../../.github/workflows/test-sources.yml). Live scraping is
spot-checked with `python sources/core.py <id> --dry`.
