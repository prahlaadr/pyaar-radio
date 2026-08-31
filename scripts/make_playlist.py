#!/usr/bin/env python3
"""Create a YouTube Music playlist from a tracklist and add matched songs.

Feed a playlist name and a file of "Song - Movie" (or "Song — Movie") lines.
Searches YTM per line ("Song Movie"), matches on title, and builds the playlist.
For film songs the movie sharpens the query but is not verified against the
artist field (which holds the singer, not the film).

  python scripts/make_playlist.py "bolly disco" tracks.txt --dry   # preview matches
  python scripts/make_playlist.py "bolly disco" tracks.txt          # create + add

Auth: browser.json (Pyaar Radio account). No Premium needed.
"""
import re
import sys
import time
from pathlib import Path
from ytmusicapi import YTMusic

AUTH = Path(__file__).resolve().parents[1] / "browser.json"


def tight(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def toks(s):
    return [t for t in re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split() if len(t) > 2]


def parse(line):
    line = line.strip()
    if not line or line.lower().startswith("http"):
        return None
    line = re.sub(r"^\s*\d+[\.\)]\s*", "", line)  # strip "1." / "1)"
    for sep in (" — ", " – ", " - "):
        if sep in line:
            song, movie = line.split(sep, 1)
            return song.strip(), movie.strip()
    return line.strip(), ""  # song only


# Classic-era playback singers — when a title is ambiguous (e.g. an old song
# that also has a modern remake), prefer the original by one of these voices.
CLASSIC = {
    "asha bhosle", "kishore kumar", "mohammed rafi", "lata mangeshkar",
    "r.d. burman", "rd burman", "r. d. burman", "usha uthup", "bappi lahiri",
    "usha mangeshkar", "geeta dutt", "kanchan", "amit kumar", "nazia hassan",
    "alisha chinai", "parvati khan", "vijay benedict", "kavita krishnamurthy",
}


def is_classic(r):
    names = {a.get("name", "").lower() for a in r.get("artists", [])}
    return bool(names & CLASSIC)


# Re-record / remix markers — a pure original is preferred over these.
REMIX = ("revival", "jhankar", "remix", "cover", "lofi", "lo-fi", "reprise",
         "remaster", "new version", "unplugged", "2.0")


def penalty(r):
    t = (r.get("title") or "").lower()
    return 1 if any(w in t for w in REMIX) else 0


def title_match(song, r):
    """Strict enough to exclude wrong songs sharing one common word (e.g. 'dil')."""
    st, stoks = tight(song), toks(song)
    rt, rtoks = tight(r.get("title")), toks(r.get("title"))
    if st and (st in rt or rt in st):
        return True
    if not stoks:
        return False
    overlap = sum(t in rtoks for t in stoks)
    need = 2 if len(stoks) >= 2 else 1
    return overlap >= need


def find(yt, song, movie):
    """Title match, preferring the pure original by a classic-era singer."""
    res = yt.search(f"{song} {movie}".strip(), filter="songs", limit=6)
    if not res:
        return None, False
    matches = [r for r in res if r.get("videoId") and title_match(song, r)]
    if not matches:
        return res[0], False
    # stable-sort keeps YTM relevance order; classic + non-remix float to top
    matches.sort(key=lambda r: (is_classic(r), -penalty(r)), reverse=True)
    return matches[0], True


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: make_playlist.py <name> <tracklist> [--dry]")
    name, path = sys.argv[1], sys.argv[2]
    dry = "--dry" in sys.argv[3:]
    lines = [p for p in (parse(l) for l in Path(path).read_text().splitlines()) if p]

    yt = YTMusic(str(AUTH))
    vids, loose, missing = [], [], []
    for song, movie in lines:
        r, ok = find(yt, song, movie)
        if not r or not r.get("videoId"):
            missing.append(f"{song} — {movie}")
            print(f"  MISS  {song} — {movie}")
            continue
        artists = ", ".join(a["name"] for a in r.get("artists", []) if a.get("name"))
        tag = "OK  " if ok else "LOOSE"
        vids.append(r["videoId"])
        if not ok:
            loose.append(f"{song} — {movie}  =>  {r.get('title')} · {artists}")
        print(f"  {tag}  {song} — {movie}  =>  {r.get('title')} · {artists}")

    print(f"\n  matched {len(vids)}/{len(lines)} | loose {len(loose)} | missing {len(missing)}")
    if dry:
        print("  (dry run — no playlist created)")
        return

    pid = yt.create_playlist(name, "Built from a screenshot tracklist via Pyaar Radio.",
                             privacy_status="PRIVATE", video_ids=vids[:1])
    if isinstance(pid, dict):
        pid = pid.get("id") or pid.get("playlistId")
    # A freshly created playlist needs a beat to propagate — adding items
    # immediately can silently drop the whole batch. Wait, add, then verify and
    # gap-fill if the count came up short.
    time.sleep(2)
    for i in range(1, len(vids), 100):
        yt.add_playlist_items(pid, vids[i:i + 100], duplicates=True)
    time.sleep(2)
    got = yt.get_playlist(pid, limit=None).get("trackCount", 0)
    if got < len(vids):
        yt.add_playlist_items(pid, vids, duplicates=False)  # fill whatever didn't stick
        got = yt.get_playlist(pid, limit=None).get("trackCount", 0)
    print(f"  created '{name}' ({pid}) — {got}/{len(vids)} tracks")
    if loose:
        print("\n  REVIEW (loose matches):")
        for x in loose:
            print("   -", x)


if __name__ == "__main__":
    main()
