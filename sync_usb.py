#!/usr/bin/env python3
"""
Sync monthly archive playlists from YT Music to a target folder.

For each month/year playlist, ensures the target has every track in the best
available quality: Soulseek FLAC/320 first, yt-dlp MP3 fallback.

Default target: V3 PYAAR.Radio/Monthlys/ (master archive, post-2026-06-01
reorg). Path resolved from ~/.config/pyaar-sync/drives.json — never hardcoded.

Usage:
    python3 sync_usb.py                              # Sync all archive playlists to V3 Monthlys
    python3 sync_usb.py --months "March 26" "Feb 26" # Sync specific months
    python3 sync_usb.py --dry                        # Preview only
    python3 sync_usb.py --usb /custom/path           # Override target
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

# Make pyaar_drives importable
sys.path.insert(0, str(PROJECT_DIR))
from pyaar_drives import get_root_optional  # noqa: E402


def default_target() -> str | None:
    """Resolve default sync target: V3 PYAAR.Radio/Monthlys (V3-master era).

    Returns None if V3 not mounted/configured — caller errors with instructions.
    """
    v3 = get_root_optional("v3")
    if v3 is None:
        return None
    return str(v3 / "PYAAR.Radio" / "Monthlys")
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


def get_usb_folder(usb_base, year, month, title, flat=False):
    """Get or create the target folder for a playlist.

    `flat=True` uses the simple YYYY-MM (Month) format for every year — the
    V3 PYAAR.Radio/Monthlys convention (also V1's old layout). The non-flat
    branch is legacy for the old PRAHLOUD/Lexar drive layout."""
    if flat:
        return Path(usb_base) / f"{year}-{month:02d} ({MONTH_NAMES[month]})"
    if year >= 2026:
        # Legacy PRAHLOUD format: 2026/March 26
        folder = Path(usb_base) / str(year) / title
    elif year == 2025:
        # Legacy PRAHLOUD: 2025 lives under prahloud 2025/
        folder = Path(usb_base) / "prahloud 2025" / f"{year}-{month:02d} ({MONTH_NAMES[month]})"
    else:
        # Legacy PRAHLOUD: pre-2025 top-level
        folder = Path(usb_base) / f"{year}-{month:02d} ({MONTH_NAMES[month]})"

    return folder


def get_existing_tracks(folder):
    """Get map of normalized stem → full filepath for tracks on USB."""
    if not folder.exists():
        return {}
    result = {}
    for f in os.listdir(folder):
        fp = folder / f
        if fp.is_file():
            result[normalize(Path(f).stem)] = fp
    return result


# Quality tiers (higher = better)
QUALITY_FLAC = 3      # FLAC/ALAC/WAV/AIFF — lossless
QUALITY_320 = 2       # 320kbps+ MP3/AAC
QUALITY_LOW = 1       # anything below 320kbps
QUALITY_UNKNOWN = 0


def check_quality(filepath):
    """Check audio quality of a file. Returns (tier, details_string)."""
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries",
             "format=format_name,bit_rate", "-of", "csv=p=0", str(filepath)],
            capture_output=True, text=True, timeout=10
        )
        parts = r.stdout.strip().split(",")
        if len(parts) < 2:
            return QUALITY_UNKNOWN, "unknown"

        fmt = parts[0].lower()
        bitrate = int(parts[1]) // 1000 if parts[1].isdigit() else 0

        if "flac" in fmt or "alac" in fmt or "wav" in fmt or "aiff" in fmt:
            return QUALITY_FLAC, f"lossless ({fmt})"
        elif bitrate >= 310:
            return QUALITY_320, f"{bitrate}kbps {fmt}"
        elif bitrate > 0:
            return QUALITY_LOW, f"{bitrate}kbps {fmt}"
        else:
            # m4a/aac from yt-dlp often don't report bitrate cleanly
            ext = Path(filepath).suffix.lower()
            if ext in (".m4a", ".aac", ".opus", ".webm"):
                return QUALITY_LOW, f"lossy ({ext})"
            return QUALITY_UNKNOWN, "unknown"
    except Exception:
        return QUALITY_UNKNOWN, "error"


def normalize(s):
    """Normalize string for fuzzy matching — strip punctuation, collapse whitespace."""
    s = s.lower()
    # Normalize unicode punctuation (fullwidth chars, smart quotes, etc.)
    for old, new in [("？", "?"), ("⧸", "/"), ("\u2019", "'"), ("\u2018", "'"), ("\u201c", '"'), ("\u201d", '"')]:
        s = s.replace(old, new)
    # Strip common punctuation
    s = re.sub(r"[^\w\s]", "", s)
    return " ".join(s.split())


def find_track_on_usb(track, existing):
    """Find a track on USB. Returns filepath if found, None if missing.
    existing is a dict of {normalized_stem: filepath}."""
    title_norm = normalize(track["title"])
    artist_norm = normalize(track["artist"].split(";")[0])
    title_words = [w for w in title_norm.split() if len(w) > 2]

    for f_norm, filepath in existing.items():
        # Direct substring match
        if title_norm[:15] in f_norm or (len(artist_norm) > 3 and artist_norm[:10] in f_norm):
            return filepath
        # Word-based match — if 2+ significant title words appear in filename
        if title_words and sum(1 for w in title_words if w in f_norm) >= min(2, len(title_words)):
            return filepath
    return None


def clean_query(artist, title):
    """Build a Soulseek search query from artist + title."""
    artist = artist.split(";")[0].strip()
    title = re.sub(r"\s*\(feat\..*?\)", "", title)
    title = re.sub(r"\s*\[.*?\]", "", title)
    for ch in ["/", "\\", '"', "'", "?", "!"]:
        artist = artist.replace(ch, " ")
        title = title.replace(ch, " ")
    return f"{artist} {title}".strip()


def copy_as_320(src, dest_folder, filename):
    """Copy audio file to dest. If FLAC/lossless, convert to 320kbps MP3 to save space."""
    src = Path(src)
    ext = src.suffix.lower()

    if ext in (".flac", ".alac", ".wav", ".aiff"):
        # Convert to 320kbps MP3
        mp3_name = Path(filename).stem + ".mp3"
        dest = dest_folder / mp3_name
        try:
            subprocess.run([
                "ffmpeg", "-i", str(src), "-ab", "320k", "-map_metadata", "0",
                "-y", str(dest)
            ], capture_output=True, timeout=60)
            if dest.exists() and dest.stat().st_size > 0:
                return dest
        except Exception:
            pass
        # Fallback: copy as-is if conversion fails
        dest = dest_folder / filename
        shutil.copy2(src, dest)
        return dest
    else:
        dest = dest_folder / filename
        shutil.copy2(src, dest)
        return dest


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


def sync_playlist(playlist, usb_base, dry_run=False, flat=False):
    """Sync a single playlist to USB. Returns (downloaded, upgraded, failed, skipped) counts."""
    playlist_path = PLAYLISTS_DIR / f"{playlist['playlistId']}.json"
    if not playlist_path.exists():
        print(f"  Playlist JSON not found: {playlist_path}")
        return 0, 0, 0, 0

    with open(playlist_path) as f:
        data = json.load(f)

    folder = get_usb_folder(usb_base, playlist["year"], playlist["month"], playlist["title"], flat=flat)
    existing = get_existing_tracks(folder)

    # Categorize tracks: missing, upgradeable, or good
    missing = []       # not on USB at all
    upgradeable = []   # on USB but low quality
    good = 0           # on USB and already HQ

    for t in data["tracks"]:
        match = find_track_on_usb(t, existing)
        if match is None:
            missing.append((t, None))
        else:
            quality, desc = check_quality(match)
            if quality >= QUALITY_320:
                good += 1
            else:
                upgradeable.append((t, match, quality, desc))

    need_download = missing + [(t, old_path) for t, old_path, q, d in upgradeable]

    if not need_download and not upgradeable:
        print(f"  All {len(data['tracks'])} tracks present and HQ")
        return 0, 0, 0, good

    status_parts = []
    if missing:
        status_parts.append(f"{len(missing)} missing")
    if upgradeable:
        status_parts.append(f"{len(upgradeable)} upgradeable")
    print(f"  {' + '.join(status_parts)} of {len(data['tracks'])} tracks ({good} already HQ)")

    if dry_run:
        for t, _ in missing:
            print(f"    [NEW] {t['artist'].split(';')[0]} - {t['title']}")
        for t, old_path, q, desc in upgradeable:
            print(f"    [UPGRADE {desc}] {t['artist'].split(';')[0]} - {t['title']}")
        return 0, 0, 0, good

    # Create folder
    folder.mkdir(parents=True, exist_ok=True)

    # Collect all tracks that need Soulseek attempts
    all_needed = [(t, old_path) for t, old_path in missing] + [(t, old_path) for t, old_path, q, d in upgradeable]
    queries = [clean_query(t["artist"], t["title"]) for t, _ in all_needed]
    new_files = download_soulseek(queries)

    # Process results
    downloaded = 0
    upgraded = 0
    still_needed = []

    for t, old_path in all_needed:
        title_lower = t["title"].lower()
        artist_lower = t["artist"].split(";")[0].lower()
        copied = False

        for f in new_files:
            if title_lower[:12] in f.lower() or (len(artist_lower) > 3 and artist_lower[:8] in f.lower()):
                src = COMPLETE_DIR / f
                if src.exists():
                    # Check that the new file is actually better
                    new_quality, new_desc = check_quality(src)
                    if old_path and new_quality > QUALITY_LOW:
                        # Upgrade: remove old, copy new as 320 MP3
                        if old_path.exists():
                            old_path.unlink()
                        dest = copy_as_320(src, folder, f)
                        upgraded += 1
                        print(f"    UPGRADED: {dest.name} ({new_desc} → 320mp3)")
                    elif not old_path:
                        # New track
                        dest = copy_as_320(src, folder, f)
                        downloaded += 1
                        print(f"    Soulseek: {dest.name}")
                    copied = True
                    break

        if not copied:
            still_needed.append((t, old_path))

    # yt-dlp fallback — only for missing tracks (not upgrades, yt-dlp is lossy)
    failed = 0
    for t, old_path in still_needed:
        if old_path:
            # Already has a file, just not HQ — skip yt-dlp (won't improve quality)
            continue

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

    return downloaded, upgraded, failed, good


def main():
    parser = argparse.ArgumentParser(description="Sync monthly archive playlists from YT Music")
    parser.add_argument("--months", nargs="*", help="Specific months to sync (e.g. 'March 26' 'Feb 26')")
    parser.add_argument("--dry", action="store_true", help="Preview only, don't download")
    parser.add_argument("--usb", default=None,
                        help="Override target folder (default: V3 PYAAR.Radio/Monthlys)")
    parser.add_argument("--flat", action="store_true",
                        help="Flat YYYY-MM (Month) layout for every year (V3 Monthlys convention)")
    args = parser.parse_args()

    if not INDEX_PATH.exists():
        print(f"Playlist index not found: {INDEX_PATH}")
        print("Run sync_playlists.py first.")
        sys.exit(1)

    if args.usb:
        target = args.usb
    else:
        target = default_target()
        if target is None:
            print("V3 not mounted/configured. Set PYAAR_V3_ROOT env var, edit "
                  "~/.config/pyaar-sync/drives.json, or pass --usb /path/to/target.")
            sys.exit(1)

    usb_base = Path(target)
    if not usb_base.exists():
        # Create the V3 Monthlys folder if it doesn't yet exist (V3 is master)
        try:
            usb_base.mkdir(parents=True, exist_ok=True)
        except Exception as e:
            print(f"Target not accessible: {usb_base} ({e})")
            sys.exit(1)

    playlists = get_archive_playlists(INDEX_PATH, args.months)
    if not playlists:
        print("No archive playlists found.")
        sys.exit(1)

    print(f"{'[DRY RUN] ' if args.dry else ''}Syncing {len(playlists)} archive playlists to {usb_base}\n")

    total_dl, total_up, total_fail, total_skip = 0, 0, 0, 0
    for p in playlists:
        print(f"{'─' * 50}")
        print(f"{p['title']} ({p['trackCount']} tracks)")
        dl, up, fail, skip = sync_playlist(p, usb_base, args.dry, flat=args.flat)
        total_dl += dl
        total_up += up
        total_fail += fail
        total_skip += skip

    print(f"\n{'═' * 50}")
    parts = [f"New: {total_dl}"]
    if total_up:
        parts.append(f"Upgraded: {total_up}")
    parts.append(f"Failed: {total_fail}")
    parts.append(f"Already HQ: {total_skip}")
    print(f"DONE — {' | '.join(parts)}")


if __name__ == "__main__":
    main()
