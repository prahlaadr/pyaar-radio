#!/usr/bin/env python3
"""Adapter: pi.fyi "WHAT HAVE YOU BEEN LISTENING TO?" weekly threads.

A recommendation feed: people post free-text song mentions. We enumerate the
threads via pi.fyi's public GraphQL feed and scrape each thread's top answers
from the ask page's server-rendered JSON-LD. Headless, no browser, no LLM.

Groups = threads. Queries = cleaned-up answer blurbs (messy, so most go through
core's review + obvious-promotion gate). Falls back to a committed threads.json
if the GraphQL feed changes.
"""
import html, json, os, re, time, urllib.request, urllib.error

DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # sources/
THREADS = os.path.join(DIR, "threads.json")
FEED_Q = os.path.join(DIR, "feed_query.json")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
PREFIXES = ("i love ", "i'm obsessed with ", "obsessed with ", "currently obsessed with ",
            "been listening to ", "listening to ", "currently ", "my beloved ", "literally ")

def _req(url, data=None):
    h = {"User-Agent": UA}
    if data is not None:
        h.update({"Content-Type": "application/json", "Origin": "https://www.pi.fyi",
                  "Referer": "https://www.pi.fyi/"})
        data = json.dumps(data).encode()
    return urllib.request.Request(url, data=data, headers=h)

def _fetch(url, data=None, tries=5):
    for a in range(tries):
        try:
            with urllib.request.urlopen(_req(url, data), timeout=40) as r:
                raw = r.read().decode("utf-8", "replace")
                return json.loads(raw) if data is not None else raw
        except urllib.error.HTTPError as e:
            if e.code == 429:
                wait = 60
                try: wait = int(e.headers.get("retry-after", 60))
                except Exception: pass
                time.sleep(wait + 2); continue
            if a == tries - 1: raise
            time.sleep(5 * (a + 1))
        except Exception:
            if a == tries - 1: raise
            time.sleep(5 * (a + 1))

def list_groups(cfg):
    """All listening threads newest-first; persist threads.json, fall back to it."""
    try:
        rec = json.load(open(FEED_Q))
        after, out, pages = None, [], 0
        while pages < 40:
            v = dict(rec["variables_template"]); v["first"] = 50; v["after"] = after
            j = _fetch(rec["endpoint"], {"operationName": rec["operationName"], "query": rec["query"], "variables": v})
            conn = (j.get("data") or {}).get("genericFeedInfiniteScroll")
            if not conn: break
            for e in conn["edges"]:
                p = (e.get("node") or {}).get("targetPrompt")
                if p and re.search(r"WHAT HAVE YOU BEEN LISTENING TO", p.get("title", ""), re.I):
                    out.append({"id": p["id"], "date": e["node"]["createdAt"][:10], "label": p["title"]})
            pages += 1
            if not conn["pageInfo"]["hasNextPage"]: break
            after = conn["pageInfo"]["endCursor"]; time.sleep(0.4)
        if out:
            json.dump({"count": len(out), "source": "@perfectlyimperfect asks feed (NEW_PROMPT)",
                       "threads": out}, open(THREADS, "w"), indent=2)
            return out
    except Exception:
        pass
    return json.load(open(THREADS))["threads"]

def _answer_query(text):
    """Reduce an answer blurb to a YT-searchable 'Title - Artist'-ish string."""
    first = next((ln.strip() for ln in text.splitlines() if ln.strip()), "")
    if not first or re.fullmatch(r"https?://\S+", first): return None
    first = first.replace("“", '"').replace("”", '"').replace("’", "'")
    first = re.sub(r"\s*[—–]\s*", " - ", first)
    if " - " not in first:
        first = re.sub(r"\s+by\s+", " - ", first, count=1, flags=re.I)
    first = re.sub(r'["]', " ", first)
    first = re.sub(r"\s+", " ", first).strip(" -,")
    low = first.lower()
    for p in PREFIXES:
        if low.startswith(p): first = first[len(p):].strip(); break
    return first or None

def fetch_queries(cfg, group):
    """Top answers for one thread, each reduced to a search string."""
    h = _fetch(f"https://www.pi.fyi/ask/{group['id']}")
    m = re.search(r'<script[^>]*type="application/ld\+json"[^>]*>(.*?)</script>', h, re.S)
    if not m: return []
    try: d = json.loads(m.group(1))
    except Exception: return []
    out = []
    for c in d.get("comment", []):
        t = html.unescape((c.get("text") or "").strip())
        if not t: continue
        q = _answer_query(t)
        if q: out.append(q)
    return out
