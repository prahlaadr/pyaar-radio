#!/usr/bin/env python3
"""Producer discography → folder sync (Part 4 pilot).

Resolve a producer's discography (YT Music artist page + Discogs + MusicBrainz),
expand each release to its tracks, diff against In Focus/Producers/<NAME>/,
report what's missing, and optionally download the gaps (yt-dlp MP3 320).

Dry by default. Implements the design in docs/playlist-folder-sync.md (Part 4).

Usage:
    .venv/bin/python scripts/sync_producer.py "Anish Kumar"             # dry report
    .venv/bin/python scripts/sync_producer.py "Anish Kumar" --download  # fill gaps
    .venv/bin/python scripts/sync_producer.py "Anish Kumar" --include-non-official

Reuses the discovery half of scripts/in_focus_audit.py and the downloader
from sync_usb.py — this script is mostly glue + album→track expansion + diff.
"""
import argparse
import sys
import time
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_DIR))
sys.path.insert(0, str(PROJECT_DIR / "scripts"))

from ytmusicapi import YTMusic

from in_focus_audit import (  # noqa: E402
    BROWSER_AUTH, DISCOGS_SLEEP, MB_SLEEP, YT_SLEEP,
    discogs_albums, mb_find_artist_mbid, mb_release_groups,
    yt_resolve_album, yt_artist_page_albums,
    normalize, is_official, _producers_dir,
)
from sync_usb import download_ytdlp  # noqa: E402

AUDIO_EXT = (".mp3", ".flac", ".opus", ".m4a", ".wav", ".aiff", ".aif")


def find_producer_folder(producers_root, artist):
    """Case-insensitively resolve the on-disk folder for a producer."""
    if producers_root is None or not producers_root.exists():
        return None
    target = normalize(artist)
    for d in producers_root.iterdir():
        if d.is_dir() and normalize(d.name) == target:
            return d
    return None


def folder_track_titles(folder):
    """Normalized track titles already in the producer's folder."""
    titles = set()
    if folder is None:
        return titles
    for f in folder.iterdir():
        if f.name.startswith("._") or f.suffix.lower() not in AUDIO_EXT:
            continue
        stem = f.stem
        title = stem.split(" - ", 1)[1] if " - " in stem else stem
        n = normalize(title)
        if n:
            titles.add(n)
    return titles


def resolve_releases(yt, artist):
    """Gather all album/EP/single browseIds across sources. Returns (dict, canonical)."""
    releases = {}  # browseId -> {title, year, origin}

    # Source 1: YT Music artist page (most complete single source for YT-native acts)
    for a in yt_artist_page_albums(yt, artist):
        releases.setdefault(a["browseId"], {"title": a["title"], "year": a.get("year", ""), "origin": "yt_page"})

    # Source 2: Discogs masters
    discogs, canonical = discogs_albums(artist)
    time.sleep(DISCOGS_SLEEP)
    for d in discogs:
        m = yt_resolve_album(yt, artist, d["title"])
        time.sleep(YT_SLEEP)
        if m and m["browseId"] not in releases:
            releases[m["browseId"]] = {"title": m["title"], "year": m.get("year", "") or d.get("year", ""), "origin": "discogs"}

    # Source 3: MusicBrainz release-groups (EP-heavy coverage)
    mbid, _ = mb_find_artist_mbid(artist)
    time.sleep(MB_SLEEP)
    if mbid:
        for rg in mb_release_groups(mbid):
            if rg.get("type") not in ("Album", "EP"):
                continue
            m = yt_resolve_album(yt, artist, rg["title"])
            time.sleep(YT_SLEEP)
            if m and m["browseId"] not in releases:
                releases[m["browseId"]] = {"title": m["title"], "year": m.get("year", "") or (rg.get("date") or "")[:4], "origin": "mb"}

    return releases, canonical


def album_tracks(yt, browse_id):
    """Expand an album browseId to [{title, videoId}]."""
    try:
        a = yt.get_album(browse_id)
    except Exception:
        return []
    out = []
    for t in a.get("tracks", []):
        if t.get("title"):
            out.append({"title": t["title"], "videoId": t.get("videoId")})
    return out


def is_present(norm_title, have):
    """True if this normalized track title is already in the folder set."""
    if norm_title in have:
        return True
    # containment fallback, guarded by length to avoid short-title false matches
    return any(
        (norm_title in h or h in norm_title)
        for h in have
        if min(len(h), len(norm_title)) >= 8
    )


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("artist", help="Producer name, e.g. 'Anish Kumar'")
    ap.add_argument("--download", action="store_true", help="Download missing tracks (default: dry report)")
    ap.add_argument("--include-non-official", action="store_true",
                    help="Include live/remix/comp releases (default: official only)")
    args = ap.parse_args()

    if not BROWSER_AUTH.exists():
        print(f"ERROR: {BROWSER_AUTH} missing — refresh per CLAUDE.md 'Refreshing auth'")
        sys.exit(1)

    yt = YTMusic(str(BROWSER_AUTH))

    print(f"Resolving discography for {args.artist} (YT page → Discogs → MusicBrainz)...")
    releases, canonical = resolve_releases(yt, args.artist)
    print(f"  {len(releases)} releases found (canonical: {canonical or '—'})")

    # Expand releases → unique tracks
    disco = {}  # norm_title -> {title, videoId, album}
    for bid, meta in releases.items():
        if not args.include_non_official and not is_official(meta["title"]):
            print(f"  · skip non-official release: {meta['title']}")
            continue
        for t in album_tracks(yt, bid):
            k = normalize(t["title"])
            if k and k not in disco:
                disco[k] = {"title": t["title"], "videoId": t.get("videoId"), "album": meta["title"]}
        time.sleep(YT_SLEEP)

    # Folder state
    producers_root = _producers_dir()
    folder = find_producer_folder(producers_root, args.artist)
    have = folder_track_titles(folder)

    # Diff
    present = [info for k, info in disco.items() if is_present(k, have)]
    missing = [info for k, info in disco.items() if not is_present(k, have)]

    print()
    print("=" * 60)
    print(f"  {args.artist}")
    print("=" * 60)
    print(f"  folder:            {folder if folder else 'NOT FOUND'}")
    print(f"  files in folder:   {len(have)}")
    print(f"  discography tracks:{len(disco)}")
    print(f"  present:           {len(present)}")
    print(f"  MISSING:           {len(missing)}")

    if missing:
        print("\n  Missing tracks:")
        for m in sorted(missing, key=lambda x: (x["album"], x["title"])):
            flag = "" if m["videoId"] else "   (no videoId — can't auto-download)"
            print(f"    - {m['title']}  [{m['album']}]{flag}")

    if missing and args.download:
        if folder is None:
            folder = producers_root / args.artist
        folder.mkdir(parents=True, exist_ok=True)
        print(f"\n  Downloading {len(missing)} missing → {folder}")
        ok = fail = 0
        for m in missing:
            if not m["videoId"]:
                fail += 1
                print(f"    SKIP (no videoId): {m['title']}")
                continue
            name = f"{canonical or args.artist} - {m['title']}"
            print(f"    yt-dlp: {name}...", end=" ", flush=True)
            if download_ytdlp(m["videoId"], name, folder):
                ok += 1
                print("OK")
            else:
                fail += 1
                print("FAIL")
        print(f"\n  DONE — downloaded {ok}, failed {fail}")
    elif missing:
        print(f"\n  (dry run — re-run with --download to fetch the {len(missing)} missing tracks)")
    else:
        print("\n  ✓ Folder is complete against the resolved discography.")


if __name__ == "__main__":
    main()
