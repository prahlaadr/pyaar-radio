"""Verify radar release alerts against the Deezer catalog.

Answers one question per alert: "is this a real, official album by this artist,
or noise (OST / deluxe / live / comp) I should skip before adding to my library?"

Three verdicts, deliberately asymmetric:

    noise        Local pattern match — OST, deluxe, live, remix, compilation,
                 anniversary/expanded editions. Reliable REJECT, fully offline.
    verified     Positive match on a Deezer album/EP BY THIS ARTIST. Reliable
                 CONFIRM.
    unconfirmed  Clean title, artist-plausible, but not in Deezer's catalog for
                 that artist. A WEAK signal — a real new release can just be
                 un-indexed. The UI renders this neutral, never as "suspect."

Deezer is the sole confirmation source. Benchmarked 2026-07-06 against Discogs
and MusicBrainz (scripts/bench_verify_sources.py): Deezer won on both speed and
accuracy — 88% recall on the user's known-real saved albums + 70% on the hard
niche/new set, vs MusicBrainz 60%/0% and Discogs 36%/0%, at ~1s/lookup (Discogs
was ~3s). The Discogs/MusicBrainz helpers below are kept for the bench + as
fallbacks but are no longer in the verify path. No API key needed for any of them.
"""

import re
import sys
import time
from datetime import datetime, UTC
from urllib.parse import quote

import requests

from .classify_gaps import classify  # local noise classifier (regex, offline)

# ---------------------------------------------------------------------------
# Rate-limit pacing (per-request sleep). Discogs unauth: 25/min. MB: 1/sec.
# ---------------------------------------------------------------------------
UA = "PyaarRadio/1.0 (prahlaadram@gmail.com)"
DISCOGS_HEADERS = {"User-Agent": UA}
MB_HEADERS = {"User-Agent": UA}
DISCOGS_SLEEP = 2.5
MB_SLEEP = 1.1

# Titles matching these are NOT official studio releases (live/bootleg/remix/
# mix-comp/re-issue). Mirrors in_focus_audit.DROP_PATTERNS + memory:
# feedback-original-releases-only.
DROP_PATTERNS = [
    r"\blive at\b", r"\blive in\b", r"\blive from\b", r"\blive @\b",
    r"\blive session", r"\blive album\b", r"\(live\)", r"\blive in concert\b", r"\bb2b\b",
    r"\d{4}-\d{2}-\d{2}",
    r"\bremix\b", r"\bremixes\b", r"\bremixed by\b", r"\bedit pack\b",
    r"\bbootleg\b", r"\bunofficial\b",
    r"\bdj-?kicks\b", r"\bdj mix\b", r"\bfabric presents\b",
    r"\blate night tales\b", r"^ra\.\d+", r"\bresident advisor\b", r"\bpodcast\b",
    r"\bmixed by\b", r"\bcontinuous mix\b", r"\(mixed\)",
    r"\bdeluxe\b", r"\banniversary\b", r"\bexpanded edition\b",
    r"\bre-?issue\b", r"\(remastered\)",
    r"\bsoundtrack\b", r"\bmotion picture\b", r"\boriginal score\b", r"\bost\b",
    r"\bboiler room\b", r"\btomorrowland\b",
    r"\bessential mix\b", r"\bbbc essential\b",
]
DROP_RE = re.compile("|".join(DROP_PATTERNS), re.IGNORECASE)

# Strip these suffixes before loose-normalized dedupe (so "X" matches "X - EP").
EP_SUFFIX = re.compile(
    r"(\s*-\s*ep$|\s+ep$|\s*\(ep\)$|\s*-\s*single$|\s+single$|\s*\(single\)$"
    r"|\s+\(deluxe.*?\)$|\s+\(remastered.*?\)$|\s+\(.*?edition.*?\)$"
    r"|\s+\(.*?version.*?\)$|\s+\(complete works.*?\)$|\s+\(director'?s cut.*?\)$)",
    re.IGNORECASE,
)


def is_official(title: str) -> bool:
    """False if the title looks like live/bootleg/remix/mix-comp/re-issue."""
    return not DROP_RE.search(title or "")


def normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def normalize_loose(s: str) -> str:
    """Normalize with EP/single/deluxe/edition suffix stripped — fuzzier match."""
    s = EP_SUFFIX.sub("", (s or "").strip())
    return re.sub(r"[^a-z0-9]+", "", s.lower())


# ---------- Discogs ----------

def discogs_request(url):
    """GET with 429 backoff. Returns parsed JSON or None."""
    for _ in range(4):
        try:
            r = requests.get(url, headers=DISCOGS_HEADERS, timeout=20)
        except Exception as e:
            print(f"    discogs net error: {e}", flush=True)
            time.sleep(5)
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429:
            wait = int(r.headers.get("Retry-After", "60"))
            print(f"    discogs 429 — sleeping {wait}s", flush=True)
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


def discogs_album_titles(artist):
    """Return set of normalize_loose album titles by the canonical artist, or None
    if the artist could not be resolved on Discogs at all (distinct from 'found
    the artist, they have no album masters')."""
    artist_id, canonical = discogs_find_artist_id(artist)
    if not canonical:
        return None
    time.sleep(DISCOGS_SLEEP)
    data = discogs_request(
        f"https://api.discogs.com/database/search?artist={quote(artist)}&type=master&format=Album&per_page=50"
    )
    if not data:
        return set()
    titles = set()
    for r in data.get("results", []):
        title = r.get("title", "")
        if " - " not in title:
            continue
        d_artist, d_album = title.split(" - ", 1)
        if d_artist.strip() != canonical.strip():
            continue
        titles.add(normalize_loose(d_album))
    return titles


# ---------- MusicBrainz ----------

def mb_find_artist_mbid(artist):
    """MusicBrainz artist lookup by exact normalized name match (highest-scored)."""
    try:
        r = requests.get(
            f"https://musicbrainz.org/ws/2/artist/?query=artist:{quote(artist)}&fmt=json&limit=10",
            headers=MB_HEADERS, timeout=20,
        )
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception:
        return None
    a_norm = normalize(artist)
    candidates = [
        (a.get("score", 0), a.get("id"))
        for a in data.get("artists", [])
        if normalize(a.get("name", "")) == a_norm
    ]
    candidates.sort(reverse=True)
    return candidates[0][1] if candidates else None


def mb_release_group_titles(mbid):
    """Set of normalize_loose album/EP release-group titles for an MBID."""
    try:
        r = requests.get(
            f"https://musicbrainz.org/ws/2/release-group?artist={mbid}&type=album|ep&fmt=json&limit=100",
            headers=MB_HEADERS, timeout=20,
        )
        if r.status_code != 200:
            return set()
        data = r.json()
    except Exception:
        return set()
    return {normalize_loose(rg.get("title", "")) for rg in data.get("release-groups", [])}


# ---------- Deezer (no auth key, ~50 req / 5s) ----------

DEEZER_HEADERS = {"User-Agent": UA}
DEEZER_SLEEP = 0.3


def deezer_album_titles(artist):
    """Set of normalize_loose album/EP titles by the artist on Deezer, or None if
    the artist can't be resolved (exact normalized-name match required)."""
    try:
        r = requests.get(
            f"https://api.deezer.com/search/artist?q={quote(artist)}&limit=10",
            headers=DEEZER_HEADERS, timeout=20,
        )
        if r.status_code != 200:
            return None
        results = r.json().get("data", [])
    except Exception:
        return None
    a_norm = normalize(artist)
    artist_id = next((a.get("id") for a in results if normalize(a.get("name", "")) == a_norm), None)
    if not artist_id:
        return None
    time.sleep(DEEZER_SLEEP)
    try:
        r = requests.get(
            f"https://api.deezer.com/artist/{artist_id}/albums?limit=200",
            headers=DEEZER_HEADERS, timeout=20,
        )
        if r.status_code != 200:
            return set()
        data = r.json()
    except Exception:
        return set()
    return {
        normalize_loose(alb.get("title", ""))
        for alb in data.get("data", [])
        if alb.get("record_type") in ("album", "ep")
    }


# ---------- Per-artist catalog cache ----------

def _artist_catalog(artist, cache):
    """Return the artist's Deezer album/EP title set, cached, fetched at most once
    per run. None if the artist can't be resolved on Deezer.

    Deezer is the sole confirmation source — benchmarked 2026-07-06 as both the
    fastest and most accurate of Discogs/MusicBrainz/Deezer (88% recall on
    known-real + 70% on niche/new, vs MB 60%/0% and Discogs 36%/0%). The Discogs
    and MusicBrainz helpers above are retained for reference + the source bench
    (scripts/bench_verify_sources.py) but are no longer in the verify path."""
    if artist in cache:
        return cache[artist]
    titles = deezer_album_titles(artist)
    time.sleep(DEEZER_SLEEP)
    cache[artist] = titles
    return titles


def verify_one(artist, title, cache):
    """Return (status, source, note) for a single alert.

    status ∈ {'noise', 'verified', 'unconfirmed'}."""
    # 1. Offline reject — reliable. classify() catches comps/OST/derivative;
    #    is_official() catches live/bootleg/remix/deluxe/re-issue.
    label = classify(title, artist)
    if label != "candidate":
        return "noise", "local", label
    if not is_official(title):
        return "noise", "local", "derivative"

    # 2. Positive confirm against the Deezer catalog for this artist.
    catalog = _artist_catalog(artist, cache)
    if catalog and normalize_loose(title) in catalog:
        return "verified", "deezer", ""

    # 3. Clean title, not indexed — weak/neutral, NOT suspect.
    return "unconfirmed", "", ""


def run_verify(db, limit: int = 80, do_all: bool = False,
               reverify: bool = False, artist: str | None = None) -> dict:
    """Verify the current new-alert batch and persist verdicts. Returns counts."""
    where = ["status = 'new'"]
    params: list = []
    if not reverify:
        where.append("(verify_status IS NULL OR verify_status = '')")
    if artist:
        where.append("LOWER(artist) LIKE ?")
        params.append(f"%{artist.lower()}%")

    sql = (
        "SELECT id, artist, title FROM release_alerts "
        f"WHERE {' AND '.join(where)} ORDER BY detected_at DESC"
    )
    if not do_all:
        sql += f" LIMIT {int(limit)}"

    rows = db.execute(sql, params).fetchall()
    total = len(rows)
    if not total:
        print("Nothing to verify (all recent alerts already have a verdict — use --reverify to redo).", flush=True)
        return {"verified": 0, "unconfirmed": 0, "noise": 0, "total": 0}

    print(f"Verifying {total} alert{'s' if total != 1 else ''} against Discogs + MusicBrainz...\n", flush=True)

    cache: dict = {}
    counts = {"verified": 0, "unconfirmed": 0, "noise": 0}
    now = datetime.now(UTC)

    for i, (aid, art, title) in enumerate(rows):
        status, source, note = verify_one(art, title, cache)
        counts[status] += 1
        db.execute(
            "UPDATE release_alerts SET verify_status = ?, verify_source = ?, "
            "verify_note = ?, verified_at = ? WHERE id = ?",
            [status, source, note, now, aid],
        )
        badge = {"verified": "✓ verified", "unconfirmed": "? unconfirmed", "noise": "✗ noise"}[status]
        src = f" [{source}{':' + note if note else ''}]" if source else ""
        print(f"  [{i+1}/{total}] {badge}{src} — {art}: {title}", flush=True)

    counts["total"] = total
    return counts
