#!/usr/bin/env python3
"""Match the Chill Mix OCR list against masterlist.csv for videoIds + enrichment.
Read-only. Writes scripts/chillmix_matched.json (matched + unmatched)."""
import csv, json, re, sys, difflib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "chill-mix-raw.txt"
MASTER = ROOT / "public" / "data" / "masterlist.csv"
OUT = ROOT / "scripts" / "chillmix_matched.json"

def norm(s):
    s = (s or "").lower()
    s = re.sub(r"\(feat[^)]*\)|\[feat[^\]]*\]", " ", s)
    s = re.sub(r"\(instrumental\)|\(original mix\)|\(interlude\)", " ", s)
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()

def artist_tokens(s):
    s = (s or "").lower()
    parts = re.split(r"[,&;/]| feat | ft | x ", s)
    toks = set()
    for p in parts:
        for w in re.findall(r"[a-z0-9]+", p):
            if len(w) > 1: toks.add(w)
    return toks

# --- load masterlist ---
rows = []
by_title = {}
with open(MASTER, newline="", encoding="utf-8") as f:
    r = csv.DictReader(f)
    for row in r:
        t = row.get("Track Name", "")
        nt = norm(t)
        rec = {
            "title": t, "artist": row.get("Artist Name(s)", ""),
            "album": row.get("Album Name", ""),
            "bpm": row.get("Tempo", ""), "key": row.get("Key", ""),
            "duration": row.get("Duration", ""), "videoId": row.get("Video ID", ""),
            "nt": nt, "atoks": artist_tokens(row.get("Artist Name(s)", "")),
        }
        rows.append(rec)
        by_title.setdefault(nt, []).append(rec)

unique_titles = list(by_title.keys())

# --- parse raw list ---
queries = []
for line in RAW.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#"): continue
    parts = [p.strip() for p in line.split("|")]
    if len(parts) < 2: continue
    title, artist = parts[0], parts[1]
    dur = parts[2] if len(parts) > 2 else ""
    queries.append({"title": title, "artist": artist, "duration": dur,
                    "flag": title.startswith("FLAG")})

def pick(cands, qatoks, qdur):
    best, bestscore = None, -1
    for c in cands:
        overlap = len(qatoks & c["atoks"])
        score = overlap * 10
        if qdur and c["duration"] == qdur: score += 3
        if score > bestscore: best, bestscore = c, score
    return best, bestscore

matched, unmatched = [], []
for q in queries:
    if q["flag"]:
        unmatched.append({**q, "reason": "stylized-title-unreadable"}); continue
    nt = norm(q["title"])
    qatoks = artist_tokens(q["artist"])
    cands = by_title.get(nt, [])
    best, score = pick(cands, qatoks, q["duration"]) if cands else (None, -1)
    # require some artist overlap OR unique exact-title match
    if best and (score >= 10 or (len(cands) == 1 and not qatoks)):
        matched.append({"q_title": q["title"], "q_artist": q["artist"],
                        "title": best["title"], "artist": best["artist"],
                        "videoId": best["videoId"], "bpm": best["bpm"],
                        "key": best["key"], "duration": best["duration"]})
        continue
    # fuzzy fallback on title
    close = difflib.get_close_matches(nt, unique_titles, n=5, cutoff=0.86)
    fcands = []
    for ct in close: fcands += by_title[ct]
    best, score = pick(fcands, qatoks, q["duration"]) if fcands else (None, -1)
    if best and score >= 10:
        matched.append({"q_title": q["title"], "q_artist": q["artist"],
                        "title": best["title"], "artist": best["artist"],
                        "videoId": best["videoId"], "bpm": best["bpm"],
                        "key": best["key"], "duration": best["duration"], "fuzzy": True})
    else:
        unmatched.append({**q, "reason": "no-library-match"})

json.dump({"matched": matched, "unmatched": unmatched}, open(OUT, "w"), indent=1, ensure_ascii=False)
print(f"queries={len(queries)} matched={len(matched)} unmatched={len(unmatched)}")
print("--- unmatched ---")
for u in unmatched:
    print(f"  {u['title']} | {u['artist']} ({u['reason']})")
