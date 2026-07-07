#!/usr/bin/env python3
"""Build Chill Mix: create YT Music playlist + write vault setlist CSV/json + export CSV.
Order = discovery order from chill-mix-raw.txt. Deduped by videoId."""
import json, re, csv, sys
from pathlib import Path
from ytmusicapi import YTMusic

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "chill-mix-raw.txt"
MATCHED = json.load(open(ROOT / "scripts" / "chillmix_matched.json"))
RESOLVED = json.load(open(ROOT / "scripts" / "chillmix_resolved.json"))
DRY = "--dry" in sys.argv

def key(t, a): return (t.strip().lower(), a.strip().lower())

# index videoId/enrichment by original query (title,artist)
info = {}
for m in MATCHED["matched"]:
    info[key(m["q_title"], m["q_artist"])] = m
for r in RESOLVED["resolved"]:
    info[key(r["q_title"], r["q_artist"])] = r

# walk raw list in order
ordered, seen_vid, skipped = [], set(), []
for line in RAW.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"): continue
    parts = [p.strip() for p in line.split("|")]
    if len(parts) < 2: continue
    title, artist = parts[0], parts[1]
    dur = parts[2] if len(parts) > 2 else ""
    rec = info.get(key(title, artist))
    if not rec or not rec.get("videoId"):
        skipped.append({"title": title, "artist": artist, "duration": dur}); continue
    vid = rec["videoId"]
    if vid in seen_vid: continue
    seen_vid.add(vid)
    bpm = rec.get("bpm", "")
    try: bpm = str(round(float(bpm))) if bpm else ""
    except: bpm = ""
    ordered.append({
        "videoId": vid,
        "title": title,                     # keep user's OCR title/artist for display
        "artist": re.sub(r"\s*\(.*?\)\s*$", "", artist).strip().strip(","),
        "bpm": bpm, "key": "",              # numeric pitch has no mode -> leave blank
        "duration": rec.get("duration", dur) or dur,
    })

print(f"orderable={len(ordered)} skipped(unreadable)={len(skipped)}")

# --- write vault CSV (Position,Track Name,Artist,BPM,Key,Duration) ---
vault = ROOT / "public" / "data" / "chill-mix.csv"
with open(vault, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Position", "Track Name", "Artist", "BPM", "Key", "Duration"])
    for i, t in enumerate(ordered):
        w.writerow([i + 1, t["title"], t["artist"], t["bpm"], t["key"], t["duration"]])

# --- write app-export-format CSV (Position,Chapter,Track Name,Artist,BPM,Key,Duration,Seed) ---
exp = ROOT / "data" / "chill-mix-export.csv"
with open(exp, "w", newline="", encoding="utf-8") as f:
    w = csv.writer(f)
    w.writerow(["Position", "Chapter", "Track Name", "Artist", "BPM", "Key", "Duration", "Seed"])
    for i, t in enumerate(ordered):
        w.writerow([i + 1, "", t["title"], t["artist"], t["bpm"], t["key"], t["duration"], ""])

# --- register in setlists.json manifest ---
man = ROOT / "public" / "data" / "setlists.json"
entries = json.load(open(man)) if man.exists() else []
entries = [e for e in entries if e.get("id") != "chill-mix"]
entries.append({"id": "chill-mix", "name": "Chill Mix (lil bit of everything beats, raps, low vibrations)",
                "file": "chill-mix.csv", "trackCount": len(ordered)})
json.dump(entries, open(man, "w"), indent=2, ensure_ascii=False)
print(f"wrote {vault.name}, {exp.name}, setlists.json (trackCount={len(ordered)})")

if DRY:
    print("DRY: skipping YT Music playlist creation"); sys.exit(0)

# --- create YT Music playlist + add tracks ---
yt = YTMusic(str(ROOT / "browser.json"))
vids = [t["videoId"] for t in ordered]
pid = yt.create_playlist(
    "Chill Mix",
    "lil bit of everything — beats, raps, low vibrations. Built from screenshots via Pyaar Radio.",
    privacy_status="PRIVATE",
    video_ids=vids[:1],
)
if isinstance(pid, dict): pid = pid.get("id") or pid.get("playlistId")
print("playlistId:", pid)
added = 1
for i in range(1, len(vids), 100):
    chunk = vids[i:i + 100]
    yt.add_playlist_items(pid, chunk, duplicates=False)
    added += len(chunk)
    print(f"  added {added}/{len(vids)}")

json.dump({"playlistId": pid, "count": len(vids),
           "url": f"https://music.youtube.com/playlist?list={pid}"},
          open(ROOT / "scripts" / "chillmix_playlist.json", "w"), indent=1)
print("DONE playlist:", f"https://music.youtube.com/playlist?list={pid}")
