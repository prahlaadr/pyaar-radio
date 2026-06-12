#!/usr/bin/env python3
"""Rank uncurated artists as artists.csv candidates, weighted by how DJ-aligned
each playlist is (= share of its tracks already by curated artists). Down-weights
trivia/classical playlists automatically. Writes triage-runs/candidate-artists.csv.
  .venv/bin/python scripts/candidate_artists.py
"""
import csv, json, glob, os, re, unicodedata
from collections import defaultdict, Counter
REPO=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
def norm(s):
    s=unicodedata.normalize("NFKD",s or ""); s="".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+","",s.lower())
def toks(s): return [t.strip() for t in (s or '').split(';') if t.strip()]
known=set()
for r in csv.DictReader(open(os.path.join(REPO,'public/data/artists.csv'))):
    for nm in [r['artist']]+[a for a in (r['aliases'] or '').split('|') if a.strip() and not a.startswith('~')]:
        if norm(nm): known.add(norm(nm))
score=defaultdict(float); raw=defaultdict(set); disp=defaultdict(Counter); srcpl=defaultdict(Counter)
for f in glob.glob(os.path.join(REPO,'public/playlists/PL*.json')):
    try: d=json.load(open(f))
    except: continue
    trs=d.get('tracks',[])
    if len(trs)<8: continue
    w=sum(1 for t in trs if any(norm(x) in known for x in toks(t.get('artist'))))/len(trs)
    for t in trs:
        vid=(t.get('videoId') or '').strip()
        for tok in toks(t.get('artist')):
            n=norm(tok)
            if not n or n in known: continue
            score[n]+=w; raw[n].add(vid); disp[n][tok]+=1; srcpl[n][d.get('title','')]+=1
rows=[]
for n,sc in sorted(score.items(),key=lambda x:-x[1]):
    rows.append((disp[n].most_common(1)[0][0], round(sc,1), len(raw[n]), srcpl[n].most_common(1)[0][0]))
out=os.path.join(REPO,'triage-runs/candidate-artists.csv')
with open(out,'w',newline='') as f:
    w=csv.writer(f); w.writerow(['artist','dj_weighted_score','raw_tracks','top_playlist']); w.writerows(rows)
print(f"wrote {out} ({len(rows)} candidates)")
