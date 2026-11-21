# Source: pi.fyi listening threads

**Playlist:** [perfectly imperfect sync \[sync\]](https://music.youtube.com/playlist?list=PLIpg0r7aJSXc)
· *"(pulls from what have you been listening to threads on perfectly imperfect)"*
**Adapter:** `pifyi` (a *feed* source) · **Schedule:** monthly

Builds the playlist from the weekly **"WHAT HAVE YOU BEEN LISTENING TO?"** threads
posted by [@perfectlyimperfect](https://www.pi.fyi/u/perfectlyimperfect) on pi.fyi.
The playlist holds the most-recent matched songs across **all** threads (Nov 2023
onward), capped at 5000 (precision-gated, so it sits well under the cap).

## How it works

- **`list_groups`** enumerates the listening threads newest-first via pi.fyi's
  public GraphQL feed (`getGenericFeedInfiniteScroll`, filtered to prompt titles
  matching `WHAT HAVE YOU BEEN LISTENING TO`). The query + variables were captured
  once and live in `sources/feed_query.json`; falls back to the committed
  `sources/threads.json` if the API changes.
- **`fetch_queries`** pulls each thread's top answers from the ask page's
  server-rendered JSON-LD (`DiscussionForumPosting.comment[].text`, ~30/thread),
  and reduces each blurb to a searchable string (strips "i love…"/"obsessed
  with…" lead-ins, normalizes dashes / `by`).
- **core** matches, dedups, and adds. Answers are messy, so most go through the
  review + obvious-promotion gate: a bare single phrase is parked unless it names
  an exact artist or is an exact multi-word title.

Headless, no browser, no LLM tokens. pi.fyi's GraphQL rate-limits hard (HTTP 429,
~60s); both fetchers back off. `rescan_days=21` re-scans recent threads each run
to catch late answers; dedup keeps that cheap.

## Notes / limits

- JSON-LD caps answers at ~30/thread (the server-rendered top answers).
- Freeform / album / descriptive answers that don't resolve to a single song park
  in `state/pifyi.json` → `missing` (viewable, not lost).
- Originally a standalone biweekly launchd job (`~/Projects/03-music-audio/pi-fyi-sync`,
  `com.pyaar.pifyi-sync`); folded into this framework and moved to the monthly
  cloud workflow. The old launchd job is retired so the two don't both mutate the
  playlist.
