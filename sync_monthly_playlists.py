#!/usr/bin/env python3
"""Targeted monthly-playlist sync. Fetches only "Month YY" playlists from YT
Music — the ones used by sync_usb.py for V3 PYAAR.Radio/Monthlys/ population.

Why: sync_playlists.py walks all 244 user playlists. For the monthly archive
chain we only need the dozen-ish monthly playlists. Same incremental
strategy (skip unchanged track counts), narrower scope.

Usage:
    python3 sync_monthly_playlists.py                    # discover + sync all monthly
    python3 sync_monthly_playlists.py <playlist_id>      # sync one specific playlist
    python3 sync_monthly_playlists.py --full             # force re-fetch all monthly
    python3 sync_monthly_playlists.py --dry              # preview only

Output mirrors sync_playlists.py:
  - public/playlists/_index.json   (additive: preserves non-monthly entries)
  - public/playlists/<id>.json     (one per monthly playlist)
"""
import argparse
import json
import re
import sys
from datetime import datetime, UTC
from pathlib import Path

from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).parent
BROWSER_AUTH_PATH = PROJECT_DIR / "browser.json"
PLAYLISTS_DIR = PROJECT_DIR / "public" / "playlists"
INDEX_PATH = PLAYLISTS_DIR / "_index.json"

# Match sync_usb.py's MONTH_MAP exactly so the discovery filter matches
# what the downstream archive-sync expects.
MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "mirch": 3, "feeb": 2, "febyouary": 2, "jooli": 7, "joon": 6,
    "apreel": 4, "aprul": 4, "agust": 8, "ock": 10, "okt": 10,
    "simptember": 9, "decembrrr": 12, "novemburr": 11, "mai": 5,
    "juun": 6, "deck": 12, "murch": 3, "march": 3, "june": 6,
    "july": 7, "august": 8, "april": 4, "november": 11, "september": 9,
    "october": 10, "february": 2, "january": 1, "december": 12,
}
MONTH_RE = re.compile(r"^(\w+)\s*'?(\d{2})\b", re.IGNORECASE)


def is_monthly(title: str) -> bool:
    """Match the same regex sync_usb.py uses to identify archive playlists."""
    if not title:
        return False
    m = MONTH_RE.match(title.strip())
    if not m:
        return False
    return m.group(1).lower() in MONTH_MAP


def get_ytmusic() -> YTMusic:
    if not BROWSER_AUTH_PATH.exists():
        print(f"ERROR: No browser.json at {BROWSER_AUTH_PATH}", file=sys.stderr)
        sys.exit(1)
    return YTMusic(str(BROWSER_AUTH_PATH))


def normalize_count(c) -> int:
    """YT Music's library listing returns count as int OR string like '12 songs'."""
    if isinstance(c, int):
        return c
    if isinstance(c, str):
        m = re.search(r"\d+", c)
        return int(m.group()) if m else 0
    return 0


def fetch_tracks(yt: YTMusic, playlist_id: str) -> list[dict]:
    """Same clean-track shape as sync_playlists.py."""
    try:
        result = yt.get_playlist(playlist_id, limit=None)
    except Exception as e:
        print(f"    Error fetching {playlist_id}: {e}")
        return []
    out = []
    for t in result.get("tracks", []):
        vid = t.get("videoId", "")
        if not vid:
            continue
        artists = t.get("artists") or []
        album = t.get("album")
        out.append({
            "title": t.get("title", ""),
            "artist": ";".join(a["name"] for a in artists if a.get("name")),
            "album": album.get("name", "") if isinstance(album, dict) else "",
            "videoId": vid,
            "duration": t.get("duration", ""),
        })
    return out


def load_index() -> dict:
    """Return the existing _index.json contents (or empty shell)."""
    if not INDEX_PATH.exists():
        return {"syncedAt": "", "totalPlaylists": 0, "totalTracks": 0, "playlists": []}
    try:
        return json.loads(INDEX_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {"syncedAt": "", "totalPlaylists": 0, "totalTracks": 0, "playlists": []}


def write_playlist_file(pid: str, title: str, tracks: list[dict], synced_at: str) -> None:
    payload = {
        "playlistId": pid,
        "title": title,
        "trackCount": len(tracks),
        "syncedAt": synced_at,
        "tracks": tracks,
    }
    (PLAYLISTS_DIR / f"{pid}.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False)
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Targeted monthly-playlist sync")
    parser.add_argument("playlist_id", nargs="?",
                        help="Sync only this playlist ID (skip discovery)")
    parser.add_argument("--full", "-f", action="store_true",
                        help="Force re-fetch even if track counts unchanged")
    parser.add_argument("--dry", "-d", action="store_true",
                        help="Preview only, don't fetch or write")
    args = parser.parse_args()

    yt = get_ytmusic()
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")
    PLAYLISTS_DIR.mkdir(parents=True, exist_ok=True)

    if args.playlist_id:
        # Fetch a single playlist by ID (no library listing — fastest path)
        print(f"Fetching single playlist {args.playlist_id}...")
        try:
            meta = yt.get_playlist(args.playlist_id, limit=0)
        except Exception as e:
            print(f"ERROR: {e}", file=sys.stderr)
            return 1
        targets = [{
            "playlistId": args.playlist_id,
            "title": meta.get("title", ""),
            "count": meta.get("trackCount") or 0,
        }]
        skip_monthly_filter = True
    else:
        print("Listing library playlists...")
        all_pls = yt.get_library_playlists(limit=500)
        all_pls = [p for p in all_pls if p.get("playlistId") != "LM"]
        targets = [
            {"playlistId": p["playlistId"], "title": p["title"],
             "count": normalize_count(p.get("count"))}
            for p in all_pls if is_monthly(p.get("title", ""))
        ]
        skip_monthly_filter = False
        print(f"Found {len(all_pls)} library playlists, "
              f"{len(targets)} match the monthly pattern.")

    if not targets:
        print("No monthly playlists to sync.")
        return 0

    # Existing index — keyed by playlistId for cheap merging
    index = load_index()
    by_id = {p["playlistId"]: p for p in index.get("playlists", [])}

    fetched = skipped = 0
    for t in targets:
        pid = t["playlistId"]
        title = t["title"]
        new_count = normalize_count(t["count"])

        if not skip_monthly_filter and not is_monthly(title):
            # Belt + suspenders: ID-mode bypasses filter, discovery-mode already
            # filtered upstream. This catches a future bug if the call sites change.
            continue

        prev = by_id.get(pid, {})
        prev_count = prev.get("trackCount", -1)
        file_exists = (PLAYLISTS_DIR / f"{pid}.json").exists()

        if not args.full and prev_count == new_count and file_exists:
            print(f"  = {title:<25} ({new_count} tracks) — unchanged")
            skipped += 1
            continue

        change = f"{prev_count} → {new_count}" if prev_count >= 0 else f"new, {new_count}"
        print(f"  + {title:<25} ({change}) — fetch", end="", flush=True)
        if args.dry:
            print(" [DRY]")
            continue

        tracks = fetch_tracks(yt, pid)
        if not tracks and new_count > 0:
            print(" ✗ (no tracks returned)")
            continue
        write_playlist_file(pid, title, tracks, now)
        by_id[pid] = {
            "playlistId": pid, "title": title, "trackCount": len(tracks),
            "syncedAt": now,
        }
        print(f" ✓ ({len(tracks)} tracks)")
        fetched += 1

    if fetched and not args.dry:
        # Persist updated index — additive across all playlists, not just monthly
        index["playlists"] = list(by_id.values())
        index["totalPlaylists"] = len(index["playlists"])
        index["totalTracks"] = sum(p.get("trackCount", 0) for p in index["playlists"])
        index["syncedAt"] = now
        INDEX_PATH.write_text(json.dumps(index, indent=2, ensure_ascii=False))
        print(f"\n_index.json updated ({index['totalPlaylists']} playlists total)")

    print(f"\nDone. fetched={fetched} skipped={skipped} {'(DRY)' if args.dry else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
