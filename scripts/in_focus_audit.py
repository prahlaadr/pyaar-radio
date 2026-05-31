#!/usr/bin/env python3
"""In Focus producer album audit — multi-source.

Given a list of producers (default: data/in_focus_producers.txt), finds their
top releases via Discogs → MusicBrainz → YT Music artist page, resolves each
to a YT Music browseId, dedupes against the existing albums.csv library, and
writes a triage-runs JSON ready for the triage-apply workflow.

Usage:
    .venv/bin/python scripts/in_focus_audit.py
    .venv/bin/python scripts/in_focus_audit.py --producers data/in_focus_producers.txt
    .venv/bin/python scripts/in_focus_audit.py --top-n 5 --min-tracks 3
    .venv/bin/python scripts/in_focus_audit.py --output triage-runs/custom-name.json
    .venv/bin/python scripts/in_focus_audit.py --lexar-cross-check   # also scan local Lexar folders

Then apply:
    gh workflow run triage-apply.yml -f triage_path=<output> -f mode=apply -f run_sync=true

Sources, in priority order:
    1. Discogs (artist-ID disambiguated) — best for established artists with
       multiple full-length albums. Filters to format=Album masters.
    2. MusicBrainz — best for EP-heavy or newer producers. type=album|ep.
    3. YT Music artist page — final fallback. Includes singles + EPs + albums.

Filtering:
    - trackCount >= MIN_TRACKS (default 3) — drops singles miscategorized as albums
    - Artist match on parsed Discogs/MB result must equal canonical (handles
      "Salute (6)" vs "The Magpie Salute" disambiguation problem)
    - Deduped against existing albums.csv browseIds + (artist, title) keys

The triage_apply.py script handles the actual YT Music library save via
rate_playlist(LIKE), and the sync_albums.py downstream regenerates
albums.csv + albums/*.json — same flow as the radar pipeline.
"""

import argparse
import csv
import json
import re
import sys
import time
from datetime import date
from pathlib import Path
from urllib.parse import quote

import requests
from ytmusicapi import YTMusic

PROJECT_DIR = Path(__file__).resolve().parent.parent
BROWSER_AUTH = PROJECT_DIR / "browser.json"
ALBUMS_CSV = PROJECT_DIR / "public" / "data" / "albums.csv"
ALBUMS_INDEX = PROJECT_DIR / "albums" / "_index.json"
PRODUCERS_DEFAULT = PROJECT_DIR / "data" / "in_focus_producers.txt"
LEXAR_PRODUCERS = Path("/Volumes/vision 1/DJ/In Focus/Producers")

UA = "PyaarRadio/1.0 (prahlaadram@gmail.com)"
DISCOGS_HEADERS = {"User-Agent": UA}
MB_HEADERS = {"User-Agent": UA}

# Rate-limit pacing (per-request sleep). Discogs unauth: 25/min. MB: 1/sec.
DISCOGS_SLEEP = 2.5
MB_SLEEP = 1.1
YT_SLEEP = 0.3

# Drop patterns — release titles matching these are NOT official studio releases.
# Filters out live recordings, bootlegs, remix albums, mix-comps, re-issues.
# See memory: feedback-original-releases-only.
DROP_PATTERNS = [
    r"\blive at\b", r"\blive in\b", r"\blive from\b", r"\blive @\b",
    r"^live ", r" live$", r" live\.", r"\blive in concert\b", r"\bb2b\b",
    r"\d{4}-\d{2}-\d{2}",                          # bootleg date prefix
    r"\bremix\b", r"\bremixes\b", r"\bremixed by\b", r"\bedit pack\b",
    r"\bbootleg\b", r"\bunofficial\b",
    r"\bdj-?kicks\b", r"\bdj mix\b", r"\bfabric presents\b",
    r"\blate night tales\b", r"^ra\.\d+", r"\bresident advisor\b", r"\bpodcast\b",
    r"\bmixed by\b", r"\bcontinuous mix\b", r"\(mixed\)",
    r"\bdeluxe\b", r"\banniversary\b", r"\bexpanded edition\b",
    r"\bre-?issue\b", r"\(remastered\)",
    r"\bboiler room\b", r"\btomorrowland\b", r"\balexandra palace\b",
    r"\bdrumsheds\b", r"\bwarehouse project\b", r"\bsónar\b",
    r"\bessential mix\b", r"\bbbc essential\b",
]
DROP_RE = re.compile("|".join(DROP_PATTERNS), re.IGNORECASE)

# Strip these suffixes before doing loose-normalized dedupe (so "X" matches "X - EP")
EP_SUFFIX = re.compile(
    r"(\s*-\s*ep$|\s+ep$|\s*\(ep\)$|\s*-\s*single$|\s+single$|\s*\(single\)$"
    r"|\s+\(deluxe.*?\)$|\s+\(remastered.*?\)$|\s+\(.*?edition.*?\)$)",
    re.IGNORECASE,
)


def is_official(title: str) -> bool:
    """Return False if title looks like a live/bootleg/remix/mix-comp/re-issue."""
    return not DROP_RE.search(title or "")


def normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def normalize_loose(s: str) -> str:
    """Normalize with EP/single/deluxe suffix stripped — for fuzzier dedupe."""
    s = EP_SUFFIX.sub("", (s or "").strip())
    return re.sub(r"[^a-z0-9]+", "", s.lower())


# ---------- Discogs ----------

def discogs_request(url):
    """GET with 429 backoff. Returns parsed JSON or None."""
    for _ in range(4):
        try:
            r = requests.get(url, headers=DISCOGS_HEADERS, timeout=20)
        except Exception as e:
            print(f"    discogs net error: {e}")
            time.sleep(5)
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", "60"))
            print(f"    discogs 429 — sleeping {wait}s")
            time.sleep(wait + 1)
            continue
        return None
    return None


def discogs_find_artist_id(artist):
    """Resolve canonical Discogs artist_id by exact normalized name match.
    Strips disambiguation suffix ('Mala (4)' -> 'Mala') before matching."""
    data = discogs_request(
        f"https://api.discogs.com/database/search?q={quote(artist)}&type=artist&per_page=15"
    )
    if not data:
        return None, None
    a_norm = normalize(artist)
    for r in data.get("results", []):
        title = r.get("title", "")
        base = re.sub(r"\s*\(\d+\)\s*$", "", title).strip()
        if normalize(base) == a_norm:
            return r.get("id"), title
    return None, None


def discogs_albums(artist):
    """Returns (albums, canonical_name). Albums sorted by community popularity."""
    artist_id, canonical = discogs_find_artist_id(artist)
    if not canonical:
        return [], None
    time.sleep(DISCOGS_SLEEP)
    # Search masters with format=Album using the artist name — then filter to
    # only the canonical artist (handles multiple artists sharing a name).
    data = discogs_request(
        f"https://api.discogs.com/database/search?artist={quote(artist)}&type=master&format=Album&per_page=50"
    )
    if not data:
        return [], canonical
    out = []
    for r in data.get("results", []):
        title = r.get("title", "")
        if " - " not in title:
            continue
        d_artist, d_album = title.split(" - ", 1)
        if d_artist.strip() != canonical.strip():
            continue
        out.append({
            "title": d_album.strip(),
            "year": str(r.get("year", "")),
            "have": r.get("community", {}).get("have", 0),
        })
    # Dedupe by normalized title, keep most-have
    seen = {}
    for a in out:
        k = normalize(a["title"])
        if k not in seen or a["have"] > seen[k]["have"]:
            seen[k] = a
    deduped = sorted(seen.values(), key=lambda x: -x.get("have", 0))
    return deduped, canonical


# ---------- MusicBrainz ----------

def mb_find_artist_mbid(artist):
    """MusicBrainz artist lookup by exact normalized name match (highest-scored)."""
    try:
        r = requests.get(
            f"https://musicbrainz.org/ws/2/artist/?query=artist:{quote(artist)}&fmt=json&limit=10",
            headers=MB_HEADERS, timeout=20,
        )
        if r.status_code != 200:
            return None, None
        data = r.json()
    except Exception:
        return None, None
    a_norm = normalize(artist)
    candidates = [
        (a.get("score", 0), a.get("id"), a.get("name"))
        for a in data.get("artists", [])
        if normalize(a.get("name", "")) == a_norm
    ]
    candidates.sort(reverse=True)
    return (candidates[0][1], candidates[0][2]) if candidates else (None, None)


def mb_release_groups(mbid):
    """Get release-groups (albums + EPs) for an MBID, newest first."""
    try:
        r = requests.get(
            f"https://musicbrainz.org/ws/2/release-group?artist={mbid}&type=album|ep&fmt=json&limit=100",
            headers=MB_HEADERS, timeout=20,
        )
        if r.status_code != 200:
            return []
        data = r.json()
    except Exception:
        return []
    rgs = [
        {"title": rg.get("title", ""), "type": rg.get("primary-type", ""),
         "date": rg.get("first-release-date", ""), "mbid": rg.get("id")}
        for rg in data.get("release-groups", [])
    ]
    rgs.sort(key=lambda x: x.get("date", "0000"), reverse=True)
    return rgs


# ---------- YT Music ----------

def yt_resolve_album(yt, artist, title):
    """Search YT Music for {artist} {title}, return best matching album."""
    for filt in ("albums", None):
        try:
            results = yt.search(f"{artist} {title}", filter=filt, limit=8)
        except Exception:
            continue
        a_norm = normalize(artist)
        t_norm = normalize(title)
        for r in results:
            if r.get("resultType") not in ("album", None) and r.get("category") != "Albums":
                continue
            cands = [normalize(a.get("name", "")) for a in r.get("artists", []) if a.get("name")]
            if not any(
                a_norm == c or (len(a_norm) >= 4 and a_norm in c) or (len(c) >= 4 and c in a_norm)
                for c in cands
            ):
                continue
            r_title = normalize(r.get("title", ""))
            if t_norm in r_title or r_title in t_norm:
                bid = r.get("browseId")
                if bid and bid.startswith("MPRE"):
                    return {"title": r.get("title", ""), "browseId": bid, "year": str(r.get("year", ""))}
    return None


def yt_artist_page_albums(yt, artist):
    """Fall-back: YT Music's own artist-page albums + singles tabs."""
    try:
        ar = yt.search(artist, filter="artists", limit=3)
    except Exception:
        return []
    a_norm = normalize(artist)
    browse = next(
        (a.get("browseId") for a in ar if normalize(a.get("artist", "") or a.get("title", "")) == a_norm),
        ar[0].get("browseId") if ar else None,
    )
    if not browse:
        return []
    try:
        ap = yt.get_artist(browse)
    except Exception:
        return []
    out = []
    for section in ("albums", "singles"):
        for it in (ap.get(section) or {}).get("results", []):
            bid = it.get("browseId")
            if bid and bid.startswith("MPRE"):
                out.append({"title": it.get("title", ""), "browseId": bid, "year": str(it.get("year", ""))})
    return out


def yt_track_count(yt, browse_id):
    """Real track count for a browseId. Returns 0 on error."""
    try:
        a = yt.get_album(browse_id)
        return a.get("trackCount") or len(a.get("tracks") or [])
    except Exception:
        return 0


# ---------- Lexar cross-check (optional) ----------

def lexar_tracks(producer):
    """Return list of (filename_artist, filename_title) for producer's Lexar folder."""
    folder = LEXAR_PRODUCERS / producer
    if not folder.exists():
        return []
    out = []
    for f in folder.iterdir():
        if f.name.startswith("._") or f.suffix.lower() not in (".mp3", ".flac", ".opus", ".m4a"):
            continue
        stem = f.stem
        if " - " not in stem:
            continue
        a, t = stem.split(" - ", 1)
        if normalize(producer) in normalize(a):
            out.append((a.strip(), t.strip()))
    return out


def yt_resolve_song_to_album(yt, artist, title):
    """Find a track on YT Music and return its parent album browseId if it has one."""
    try:
        results = yt.search(f"{artist} {title}", filter="songs", limit=5)
    except Exception:
        return None
    a_norm = normalize(artist)
    t_norm = normalize(title)
    for r in results:
        cands = [normalize(a.get("name", "")) for a in r.get("artists", []) if a.get("name")]
        if not any(a_norm in c or c in a_norm for c in cands if c):
            continue
        r_title = normalize(r.get("title", ""))
        if t_norm not in r_title and r_title not in t_norm:
            continue
        alb = r.get("album") or {}
        bid = alb.get("id")
        if bid and bid.startswith("MPRE"):
            return {"browseId": bid, "title": alb.get("name", "")}
    return None


# ---------- Library state ----------

def load_existing():
    """Return (saved browseId set, saved (artist_norm, loose_title_norm) set).

    Uses loose normalization so 'X - EP' in albums.csv matches 'X' from a
    fresh source query — without this, EP-suffix variants get re-saved."""
    saved_bids = set()
    saved_keys = set()
    if ALBUMS_INDEX.exists():
        idx = json.loads(ALBUMS_INDEX.read_text())
        for a in idx.get("albums", []):
            if a.get("browseId"):
                saved_bids.add(a["browseId"])
            saved_keys.add((normalize(a.get("artist", "")), normalize_loose(a.get("title", ""))))
    if ALBUMS_CSV.exists():
        with open(ALBUMS_CSV) as f:
            for row in csv.DictReader(f):
                if row.get("browseId"):
                    saved_bids.add(row["browseId"])
                saved_keys.add((normalize(row.get("artist", "")), normalize_loose(row.get("title", ""))))
    return saved_bids, saved_keys


# ---------- Pipeline ----------

def find_candidates(yt, artist, top_n):
    """Run multi-source lookup for one producer. Returns list of {title, browseId, year, _origin}."""
    candidates = []
    seen = set()

    # Source 1: Discogs masters with format=Album
    discogs, canonical = discogs_albums(artist)
    time.sleep(DISCOGS_SLEEP)
    for d in discogs[:top_n * 2]:
        if len(candidates) >= top_n:
            break
        m = yt_resolve_album(yt, artist, d["title"])
        time.sleep(YT_SLEEP)
        if m and m["browseId"] not in seen:
            candidates.append({**m, "_origin": "discogs",
                                "year": m["year"] or d.get("year", "")})
            seen.add(m["browseId"])

    # Source 2: MusicBrainz release-groups (helps EP-heavy producers)
    if len(candidates) < top_n:
        mbid, _ = mb_find_artist_mbid(artist)
        time.sleep(MB_SLEEP)
        if mbid:
            for rg in mb_release_groups(mbid)[:top_n * 2]:
                if len(candidates) >= top_n:
                    break
                if rg.get("type") not in ("Album", "EP"):
                    continue
                m = yt_resolve_album(yt, artist, rg["title"])
                time.sleep(YT_SLEEP)
                if m and m["browseId"] not in seen:
                    candidates.append({**m, "_origin": f"mb/{rg['type']}",
                                        "year": m["year"] or rg["date"][:4]})
                    seen.add(m["browseId"])
            time.sleep(MB_SLEEP)

    # Source 3: YT Music artist page (final fallback)
    if len(candidates) < top_n:
        for a in yt_artist_page_albums(yt, artist):
            if len(candidates) >= top_n:
                break
            if a["browseId"] in seen:
                continue
            candidates.append({**a, "_origin": "yt_artist_page"})
            seen.add(a["browseId"])

    return candidates, canonical


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--producers", type=Path, default=PRODUCERS_DEFAULT,
                    help=f"Path to producers list (one per line). Default: {PRODUCERS_DEFAULT.relative_to(PROJECT_DIR)}")
    ap.add_argument("--top-n", type=int, default=5, help="Max picks per artist (default 5)")
    ap.add_argument("--min-tracks", type=int, default=3, help="Filter out releases with fewer tracks (default 3)")
    ap.add_argument("--output", type=Path, default=None,
                    help=f"Output triage JSON path. Default: triage-runs/in-focus-YYYY-MM-DD.json")
    ap.add_argument("--lexar-cross-check", action="store_true",
                    help="Also cross-reference local Lexar /In Focus/Producers/ filenames")
    args = ap.parse_args()

    if not BROWSER_AUTH.exists():
        print(f"ERROR: {BROWSER_AUTH} missing — refresh per CLAUDE.md 'Refreshing auth'")
        sys.exit(1)
    if not args.producers.exists():
        print(f"ERROR: producers list not found: {args.producers}")
        sys.exit(1)

    # Read producer list (skip comments + blanks)
    producers = []
    for line in args.producers.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            producers.append(line)
    print(f"Producers: {len(producers)}")

    yt = YTMusic(str(BROWSER_AUTH))
    saved_bids, saved_keys = load_existing()
    print(f"Existing library: {len(saved_bids)} browseIds, {len(saved_keys)} (artist,title) keys\n")

    picks = []
    per_artist_summary = {}

    for i, producer in enumerate(producers, 1):
        print(f"[{i}/{len(producers)}] {producer}")
        candidates, canonical = find_candidates(yt, producer, args.top_n)
        print(f"  found: {len(candidates)} candidates (canonical: {canonical or '—'})")

        # Optional: Lexar cross-check
        if args.lexar_cross_check:
            seen_bids = {c["browseId"] for c in candidates}
            for fn_artist, fn_title in lexar_tracks(producer):
                if len(candidates) >= args.top_n:
                    break
                m = yt_resolve_song_to_album(yt, producer, fn_title)
                time.sleep(YT_SLEEP)
                if m and m["browseId"] not in seen_bids:
                    candidates.append({"title": m["title"], "browseId": m["browseId"],
                                        "year": "", "_origin": "lexar"})
                    seen_bids.add(m["browseId"])

        # Filter: official-only + trackCount + dedupe vs existing library
        kept = []
        for c in candidates:
            if not is_official(c["title"]):
                print(f"     · skip (non-official): {c['title']}")
                continue
            bid = c["browseId"]
            key = (normalize(producer), normalize_loose(c["title"]))
            if bid in saved_bids or key in saved_keys:
                continue
            tc = yt_track_count(yt, bid)
            time.sleep(YT_SLEEP)
            if tc < args.min_tracks:
                print(f"     · skip (tracks={tc}): {c['title']}")
                continue
            c["_trackCount"] = tc
            kept.append(c)

        for c in kept:
            picks.append({
                "artist": producer, "title": c["title"], "year": c.get("year", ""),
                "source": "manual_add", "browseId": c["browseId"],
                "_origin": c.get("_origin", ""), "_trackCount": c.get("_trackCount", 0),
            })
            print(f"     ✓ {c['title']} ({c.get('year','')}) [{c['_origin']}] tracks={c['_trackCount']}")

        per_artist_summary[producer] = {
            "canonical": canonical, "candidates": len(candidates), "saved": len(kept),
        }

    # Write triage JSON
    out_path = args.output or (PROJECT_DIR / "triage-runs" / f"in-focus-{date.today().isoformat()}.json")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    triage = {
        "exportedAt": date.today().isoformat() + "T00:00:00Z",
        "counts": {"total": len(picks), "save": len(picks), "skip": 0, "pending": 0},
        "save": picks,
        "_meta": {
            "producers_file": str(args.producers.relative_to(PROJECT_DIR)),
            "top_n": args.top_n, "min_tracks": args.min_tracks,
            "lexar_cross_check": args.lexar_cross_check,
            "per_artist": per_artist_summary,
        },
    }
    out_path.write_text(json.dumps(triage, indent=2))
    print(f"\nWrote {out_path.relative_to(PROJECT_DIR)}")
    print(f"Total picks: {len(picks)}")

    zeros = [a for a, s in per_artist_summary.items() if s["saved"] == 0]
    if zeros:
        print(f"\n{len(zeros)} producers with 0 new picks (already at library cap or no matches):")
        for a in zeros:
            s = per_artist_summary[a]
            print(f"  · {a:<25.25} canonical={s['canonical'] or '—'} candidates={s['candidates']}")

    print("\nNext step:")
    print(f"  gh workflow run triage-apply.yml \\")
    print(f"    -f triage_path={out_path.relative_to(PROJECT_DIR)} \\")
    print(f"    -f mode=apply -f run_sync=true")


if __name__ == "__main__":
    main()
