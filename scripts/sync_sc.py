#!/usr/bin/env python3
"""Sync SoundCloud liked tracks + liked/followed playlists into public/data/sc.json.

No auth needed: the profile's likes and playlist-likes are public, readable with
just a SoundCloud client_id (fetched dynamically from the SC web app, like the
app's /api/search-sc route). Liked tracks play in-app via the existing SC widget
(numeric track id); playlists load their tracks on demand in the browser.

Usage:
  python sync_sc.py            # fetch + write public/data/sc.json
"""
import json, re, sys, time, urllib.request, urllib.error
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "public" / "data" / "sc.json"
API = "https://api-v2.soundcloud.com"
USER_ID = 128154028  # prahlaad's SoundCloud user id (public)
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
FALLBACK_CLIENT_ID = "SYyXueujTqHDMhknjklMhdgKi3KfRssi"


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def get_client_id():
    """Scrape a working client_id from the SoundCloud web app's JS bundles."""
    try:
        req = urllib.request.Request("https://soundcloud.com", headers={"User-Agent": UA})
        html = urllib.request.urlopen(req, timeout=25).read().decode()
        scripts = re.findall(r'src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"', html)
        for url in reversed(scripts[-6:]):
            js = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=25).read().decode()
            m = re.search(r'client_id:"([a-zA-Z0-9]{32})"', js)
            if m:
                return m.group(1)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"client_id scrape failed ({e}); using fallback", file=sys.stderr)
    return FALLBACK_CLIENT_ID


def fetch_all(path, cid, limit=200, cap=5000):
    """Follow linked_partitioning next_href until exhausted (or cap reached)."""
    url = f"{API}{path}?client_id={cid}&limit={limit}&linked_partitioning=1"
    items = []
    while url and len(items) < cap:
        d = _get(url)
        items.extend(d.get("collection", []))
        nxt = d.get("next_href")
        url = (nxt + f"&client_id={cid}") if nxt else None
    return items


def track_out(t):
    if not t or not t.get("id"):
        return None
    return {
        "id": t["id"],
        "title": t.get("title") or "",
        "user": (t.get("user") or {}).get("username") or "",
        "artwork": t.get("artwork_url"),
        "permalink": t.get("permalink_url") or "",
        "duration": t.get("duration") or 0,
        "genre": t.get("genre") or "",
        "streamable": bool(t.get("streamable")),
    }


def main():
    cid = get_client_id()
    print(f"client_id: {cid[:8]}…")

    liked = fetch_all(f"/users/{USER_ID}/track_likes", cid)
    likes = [o for it in liked if (o := track_out(it.get("track")))]

    pl_likes = fetch_all(f"/users/{USER_ID}/playlist_likes", cid, limit=50)
    playlists = []
    for it in pl_likes:
        p = it.get("playlist") or {}
        if not p.get("id"):
            continue
        playlists.append({
            "id": p["id"],
            "title": p.get("title") or "",
            "user": (p.get("user") or {}).get("username") or "",
            "artwork": p.get("artwork_url"),
            "trackCount": p.get("track_count") or 0,
            "permalink": p.get("permalink_url") or "",
            "isAlbum": bool(p.get("is_album")),
        })

    out = {
        "syncedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "clientId": cid,  # the browser needs a client_id to resolve playlist tracks + stream
        "likes": likes,
        "playlists": playlists,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"wrote {OUT.relative_to(REPO)}: {len(likes)} liked tracks, {len(playlists)} playlists")


if __name__ == "__main__":
    main()
