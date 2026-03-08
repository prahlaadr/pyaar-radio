#!/usr/bin/env python3
"""
Sync masterlist.csv with YouTube Music library.
Sources: liked songs, saved albums, and monthly playlists.
Append-only: new songs get added, existing rows never modified.
Deduplicates by Video ID.

Usage:
    python sync_liked.py --yes          # Auto-confirm + push
    python sync_liked.py --dry          # Dry run
    python sync_liked.py --yes --no-push # No git push (for CI)
"""

import argparse
import csv
import re
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).parent
MASTERLIST_PATH = PROJECT_DIR / "public" / "data" / "masterlist.csv"
BACKUP_DIR = PROJECT_DIR / "backups"
BROWSER_AUTH_PATH = PROJECT_DIR / "browser.json"

COLUMNS = [
    "Track Name", "Artist Name(s)", "Album Name", "Genres", "Tempo",
    "Duration", "Popularity", "Key", "Release Date", "Instrumentalness",
    "Tags", "Liked", "Playlist 1", "Playlist 2", "Playlist 3",
    "Playlist 4", "Playlist 5", "Playlist Count", "Video ID",
    "Soundcloud ID", "Source",
]

# Regex patterns to identify monthly playlists (e.g. "Feb 26", "Mirch 26", "Jooli '25")
MONTHLY_PATTERNS = [
    r"^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s*'?\d{2}\b",
    r"^(mirch|feeb|febyouary|jooli|joon|apreel|aprul|agust|ock|okt|simptember|decembrrr|novemburr|mai|juun|deck|murch)\s",
]


def get_ytmusic() -> YTMusic:
    if not BROWSER_AUTH_PATH.exists():
        print("ERROR: No browser.json found.")
        sys.exit(1)
    return YTMusic(str(BROWSER_AUTH_PATH))


def load_existing_video_ids() -> set[str]:
    video_ids = set()
    if not MASTERLIST_PATH.exists():
        return video_ids
    with open(MASTERLIST_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            vid = row.get("Video ID", "").strip()
            if vid:
                video_ids.add(vid)
    print(f"Loaded {len(video_ids)} existing Video IDs from masterlist")
    return video_ids


def is_monthly_playlist(title: str) -> bool:
    """Check if a playlist title matches the monthly playlist naming convention."""
    for pattern in MONTHLY_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            return True
    return False


def extract_tracks(raw_tracks: list[dict]) -> list[dict]:
    """Extract clean track dicts from ytmusicapi track objects."""
    songs = []
    for track in raw_tracks:
        video_id = track.get("videoId", "")
        if not video_id:
            continue
        artists = track.get("artists") or []
        artist_name = ";".join(a["name"] for a in artists if a.get("name"))
        album = track.get("album")
        album_name = album.get("name", "") if album else ""
        songs.append({
            "title": track.get("title", ""),
            "artist": artist_name,
            "album": album_name,
            "videoId": video_id,
        })
    return songs


def fetch_liked_songs(yt: YTMusic) -> list[dict]:
    print("Fetching liked songs...")
    result = yt.get_liked_songs(limit=None)
    tracks = extract_tracks(result.get("tracks", []))
    print(f"  Found {len(tracks)} liked songs")
    return tracks


def fetch_monthly_playlists(yt: YTMusic) -> list[dict]:
    """Fetch tracks from all monthly playlists (e.g. 'Feb 26', 'Mirch 26')."""
    print("Fetching monthly playlists...")
    all_playlists = yt.get_library_playlists(limit=500)
    monthly = [p for p in all_playlists if is_monthly_playlist(p["title"])]
    print(f"  Found {len(monthly)} monthly playlists")

    all_tracks = []
    seen_ids = set()
    for p in monthly:
        try:
            result = yt.get_playlist(p["playlistId"], limit=None)
            tracks = extract_tracks(result.get("tracks", []))
            new = [t for t in tracks if t["videoId"] not in seen_ids]
            for t in new:
                seen_ids.add(t["videoId"])
            all_tracks.extend(new)
            print(f"    {p['title']}: {len(tracks)} tracks ({len(new)} new)")
        except Exception as e:
            print(f"    {p['title']}: ERROR — {e}")

    print(f"  Total from monthly playlists: {len(all_tracks)}")
    return all_tracks


def fetch_saved_albums(yt: YTMusic) -> list[dict]:
    """Fetch tracks from all saved/liked albums."""
    print("Fetching saved albums...")
    albums = yt.get_library_albums(limit=5000)
    print(f"  Found {len(albums)} saved albums")

    all_tracks = []
    seen_ids = set()
    for i, album in enumerate(albums, 1):
        browse_id = album.get("browseId", "")
        title = album.get("title", "Unknown")
        if not browse_id:
            continue
        try:
            detail = yt.get_album(browse_id)
            tracks = extract_tracks(detail.get("tracks", []))
            new = [t for t in tracks if t["videoId"] not in seen_ids]
            for t in new:
                seen_ids.add(t["videoId"])
            all_tracks.extend(new)
            if i % 50 == 0 or i == len(albums):
                print(f"    [{i}/{len(albums)}] {title} — {len(tracks)} tracks")
        except Exception as e:
            print(f"    [{i}/{len(albums)}] {title}: ERROR — {e}")

    print(f"  Total from saved albums: {len(all_tracks)}")
    return all_tracks


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", "-y", action="store_true")
    parser.add_argument("--dry", "-d", action="store_true")
    parser.add_argument("--no-push", action="store_true")
    args = parser.parse_args()

    print("=" * 60)
    print("MASTERLIST SYNC — LIKED + ALBUMS + MONTHLY (APPEND-ONLY)")
    print("=" * 60)

    print("\nLoading existing masterlist...")
    existing_ids = load_existing_video_ids()

    print("\nConnecting to YouTube Music...")
    yt = get_ytmusic()
    print("Connected!\n")

    # Fetch all three sources
    liked = fetch_liked_songs(yt)
    monthly = fetch_monthly_playlists(yt)
    albums = fetch_saved_albums(yt)

    # Merge all sources, dedup by Video ID
    all_songs = {}
    for song in liked + monthly + albums:
        vid = song["videoId"]
        if vid not in all_songs:
            all_songs[vid] = song

    # Filter to only new songs not in masterlist
    new_songs = {vid: s for vid, s in all_songs.items() if vid not in existing_ids}
    new_rows = []
    for song in new_songs.values():
        row = {col: "" for col in COLUMNS}
        row["Track Name"] = song["title"]
        row["Artist Name(s)"] = song["artist"]
        row["Album Name"] = song["album"]
        row["Video ID"] = song["videoId"]
        row["Liked"] = "Yes" if song["videoId"] in {s["videoId"] for s in liked} else ""
        row["Source"] = "YT Music"
        new_rows.append(row)

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    print(f"Existing songs in masterlist: {len(existing_ids)}")
    print(f"Liked songs:                  {len(liked)}")
    print(f"Monthly playlist songs:       {len(monthly)}")
    print(f"Saved album songs:            {len(albums)}")
    print(f"Combined unique:              {len(all_songs)}")
    print(f"New songs to append:          {len(new_rows)}")

    if not new_rows:
        print("\nNo new songs to add. Masterlist is up to date!")
        return

    print(f"\nNew songs:")
    for row in new_rows[:20]:
        print(f"  + {row['Artist Name(s)']} — {row['Track Name']}")
    if len(new_rows) > 20:
        print(f"  ... and {len(new_rows) - 20} more")

    if args.dry:
        print("\n[DRY RUN] No changes saved.")
        return

    if not args.yes:
        confirm = input("\nAppend new songs? (y/n): ").strip().lower()
        if confirm != "y":
            print("Cancelled.")
            return

    # Backup
    BACKUP_DIR.mkdir(exist_ok=True)
    if MASTERLIST_PATH.exists():
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup = BACKUP_DIR / f"masterlist_backup_{ts}.csv"
        backup.write_text(MASTERLIST_PATH.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"Backup created: {backup}")

    # Append
    with open(MASTERLIST_PATH, "a", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writerows(new_rows)
    print(f"Appended {len(new_rows)} new songs")

    # Push (local only, skip in CI)
    if not args.no_push:
        try:
            subprocess.run(["git", "add", str(MASTERLIST_PATH)], cwd=PROJECT_DIR, check=True)
            ts = datetime.now().strftime("%Y-%m-%d %H:%M")
            subprocess.run(["git", "commit", "-m", f"sync: update masterlist ({ts})"],
                           cwd=PROJECT_DIR, check=True)
            subprocess.run(["git", "push"], cwd=PROJECT_DIR, check=True)
            print("Pushed to pyaar-radio.")
        except subprocess.CalledProcessError as e:
            print(f"ERROR pushing: {e}")

    print("\nSync complete!")


if __name__ == "__main__":
    main()
