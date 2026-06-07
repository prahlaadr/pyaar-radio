# Drive & Automation Recovery

If you lose the Lexar drive (or the Mac), this folder rebuilds everything that
isn't already in the repo: the **drive-path config**, the **LaunchAgents**, the
**folder skeleton**, and a one-shot **re-sync** of downloadable content.

## ⚠️ Read this first — two tiers of recovery

The music files do **not** live in git (V3 is ~155 GB). Recovery splits in two:

| Tier | What | Recoverable from repo? |
|---|---|---|
| **Re-downloadable** | Monthlys (YT Music playlists), producer discographies, setlists (Pyaar CSVs), anything sourced from YT Music | ✅ Yes — `restore.sh --resync` + per-producer / per-setlist runs |
| **Rare / unique** | Soulseek FLACs, lucida Qobuz rips, NTS Tamil rips, tracks with no YouTube source (e.g. `AK Cuts: Vol. 4`) | ❌ **No** — these exist only on the drive |

**The repo is NOT a backup of the rare tier.** Today, losing **V1** is fully
covered (V3 is the master copy). The real exposure is losing **V3** — if it dies
without a separate backup, the rare files are gone. Keep a real backup of V3's
unique material (another drive / cloud) if you care about it.

## What's captured here

```
recovery/
├── RECOVERY.md          # this file
├── STRUCTURE.md         # the canonical drive layout, explained
├── structure.txt        # machine-readable folder skeleton (restore.sh reads it)
├── restore.sh           # rebuilds config + agents + skeleton (+ optional resync)
├── config/
│   └── drives.json      # drive-path config → installs to ~/.config/pyaar-sync/
└── launchagents/        # the 4 LaunchAgent plists (paths templated)
    ├── com.pyaar.sync-monthlys.plist
    ├── com.pyaar.uplift-on-v3-mount.plist
    ├── com.pyaar.sync-usb.plist
    └── com.pyaar-crate.daily.plist   # depends on the separate pyaar-core repo
```

The plists use placeholders (`__REPO__`, `__PYAAR_CORE__`) that `restore.sh`
rewrites to wherever the repo is cloned on the recovering machine — so a clone to
a new path / new username still works.

## Recovery steps

```bash
# 1. Clone this repo (the source of truth)
git clone https://github.com/prahlaadr/pyaar-radio.git
cd pyaar-radio

# 2. Python env for the sync scripts
uv venv && uv pip install -r requirements.txt    # or however .venv is built
#    (ytmusicapi, requests, etc.)

# 3. Restore YT Music auth (NOT in git — gitignored secret)
#    Refresh browser.json per CLAUDE.md "Refreshing auth", or restore from the
#    YTMUSIC_BROWSER_AUTH GitHub secret.

# 4. Plug in the (new/replacement) drive, then rebuild config + agents + skeleton
recovery/restore.sh --dry         # preview the plan first
recovery/restore.sh               # config + agents + folder skeleton
#    If the new drive has a different name:
#    recovery/restore.sh --drive "/Volumes/NEWNAME/DJ"

# 5. Verify drive paths
#    Open ~/.config/pyaar-sync/drives.json and confirm v1_root / v3_root match
#    the actual mounted volume names.

# 6. Repopulate the re-downloadable tier
recovery/restore.sh --resync                          # Monthlys
.venv/bin/python scripts/sync_producer.py "Anish Kumar" --download   # per producer
#    /sync-setlist per setlist CSV for the Setlists/ folders

# 7. Re-source the rare tier MANUALLY (the repo can't)
#    Soulseek / lucida Qobuz / Bandcamp for FLAC + no-YouTube tracks.
#    Use /deep-dive-artist (Soulseek-first) for HQ producer/artist material.
```

After step 6, run `scripts/sync_producer.py "<name>"` (dry) per producer to see
exactly which rare tracks remain missing — that's your manual re-sourcing list.

## Keeping this kit current

When you change the automation, refresh the captured copies:

```bash
# Re-vendor the live plists (strip machine paths back to placeholders)
for p in com.pyaar.sync-monthlys com.pyaar.uplift-on-v3-mount com.pyaar.sync-usb com.pyaar-crate.daily; do
  sed -e "s|$HOME/Documents/Projects/01-web-apps/pyaar-radio|__REPO__|g" \
      -e "s|$HOME/Projects/03-music-audio/pyaar-core|__PYAAR_CORE__|g" \
      ~/Library/LaunchAgents/$p.plist > recovery/launchagents/$p.plist
done

# Re-vendor the config
cp ~/.config/pyaar-sync/drives.json recovery/config/drives.json

# Re-snapshot the folder skeleton (top 2 levels of the drive)
cd "$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.config/pyaar-sync/drives.json')))['v1_root'])")"
for d in Crates "In Focus" PYAAR.Radio Setlists; do
  echo "$d"; ls -1 "$d" | grep -v '^\._' | sed "s|^|$d/|"
done > "$OLDPWD/recovery/structure.txt"
```

## Related

- `docs/playlist-folder-sync.md` — what each sync does
- `CLAUDE.md` → "Drive Model" — V3 master / V1 subset semantics
