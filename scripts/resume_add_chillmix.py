#!/usr/bin/env python3
"""Resume adding Chill Mix tracks to the existing playlist, small batches + retry."""
import json, re, time, sys
from pathlib import Path
from ytmusicapi import YTMusic

ROOT = Path(__file__).resolve().parent.parent
PID = "PLeUck5qlo-go"
MATCHED = json.load(open(ROOT / "scripts" / "chillmix_matched.json"))
RESOLVED = json.load(open(ROOT / "scripts" / "chillmix_resolved.json"))
RAW = ROOT / "data" / "chill-mix-raw.txt"
yt = YTMusic(str(ROOT / "browser.json"))

def key(t, a): return (t.strip().lower(), a.strip().lower())
info = {}
for m in MATCHED["matched"]: info[key(m["q_title"], m["q_artist"])] = m
for r in RESOLVED["resolved"]: info[key(r["q_title"], r["q_artist"])] = r

vids, seen = [], set()
for line in RAW.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"): continue
    p = [x.strip() for x in line.split("|")]
    if len(p) < 2: continue
    rec = info.get(key(p[0], p[1]))
    if not rec or not rec.get("videoId"): continue
    v = rec["videoId"]
    if v in seen: continue
    seen.add(v); vids.append(v)

# what's already in the playlist?
pl = yt.get_playlist(PID, limit=None)
have = {t["videoId"] for t in pl.get("tracks", []) if t.get("videoId")}
missing = [v for v in vids if v not in have]
print(f"target={len(vids)} already={len(have)} missing={len(missing)}")

added = 0
for i in range(0, len(missing), 20):
    chunk = missing[i:i + 20]
    for attempt in range(4):
        try:
            yt.add_playlist_items(PID, chunk, duplicates=False)
            added += len(chunk)
            print(f"  +{len(chunk)} ({added}/{len(missing)})")
            break
        except Exception as e:
            if attempt == 3:
                print(f"  FAILED chunk {i}: {str(e)[:70]}")
            else:
                time.sleep(1.5 * (attempt + 1))
    time.sleep(0.8)

pl2 = yt.get_playlist(PID, limit=None)
final = len([t for t in pl2.get("tracks", []) if t.get("videoId")])
print(f"FINAL playlist size: {final}")
json.dump({"playlistId": PID, "count": final,
           "url": f"https://music.youtube.com/playlist?list={PID}"},
          open(ROOT / "scripts" / "chillmix_playlist.json", "w"), indent=1)
