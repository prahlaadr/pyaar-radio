"""Pyaar Crate — discovery holding zone for artists and albums to explore."""

import csv
from datetime import datetime
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
CRATE_PATH = PROJECT_DIR / "public" / "data" / "crate.csv"
ARTISTS_PATH = PROJECT_DIR / "public" / "data" / "artists.csv"

FIELDS = ["artist", "album", "year", "source", "status", "added_at", "notes"]


def load_crate() -> list[dict]:
    if not CRATE_PATH.exists():
        return []
    with open(CRATE_PATH, "r", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def save_crate(rows: list[dict]):
    with open(CRATE_PATH, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)


def load_curated_artists() -> set[str]:
    artists = set()
    with open(ARTISTS_PATH, "r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row.get("artist", "").strip().lower()
            if name:
                artists.add(name)
            for alias in row.get("aliases", "").split("|"):
                alias = alias.strip().lower()
                if alias:
                    artists.add(alias)
    return artists


def add_to_crate(artist: str, album: str = "", year: str = "", source: str = "", notes: str = ""):
    rows = load_crate()

    # Check if already in crate
    for row in rows:
        if row["artist"].lower() == artist.lower() and row.get("album", "").lower() == album.lower():
            print(f"Already in crate: {artist}" + (f" — {album}" if album else ""))
            return

    # Check if already curated
    curated = load_curated_artists()
    if artist.lower() in curated:
        print(f"Already curated in artists.csv: {artist}")
        return

    rows.append({
        "artist": artist,
        "album": album,
        "year": year,
        "source": source,
        "status": "new",
        "added_at": datetime.now().strftime("%Y-%m-%d"),
        "notes": notes,
    })
    save_crate(rows)
    print(f"Added to crate: {artist}" + (f" — {album}" if album else ""))


def update_status(artist: str, status: str):
    rows = load_crate()
    found = False
    for row in rows:
        if row["artist"].lower() == artist.lower():
            row["status"] = status
            found = True
    if found:
        save_crate(rows)
        print(f"Updated: {artist} → {status}")
    else:
        print(f"Not found in crate: {artist}")


def list_crate(status_filter: str | None = None):
    rows = load_crate()
    if status_filter:
        rows = [r for r in rows if r["status"] == status_filter]
    if not rows:
        print("Crate is empty." if not status_filter else f"No {status_filter} entries.")
        return
    print(f"{'Artist':<25} {'Album':<30} {'Year':<6} {'Source':<15} {'Status':<10} {'Added'}")
    print("-" * 100)
    for r in rows:
        print(f"{r['artist']:<25} {r.get('album',''):<30} {r.get('year',''):<6} {r.get('source',''):<15} {r['status']:<10} {r.get('added_at','')}")
    print(f"\n{len(rows)} entries")
