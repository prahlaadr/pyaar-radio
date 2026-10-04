#!/usr/bin/env python3
"""
Apply triage picks to YouTube Music library.

Reads a triage export JSON (from pyaar-triage.html), looks up each album/song
on YT Music, and saves albums + likes singles. Logs every action so you can
review and re-run safely.

USAGE:
    cd ~/Documents/Projects/01-web-apps/pyaar-radio
    cp ~/Desktop/pyaar_triage_apply.py .
    .venv/bin/python pyaar_triage_apply.py --dry          # preview matches
    .venv/bin/python pyaar_triage_apply.py --apply        # actually save/like
    .venv/bin/python pyaar_triage_apply.py --apply --only-albums
    .venv/bin/python pyaar_triage_apply.py --apply --only-singles

After --apply, run the sync scripts to refresh CSVs:
    .venv/bin/python sync_albums.py --yes
    .venv/bin/python sync_liked.py --yes
"""

import argparse
import json
import re
import sys
import time
from datetime import datetime, UTC
from pathlib import Path

from ytmusicapi import YTMusic

DEFAULT_TRIAGE = Path.home() / "Downloads" / "pyaar-triage-2026-05-15.json"
BROWSER_AUTH = Path("browser.json")
LOG_PATH = Path("triage-apply-log.json")

ALBUM_SOURCES = {"radar_new", "audit_album", "audit_ep", "manual_add"}
SINGLE_SOURCES = {"audit_single"}


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def best_album_match(yt: YTMusic, artist: str, title: str) -> dict | None:
    """Search YT Music for an album by artist + title. Return result with matching artist, or None."""
    query = f"{artist} {title}"
    try:
        results = yt.search(query, filter="albums", limit=10)
    except Exception as e:
        print(f"    ! search error: {e}")
        return None
    if not results:
        return None

    target_artist = norm(artist)
    target_title = norm(title)

    # Strict: artist match + title close
    for r in results:
        result_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if any(target_artist == a or target_artist in a or a in target_artist for a in result_artists if a):
            if target_title in norm(r.get("title", "")) or norm(r.get("title", "")) in target_title:
                return r
    # Loose: top result if any artist token overlaps
    for r in results[:3]:
        result_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if any(a and (target_artist in a or a in target_artist) for a in result_artists):
            return r
    return None


def best_song_match(yt: YTMusic, artist: str, title: str) -> dict | None:
    query = f"{artist} {title}"
    try:
        results = yt.search(query, filter="songs", limit=10)
    except Exception as e:
        print(f"    ! search error: {e}")
        return None
    if not results:
        return None
    target_artist = norm(artist)
    target_title = norm(title)
    for r in results:
        result_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if any(target_artist == a or target_artist in a or a in target_artist for a in result_artists if a):
            if target_title in norm(r.get("title", "")) or norm(r.get("title", "")) in target_title:
                return r
    for r in results[:3]:
        result_artists = [norm(a.get("name", "")) for a in r.get("artists", [])]
        if any(a and (target_artist in a or a in target_artist) for a in result_artists):
            return r
    return None


def save_album(yt: YTMusic, browse_id: str) -> str:
    """Save an album to library. Returns playlist_id on success, raises on failure."""
    album_data = yt.get_album(browse_id)
    playlist_id = album_data.get("audioPlaylistId")
    if not playlist_id:
        raise RuntimeError("no audioPlaylistId returned by yt.get_album")
    yt.rate_playlist(playlist_id, "LIKE")
    return playlist_id


def like_song(yt: YTMusic, video_id: str) -> None:
    yt.rate_song(video_id, "LIKE")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--triage", type=Path, default=DEFAULT_TRIAGE)
    ap.add_argument("--dry", action="store_true", help="Preview matches without saving/liking")
    ap.add_argument("--apply", action="store_true", help="Actually save albums + like songs")
    ap.add_argument("--only-albums", action="store_true")
    ap.add_argument("--only-singles", action="store_true")
    ap.add_argument("--sleep", type=float, default=0.5, help="Delay between API calls")
    args = ap.parse_args()

    if not args.dry and not args.apply:
        print("Specify --dry or --apply")
        sys.exit(2)

    if args.apply and not BROWSER_AUTH.exists():
        print(f"ERROR: {BROWSER_AUTH} not found in cwd. Run from the pyaar-radio repo root.")
        sys.exit(1)

    data = json.loads(args.triage.read_text())
    picks = data.get("save", [])
    print(f"Triage file: {args.triage}")
    print(f"Total picks: {len(picks)}\n")

    do_albums = not args.only_singles
    do_singles = not args.only_albums

    yt = YTMusic(str(BROWSER_AUTH)) if args.apply else None
    if not yt:
        # search-only mode still needs an auth-less YTMusic
        yt = YTMusic()

    log = {"startedAt": datetime.now(UTC).isoformat(), "mode": "apply" if args.apply else "dry", "results": []}

    # --- Albums ---
    if do_albums:
        albums = [p for p in picks if p["source"] in ALBUM_SOURCES]
        print(f"--- ALBUMS ({len(albums)}) ---")
        for i, a in enumerate(albums, 1):
            entry = {"artist": a["artist"], "title": a["title"], "year": a.get("year", ""), "kind": "album", "source": a["source"]}
            bid = a.get("browseId")
            match_kind = ""
            if bid:
                match_kind = "from-radar"
            else:
                m = best_album_match(yt, a["artist"], a["title"])
                if m:
                    bid = m.get("browseId")
                    match_kind = f"search → '{m.get('title','')}' by {', '.join(x.get('name','') for x in m.get('artists',[]))}"
                else:
                    match_kind = "NO MATCH"
            entry["browseId"] = bid
            entry["match"] = match_kind

            print(f"  [{i:>3}/{len(albums)}] {a['artist']:<25} | {a['title'][:55]:<55} | {match_kind[:50]}")

            if args.apply and bid:
                try:
                    playlist_id = save_album(yt, bid)
                    entry["status"] = "saved"
                    entry["playlistId"] = playlist_id
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

    # --- Singles ---
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

                print(f"  [{i:>3}/{len(singles)}] {s['artist']:<25} | {s['title'][:55]:<55} | {match_kind[:50]}")

                if args.apply and vid:
                    try:
                        like_song(yt, vid)
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
                print(f"  [{i:>3}/{len(singles)}] {s['artist']:<25} | {s['title'][:55]:<55} | NO MATCH")
            log["results"].append(entry)

    log["finishedAt"] = datetime.now(UTC).isoformat()
    LOG_PATH.write_text(json.dumps(log, indent=2))
    print(f"\nLog written to {LOG_PATH}")

    # Summary
    saved = sum(1 for r in log["results"] if r.get("status") == "saved")
    liked = sum(1 for r in log["results"] if r.get("status") == "liked")
    no_match = sum(1 for r in log["results"] if r.get("status") == "no-match")
    errors = sum(1 for r in log["results"] if r.get("status") == "error")
    print(f"\nSummary: saved={saved}  liked={liked}  no-match={no_match}  errors={errors}")
    if no_match or errors:
        print("Review the log for items needing manual attention.")


if __name__ == "__main__":
    main()
