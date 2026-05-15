#!/usr/bin/env python3
"""Apply triage picks to YT Music: save albums, like singles.

Reads a triage-export JSON (from pyaar-triage.html or /radar export), searches
YT Music for each item, and saves albums + likes singles via the same patterns
used by radar/release.py. Logs every action.

Usage (local):
    cd ~/Documents/Projects/01-web-apps/pyaar-radio
    .venv/bin/python scripts/triage_apply.py --triage triage-runs/2026-05-15.json --dry
    .venv/bin/python scripts/triage_apply.py --triage triage-runs/2026-05-15.json --apply

Usage (CI): invoked by .github/workflows/triage-apply.yml.
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, UTC
from pathlib import Path

from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).resolve().parent.parent
BROWSER_AUTH = PROJECT_DIR / "browser.json"

ALBUM_SOURCES = {"radar_new", "audit_album", "audit_ep", "manual_add"}
SINGLE_SOURCES = {"audit_single"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def _artist_match(target: str, candidates: list[str]) -> bool:
    t = norm(target)
    return any(c and (t == c or t in c or c in t) for c in candidates)


def best_album_match(yt: YTMusic, artist: str, title: str) -> dict | None:
    try:
        results = yt.search(f"{artist} {title}", filter="albums", limit=10)
    except Exception as e:
        print(f"    ! search error: {e}")
        return None
    if not results:
        return None
    target_title = norm(title)
    for r in results:
        cand_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if _artist_match(artist, cand_artists):
            t = norm(r.get("title", ""))
            if target_title in t or t in target_title:
                return r
    for r in results[:3]:
        cand_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if _artist_match(artist, cand_artists):
            return r
    return None


def best_song_match(yt: YTMusic, artist: str, title: str) -> dict | None:
    try:
        results = yt.search(f"{artist} {title}", filter="songs", limit=10)
    except Exception as e:
        print(f"    ! search error: {e}")
        return None
    if not results:
        return None
    target_title = norm(title)
    for r in results:
        cand_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if _artist_match(artist, cand_artists):
            t = norm(r.get("title", ""))
            if target_title in t or t in target_title:
                return r
    for r in results[:3]:
        cand_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if _artist_match(artist, cand_artists):
            return r
    return None


def save_album(yt: YTMusic, browse_id: str) -> str:
    data = yt.get_album(browse_id)
    playlist_id = data.get("audioPlaylistId")
    if not playlist_id:
        raise RuntimeError("no audioPlaylistId")
    yt.rate_playlist(playlist_id, "LIKE")
    return playlist_id


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--triage", type=Path, required=True)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only-albums", action="store_true")
    ap.add_argument("--only-singles", action="store_true")
    ap.add_argument("--sleep", type=float, default=0.5)
    ap.add_argument("--log", type=Path, default=None)
    args = ap.parse_args()

    if not (args.dry or args.apply):
        print("Specify --dry or --apply")
        sys.exit(2)

    if args.apply and not BROWSER_AUTH.exists():
        print(f"ERROR: {BROWSER_AUTH} not found.")
        sys.exit(1)

    data = json.loads(args.triage.read_text())
    picks = data.get("save", [])
    print(f"Triage file: {args.triage}")
    print(f"Mode: {'apply' if args.apply else 'dry'}")
    print(f"Picks: {len(picks)}\n")

    yt = YTMusic(str(BROWSER_AUTH)) if args.apply else YTMusic()

    do_albums = not args.only_singles
    do_singles = not args.only_albums

    log = {"startedAt": datetime.now(UTC).isoformat(), "mode": "apply" if args.apply else "dry",
           "triageFile": str(args.triage), "results": []}

    if do_albums:
        albums = [p for p in picks if p["source"] in ALBUM_SOURCES]
        print(f"--- ALBUMS ({len(albums)}) ---")
        for i, a in enumerate(albums, 1):
            entry = {"artist": a["artist"], "title": a["title"], "year": a.get("year", ""),
                     "kind": "album", "source": a["source"]}
            bid = a.get("browseId")
            match_kind = "from-radar" if bid else None
            if not bid:
                m = best_album_match(yt, a["artist"], a["title"])
                if m:
                    bid = m.get("browseId")
                    match_kind = f"search → '{m.get('title','')}' by {', '.join(x.get('name','') for x in m.get('artists',[]))}"
                else:
                    match_kind = "NO MATCH"
            entry["browseId"] = bid
            entry["match"] = match_kind
            print(f"  [{i:>3}/{len(albums)}] {a['artist']:<25.25} | {a['title']:<55.55} | {match_kind[:50]}")
            if args.apply and bid:
                try:
                    pid = save_album(yt, bid)
                    entry["status"] = "saved"
                    entry["playlistId"] = pid
                    print(f"        ✓ saved")
                except Exception as e:
                    entry["status"] = "error"
                    entry["error"] = str(e)
                    print(f"        ✗ {e}")
                time.sleep(args.sleep)
            elif args.apply:
                entry["status"] = "no-match"
            else:
                entry["status"] = "preview"
            log["results"].append(entry)

    if do_singles:
        singles = [p for p in picks if p["source"] in SINGLE_SOURCES]
        print(f"\n--- SINGLES ({len(singles)}) ---")
        for i, s in enumerate(singles, 1):
            entry = {"artist": s["artist"], "title": s["title"], "kind": "single", "source": s["source"]}
            m = best_song_match(yt, s["artist"], s["title"])
            if m:
                vid = m.get("videoId")
                match_kind = f"search → '{m.get('title','')}' by {', '.join(x.get('name','') for x in m.get('artists',[]))}"
                entry["videoId"] = vid
                entry["match"] = match_kind
                print(f"  [{i:>3}/{len(singles)}] {s['artist']:<25.25} | {s['title']:<55.55} | {match_kind[:50]}")
                if args.apply and vid:
                    try:
                        yt.rate_song(vid, "LIKE")
                        entry["status"] = "liked"
                        print(f"        ♥ liked")
                    except Exception as e:
                        entry["status"] = "error"
                        entry["error"] = str(e)
                        print(f"        ✗ {e}")
                    time.sleep(args.sleep)
                else:
                    entry["status"] = "preview"
            else:
                entry["match"] = "NO MATCH"
                entry["status"] = "no-match"
                print(f"  [{i:>3}/{len(singles)}] {s['artist']:<25.25} | {s['title']:<55.55} | NO MATCH")
            log["results"].append(entry)

    log["finishedAt"] = datetime.now(UTC).isoformat()
    log["summary"] = {
        "saved": sum(1 for r in log["results"] if r.get("status") == "saved"),
        "liked": sum(1 for r in log["results"] if r.get("status") == "liked"),
        "no_match": sum(1 for r in log["results"] if r.get("status") == "no-match"),
        "errors": sum(1 for r in log["results"] if r.get("status") == "error"),
        "preview": sum(1 for r in log["results"] if r.get("status") == "preview"),
    }

    log_path = args.log or (args.triage.parent / f"{args.triage.stem}.log.json")
    log_path.write_text(json.dumps(log, indent=2))
    print(f"\nLog: {log_path}")
    print(f"Summary: {log['summary']}")


if __name__ == "__main__":
    main()
