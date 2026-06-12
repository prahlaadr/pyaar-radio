#!/usr/bin/env python3
"""
Import "gap" tracks — songs by curated artists that live in a saved playlist but
are NOT in masterlist.csv — so they surface on each artist's page.

Matches the audit (scripts/audit_artist_coverage.py): exact normalized token,
accent-folded. One row per unique Video ID (a collab row shows on every matched
artist's page automatically via the app's artist-name join).

Row convention: Source="Playlist", Tags=<playlist title>, Liked="No", Playlist Count=1.
APPENDS to masterlist.csv (CRLF) — existing rows untouched.

  .venv/bin/python scripts/import_playlist_gap.py            # dry run (counts)
  .venv/bin/python scripts/import_playlist_gap.py --apply
"""
import csv, json, glob, os, re, sys, unicodedata
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(REPO, "public/data/artists.csv")
MASTER = os.path.join(REPO, "public/data/masterlist.csv")
PLAYLISTS = sorted(glob.glob(os.path.join(REPO, "public/playlists/PL*.json")))

def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())

SUB = re.compile(r"\s*(?:;|,|&|/|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b|×)\s*", re.I)

def tokens(a):
    out = set()
    for prim in (a or "").split(";"):
        prim = prim.strip()
        if not prim:
            continue
        out.add(norm(prim))
        for sub in SUB.split(prim):
            if sub.strip():
                out.add(norm(sub))
    out.discard("")
    return out

def main():
    apply = "--apply" in sys.argv

    # curated artist tokens
    known = set()
    for r in csv.DictReader(open(ART)):
        for nm in [r["artist"]] + [a for a in (r["aliases"] or "").split("|")
                                   if a.strip() and not a.startswith("~")]:
            if norm(nm):
                known.add(norm(nm))

    # masterlist header + existing video ids
    with open(MASTER, newline="") as f:
        header = next(csv.reader(f))
    master_vids = set()
    with open(MASTER, newline="") as f:
        rd = csv.DictReader(f)
        for row in rd:
            master_vids.add(row.get("Video ID") or "")

    # scan playlists -> unique gap rows (first playlist seen wins for Tags)
    gap = {}   # videoId -> dict(title, artist, album, playlist)
    for pf in PLAYLISTS:
        try:
            d = json.load(open(pf))
        except Exception:
            continue
        ptitle = (d.get("title") or "").strip()
        for tr in d.get("tracks", []):
            vid = (tr.get("videoId") or "").strip()
            if not vid or vid in master_vids or vid in gap:
                continue
            if tokens(tr.get("artist")) & known:
                gap[vid] = {"title": tr.get("title", ""), "artist": tr.get("artist", ""),
                            "album": tr.get("album", ""), "playlist": ptitle}

    print(f"curated artist tokens: {len(known)}")
    print(f"masterlist videos:     {len(master_vids)}")
    print(f"playlists scanned:     {len(PLAYLISTS)}")
    print(f"unique gap tracks to import: {len(gap)}")
    if not apply:
        print("\n(dry run — pass --apply to append to masterlist.csv)")
        for v, g in list(gap.items())[:8]:
            print(f"  {g['artist'][:32]:32s} | {g['title'][:36]:36s} | {g['playlist'][:20]}")
        return

    # build rows aligned to header, append (preserve existing bytes)
    col = {name: i for i, name in enumerate(header)}
    newrows = []
    for vid, g in gap.items():
        row = [""] * len(header)
        row[col["Track Name"]] = g["title"]
        row[col["Artist Name(s)"]] = g["artist"]
        row[col["Album Name"]] = g["album"]
        row[col["Video ID"]] = vid
        row[col["Liked"]] = "No"
        row[col["Source"]] = "Playlist"
        row[col["Tags"]] = g["playlist"]
        row[col["Playlist Count"]] = "1"
        newrows.append(row)

    # ensure file ends with newline, then append CRLF rows
    with open(MASTER, "rb") as f:
        f.seek(-2, os.SEEK_END)
        tail = f.read()
    with open(MASTER, "a", newline="") as f:
        if not tail.endswith(b"\r\n"):
            f.write("\r\n")
        w = csv.writer(f, lineterminator="\r\n")
        w.writerows(newrows)
    print(f"appended {len(newrows)} rows -> masterlist.csv")

if __name__ == "__main__":
    main()
