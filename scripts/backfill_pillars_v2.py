#!/usr/bin/env python3
"""
Backfill the __laad 6-pillar taxonomy onto artists.csv (ADDITIVE).

Adds three columns without touching existing ones:
  - pillar_v2 : pipe-separated of {Soullaad,Hypelaad,Perclaad,Rowdylaad,Crowdlaad,Traplaad}
  - zone      : optional within-pillar sub-bucket (ambient/beats/soul/dub/dnb/leftfield/rave/support)
  - desi_bool : "true"/"false" — orthogonal desi tag, de-conflated from pillar names

Sources, in priority order:
  1. pyaar-laad-system.jsx  — hand-built ground truth (~300 artists w/ pillar+zone+desi)
  2. rule-based inference    — 5-pillar + channel + vibes → 6-pillar, for CSV artists not in the JSX

Run from repo root:
  python3 scripts/backfill_pillars_v2.py            # writes public/data/artists_v2.csv + report
  python3 scripts/backfill_pillars_v2.py --apply    # overwrite public/data/artists.csv in place
"""
import csv, re, sys, os, json
from collections import Counter, defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSV_IN = os.path.join(REPO, "public/data/artists.csv")
CSV_OUT = os.path.join(REPO, "public/data/artists_v2.csv")
JSX = os.path.join(os.path.expanduser("~"), "Downloads/pyaar-laad-system.jsx")

PILLAR_NAMES = {
    "soullaad": "Soullaad", "hypelaad": "Hypelaad", "perclaad": "Perclaad",
    "rowdylaad": "Rowdylaad", "crowdlaad": "Crowdlaad", "lucidlaad": "Traplaad",
}

# ---------- name normalization ----------
def norm(s):
    s = s.lower().strip()
    s = re.sub(r"\(.*?\)", "", s)          # drop "(club)", "(hits)", "(chill)"
    s = re.sub(r"[^a-z0-9]+", "", s)       # strip punctuation/space
    return s

def name_variants(name):
    """A CSV/JSX name may pack several artists with / — index each."""
    parts = re.split(r"[/]", name)
    out = {norm(name)}
    for p in parts:
        n = norm(p)
        if n:
            out.add(n)
    return out

# ---------- parse JSX ground truth ----------
def parse_jsx():
    txt = open(JSX).read()
    # match: { name: "X", pillar: "y", desi: true/false, zone: "z" }
    rows = []
    for m in re.finditer(r"\{\s*name:\s*\"([^\"]+)\"\s*,\s*pillar:\s*\"(\w+)\"\s*,\s*desi:\s*(true|false)\s*(?:,\s*zone:\s*\"(\w+)\")?\s*\}", txt):
        rows.append({
            "name": m.group(1),
            "pillar": PILLAR_NAMES[m.group(2)],
            "desi": m.group(3) == "true",
            "zone": m.group(4) or "",
        })
    return rows

# ---------- rule-based fallback for artists not in JSX ----------
def has(vibes, *needles):
    v = vibes.lower()
    return any(n.lower() in v for n in needles)

def infer(row):
    """Return (pillar, zone, reason) from current pillar/channel/vibes."""
    pillars = [p.strip() for p in (row.get("pillar") or "").split("|") if p.strip()]
    channel = (row.get("channel") or "").strip()
    vibes = row.get("vibes") or ""
    nums = {p[0] for p in pillars if p and p[0].isdigit()}

    # strongest signal: the numbered pillar
    if "4" in nums:
        return "Rowdylaad", _rowdy_zone(vibes), "pillar:4 Bass Rave"
    if "1" in nums:
        return "Soullaad", _soul_zone(vibes), "pillar:1 Mellow"
    if "2" in nums:
        return "Soullaad", _soul_zone(vibes), "pillar:2 Desi Lofi"
    if "3" in nums:
        # uptempo: percussive-global → Perclaad, else dancefloor → Hypelaad
        if has(vibes, "Percussive", "Afro", "Amapiano", "Baile"):
            return "Perclaad", "", "pillar:3 Uptempo+percussive"
        return "Hypelaad", "", "pillar:3 Uptempo"
    if "5" in nums:
        return "Crowdlaad", "", "pillar:5 Trivia Crowd"

    # no numbered pillar — fall back to channel + vibes
    if channel == "Rap":
        # hits/pop → Crowdlaad, else underground → Traplaad
        if has(vibes, "Pop"):
            return "Crowdlaad", "", "channel:Rap+Pop"
        return "Traplaad", "", "channel:Rap"
    if channel == "Soul":
        return "Soullaad", _soul_zone(vibes), "channel:Soul"
    if channel == "Rave":
        if has(vibes, "Bass", "Dubstep", "DnB", "Dub", "Rave"):
            return "Rowdylaad", _rowdy_zone(vibes), "channel:Rave+bass"
        if has(vibes, "Percussive", "Afro"):
            return "Perclaad", "", "channel:Rave+percussive"
        return "Hypelaad", "", "channel:Rave"

    # last resort: vibes only
    if has(vibes, "Bass", "Dubstep", "DnB", "Dub", "Rave"):
        return "Rowdylaad", _rowdy_zone(vibes), "vibes:bass"
    if has(vibes, "Ambient", "Soulful", "Nodders", "Boom Bap"):
        return "Soullaad", _soul_zone(vibes), "vibes:mellow"
    if has(vibes, "Club", "Garage", "Electronica"):
        return "Hypelaad", "", "vibes:club"
    return "Soullaad", "", "DEFAULT(no signal)"

def _soul_zone(v):
    if has(v, "Ambient"): return "ambient"
    if has(v, "Boom Bap", "Future Beats"): return "beats"
    if has(v, "Soulful", "Groove"): return "soul"
    return ""

def _rowdy_zone(v):
    if has(v, "Dub", "Dubstep"): return "dub"
    if has(v, "DnB"): return "dnb"
    if has(v, "Rave"): return "rave"
    return ""

# ---------- main ----------
def main():
    apply = "--apply" in sys.argv
    jsx_rows = parse_jsx()
    # build lookup: normalized variant -> jsx row
    jlook = {}
    for r in jsx_rows:
        for v in name_variants(r["name"]):
            jlook.setdefault(v, r)
    print(f"JSX ground truth: {len(jsx_rows)} entries, {len(jlook)} name keys")

    rows = list(csv.DictReader(open(CSV_IN)))
    NEW = ["pillar_v2", "zone", "desi_bool"]
    # Idempotent: don't re-append columns that already exist (safe to re-run).
    base = [f for f in (rows[0].keys() if rows else []) if f not in NEW]
    out_fields = base + NEW

    matched_jsx = 0
    inferred = 0
    report = []
    pillar_count = Counter()
    zone_count = Counter()
    desi_flips = []

    for row in rows:
        variants = set()
        variants |= name_variants(row["artist"])
        for a in (row.get("aliases") or "").split("|"):
            if a.strip():
                variants |= name_variants(a)
        hit = next((jlook[v] for v in variants if v in jlook), None)

        if hit:
            pillar, zone, desi = hit["pillar"], hit["zone"], hit["desi"]
            source = "JSX"
            matched_jsx += 1
        else:
            pillar, zone, reason = infer(row)
            # desi: trust the existing boolean field if present
            desi = (row.get("desi") or "").strip() == "Desi"
            source = "infer:" + reason
            inferred += 1

        # detect de-conflation: was in a "Desi" pillar but desi=false, or vice versa
        old_pillar = row.get("pillar") or ""
        if ("Desi" in old_pillar) != desi:
            desi_flips.append((row["artist"], old_pillar, desi))

        row["pillar_v2"] = pillar
        row["zone"] = zone
        row["desi_bool"] = "true" if desi else "false"
        pillar_count[pillar] += 1
        if zone:
            zone_count[zone] += 1
        report.append((row["artist"], pillar, zone, "🪷" if desi else "", source))

    # write
    target = CSV_IN if apply else CSV_OUT
    with open(target, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=out_fields)
        w.writeheader()
        w.writerows(rows)

    # ---- report ----
    print(f"\nWrote {len(rows)} artists -> {os.path.relpath(target, REPO)}")
    print(f"  matched from JSX : {matched_jsx}")
    print(f"  inferred by rule : {inferred}")
    print(f"\nPillar distribution (energy order):")
    for p in ["Soullaad","Hypelaad","Perclaad","Rowdylaad","Crowdlaad","Traplaad"]:
        print(f"  {p:12s} {pillar_count[p]:4d}")
    print(f"  desi-tagged      : {sum(1 for r in rows if r['desi_bool']=='true')}")
    print(f"\nZone distribution:")
    for z,c in zone_count.most_common():
        print(f"  {z:12s} {c:4d}")
    print(f"\nDe-conflation: {len(desi_flips)} artists where old pillar-name desi-ness != new desi tag")
    for a,op,d in desi_flips[:25]:
        print(f"  {'🪷' if d else '  '} {a:28s} was [{op}] -> desi={d}")

    # artists with zero pillar (should be none)
    zero = [r['artist'] for r in rows if not r['pillar_v2']]
    print(f"\nZero-pillar artists: {len(zero)} {zero[:10]}")

    # default/low-confidence inferences for review
    lowconf = [r for r in report if r[4].startswith("infer") and ("DEFAULT" in r[4] or "vibes:" in r[4])]
    print(f"\nLow-confidence inferences ({len(lowconf)}) — review these:")
    for a,p,z,d,s in lowconf[:40]:
        print(f"  {d:2s} {a:28s} -> {p:10s} {z:9s} [{s}]")

if __name__ == "__main__":
    main()
