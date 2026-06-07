# Playlist ↔ Folder Sync

How YT Music playlists become playable folders on the Lexar drive, and the
design for generalizing that to any playlist (and eventually making it
two-way). Three parts:

1. **Monthly auto-sync** — shipping today. Mirrors month-named playlists to
   `PYAAR.Radio/Monthlys/` on drive mount.
2. **Generalize to any playlist** — planned. A small watchlist so arbitrary
   playlists auto-sync to chosen folders.
3. **Two-way sync** — design only. Drop a file in a folder → it shows up in the
   YT Music playlist, and deletions mirror. Not built; documented here so the
   safety requirements aren't lost.
4. **Producer discography sync** — built (`scripts/sync_producer.py`). Keep
   `In Focus/Producers/<NAME>/` complete against a producer's discography,
   diff the folder, and download the gaps. Builds on
   `scripts/in_focus_audit.py`.

---

## Part 1 — Monthly auto-sync (current)

### What it does

When any drive mounts, it fetches your month-named YT Music playlists
(`"June 26"`, `"Mirch 26"`, `"Jooli '25"`, …) and downloads any **missing**
tracks into `PYAAR.Radio/Monthlys/YYYY-MM (Month)/`. It is **purely additive** —
existing files are never overwritten or deleted.

### The chain

```
drive mount (StartOnMount)
   │
   ▼  com.pyaar.sync-monthlys  →  sync_monthlys.sh
        1. git pull --rebase --autostash   (catch the daily GH-Action commits)
        2. sync_monthly_playlists.py        (live YT Music fetch, monthly-only)
        3. sync_usb.py --flat               (download missing tracks)
   │
   ▼
<target>/PYAAR.Radio/Monthlys/YYYY-MM (Month)/
```

Target is resolved by `pyaar_drives.get_write_root()` — **V3 if mounted, else
V1 staging**. When it stages on V1, run `./uplift "PYAAR.Radio/Monthlys"` after
V3 reconnects to promote to master.

### What makes it "monthly-only"

Both scripts gate on the same regex, `MONTH_RE` (`^(\w+)\s*'?(\d{2})\b`), via
`MONTH_MAP`:

- `sync_monthly_playlists.py:is_monthly()` — only fetches playlists whose title
  matches (much cheaper than walking all 244).
- `sync_usb.py:parse_archive_date()` / `get_archive_playlists()` — selects which
  playlists to download and derives the `YYYY-MM (Month)/` folder name from the
  parsed date.

A playlist like `"shroomy (goated)"` is invisible to this chain — no date to
match, no folder to derive. That's the gap Part 2 closes.

### How "only missing tracks" works

`sync_usb.py:sync_playlist()` buckets every track (`sync_usb.py:330`):

| Bucket | Meaning | Action |
|---|---|---|
| `good` | on drive, already ≥320 | left untouched |
| `upgradeable` | on drive, low bitrate | **skipped** in the auto-run (yt-dlp is lossy; `PYAAR_NO_SOULSEEK=1` disables the only upgrade path) |
| `missing` | not on drive | downloaded via yt-dlp MP3 320 |

The downloader also guards with `if dest.exists(): return True`
(`sync_usb.py:289`) — it never overwrites a file already on disk.

### Files

| File | Purpose |
|---|---|
| `sync_monthlys.sh` | Mount wrapper (3-step chain) |
| `sync_monthly_playlists.py` | Targeted live fetch of month-named playlists |
| `sync_usb.py` | Diff-and-download engine (generic per-playlist) |
| `pyaar_drives.py` | `get_write_root()` → V3-then-V1 |
| `~/Library/LaunchAgents/com.pyaar.sync-monthlys.plist` | `StartOnMount` trigger; bakes in `PYAAR_NO_SOULSEEK=1` |
| `/tmp/pyaar-sync-monthlys.log` | Run log |

### Operations

```bash
# Dry-run one month
.venv/bin/python sync_usb.py --flat --months "June 26" --dry

# Real run, all archive months
.venv/bin/python sync_usb.py --flat

# Targeted live re-fetch of a single playlist's tracklist
.venv/bin/python sync_monthly_playlists.py <playlistId>

# Manually fire the mount chain (simulate a plug-in)
launchctl start com.pyaar.sync-monthlys

# Reload the agent after editing the plist
launchctl unload ~/Library/LaunchAgents/com.pyaar.sync-monthlys.plist
launchctl load   ~/Library/LaunchAgents/com.pyaar.sync-monthlys.plist
```

### Troubleshooting — bugs fixed 2026-06-06

The chain was firing on mount but crashing silently every run. Four causes,
all fixed:

| Symptom in log | Cause | Fix |
|---|---|---|
| `FileNotFoundError: 'yt-dlp'` on track 1 | launchd runs with a minimal PATH that excludes `/opt/homebrew/bin`; `sync_usb.py` calls bare `yt-dlp` | `export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"` at the top of `sync_monthlys.sh` |
| `JSONDecodeError` reading a playlist | 130 `public/playlists/*.json` left in a git merge conflict (a past `git pull --autostash` pop failed); conflict markers corrupted the JSON | resolved the conflict (reset machine-generated JSONs to the committed sync, dropped the bad autostash) |
| `NameResolutionError: music.youtube.com` | transient DNS blip during the discovery step | self-resolved; **the discovery step needs internet — be online when you plug in**, or it falls back to the last-synced (possibly stale) tracklist |
| `subprocess.TimeoutExpired` aborts the whole run | a single slow download hit the 60s yt-dlp timeout and the exception was uncaught, killing every remaining month | catch `TimeoutExpired`/`OSError` in `download_ytdlp` (mark track failed, continue) and raise the limit to 120s |

A handful of `FAIL` lines per run is normal — those are deleted or
region-locked YouTube videos. They no longer abort the run.

---

## Part 2 — Generalize to any playlist (planned)

The download engine (`sync_usb.py:sync_playlist()`) is already generic — only
the *selection* (month regex) and *folder naming* (date → `Monthlys/`) are
monthly-specific. To auto-sync arbitrary playlists, add a **watchlist config**
mapping playlist → destination, and a generalized mount chain that loops over it.

Proposed `~/.config/pyaar-sync/watchlist.json`:

```json
[
  { "playlistId": "PL6LTKg9AoNs...", "title": "shroomy (goated)", "dest": "Crates/shroomy" },
  { "playlistId": "PL6LTKg9AoNs...", "title": "new electronica",   "dest": "Setlists/new electronica" }
]
```

The daily GH-Action already syncs all 244 playlists to `public/playlists/*.json`,
so the data exists; the new chain just needs (a) a live re-fetch of the watched
IDs and (b) `sync_playlist()` pointed at each `dest`. Same plug-and-go behavior
as the monthlys, for any playlist.

On-demand today: the `/ytmusic` "sync `<name>`" workflow already downloads any
single playlist to a V3 folder. Part 2 is just automating that on mount.

---

## Part 3 — Two-way sync (design only — NOT built)

Goal: drop a track into a watched folder and have it appear in the YT Music
playlist; remove it and have the playlist mirror the removal. **Chosen
behavior: search-and-match for write-back, with deletions mirrored.** This is
the riskiest configuration, so it is documented but gated behind the safeguards
below — do not ship it without them.

### Why it needs a state manifest

You cannot mirror deletions by comparing "folder now" vs "playlist now" — that
can't distinguish *added here* from *deleted there*. Each run must diff **both
sides against a stored snapshot** of the last-synced set
(`~/.config/pyaar-sync/manifest/<playlistId>.json`):

| Manifest vs sides | Interpretation | Action |
|---|---|---|
| in folder, not in manifest | added locally | search-match → `add_playlist_items` |
| in playlist, not in manifest | added on YT | download to folder |
| in manifest, gone from folder | deleted locally | remove from playlist |
| in manifest, gone from playlist | removed on YT | delete file |

Then rewrite the manifest.

### Write-back = search & match (lossy, by choice)

A local file is just audio + filename. A YT Music playlist can only reference an
existing YouTube video, so write-back parses `Artist - Title.mp3`, searches YT
Music, and adds the best match's video ID. Caveats accepted:

- May add the **wrong version** (live / remix / sped-up / different master).
- Songs **not on YouTube** (rare rips, NTS/Tamil material) cannot be added.
- Therefore matches are **shown for confirmation** before adding, at least until
  trusted.

(Alternative considered and rejected for now: `ytmusicapi.upload_song()` to push
the exact MP3 to YT Music "Uploads" — faithful audio but private uploads that
hit account limits and behave differently from catalog tracks.)

### Mandatory safeguards for mirror-deletions

Removable-drive sync + deletion-mirroring is a data-loss footgun: a late or
partial mount can read an empty folder and "conclude" you deleted everything,
wiping the playlist. Non-negotiable:

1. **Mount sanity check** — refuse to run unless the drive is fully readable
   (sentinel file present + folder count ≥ expected minimum).
2. **Deletion threshold** — abort and alert if one run would remove >~20% of
   either side. Mass deletions are almost always a bug.
3. **Soft-delete** — removed files go to `.trash/` on the drive; playlist
   removals are logged for a recovery window. No hard deletes.
4. **Dry-run + confirm rollout** — first runs print the full add/remove plan and
   wait for approval. Adds graduate to automatic once trusted; **deletions stay
   manual-confirm**.

### Open decisions before building

- Source of truth on a genuine conflict (edited both sides between syncs).
- Whether write-back is auto or always confirm-first long-term.
- Per-watchlist-entry opt-in for two-way vs download-only (most folders should
  stay one-way).

### Status

Not implemented. Pilot plan: build against **one** non-precious playlist, run in
dry-run/confirm mode, watch it behave, then loosen adds while keeping deletions
guarded.

---

## Part 4 — Producer discography sync (BUILT — `scripts/sync_producer.py`)

Goal: keep an `In Focus/Producers/<NAME>/` folder complete against the
**producer's discography**, downloading missing releases. **One-way only** — a
discography is upstream truth, not yours to push back into.

```bash
.venv/bin/python scripts/sync_producer.py "Anish Kumar"             # dry diff report
.venv/bin/python scripts/sync_producer.py "Anish Kumar" --download  # fill the gaps
.venv/bin/python scripts/sync_producer.py "Anish Kumar" --include-non-official
```

Resolve discography (YT artist page → Discogs → MusicBrainz) → expand each
release to its tracks → diff vs the folder (case-insensitive, normalized title
match) → report missing, and with `--download` fetch them (yt-dlp MP3 320,
additive). Dry by default.

**Pilot result (ANISH KUMAR, 2026-06-06):** 13 releases → 52 resolvable tracks;
folder went 38/52 → **49/52 present** (11 downloaded). 3 remain unfetchable
(`AK Cuts: Vol. 4` — no YT video IDs; need Soulseek/manual). The folder also
holds ~19 tracks beyond the resolved discography (collabs/remixes/untracked
releases), so "complete" means *against what the sources resolve* — a
high-confidence floor, not every track ever.

**Not yet wired to mount.** This is the on-demand engine; the on-mount watchlist
loop (below) is still TODO.

### What already exists vs what's new

`scripts/in_focus_audit.py` already does the hard half — discography
**discovery**:

- Resolves a producer's albums via Discogs (artist-ID disambiguated) →
  MusicBrainz (release-groups, `album|ep`) → YT Music artist page.
- Filters: `trackCount >= 3` (drops singles), exact canonical artist match,
  dedup vs `albums.csv` + `albums/_index.json`.
- `--lexar-cross-check` already reads the local folder via `lexar_tracks()`,
  drive-resolved by `_producers_dir()` (V3 then V1).
- Output: a `triage-runs/*.json` that feeds `triage-apply` — which **saves the
  albums to your YT Music library, not to the folder**.

So today: discover gaps → save on YT Music → (daily sync) → folder download
happens separately (deep-dive skill / manual). The **missing piece** is a direct
"download missing producer releases into the folder on mount."

### The new chain (on mount, per watched producer)

```
drive mount
   │
   ▼  for each producer in the producers watchlist (pilot: ANISH KUMAR):
        1. resolve discography     (reuse in_focus_audit: Discogs → MB → YT) ← cached
        2. expand albums → tracks  (yt.get_album → track videoIds)
        3. diff vs folder          (reuse lexar_tracks() / sync_usb matching)
        4. download missing        (reuse sync_usb.download_ytdlp → MP3 320)
   │
   ▼
<target>/In Focus/Producers/<NAME>/
```

Mostly glue: discovery from `in_focus_audit.py`, the download + matching engine
from `sync_usb.py`.

### Design notes / caveats

- **Don't re-resolve the whole discography every mount.** Discogs (25 req/min
  unauth) + MusicBrainz (1 req/sec) make full resolution slow. Cache the
  resolved discography per producer
  (`~/.config/pyaar-sync/discography/<producer>.json`), refresh on a cadence
  (weekly / manual); each mount just diffs folder vs cache and downloads. The
  chosen behavior is **discography** (full catalog completeness), not "new
  releases only" — caching is how you get completeness without paying the
  resolution cost on every plug-in.
- **Auto-run = yt-dlp MP3 320 (lossy).** The mount path keeps
  `PYAAR_NO_SOULSEEK=1`, so producer downloads come from YouTube. For HQ
  (Soulseek FLAC / lucida Qobuz), run `/deep-dive-artist` manually — auto-mount
  is for coverage, not archival quality.
- **Album granularity.** Discography is album-based; the folder is flat tracks.
  Step 2 expands each album to its tracks before diffing, so partial albums get
  topped up too.
- **No two-way, no deletions.** The folder only ever gains tracks. If you want a
  *curated subset* of a producer rather than their whole catalog, that's the
  playlist model (Parts 2–3), not this.
- **Watchlist, opt-in.** Producers are added explicitly
  (`~/.config/pyaar-sync/producers-watch.txt`, a subset of the ~62-producer
  `data/in_focus_producers.txt`) — not the whole list on every mount.

### Status

On-demand engine **built and proven** (`scripts/sync_producer.py`, Anish Kumar
pilot above). Remaining work: a `producers-watch.txt` + on-mount loop with the
discography cache so it runs unattended on plug-in (don't re-resolve every mount
— Discogs 25/min + MB 1/sec is too slow).

---

## Related

- `CLAUDE.md` → "Drive Model: V3 master, V1 subset + staging" (pull / uplift / sync commands)
- `scripts/in_focus_audit.py` → producer discography discovery (Part 4's upstream half)
- `README.md` → "Automation"
- pyaar-core repo → mirrored sync + hydration scripts
