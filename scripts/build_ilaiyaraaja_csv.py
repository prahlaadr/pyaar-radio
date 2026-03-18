#!/usr/bin/env python3
"""
Build ilaiyaraaja.csv by:
1. Extracting existing Ilaiyaraaja tracks from tamil.csv (already have Video IDs)
2. Searching YT Music for NTS Radio tracklist songs to get Video IDs + Film names
3. Deduplicating and writing the final CSV

Usage:
    python scripts/build_ilaiyaraaja_csv.py              # Full build
    python scripts/build_ilaiyaraaja_csv.py --dry         # Preview only
"""

import argparse
import csv
import sys
import time
from pathlib import Path

from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).resolve().parent.parent
TAMIL_CSV = PROJECT_DIR / "public" / "data" / "tamil.csv"
OUTPUT_CSV = PROJECT_DIR / "public" / "data" / "ilaiyaraaja.csv"
BROWSER_AUTH = PROJECT_DIR / "browser.json"

# NTS Radio tracklists (4 episodes)
NTS_TRACKS = [
    # Elephant Songs (June 28, 2024)
    "Thalaikuniyum",
    "Aadaiyil Aadum",
    "Malare Pesu",
    "Vatapathra Sayiki",
    "Kalyana Chelai",
    "Kuyile Kuyile",
    "En Thegam",
    "Unnakum Ennakum",
    "Kalidasan ... Kannadasan",
    "Putham Pudu Kaalai",
    "Mylapore Pakkam",
    "Adukku Mallikai Idhu",
    "Devan Kovil",
    # Still Bossin' (July 18, 2023)
    "Sandiyarae Sandiyarae",
    "Paattu Solli Paada",
    "Kanmanikku Vazhthu",
    "Enakku Piditha Paadal",
    "Yaaro Yaar Yaaro",
    "Roja Poonthottam",
    "Mozhiele Theriyuthu",
    "Melamasi Veethiyile",
    "Mayil Pola",
    "Maalaiveiyazhaki",
    "Unnai Ennakku",
    "Punnami Poovai Vikasisthunna",
    # Moon Is Afire (February 3, 2023)
    "Vizhiyil Vizhundu",
    "Kinnerasaani",
    "Keeravani",
    "Suga Raagame",
    "O Babuaa Yeh Mahua",
    "Raathiriyil Poothirukum",
    "Manasu Palike",
    "Nila Kayuthu",
    "Aakanulal",
    "Pothivacha Malligai Mottu",
    "Oru Kili Uruguthu",
    "Naa Poovedutthu",
    "Kathal Mayakam",
    # Soup To Nuts / Anu (September 14, 2022) — excluding non-Ilaiyaraaja tracks
    "Don't Compare",
    "Yedhedho Ennam",
    "Yeh Hawa Yeh Fiza",
    "Endhan Kannil",
    "Pattu Engey",
    "I Want To Tell You Something",
    "Adi Aathadi",
    "Raathiri Thookam",
    "Germanien Senthan",
    "Oru Killiyin",
    "Vaan Megham",
    "Love Theme On Computer",
    "Potta Padiyudhu",
    "Pesa Koodathu",
    "Baby",
    "One Two Three",
    "Adi Rani",
    "Sundari",
    "Etho Mogam",
    "Pavala Malligai",
    "Vikram",
    "Pala Raatthiri",
    "Kattu Kujilu",
]


def load_tamil_ilaiyaraaja() -> list[dict]:
    """Extract existing Ilaiyaraaja tracks from tamil.csv."""
    tracks = []
    with open(TAMIL_CSV, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            artist = row.get("Artist", "")
            if "ilaiyaraaja" in artist.lower() or "ilayaraaja" in artist.lower():
                track_name = row.get("Track Name", "").strip()
                album = row.get("Album", "").strip()
                video_id = row.get("Video ID", "").strip()
                if track_name and video_id:
                    tracks.append({
                        "Track Name": track_name,
                        "Film": album if album else "",
                        "Video ID": video_id,
                    })
    return tracks


def search_yt_music(yt: YTMusic, track_name: str) -> dict | None:
    """Search YT Music for an Ilaiyaraaja track, return best match."""
    queries = [
        f"Ilaiyaraaja {track_name}",
        f"Ilayaraja {track_name}",
        track_name,
    ]

    for q in queries:
        try:
            results = yt.search(q, filter="songs", limit=10)
            if not results:
                continue

            # Look for Ilaiyaraaja in artist names
            for r in results:
                artists = [a.get("name", "").lower() for a in r.get("artists", [])]
                artist_str = " ".join(artists)
                if "ilaiyaraaja" in artist_str or "ilayaraaja" in artist_str or "ilayaraja" in artist_str:
                    album = r.get("album", {})
                    album_name = album.get("name", "") if album else ""
                    # Strip common suffixes
                    for suffix in [" (Original Motion Picture Soundtrack)", " (Original Soundtrack)"]:
                        if album_name.endswith(suffix):
                            album_name = album_name[: -len(suffix)]
                    return {
                        "Track Name": r.get("title", track_name),
                        "Film": album_name,
                        "Video ID": r.get("videoId", ""),
                    }

            # Fallback: first result if it looks like a Tamil/Telugu film song
            first = results[0]
            album = first.get("album", {})
            album_name = album.get("name", "") if album else ""
            for suffix in [" (Original Motion Picture Soundtrack)", " (Original Soundtrack)"]:
                if album_name.endswith(suffix):
                    album_name = album_name[: -len(suffix)]
            return {
                "Track Name": first.get("title", track_name),
                "Film": album_name,
                "Video ID": first.get("videoId", ""),
            }

        except Exception as e:
            print(f"    Search error for '{q}': {e}")
            continue

    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry", action="store_true", help="Preview only, don't write CSV")
    args = parser.parse_args()

    # Step 1: Load existing tracks from tamil.csv
    print("Loading Ilaiyaraaja tracks from tamil.csv...")
    existing = load_tamil_ilaiyaraaja()
    print(f"  Found {len(existing)} tracks with Video IDs\n")

    # Track by lowercase name to dedup
    seen_names: dict[str, dict] = {}
    seen_video_ids: set[str] = set()
    for t in existing:
        key = t["Track Name"].lower().strip()
        seen_names[key] = t
        seen_video_ids.add(t["Video ID"])

    # Step 2: Search YT Music for NTS tracks
    if not BROWSER_AUTH.exists():
        print("WARNING: No browser.json found. Skipping YT Music search.")
        print("Only including tracks from tamil.csv.\n")
        all_tracks = existing
    else:
        print("Searching YT Music for NTS tracklist songs...")
        yt = YTMusic(str(BROWSER_AUTH))
        new_tracks = []

        for i, name in enumerate(NTS_TRACKS):
            key = name.lower().strip()
            if key in seen_names:
                print(f"  [{i+1}/{len(NTS_TRACKS)}] {name}: already have (from tamil.csv)")
                continue

            result = search_yt_music(yt, name)
            if result and result["Video ID"] and result["Video ID"] not in seen_video_ids:
                new_tracks.append(result)
                seen_names[key] = result
                seen_video_ids.add(result["Video ID"])
                print(f"  [{i+1}/{len(NTS_TRACKS)}] {name}: FOUND — {result['Track Name']} ({result['Film']}) [{result['Video ID']}]")
            elif result and result["Video ID"] in seen_video_ids:
                print(f"  [{i+1}/{len(NTS_TRACKS)}] {name}: duplicate Video ID, skipping")
            else:
                print(f"  [{i+1}/{len(NTS_TRACKS)}] {name}: NOT FOUND")

            time.sleep(0.3)

        all_tracks = existing + new_tracks
        print(f"\n  Existing: {len(existing)}, New from NTS: {len(new_tracks)}")

    # Step 3: Sort and write
    all_tracks.sort(key=lambda t: (t.get("Film", "").lower(), t["Track Name"].lower()))
    print(f"\nTotal tracks: {len(all_tracks)}")

    if args.dry:
        print("\n[DRY RUN] Would write:")
        for t in all_tracks:
            print(f"  {t['Track Name']} — {t['Film']} [{t['Video ID']}]")
        return

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["Track Name", "Film", "Video ID"])
        writer.writeheader()
        writer.writerows(all_tracks)

    print(f"Written to {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
