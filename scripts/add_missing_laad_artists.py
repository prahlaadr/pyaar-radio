#!/usr/bin/env python3
"""
Append __laad artists that exist in pyaar-laad-system.jsx but NOT yet in artists.csv.

Each new row gets: artist, pillar (legacy mirror), pillar_v2, zone, desi_bool from the
JSX ground truth. bpm/vibes/channel/samay are left blank (curate later) — consistent
with other sparse rows. Dedup against existing artist names + aliases (normalized).

  python3 scripts/add_missing_laad_artists.py          # dry run (report only)
  python3 scripts/add_missing_laad_artists.py --apply   # append to artists.csv
"""
import csv, re, os, sys

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV = os.path.join(REPO, "public/data/artists.csv")
JSX = os.path.join(os.path.expanduser("~"), "Downloads/pyaar-laad-system.jsx")

PILLAR_NAMES = {
    "soullaad": "Soullaad", "hypelaad": "Hypelaad", "perclaad": "Perclaad",
    "rowdylaad": "Rowdylaad", "crowdlaad": "Crowdlaad", "lucidlaad": "Traplaad",
}

def norm(s):
    s = s.lower().strip()
    s = re.sub(r"\(.*?\)", "", s)
    return re.sub(r"[^a-z0-9]+", "", s)

def variants(name):
    out = {norm(name)}
    for p in re.split(r"/", name):
        if norm(p):
            out.add(norm(p))
    return out

def parse_jsx():
    txt = open(JSX).read()
    rows = []
    for m in re.finditer(r'\{\s*name:\s*"([^"]+)"\s*,\s*pillar:\s*"(\w+)"\s*,\s*desi:\s*(true|false)\s*(?:,\s*zone:\s*"(\w+)")?\s*\}', txt):
        rows.append({"name": m.group(1), "pillar": PILLAR_NAMES[m.group(2)],
                     "desi": m.group(3) == "true", "zone": m.group(4) or ""})
    return rows

# Nicknames that string-matching can't tie to an existing full name. Held back so they
# become aliases on the existing artist rather than duplicate rows.
KNOWN_NICKNAME = {"hudmo"}  # HudMo = Hudson Mohawke


def is_suspect(name, exnames):
    """Return reason if this candidate looks like a dupe/messy name, else None."""
    if "(" in name or "/" in name:
        return "messy-name"
    cn = norm(name)
    if cn in KNOWN_NICKNAME:
        return "known-nickname"
    if len(cn) >= 4:
        for en, disp in exnames:
            if cn != en and (en.startswith(cn) or en.endswith(cn)):
                return f"likely '{disp}'"
    return None


def main():
    apply = "--apply" in sys.argv
    existing = list(csv.DictReader(open(CSV)))
    fields = list(existing[0].keys())
    have = set()
    exnames = []
    for r in existing:
        have |= variants(r["artist"])
        for a in (r.get("aliases") or "").split("|"):
            if a.strip():
                have |= variants(a)
        if len(norm(r["artist"])) >= 4:
            exnames.append((norm(r["artist"]), r["artist"]))

    seen, to_add, held = set(), [], []
    for j in parse_jsx():
        v = variants(j["name"])
        if v & have or v & seen:
            continue
        seen |= v
        reason = is_suspect(j["name"], exnames)
        (held if reason else to_add).append((j, reason))

    print(f"existing: {len(existing)} | clean to add: {len(to_add)} | held (review): {len(held)}")
    print("\n=== HELD BACK (likely dupes / messy — alias these instead) ===")
    for j, reason in held:
        print(f"  ! {j['name']:22s} {reason}")
    print(f"\n=== ADDING ({len(to_add)}) ===")
    to_add = [j for j, _ in to_add]
    for j in to_add:
        print(f"  + {j['name']:26s} {j['pillar']:10s} {j['zone']:8s} {'🪷' if j['desi'] else ''}")

    if not apply:
        print("\n(dry run — pass --apply to append)")
        return

    new_rows = []
    for j in to_add:
        row = {f: "" for f in fields}
        row["artist"] = j["name"]
        if "pillar" in fields:      row["pillar"] = j["pillar"]
        if "pillar_v2" in fields:   row["pillar_v2"] = j["pillar"]
        if "zone" in fields:        row["zone"] = j["zone"]
        if "desi_bool" in fields:   row["desi_bool"] = "true" if j["desi"] else "false"
        if "desi" in fields:        row["desi"] = "Desi" if j["desi"] else "Non-Desi"
        new_rows.append(row)

    with open(CSV, "w", newline="") as f:  # csv.writer default CRLF matches repo convention
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(existing + new_rows)
    print(f"\nAppended {len(new_rows)} artists -> {len(existing)+len(new_rows)} total")

if __name__ == "__main__":
    main()
