"""Roster sources for the Radar.

The My Artists radar scans the curated `artists.csv` UNIONed with a derived set:
artists the user has clearly collected (>= 2 saved albums in the library) but
hasn't hand-added yet. Membership is cheap and library-derived; "release-active"
is NOT pre-gated here. The scan's recency window (`release.py`) enforces that, so
an artist collected years ago who just dropped a new album is still checked. See
docs/pyaar-records-DESIGN.md.
"""

import csv
import json
import re
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
ARTISTS_PATH = PROJECT_DIR / "public" / "data" / "artists.csv"
INDEX_PATH = PROJECT_DIR / "albums" / "_index.json"

# User rule: "after I save more than 1 album from an artist, I consider them part
# of the pool." So 2+ saved albums auto-qualifies an artist for the My Artists radar.
MIN_SAVED_ALBUMS = 2

# Label/aggregator channels that upload a whole catalog under one "artist" and
# would flood the roster. The >= 2-saved bar already filters most noise (you
# don't deliberately save 2 albums from an aggregator), so this is just the
# known-offender list (see the radar audit history). Prolific real artists
# (A. R. Rahman, etc.) are NOT noise and stay in.
DENYLIST = {"raaja beats", "chor bazaar"}


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def load_curated_keys() -> set[str]:
    """Normalized names + aliases already in artists.csv (the gatekeeper)."""
    known = set()
    with open(ARTISTS_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("artist"):
                known.add(_norm(row["artist"]))
            for alias in (row.get("aliases") or "").split("|"):
                if alias.strip():
                    known.add(_norm(alias))
    return known


def curated_names() -> list[str]:
    names = []
    with open(ARTISTS_PATH, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = (row.get("artist") or "").strip()
            if name:
                names.append(name)
    return names


def derived_my_artists() -> list[str]:
    """Artists with >= MIN_SAVED_ALBUMS saved albums that aren't curated yet.

    Computed live from albums/_index.json (committed + daily-synced), so the
    cloud scan auto-includes them. Excludes curated artists and the denylist.
    """
    with open(INDEX_PATH, encoding="utf-8") as f:
        albums = json.load(f).get("albums", [])

    counts: dict[str, int] = {}
    display: dict[str, str] = {}
    for album in albums:
        name = (album.get("artist") or "").strip()
        if not name:
            continue
        key = _norm(name)
        counts[key] = counts.get(key, 0) + 1
        display.setdefault(key, name)

    curated = load_curated_keys()
    out = [
        display[key]
        for key, n in counts.items()
        if n >= MIN_SAVED_ALBUMS and key not in curated and key not in DENYLIST
    ]
    return sorted(out, key=str.lower)


def load_my_artists() -> list[str]:
    """The full My Artists scan roster: curated UNION derived, deduped by name."""
    seen: set[str] = set()
    roster: list[str] = []
    for name in curated_names() + derived_my_artists():
        key = _norm(name)
        if key not in seen:
            seen.add(key)
            roster.append(name)
    return roster
