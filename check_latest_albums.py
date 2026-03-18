#!/usr/bin/env python3
"""
Check which curated artists are missing their latest album in YT Music library.

For each artist in artists.csv, searches YT Music for their discography,
finds the most recent album, and checks if it's already saved.

Usage:
    python check_latest_albums.py              # Full check
    python check_latest_albums.py --save       # Auto-save missing albums to library
    python check_latest_albums.py --artist "Flying Lotus"  # Check one artist
"""

import argparse
import csv
import sys
import time
from pathlib import Path

from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).parent
ARTISTS_PATH = PROJECT_DIR / "public" / "data" / "artists.csv"
BROWSER_AUTH_PATH = PROJECT_DIR / "browser.json"


def load_artists(filter_name: str | None = None) -> list[str]:
    artists = []
    with open(ARTISTS_PATH, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("artist", "").strip()
            if name:
                if filter_name and filter_name.lower() != name.lower():
                    continue
                artists.append(name)
    return artists


def get_library_album_keys(yt: YTMusic) -> set[str]:
    """Build a set of (lowercase title, lowercase first artist) for fast lookup."""
    print("Loading saved albums from library...")
    albums = yt.get_library_albums(limit=5000)
    print(f"  {len(albums)} albums in library")
    keys = set()
    for a in albums:
        title = a.get("title", "").lower().strip()
        artist_names = [x["name"].lower() for x in a.get("artists", []) if x.get("name")]
        # Add key with each artist for flexible matching
        for artist in artist_names:
            keys.add((title, artist))
        # Also add browse ID for exact matching
        if a.get("browseId"):
            keys.add(("_browse_", a["browseId"]))
    return keys


def find_latest_album(yt: YTMusic, artist_name: str) -> dict | None:
    """Search YT Music for an artist's most recent album."""
    try:
        # Search for the artist
        results = yt.search(artist_name, filter="artists", limit=5)
        if not results:
            return None

        # Find best match (exact or closest name match)
        artist_result = None
        for r in results:
            if r.get("artist", "").lower() == artist_name.lower():
                artist_result = r
                break
        if not artist_result:
            artist_result = results[0]

        browse_id = artist_result.get("browseId")
        if not browse_id:
            return None

        # Get artist page with albums
        artist_data = yt.get_artist(browse_id)
        albums_section = artist_data.get("albums", {})
        album_list = albums_section.get("results", [])

        if not album_list:
            # Try singles section if no albums
            singles = artist_data.get("singles", {}).get("results", [])
            if singles:
                latest = singles[0]
                return {
                    "title": latest.get("title", ""),
                    "browseId": latest.get("browseId", ""),
                    "year": latest.get("year", ""),
                    "type": "single",
                    "artist_match": artist_result.get("artist", ""),
                }
            return None

        # First album in the list is typically the most recent
        latest = album_list[0]
        return {
            "title": latest.get("title", ""),
            "browseId": latest.get("browseId", ""),
            "year": latest.get("year", ""),
            "type": "album",
            "artist_match": artist_result.get("artist", ""),
        }

    except Exception as e:
        print(f"    ERROR searching for {artist_name}: {e}")
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--save", action="store_true", help="Auto-save missing albums to library")
    parser.add_argument("--artist", type=str, help="Check a single artist")
    args = parser.parse_args()

    if not BROWSER_AUTH_PATH.exists():
        print("ERROR: No browser.json found.")
        sys.exit(1)

    artists = load_artists(args.artist)
    print(f"Checking {len(artists)} artists\n")

    yt = YTMusic(str(BROWSER_AUTH_PATH))
    library_keys = get_library_album_keys(yt)

    missing = []
    saved = []
    skipped = []

    for i, artist in enumerate(artists):
        latest = find_latest_album(yt, artist)
        if not latest:
            skipped.append(artist)
            print(f"  [{i+1}/{len(artists)}] {artist}: no albums found")
            continue

        # Check if in library
        title_lower = latest["title"].lower().strip()
        artist_lower = latest["artist_match"].lower().strip()
        in_library = (
            (title_lower, artist_lower) in library_keys
            or ("_browse_", latest["browseId"]) in library_keys
        )

        if in_library:
            saved.append((artist, latest))
            print(f"  [{i+1}/{len(artists)}] {artist}: \u2713 {latest['title']} ({latest['year']})")
        else:
            missing.append((artist, latest))
            print(f"  [{i+1}/{len(artists)}] {artist}: MISSING — {latest['title']} ({latest['year']})")

        # Small delay to avoid rate limiting
        time.sleep(0.3)

    # Summary
    print(f"\n{'=' * 60}")
    print("SUMMARY")
    print("=" * 60)
    print(f"Artists checked:    {len(artists)}")
    print(f"Latest album saved: {len(saved)}")
    print(f"Missing:            {len(missing)}")
    print(f"No albums found:    {len(skipped)}")

    if missing:
        print(f"\n{'=' * 60}")
        print("MISSING ALBUMS")
        print("=" * 60)
        for artist, album in missing:
            print(f"  {artist} — {album['title']} ({album['year']}) [{album['type']}]")

    if missing and args.save:
        print(f"\nSaving {len(missing)} albums to library...")
        save_count = 0
        for artist, album in missing:
            try:
                album_data = yt.get_album(album["browseId"])
                playlist_id = album_data.get("audioPlaylistId")
                if playlist_id:
                    yt.rate_playlist(playlist_id, "LIKE")
                    print(f"  \u2713 Saved: {artist} — {album['title']}")
                    save_count += 1
                    time.sleep(0.5)
                else:
                    print(f"  \u2717 No playlist ID: {artist} — {album['title']}")
            except Exception as e:
                print(f"  \u2717 Error saving {artist} — {album['title']}: {e}")
        print(f"\nSaved {save_count}/{len(missing)} albums")

    if skipped:
        print(f"\nSkipped (no albums found): {', '.join(skipped)}")


if __name__ == "__main__":
    main()
