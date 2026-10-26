#!/usr/bin/env python3
"""Sync a YT Music playlist into an arbitrary Lexar folder (setlist/crate).

Unlike sync_usb.py (month/year archive layout) this targets a plain folder and
names files "Artist - Title.mp3" with no numbering, matching the setlist
convention. Always additive: existing tracks are kept, only missing ones are
fetched. Downloads are MP3 (--audio-quality 0) via yt-dlp with a cookies file,
since plain yt-dlp is now 403'd by YouTube.

Usage:
  sync_folder.py <playlistId> "<target folder>" [--cookies PATH] [--dry]

Tracklist source: the repo snapshot public/playlists/<id>.json when present,
otherwise a live yt-dlp --flat-playlist fetch.
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

PROJECT_DIR = Path(__file__).resolve().parent.parent
SNAP_DIR = PROJECT_DIR / "public" / "playlists"
DEFAULT_COOKIES = Path.home() / ".config" / "pyaar-radio" / "yt-cookies.txt"
AUDIO_EXT = (".mp3", ".m4a", ".flac", ".wav", ".aiff", ".aif")


def norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def strip_topic(name):
    return re.sub(r"\s*-\s*Topic$", "", name or "").strip()


def get_tracks(playlist_id):
    """Return [(artist, title, videoId)] from snapshot or live fetch."""
    snap = SNAP_DIR / f"{playlist_id}.json"
    if snap.exists():
        d = json.load(open(snap))
        return [(t.get("artist", ""), t.get("title", ""), t.get("videoId", ""))
                for t in d.get("tracks", []) if t.get("videoId")]
    out = subprocess.run(
        ["yt-dlp", "--flat-playlist", "--no-warnings", "--print",
         "%(title)s\t%(id)s\t%(uploader)s",
         f"https://music.youtube.com/playlist?list={playlist_id}"],
        capture_output=True, text=True, timeout=180).stdout
    tracks = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) >= 2 and parts[1]:
            title, vid = parts[0], parts[1]
            artist = strip_topic(parts[2]) if len(parts) > 2 else ""
            tracks.append((artist, title, vid))
    if tracks:
        return tracks
    # Private / self-created playlist: yt-dlp can't list it. Fall back to
    # ytmusicapi with the repo's browser.json auth (the videos are still public).
    try:
        from ytmusicapi import YTMusic
        pl = YTMusic(str(PROJECT_DIR / "browser.json")).get_playlist(playlist_id, limit=None)
        return [(", ".join(a["name"] for a in t.get("artists", []) if a.get("name")),
                 t.get("title", ""), t.get("videoId"))
                for t in pl["tracks"] if t.get("videoId")]
    except Exception:
        return tracks


def existing_norm_stems(folder):
    stems = []
    for p in folder.rglob("*"):
        if p.suffix.lower() in AUDIO_EXT and not p.name.startswith("._"):
            stems.append(norm(p.stem))
    return stems


def already_present(title, stems):
    nt = norm(title)
    return bool(nt) and any(nt in s for s in stems)


def download(video_id, name, folder, cookies):
    safe = name.replace("/", "-").replace("$", "S")[:120]
    dest = folder / f"{safe}.mp3"
    if dest.exists():
        return True
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, f"{safe}.mp3")
        # Plain yt-dlp works when the binary is current; cookies are only a
        # fallback for throttling, added when the file exists.
        cmd = ["yt-dlp", "-x", "--audio-format", "mp3", "--audio-quality", "0", "--no-warnings"]
        if cookies and Path(cookies).exists():
            cmd += ["--cookies", str(cookies)]
        cmd += ["-o", out, f"https://music.youtube.com/watch?v={video_id}"]
        try:
            subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        except (subprocess.TimeoutExpired, OSError):
            return False
        if os.path.exists(out):
            shutil.copy2(out, dest)
            return True
    return False


MANIFEST_DIR = PROJECT_DIR / "scripts" / "sync-manifests"


def load_manifest(pid):
    f = MANIFEST_DIR / f"{pid}.json"
    return json.load(open(f)) if f.exists() else {}


def save_manifest(pid, m):
    MANIFEST_DIR.mkdir(parents=True, exist_ok=True)
    json.dump(m, open(MANIFEST_DIR / f"{pid}.json", "w"), ensure_ascii=False, indent=0)


def seed_manifest(tracks, folder, manifest):
    """Map each playlist videoId to an existing file (by title + artist), so a
    later removal of that videoId knows which file to prune. Only fills gaps."""
    files = [(norm(p.stem), str(p.relative_to(folder)))
             for p in folder.rglob("*")
             if p.suffix.lower() in AUDIO_EXT and not p.name.startswith("._")]
    have = set(manifest.values())
    n = 0
    for a, t, v in tracks:
        if v in manifest:
            continue
        nt, na = norm(t), norm(a)
        if not nt:
            continue
        for st, rel in files:
            if rel in have:
                continue
            if nt in st and (not na or na in st):
                manifest[v] = rel
                have.add(rel)
                n += 1
                break
    return n


def prune_manifest(manifest, playlist_vids, folder, dry):
    """Delete files whose videoId is no longer in the playlist (YTM = truth)."""
    pruned = 0
    for v in list(manifest):
        if v in playlist_vids:
            continue
        rel = manifest.pop(v)
        p = folder / rel
        if p.exists():
            print(f"    PRUNE (left playlist): {rel}")
            if not dry:
                try:
                    p.unlink()
                except OSError:
                    pass
        pruned += 1
    return pruned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("playlist_id")
    ap.add_argument("folder")
    ap.add_argument("--cookies", default=str(DEFAULT_COOKIES))
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--force", action="store_true",
                    help="download even if the folder looks filled under different naming")
    ap.add_argument("--mirror", action="store_true",
                    help="YTM playlist is source of truth: seed a videoId->file manifest "
                         "and prune local files whose videoId left the playlist")
    ap.add_argument("--no-download", action="store_true",
                    help="skip the add/download step (seed + prune only)")
    args = ap.parse_args()

    folder = Path(args.folder)
    folder.mkdir(parents=True, exist_ok=True)
    tracks = get_tracks(args.playlist_id)
    stems = existing_norm_stems(folder)
    print(f"  playlist {args.playlist_id}: {len(tracks)} tracks | folder has {len(stems)} audio files")

    if args.mirror:
        manifest = load_manifest(args.playlist_id)
        seeded = seed_manifest(tracks, folder, manifest)
        pruned = prune_manifest(manifest, {v for _, _, v in tracks}, folder, args.dry)
        if not args.dry:
            save_manifest(args.playlist_id, manifest)
        print(f"  mirror: manifest={len(manifest)} | seeded={seeded} | pruned={pruned}")
        stems = existing_norm_stems(folder)
    if args.no_download:
        return

    missing = [(a, t, v) for (a, t, v) in tracks if not already_present(t, stems)]
    print(f"  {len(missing)} missing")
    if args.dry:
        for a, t, v in missing:
            print(f"    - {a} - {t}")
        return

    # Safety: if the folder is already full yet a big fraction of the playlist
    # doesn't match by name, it was filled by another pipeline with different
    # filenames — downloading would just spam duplicates. Skip unless --force.
    if (not args.force and tracks and len(stems) >= 0.8 * len(tracks)
            and len(missing) > 0.3 * len(tracks)):
        print(f"  SKIP: folder has {len(stems)} files but {len(missing)}/{len(tracks)} "
              f"don't match by name — likely different naming. Use --force to override.")
        return

    ok = fail = 0
    for a, t, v in missing:
        name = f"{a} - {t}" if a else t
        print(f"    yt-dlp: {name} ...", end=" ", flush=True)
        if download(v, name, folder, args.cookies):
            ok += 1
            print("OK")
            if args.mirror:                      # record so a later removal can prune it
                manifest[v] = name.replace("/", "-").replace("$", "S")[:120] + ".mp3"
        else:
            fail += 1
            print("FAIL")
    if args.mirror:
        save_manifest(args.playlist_id, manifest)
    print(f"  DONE — downloaded {ok}, failed {fail}")
    sys.exit(1 if fail else 0)


if __name__ == "__main__":
    main()
