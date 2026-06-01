#!/usr/bin/env python3
"""Promote V1-staged files to V3 (master).

When V3 isn't plugged in, downloads land on V1 as staging. When V3 reappears,
this script walks V1 and copies any file V3 doesn't have to V3. V1 keeps its
copy (additive only — no destructive ops on V1).

Walks only the 4 V3-canonical top-level folders on V1 (Crates, In Focus,
PYAAR.Radio, Setlists). V1-only content (e.g. `Engine Library`) is ignored.

Usage:
    uplift_to_v3.py                    # walk all 4 canonical folders
    uplift_to_v3.py <subpath>          # walk only this V1 subpath
    uplift_to_v3.py --dry              # preview only
    uplift_to_v3.py --verbose          # log every skipped (already-on-V3) file

Drive roots resolve from ~/.config/pyaar-sync/drives.json — never hardcoded.
"""
import argparse
import os
import re
import shutil
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pyaar_drives import get_root  # noqa: E402

# Only walk paths that are canonical V3 master folders. V1-only top-level
# content (Engine Library, etc.) is left alone.
CANONICAL_ROOTS = ("Crates", "In Focus", "PYAAR.Radio", "Setlists")

SKIP_DIRS = {".Trashes", ".Spotlight-V100", ".fseventsd", ".DocumentRevisions-V100"}
SKIP_FILES = {".DS_Store"}

AUDIO_EXTS = (".mp3", ".flac", ".opus", ".m4a", ".wav", ".aiff", ".aac")

# Strip BPM/key tags so BPM-tagged V1 variants match V3's canonical filename.
# Patterns: " [125 G Major]" / " [125]" / " (128)" — bracket/paren with BPM number.
# Mix variants like "(Extended Mix)" and "(feat. X)" are preserved.
_BPM_BRACKET = re.compile(r'\s*\[\d{2,3}[^\]]*\]\s*')
_BPM_PAREN = re.compile(r'\s*\(\d{2,3}\)\s*')


def canonical_stem(stem: str) -> str:
    """Return filename stem with BPM/key tags stripped, lowercased, collapsed
    whitespace. Designed so V1 `Artist - Title (168).mp3` matches V3
    `Artist - Title.mp3`, but distinct mix variants are still kept distinct."""
    s = _BPM_BRACKET.sub(' ', stem)
    s = _BPM_PAREN.sub(' ', s)
    return ' '.join(s.lower().split())


def v3_dir_canonical_index(v3_dir: Path) -> set[str]:
    """Return set of canonical-stem strings for audio files in v3_dir."""
    out: set[str] = set()
    if not v3_dir.exists():
        return out
    try:
        for entry in v3_dir.iterdir():
            if not entry.is_file():
                continue
            if entry.name in SKIP_FILES or entry.name.startswith("._"):
                continue
            if entry.suffix.lower() not in AUDIO_EXTS:
                continue
            out.add(canonical_stem(entry.stem))
    except OSError:
        pass
    return out


def stamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def main() -> int:
    parser = argparse.ArgumentParser(description="V1 → V3 uplift (promote staged files)")
    parser.add_argument("subpath", nargs="?",
                        help="Restrict to a single V1 subpath (e.g. 'PYAAR.Radio/Monthlys')")
    parser.add_argument("--dry", action="store_true", help="Preview only")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Log every file (including skips)")
    args = parser.parse_args()

    try:
        v1 = get_root("v1")
        v3 = get_root("v3")
    except (RuntimeError, FileNotFoundError) as e:
        print(f"Both V1 and V3 must be mounted for uplift: {e}", file=sys.stderr)
        return 1

    if args.subpath:
        scan_roots = [v1 / args.subpath]
    else:
        scan_roots = [v1 / name for name in CANONICAL_ROOTS]

    print(f"[{stamp()}] uplift V1 → V3 {'(DRY)' if args.dry else ''}")
    print(f"  V1: {v1}")
    print(f"  V3: {v3}")

    uplifted = 0
    uplifted_bytes = 0
    already_on_v3 = 0   # exact-path match
    dedup_skipped = 0   # canonical-stem match (BPM-tagged variant on V3)
    errors = []

    # Cache canonical-stem index per V3 directory so we don't re-scan.
    v3_index_cache: dict[Path, set[str]] = {}

    for scan in scan_roots:
        if not scan.exists():
            print(f"  - {scan.relative_to(v1)}/  (not on V1, skip)")
            continue
        print(f"  scanning {scan.relative_to(v1)}/ ...")
        for root, dirs, files in os.walk(scan):
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not d.startswith("._")]
            for f in files:
                if f in SKIP_FILES or f.startswith("._"):
                    continue
                src = Path(root) / f
                try:
                    rel = src.relative_to(v1)
                except ValueError:
                    continue
                dst = v3 / rel
                if dst.exists():
                    already_on_v3 += 1
                    if args.verbose:
                        print(f"      = {rel}")
                    continue
                # Canonical-stem dedup: for audio files, check if V3 has a
                # BPM-tagged or canonical variant in the same directory.
                if src.suffix.lower() in AUDIO_EXTS:
                    v3_dir = dst.parent
                    if v3_dir not in v3_index_cache:
                        v3_index_cache[v3_dir] = v3_dir_canonical_index(v3_dir)
                    if canonical_stem(src.stem) in v3_index_cache[v3_dir]:
                        dedup_skipped += 1
                        if args.verbose:
                            print(f"      ~ {rel}  (BPM/canonical variant on V3)")
                        continue
                try:
                    src_size = src.stat().st_size
                except OSError as e:
                    errors.append((str(rel), str(e)))
                    continue
                if args.dry:
                    print(f"      + {rel}  ({human_bytes(src_size)})")
                    uplifted += 1
                    uplifted_bytes += src_size
                    continue
                try:
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(src, dst)
                except OSError as e:
                    errors.append((str(rel), str(e)))
                    continue
                # Refresh cache so subsequent V1 entries see the new V3 file
                v3_index_cache[dst.parent] = v3_index_cache.get(dst.parent, set()) | {
                    canonical_stem(src.stem)
                }
                print(f"      + {rel}  ({human_bytes(src_size)})")
                uplifted += 1
                uplifted_bytes += src_size

    print(f"\n[{stamp()}] done.")
    print(f"  uplifted: {uplifted} files ({human_bytes(uplifted_bytes)})")
    print(f"  already on V3 (exact path): {already_on_v3}")
    print(f"  skipped (BPM/canonical variant on V3): {dedup_skipped}")
    if errors:
        print(f"  errors: {len(errors)}")
        for rel, msg in errors[:10]:
            print(f"    ✗ {rel} — {msg}")
        if len(errors) > 10:
            print(f"    ... and {len(errors) - 10} more")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
