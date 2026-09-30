#!/usr/bin/env python3
"""
Add a curated tracklist to an EXISTING YouTube Music playlist, with verified
matching (same matcher as spotify_to_ytm.py: title-token + artist-token overlap,
rejects karaoke/cover/tribute junk). Prints unmatched lines explicitly.

Tracklist file: one song per line, `Artist - Title` (split on the first " - ").
Blank lines and lines starting with # are ignored. A trailing `  # note` on a
line is stripped (use it to record which quiz answer a song maps to).

Pinning a videoId (skips search — for songs the matcher predictably misses, e.g.
soundtrack cuts or non-Latin titles): add `vid:<id>` anywhere in the note, e.g.
  Encanto Cast - We Don't Talk About Bruno  # R4 Encanto  vid:GB6hPH1Xl-k
Recurring pins live in scripts/known_overrides.json ("artist - title" → videoId,
lowercased) so you never re-resolve the usual suspects. On a miss, the top search
candidates (with videoIds) are printed so you can pin one and rerun.

  python scripts/add_to_playlist.py <PLAYLIST_ID> tracks.txt          # add
  python scripts/add_to_playlist.py <PLAYLIST_ID> tracks.txt --dry    # preview

Auth: browser.json at the repo root. Used by the /spotify-to-ytm trivia flow to
append question-correlated songs after the Round 5 music songs.
"""
import re, sys, time, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from spotify_to_ytm import best_match, AUTH
from ytmusicapi import YTMusic

VID_RE = re.compile(r"vid:([A-Za-z0-9_-]{6,})")
OVR_PATH = Path(__file__).resolve().parent / "known_overrides.json"
OVERRIDES = json.loads(OVR_PATH.read_text()) if OVR_PATH.exists() else {}


def parse(path):
    rows = []
    for line in Path(path).read_text().splitlines():
        vid_m = VID_RE.search(line)
        vid = vid_m.group(1) if vid_m else None
        body = line.split("  #", 1)[0].strip()
        if not body or body.startswith("#") or " - " not in body:
            continue
        artist, title = body.split(" - ", 1)
        rows.append((artist.strip(), title.strip(), vid))
    return rows


def candidates(yt, artist, title, n=3):
    out = []
    for r in (yt.search(f"{title} {artist}", filter="songs", limit=n) or [])[:n]:
        a = ", ".join(x["name"] for x in r.get("artists", []))
        out.append((r["videoId"], f"{a} - {r.get('title','')}"))
    return out


def main():
    args = [a for a in sys.argv[1:] if a != "--dry"]
    dry = "--dry" in sys.argv
    if len(args) < 2:
        raise SystemExit("usage: add_to_playlist.py <PLAYLIST_ID> <tracklist_file> [--dry]")
    pid, path = args[0], args[1]
    rows = parse(path)
    if not rows:
        raise SystemExit("no 'Artist - Title' lines found")

    yt = YTMusic(str(AUTH))
    print(f"{'DRY' if dry else 'ADD'} — {len(rows)} songs → {pid}\n")
    ids, miss = [], []
    for artist, title, vid in rows:
        pin = vid or OVERRIDES.get(f"{artist} - {title}".lower())
        if pin:
            ids.append(pin)
            print(f"  ok  {artist} - {title:34.34}  →  [pinned {pin}]")
            continue
        m = best_match(yt, title, artist)
        if not m:
            miss.append((artist, title))
            print(f"  ??  {artist} - {title}  → NO MATCH")
            for vid_c, label in candidates(yt, artist, title):
                print(f"        cand {vid_c}  {label}")
        else:
            got = f"{', '.join(a['name'] for a in m.get('artists', []))} - {m.get('title')}"
            ids.append(m["videoId"])
            print(f"  ok  {artist} - {title:34.34}  →  {got}")
        time.sleep(0.3)
    print(f"\nmatched {len(ids)}/{len(rows)} | misses {len(miss)}")
    for artist, title in miss:
        print(f"    MISS: {artist} - {title}  (pin a `vid:` from a cand above, or add to known_overrides.json)")
    if dry or not ids:
        return
    yt.add_playlist_items(pid, ids, duplicates=True)
    print(f"\n✓ added {len(ids)} songs")


if __name__ == "__main__":
    main()
