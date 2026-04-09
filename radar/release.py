"""Release detection: find new albums/singles from curated artists."""

import csv
import time
from datetime import datetime, UTC
from pathlib import Path

import duckdb
from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).parent.parent
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


def find_latest_releases(yt: YTMusic, artist_name: str) -> list[dict]:
    """Search YT Music for an artist's most recent album/EP (skips singles)."""
    try:
        results = yt.search(artist_name, filter="artists", limit=5)
        if not results:
            return []

        # Find best match
        artist_result = None
        for r in results:
            if r.get("artist", "").lower() == artist_name.lower():
                artist_result = r
                break
        if not artist_result:
            artist_result = results[0]

        browse_id = artist_result.get("browseId")
        if not browse_id:
            return []

        artist_data = yt.get_artist(browse_id)
        releases = []

        # Get latest album/EP (YT Music groups both under "albums")
        # Only consider releases from the last 2 years to skip old rereleases
        current_year = datetime.now().year
        min_year = current_year - 1
        album_list = artist_data.get("albums", {}).get("results", [])
        if album_list:
            latest = album_list[0]
            year_str = latest.get("year", "")
            try:
                album_year = int(year_str) if year_str else 0
            except ValueError:
                album_year = 0
            if album_year >= min_year:
                releases.append({
                    "title": latest.get("title", ""),
                    "browseId": latest.get("browseId", ""),
                    "year": year_str,
                    "type": "album",
                    "artist_match": artist_result.get("artist", ""),
                })

        # Singles section intentionally skipped — too noisy (features, remixes, loosies)

        return releases

    except Exception as e:
        print(f"    ERROR searching for {artist_name}: {e}")
        return []


def check_releases(
    db: duckdb.DuckDBPyConnection,
    yt: YTMusic,
    artists: list[str],
    save: bool = False,
) -> list[dict]:
    """Check all artists for new releases. Returns list of new release dicts."""
    from .db import get_known_browse_ids

    known_ids = get_known_browse_ids(db)
    now = datetime.now(UTC)
    new_releases = []
    checked = 0

    for i, artist in enumerate(artists):
        releases = find_latest_releases(yt, artist)
        if not releases:
            print(f"  [{i+1}/{len(artists)}] {artist}: no releases found")
            checked += 1
            time.sleep(0.3)
            continue

        for release in releases:
            bid = release["browseId"]
            if not bid:
                continue

            if bid in known_ids:
                print(f"  [{i+1}/{len(artists)}] {artist}: {release['type']} \u2713 {release['title']} ({release['year']})")
            else:
                print(f"  [{i+1}/{len(artists)}] {artist}: {release['type']} NEW — {release['title']} ({release['year']})")
                new_releases.append({**release, "artist": artist})

                # Insert into release_alerts
                db.execute(
                    "INSERT INTO release_alerts (id, artist, title, browse_id, year, release_type, detected_at, status, source) VALUES (nextval('release_alerts_seq'), ?, ?, ?, ?, ?, ?, 'new', 'yt_music')",
                    [artist, release["title"], bid, release["year"], release["type"], now],
                )

                # Add to known_albums so we don't alert again
                db.execute(
                    "INSERT OR IGNORE INTO known_albums (browse_id, title, artist, year, track_count, source, first_seen_at) VALUES (?, ?, ?, ?, 0, 'yt_music_scan', ?)",
                    [bid, release["title"], artist, release["year"], now],
                )
                known_ids.add(bid)

                # Auto-save to YT Music library
                if save:
                    try:
                        album_data = yt.get_album(bid)
                        playlist_id = album_data.get("audioPlaylistId")
                        if playlist_id:
                            yt.rate_playlist(playlist_id, "LIKE")
                            print(f"    \u2713 Saved to library")
                            db.execute(
                                "UPDATE release_alerts SET status = 'saved' WHERE browse_id = ?",
                                [bid],
                            )
                            time.sleep(0.5)
                    except Exception as e:
                        print(f"    \u2717 Error saving: {e}")

        checked += 1
        time.sleep(0.3)

    return new_releases


def format_report(new_releases: list[dict], total_artists: int) -> str:
    """Format a markdown report of new releases."""
    date = datetime.now().strftime("%Y-%m-%d")
    lines = [f"# Pyaar Radar Report — {date}\n"]
    lines.append(f"Checked {total_artists} curated artists.\n")

    if not new_releases:
        lines.append("No new releases detected.\n")
        return "\n".join(lines)

    lines.append(f"## New Releases ({len(new_releases)} found)\n")
    for r in new_releases:
        lines.append(f"- **{r['artist']}** — {r['title']} ({r['year']}) [{r['type']}]")

    return "\n".join(lines)
