#!/usr/bin/env python3
"""Fill videoIds for matched tracks whose masterlist row had a blank Video ID,
via YT Music search. Keeps masterlist bpm/key/duration. Updates chillmix_matched.json."""
import json, re, time
from pathlib import Path
from ytmusicapi import YTMusic

ROOT = Path(__file__).resolve().parent.parent
MATCHED = ROOT / "scripts" / "chillmix_matched.json"
yt = YTMusic(str(ROOT / "browser.json"))

def atoks(s):
    return set(w for w in re.findall(r"[a-z0-9]+", (s or "").lower()) if len(w) > 1)

data = json.load(open(MATCHED))
filled, failed = 0, []
for m in data["matched"]:
    if m.get("videoId"): continue
    title = m["q_title"]; artist = re.sub(r"\(.*?\)", "", m["q_artist"]).strip().strip(",")
    try:
        res = yt.search(f"{title} {artist}", filter="songs", limit=5)
    except Exception as e:
        failed.append(f"{title} | {artist} ({str(e)[:50]})"); continue
    qat = atoks(artist); qt = atoks(title); best = None
    for r in res:
        rart = " ".join(a.get("name", "") for a in r.get("artists", []) or [])
        ov = len(qat & atoks(rart)); tov = len(atoks(r.get("title", "")) & qt) / max(1, len(qt))
        sc = ov * 2 + tov
        if best is None or sc > best[0]: best = (sc, r, rart)
    if best and best[0] >= 1.0 and best[1].get("videoId"):
        m["videoId"] = best[1]["videoId"]; m["yt_search"] = True
        if not m.get("duration"): m["duration"] = best[1].get("duration", "")
        filled += 1
    else:
        failed.append(f"{title} | {artist} (best: {best[1].get('title') if best else None})")
    time.sleep(0.15)

json.dump(data, open(MATCHED, "w"), indent=1, ensure_ascii=False)
print(f"filled={filled} failed={len(failed)}")
for f in failed: print("  FAIL:", f)
