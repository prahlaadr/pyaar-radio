"""Pyaar Radar CLI.

Usage:
    python -m radar seed                          # Seed known_albums from albums/*.json
    python -m radar release                       # Check curated artists for new releases
    python -m radar release --save                # Auto-save new releases to YT Music
    python -m radar release --artist "Flying Lotus"
    python -m radar report                        # Show release_alerts log
    python -m radar query "SELECT ..."            # Ad-hoc DuckDB query
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
    from .release import load_artists, check_releases, format_report

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


def main():
    parser = argparse.ArgumentParser(prog="radar", description="Pyaar Radar — release tracking + discovery")
    sub = parser.add_subparsers(dest="command")

    sub.add_parser("seed", help="Seed known_albums from albums/*.json")

    release_p = sub.add_parser("release", help="Check curated artists for new releases")
    release_p.add_argument("--save", action="store_true", help="Auto-save new releases to YT Music library")
    release_p.add_argument("--artist", type=str, help="Check a single artist")

    sub.add_parser("report", help="Show release alerts log")

    query_p = sub.add_parser("query", help="Run ad-hoc DuckDB query")
    query_p.add_argument("sql", type=str, help="SQL query to execute")

    args = parser.parse_args()

    if args.command == "seed":
        cmd_seed(args)
    elif args.command == "release":
        cmd_release(args)
    elif args.command == "report":
        cmd_report(args)
    elif args.command == "query":
        cmd_query(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
