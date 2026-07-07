"""Hydrate masterlist.csv `Genres` and `Popularity` using Last.fm and YT Music.

Two independent passes — each only fills empty cells:

  1. Genres — Last.fm track.getInfo (free, no OAuth, 5 req/sec cap)
     Top tags filtered through the beets lastgenre whitelist so noise
     tags ('seen live', 'favourites', etc.) are dropped.

  2. Popularity — ytmusicapi get_artist(channelId).monthlyListeners
     Cached per-artist so ~300 YT calls for 9,500+ tracks.

Requires: LASTFM_API_KEY env var. browser.json for YT Music popularity.

Usage:
    python hydrate_metadata.py --dry                    # preview
    python hydrate_metadata.py --apply                  # write all
    python hydrate_metadata.py --apply --artist Bonobo  # single artist
    python hydrate_metadata.py --apply --limit 50       # first 50 eligible
    python hydrate_metadata.py --apply --vault-only     # only artists in artists.csv
"""

import argparse
import csv
import os
import shutil
import sys
import time
from datetime import datetime
from pathlib import Path

import requests

REPO = Path(__file__).parent
MASTERLIST = REPO / "public" / "data" / "masterlist.csv"
ARTISTS_CSV = REPO / "public" / "data" / "artists.csv"
BACKUP_DIR = REPO / "backups"
BROWSER_AUTH = REPO / "browser.json"

LASTFM_API_URL = "https://ws.audioscrobbler.com/2.0/"
GENRES_WHITELIST_URL = (
    "https://raw.githubusercontent.com/beetbox/beets/master/beetsplug/lastgenre/genres.txt"
)

LASTFM_RATE_SLEEP = 0.25  # seconds between Last.fm calls


def is_empty(v: str) -> bool:
    return not v or not v.strip()


def normalize(s: str) -> str:
    return (s or "").strip().lower()


# ── Last.fm genres ────────────────────────────────────────────────────────────

def fetch_genre_whitelist() -> set[str]:
    """Download the beets lastgenre whitelist and return as a lower-cased set."""
    resp = requests.get(GENRES_WHITELIST_URL, timeout=15)
    resp.raise_for_status()
    return {line.strip().lower() for line in resp.text.splitlines() if line.strip()}


def lastfm_genres(artist: str, track: str, api_key: str, whitelist: set[str]) -> str:
    """Return pipe-joined genre string (up to 5 tags) or '' if none found."""
    try:
        r = requests.get(
            LASTFM_API_URL,
            params={
                "method": "track.getInfo",
                "artist": artist,
                "track": track,
                "autocorrect": "1",
                "format": "json",
                "api_key": api_key,
            },
            timeout=10,
        )
        r.raise_for_status()
        data = r.json()
    except Exception as e:
        print(f"  [lastfm] error for {artist!r} / {track!r}: {e}")
        return ""

    tags = data.get("track", {}).get("toptags", {}).get("tag", [])
    if isinstance(tags, dict):
        tags = [tags]

    filtered = [
        t["name"].strip()
        for t in tags
        if normalize(t.get("name", "")) in whitelist
    ]
    return "|".join(filtered[:5])


# ── YT Music popularity ───────────────────────────────────────────────────────

def parse_listeners(raw: str) -> int | None:
    """Parse '29.1M', '450K', '1.2B', or '450000' → int."""
    if not raw:
        return None
    raw = raw.strip().replace(",", "")
    multipliers = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000}
    suffix = raw[-1].upper()
    if suffix in multipliers:
        try:
            return int(float(raw[:-1]) * multipliers[suffix])
        except ValueError:
            return None
    try:
        return int(raw)
    except ValueError:
        return None


def build_popularity_cache(
    yt, artist_names: list[str]
) -> dict[str, int | None]:
    """
    For each unique artist name: search YT Music for channelId, then fetch
    monthlyListeners via get_artist(). Returns {artist_name_lower: listeners | None}.
    """
    cache: dict[str, int | None] = {}
    channel_cache: dict[str, int | None] = {}  # channelId → listeners

    unique = sorted({normalize(a) for a in artist_names})
    print(f"  Fetching YT Music popularity for {len(unique)} unique artists...")

    for name_lower in unique:
        if name_lower in cache:
            continue
        try:
            results = yt.search(name_lower, filter="artists", limit=1)
        except Exception as e:
            print(f"  [ytmusic] search error for {name_lower!r}: {e}")
            cache[name_lower] = None
            continue

        if not results:
            cache[name_lower] = None
            continue

        channel_id = results[0].get("browseId") or results[0].get("channelId")
        if not channel_id:
            cache[name_lower] = None
            continue

        if channel_id in channel_cache:
            cache[name_lower] = channel_cache[channel_id]
            continue

        try:
            info = yt.get_artist(channel_id)
            raw = info.get("subscribers") or info.get("monthlyListeners") or ""
            listeners = parse_listeners(raw)
        except Exception as e:
            print(f"  [ytmusic] get_artist error for {name_lower!r} ({channel_id}): {e}")
            listeners = None

        channel_cache[channel_id] = listeners
        cache[name_lower] = listeners

    return cache


# ── Artists CSV ───────────────────────────────────────────────────────────────

def load_vault_artists() -> set[str]:
    """Return lower-cased set of artist names from artists.csv (+ aliases)."""
    result: set[str] = set()
    if not ARTISTS_CSV.exists():
        return result
    with open(ARTISTS_CSV, newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = (row.get("artist") or "").strip()
            if name:
                result.add(normalize(name))
            for alias in (row.get("aliases") or "").split("|"):
                alias = alias.strip()
                if alias:
                    result.add(normalize(alias))
    return result


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Hydrate Genres + Popularity in masterlist.csv")
    parser.add_argument("--dry", action="store_true", help="Preview only (default if --apply not set)")
    parser.add_argument("--apply", action="store_true", help="Write changes")
    parser.add_argument("--vault-only", action="store_true", help="Only process artists in artists.csv")
    parser.add_argument("--artist", metavar="NAME", help="Only process tracks by this artist")
    parser.add_argument("--limit", type=int, metavar="N", help="Stop after N eligible tracks processed")
    args = parser.parse_args()

    if not args.apply:
        args.dry = True

    # ── Validate env ──
    api_key = os.environ.get("LASTFM_API_KEY", "")
    if not api_key:
        print("ERROR: LASTFM_API_KEY environment variable is not set.")
        print("       export LASTFM_API_KEY=<your key> and re-run.")
        sys.exit(1)

    # ── Load masterlist ──
    with open(MASTERLIST, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    print(f"Loaded {len(rows)} masterlist rows")

    # ── Filters ──
    vault_artists: set[str] = set()
    if args.vault_only:
        vault_artists = load_vault_artists()
        print(f"Vault-only mode: {len(vault_artists)} artists/aliases loaded")

    def artist_passes(artist_cell: str) -> bool:
        credits = [a.strip() for a in artist_cell.split(";") if a.strip()]
        if args.artist:
            return any(normalize(a) == normalize(args.artist) for a in credits)
        if args.vault_only:
            return any(normalize(a) in vault_artists for a in credits)
        return True

    # ── Identify eligible tracks ──
    needs_genres = [
        r for r in rows
        if is_empty(r.get("Genres", "")) and artist_passes(r.get("Artist Name(s)", ""))
    ]
    needs_pop = [
        r for r in rows
        if is_empty(r.get("Popularity", "")) and artist_passes(r.get("Artist Name(s)", ""))
    ]

    if args.limit:
        needs_genres = needs_genres[: args.limit]
        needs_pop = needs_pop[: args.limit]

    print(f"Eligible: {len(needs_genres)} tracks need Genres, {len(needs_pop)} need Popularity")

    if args.dry:
        print("\nDry-run sample (first 5 needing Genres):")
        for r in needs_genres[:5]:
            print(f"  {r.get('Artist Name(s)', '')} — {r.get('Track Name', '')}")
        print("\nDry-run sample (first 5 needing Popularity):")
        for r in needs_pop[:5]:
            print(f"  {r.get('Artist Name(s)', '')} — {r.get('Track Name', '')}")
        print("\n(dry-run — pass --apply to write)")
        return

    # ── Fetch genre whitelist ──
    print("\nFetching beets genre whitelist...")
    try:
        whitelist = fetch_genre_whitelist()
        print(f"  {len(whitelist)} whitelisted genre terms loaded")
    except Exception as e:
        print(f"  WARNING: could not fetch whitelist ({e}), genres will NOT be filtered")
        whitelist = set()

    # ── Pass 1: Genres via Last.fm ──
    genres_filled = 0
    print(f"\n[Pass 1] Filling Genres for {len(needs_genres)} tracks via Last.fm...")
    for i, row in enumerate(needs_genres, 1):
        artist = (row.get("Artist Name(s)") or "").split(";")[0].strip()
        track = (row.get("Track Name") or "").strip()
        if not artist or not track:
            continue
        genres = lastfm_genres(artist, track, api_key, whitelist)
        if genres:
            row["Genres"] = genres
            genres_filled += 1
            print(f"  [{i}/{len(needs_genres)}] {artist} — {track}: {genres}")
        else:
            print(f"  [{i}/{len(needs_genres)}] {artist} — {track}: (no match)")
        time.sleep(LASTFM_RATE_SLEEP)

    # ── Pass 2: Popularity via YT Music ──
    pop_filled = 0
    if needs_pop:
        if not BROWSER_AUTH.exists():
            print(f"\n[Pass 2] SKIPPED: browser.json not found at {BROWSER_AUTH}")
            print("  Run auth setup and copy browser.json to the repo root to enable popularity hydration.")
        else:
            try:
                from ytmusicapi import YTMusic
                yt = YTMusic(str(BROWSER_AUTH))
            except Exception as e:
                print(f"\n[Pass 2] SKIPPED: could not init YTMusic: {e}")
                yt = None

            if yt is not None:
                print(f"\n[Pass 2] Filling Popularity for {len(needs_pop)} tracks via YT Music...")
                all_artists = [r.get("Artist Name(s)", "").split(";")[0].strip() for r in needs_pop]
                pop_cache = build_popularity_cache(yt, all_artists)

                for row in needs_pop:
                    artist = (row.get("Artist Name(s)") or "").split(";")[0].strip()
                    listeners = pop_cache.get(normalize(artist))
                    if listeners is not None:
                        row["Popularity"] = str(listeners)
                        pop_filled += 1

                print(f"  Popularity filled: {pop_filled}/{len(needs_pop)}")
    else:
        print("\n[Pass 2] No tracks need Popularity — skipping.")

    # ── Summary ──
    unchanged = len(rows) - genres_filled - pop_filled
    print(f"\n{'='*50}")
    print(f"  {genres_filled} Genres filled")
    print(f"  {pop_filled} Popularity filled")
    print(f"  {unchanged} tracks unchanged")
    print(f"{'='*50}")

    if genres_filled == 0 and pop_filled == 0:
        print("\nNo new fills — nothing to write.")
        return

    # ── Backup + write ──
    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"masterlist.{datetime.now():%Y%m%d-%H%M%S}.pre-hydrate-metadata.csv"
    shutil.copy(MASTERLIST, backup)
    print(f"\nBackup: {backup}")

    with open(MASTERLIST, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {genres_filled + pop_filled} updates to masterlist.csv")


if __name__ == "__main__":
    main()
