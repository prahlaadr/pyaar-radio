#!/usr/bin/env python3
"""Compute dj_score column for masterlist.csv (v2 algorithm — danceability-first).

Idempotent: reads existing CSV, recomputes dj_score from existing columns
(Tempo, Energy, Danceability, Duration, Liked, Video ID), writes back. Adds
the column if missing. Run after sync_liked.py to keep score fresh.

Tier interpretation (also computed):
  Tier 1: danceability >= 0.5 (DJ-able primary)
  Tier 2: danceability < 0.5 AND energy >= 0.5 (fallback)
  Tier 3: both < 0.5 OR unhydrated (skip in setlists)

Usage:
    python scripts/compute_dj_score.py              # in-place update
    python scripts/compute_dj_score.py --dry        # report only, no write
"""
import argparse
import csv
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent.parent
MASTERLIST = PROJECT_DIR / "public" / "data" / "masterlist.csv"


def f(v):
    try:
        return float(v) if v not in (None, "") else None
    except (ValueError, TypeError):
        return None


def parse_dur(s):
    if not s:
        return 0
    parts = s.split(":")
    if len(parts) == 2:
        try:
            return int(parts[0]) * 60 + int(parts[1])
        except ValueError:
            return 0
    return 0


def dj_score_v2(row):
    """Danceability-first DJ score. See handoff doc for original spec."""
    dance = f(row.get("Danceability")) or 0
    energy = f(row.get("Energy")) or 0
    tempo = f(row.get("Tempo")) or 0
    dur = parse_dur(row.get("Duration", ""))
    liked = row.get("Liked", "") == "Yes"
    has_vid = bool(row.get("Video ID", ""))

    score = 0.0
    if dance >= 0.5:
        score += 50 + dance * 30
    elif dance > 0:
        score += dance * 20
    if energy >= 0.5:
        score += 25 + energy * 15
    elif energy > 0:
        score += energy * 10
    if 85 <= tempo <= 135:
        score += 15
    elif (70 <= tempo <= 85) or (135 <= tempo <= 145):
        score += 7
    if 120 <= dur <= 420:
        score += 8
    if liked:
        score += 10
    if has_vid:
        score += 5
    return round(score, 1)


def tier_of(row):
    d = f(row.get("Danceability"))
    e = f(row.get("Energy"))
    if d is None and e is None:
        return "Tier 3"  # unhydrated
    d = d or 0
    e = e or 0
    if d >= 0.5:
        return "Tier 1"
    if e >= 0.5:
        return "Tier 2"
    return "Tier 3"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    if not MASTERLIST.exists():
        print(f"ERROR: {MASTERLIST} not found")
        sys.exit(1)

    with open(MASTERLIST, encoding="utf-8") as fin:
        reader = csv.DictReader(fin)
        fieldnames = list(reader.fieldnames)
        rows = list(reader)

    needs_dj_score = "dj_score" not in fieldnames
    needs_dj_tier = "dj_tier" not in fieldnames
    if needs_dj_score:
        fieldnames.append("dj_score")
    if needs_dj_tier:
        fieldnames.append("dj_tier")

    tier_counts = {"Tier 1": 0, "Tier 2": 0, "Tier 3": 0}
    score_changed = 0
    score_total = 0.0
    for row in rows:
        old_score = row.get("dj_score", "")
        new_score = dj_score_v2(row)
        new_tier = tier_of(row)
        row["dj_score"] = str(new_score)
        row["dj_tier"] = new_tier
        tier_counts[new_tier] += 1
        score_total += new_score
        if str(old_score) != str(new_score):
            score_changed += 1

    print(f"Rows: {len(rows)}")
    print(f"Schema: {len(fieldnames)} columns ({'+ dj_score, dj_tier' if needs_dj_score else 'already present'})")
    print(f"Scores changed: {score_changed}")
    print(f"Avg dj_score: {score_total/len(rows):.1f}")
    print(f"Tiers: T1={tier_counts['Tier 1']}, T2={tier_counts['Tier 2']}, T3={tier_counts['Tier 3']}")

    if args.dry:
        print("(dry — no write)")
        return

    # Write back
    with open(MASTERLIST, "w", newline="", encoding="utf-8") as fout:
        writer = csv.DictWriter(fout, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            for fn in fieldnames:
                row.setdefault(fn, "")
            writer.writerow(row)
    print(f"Wrote {MASTERLIST}")


if __name__ == "__main__":
    main()
