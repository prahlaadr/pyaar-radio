#!/usr/bin/env python3
"""
Sync PRAHLOUD archive playlists to USB.

For each month/year playlist, ensures the USB has every track in the best
available quality: Soulseek FLAC/320 first, yt-dlp MP3 fallback.

Usage:
    python3 sync_usb.py                    # Sync all archive playlists
    python3 sync_usb.py --months "March 26" "Feb 26"  # Sync specific months
    python3 sync_usb.py --dry              # Preview what would be synced
    python3 sync_usb.py --usb /Volumes/Lexar  # Custom USB path
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

PROJECT_DIR = Path(__file__).parent
PLAYLISTS_DIR = PROJECT_DIR / "public" / "playlists"
INDEX_PATH = PLAYLISTS_DIR / "_index.json"

DEFAULT_USB = "/Volumes/Lexar/RAAMI RADIO/PRAHLOUD"
SOULSEEK_DIR = Path.home() / "Documents/Projects/03-music-audio/soulseek"
BATCH_GRAB = SOULSEEK_DIR / "slskd" / "batch_grab.py"
COMPLETE_DIR = SOULSEEK_DIR / "downloads" / "complete"

# Month name → number mapping (including creative spellings)
MONTH_MAP = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
    "mirch": 3, "feeb": 2, "febyouary": 2, "jooli": 7, "joon": 6,
    "apreel": 4, "aprul": 4, "agust": 8, "ock": 10, "okt": 10,
    "simptember": 9, "decembrrr": 12, "novemburr": 11, "mai": 5,
    "juun": 6, "deck": 12, "murch": 3, "march": 3, "june": 6,
    "july": 7, "august": 8, "april": 4, "november": 11, "september": 9,
    "october": 10, "february": 2, "january": 1, "december": 12,
}

MONTH_RE = re.compile(r"^(\w+)\s*'?(\d{2})\b", re.IGNORECASE)
MONTH_NAMES = {
    1: "January", 2: "February", 3: "March", 4: "April", 5: "May", 6: "June",
    7: "July", 8: "August", 9: "September", 10: "October", 11: "November", 12: "December",
}


def parse_archive_date(title):
    """Parse month/year from playlist title. Returns (year, month) or None."""
    m = MONTH_RE.match(title.strip())
    if not m:
        return None
    month_key = m.group(1).lower()
    month = MONTH_MAP.get(month_key)
    if not month:
        return None
    year = int(m.group(2)) + 2000
    return (year, month)


def get_archive_playlists(index_path, filter_months=None):
    """Get all archive (month/year) playlists, sorted newest first."""
    with open(index_path) as f:
        data = json.load(f)

    playlists = []
    for p in data["playlists"]:
        date = parse_archive_date(p["title"])
        if date:
            playlists.append({
                "playlistId": p["playlistId"],
                "title": p["title"].strip(),
                "trackCount": p["trackCount"],
                "year": date[0],
                "month": date[1],
            })

    # Filter if specific months requested
    if filter_months:
        filter_set = set(m.lower() for m in filter_months)
        playlists = [p for p in playlists if p["title"].lower() in filter_set]

    playlists.sort(key=lambda p: (p["year"], p["month"]), reverse=True)
    return playlists


def get_usb_folder(usb_base, year, month, title):
    """Get or create the USB folder for a playlist."""
    if year >= 2026:
        # New format: 2026/March 26
        folder = Path(usb_base) / str(year) / title
    else:
        # Old format: 2024-03 (March)
        folder = Path(usb_base) / f"{year}-{month:02d} ({MONTH_NAMES[month]})"

    return folder


def get_existing_tracks(folder):
    """Get lowercase set of track stems already on USB."""
    if not folder.exists():
        return set()
    return {Path(f).stem.lower() for f in os.listdir(folder)}


def normalize(s):
    """Normalize string for fuzzy matching — strip punctuation, collapse whitespace."""
    s = s.lower()
    # Normalize unicode punctuation (fullwidth chars, smart quotes, etc.)
    for old, new in [("？", "?"), ("⧸", "/"), ("\u2019", "'"), ("\u2018", "'"), ("\u201c", '"'), ("\u201d", '"')]:
        s = s.replace(old, new)
    # Strip common punctuation
    s = re.sub(r"[^\w\s]", "", s)
    return " ".join(s.split())


def is_track_on_usb(track, existing):
    """Check if a track is already on the USB (fuzzy match on title/artist)."""
    title_norm = normalize(track["title"])
    artist_norm = normalize(track["artist"].split(";")[0])
    # Also check with just first significant word of title
    title_words = [w for w in title_norm.split() if len(w) > 2]

    for f in existing:
        f_norm = normalize(f)
        # Direct substring match
        if title_norm[:15] in f_norm or (len(artist_norm) > 3 and artist_norm[:10] in f_norm):
            return True
        # Word-based match — if 2+ significant title words appear in filename
        if title_words and sum(1 for w in title_words if w in f_norm) >= min(2, len(title_words)):
            return True
    return False


def clean_query(artist, title):
    """Build a Soulseek search query from artist + title."""
    artist = artist.split(";")[0].strip()
    title = re.sub(r"\s*\(feat\..*?\)", "", title)
    title = re.sub(r"\s*\[.*?\]", "", title)
    for ch in ["/", "\\", '"', "'", "?", "!"]:
        artist = artist.replace(ch, " ")
        title = title.replace(ch, " ")
    return f"{artist} {title}".strip()


def download_soulseek(queries):
    """Run batch_grab.py for a list of queries. Returns set of new files."""
    if not queries or not BATCH_GRAB.exists():
        return set()

    before = set(os.listdir(COMPLETE_DIR)) if COMPLETE_DIR.exists() else set()

    # Kill stale nicotine
    subprocess.run(["pkill", "-f", "nicotine"], capture_output=True)
    import time; time.sleep(2)

    cmd = [sys.executable, "-u", str(BATCH_GRAB)] + queries
    print(f"  Soulseek: searching {len(queries)} tracks...")
    subprocess.run(cmd, timeout=300, capture_output=True)

    after = set(os.listdir(COMPLETE_DIR)) if COMPLETE_DIR.exists() else set()
    return after - before


def download_ytdlp(video_id, name, dest_folder):
    """Download a track via yt-dlp as MP3."""
    safe_name = name.replace("/", "-").replace("$", "S")[:80]
    dest = dest_folder / f"{safe_name}.mp3"

    if dest.exists():
        return True

    with tempfile.TemporaryDirectory() as tmpdir:
        outpath = os.path.join(tmpdir, f"{safe_name}.mp3")
        r = subprocess.run([
            "yt-dlp", "-x", "--audio-format", "mp3", "--audio-quality", "0",
            "-o", outpath,
            f"https://music.youtube.com/watch?v={video_id}"
        ], capture_output=True, text=True, timeout=60)

        if os.path.exists(outpath):
            shutil.copy2(outpath, dest)
            return True
    return False


def sync_playlist(playlist, usb_base, dry_run=False):
    """Sync a single playlist to USB. Returns (downloaded, failed, skipped) counts."""
    playlist_path = PLAYLISTS_DIR / f"{playlist['playlistId']}.json"
    if not playlist_path.exists():
        print(f"  Playlist JSON not found: {playlist_path}")
        return 0, 0, 0

    with open(playlist_path) as f:
        data = json.load(f)

    folder = get_usb_folder(usb_base, playlist["year"], playlist["month"], playlist["title"])
    existing = get_existing_tracks(folder)

    # Find missing tracks
    missing = []
    for t in data["tracks"]:
        if not is_track_on_usb(t, existing):
            missing.append(t)

    if not missing:
        print(f"  All {len(data['tracks'])} tracks present")
        return 0, 0, len(data["tracks"])

    print(f"  {len(missing)} missing of {len(data['tracks'])} tracks")

    if dry_run:
        for t in missing:
            print(f"    Would download: {t['artist'].split(';')[0]} - {t['title']}")
        return 0, 0, len(data["tracks"]) - len(missing)

    # Create folder
    folder.mkdir(parents=True, exist_ok=True)

    # Step 1: Try Soulseek for all missing tracks
    queries = [clean_query(t["artist"], t["title"]) for t in missing]
    new_files = download_soulseek(queries)

    # Copy Soulseek downloads to USB
    downloaded = 0
    still_missing = []
    for t in missing:
        title_lower = t["title"].lower()
        artist_lower = t["artist"].split(";")[0].lower()
        copied = False
        for f in new_files:
            if title_lower[:12] in f.lower() or (len(artist_lower) > 3 and artist_lower[:8] in f.lower()):
                src = COMPLETE_DIR / f
                if src.exists():
                    shutil.copy2(src, folder / f)
                    downloaded += 1
                    copied = True
                    print(f"    Soulseek: {f}")
                    break
        if not copied:
            still_missing.append(t)

    # Step 2: yt-dlp fallback for remaining
    failed = 0
    for t in still_missing:
        if not t.get("videoId"):
            failed += 1
            print(f"    SKIP (no videoId): {t['artist']} - {t['title']}")
            continue

        name = f"{t['artist'].split(';')[0]} - {t['title']}"
        print(f"    yt-dlp: {name}...", end=" ", flush=True)
        if download_ytdlp(t["videoId"], name, folder):
            downloaded += 1
            print("OK")
        else:
            failed += 1
            print("FAIL")

    skipped = len(data["tracks"]) - len(missing)
    return downloaded, failed, skipped


def main():
    parser = argparse.ArgumentParser(description="Sync PRAHLOUD archive to USB")
    parser.add_argument("--months", nargs="*", help="Specific months to sync (e.g. 'March 26' 'Feb 26')")
    parser.add_argument("--dry", action="store_true", help="Preview only, don't download")
    parser.add_argument("--usb", default=DEFAULT_USB, help=f"USB path (default: {DEFAULT_USB})")
    args = parser.parse_args()

    if not INDEX_PATH.exists():
        print(f"Playlist index not found: {INDEX_PATH}")
        print("Run sync_playlists.py first.")
        sys.exit(1)

    usb_base = Path(args.usb)
    if not usb_base.exists():
        print(f"USB not mounted: {usb_base}")
        sys.exit(1)

    playlists = get_archive_playlists(INDEX_PATH, args.months)
    if not playlists:
        print("No archive playlists found.")
        sys.exit(1)

    print(f"{'[DRY RUN] ' if args.dry else ''}Syncing {len(playlists)} archive playlists to {usb_base}\n")

    total_dl, total_fail, total_skip = 0, 0, 0
    for p in playlists:
        print(f"{'─' * 50}")
        print(f"{p['title']} ({p['trackCount']} tracks)")
        dl, fail, skip = sync_playlist(p, usb_base, args.dry)
        total_dl += dl
        total_fail += fail
        total_skip += skip

    print(f"\n{'═' * 50}")
    print(f"DONE — Downloaded: {total_dl} | Failed: {total_fail} | Already on USB: {total_skip}")


if __name__ == "__main__":
    main()
