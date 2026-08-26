#!/usr/bin/env python3
"""
Like a list of songs on YouTube Music (Pyaar Radio brand account).

Feed it a tracklist — one song per line, either tab-separated `artist<TAB>title`
or `Artist - Title`. Reads a file arg or stdin. Searches YTM, verifies the match
(title + at least one artist token) so nothing wrong gets liked, then rate LIKE.
Idempotent. Reports matched / liked / no-confident-match.

  python scripts/like_tracklist.py tracks.txt          # like them
  python scripts/like_tracklist.py tracks.txt --dry     # preview matches only
  cat tracks.txt | python scripts/like_tracklist.py -   # stdin

Auth: browser.json (same as the sync scripts). Liking needs no Premium.
"""
import re, sys
from pathlib import Path
from ytmusicapi import YTMusic

AUTH = Path(__file__).resolve().parents[1] / "browser.json"


def tight(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def tokens(s):
    return [t for t in re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split() if len(t) > 2]


def parse_line(line):
    line = line.strip()
    if not line or line.lower().startswith(("tracklist", "http")):
        return None
    line = re.sub(r"^\s*\d+[\.\)]\s*", "", line)  # strip leading "1." / "1)"
    if "\t" in line:
        a, t = line.split("\t", 1)
    elif " - " in line:
        a, t = line.split(" - ", 1)
    elif " – " in line:  # en-dash
        a, t = line.split(" – ", 1)
    else:
        return None
    return a.strip(), t.strip()


def best_match(yt, artist, title):
    res = yt.search(f"{artist} {title}", filter="songs", limit=6)
    tt, atoks = tight(title), tokens(artist)
    for r in res:
        rt = tight(r.get("title"))
        ra = tight(" ".join(a["name"] for a in r.get("artists", [])))
        title_ok = tt in rt or rt in tt
        artist_ok = any(tok in ra for tok in atoks) if atoks else True
        if title_ok and artist_ok:
            return r
    return None


def main():
    args = [a for a in sys.argv[1:] if a != "--dry"]
    dry = "--dry" in sys.argv
    src = sys.stdin if (not args or args[0] == "-") else open(args[0])
    pairs = [p for p in (parse_line(l) for l in src) if p]
    if not pairs:
        print("no parseable 'Artist - Title' lines found"); return

    yt = YTMusic(str(AUTH))
    acct = yt.get_account_info().get("accountName", "?")
    print(f"account: {acct} | {len(pairs)} tracks | {'DRY RUN' if dry else 'LIKING'}\n")
    liked = miss = 0
    for artist, title in pairs:
        m = best_match(yt, artist, title)
        if not m:
            miss += 1
            print(f"  ??  {artist} - {title}  → NO CONFIDENT MATCH")
            continue
        got = f"{', '.join(a['name'] for a in m.get('artists', []))} - {m.get('title')}"
        if dry:
            print(f"  ok  {artist} - {title}  →  {got}")
        else:
            yt.rate_song(m["videoId"], "LIKE")
            liked += 1
            print(f"  ♥   {got}")
    print(f"\n{'would like' if dry else 'liked'}: {len(pairs)-miss} | no match: {miss}")


if __name__ == "__main__":
    main()
