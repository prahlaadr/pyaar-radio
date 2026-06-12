#!/usr/bin/env python3
"""
Backfill a genre tag (into the `vibes` column) for artists that have NO vibes yet,
seeding from pillar_v2 + zone. Makes the genre-first filter cover the whole library
(otherwise ~51% of artists are unfilterable by genre).

Only touches artists with an EMPTY vibes column — never overwrites existing tags.

  python3 scripts/backfill_genre.py          # dry run
  python3 scripts/backfill_genre.py --apply
"""
import csv, os, sys
from collections import Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(REPO, "public/data/artists.csv")

# (pillar, zone) -> genre. zone "" is the pillar default.
GENRE_MAP = {
    ("Soullaad", "ambient"): "Ambient",
    ("Soullaad", "soul"):    "Soul",
    ("Soullaad", "beats"):   "Future Beats",
    ("Soullaad", ""):        "Soul",
    ("Hypelaad", ""):        "Club",
    ("Perclaad", ""):        "Afro",
    ("Rowdylaad", "dub"):     "Dub",
    ("Rowdylaad", "dnb"):     "DnB",
    ("Rowdylaad", "rave"):    "Rave",
    ("Rowdylaad", "leftfield"): "Bass",
    ("Rowdylaad", "support"): "Bass",
    ("Rowdylaad", ""):        "Bass",
    ("Crowdlaad", ""):       "Pop",
    ("Traplaad", ""):        "Trap",
}

def genre_for(pillar, zone):
    return GENRE_MAP.get((pillar, zone)) or GENRE_MAP.get((pillar, "")) or "Soul"

def main():
    apply = "--apply" in sys.argv
    rows = list(csv.DictReader(open(CSV)))
    fields = list(rows[0].keys())
    tagged = 0
    dist = Counter()
    for r in rows:
        if (r["vibes"] or "").strip():
            continue  # already has tags — leave alone
        pillar = (r["pillar_v2"] or "").split("|")[0].strip()
        zone = (r["zone"] or "").strip()
        g = genre_for(pillar, zone)
        r["vibes"] = g
        tagged += 1
        dist[g] += 1

    print(f"artists with empty vibes -> tagged: {tagged}")
    for g, c in dist.most_common():
        print(f"  {c:4d}  {g}")
    if not apply:
        print("\n(dry run — pass --apply)")
        return
    with open(CSV, "w", newline="") as f:  # csv default CRLF
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows)
    no_vibes = sum(1 for r in rows if not (r["vibes"] or "").strip())
    print(f"\nApplied. Artists still without any vibes: {no_vibes}")

if __name__ == "__main__":
    main()
