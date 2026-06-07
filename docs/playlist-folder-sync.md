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

## Related

- `CLAUDE.md` → "Drive Model: V3 master, V1 subset + staging" (pull / uplift / sync commands)
- `README.md` → "Automation"
- pyaar-core repo → mirrored sync + hydration scripts
