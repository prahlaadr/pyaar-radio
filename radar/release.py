"""Release detection: find new albums/singles from curated artists."""

import csv
import json
import re
import time
from datetime import datetime, UTC
from pathlib import Path

import duckdb
from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).parent.parent
ARTISTS_PATH = PROJECT_DIR / "public" / "data" / "artists.csv"
BROWSER_AUTH_PATH = PROJECT_DIR / "browser.json"
ALERTS_JSON_PATH = PROJECT_DIR / "public" / "data" / "radar-alerts.json"

# Noise patterns — applied at scan time so we don't keep resurfacing comps/derivatives/holiday playlists.
# Mirrors the classes in classify_gaps.py (derivative + compilation + themed_comp). Keep in sync.
NOISE_PATTERN = re.compile(
    r"\((Instrumentals?|Karaoke|Acapella|Acoustic|Remix(es)?|Reprise|Demo|Demos|Jhankar|Stems|A cappella)\)"
    r"|Anniversary Edition|\bDeluxe Edition\b|\bExpanded Edition\b|\bRemastered\b|Bonus Edition"
    r"|\b(Greatest Hits|Best Of|The Best of|Top \d+|Number 1'?s|Hits Collection|Hit Collection|Essential|"
    r"Anthology|Retrospective|All The Hits|Singles Collection|Singles & Rarities|"
    r"20th Century Masters|Millennium Collection|FM Broadcasts|Now That's What I Call|Evergreen|Mono Singles)\b"
    r"|\b(Christmas|Eid Mubarak|Diwali|Holi|Republic Day|Independence Day|Valentine|Workout|Party Hits|"
    r"Birthday Special|Wedding|Romantic Hits|Dance Floor|Late Night|Chill Out|Road Trip|Summer Vibes|"
    r"Monsoon|Maestro Melodies|Power Workout|Top 15 Songs|Golden Hits)\b",
    re.IGNORECASE,
)


def is_noise(title: str) -> bool:
    return bool(NOISE_PATTERN.search(title or ""))


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
        # Note: ytmusicapi puts the year in the "type" field for album results
        current_year = datetime.now().year
        min_year = current_year - 1
        # Walk down to the first non-noise release within the year window.
        # Without this we'd surface "Greatest Hits 2026" or "Christmas Special" as a "new release".
        album_list = artist_data.get("albums", {}).get("results", []) or []
        for latest in album_list:
            title = latest.get("title", "")
            year_str = latest.get("year", "") or latest.get("type", "")
            try:
                album_year = int(year_str) if year_str else 0
            except ValueError:
                album_year = 0
            if album_year and album_year < min_year:
                break
            if is_noise(title):
                continue
            releases.append({
                "title": title,
                "browseId": latest.get("browseId", ""),
                "year": year_str,
                "type": "album",
                "artist_match": artist_result.get("artist", ""),
            })
            break

        # Singles section intentionally skipped — too noisy (features, remixes, loosies)

        return releases

    except Exception as e:
        print(f"    ERROR searching for {artist_name}: {e}")
        return []


def find_full_discography(yt: YTMusic, artist_name: str) -> list[dict]:
    """Fetch every album/EP for an artist (no year filter). Returns list of release dicts."""
    try:
        results = yt.search(artist_name, filter="artists", limit=5)
        if not results:
            return []

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
        albums_section = artist_data.get("albums", {}) or {}
        all_albums = list(albums_section.get("results", []) or [])

        # If the section has its own browseId+params, fetch the full paginated list
        section_browse_id = albums_section.get("browseId")
        section_params = albums_section.get("params")
        if section_browse_id and section_params:
            try:
                full = yt.get_artist_albums(section_browse_id, section_params, limit=None)
                seen = {a.get("browseId") for a in all_albums if a.get("browseId")}
                for album in full or []:
                    bid = album.get("browseId")
                    if bid and bid not in seen:
                        all_albums.append(album)
                        seen.add(bid)
            except Exception as e:
                print(f"    WARN: paginated fetch failed for {artist_name}: {e}")

        releases = []
        for a in all_albums:
            bid = a.get("browseId", "")
            if not bid:
                continue
            title = a.get("title", "")
            if is_noise(title):
                continue
            year_str = a.get("year", "") or a.get("type", "")
            releases.append({
                "title": title,
                "browseId": bid,
                "year": year_str,
                "type": "album",
                "artist_match": artist_result.get("artist", ""),
            })
        return releases

    except Exception as e:
        print(f"    ERROR fetching discography for {artist_name}: {e}")
        return []


def check_discography(
    db: duckdb.DuckDBPyConnection,
    yt: YTMusic,
    artists: list[str],
    save: bool = False,
    min_year: int | None = None,
) -> list[dict]:
    """Audit each artist's full discography. Logs every album not in known_albums as an audit_gap alert."""
    from .db import get_known_browse_ids

    known_ids = get_known_browse_ids(db)
    now = datetime.now(UTC)
    gaps = []

    for i, artist in enumerate(artists):
        albums = find_full_discography(yt, artist)
        artist_gaps = []

        for release in albums:
            bid = release["browseId"]
            if not bid or bid in known_ids:
                continue

            if min_year is not None:
                try:
                    yr = int(release["year"]) if release["year"] else 0
                except ValueError:
                    yr = 0
                if yr and yr < min_year:
                    continue

            artist_gaps.append(release)
            gaps.append({**release, "artist": artist})

            db.execute(
                "INSERT INTO release_alerts (id, artist, title, browse_id, year, release_type, detected_at, status, source) VALUES (nextval('release_alerts_seq'), ?, ?, ?, ?, ?, ?, 'new', 'yt_music')",
                [artist, release["title"], bid, release["year"], "audit_gap", now],
            )
            db.execute(
                "INSERT OR IGNORE INTO known_albums (browse_id, title, artist, year, track_count, source, first_seen_at) VALUES (?, ?, ?, ?, 0, 'audit_scan', ?)",
                [bid, release["title"], artist, release["year"], now],
            )
            known_ids.add(bid)

            if save:
                try:
                    album_data = yt.get_album(bid)
                    playlist_id = album_data.get("audioPlaylistId")
                    if playlist_id:
                        yt.rate_playlist(playlist_id, "LIKE")
                        print(f"    ✓ Saved {release['title']}")
                        db.execute(
                            "UPDATE release_alerts SET status = 'saved' WHERE browse_id = ?",
                            [bid],
                        )
                        time.sleep(0.5)
                except Exception as e:
                    print(f"    ✗ Error saving {release['title']}: {e}")

        print(f"  [{i+1}/{len(artists)}] {artist}: {len(albums)} albums, {len(artist_gaps)} gap{'s' if len(artist_gaps) != 1 else ''}")
        time.sleep(0.5)

    return gaps


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


def export_alerts_json(db: duckdb.DuckDBPyConnection):
    """Export all non-dismissed alerts to JSON for the frontend."""
    rows = db.execute(
        "SELECT id, artist, title, browse_id, year, release_type, status, detected_at FROM release_alerts WHERE status != 'dismissed' ORDER BY detected_at DESC"
    ).fetchall()
    alerts = []
    for row in rows:
        alerts.append({
            "id": row[0],
            "artist": row[1],
            "title": row[2],
            "browseId": row[3],
            "year": row[4],
            "type": row[5],
            "status": row[6],
            "detectedAt": row[7].isoformat() if row[7] else "",
        })
    with open(ALERTS_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump({"updatedAt": datetime.now(UTC).isoformat(), "alerts": alerts}, f, ensure_ascii=False, indent=1)
    return len(alerts)


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
