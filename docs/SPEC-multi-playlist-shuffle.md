---
spec_format_version: "0.1"
title: "Multi-Playlist Shuffle"
artifact_type: "prd"
spec_revision: 2
author: "Prahlaad"
created_at: "2026-10-03T00:00:00Z"
updated_at: "2026-10-03T00:00:00Z"
linked_github_repo: "prahlaadr/pyaar-radio"
---

## Problem

Prahlaad has 290+ playlists synced from YouTube Music into Pyaar Radio, but the
app can only load one at a time (the Setlists tab loads a single playlist as a
setlist). To explore across playlists he has to open them one by one, and there
is no way to dig through several at once as a single listening pool. When a song
plays during a mixed session he also cannot tell which of his playlists it came
from, so the playlists stay opaque: he knows the songs are in there somewhere but
cannot browse them as one stream or place a track he is hearing.

## Hypothesis

If Prahlaad can select several playlists at once and shuffle the merged pool as a
single stream, with each song showing which of the selected playlists it belongs
to, then he will actually listen across his whole collection instead of leaving
most playlists untouched, because the one-playlist-at-a-time ceiling that keeps
him from exploring is removed.

## Scope

```productspec-scope
in:
  - select 2 or more saved YTM playlists from the existing picker
  - merge selected playlists into one shuffle pool, deduped by videoId
  - each pooled track records every selected playlist it belongs to (sources[])
  - shuffle the merged pool using the existing radio shuffle (BPM + key aware)
  - clicking a now-playing or listed song shows its source playlist(s)
  - works everywhere the app runs, including the deployed Vercel site
out:
  - any write-back to YTM (add to playlist, remove from playlist, like/unlike)
  - creating a new playlist from the app
  - reordering or manual sequencing across the merged pool
  - editing track metadata (BPM, key, genre, title)
cut:
  - per-song curate actions (add / remove / like) and the localhost Python
    write-back route they required. Reconsider as a later, separate spec if the
    read-only shuffle proves useful first.
  - queue for Lexar / MP3 320 download from a song
  - crossfade or transition tuning between pooled tracks
```

## Acceptance Criteria

- Given the playlist picker, when the user enters multi-select mode and checks
  two or more playlists, then a single merged pool is loaded and playable.
- Given the same song exists in more than one selected playlist, when the pool
  is built, then that song appears exactly once in the shuffle queue and its
  record lists every selected playlist it came from.
- Given a merged pool, when the user starts shuffle, then playback uses the
  existing BPM-proximity and Camelot-key-compatible radio shuffle over the
  merged pool with no change to that algorithm.
- Given a song is playing or listed, when the user opens or taps it, then all of
  its source playlists (from the current selection) are displayed by title.
- Given the app is running on the deployed Vercel site, when the user builds and
  shuffles a merged pool, then it works fully (the feature has no localhost or
  write-back dependency).
- Given a selected playlist fails to load, when the pool is built, then the
  failure is surfaced and the pool still plays from the playlists that did load.

## Success Metrics

This is single-user personal tooling, so the metrics are about whether the
feature actually gets used, not about a user population.

- Within the first two weeks of use, at least 8 distinct multi-playlist shuffle
  sessions are run (loaded 2+ playlists and played from the merged pool).
- Across those sessions, playlists outside the usual handful get played: at least
  15 distinct playlists appear as a source of a played track, up from the
  one-at-a-time status quo.
- The merged pool builds fast enough to feel instant: selecting up to ~5
  playlists and starting shuffle takes under a few seconds on a normal session.

## Risks

- Large merged pools (several big playlists) could be slow to build if each
  track is matched against the masterlist for BPM/key. Mitigation: reuse the
  existing batched match path from handleLoadPlaylist, and render/play before
  full enrichment if needed.

## open_questions

- RESOLVED: source playlist(s) show as an always-visible muted label on each
  setlist row and on the now-playing bar (multiple sources joined with " · ").
  Simpler than tap-to-reveal and readable at a glance.
- Should selecting playlists for a pool be a transient action, or saved like a
  setlist so a favourite multi-playlist mix can be reopened? (Built transient:
  the pool is not written to savedSetlists / localStorage. Add save later only
  if wanted.)
