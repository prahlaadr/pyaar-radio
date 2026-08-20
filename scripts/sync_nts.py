#!/usr/bin/env python3
"""Sync NTS favourites (saved hosts + episodes) into public/data/nts.json.

Two stages:
  1. Fetch the favourites LIST (show aliases + episode slugs). NTS keeps these in
     Firebase Firestore behind realtime-only rules, so the only reliable read is
     to render the authenticated my-nts pages and scrape them. In CI this uses
     Playwright with a Firebase refresh token (NTS_REFRESH_TOKEN secret). Locally
     you can skip the browser by passing --favourites <file.json> (the shape the
     scraper produces): {"shows": ["alias", ...], "episodes": [["show","slug"], ...]}.
  2. ENRICH each item via NTS's PUBLIC API (no auth): /api/v2/shows/{alias} and
     /api/v2/shows/{show}/episodes/{slug}. Episodes expose audio_sources, which the
     app plays in-place (SoundCloud) or links out (Mixcloud).

Usage:
  python sync_nts.py --favourites favourites.json      # enrich a captured list
  python sync_nts.py                                    # CI: scrape (Playwright) + enrich
"""
import argparse, json, os, sys, time, urllib.request, urllib.error, urllib.parse
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
OUT = REPO / "public" / "data" / "nts.json"
API = "https://www.nts.live/api/v2"
APIKEY = "AIzaSyA4Qp5AvHC8Rev72-10-_DY614w_bxUCJU"  # public web client key
PROJECT = "nts-ios-app"


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "pyaar-radio-nts-sync"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode())


def _img(media):
    """Pick a square-ish artwork from an NTS media object."""
    if not media:
        return None
    for k in ("picture_large", "picture_medium_large", "background_large", "picture_medium"):
        if media.get(k):
            return media[k]
    return next((v for v in media.values() if isinstance(v, str) and v.startswith("http")), None)


def enrich_show(alias):
    try:
        d = _get(f"{API}/shows/{alias}")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        print(f"  ! show {alias}: {e}", file=sys.stderr)
        return None
    return {
        "alias": alias,
        "name": d.get("name") or alias,
        "description": (d.get("description") or "").strip(),
        "location": d.get("location_long") or d.get("location_short") or "",
        "image": _img(d.get("media")),
        "url": f"https://www.nts.live/shows/{alias}",
    }


def enrich_episode(show, slug):
    try:
        d = _get(f"{API}/shows/{show}/episodes/{slug}")
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as e:
        print(f"  ! episode {show}/{slug}: {e}", file=sys.stderr)
        return None
    return {
        "show": show,
        "alias": slug,
        "name": d.get("name") or slug,
        "description": (d.get("description") or "").strip(),
        "date": d.get("broadcast") or "",
        "location": d.get("location_long") or d.get("location_short") or "",
        "image": _img(d.get("media")),
        "audioSources": d.get("audio_sources") or [],
        "url": f"https://www.nts.live/shows/{show}/episodes/{slug}",
    }


def scrape_favourites():
    """CI path: render authenticated my-nts pages and scrape favourite aliases."""
    from playwright.sync_api import sync_playwright

    rt = os.environ.get("NTS_REFRESH_TOKEN")
    if not rt:
        sys.exit("NTS_REFRESH_TOKEN not set (needed to render authenticated favourites)")
    # Mint a fresh ID token from the durable refresh token.
    body = urllib.parse.urlencode({"grant_type": "refresh_token", "refresh_token": rt}).encode()
    req = urllib.request.Request(
        f"https://securetoken.googleapis.com/v1/token?key={APIKEY}", data=body,
        headers={"Content-Type": "application/x-www-form-urlencoded"})
    tok = json.loads(urllib.request.urlopen(req, timeout=25).read().decode())
    id_token, refresh_token = tok["id_token"], tok["refresh_token"]
    expires_at = int(time.time() * 1000) + int(tok.get("expires_in", 3600)) * 1000
    uid = tok["user_id"]

    # Seed the Firebase user record the web SDK reads from IndexedDB, before app JS runs.
    fb_user = {
        "uid": uid, "email": "", "emailVerified": False, "isAnonymous": False,
        "providerData": [], "apiKey": APIKEY, "appName": "[DEFAULT]",
        "stsTokenManager": {"refreshToken": refresh_token, "accessToken": id_token,
                            "expirationTime": expires_at},
    }
    init_js = (
        "const u=" + json.dumps(fb_user) + ";"
        "const open=indexedDB.open('firebaseLocalStorageDb');"
        "open.onupgradeneeded=()=>open.result.createObjectStore('firebaseLocalStorage',{keyPath:'fbase_key'});"
        "open.onsuccess=()=>{try{const db=open.result;"
        "db.transaction('firebaseLocalStorage','readwrite').objectStore('firebaseLocalStorage')"
        ".put({fbase_key:'firebase:authUser:'+u.apiKey+':[DEFAULT]',value:u});}catch(e){}};"
    )

    def scrape(page, selector_kind):
        anchors = page.eval_on_selector_all(
            "a[href*='/shows/']",
            "els => els.map(a => a.getAttribute('href'))",
        )
        return anchors

    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        ctx.add_init_script(init_js)
        page = ctx.new_page()
        shows, episodes, seen_s, seen_e = [], [], set(), set()
        import re
        for path, kind in (("shows", "show"), ("episodes", "episode")):
            # NTS keeps persistent Firestore connections open, so "networkidle"
            # never fires. Wait for DOM, then for the favourite anchors to render
            # (they appear client-side once Firebase auth resolves).
            page.goto(f"https://www.nts.live/my-nts/favourites/{path}", wait_until="domcontentloaded", timeout=60000)
            if "/sign-in" in page.url:
                sys.exit("auth failed: redirected to sign-in (NTS_REFRESH_TOKEN invalid/expired)")
            try:
                page.wait_for_selector("a[href*='/shows/']", timeout=25000)
            except Exception:
                pass  # an empty favourites list is legal — scrape whatever rendered
            page.wait_for_timeout(1500)
            hrefs = page.eval_on_selector_all("a[href*='/shows/']", "els=>els.map(a=>a.getAttribute('href'))")
            for h in hrefs or []:
                em = re.search(r"/shows/([^/]+)/episodes/([^/?#]+)", h or "")
                sm = re.match(r"^/shows/([^/?#]+)$", h or "")
                if em:
                    key = em.group(1) + "/" + em.group(2)
                    if key not in seen_e:
                        seen_e.add(key); episodes.append([em.group(1), em.group(2)])
                elif sm and sm.group(1) not in seen_s:
                    seen_s.add(sm.group(1)); shows.append(sm.group(1))
        browser.close()
    if not shows and not episodes:
        sys.exit("scrape returned no favourites (auth or render failure)")
    return {"shows": shows, "episodes": episodes}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--favourites", help="JSON file of already-captured favourites (skips browser)")
    args = ap.parse_args()

    if args.favourites:
        fav = json.loads(Path(args.favourites).read_text())
    else:
        fav = scrape_favourites()

    print(f"favourites: {len(fav['shows'])} shows, {len(fav['episodes'])} episodes")
    shows = [s for a in fav["shows"] if (s := enrich_show(a))]
    episodes = [e for pair in fav["episodes"] if (e := enrich_episode(pair[0], pair[1]))]

    out = {
        "syncedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "shows": shows,
        "episodes": episodes,
    }
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False))
    print(f"wrote {OUT.relative_to(REPO)}: {len(shows)} shows, {len(episodes)} episodes")


if __name__ == "__main__":
    main()
