"""Inject tracks from albums/*.json into masterlist.csv if not already present.

Default: dry-run preview. Use --apply to actually write.

Closes the gap where saved-album tracks aren't visible on artist pages.
~1,600 tracks added on first run; idempotent (rerun is safe).
"""

import argparse
import csv
import json
import shutil
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).parent
MASTERLIST = REPO / "public" / "data" / "masterlist.csv"
ALBUMS_DIR = REPO / "albums"
BACKUP_DIR = REPO / "backups"

COLUMNS = [
    "Track Name", "Artist Name(s)", "Album Name", "Genres", "Tempo", "Duration",
    "Popularity", "Key", "Release Date", "Instrumentalness", "Tags", "Liked",
    "Playlist 1", "Playlist 2", "Playlist 3", "Playlist 4", "Playlist 5",
    "Playlist Count", "Video ID", "Soundcloud ID", "Source",
]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry-run)")
    args = parser.parse_args()

    with open(MASTERLIST) as f:
        rows = list(csv.DictReader(f))
    existing_vids = {r["Video ID"] for r in rows if r.get("Video ID")}
    print(f"Masterlist: {len(rows)} rows, {len(existing_vids)} unique videoIds")

    new_rows = []
    seen_new_vids = set()
    album_files = sorted(p for p in ALBUMS_DIR.glob("*.json") if p.name != "_index.json")
    for path in album_files:
        try:
            with open(path) as f:
                album = json.load(f)
        except Exception:
            continue
        album_title = album.get("title", "")
        for t in album.get("tracks", []):
            vid = t.get("videoId", "")
            if not vid or vid in existing_vids or vid in seen_new_vids:
                continue
            seen_new_vids.add(vid)
            new_rows.append({
                "Track Name": t.get("title", ""),
                "Artist Name(s)": t.get("artist", ""),
                "Album Name": album_title,
                "Genres": "", "Tempo": "", "Duration": t.get("duration", ""),
                "Popularity": "", "Key": "", "Release Date": "", "Instrumentalness": "",
                "Tags": "", "Liked": "No",
                "Playlist 1": "", "Playlist 2": "", "Playlist 3": "", "Playlist 4": "", "Playlist 5": "",
                "Playlist Count": "0",
                "Video ID": vid, "Soundcloud ID": "", "Source": "Album",
            })

    print(f"\nNew rows to add: {len(new_rows)}")
    if new_rows:
        sample_artists = {r["Artist Name(s)"] for r in new_rows[:200]}
        print(f"Sample artists in batch: {len(sample_artists)} unique — e.g.")
        for a in list(sample_artists)[:8]:
            print(f"  {a}")

    if not args.apply:
        print("\n(dry-run — pass --apply to write)")
        return

    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"masterlist.{datetime.now():%Y%m%d-%H%M%S}.pre-inject.csv"
    shutil.copy(MASTERLIST, backup)
    print(f"\nBackup: {backup}")

    with open(MASTERLIST, "a", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS)
        for row in new_rows:
            writer.writerow(row)

    print(f"Appended {len(new_rows)} rows. Masterlist now: {len(rows) + len(new_rows)} rows.")


if __name__ == "__main__":
    main()
