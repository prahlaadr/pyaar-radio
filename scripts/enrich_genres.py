#!/usr/bin/env python3
"""
Genre enrichment via Discogs styles → NTS ontology.

Fills the blank `Genres` column for tracks the user values (liked songs first) by
looking each up on Discogs and writing its curated *styles* (which are the same
vocabulary as NTS subgenres, so the existing nts-genre-map catches them and they
surface under the NTS filters).

Two decoupled stages so a multi-hour Discogs run never races CI's daily masterlist
append (writing the 84K-row CSV in place across that window would collide):

  1. fetch  → writes staging (Video ID → "style1,style2"), resumable
  2. merge  → fill-blank-only into a FRESH masterlist, keyed by Video ID

Accuracy (per the user's requirement) lives in release selection: a release's
styles are accepted only when its artist verifies (exact normalized match) and the
title isn't a live/bootleg/remix/comp. No match → stays blank (never guessed).

Usage:
  python scripts/enrich_genres.py fetch --sample 50      # validate: report, no writes
  python scripts/enrich_genres.py fetch                  # full liked-blank run (resumable)
  python scripts/enrich_genres.py merge                  # staging → masterlist (fill-blank)

Set DISCOGS_TOKEN for 60/min (vs 25/min unauth).
"""
import argparse, csv, json, os, re, sys, time, urllib.parse, urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MASTERLIST = REPO / "public" / "data" / "masterlist.csv"
STAGING = REPO / "scripts" / "enrich-staging.json"
ALBUMS_INDEX = REPO / "albums" / "_index.json"
ALBUM_GENRES = REPO / "public" / "data" / "album-genres.json"  # browseId → NTS genres

UA = "PyaarRadio/1.0 (prahlaadram@gmail.com)"
TOKEN = os.environ.get("DISCOGS_TOKEN", "")
SLEEP = 1.1 if TOKEN else 2.5  # Discogs: 60/min authed, 25/min unauth
# `or` (not get-default): CI sets LASTFM_API_KEY to "" when the secret is absent,
# which would otherwise beat the fallback and leave Last.fm keyless.
LASTFM_KEY = os.environ.get("LASTFM_API_KEY") or "6dd04270e3049b0100d626c154d39079"
LASTFM_SLEEP = 0.25

# Live/bootleg/remix/comp/reissue titles are not the artist's studio styling.
DROP_RE = re.compile(
    r"\blive\b|\bremix|\bbootleg\b|\bunofficial\b|\bdj[- ]?kicks\b|\bdj mix\b|"
    r"\bmixed by\b|\bessential mix\b|\bdeluxe\b|\banniversary\b|\bre-?issue\b|"
    r"\bsoundtrack\b|\bost\b|\d{4}-\d{2}-\d{2}", re.IGNORECASE)


def normalize(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def primary_artist(s):
    """First/primary artist from a multi-artist credit, for Discogs/Last.fm lookup.
    `;` is the masterlist's separator (comma stays inside a name), so split there
    first. Otherwise split on ` & ` or a comma-LIST (>=2 commas or ', and ') — but
    NOT a single comma, so a name like 'Tyler, The Creator' survives intact."""
    s = (s or "").strip()
    if ";" in s:
        return s.split(";")[0].strip()
    if " & " in s:
        return s.split(" & ")[0].strip()
    if ", and " in s or s.count(",") >= 2:
        return s.split(",")[0].strip()
    return s


# --- Discogs style → NTS ontology crosswalk (accuracy gate) -------------------
# Only styles that resolve to a real NTS subgenre/top get written; everything else
# is dropped, so every enriched label is NTS-accurate by construction.
_NTS_SUBS = None       # set of NTS subgenre names (lowercased)
_NTS_TOPS = None       # set of NTS top-genre names (lowercased)

def _load_nts():
    global _NTS_SUBS, _NTS_TOPS
    if _NTS_SUBS is None:
        req = urllib.request.Request("https://www.nts.live/api/v2/genres", headers={"User-Agent": UA})
        data = json.loads(urllib.request.urlopen(req, timeout=25).read().decode())
        _NTS_SUBS = {s["name"].strip().lower() for g in data["results"] for s in g.get("subgenres", [])}
        _NTS_TOPS = {g["name"].strip().lower() for g in data["results"]}
    return _NTS_SUBS, _NTS_TOPS

# Discogs styles whose name differs from NTS but map cleanly to an NTS subgenre.
DISCOGS_ALIAS = {
    "britpop": "indie rock", "indie pop": "indie rock", "shoegaze": "shoegaze",
    "contemporary r&b": "rhythm & blues", "rnb/swing": "new jack swing",
    "neo soul": "soul", "pop rap": "rap", "gangsta": "gangsta rap",
    "conscious": "rap", "boom bap": "hip hop", "leftfield": "electronica",
    "downtempo": "electronica", "abstract": "electronica", "idm": "electronica",
    "hindustani": "indian classical", "carnatic": "indian classical",
    "bollywood": "bollywood", "filmi": "bollywood", "bhangra": "bhangra",
    "disco": "classic disco", "nu-disco": "cosmic disco", "boogie": "boogie",
    "afrobeat": "afrobeat", "afro-cuban": "afro cuban jazz",
    "blues rock": "blues", "country rock": "country", "folk rock": "folk",
    "soft rock": "soft rock", "psychedelic rock": "psychedelic rock",
    "deep house": "deep house", "tech house": "tech house", "dub techno": "dub techno",
    "future jazz": "nu jazz", "jazz-funk": "jazz funk", "soul-jazz": "soul jazz",
    "drum n bass": "drum & bass", "drum and bass": "drum & bass",
    # Last.fm tag spellings / shorthands
    "hip-hop": "hip hop", "electronic": "electronica", "indie": "indie rock",
    "fusion": "jazz fusion", "post-bop": "post bop", "trip-hop": "trip hop",
    "uk garage": "garage", "future garage": "garage", "nu-jazz": "nu jazz",
    "psychedelic": "psychedelic rock", "post-punk": "post punk", "new-wave": "new wave",
    "dnb": "drum & bass", "alternative hip-hop": "alternative hip hop",
    "rnb": "rnb", "r&b": "rnb", "neo-soul": "soul",
}
# Non-genre / production descriptors — never a genre.
DROP = {"instrumental", "acoustic", "vocal", "ballad", "spoken word", "score",
        "remix", "edit", "dj mix", "field recording", "poetry", "interview"}

def style_to_nts(style):
    """A Discogs style → its NTS token (lowercased), or None to drop."""
    s = style.strip().lower()
    if s in DROP:
        return None
    subs, tops = _load_nts()
    if s in subs or s in tops:
        return s
    if s in DISCOGS_ALIAS:
        return DISCOGS_ALIAS[s]
    return None


def discogs_get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for _ in range(4):
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = int(e.headers.get("Retry-After", "60"))
                print(f"    429 — sleeping {wait}s", flush=True)
                time.sleep(wait + 1)
                continue
            return None
        except Exception as e:
            print(f"    net error: {e}", flush=True)
            time.sleep(5)
    return None


_LFM_CACHE = {}  # artist(lower) → [nts tokens]

def lastfm_nts(artist):
    """Last.fm artist-level top tags → NTS tokens (cached per artist). Coverage
    fallback for tracks Discogs misses; genre ≈ artist's genre. Only tags with
    real weight that survive the NTS crosswalk are kept (noise like 'seen live',
    'atlanta' is dropped)."""
    key = artist.lower()
    if key in _LFM_CACHE:
        return _LFM_CACHE[key]
    url = (f"https://ws.audioscrobbler.com/2.0/?method=artist.getTopTags"
           f"&artist={urllib.parse.quote(artist)}&api_key={LASTFM_KEY}&format=json&autocorrect=1")
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    tags = []
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            tags = json.loads(r.read().decode()).get("toptags", {}).get("tag", [])
    except Exception:
        pass
    nts, seen = [], set()
    for t in tags:
        if int(t.get("count", 0)) < 15:  # weak/noise weight
            continue
        m = style_to_nts(t.get("name", ""))
        if m and m not in seen:
            seen.add(m); nts.append(m)
        if len(nts) >= 4:
            break
    _LFM_CACHE[key] = nts
    return nts


def styles_for(artist, value, field="track"):
    """Return (nts_tokens, raw_styles, chosen_release_title) for the artist's own
    official release matching `value` on Discogs `field` (track name or
    release_title for albums), or ([], [], None) when nothing verifies. Styles are
    voted across matching releases (freq desc) so a one-off comp mislabel can't
    dominate, then gated through the NTS crosswalk."""
    q = f"https://api.discogs.com/database/search?artist={urllib.parse.quote(artist)}&{field}={urllib.parse.quote(value)}&type=release&per_page=25"
    if TOKEN:
        q += f"&token={TOKEN}"
    data = discogs_get(q)
    if not data:
        return [], [], None
    a_norm = normalize(artist)
    freq, chosen = {}, None
    for r in data.get("results", []):
        title = r.get("title", "")
        if " - " not in title or DROP_RE.search(title):
            continue
        d_artist = title.split(" - ", 1)[0]
        # strip Discogs disambiguation suffix "Artist (3)"
        d_artist = re.sub(r"\s*\(\d+\)\s*$", "", d_artist).strip()
        if normalize(d_artist) != a_norm:
            continue
        sts = r.get("style") or []
        if sts and chosen is None:
            chosen = title
        for s in sts:
            freq[s] = freq.get(s, 0) + 1
    if not freq:
        return [], [], None
    # keep styles that recur (>=2) or, if none recur, the chosen release's styles.
    ordered = sorted(freq, key=lambda s: (-freq[s], s))
    voted = ([s for s in ordered if freq[s] >= 2] or ordered[:3])[:5]
    # gate through the NTS crosswalk: keep only NTS-accurate labels
    nts, seen = [], set()
    for s in voted:
        m = style_to_nts(s)
        if m and m not in seen:
            seen.add(m); nts.append(m)
    return nts, voted, chosen


def target_rows(rows):
    for i, r in enumerate(rows):
        if (r.get("Liked") or "").strip().lower() == "yes" and not (r.get("Genres") or "").strip():
            yield i, r


def cmd_fetch(sample, lastfm):
    with open(MASTERLIST, newline="") as f:
        rows = list(csv.DictReader(f))
    staging = json.loads(STAGING.read_text()) if STAGING.exists() else {}
    targets = list(target_rows(rows))
    if sample:
        targets = targets[:sample]
    src = "last.fm (artist tags)" if lastfm else "discogs (release styles)"
    print(f"targets: {len(targets)} liked+blank | already staged: {len(staging)} | source: {src}", flush=True)
    done = hit = 0
    for idx, r in targets:
        vid = (r.get("Video ID") or "").strip()
        if not vid or (vid in staging and not sample):
            continue
        artist = primary_artist(r.get("Artist Name(s)") or "")
        track = (r.get("Track Name") or "").strip()
        if lastfm:
            nts = lastfm_nts(artist); raw, rel = nts, None
        else:
            nts, raw, rel = styles_for(artist, track)
        done += 1
        if nts:
            hit += 1
            if not sample:
                staging[vid] = ",".join(nts)
        if sample:
            print(f"  {artist} - {track}\n      {'lastfm' if lastfm else 'discogs'}: {', '.join(raw) if raw else '—'}"
                  f"  →  NTS: {', '.join(nts) if nts else '— (blank)'}", flush=True)
        elif done % 25 == 0:
            STAGING.write_text(json.dumps(staging, indent=0))
            print(f"    {done} processed, {hit} matched", flush=True)
        time.sleep(LASTFM_SLEEP if lastfm else SLEEP)
    if not sample:
        STAGING.write_text(json.dumps(staging, indent=0))
    print(f"done: {done} processed, {hit} matched ({100*hit//max(done,1)}%)", flush=True)


def cmd_merge():
    staging = json.loads(STAGING.read_text()) if STAGING.exists() else {}
    if not staging:
        print("staging empty — nothing to merge"); return
    with open(MASTERLIST, newline="") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames
        rows = list(reader)
    filled = 0
    for r in rows:
        vid = (r.get("Video ID") or "").strip()
        if vid in staging and not (r.get("Genres") or "").strip():
            r["Genres"] = staging[vid]
            filled += 1
    with open(MASTERLIST, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader(); w.writerows(rows)
    print(f"merged: filled {filled} blank Genres from {len(staging)} staged")


def cmd_albums(sample, lastfm):
    """Album-level enrichment: one Discogs (release_title) or Last.fm (artist)
    lookup per saved album → NTS genres, applied to the whole album. Writes the
    deployable public/data/album-genres.json {browseId → genres} directly
    (resumable, no masterlist involvement)."""
    albums = json.loads(ALBUMS_INDEX.read_text()).get("albums", [])
    out = json.loads(ALBUM_GENRES.read_text()) if ALBUM_GENRES.exists() else {}
    if sample:
        albums = albums[:sample]
    src = "last.fm (artist tags)" if lastfm else "discogs (release styles)"
    print(f"albums: {len(albums)} | already done: {len(out)} | source: {src}", flush=True)
    done = hit = 0
    for a in albums:
        bid = a.get("browseId", "")
        if not bid or (bid in out and not sample):
            continue
        artist = (a.get("artist") or "").split(",")[0].strip()
        title = (a.get("title") or "").strip()
        if lastfm:
            nts = lastfm_nts(artist); raw, rel = nts, None
        else:
            nts, raw, rel = styles_for(artist, title, "release_title")
        done += 1
        if nts:
            hit += 1
            if not sample:
                out[bid] = ",".join(nts)
        if sample:
            print(f"  {artist} - {title}\n      {'lastfm' if lastfm else 'discogs'}: {', '.join(raw) if raw else '—'}"
                  f"  →  NTS: {', '.join(nts) if nts else '— (blank)'}", flush=True)
        elif done % 25 == 0:
            ALBUM_GENRES.write_text(json.dumps(out, indent=0))
            print(f"    {done} processed, {hit} matched", flush=True)
        time.sleep(LASTFM_SLEEP if lastfm else SLEEP)
    if not sample:
        ALBUM_GENRES.write_text(json.dumps(out, indent=0))
    print(f"done: {done} processed, {hit} matched ({100*hit//max(done,1)}%)", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["fetch", "merge", "albums"])
    ap.add_argument("--sample", type=int, default=0, help="process only N, report, no writes")
    ap.add_argument("--lastfm", action="store_true", help="use Last.fm artist tags (coverage pass)")
    a = ap.parse_args()
    if a.cmd == "fetch":
        cmd_fetch(a.sample, a.lastfm)
    elif a.cmd == "albums":
        cmd_albums(a.sample, a.lastfm)
    else:
        cmd_merge()
