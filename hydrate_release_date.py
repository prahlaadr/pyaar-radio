"""Hydrate masterlist.csv `Release Date` from data we already own.

Two passes, no API calls, fully free:

  1. Saved-album JSONs (albums/*.json)
     Each saved album stores {title, artist, year, tracks[]}. For every
     track in masterlist whose (artist, album) matches a saved album,
     fill Release Date with that album's year.

  2. Cross-track album inference
     If multiple tracks share the same Album Name and at least one of
     them has a Release Date, propagate it to siblings.

Idempotent — only fills empty cells, never overwrites.

Usage:
    python hydrate_release_date.py            # Dry run preview
    python hydrate_release_date.py --apply    # Write changes
"""

import argparse
import csv
import json
import shutil
from collections import defaultdict
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).parent
MASTERLIST = REPO / "public" / "data" / "masterlist.csv"
ALBUMS_DIR = REPO / "albums"
BACKUP_DIR = REPO / "backups"


def is_empty(value: str) -> bool:
    return not value or not value.strip()


def normalize(s: str) -> str:
    return (s or "").strip().lower()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry-run)")
    args = parser.parse_args()

    # === Build saved-album lookup ===
    # Key: (artist_lower, album_title_lower) → "YYYY"
    album_year: dict[tuple[str, str], str] = {}
    album_files = sorted(p for p in ALBUMS_DIR.glob("*.json") if p.name != "_index.json")
    for path in album_files:
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception:
            continue
        year = (data.get("year", "") or "").strip()
        if not year:
            continue
        title = data.get("title", "").strip()
        artist = data.get("artist", "").strip()
        if title and artist:
            album_year[(normalize(artist), normalize(title))] = year
        # Also index by per-track artists so multi-artist albums match by any credit
        for t in data.get("tracks", []):
            track_artist = t.get("artist", "").strip()
            if track_artist and title:
                # Track artist may be "Baalti;Lapgan" — index each
                for a in track_artist.split(";"):
                    a = a.strip()
                    if a:
                        album_year.setdefault((normalize(a), normalize(title)), year)

    print(f"Loaded {len(album_year)} (artist, album) → year mappings from {len(album_files)} album JSONs")

    # === Load masterlist ===
    with open(MASTERLIST, newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    print(f"Loaded {len(rows)} masterlist rows")

    # === Pass 1: fill from saved albums ===
    pass1_filled = 0
    for row in rows:
        if not is_empty(row.get("Release Date", "")):
            continue
        album = (row.get("Album Name", "") or "").strip()
        artists = (row.get("Artist Name(s)", "") or "").strip()
        if not album or not artists:
            continue
        # Try each artist credit (semicolon-separated)
        for a in artists.split(";"):
            year = album_year.get((normalize(a), normalize(album)))
            if year:
                # Normalize "2024" → "2024-01-01" for date-like consistency
                row["Release Date"] = year if "-" in year else f"{year}-01-01"
                pass1_filled += 1
                break

    print(f"Pass 1 (saved-album lookup): filled {pass1_filled} Release Date cells")

    # === Pass 2: cross-track album inference ===
    # If any track in album X has a Release Date, propagate to other tracks in X
    # (for albums not in our saved set — e.g. tracks from monthly playlists where
    # one track happens to be hydrated).
    album_known: dict[tuple[str, str], str] = {}
    for row in rows:
        rd = (row.get("Release Date", "") or "").strip()
        if not rd:
            continue
        album = (row.get("Album Name", "") or "").strip()
        artists = (row.get("Artist Name(s)", "") or "").strip()
        if not album or not artists:
            continue
        for a in artists.split(";"):
            key = (normalize(a), normalize(album))
            album_known.setdefault(key, rd)

    pass2_filled = 0
    for row in rows:
        if not is_empty(row.get("Release Date", "")):
            continue
        album = (row.get("Album Name", "") or "").strip()
        artists = (row.get("Artist Name(s)", "") or "").strip()
        if not album or not artists:
            continue
        for a in artists.split(";"):
            rd = album_known.get((normalize(a), normalize(album)))
            if rd:
                row["Release Date"] = rd
                pass2_filled += 1
                break

    print(f"Pass 2 (cross-track inference): filled {pass2_filled} Release Date cells")

    total_filled = pass1_filled + pass2_filled
    still_empty = sum(1 for r in rows if is_empty(r.get("Release Date", "")))
    has_value = len(rows) - still_empty
    print(f"\nTotal filled this run: {total_filled}")
    print(f"Masterlist coverage: {has_value}/{len(rows)} ({100 * has_value // len(rows)}%) have Release Date")

    if not args.apply:
        # Sample what would be written
        sample = [r for r in rows if r.get("Release Date") and not r.get("_was_filled")][:5]
        print("\n(dry-run — pass --apply to write)")
        return

    if total_filled == 0:
        print("\nNo new fills, nothing to write.")
        return

    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"masterlist.{datetime.now():%Y%m%d-%H%M%S}.pre-hydrate.csv"
    shutil.copy(MASTERLIST, backup)
    print(f"\nBackup: {backup}")

    with open(MASTERLIST, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {total_filled} new Release Date values to masterlist.")


if __name__ == "__main__":
    main()
