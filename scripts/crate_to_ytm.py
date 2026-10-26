#!/usr/bin/env python3
"""Push the live Pyaar Radio crates (lounge/nods/grooves) UP to their YT Music
playlists, additively.

Reads the browser's working crates straight from Zen's on-disk localStorage
(the `pyaar-crates` key, which carries exact videoIds), diffs each against its
mapped YTM playlist, and adds anything new. NEVER removes (keep-safe) — a song
dropped from a crate stays on YTM and V1.

Only calls the YTM API when the crates actually changed since the last run
(sha1 signature in ~/.config/pyaar-sync/crate_ytm_state.json), and exits cleanly
when offline (state isn't advanced, so it retries next run). The YTM->V1 half is
handled separately by sync_folder.py on USB mount.

name -> playlistId comes from scripts/setlist_sync_map.json (titles lounge/nods/
grooves). Auth: browser.json (Pyaar Radio account). Run every ~15 min by the
com.pyaar.crate-ytm-sync LaunchAgent.
"""
import json
import sqlite3
import shutil
import sys
import hashlib
import tempfile
from pathlib import Path

import cramjam
from ytmusicapi import YTMusic

HERE = Path(__file__).resolve().parent
PROJECT = HERE.parent
MAP = HERE / "setlist_sync_map.json"
AUTH = PROJECT / "browser.json"
STATE = Path.home() / ".config" / "pyaar-sync" / "crate_ytm_state.json"
CRATES = {"lounge", "nods", "grooves"}
# The app may be used on either origin; prefer the custom domain, fall back to vercel.
ORIGINS = ["https+++radio.pyaarproject.org", "https+++pyaar-radio.vercel.app"]
ZEN_PROFILES = Path.home() / "Library/Application Support/zen/Profiles"


def crate_dbs():
    """Zen localStorage sqlite files for our origins, newest first."""
    cands = []
    for origin in ORIGINS:
        cands += list(ZEN_PROFILES.glob(f"*/storage/default/{origin}/ls/data.sqlite"))
    cands.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return cands


def read_crates():
    """Return {name: [videoId, ...]} for the three crates, or {} if not found."""
    for db in crate_dbs():
        try:
            with tempfile.TemporaryDirectory() as tmp:
                t = Path(tmp) / "ls.sqlite"
                shutil.copy2(db, t)  # copy so a live Zen lock can't block us
                for ext in ("-wal", "-shm"):
                    src = Path(str(db) + ext)
                    if src.exists():
                        shutil.copy2(src, str(t) + ext)
                con = sqlite3.connect(f"file:{t}?mode=ro", uri=True)
                row = con.execute(
                    "SELECT value, compression_type FROM data WHERE key='pyaar-crates'"
                ).fetchone()
                con.close()
            if not row:
                continue
            val, ct = row
            raw = bytes(cramjam.snappy.decompress_raw(val)) if ct == 1 else \
                (val if isinstance(val, (bytes, bytearray)) else str(val).encode())
            crates = json.loads(raw.decode("utf-8", errors="replace"))
            out = {}
            for c in crates:
                nm = (c.get("name") or "").strip().lower()
                if nm in CRATES:
                    out[nm] = [t["videoId"] for t in c.get("tracks", []) if t.get("videoId")]
            if out:
                return out
        except Exception as e:  # unreadable/locked/garbage — try the next candidate
            print(f"  skip {db}: {e}", file=sys.stderr)
    return {}


def name_to_pid():
    m = json.loads(MAP.read_text())
    return {x["title"].strip().lower(): x["playlistId"]
            for x in m["mappings"] if x["title"].strip().lower() in CRATES}


def signature(crates):
    return hashlib.sha1(
        json.dumps({k: crates[k] for k in sorted(crates)}, sort_keys=True).encode()
    ).hexdigest()


def main():
    crates = read_crates()
    if not crates:
        print("no crates found (Zen profile missing or crates empty) — nothing to do")
        return

    sig = signature(crates)
    last = json.loads(STATE.read_text()) if STATE.exists() else {}
    if last.get("sig") == sig:
        print("crates unchanged — skip")
        return

    pids = name_to_pid()
    try:
        yt = YTMusic(str(AUTH))
    except Exception as e:
        print(f"YTM auth/init failed ({e}) — retry next run")
        return

    added = 0
    for name, vids in crates.items():
        pid = pids.get(name)
        if not pid:
            print(f"  {name}: no playlist mapping — skip")
            continue
        try:
            pl = yt.get_playlist(pid, limit=None)
        except Exception as e:  # most likely offline — don't advance state, retry later
            print(f"  {name}: YTM fetch failed ({e}) — retry next run")
            return
        have = {t.get("videoId") for t in pl.get("tracks", [])}
        missing = [v for v in vids if v not in have]
        if missing:
            yt.add_playlist_items(pid, missing, duplicates=False)
            added += len(missing)
            print(f"  {name}: +{len(missing)} (now {len(vids)}) -> {pid}")
        else:
            print(f"  {name}: up to date ({len(vids)})")

    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"sig": sig}))
    print(f"done — added {added}")


if __name__ == "__main__":
    main()
