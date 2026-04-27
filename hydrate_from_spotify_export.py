"""Hydrate masterlist.csv from Spotify CSV exports.

Reads two Spotify exports:
  1. Liked Songs CSV (e.g. ~/Downloads/Liked_Songs(3).csv) — primary source
     for user's true date-liked timestamps (`Added At`).
  2. Tamil playlist CSV (e.g. ~/Downloads/Azhagiya_Tamil_Magan_(goated).csv) —
     metadata enrichment only (its Added At is when tracks were added to the
     playlist, not when the user liked them).

Fills these masterlist columns from Spotify's audio analysis + library data:
  - First Liked At  (NEW — from Liked Songs CSV only — true date-liked)
  - Tempo, Key, Genres, Popularity, Release Date, Instrumentalness  (existing)
  - Danceability, Energy, Loudness, Mode, Speechiness, Acousticness,
    Liveness, Valence, Time Signature, Spotify URI  (NEW)

Two-pass matching:
  1. Strict: (first artist, track name) lowercased
  2. Fuzzy: strip '(feat. …)' suffix from track name, retry; then try
     by track name + any-artist substring match

Idempotent — only fills empty cells, never overwrites existing values.
The new columns start empty so the first run fills everything for matched tracks.

Usage:
    python hydrate_from_spotify_export.py            # Dry run preview
    python hydrate_from_spotify_export.py --apply    # Write changes
"""

import argparse
import csv
import re
import shutil
from datetime import datetime
from pathlib import Path

REPO = Path(__file__).parent
MASTERLIST = REPO / "public" / "data" / "masterlist.csv"
BACKUP_DIR = REPO / "backups"

LIKED_CSV = Path.home() / "Downloads/Liked_Songs(3).csv"
TAMIL_CSV = Path.home() / "Downloads/Azhagiya_Tamil_Magan_(goated).csv"

# Columns we'll populate from Spotify
EXISTING_FILL_COLS = ["Tempo", "Key", "Genres", "Popularity", "Release Date", "Instrumentalness"]
NEW_COLS = [
    "First Liked At",
    "Danceability", "Energy", "Loudness", "Mode",
    "Speechiness", "Acousticness", "Liveness", "Valence", "Time Signature",
    "Spotify URI",
]

# Map Spotify CSV column → our masterlist column (where they differ)
SPOTIFY_TO_MASTERLIST = {
    "Tempo": "Tempo",
    "Key": "Key",
    "Genres": "Genres",
    "Popularity": "Popularity",
    "Release Date": "Release Date",
    "Instrumentalness": "Instrumentalness",
    "Danceability": "Danceability",
    "Energy": "Energy",
    "Loudness": "Loudness",
    "Mode": "Mode",
    "Speechiness": "Speechiness",
    "Acousticness": "Acousticness",
    "Liveness": "Liveness",
    "Valence": "Valence",
    "Time Signature": "Time Signature",
    "Track URI": "Spotify URI",
}


def normalize(s: str) -> str:
    return (s or "").strip().lower()


_FEAT_RE = re.compile(r"\s*\(?(feat\.?|ft\.?|featuring)\b[^)]*\)?", re.IGNORECASE)
_APOS_RE = re.compile(r"['’‘]")


def normalize_track(s: str) -> str:
    """Normalize a track name for fuzzy matching: lowercase, strip (feat. …), normalize apostrophes."""
    s = normalize(s)
    s = _FEAT_RE.sub("", s)
    s = _APOS_RE.sub("", s)
    return s.strip()


def is_empty(value: str) -> bool:
    if value is None:
        return True
    s = str(value).strip()
    if not s:
        return True
    # Treat "0" as empty for numeric fields where 0 means "no data"
    return False


def load_spotify_csv(path: Path, is_liked_songs: bool) -> tuple[dict, dict]:
    """Returns (strict_lookup, fuzzy_index).

    strict_lookup: (first_artist_lower, track_lower) → row dict
    fuzzy_index:   normalized_track_name → list of row dicts
    """
    strict = {}
    fuzzy: dict[str, list[dict]] = {}
    if not path.exists():
        print(f"  WARN: {path} not found, skipping")
        return strict, fuzzy
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            track = normalize(row.get("Track Name"))
            artists = normalize(row.get("Artist Name(s)"))
            first_artist = artists.split(",")[0].strip() if artists else ""
            if track and first_artist:
                # Tag where this row came from for later (Liked Songs Added At only)
                row["_source_is_liked_songs"] = is_liked_songs
                strict[(first_artist, track)] = row
                fuzzy.setdefault(normalize_track(row.get("Track Name", "")), []).append(row)
    return strict, fuzzy


def lookup(strict: dict, fuzzy: dict, yt_artist: str, yt_track: str) -> dict | None:
    """Try strict match, then fuzzy."""
    first_yt_artist = normalize(yt_artist).split(";")[0].strip()
    track_norm = normalize(yt_track)

    # Pass 1: strict
    s = strict.get((first_yt_artist, track_norm))
    if s:
        return s

    # Pass 2: strip (feat. …) + normalize apostrophes
    track_fuzzy = normalize_track(yt_track)
    candidates = fuzzy.get(track_fuzzy, [])
    for cand in candidates:
        cand_artists = normalize(cand.get("Artist Name(s)"))
        # Match if any YT artist appears anywhere in Spotify's artist credit
        for ya in normalize(yt_artist).split(";"):
            ya = ya.strip()
            if ya and ya in cand_artists:
                return cand
    return None


def main():
    parser = argparse.ArgumentParser(description="Hydrate masterlist from Spotify CSV exports")
    parser.add_argument("--apply", action="store_true", help="Write changes (default: dry-run)")
    args = parser.parse_args()

    # === Load both Spotify CSVs ===
    print(f"Loading {LIKED_CSV.name}...")
    liked_strict, liked_fuzzy = load_spotify_csv(LIKED_CSV, is_liked_songs=True)
    print(f"  {len(liked_strict)} (artist, track) pairs")

    print(f"\nLoading {TAMIL_CSV.name}...")
    tamil_strict, tamil_fuzzy = load_spotify_csv(TAMIL_CSV, is_liked_songs=False)
    print(f"  {len(tamil_strict)} (artist, track) pairs")

    # === Load masterlist ===
    with open(MASTERLIST, encoding="utf-8") as f:
        reader = csv.DictReader(f)
        existing_fields = list(reader.fieldnames or [])
        rows = list(reader)
    print(f"\nMasterlist: {len(rows)} rows, {len(existing_fields)} existing columns")

    # === Determine new fieldnames ===
    new_fieldnames = list(existing_fields)
    for col in NEW_COLS:
        if col not in new_fieldnames:
            new_fieldnames.append(col)
    new_cols_added = [c for c in NEW_COLS if c not in existing_fields]
    print(f"New columns to add: {new_cols_added}")

    # === Match + fill ===
    matched_liked = 0
    matched_tamil = 0
    matched_total = 0
    fills = {col: 0 for col in EXISTING_FILL_COLS + NEW_COLS}

    for row in rows:
        yt_track = row.get("Track Name", "")
        yt_artist = row.get("Artist Name(s)", "")
        if not yt_track or not yt_artist:
            continue

        # Try Liked Songs CSV first (so we get Added At when available)
        s = lookup(liked_strict, liked_fuzzy, yt_artist, yt_track)
        is_from_liked = bool(s)
        if not s:
            s = lookup(tamil_strict, tamil_fuzzy, yt_artist, yt_track)

        if not s:
            continue

        matched_total += 1
        if is_from_liked:
            matched_liked += 1
        else:
            matched_tamil += 1

        # Fill columns from Spotify row
        for sp_col, ml_col in SPOTIFY_TO_MASTERLIST.items():
            sp_val = (s.get(sp_col, "") or "").strip()
            if not sp_val:
                continue
            existing_val = (row.get(ml_col, "") or "").strip()
            if is_empty(existing_val):
                row[ml_col] = sp_val
                fills[ml_col] += 1

        # First Liked At — ONLY from Liked Songs CSV (Tamil playlist Added At means
        # added to playlist, not liked by user).
        if is_from_liked:
            added = (s.get("Added At", "") or "").strip()
            if added:
                existing_first = (row.get("First Liked At", "") or "").strip()
                if not existing_first:
                    row["First Liked At"] = added
                    fills["First Liked At"] += 1

    # === Report ===
    print(f"\n=== MATCH RATES ===")
    print(f"  Matched (Liked Songs CSV): {matched_liked}")
    print(f"  Matched (Tamil playlist):   {matched_tamil}")
    print(f"  Total matched:              {matched_total}/{len(rows)}  ({100 * matched_total // len(rows)}%)")

    print(f"\n=== FILLS PER COLUMN ===")
    for col in NEW_COLS + EXISTING_FILL_COLS:
        print(f"  {col:<22} {fills[col]:>6}")

    if not args.apply:
        print(f"\n(dry-run — pass --apply to write)")
        return

    if matched_total == 0:
        print("\nNo matches, nothing to write.")
        return

    BACKUP_DIR.mkdir(exist_ok=True)
    backup = BACKUP_DIR / f"masterlist.{datetime.now():%Y%m%d-%H%M%S}.pre-spotify-hydrate.csv"
    shutil.copy(MASTERLIST, backup)
    print(f"\nBackup: {backup}")

    with open(MASTERLIST, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=new_fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {matched_total} hydrations to masterlist ({len(new_fieldnames)} columns).")


if __name__ == "__main__":
    main()
