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
import html, json, re, subprocess, time
from datetime import datetime

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")

def _valid(text):
    # bandcamp's Fastly bot-mitigation serves a ~3KB challenge page (marker
    # "_fs-ch-") to flagged TLS fingerprints; a real release/hub page is much
    # larger and carries no such marker.
    return bool(text) and len(text) > 5000 and "_fs-ch-" not in text[:3000]

# Bandcamp's Fastly bot-mitigation runs a JS challenge and challenges requests
# probabilistically; the bare "chrome" alias always loses, but pinned browser
# fingerprints pass *most* of the time, and WHICH one passes varies run to run.
# So rotate several per attempt (plus the curl binary, whose SecureTransport/
# OpenSSL fingerprint is a different shot) and retry with backoff.
IMPERSONATE = ("chrome124", "chrome131", "safari17_0")

def _candidates(url):
    try:
        from curl_cffi import requests as creq
        for imp in IMPERSONATE:
            try:
                r = creq.get(url, impersonate=imp, timeout=40)
                yield r.text if r.status_code == 200 else None
            except Exception:
                yield None
    except ImportError:
        pass
    try:
        out = subprocess.run(["curl", "-sL", "--compressed", "-A", UA, url],
                             capture_output=True, text=True, timeout=60)
        yield out.stdout if out.returncode == 0 else None
    except Exception:
        yield None

def _fetch(url, tries=4):
    """Fetch past Bandcamp's bot challenge by rotating browser fingerprints;
    retry with backoff. Raises if it never gets a real page."""
    for a in range(tries):
        for text in _candidates(url):
            if _valid(text): return text
        time.sleep(8 * (a + 1))
    raise RuntimeError(f"bandcamp fetch failed after {tries} rounds: {url}")

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
    """Every release in the label's catalog, from the /music page's embedded
    `data-client-items` grid (the canonical release URLs, which live on each
    artist's own subdomain and carry proper schema.org JSON-LD).

    A label hub never legitimately has zero releases, so an empty result means a
    transient block/challenge; retry, then raise (so the runner resumes) rather
    than silently no-op the whole source."""
    sub = cfg["subdomain"]
    for attempt in range(3):
        h = _fetch(f"https://{sub}.bandcamp.com/music") or ""
        m = re.search(r'data-client-items="([^"]+)"', h)
        if m:
            out, seen = [], set()
            for it in json.loads(html.unescape(m.group(1))):
                u = (it.get("page_url") or "").split("?")[0]
                if u.startswith("//"): u = "https:" + u
                elif u.startswith("/"): u = f"https://{sub}.bandcamp.com" + u
                if not u.startswith("http") or u in seen: continue
                seen.add(u)
                label = " - ".join(x for x in (it.get("artist"), it.get("title")) if x)
                out.append({"id": u, "date": "", "label": label or u.rsplit("/", 1)[-1]})
            if out: return out
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"bandcamp label '{sub}': /music returned no releases after retries")

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
