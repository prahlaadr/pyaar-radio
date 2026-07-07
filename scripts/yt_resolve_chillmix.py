#!/usr/bin/env python3
"""Resolve unmatched Chill Mix tracks via YT Music search (read-only).
Skips truly-unreadable stylized titles. Writes scripts/chillmix_resolved.json."""
import json, re, time
from pathlib import Path
from ytmusicapi import YTMusic

ROOT = Path(__file__).resolve().parent.parent
MATCHED = ROOT / "scripts" / "chillmix_matched.json"
OUT = ROOT / "scripts" / "chillmix_resolved.json"

yt = YTMusic(str(ROOT / "browser.json"))

def atoks(s):
    return set(w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) > 1)

data = json.load(open(MATCHED))
to_resolve = [u for u in data["unmatched"] if u.get("reason") != "stylized-title-unreadable"]

resolved, still_missing = [], []
for u in to_resolve:
    title, artist = u["title"], u["artist"]
    # clean artist "cut off" notes
    artist_clean = re.sub(r"\(.*?\)", "", artist).strip().strip(",")
    q = f"{title} {artist_clean}".strip()
    try:
        res = yt.search(q, filter="songs", limit=5)
    except Exception as e:
        still_missing.append({**u, "err": str(e)[:80]}); continue
    qat = atoks(artist_clean)
    best = None
    for r in res:
        rart = " ".join(a.get("name", "") for a in r.get("artists", []) or [])
        overlap = len(qat & atoks(rart))
        # title similarity: normalized token overlap
        rt = atoks(r.get("title", "")); qt = atoks(title)
        tov = len(rt & qt) / max(1, len(qt))
        score = overlap * 2 + tov
        if best is None or score > best[0]:
            best = (score, r, rart)
    if best and best[0] >= 1.0 and best[1].get("videoId"):
        r = best[1]
        resolved.append({"q_title": title, "q_artist": artist,
                         "title": r.get("title"), "artist": best[2],
                         "videoId": r["videoId"],
                         "duration": r.get("duration", u.get("duration", "")),
                         "bpm": "", "key": "", "yt_search": True,
                         "score": round(best[0], 2)})
    else:
        still_missing.append({**u, "best": (best[1].get("title") if best else None)})
    time.sleep(0.15)

json.dump({"resolved": resolved, "still_missing": still_missing}, open(OUT, "w"), indent=1, ensure_ascii=False)
print(f"to_resolve={len(to_resolve)} resolved={len(resolved)} still_missing={len(still_missing)}")
print("--- still missing (named) ---")
for m in still_missing:
    print(f"  {m['title']} | {m['artist']}  (best yt: {m.get('best')})")
