#!/usr/bin/env python3
"""Adapter: a record label's Bandcamp discography -> one YTM playlist.

Parameterized by `subdomain` in sources.json, so ONE module serves any label
(tempa, hyperdub, hessle, ...). A catalog source (not a feed): the releases are
structured, so queries are clean "Title - Artist" pairs that go straight through
core's strict both-parts gate (high confidence, small review pile).

Groups = releases (the label-hub /album/ and /track/ pages, which serve clean
schema.org JSON-LD: album name, byArtist, and the full track list). Releases are
immutable once published, so sources.json sets rescan_days=0 (seal after first
pass). New releases simply appear in the list on later runs.
"""
import json, os, re, time, urllib.request, urllib.error
from datetime import datetime

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

def _fetch(url, tries=4):
    for a in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(30); continue
            if a == tries - 1: raise
            time.sleep(4 * (a + 1))
        except Exception:
            if a == tries - 1: raise
            time.sleep(4 * (a + 1))

def _norm_date(s):
    s = (s or "").strip()
    for fmt in ("%d %b %Y %H:%M:%S GMT", "%d %b %Y", "%Y-%m-%d"):
        try: return datetime.strptime(s[:len(datetime.now().strftime(fmt)) + 4], fmt).date().isoformat()
        except Exception: pass
    m = re.search(r"(\d{4}-\d{2}-\d{2})", s)
    if m: return m.group(1)
    m = re.search(r"(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})", s)
    if m:
        try: return datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", "%d %b %Y").date().isoformat()
        except Exception: pass
    return ""

def list_groups(cfg):
    """Every release on the label's Bandcamp hub (album + standalone track pages)."""
    sub = cfg["subdomain"]
    h = _fetch(f"https://{sub}.bandcamp.com/music")
    out, seen = [], set()
    for path in re.findall(r'/(?:album|track)/[a-z0-9\-]+', h):
        if path in seen: continue
        seen.add(path)
        out.append({"id": f"https://{sub}.bandcamp.com{path}", "date": "", "label": path.rsplit("/", 1)[-1]})
    return out

def fetch_queries(cfg, group):
    """'Title - Artist' per track on one release; sets group['date'] from the page."""
    h = _fetch(group["id"])
    m = re.search(r'<script type="application/ld\+json">(.*?)</script>', h, re.S)
    if not m: return []
    try: d = json.loads(m.group(1))
    except Exception: return []
    group["date"] = _norm_date(d.get("datePublished", "")) or group.get("date", "")
    album_artist = ((d.get("byArtist") or {}).get("name") or "").strip()

    def q_for(name, artist):
        name = (name or "").strip()
        if not name: return None
        artist = (artist or album_artist or "").strip()
        if " - " in name: return name                 # title already carries "Artist - Title" (VA comps)
        return f"{name} - {artist}" if artist else name

    out = []
    trk = (d.get("track") or {}).get("itemListElement") or []
    if trk:                                            # MusicAlbum
        for t in trk:
            it = t.get("item", {})
            q = q_for(it.get("name"), (it.get("byArtist") or {}).get("name"))
            if q: out.append(q)
    else:                                              # standalone MusicRecording (single)
        q = q_for(d.get("name"), album_artist)
        if q: out.append(q)
    return out
