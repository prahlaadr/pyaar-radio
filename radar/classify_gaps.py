"""Classify audit_gap rows by signal quality.

Default: read-only report.
With --dismiss: bulk-dismiss derivative/compilation/themed_comp rows (clear noise).
"""

import argparse
import re
from collections import Counter, defaultdict
from .db import get_db

NOISE_CLASSES = {"derivative", "compilation", "themed_comp"}

PATTERNS = [
    ("derivative", re.compile(
        r"\((Instrumentals?|Karaoke|Acapella|Acoustic|Remix(es)?|Reprise|Demo|Demos|Live|Jhankar|Stems|A cappella)\)"
        r"|Anniversary Edition|\bDeluxe Edition\b|\bExpanded Edition\b|\bRemastered\b"
        r"|\(Edited\)|\(Clean\)|\(Explicit\)|Bonus Edition|Single\)$",
        re.IGNORECASE,
    )),
    ("compilation", re.compile(
        r"\b(Greatest Hits|Best Of|The Best of|Top \d+|Number 1'?s|Hits Collection|Hit Collection|Essential|"
        r"Collection|Anthology|Retrospective|Compilation|All The Hits|Singles Collection|Singles & Rarities|"
        r"20th Century Masters|Millennium Collection|FM Broadcasts|Now That's What I Call|Evergreen|Mono Singles)\b",
        re.IGNORECASE,
    )),
    ("themed_comp", re.compile(
        r"\b(Christmas|Eid Mubarak|Diwali|Holi|Republic Day|Independence Day|Valentine|Workout|Party Hits|"
        r"Birthday Special|Wedding|Romantic Hits|Dance Floor|Late Night|Chill Out|Road Trip|Summer Vibes|"
        r"Monsoon|Maestro Melodies|Power Workout|Top 15 Songs|Golden Hits)\b",
        re.IGNORECASE,
    )),
    ("vol_series", re.compile(r"\bVol(\.|ume)\s*\d+\b", re.IGNORECASE)),
    ("ost", re.compile(r"\(Original (Motion Picture |Background )?(Soundtrack|Score)\)", re.IGNORECASE)),
    ("bonus_score", re.compile(r"\(Original Background Score\)|Music From The Movie", re.IGNORECASE)),
]

# Artists that are actually label/aggregator channels — flag for special handling
LABEL_CHANNELS = {"RAAJA BEATS", "CHOR BAZAAR"}


def classify(title: str, artist: str) -> str:
    for label, pat in PATTERNS:
        if pat.search(title):
            return label
    return "candidate"


def main():
    parser = argparse.ArgumentParser(description="Classify audit_gap rows")
    parser.add_argument("--dismiss", action="store_true", help="Bulk-dismiss derivative/compilation/themed_comp rows")
    parser.add_argument("--dismiss-label-channels", action="store_true", help="Also dismiss all rows from RAAJA BEATS / CHOR BAZAAR")
    args = parser.parse_args()

    db = get_db()
    rows = db.execute(
        "SELECT id, artist, title, year FROM release_alerts WHERE release_type='audit_gap' AND status='new'"
    ).fetchall()

    by_class: Counter = Counter()
    by_artist_class: dict = defaultdict(Counter)
    samples: dict = defaultdict(list)
    label_channel_rows = []

    for row in rows:
        rid, artist, title, year = row
        cls = classify(title, artist)
        by_class[cls] += 1
        by_artist_class[artist][cls] += 1
        if len(samples[cls]) < 8:
            samples[cls].append(f"  {artist}: {title} ({year})")
        if artist in LABEL_CHANNELS:
            label_channel_rows.append((artist, title, year, cls))

    print(f"=== {len(rows)} audit_gap rows classified ===\n")
    for cls, count in by_class.most_common():
        pct = 100 * count / len(rows)
        print(f"  {cls:15s} {count:5d}  ({pct:5.1f}%)")

    print("\n=== Sample titles per class ===")
    for cls in by_class:
        print(f"\n[{cls}] ({by_class[cls]} total)")
        for s in samples[cls]:
            print(s)

    print("\n=== Top 20 artists by gap count, with class breakdown ===")
    artist_totals = sorted(by_artist_class.items(), key=lambda x: -sum(x[1].values()))[:20]
    print(f"  {'artist':<25s} {'total':>6s} {'cand':>6s} {'ost':>6s} {'comp':>6s} {'theme':>6s} {'deriv':>6s} {'vol':>6s} {'score':>6s}")
    for artist, classes in artist_totals:
        total = sum(classes.values())
        print(f"  {artist:<25s} {total:>6d} "
              f"{classes.get('candidate', 0):>6d} {classes.get('ost', 0):>6d} "
              f"{classes.get('compilation', 0):>6d} {classes.get('themed_comp', 0):>6d} "
              f"{classes.get('derivative', 0):>6d} {classes.get('vol_series', 0):>6d} "
              f"{classes.get('bonus_score', 0):>6d}")

    print(f"\n=== Label-channel artists ({len(LABEL_CHANNELS)} flagged) ===")
    label_by_artist = defaultdict(Counter)
    for artist, title, year, cls in label_channel_rows:
        label_by_artist[artist][cls] += 1
    for artist, classes in label_by_artist.items():
        print(f"  {artist}: {sum(classes.values())} total — {dict(classes)}")
    print("\n  Recommendation: drop label-channel artists from artists.csv (film-composer catalogs don't fit album tracking).")

    if args.dismiss or args.dismiss_label_channels:
        print("\n=== Applying dismissals ===")
        ids_to_dismiss = []
        for row in rows:
            rid, artist, title, year = row
            cls = classify(title, artist)
            if args.dismiss and cls in NOISE_CLASSES:
                ids_to_dismiss.append(rid)
            elif args.dismiss_label_channels and artist in LABEL_CHANNELS:
                ids_to_dismiss.append(rid)
        if ids_to_dismiss:
            db.executemany(
                "UPDATE release_alerts SET status='dismissed' WHERE id=?",
                [(i,) for i in ids_to_dismiss],
            )
            print(f"  Dismissed {len(ids_to_dismiss)} row{'s' if len(ids_to_dismiss) != 1 else ''}.")
            from .release import export_alerts_json
            count = export_alerts_json(db)
            print(f"  Re-exported radar-alerts.json: {count} active alerts")
        else:
            print("  No rows matched dismissal criteria.")

    db.close()


if __name__ == "__main__":
    main()
