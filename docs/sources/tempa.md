# Source: Tempa Records (Bandcamp label)

**Playlist:** [tempa ltd](https://music.youtube.com/playlist?list=PLLkUBUz5Ma94)
· *"(the Tempa Records catalogue, pulled from their Bandcamp)"*
**Adapter:** `bandcamp_label` (a *catalog* source) · **Schedule:** monthly
**Config:** `subdomain: tempa` → [tempa.bandcamp.com](https://tempa.bandcamp.com/)

A collection of the Tempa Records (UK dubstep / dub) label's artists' work in one
playlist, built from the label's full Bandcamp discography.

## How it works

- **`list_groups`** reads `https://tempa.bandcamp.com/music` and collects every
  release (the label-hub `/album/<slug>` and `/track/<slug>` pages — ~129
  releases). These serve clean schema.org JSON-LD.
- **`fetch_queries`** fetches each release page and emits one `"Title - Artist"`
  per track from the JSON-LD (`name`, `byArtist`, and the track list). The release
  date is read from `datePublished`.
- **core** matches each pair to a YTM song through the strict both-parts gate
  (high confidence, since the inputs are already structured) and adds to the
  playlist.

Releases are immutable once published, so `rescan_days=0` seals each release after
its first pass. New Tempa releases simply appear in the list on later monthly runs.

## Reusing this for another label

`bandcamp_label` is parameterized by `subdomain`. To add another label (Hyperdub,
Hessle Audio, …), add a `sources.json` row with its Bandcamp subdomain and a new
playlist — **no new code**:

```json
"hyperdub": {
  "adapter": "bandcamp_label",
  "subdomain": "hyperdub",
  "playlist_id": null,
  "playlist_name": "hyperdub",
  "playlist_desc": "(the Hyperdub catalogue, pulled from their Bandcamp)",
  "rescan_days": 0,
  "since": null,
  "schedule": "monthly"
}
```

## Notes / limits

- Underground dub/dubstep has patchy YTM coverage; tracks that don't resolve park
  in `state/tempa.json` → `missing` (viewable, not lost).
- Releases live on each artist's own Bandcamp subdomain; the adapter sources the
  canonical URLs from the `/music` page's `data-client-items` grid.
- Bandcamp sits behind Fastly bot-mitigation that serves a probabilistic JS
  challenge. The adapter rotates several pinned browser fingerprints (`curl_cffi`
  impersonate + the `curl` binary) and retries; the bare `chrome` alias always
  loses, so pinned versions are used. The initial 275-track build ran clean.
  **Caveat:** the monthly cloud run from a datacenter IP is not yet verified
  against this challenge. If CI gets challenged, the fallback is to run this one
  source from local launchd (residential IP). pi.fyi is unaffected (it has a
  committed `threads.json` fallback and no such challenge).
