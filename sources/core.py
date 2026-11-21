#!/usr/bin/env python3
"""Shared engine for every "source -> one YT Music playlist" job.

A *source* is an adapter module that yields candidate items; this core does the
identical downstream work for all of them:

    adapter.groups(cfg)  ->  match each query to a YTM *song* (strict gate, no
    blind-adds)  ->  dedup (by normalized text AND videoId)  ->  batch-add to the
    source's playlist  ->  seal processed groups  ->  persist state (idempotent).

The only per-source code is the adapter (see adapters/). Everything here is shared.

A "group" is the adapter's unit of idempotency: a pi.fyi thread, a Bandcamp
release, etc. Each group is {id, date (YYYY-MM-DD), label, queries:[str]}.
Groups older than cfg["rescan_days"] get sealed (never re-scanned); younger ones
are re-scanned every run to catch late additions. Dedup makes re-scans cheap.

Matching is ported verbatim from the proven pi-fyi-sync pipeline:
  - "Title - Artist" / "Title (Artist)" answers must cover BOTH parts (order-
    agnostic) -> confident auto-add.
  - a bare single phrase is parked in `review`; the final promote pass then adds
    the obvious ones (A: named an exact artist, B: multi-word exact title) and
    leaves genuinely ambiguous single words (C) parked.
Karaoke/cover/kids results are blocklisted on title OR artist.
"""
import importlib, json, os, re, signal, sys, time
from datetime import datetime, timezone, timedelta
from ytmusicapi import YTMusic

HERE = os.path.dirname(os.path.abspath(__file__))
REGISTRY = os.path.join(HERE, "sources.json")
AUTH = os.path.join(os.path.dirname(HERE), "browser.json")   # written from secret in CI
STATE_DIR = os.path.join(HERE, "state")

BAD = ("karaoke", "tribute", "made famous", "as made popular", "originally performed",
       "instrumental", "sped up", "sped-up", "slowed", "nightcore", "8d audio",
       "8 bit", "8-bit", "cover version", "in the style of", "hit crew", "kidz bop",
       "children's music", "toddler", "lullaby", "ringtone", "countdown singers",
       "lullabies", "baby sleep", "music box")
QUALIFIER = re.compile(r"^\s*(feat|ft|featuring|prod|with|deluxe|remaster|remastered|live|"
                       r"remix|edit|version|acoustic|demo|mono|stereo|bonus)\b", re.I)

def log(m): print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {m}", flush=True)
def _watchdog(_s, _f): log("WATCHDOG: run exceeded 45 min, aborting (state saved, resumable)"); os._exit(1)

# ---------- matching primitives ----------
def toks(s, n=2): return [t for t in re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).split() if len(t) >= n]
def title_core(s): return re.split(r"\s-\s", re.sub(r"\(.*?\)|\[.*?\]", " ", s or ""))[0]
def key(s): return " ".join(sorted(set(toks(s))))
def _cover(want, have):
    want, have = set(want), set(have)
    return bool(want) and len(want & have) / len(want) >= 0.7

def split_parts(q):
    """(A,B) if the query clearly names a title and an artist, else None."""
    if " - " in q:
        a, b = (x.strip() for x in q.split(" - ", 1))
        return (a, b) if a and b else None
    m = re.match(r"^(.*?)\s*\((.+)\)\s*$", q)
    if m and m.group(1).strip() and not QUALIFIER.match(m.group(2)):
        return m.group(1).strip(), m.group(2).strip()
    return None

def match_song(yt, q):
    """Confident YTM song match dict (with `single` flag), else None."""
    res = [r for r in (yt.search(q, filter="songs", limit=6) or []) if r.get("videoId")]
    qlow = q.lower()
    def ok(r):
        blob = (r.get("title", "") + " " + " ".join(a.get("name", "") for a in r.get("artists", []))).lower()
        return not (any(b in blob for b in BAD) and not any(b in qlow for b in BAD))
    def pack(r, single):
        return {"videoId": r["videoId"], "title": r.get("title", ""),
                "artist": ", ".join(a["name"] for a in r.get("artists", []) if a.get("name")),
                "single": single}
    def rtt(r): return set(toks(title_core(r.get("title", ""))))
    def rat(r): return set(toks(" ".join(a.get("name", "") for a in r.get("artists", []))))

    parts = split_parts(q)
    if parts:
        tA, tB = toks(parts[0]), toks(parts[1])
        for r in res:
            if ok(r) and ((_cover(tA, rtt(r)) and _cover(tB, rat(r))) or
                          (_cover(tB, rtt(r)) and _cover(tA, rat(r)))):
                return pack(r, False)
        return None
    tl = toks(q)
    if not tl: return None
    for r in res:
        if not ok(r): continue
        if toks(title_core(r.get("title", ""))) == tl or set(tl) == rat(r):
            return pack(r, True)
    return None

def _klass(v):
    """Classify a review entry for the obvious-promotion pass."""
    tP = toks(v.get("query", "")); at = set(toks(v.get("artist", ""))); tt = toks(title_core(v.get("title", "")))
    if tP and set(tP) == at and at: return "A"   # named an exact artist
    if len(tP) >= 2 and tP == tt:   return "B"   # multi-word exact title
    return "C"                                   # single/ambiguous -> stay parked

# ---------- state ----------
def load_state(sid):
    p = os.path.join(STATE_DIR, f"{sid}.json")
    s = json.load(open(p)) if os.path.exists(p) else {}
    s.setdefault("playlist_id", None); s.setdefault("sealed", {}); s.setdefault("songs", {})
    s.setdefault("video_ids", []); s.setdefault("review", {}); s.setdefault("missing", {})
    return s

def save_state(sid, s, dry):
    if dry: return
    os.makedirs(STATE_DIR, exist_ok=True)
    json.dump(s, open(os.path.join(STATE_DIR, f"{sid}.json"), "w"), indent=1, ensure_ascii=False)

# ---------- run one source ----------
def run(sid, dry=False, limit_cap=5000):
    cfg = json.load(open(REGISTRY))[sid]
    adapter = importlib.import_module(f"adapters.{cfg['adapter']}")
    rescan_days = int(cfg.get("rescan_days", 0))
    yt = YTMusic(AUTH)
    state = load_state(sid)
    if not state["playlist_id"]:
        state["playlist_id"] = cfg.get("playlist_id")
    cutoff_seal = (datetime.now(timezone.utc) - timedelta(days=rescan_days)).date().isoformat()
    vids = set(state["video_ids"])
    seen = set(state["songs"]) | set(state["review"]) | set(state["missing"])
    pending, added_total = [], 0

    def flush():
        if not pending or dry: pending.clear(); return
        ids = [m["videoId"] for _, m in pending]
        ok = False
        try:
            r = yt.add_playlist_items(state["playlist_id"], ids, duplicates=False)
            ok = (r.get("status") if isinstance(r, dict) else r) == "STATUS_SUCCEEDED"
        except Exception as e:
            log(f"  batch add error: {str(e)[:50]}")
        if ok:
            for k, m in pending: state["songs"][k] = m; vids.add(m["videoId"])
        else:
            log(f"  batch failed, per-item retry ({len(pending)})")
            for k, m in pending:
                got = False
                for a in range(3):
                    try:
                        r = yt.add_playlist_items(state["playlist_id"], [m["videoId"]], duplicates=False)
                        if (r.get("status") if isinstance(r, dict) else r) == "STATUS_SUCCEEDED": got = True; break
                    except Exception: pass
                    time.sleep(3 * (a + 1))
                if got: state["songs"][k] = m; vids.add(m["videoId"])
                time.sleep(0.5)
        state["video_ids"] = sorted(vids); pending.clear(); save_state(sid, state, dry)

    since = cfg.get("since")
    for g in adapter.list_groups(cfg):
        if since and g["date"] < since: continue
        if g["id"] in state["sealed"]: continue
        try:
            queries = adapter.fetch_queries(cfg, g)
        except Exception as e:
            log(f"[{g['date']}] fetch failed ({str(e)[:50]}), skipping this run"); continue
        new_here = 0
        for q in queries:
            if not q: continue
            k = key(q)
            if not k or k in seen: continue
            seen.add(k)
            if len(state["songs"]) + len(pending) >= limit_cap:
                log(f"  cap {limit_cap} reached; not adding more"); break
            try:
                m = match_song(yt, q)
            except Exception as e:
                log(f"  search error '{q[:40]}': {str(e)[:40]}"); time.sleep(3); continue
            if m and m.get("single"):
                state["review"][k] = {"query": q, "group": g["date"], **m}
                if dry: log(f"  ?? {q[:48]} -> review ({m['artist']} - {m['title']})")
            elif m and m["videoId"] not in vids:
                if not dry and not state["playlist_id"]:
                    state["playlist_id"] = yt.create_playlist(cfg["playlist_name"], cfg.get("playlist_desc", ""))
                    save_state(sid, state, dry); log(f"created playlist {state['playlist_id']}")
                m["group"] = g["date"]
                pending.append((k, m)); new_here += 1; added_total += 1
                if dry: log(f"  ok {q[:48]} -> {m['artist']} - {m['title']}")
            elif m:
                state["songs"].setdefault(k, {**m, "group": g["date"]})
            else:
                state["missing"][k] = q
            if len(pending) >= 40: flush()
            time.sleep(0.4)
        flush()
        if rescan_days == 0 or g["date"] < cutoff_seal:
            state["sealed"][g["id"]] = g["date"]
        save_state(sid, state, dry)
        log(f"[{g['date']}] {str(g['label'])[:34]} | {len(queries)} queries | +{new_here} new"
            + ("" if (rescan_days == 0 or g['date'] < cutoff_seal) else "  (recent, will re-scan)"))

    # ---- promote the obvious review entries (A + B); leave ambiguous (C) parked ----
    promote = []
    for k, v in list(state["review"].items()):
        if _klass(v) in ("A", "B") and v.get("videoId") and v["videoId"] not in vids:
            promote.append((k, v))
    seen_v, uniq = set(), []
    for k, v in promote:
        if v["videoId"] in seen_v: continue
        seen_v.add(v["videoId"]); uniq.append((k, v))
    if uniq and not dry:
        for i in range(0, len(uniq), 40):
            chunk = uniq[i:i + 40]
            ok = False
            try:
                r = yt.add_playlist_items(state["playlist_id"], [v["videoId"] for _, v in chunk], duplicates=False)
                ok = (r.get("status") if isinstance(r, dict) else r) == "STATUS_SUCCEEDED"
            except Exception as e:
                log(f"  promote batch error: {str(e)[:50]}")
            for k, v in chunk:
                if ok:
                    state["songs"][k] = {**v}; state["review"].pop(k, None); vids.add(v["videoId"])
                else:
                    for a in range(3):
                        try:
                            r = yt.add_playlist_items(state["playlist_id"], [v["videoId"]], duplicates=False)
                            if (r.get("status") if isinstance(r, dict) else r) == "STATUS_SUCCEEDED":
                                state["songs"][k] = {**v}; state["review"].pop(k, None); vids.add(v["videoId"]); break
                        except Exception: pass
                        time.sleep(3 * (a + 1))
            state["video_ids"] = sorted(vids); save_state(sid, state, dry); time.sleep(0.5)

    url = f"https://music.youtube.com/playlist?list={state['playlist_id']}" if state["playlist_id"] else "(no playlist yet)"
    log(f"done [{sid}]: +{added_total} added this run | total {len(state['songs'])} | "
        f"{len(state['review'])} review | {len(state['missing'])} missing -> {url}")

def main():
    argv = sys.argv[1:]
    dry = "--dry" in argv
    ids = [a for a in argv if not a.startswith("--")]
    if not ids: ids = list(json.load(open(REGISTRY)).keys())
    signal.signal(signal.SIGALRM, _watchdog); signal.alarm(2700)
    failed = []
    for sid in ids:
        log(f"=== source: {sid}{' (dry)' if dry else ''} ===")
        try:
            run(sid, dry=dry)
        except Exception as e:
            failed.append(sid); log(f"!! source {sid} failed: {str(e)[:140]} (other sources + commit continue)")
    if failed: log(f"sources with errors (resume next run): {', '.join(failed)}")

if __name__ == "__main__":
    main()
