#!/usr/bin/env python3
"""Deterministic tests proving the sources framework + channels wiring.

No network: exercises the pure match/parse logic and validates the registry +
channels files. Run from anywhere:

    python sources/test_sources.py      # exit 0 = all pass

Live scraping/matching is covered by `--dry` runs of core.py, not here (this stays
fast and offline so it can gate CI).
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

import core
from adapters import pifyi
from adapters import bandcamp_label as bc

PASS = FAIL = 0
def check(name, cond):
    global PASS, FAIL
    if cond: PASS += 1
    else: FAIL += 1; print(f"  FAIL: {name}")

# ---- match gate (the precision core) ----
check("split_parts dash", core.split_parts("Prologue - Proxima") == ("Prologue", "Proxima"))
check("split_parts paren", core.split_parts("Teardrop (Massive Attack)") == ("Teardrop", "Massive Attack"))
check("split_parts ignores feat paren", core.split_parts("Teardrop (feat. Liz Fraser)") is None)
check("split_parts single phrase", core.split_parts("Crush") is None)
check("key is order-agnostic", core.key("Prologue - Proxima") == core.key("proxima prologue"))
check("_cover >=70pct true", core._cover(["a", "b", "c", "d"], ["a", "b", "c", "z"]) is True)
check("_cover <70pct false", core._cover(["a", "b", "c"], ["a", "x", "y"]) is False)
check("_klass A = named artist", core._klass({"query": "proxima", "artist": "Proxima", "title": "Gravity"}) == "A")
check("_klass B = multiword title", core._klass({"query": "crystal lake", "artist": "CoKi", "title": "Crystal Lake"}) == "B")
check("_klass C = single/ambiguous", core._klass({"query": "crush", "artist": "Yuno", "title": "Crush"}) == "C")

# ---- pifyi adapter (feed cleanup) ----
check("pifyi 'X by Y' -> 'X - Y'", pifyi._answer_query("i love Teardrop by Massive Attack") == "Teardrop - Massive Attack")
check("pifyi url -> None", pifyi._answer_query("https://x.y/z") is None)
check("pifyi strips lead-in", pifyi._answer_query("obsessed with Gravity - Proxima") == "Gravity - Proxima")

# ---- bandcamp adapter (bot-challenge guard + date parse) ----
check("bc _valid rejects short", bc._valid("x" * 100) is False)
check("bc _valid accepts real page", bc._valid("<html>" + "a" * 6000 + "</html>") is True)
check("bc _valid rejects fastly challenge", bc._valid("_fs-ch-" + "a" * 6000) is False)
check("bc date iso", bc._norm_date("2016-03-25") == "2016-03-25")
check("bc date bandcamp fmt", bc._norm_date("25 Mar 2016 00:00:00 GMT") == "2016-03-25")

# ---- sources registry ----
sources = json.load(open(os.path.join(HERE, "sources.json")))
for sid, cfg in sources.items():
    check(f"source[{sid}] has adapter", bool(cfg.get("adapter")))
    check(f"source[{sid}] has playlist_name", bool(cfg.get("playlist_name")))

# ---- channels registry (what the app's Channels tab reads) ----
channels = json.load(open(os.path.join(ROOT, "public", "data", "channels.json")))["channels"]
check("channels non-empty", len(channels) > 0)
seen = set()
for ch in channels:
    cid = ch.get("id")
    check(f"channel[{cid}] unique id", cid not in seen); seen.add(cid)
    check(f"channel[{cid}] playlistId looks valid", isinstance(ch.get("playlistId"), str) and ch["playlistId"].startswith("PL"))
    check(f"channel[{cid}] has name", bool(ch.get("name")))
    # no em dashes anywhere (house rule)
    check(f"channel[{cid}] no em dash", "—" not in json.dumps(ch, ensure_ascii=False))
    if ch.get("synced"):
        src = ch.get("source")
        check(f"channel[{cid}] synced has source", bool(src))
        # framework-owned channels must resolve to a real source; crate-maker is external
        if src in ("pifyi", "tempa"):
            check(f"channel[{cid}] framework source exists", src in sources)
        else:
            check(f"channel[{cid}] external source tagged", src == "crate-maker")

# ---- state integrity (the pifyi floor holds; no stale pre-floor tracks) ----
st = json.load(open(os.path.join(HERE, "state", "pifyi.json")))
def td(m): return m.get("thread") or m.get("group") or ""
floor = sources["pifyi"].get("since") or "0000-00-00"
check("pifyi state respects floor", all(td(m) >= floor for m in st["songs"].values() if td(m)))
check("pifyi video_ids match unique songs", len(st["video_ids"]) == len({m["videoId"] for m in st["songs"].values()}))

print(f"\n{PASS} passed, {FAIL} failed")
sys.exit(1 if FAIL else 0)
