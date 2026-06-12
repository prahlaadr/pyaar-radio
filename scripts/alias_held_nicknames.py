#!/usr/bin/env python3
"""
Make the 11 held-back nicknames searchable.

- 8 nicknames map to an existing artist -> add as an alias on that row (search
  uses name + aliases via Fuse).
- 3 are X/Y collab combos with no existing artist -> add as their own rows so a
  search for either name fuzzy-matches them (pillar/zone/desi/genre from the JSX).

  python3 scripts/alias_held_nicknames.py          # dry run
  python3 scripts/alias_held_nicknames.py --apply
"""
import csv, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(REPO, "public/data/artists.csv")

# nickname -> canonical existing artist
ALIASES = {
    "Sam G": "sam gellaitry",
    "Carmack": "Mr. Carmack",
    "Nikita": "Nikita the Wicked",
    "Kendrick": "Kendrick Lamar",       # JSX "Kendrick (hits)"
    "Simz": "Little Simz",
    "Yachty": "Lil Yachty",
    "Waka Flocka": "Waka Flocka Flame",
    "HudMo": "Hudson Mohawke",
}

# X/Y combos with no existing target -> add as rows. (pillar_v2, zone, desi, genre)
NEW_ROWS = {
    "Twenty/Twenty":       ("Rowdylaad", "leftfield", False, "Bass"),
    "Sunflwr/Pijus":       ("Hypelaad",  "",          True,  "Club"),
    "Miracle Mangal/SIdd": ("Hypelaad",  "",          True,  "Club"),
}

def main():
    apply = "--apply" in sys.argv
    rows = list(csv.DictReader(open(CSV)))
    fields = list(rows[0].keys())
    by_name = {r["artist"]: r for r in rows}

    print("=== aliases onto existing artists ===")
    aliased = 0
    for nick, canon in ALIASES.items():
        r = by_name.get(canon)
        if not r:
            print(f"  ! target missing: {canon} (skip {nick})")
            continue
        cur = [a for a in (r["aliases"] or "").split("|") if a.strip()]
        if nick in cur:
            print(f"  = {canon}: already has '{nick}'")
            continue
        cur.append(nick)
        r["aliases"] = "|".join(cur)
        aliased += 1
        print(f"  + {canon}: aliases += '{nick}'")

    print("\n=== new rows for combos ===")
    added = []
    for name, (pillar, zone, desi, genre) in NEW_ROWS.items():
        if name in by_name:
            print(f"  = {name}: already a row"); continue
        row = {f: "" for f in fields}
        row["artist"] = name
        for k, v in (("pillar", pillar), ("pillar_v2", pillar), ("zone", zone),
                     ("desi_bool", "true" if desi else "false"),
                     ("desi", "Desi" if desi else "Non-Desi"), ("vibes", genre)):
            if k in fields:
                row[k] = v
        added.append(row)
        print(f"  + {name:22s} {pillar:10s} {zone:9s} {'🪷' if desi else ''} genre={genre}")

    print(f"\naliased: {aliased} | new rows: {len(added)}")
    if not apply:
        print("(dry run — pass --apply)")
        return
    with open(CSV, "w", newline="") as f:  # csv default CRLF
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows + added)
    print(f"applied. total artists: {len(rows)+len(added)}")

if __name__ == "__main__":
    main()
