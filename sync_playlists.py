#!/usr/bin/env python3
"""
Sync all YouTube Music playlists to local JSON files for analytics.
Saves each playlist's tracks separately from the masterlist.
Incremental: only re-fetches playlists whose track count changed.

Output:
  playlists/
    _index.json          # Metadata index for all playlists
    <playlist_id>.json   # Tracks for each playlist

Usage:
    python sync_playlists.py         # Sync all playlists (incremental)
    python sync_playlists.py --full  # Force re-fetch all playlists
    python sync_playlists.py --dry   # Dry run
"""

import argparse
import json
import sys
from datetime import datetime, UTC
from pathlib import Path

from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).parent
BROWSER_AUTH_PATH = PROJECT_DIR / "browser.json"
PLAYLISTS_DIR = PROJECT_DIR / "public" / "playlists"


def get_ytmusic() -> YTMusic:
    if not BROWSER_AUTH_PATH.exists():
        print("ERROR: No browser.json found.")
        sys.exit(1)
    return YTMusic(str(BROWSER_AUTH_PATH))


def load_existing_index() -> dict[str, int]:
    """Load existing _index.json and return {playlistId: trackCount} map."""
    index_path = PLAYLISTS_DIR / "_index.json"
    if not index_path.exists():
        return {}
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {p["playlistId"]: p["trackCount"] for p in data.get("playlists", [])}
    except (json.JSONDecodeError, KeyError):
        return {}


def fetch_playlist_tracks(yt: YTMusic, playlist_id: str) -> list[dict]:
    try:
        result = yt.get_playlist(playlist_id, limit=None)
    except Exception as e:
        print(f"    Error: {e}")
        return []

    tracks = result.get("tracks", [])
    clean = []
    for t in tracks:
        video_id = t.get("videoId", "")
        if not video_id:
            continue
        artists = t.get("artists") or []
        artist_name = ";".join(a["name"] for a in artists if a.get("name"))
        album = t.get("album")
        album_name = album.get("name", "") if album else ""
        clean.append({
            "title": t.get("title", ""),
            "artist": artist_name,
            "album": album_name,
            "videoId": video_id,
            "duration": t.get("duration", ""),
        })
    return clean


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", "-d", action="store_true")
    parser.add_argument("--full", "-f", action="store_true", help="Force re-fetch all playlists")
    args = parser.parse_args()

    print("=" * 60)
    print("PLAYLIST SYNC — ALL YOUTUBE MUSIC PLAYLISTS")
    print("=" * 60)

    print("\nConnecting to YouTube Music...")
    yt = get_ytmusic()
    account = yt.get_account_info()
    print(f"Account: {account.get('accountName')}")

    print("\nFetching playlist list...")
    playlists = yt.get_library_playlists(limit=500)
    playlists = [p for p in playlists if p["playlistId"] != "LM"]
    print(f"Found {len(playlists)} playlists (excluding Liked Music)")

    if args.dry:
        for p in playlists:
            print(f"  {p['title']} — {p.get('count', '?')} songs")
        print(f"\n[DRY RUN] Would sync {len(playlists)} playlists.")
        return

    PLAYLISTS_DIR.mkdir(exist_ok=True)

    # Load existing index for incremental sync
    existing_counts = load_existing_index() if not args.full else {}
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    index = []
    total_tracks = 0
    fetched = 0
    skipped = 0

    for i, p in enumerate(playlists, 1):
        pid = p["playlistId"]
        title = p["title"]
        count = p.get("count", None)

        # Incremental: skip if track count unchanged and file exists
        if (
            not args.full
            and pid in existing_counts
            and count is not None
            and existing_counts[pid] == count
            and (PLAYLISTS_DIR / f"{pid}.json").exists()
        ):
            # Use existing data
            index.append({
                "playlistId": pid,
                "title": title,
                "trackCount": count,
            })
            total_tracks += count
            skipped += 1
            continue

        print(f"  [{i}/{len(playlists)}] {title} ({count or '?'} songs)...", end=" ", flush=True)

        tracks = fetch_playlist_tracks(yt, pid)
        total_tracks += len(tracks)
        fetched += 1
        print(f"got {len(tracks)}")

        playlist_data = {
            "playlistId": pid,
            "title": title,
            "trackCount": len(tracks),
            "syncedAt": now,
            "tracks": tracks,
        }
        with open(PLAYLISTS_DIR / f"{pid}.json", "w", encoding="utf-8") as f:
            json.dump(playlist_data, f, ensure_ascii=False, indent=1)

        index.append({
            "playlistId": pid,
            "title": title,
            "trackCount": len(tracks),
        })

    index_data = {
        "account": account.get("accountName", ""),
        "playlistCount": len(index),
        "totalTracks": total_tracks,
        "syncedAt": now,
        "playlists": index,
    }
    with open(PLAYLISTS_DIR / "_index.json", "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=1)

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    print(f"Playlists total:    {len(index)}")
    print(f"Fetched (changed):  {fetched}")
    print(f"Skipped (unchanged):{skipped}")
    print(f"Total tracks:       {total_tracks}")
    print(f"Saved to:           {PLAYLISTS_DIR}/")
    print("\nPlaylist sync complete!")


if __name__ == "__main__":
    main()
