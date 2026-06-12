#!/usr/bin/env python3
"""Add the R&B / Rap / Indie / Electronic candidate batch to artists.csv with
explicit pillar_v2 + genre tags. (Pop/crowd + Indian buckets intentionally skipped.)
  .venv/bin/python scripts/add_candidate_batch.py [--apply]
"""
import csv, os, re, sys, unicodedata

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(REPO, "public/data/artists.csv")

def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())

# (artist, pillar_v2, vibes, desi)
ADDS = [
    # R&B / Soul -> Soullaad
    ("Brent Faiyaz", "Soullaad", "Soul", False),
    ("Alina Baraz", "Soullaad", "Soul", False),
    ("Ty Dolla $ign", "Soullaad", "Soul|Trap", False),
    ("Roy Woods", "Soullaad", "Soul", False),
    ("Sade", "Soullaad", "Soul", False),
    ("Majid Jordan", "Soullaad", "Soul", False),
    ("SiR", "Soullaad", "Soul", False),
    ("Tinashe", "Soullaad", "Soul", False),
    ("Faye Webster", "Soullaad", "Soul|Indie", False),
    # Indie / Alt -> Soullaad, genre Indie
    ("Vampire Weekend", "Soullaad", "Indie", False),
    ("Crumb", "Soullaad", "Indie", False),
    ("Arctic Monkeys", "Soullaad", "Indie", False),
    ("alt-J", "Soullaad", "Indie|Electronica", False),
    ("Unknown Mortal Orchestra", "Soullaad", "Indie", False),
    ("Beach House", "Soullaad", "Indie", False),
    ("Laufey", "Soullaad", "Soul|Indie", False),
    ("Dominic Fike", "Soullaad", "Indie", False),
    ("Still Woozy", "Soullaad", "Indie", False),
    ("The Smile", "Soullaad", "Indie", False),
    ("Mitski", "Soullaad", "Indie", False),
    ("Alabama Shakes", "Soullaad", "Soul|Indie", False),
    ("Young the Giant", "Soullaad", "Indie", False),
    ("of Montreal", "Soullaad", "Indie", False),
    ("Radiohead", "Soullaad", "Indie", False),
    ("WILLOW", "Soullaad", "Indie", False),
    # Rap -> Traplaad
    ("Baby Keem", "Traplaad", "Trap", False),
    ("LUCKI", "Traplaad", "Trap", False),
    ("Abhi The Nomad", "Traplaad", "Trap|Boom Bap", True),
    ("Cousin Stizz", "Traplaad", "Trap", False),
    ("Xavier Wulf", "Traplaad", "Trap", False),
    ("Tony Seltzer", "Traplaad", "Trap", False),
    ("Earl Sweatshirt", "Traplaad", "Boom Bap", False),
    ("Veeze", "Traplaad", "Trap", False),
    ("Rae Sremmurd", "Traplaad", "Trap", False),
    # Electronic -> Hypelaad
    ("Mura Masa", "Hypelaad", "Electronica|Club", False),
    ("Arca", "Hypelaad", "Electronica", False),
    ("Ratatat", "Hypelaad", "Electronica", False),
]

def main():
    apply = "--apply" in sys.argv
    rows = list(csv.DictReader(open(CSV)))
    fields = list(rows[0].keys())
    have = set()
    for r in rows:
        have.add(norm(r["artist"]))
        for a in (r["aliases"] or "").split("|"):
            if a.strip():
                have.add(norm(a))

    new = []
    for name, pillar, vibes, desi in ADDS:
        if norm(name) in have:
            print(f"  = already present: {name}")
            continue
        row = {f: "" for f in fields}
        row["artist"] = name
        row["pillar_v2"] = pillar
        row["pillar"] = pillar
        row["vibes"] = vibes
        row["desi_bool"] = "true" if desi else "false"
        row["desi"] = "Desi" if desi else "Non-Desi"
        new.append(row)
        print(f"  + {name:26s} {pillar:10s} {vibes:18s} {'🪷' if desi else ''}")

    print(f"\nadding {len(new)} of {len(ADDS)} -> total {len(rows)+len(new)}")
    if not apply:
        print("(dry run — pass --apply)")
        return
    with open(CSV, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows + new)
    print("applied.")

if __name__ == "__main__":
    main()
