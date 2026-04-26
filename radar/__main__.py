"""Pyaar Radar CLI.

Usage:
    python -m radar seed                          # Seed known_albums from albums/*.json
    python -m radar release                       # Check curated artists for new releases
    python -m radar release --save                # Auto-save new releases to YT Music
    python -m radar release --artist "Flying Lotus"
    python -m radar audit                         # Full discography audit — all back-catalog gaps
    python -m radar audit --save                  # Auto-save every gap to YT Music
    python -m radar audit --artist "Flying Lotus" # Audit a single artist
    python -m radar audit --since 2010            # Only flag gaps from this year onward
    python -m radar classify                      # Report on audit_gap quality
    python -m radar classify --dismiss            # Bulk-dismiss derivative/comp/themed_comp noise
    python -m radar classify --dismiss-label-channels  # Dismiss known label-channel rows
    python -m radar report                        # Show release_alerts log
    python -m radar query "SELECT ..."            # Ad-hoc DuckDB query
    python -m radar crate                         # List crate entries
    python -m radar crate add "Artist" --album "Album" --source "NTS"
    python -m radar crate promote "Artist"        # Mark as promoted (ready for artists.csv)
    python -m radar crate skip "Artist"           # Dismiss from crate
"""

import argparse
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).parent.parent
BROWSER_AUTH_PATH = PROJECT_DIR / "browser.json"


def cmd_seed(args):
    from .db import get_db, seed_from_albums

    db = get_db()
    count = seed_from_albums(db)
    total = db.execute("SELECT COUNT(*) FROM known_albums").fetchone()[0]
    print(f"Seeded {count} new albums. Total known: {total}")
    db.close()


def cmd_release(args):
    from ytmusicapi import YTMusic
    from .db import get_db
    from .release import load_artists, check_releases, format_report, export_alerts_json

    if not BROWSER_AUTH_PATH.exists():
        print("ERROR: No browser.json found.")
        sys.exit(1)

    db = get_db()

    # Auto-seed if empty
    total = db.execute("SELECT COUNT(*) FROM known_albums").fetchone()[0]
    if total == 0:
        print("No known albums found — seeding from albums/*.json...")
        from .db import seed_from_albums
        count = seed_from_albums(db)
        print(f"Seeded {count} albums.\n")

    artists = load_artists(args.artist)
    if not artists:
        print(f"No artist found matching: {args.artist}" if args.artist else "No artists in artists.csv")
        sys.exit(1)

    print(f"Checking {len(artists)} artist{'s' if len(artists) != 1 else ''}...\n")

    yt = YTMusic(str(BROWSER_AUTH_PATH))
    new_releases = check_releases(db, yt, artists, save=args.save)

    report = format_report(new_releases, len(artists))
    print(f"\n{'=' * 60}")
    print(report)

    # Export for frontend
    count = export_alerts_json(db)
    if count:
        print(f"\nExported {count} alerts to radar-alerts.json")

    db.close()


def cmd_audit(args):
    from ytmusicapi import YTMusic
    from .db import get_db
    from .release import load_artists, check_discography, export_alerts_json

    if not BROWSER_AUTH_PATH.exists():
        print("ERROR: No browser.json found.")
        sys.exit(1)

    db = get_db()

    total = db.execute("SELECT COUNT(*) FROM known_albums").fetchone()[0]
    if total == 0:
        print("No known albums found — seeding from albums/*.json...")
        from .db import seed_from_albums
        count = seed_from_albums(db)
        print(f"Seeded {count} albums.\n")

    artists = load_artists(args.artist)
    if not artists:
        print(f"No artist found matching: {args.artist}" if args.artist else "No artists in artists.csv")
        sys.exit(1)

    print(f"Auditing {len(artists)} artist{'s' if len(artists) != 1 else ''} (full discography)...\n")

    yt = YTMusic(str(BROWSER_AUTH_PATH))
    gaps = check_discography(db, yt, artists, save=args.save, min_year=args.since)

    print(f"\n{'=' * 60}")
    print(f"Audit complete: {len(gaps)} gap{'s' if len(gaps) != 1 else ''} found across {len(artists)} artist{'s' if len(artists) != 1 else ''}.")
    if gaps:
        by_artist = {}
        for g in gaps:
            by_artist.setdefault(g["artist"], []).append(g)
        for artist, items in sorted(by_artist.items(), key=lambda x: -len(x[1]))[:20]:
            print(f"  {artist}: {len(items)} missing")

    count = export_alerts_json(db)
    if count:
        print(f"\nExported {count} alerts to radar-alerts.json")

    db.close()


def cmd_report(args):
    from .db import get_db

    db = get_db()
    rows = db.execute(
        "SELECT artist, title, year, release_type, status, detected_at FROM release_alerts ORDER BY detected_at DESC LIMIT 50"
    ).fetchall()

    if not rows:
        print("No release alerts recorded yet.")
        db.close()
        return

    print(f"{'Artist':<25} {'Title':<30} {'Year':<6} {'Type':<8} {'Status':<8} {'Detected'}")
    print("-" * 100)
    for row in rows:
        detected = row[5].strftime("%Y-%m-%d") if row[5] else "?"
        print(f"{row[0]:<25} {row[1]:<30} {row[2]:<6} {row[3]:<8} {row[4]:<8} {detected}")

    db.close()


def cmd_classify(args):
    from .classify_gaps import main as classify_main
    sys.argv = ["classify_gaps"]
    if args.dismiss:
        sys.argv.append("--dismiss")
    if args.dismiss_label_channels:
        sys.argv.append("--dismiss-label-channels")
    classify_main()


def cmd_query(args):
    from .db import get_db

    db = get_db()
    try:
        result = db.execute(args.sql)
        columns = [desc[0] for desc in result.description]
        rows = result.fetchall()
        # Print header
        print("\t".join(columns))
        print("-" * (len(columns) * 20))
        for row in rows:
            print("\t".join(str(v) for v in row))
        print(f"\n({len(rows)} rows)")
    except Exception as e:
        print(f"Query error: {e}")
    db.close()


def cmd_crate(args):
    from .crate import add_to_crate, update_status, list_crate

    if args.crate_action == "add":
        add_to_crate(args.artist, album=args.album or "", year=args.year or "", source=args.source or "", notes=args.notes or "")
    elif args.crate_action == "promote":
        update_status(args.artist, "promoted")
    elif args.crate_action == "skip":
        update_status(args.artist, "skipped")
    else:
        list_crate(args.status)


def main():
    parser = argparse.ArgumentParser(prog="radar", description="Pyaar Radar — release tracking + discovery")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("seed", help="Seed known_albums from albums/*.json")

    release_p = sub.add_parser("release", help="Check curated artists for new releases")
    release_p.add_argument("--save", action="store_true", help="Auto-save new releases to YT Music library")
    release_p.add_argument("--artist", type=str, help="Check a single artist")

    audit_p = sub.add_parser("audit", help="Full discography audit — find back-catalog gaps")
    audit_p.add_argument("--save", action="store_true", help="Auto-save every gap to YT Music library")
    audit_p.add_argument("--artist", type=str, help="Audit a single artist")
    audit_p.add_argument("--since", type=int, help="Only flag gaps from this year onward (e.g. 2010)")

    sub.add_parser("report", help="Show release alerts log")

    classify_p = sub.add_parser("classify", help="Classify audit_gap rows; optionally bulk-dismiss noise")
    classify_p.add_argument("--dismiss", action="store_true", help="Dismiss derivative/compilation/themed_comp rows")
    classify_p.add_argument("--dismiss-label-channels", action="store_true", help="Dismiss rows from known label-channel artists")

    query_p = sub.add_parser("query", help="Run ad-hoc DuckDB query")
    query_p.add_argument("sql", type=str, help="SQL query to execute")

    crate_p = sub.add_parser("crate", help="Manage discovery crate")
    crate_sub = crate_p.add_subparsers(dest="crate_action")

    crate_add = crate_sub.add_parser("add", help="Add artist/album to crate")
    crate_add.add_argument("artist", type=str)
    crate_add.add_argument("--album", type=str)
    crate_add.add_argument("--year", type=str)
    crate_add.add_argument("--source", type=str, help="Where you found them (NTS, Bandcamp, friend, etc.)")
    crate_add.add_argument("--notes", type=str)

    crate_promote = crate_sub.add_parser("promote", help="Mark artist as promoted (ready for artists.csv)")
    crate_promote.add_argument("artist", type=str)

    crate_skip = crate_sub.add_parser("skip", help="Dismiss from crate")
    crate_skip.add_argument("artist", type=str)

    crate_p.add_argument("--status", type=str, help="Filter by status (new/promoted/skipped)")

    args = parser.parse_args()

    if args.command == "seed":
        cmd_seed(args)
    elif args.command == "release":
        cmd_release(args)
    elif args.command == "audit":
        cmd_audit(args)
    elif args.command == "classify":
        cmd_classify(args)
    elif args.command == "report":
        cmd_report(args)
    elif args.command == "query":
        cmd_query(args)
    elif args.command == "crate":
        cmd_crate(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
