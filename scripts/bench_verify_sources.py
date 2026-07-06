"""Benchmark verify sources: Discogs vs MusicBrainz vs Deezer.

Accuracy = recall against KNOWN-REAL albums (the user's own saved library, so
every one is a genuine release the source *should* find). Speed = wall time per
artist catalog lookup. Also reports how each source does on the hard niche/new
set (the alerts that came back 'unconfirmed'), as a coverage signal.

    .venv/bin/python scripts/bench_verify_sources.py
"""

import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from radar.verify import (
    normalize_loose,
    discogs_album_titles,
    mb_find_artist_mbid, mb_release_group_titles,
    deezer_album_titles,
)

PROJECT = Path(__file__).resolve().parent.parent
INDEX = PROJECT / "albums" / "_index.json"


def mb_titles(artist):
    mbid = mb_find_artist_mbid(artist)
    return mb_release_group_titles(mbid) if mbid else None


SOURCES = {
    "discogs": discogs_album_titles,
    "musicbrainz": mb_titles,
    "deezer": deezer_album_titles,
}

# Hard set — real but niche/new albums that came back 'unconfirmed' on Discogs+MB.
HARD = [
    ("The Alchemist", "Solitude"), ("Dave", "The Boy Who Played the Harp"),
    ("esta.", "IDEAS 001"), ("Clever Austin", "Hour Sessions"),
    ("Karsh Kale", "Dust"), ("Diplo", "d00mscrvll"),
    ("Cochise", "TRENCH TOWN"), ("Shafiq Husayn", "Au"),
    ("Buddy", "Another Moon"), ("Kamaal Williams", "Last Night In Paris"),
]


def sample_known_real(n=25):
    """Distinct-artist sample of the user's saved albums (all genuine releases)."""
    albums = json.load(open(INDEX))["albums"]
    seen, out = set(), []
    # stride through the list for a spread across the library, not just the head
    step = max(1, len(albums) // (n * 3))
    for a in albums[::step]:
        art, title = a.get("artist", ""), a.get("title", "")
        if art and title and art.lower() not in seen:
            seen.add(art.lower())
            out.append((art, title))
        if len(out) >= n:
            break
    return out


def run(label, pairs):
    print(f"\n{'='*66}\n{label}  (n={len(pairs)})\n{'='*66}")
    print(f"{'source':<13} {'found':>7} {'recall':>8} {'artist!found':>13} {'avg s/lookup':>13} {'total s':>9}")
    print("-" * 66)
    results = {}
    for name, fn in SOURCES.items():
        hits = artist_miss = 0
        t_total = 0.0
        for artist, title in pairs:
            t0 = time.time()
            titles = fn(artist)
            t_total += time.time() - t0
            if titles is None:
                artist_miss += 1
                continue
            if normalize_loose(title) in titles:
                hits += 1
            # pace to each source's polite rate limit
            time.sleep({"discogs": 2.5, "musicbrainz": 1.1, "deezer": 0.3}[name])
        recall = hits / len(pairs) * 100
        avg = t_total / len(pairs)
        results[name] = (hits, recall, avg, t_total)
        print(f"{name:<13} {hits:>7} {recall:>7.0f}% {artist_miss:>13} {avg:>12.2f}s {t_total:>8.1f}s")
    return results


if __name__ == "__main__":
    known = sample_known_real(25)
    r_known = run("KNOWN-REAL (saved library — accuracy)", known)
    r_hard = run("HARD (niche/new — coverage)", HARD)

    print(f"\n{'='*66}\nVERDICT\n{'='*66}")
    for name in SOURCES:
        kh, kr, ka, _ = r_known[name]
        hh, hr, ha, _ = r_hard[name]
        print(f"  {name:<12} accuracy {kr:>3.0f}%  |  hard-coverage {hr:>3.0f}%  |  {(ka+ha)/2:.2f}s/lookup avg")
