"""Reconcile the alert queue against albums already in the YT Music library.

Radar's `known_albums` is seeded once and can drift: after a scan, the user may
save some flagged albums directly in YT Music. Those stay `status='new'` in the
alert queue and keep showing up in triage even though they're already owned.

`reconcile` refreshes that: it reads the current saved-album set (from
`albums/_index.json`, which `sync_albums.py` regenerates from
`yt.get_library_albums`) and marks any matching `new` alert as `saved`.

Matching is two-pass:
    1. Exact `browse_id` == saved album `browseId` — the same album, definitive.
    2. Loose `artist`+`title` (EP/deluxe/edition suffixes stripped) — catches the
       case where the liked copy has a different browseId than the one radar
       detected off the artist page.

Marking `saved` (not `dismissed`) is non-destructive and accurate — the user did
save these — and they move to the "Saved" section instead of the triage queue.
Run `sync_albums.py` first so the index reflects the current library.
"""

import json
from datetime import datetime, UTC

from .db import get_db, ALBUMS_DIR
from .release import export_alerts_json
from .verify import normalize_loose


def _load_saved_albums():
    """Return (browse_id set, {loose 'artist||title' key}) from albums/_index.json."""
    index_path = ALBUMS_DIR / "_index.json"
    if not index_path.exists():
        return set(), set()
    with open(index_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    ids, keys = set(), set()
    for a in data.get("albums", []):
        bid = a.get("browseId", "")
        if bid:
            ids.add(bid)
        art, title = a.get("artist", ""), a.get("title", "")
        if art and title:
            keys.add(f"{normalize_loose(art)}||{normalize_loose(title)}")
    return ids, keys


def run_reconcile(db, loose: bool = True) -> dict:
    """Mark `new` alerts that are already in the saved library as `saved`.
    Returns {"by_id": n, "by_title": n, "reconciled": [(artist,title,how)...]}."""
    saved_ids, saved_keys = _load_saved_albums()
    if not saved_ids and not saved_keys:
        print("No albums/_index.json found — run sync_albums.py first.")
        return {"by_id": 0, "by_title": 0, "reconciled": []}

    rows = db.execute(
        "SELECT id, artist, title, browse_id FROM release_alerts WHERE status = 'new'"
    ).fetchall()

    now = datetime.now(UTC)
    by_id = by_title = 0
    reconciled = []

    for aid, artist, title, browse_id in rows:
        how = None
        if browse_id and browse_id in saved_ids:
            how = "browseId"
            by_id += 1
        elif loose and f"{normalize_loose(artist)}||{normalize_loose(title)}" in saved_keys:
            how = "title"
            by_title += 1
        if how:
            db.execute(
                "UPDATE release_alerts SET status = 'saved', verified_at = ? WHERE id = ?",
                [now, aid],
            )
            reconciled.append((artist, title, how))

    return {"by_id": by_id, "by_title": by_title, "reconciled": reconciled}
