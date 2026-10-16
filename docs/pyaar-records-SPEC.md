---
spec_format_version: "0.1"
title: "Radar: My Artists + Pyaar Records"
artifact_type: "prd"
spec_revision: 2
author: "Prahlaad"
created_at: "2026-10-16T00:00:00Z"
updated_at: "2026-10-16T00:00:00Z"
linked_github_repo: "prahlaadr/pyaar-radio"
---

> Feature spec for evolving the Radar into two roster tabs inside the Pyaar
> Radio app. This is NOT the app's root spec. Related: the `pando-radar` stem +
> `radar doctor` health check (music-discovery is a Pando stem concern).

## Problem

The Radar scans one roster: ~627 artists in a hand-curated `artists.csv`. Two
gaps:

1. **The roster lags reality.** Prahlaad already considers any artist he's saved
   2+ albums from to be "his," but the roster only grows when he manually edits
   the CSV. Today that leaves ~340 artists he's saved 2+ albums from (700 total
   with 2+) with no CSV row, so artists he demonstrably collects are invisible
   to the Radar.
2. **Pyaar Records has no view.** The label (the `pyaar.records` Instagram
   account, formerly handled `pyaar.radio`) curates its own artist universe,
   distinct from his personal roster, and there is no view of "what has the
   label's roster released lately, and which of those do I already have."

Both gaps let the YT Music library's catalog drift incomplete, with no single
place to see and close the gaps.

## Hypothesis

If the Radar presents two tabs fed by one scan, a **My Artists** roster that
auto-grows from the library (any artist with 2+ saved albums, gated to
release-active ones) and a **Pyaar Records** roster from the label's IG follows,
each listing recent releases with a saved / not-saved checkmark and one-click
Save, then Prahlaad will keep both catalogs complete, because every gap is
visible and closable in one place without manual roster upkeep or per-artist
checking.

## Scope

```productspec-scope
in:
  - two Radar tabs fed by one scan, "My Artists" and "Pyaar Records", siblings of the existing Audit view
  - My Artists roster = curated artists.csv UNIONED with a derived set of artists with >= 2 saved albums in the library (albums/_index.json)
  - membership is cheap (>= 2 saved albums, minus curated, minus a small aggregator denylist of RAAJA BEATS / CHOR BAZAAR); "release-active" is NOT a membership pre-gate, it is enforced at scan time by the recency window, so a legacy/inactive artist in the roster surfaces nothing rather than junk
  - derived artists live in a radar-only derived set, NOT auto-written into artists.csv; a one-click "promote" adds a curated artists.csv row with metadata when wanted
  - Pyaar Records roster = Rolodex contacts (Source = pyaar.records, Circle = Artist/Creator), music-resolved, as a committed snapshot refreshed from the Rolodex
  - ambiguous name-to-artist resolutions go to a review bucket (yes/no), never force-matched or silently dropped
  - per artist: latest 3 projects newest first (albums + EPs/mixtapes, singles excluded), a saved / not-saved checkmark (library reconcile), one-click Save via the existing Save then Apply flow
  - an artist in both rosters appears in both tabs
out:
  - auto-writing derived artists into artists.csv (promote is always an explicit click)
  - auto-saving releases without a human click
  - running the Instagram following sweep inside the weekly cloud scan (it needs a logged-in browser, so roster refresh stays a manual/local step)
  - tracking non-music accounts (dropped by the music-only resolve)
  - changing the existing Audit view
cut:
  - full discography per artist beyond the latest 3 (that is what Audit does)
  - surfacing deluxe / live / compilation editions (the Radar's existing noise filter drops them, same for both tabs)
  - a dedicated health command for these tabs (fold coverage into radar doctor later)
  - exact recency-window tuning (default ~3 years, adjustable later)
```

## Acceptance Criteria

My Artists tab:

- Given the library, the My Artists roster equals `artists.csv` UNION the set of
  artists with 2+ saved albums that are release-active and not a catalog /
  compilation / film-composer channel; curated `artists.csv` entries are never
  dropped, even with fewer than 2 saved albums.
- Given an artist who newly crosses 2 saved albums and passes the gate, they
  appear in the My Artists pool with no manual edit, and a "promote" action adds
  a curated `artists.csv` row on demand.
- Given a legacy/inactive artist (no release within the recency window) or a
  film-composer / compilation / label-aggregator channel, they are excluded from
  the auto-grown pool even with 2+ saved albums.

Pyaar Records tab:

- Given the roster pulled from the Rolodex (Source = pyaar.records, Circle =
  Artist/Creator) and music-resolved, it contains only contacts resolving to a
  YT Music artist with at least one non-single release; ambiguous resolutions
  are held in a review bucket, not force-matched or silently dropped.

Shared:

- Given a roster artist in either tab, the tab shows their 3 most recent
  albums/EPs newest first, each with a checkmark if in the library and a Save
  control if not; deluxe / live / compilation editions are filtered out.
- Given an unsaved project, Save routes through the existing Apply flow; after
  Apply plus the next library sync it shows the checkmark and offers no Save.
- Given both tabs, one scan feeds both, an artist in both rosters shows in both,
  and neither tab interleaves rows with the other or with Audit.

```productspec-ai-evals
- id: my_artists_autogrow_gate
  type: rubric
  input_set: evals/my-artists-autogrow-golden.jsonl
  evaluator: llm_judge
  pass_threshold: 0.9
  checks:
    - artists with 2+ saved albums and a release within the recency window are included
    - legacy or inactive artists with no recent release are excluded from auto-grow
    - film-composer, label-aggregator, and compilation channels are excluded even with 2+ saved albums
    - curated artists.csv entries are retained regardless of saved-album count
- id: ig_to_ytmusic_resolution
  type: rubric
  input_set: evals/pyaar-records-resolution-golden.jsonl
  evaluator: llm_judge
  pass_threshold: 0.9
  checks:
    - each kept roster entry maps to the correct YT Music artist, not a namesake, tribute, or karaoke act
    - non-music accounts (venues, brands, personal) are excluded rather than force-matched
    - genuinely ambiguous matches are routed to the review bucket, not auto-accepted
- id: latest_projects_filter
  type: deterministic
  input_set: evals/radar-projects-regression.jsonl
  evaluator: automated_test
  pass_threshold: 1
  checks:
    - returned projects are albums or EPs/mixtapes, never singles
    - deluxe, live, and compilation editions are filtered out
    - exactly the 3 most recent by release date, ordered newest first
    - the saved checkmark matches the project's presence in the library index
```

## Success Metrics

```productspec-success-metrics
- id: roster_autogrow_precision
  metric: pct_auto_grown_artists_kept_after_review
  target: ">= 85%"
  window: per roster rebuild
  segment: auto-grown (non-curated) My Artists entries
  source: review_log
- id: records_resolution_rate
  metric: pct_records_follows_resolved_to_artist
  target: ">= 90%"
  window: per roster refresh
  segment: pyaar.records follows classified as music
  source: resolution_log
- id: roster_catalog_completeness
  metric: pct_roster_artists_with_all_latest_3_saved
  target: "+30pp within the first month of use"
  window: monthly
  segment: resolved roster artists (both tabs)
  source: library_reconcile
- id: surfaced_save_through
  metric: pct_unsaved_surfaced_projects_saved
  target: ">= 50% within the first triage session"
  window: per session
  segment: unsaved latest-3 projects
  source: apply_log
```

## solution

Intent-level approach (details belong in DESIGN / code, not here):

- **My Artists auto-grows from the library. [BUILT: Phase 1.]** Group saved
  albums (`albums/_index.json`) by artist; any with 2+ (minus curated, minus a
  tiny aggregator denylist) joins a radar-only **derived set** unioned with
  `artists.csv` for the My Artists scan (627 -> 967 today). "Release-active" is
  NOT a membership pre-gate: it is enforced at scan time by the recency window
  (`RECENCY_YEARS_BACK`), so a legacy artist in the roster just surfaces nothing.
  Derived artists are not written into `artists.csv` (which drives the app's
  filters + TV and needs curated metadata); a **promote** action adds a curated
  row on demand (Phase 3).
- **Pyaar Records roster from the Rolodex.** The label account was rebranded
  `pyaar.radio` -> `pyaar.records`; the user renamed the Rolodex `Source` option
  to `pyaar.records` on 2026-10-16 (same rows, retagged). The roster is a Rolodex
  query (`Source = pyaar.records` + `Circle = Artist/Creator`, several hundred
  rows) snapshotted to a committed file.
- **Resolution needs IG full names, not handles (de-risk spike, 2026-10-16, 40
  contacts).** Resolving on the raw IG handle alone = only 25% confident
  auto-accept, 25% review, 50% drop. Half the drops are correct
  (labels/festivals/venues: `ninjatune`, `newportjazzfest`), but the rest are
  real artists missed because the Rolodex `Name` is still the handle
  (`thatkidzayy`), not the artist's real name. So the resolver must use the IG
  `full_name` (the following-sweep API returns it; current handle-only rows lack
  it): the prerequisite is a fresh `pyaar.records` following sweep capturing
  `username` + `full_name`, then resolve on the full name. The review bucket is
  essential, not optional.
- **Reuse the Radar's machinery** for the latest-3 fetch, the noise filter, the
  library-reconcile that drives the checkmark, and the Save then Apply flow. The
  two tabs are presentation layers over data the Radar already knows how to
  produce; one scan populates both.

## risks

- **Auto-grow gate is heuristic.** Detecting "film-composer / compilation /
  label-aggregator channel" is not exact; it may misclassify a real artist as
  noise or vice versa. Mitigation: the review bucket + the `my_artists_autogrow_gate`
  eval; the recency gate is deterministic and does most of the work.
- **Roster growth.** My Artists roughly grows 627 toward ~950 once auto-grow is
  on, which lengthens the scan and the triage list. Acceptable; the scan already
  handles ~627 and the gate trims legacy/noise.
- **Rolodex roster staleness + missing full names.** The `pyaar.records` rows
  carry only the IG handle for many entries, and the July rip predates follows
  added since. The next re-rip must sweep the current `pyaar.records` handle AND
  capture `username` + `full_name` (the resolver depends on the full name, per
  the spike). Mitigation: ride the existing periodic re-rip, extended to store
  full_name.

## open_questions

- **[RESOLVED] Recency window / how "release-active" is measured.** Enforced at
  scan time by the recency window (`RECENCY_YEARS_BACK` in `release.py`, now 2 =
  ~3 calendar years), read from the artist's actual latest release on YT Music,
  NOT a saved-history pre-gate (that would drop an artist collected years ago who
  just dropped a new album, the prime discovery target). The window is the single
  tunable knob.
- **Channel-noise detection.** How to flag film-composer / compilation /
  label-aggregator channels for exclusion: name/title patterns, an implausibly
  large album count, YT channel-type signals, or a manual denylist seeded from
  the known offenders (RAAJA BEATS, CHOR BAZAAR).
- **Promote metadata.** When promoting a derived artist into `artists.csv`, what
  gets seeded automatically (genre/vibes guessed from the saved albums) versus
  left blank for hand-curation.
- **Re-rip cadence.** Confirm the Pyaar Records roster refreshes on the existing
  periodic Rolodex re-rip (swept under the `pyaar.records` handle) rather than a
  bespoke sweep.

## custom-changelog

- **rev 2 (2026-10-16):** expanded from a single Pyaar Records tab to a two-tab
  Radar. Added the My Artists auto-grow rule (2+ saved albums, gated to
  release-active, derived-set + promote, not auto-written to artists.csv).
  Locked: ambiguous resolutions to a review bucket; deluxe/live/comp stay
  filtered out via the existing noise filter; roster is a committed snapshot.
- **rev 1 (2026-10-16):** initial draft, Pyaar Records tab only.
