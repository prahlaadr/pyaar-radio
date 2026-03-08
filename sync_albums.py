#!/usr/bin/env python3
"""
Sync saved YouTube Music albums to local JSON files.
Each album saved as a separate JSON, with an _index.json manifest.
Incremental: only re-fetches albums not already synced.

Output:
  albums/
    _index.json          # Metadata index for all saved albums
    <browse_id>.json     # Tracks for each album

Usage:
    python sync_albums.py         # Sync saved albums (incremental)
    python sync_albums.py --full  # Force re-fetch all albums
    python sync_albums.py --dry   # Dry run
"""

import argparse
import json
import sys
from datetime import datetime, UTC
from pathlib import Path

from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).parent
BROWSER_AUTH_PATH = PROJECT_DIR / "browser.json"
ALBUMS_DIR = PROJECT_DIR / "albums"


def get_ytmusic() -> YTMusic:
    if not BROWSER_AUTH_PATH.exists():
        print("ERROR: No browser.json found.")
        sys.exit(1)
    return YTMusic(str(BROWSER_AUTH_PATH))


def load_existing_index() -> dict[str, int]:
    """Load existing _index.json and return {browseId: trackCount} map."""
    index_path = ALBUMS_DIR / "_index.json"
    if not index_path.exists():
        return {}
    try:
        with open(index_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return {a["browseId"]: a["trackCount"] for a in data.get("albums", [])}
    except (json.JSONDecodeError, KeyError):
        return {}


def fetch_album_tracks(yt: YTMusic, browse_id: str) -> dict:
    """Fetch album details and return clean album data."""
    try:
        detail = yt.get_album(browse_id)
    except Exception as e:
        print(f"    Error: {e}")
        return None

    tracks = []
    for t in detail.get("tracks", []):
        video_id = t.get("videoId", "")
        if not video_id:
            continue
        artists = t.get("artists") or []
        artist_name = ";".join(a["name"] for a in artists if a.get("name"))
        tracks.append({
            "title": t.get("title", ""),
            "artist": artist_name,
            "videoId": video_id,
            "duration": t.get("duration", ""),
        })

    return {
        "title": detail.get("title", ""),
        "artist": detail.get("artists", [{}])[0].get("name", "") if detail.get("artists") else "",
        "year": detail.get("year", ""),
        "trackCount": len(tracks),
        "tracks": tracks,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", "-d", action="store_true")
    parser.add_argument("--full", "-f", action="store_true", help="Force re-fetch all albums")
    args = parser.parse_args()

    print("=" * 60)
    print("ALBUM SYNC — SAVED YOUTUBE MUSIC ALBUMS")
    print("=" * 60)

    print("\nConnecting to YouTube Music...")
    yt = get_ytmusic()
    account = yt.get_account_info()
    print(f"Account: {account.get('accountName')}")

    print("\nFetching saved albums...")
    library_albums = yt.get_library_albums(limit=5000)
    print(f"Found {len(library_albums)} saved albums")

    if args.dry:
        for a in library_albums[:30]:
            artists = a.get("artists") or [{}]
            artist = artists[0].get("name", "?") if artists else "?"
            print(f"  {artist} — {a.get('title', '?')}")
        if len(library_albums) > 30:
            print(f"  ... and {len(library_albums) - 30} more")
        print(f"\n[DRY RUN] Would sync {len(library_albums)} albums.")
        return

    ALBUMS_DIR.mkdir(exist_ok=True)

    # Load existing index for incremental sync
    existing_counts = load_existing_index() if not args.full else {}
    now = datetime.now(UTC).isoformat().replace("+00:00", "Z")

    index = []
    total_tracks = 0
    fetched = 0
    skipped = 0

    for i, album in enumerate(library_albums, 1):
        browse_id = album.get("browseId", "")
        title = album.get("title", "Unknown")
        artists = album.get("artists") or [{}]
        artist = artists[0].get("name", "?") if artists else "?"

        if not browse_id:
            continue

        # Incremental: skip if already synced and file exists
        if (
            not args.full
            and browse_id in existing_counts
            and (ALBUMS_DIR / f"{browse_id}.json").exists()
        ):
            # Use existing file's track count
            existing_count = existing_counts[browse_id]
            index.append({
                "browseId": browse_id,
                "title": title,
                "artist": artist,
                "trackCount": existing_count,
            })
            total_tracks += existing_count
            skipped += 1
            continue

        if fetched % 50 == 0 or i <= 5:
            print(f"  [{i}/{len(library_albums)}] {artist} — {title}...", end=" ", flush=True)

        album_data = fetch_album_tracks(yt, browse_id)
        if album_data is None:
            if fetched % 50 == 0 or i <= 5:
                print("FAILED")
            continue

        fetched += 1
        track_count = album_data["trackCount"]
        total_tracks += track_count

        if fetched % 50 == 0 or i <= 5:
            print(f"got {track_count}")

        # Save album JSON
        album_data["browseId"] = browse_id
        album_data["syncedAt"] = now
        with open(ALBUMS_DIR / f"{browse_id}.json", "w", encoding="utf-8") as f:
            json.dump(album_data, f, ensure_ascii=False, indent=1)

        index.append({
            "browseId": browse_id,
            "title": title,
            "artist": artist,
            "trackCount": track_count,
        })

    # Save index
    index_data = {
        "account": account.get("accountName", ""),
        "albumCount": len(index),
        "totalTracks": total_tracks,
        "syncedAt": now,
        "albums": index,
    }
    with open(ALBUMS_DIR / "_index.json", "w", encoding="utf-8") as f:
        json.dump(index_data, f, ensure_ascii=False, indent=1)

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    print(f"Albums total:       {len(index)}")
    print(f"Fetched (new):      {fetched}")
    print(f"Skipped (existing): {skipped}")
    print(f"Total tracks:       {total_tracks}")
    print(f"Saved to:           {ALBUMS_DIR}/")
    print("\nAlbum sync complete!")


if __name__ == "__main__":
    main()
