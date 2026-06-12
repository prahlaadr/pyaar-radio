#!/usr/bin/env python3
"""
Cross-reference every curated artist (artists.csv, name + aliases) against the
user's full song universe:
  - masterlist.csv         (liked + monthly playlists — what artist PAGES query)
  - public/playlists/*.json (ALL 261 saved YouTube playlists — the setlists page)

Reports, per artist:
  - masterlist track count  (shows on their page today)
  - playlist track count     (exists in your universe)
  - GAP = playlist tracks NOT already in masterlist (songs missing from the page)

And the headline buckets:
  - artists with ANY song            (real)
  - artists with 0 masterlist but songs in playlists  (the gap to import)
  - artists with 0 songs anywhere    (empty entries)

Matching = exact normalized token (lowercase, alphanumeric-only) against the
artist string split on ';' (primary) plus secondary collab separators. Exact
tokens avoid false positives from short names (Omar, Future, KP, ...).

  .venv/bin/python scripts/audit_artist_coverage.py
"""
import csv, json, glob, os, re, sys, unicodedata
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART = os.path.join(REPO, "public/data/artists.csv")
MASTER = os.path.join(REPO, "public/data/masterlist.csv")
PLAYLISTS = glob.glob(os.path.join(REPO, "public/playlists/PL*.json"))

def norm(s):
    # fold accents (The Marías == The Marias) then keep alphanumerics
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "", s.lower())

SUB = re.compile(r"\s*(?:;|,|&|/|\bfeat\.?\b|\bft\.?\b|\bx\b|\band\b|×)\s*", re.I)

def tokens(artist_str):
    """Primary ';' tokens + secondary collab sub-tokens, normalized."""
    out = set()
    for prim in (artist_str or "").split(";"):
        prim = prim.strip()
        if not prim:
            continue
        out.add(norm(prim))                       # whole primary token
        for sub in SUB.split(prim):               # collab sub-tokens
            if sub.strip():
                out.add(norm(sub))
    out.discard("")
    return out

def main():
    # 1. artist token -> set(curated artist). name + aliases (skip '~' exclusions).
    artists = list(csv.DictReader(open(ART)))
    tok2art = defaultdict(set)
    for r in artists:
        names = [r["artist"]] + [a for a in (r["aliases"] or "").split("|")
                                 if a.strip() and not a.startswith("~")]
        for nm in names:
            if norm(nm):
                tok2art[norm(nm)].add(r["artist"])

    master_ct = defaultdict(set)   # artist -> set(videoId) in masterlist
    master_vids = set()
    # 2. masterlist
    with open(MASTER, newline="") as f:
        for row in csv.DictReader(f):
            vid = row.get("Video ID") or ""
            master_vids.add(vid)
            for t in tokens(row.get("Artist Name(s)")):
                for a in tok2art.get(t, ()):
                    master_ct[a].add(vid)

    pl_ct = defaultdict(set)       # artist -> set(videoId) across all playlists
    pl_gap = defaultdict(set)      # artist -> set(videoId) in playlists but NOT masterlist
    total_pl_tracks = 0
    for f in PLAYLISTS:
        try:
            d = json.load(open(f))
        except Exception:
            continue
        for tr in d.get("tracks", []):
            vid = tr.get("videoId") or ""
            total_pl_tracks += 1
            toks = tokens(tr.get("artist"))
            matched = set()
            for t in toks:
                matched |= tok2art.get(t, set())
            for a in matched:
                pl_ct[a].add(vid)
                if vid and vid not in master_vids:
                    pl_gap[a].add(vid)

    # 3. buckets
    rows = []
    for r in artists:
        a = r["artist"]
        m, p, g = len(master_ct[a]), len(pl_ct[a]), len(pl_gap[a])
        rows.append((a, m, p, g))

    with_master = [x for x in rows if x[1] > 0]
    gap_only = [x for x in rows if x[1] == 0 and x[2] > 0]
    empty = [x for x in rows if x[2] == 0]   # nothing anywhere
    has_any = [x for x in rows if x[2] > 0 or x[1] > 0]

    print(f"curated artists:                 {len(rows)}")
    print(f"playlist files scanned:          {len(PLAYLISTS)}  ({total_pl_tracks} track rows)")
    print(f"masterlist videos:               {len(master_vids)}")
    print()
    print(f"artists with ANY song:           {len(has_any)}")
    print(f"  ...shown on page (in masterlist): {len(with_master)}")
    print(f"  ...ONLY in playlists (the GAP):   {len(gap_only)}")
    print(f"artists with 0 songs anywhere:   {len(empty)}")
    print()
    total_gap_tracks = sum(x[3] for x in rows)
    print(f"TOTAL gap tracks (in a playlist, not in masterlist, by a curated artist): {total_gap_tracks}")
    print()
    print("=== top 30 artists by GAP (missing songs to import) ===")
    for a, m, p, g in sorted(rows, key=lambda x: -x[3])[:30]:
        print(f"  {g:5d} gap | master {m:4d} | playlist {p:4d} | {a}")
    print()
    print(f"=== artists with 0 songs anywhere ({len(empty)}) ===")
    print("  " + ", ".join(x[0] for x in sorted(empty)))

    if "--csv" in sys.argv:
        out = os.path.join(REPO, "triage-runs", "artist-coverage.csv")
        os.makedirs(os.path.dirname(out), exist_ok=True)
        with open(out, "w", newline="") as f:
            w = csv.writer(f)
            w.writerow(["artist", "masterlist_tracks", "playlist_tracks", "gap_tracks"])
            w.writerows(sorted(rows, key=lambda x: -x[3]))
        print(f"\nwrote {out}")

if __name__ == "__main__":
    main()
