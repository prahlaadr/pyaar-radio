#!/usr/bin/env python3
"""
Copy a public Spotify playlist into a NEW YouTube Music playlist (Pyaar Radio account).

Reads the Spotify playlist WITHOUT any Spotify API credentials, via the public
embed endpoint:  open.spotify.com/embed/playlist/<id>  → parse the __NEXT_DATA__
JSON blob → pull `name` + `trackList` (each track = title + artists). Then uses
ytmusicapi to search each track, verify the match (title + artist overlap, no
karaoke/cover/tribute junk), create a playlist with the SAME name, and add the
matches. Unmatched tracks are printed explicitly — never silently dropped.

  python scripts/spotify_to_ytm.py <spotify_playlist_url_or_id>
  python scripts/spotify_to_ytm.py <url> --dry            # preview matches, create nothing
  python scripts/spotify_to_ytm.py <url> --name "Custom"  # override the YTM playlist name
  python scripts/spotify_to_ytm.py --from-pdf P288.pdf    # trivia packet: auto-pull the Round 5 Spotify link + verify the 8 answer songs

Auth: browser.json at the repo root (browser-cookie auth; OAuth is dead). Public
playlists only. Prints the matched/unmatched report and the new playlist URL.
"""
import re, sys, time, json, subprocess, urllib.request
from pathlib import Path
from ytmusicapi import YTMusic

AUTH = Path(__file__).resolve().parents[1] / "browser.json"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
# result-title words that signal a bad match (karaoke/cover/etc). Only reject if
# the word isn't in the Spotify title itself (so an intentional "Remix" survives).
BAD = ("karaoke", "tribute", "made famous", "instrumental", "sped up", "sped-up",
       "slowed", "nightcore", "8d audio", "cover version", "in the style of")


def parse_id(s):
    m = re.search(r"playlist[/:]([A-Za-z0-9]+)", s)
    return m.group(1) if m else s.strip()


def fetch_spotify(pid):
    """Return (playlist_name, [(title, artists), ...]) from the embed endpoint."""
    url = f"https://open.spotify.com/embed/playlist/{pid}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    html = urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "replace")
    m = re.search(r'__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.S)
    if not m:
        raise SystemExit("could not find __NEXT_DATA__ in embed page — is the playlist public?")
    entity = json.loads(m.group(1))["props"]["pageProps"]["state"]["data"]["entity"]
    name = entity.get("name") or entity.get("title") or "Spotify Playlist"
    tracks = [(t.get("title", "").strip(), (t.get("subtitle") or "").strip())
              for t in entity.get("trackList", []) if t.get("title")]
    return name, tracks


def extract_from_pdf(path):
    """NYC Trivia League packet → (spotify_playlist_url, [(answer_artist, song_title), ...]).

    The Round 5 answer table has one row per song: '<n> <Artist>   ...  Song Title = <Title>'.
    Those artists ARE the ground truth teams get points for, so we return them to self-verify.
    """
    txt = subprocess.run(["pdftotext", "-layout", path, "-"],
                         capture_output=True, text=True, check=True).stdout
    m = re.search(r"https://open\.spotify\.com/playlist/\S+", txt)
    if not m:
        raise SystemExit("no Spotify link found in the PDF — is this a trivia packet?")
    url = m.group(0).rstrip(".,)")
    answers = []
    for line in txt.splitlines():
        am = re.match(r"\s*\d+\s+(.+?)\s{2,}.*Song Title\s*=\s*(.+?)\s*$", line)
        if am:
            answers.append((am.group(1).strip(), am.group(2).strip()))
    return url, answers


def toks(s, minlen=2):
    return [t for t in re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split() if len(t) >= minlen]


def core_title(s):
    s = re.sub(r"\(.*?\)|\[.*?\]", " ", s or "")   # drop (feat. ...) / [remaster]
    s = re.split(r"\s[-–]\s", s)[0]                # drop " - Radio Edit" / " - Remastered"
    return s


def best_match(yt, title, artist):
    res = yt.search(f"{title} {artist}", filter="songs", limit=6) or []
    want_t = set(toks(core_title(title)))
    want_a = set(toks(artist))
    tlow = title.lower()
    best, best_score = None, -1.0
    for r in res:
        rt_full = r.get("title") or ""
        low = rt_full.lower()
        if any(b in low for b in BAD) and not any(b in tlow for b in BAD):
            continue
        rt = set(toks(core_title(rt_full)))
        ra = set(toks(" ".join(a.get("name", "") for a in r.get("artists", []))))
        t_frac = 1.0 if not want_t else len(want_t & rt) / len(want_t)
        a_ok = (not want_a) or bool(want_a & ra)
        score = t_frac + (0.5 if a_ok else 0.0)
        if t_frac >= 0.6 and a_ok and score > best_score:
            best, best_score = r, score
    return best


def main():
    argv = sys.argv[1:]
    dry = "--dry" in argv
    name_override, from_pdf = None, None
    if "--name" in argv:
        i = argv.index("--name"); name_override = argv[i + 1]; del argv[i:i + 2]
    if "--from-pdf" in argv:
        i = argv.index("--from-pdf"); from_pdf = argv[i + 1]; del argv[i:i + 2]
    argv = [a for a in argv if not a.startswith("--")]

    answers = []
    if from_pdf:
        url, answers = extract_from_pdf(from_pdf)
        pid = parse_id(url)
    elif argv:
        pid = parse_id(argv[0])
    else:
        raise SystemExit("usage: spotify_to_ytm.py <url|id> [--dry] [--name NAME]  |  --from-pdf <packet.pdf>")

    sp_name, tracks = fetch_spotify(pid)
    name = name_override or sp_name
    if not tracks:
        raise SystemExit("no tracks found in the Spotify playlist")
    if len(tracks) >= 100:
        print("!! WARNING: 100+ tracks — the Spotify embed can truncate large playlists.")
        print("   Verify the count against Spotify; if short, extract via the Playwright bridge.\n")

    yt = YTMusic(str(AUTH))
    acct = yt.get_account_info().get("accountName", "?")
    print(f'account: {acct}  |  Spotify "{sp_name}"  |  {len(tracks)} tracks  |  {"DRY RUN" if dry else "TRANSFER"}\n')

    matched, matched_results, misses = [], [], []
    for title, artist in tracks:
        m = best_match(yt, title, artist)
        if not m:
            misses.append((title, artist))
            print(f"  ??  {artist} - {title}  → NO CONFIDENT MATCH")
        else:
            got = f"{', '.join(a['name'] for a in m.get('artists', []))} - {m.get('title')}"
            matched.append(m["videoId"]); matched_results.append(m)
            print(f"  ok  {title}  →  {got}")
        time.sleep(0.3)  # pace searches (throttle hygiene)

    print(f"\nmatched {len(matched)}/{len(tracks)}  |  no match: {len(misses)}")
    if misses:
        print("unmatched (add by hand if wanted):")
        for a2, t2 in [(a, t) for t, a in misses]:
            print(f"    - {a2} - {t2}")

    if answers:  # --from-pdf: confirm the 8 scored Round 5 answers actually landed
        print("\nRound 5 answer check (the songs teams identify):")
        got = [(", ".join(a["name"] for a in r.get("artists", [])), r.get("title", "")) for r in matched_results]
        for a_art, a_title in answers:
            want_t, want_a = set(toks(core_title(a_title))), set(toks(a_art))
            ok = any(want_t and len(want_t & set(toks(core_title(gt)))) / len(want_t) >= 0.6
                     and (want_a & set(toks(ga))) for ga, gt in got)
            print(f"  {'✓' if ok else '⚠'}  {a_art} = {a_title}"
                  + ("" if ok else "   ← not clearly matched, resolve by hand"))

    if dry:
        print("\nDRY RUN — no playlist created.")
        return
    if not matched:
        raise SystemExit("nothing matched — not creating an empty playlist")

    pl_id = yt.create_playlist(name, f"Imported from Spotify playlist {pid}")
    if isinstance(pl_id, dict):  # some ytmusicapi versions return a dict on error
        raise SystemExit(f"create_playlist failed: {pl_id}")
    yt.add_playlist_items(pl_id, matched, duplicates=True)
    print(f'\n✓ created "{name}"  ({len(matched)} tracks)')
    print(f"  https://music.youtube.com/playlist?list={pl_id}")


if __name__ == "__main__":
    main()
