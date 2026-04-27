#!/usr/bin/env python3
"""
Sync masterlist.csv with YouTube Music library.
Sources: liked songs and monthly playlists.
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
    "Soundcloud ID", "Source", "Liked Position",
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


def load_existing_rows() -> tuple[list[dict], list[str]]:
    """Returns (rows, fieldnames). Used to update Liked column for existing tracks."""
    if not MASTERLIST_PATH.exists():
        return [], []
    with open(MASTERLIST_PATH, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        rows = list(reader)
        fieldnames = list(reader.fieldnames or [])
    return rows, fieldnames


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
    for pattern in MONTHLY_PATTERNS:
        if re.search(pattern, title, re.IGNORECASE):
            return True
    return False


def extract_tracks(raw_tracks: list[dict]) -> list[dict]:
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--yes", "-y", action="store_true")
    parser.add_argument("--dry", "-d", action="store_true")
    parser.add_argument("--no-push", action="store_true")
    args = parser.parse_args()

    print("=" * 60)
    print("MASTERLIST SYNC — LIKED + MONTHLY (APPEND-ONLY)")
    print("=" * 60)

    print("\nLoading existing masterlist...")
    existing_rows, file_fieldnames = load_existing_rows()
    existing_ids = {r.get("Video ID", "") for r in existing_rows if r.get("Video ID")}
    print(f"Loaded {len(existing_ids)} existing Video IDs from masterlist")

    print("\nConnecting to YouTube Music...")
    yt = get_ytmusic()
    print("Connected!\n")

    # Fetch both sources
    liked = fetch_liked_songs(yt)
    monthly = fetch_monthly_playlists(yt)

    # Merge, dedup by Video ID
    all_songs = {}
    for song in liked + monthly:
        vid = song["videoId"]
        if vid not in all_songs:
            all_songs[vid] = song

    # Capture YT Music's liked-songs ordering (reverse-chronological, newest first)
    # so the app can sort the ♥ Liked tab by recency. 0 = most recently liked.
    # When the user re-likes a track, YT Music's API returns it at BOTH the new
    # position AND the old position. We want the FIRST (lowest, newest) position
    # because that's where YT Music's UI shows it. setdefault keeps the first.
    liked_position: dict[str, int] = {}
    for i, song in enumerate(liked):
        vid = song.get("videoId")
        if vid:
            liked_position.setdefault(vid, i)

    # Filter to only new songs not in masterlist
    new_songs = {vid: s for vid, s in all_songs.items() if vid not in existing_ids}
    liked_ids = {s["videoId"] for s in liked}
    new_rows = []
    for song in new_songs.values():
        row = {col: "" for col in COLUMNS}
        row["Track Name"] = song["title"]
        row["Artist Name(s)"] = song["artist"]
        row["Album Name"] = song["album"]
        row["Video ID"] = song["videoId"]
        row["Liked"] = "Yes" if song["videoId"] in liked_ids else ""
        row["Source"] = "YT Music"
        if song["videoId"] in liked_position:
            row["Liked Position"] = str(liked_position[song["videoId"]])
        new_rows.append(row)

    # Reconcile Liked column on existing rows: a track previously injected from
    # an album (Liked='No') flips to 'Yes' once the user likes it; an unliked
    # track flips back to ''. Without this, the ♥ Liked tab misses tracks.
    # Also backfill/refresh Liked Position for sort-by-recency.
    liked_flips_to_yes = 0
    liked_flips_to_no = 0
    position_updates = 0
    for row in existing_rows:
        vid = row.get("Video ID", "")
        if not vid:
            continue
        current = (row.get("Liked", "") or "").strip()
        should_be_liked = vid in liked_ids
        if should_be_liked and current != "Yes":
            row["Liked"] = "Yes"
            liked_flips_to_yes += 1
        elif not should_be_liked and current == "Yes":
            row["Liked"] = "No"
            liked_flips_to_no += 1

        new_pos = str(liked_position[vid]) if vid in liked_position else ""
        old_pos = (row.get("Liked Position", "") or "").strip()
        if new_pos != old_pos:
            row["Liked Position"] = new_pos
            position_updates += 1

    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    print(f"Existing songs in masterlist: {len(existing_ids)}")
    print(f"Liked songs:                  {len(liked)}")
    print(f"Monthly playlist songs:       {len(monthly)}")
    print(f"Combined unique:              {len(all_songs)}")
    print(f"New songs to append:          {len(new_rows)}")
    print(f"Liked column updates:         +{liked_flips_to_yes} → Yes, {liked_flips_to_no} → No")
    print(f"Liked Position updates:       {position_updates}")

    if not new_rows and not liked_flips_to_yes and not liked_flips_to_no and not position_updates:
        print("\nNo new songs, no Liked changes, no position changes. Up to date!")
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

    # If we updated any existing rows (Liked or Liked Position), rewrite the
    # whole file (otherwise just append for speed/safety). Also force rewrite
    # when the file is missing the Liked Position column entirely (first run
    # after the column was added).
    needs_rewrite = (
        liked_flips_to_yes or liked_flips_to_no or position_updates
        or (file_fieldnames and "Liked Position" not in file_fieldnames)
    )
    if needs_rewrite:
        # Use the file's actual fieldnames to preserve all columns (Genres,
        # Tempo, Key, etc. that aren't in our COLUMNS list but exist in CSV).
        # Append any new columns from COLUMNS that aren't already in the file.
        fieldnames = list(file_fieldnames) if file_fieldnames else list(COLUMNS)
        for col in COLUMNS:
            if col not in fieldnames:
                fieldnames.append(col)
        with open(MASTERLIST_PATH, "w", encoding="utf-8", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(existing_rows)
            writer.writerows(new_rows)
        print(f"Rewrote masterlist: {liked_flips_to_yes + liked_flips_to_no} Liked + {position_updates} Position updates + {len(new_rows)} appends")
    else:
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

    # Generate a small Liked-only CSV (public/data/liked.csv) so the ♥ Liked
    # tab can fetch directly without waiting on DuckDB to parse the 74K-row
    # masterlist. Sorted by Liked Position ascending (0 = newest first per YT
    # Music's API ordering — matches what the user sees on music.youtube.com).
    liked_csv = PROJECT_DIR / "public" / "data" / "liked.csv"
    liked_rows = [r for r in existing_rows + new_rows if (r.get("Liked", "") or "").strip() == "Yes"]

    # Sort by Liked Position ascending = matches YT Music's UI ordering exactly.
    # The First Liked At column is preserved in the CSV and powers the optional
    # "Recently Liked (Spotify)" sort in the app, but is NOT used as the default
    # sort because mixing YT Music order with Spotify dates breaks adjacency.
    def pos_key(r):
        p = (r.get("Liked Position", "") or "").strip()
        try: return int(p)
        except (ValueError, TypeError): return 10**9
    liked_rows.sort(key=pos_key)
    liked_fields = [
        "Track Name", "Artist Name(s)", "Album Name", "Tempo", "Duration",
        "Key", "Liked Position", "Video ID", "Soundcloud ID",
        # Spotify-export hydration columns (added 2026-04-27). Power the
        # optional "Recently Liked (Spotify)" sort + DJ-style audio sorts.
        # Primary "Recently Liked" sort uses Liked Position (matches YT Music).
        "First Liked At", "Energy", "Danceability", "Valence",
    ]
    with open(liked_csv, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=liked_fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(liked_rows)
    print(f"Generated {liked_csv} ({len(liked_rows)} liked tracks, sorted by recency)")

    print("\nSync complete!")


if __name__ == "__main__":
    main()
