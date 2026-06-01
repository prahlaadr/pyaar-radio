#!/usr/bin/env python3
"""Pull selected folder(s) from V3 (master) → V1 (subset for DJ sets).

V3 is the canonical archive. V1 is a curated subset of what you need for
upcoming sets. This script never does a full mirror — the V3 archive
exceeds V1's capacity by design. Specify which folder(s) to pull.

Usage (via the `pull` wrapper next to this file):
    pull <subpath> [<subpath> ...]   # pull one or more folders
    pull --list                       # list V3 top-level + 2nd-level paths
    pull --dry <subpath>              # preview a pull
    pull                              # no args → usage + V1 free space

`<subpath>` is a path RELATIVE to the V3 root, e.g.:
    pull "Setlists/Underground ATL"
    pull "Crates/Trivia Night"  "Setlists/Charcoal"
    pull "In Focus/Producers/Hudson Mohawke"

Drive roots resolve from ~/.config/pyaar-sync/drives.json or env vars
PYAAR_V1_ROOT / PYAAR_V3_ROOT — never hardcoded.
"""
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from pyaar_drives import get_root  # noqa: E402

SKIP = {".Trashes", ".Spotlight-V100", ".fseventsd", ".DocumentRevisions-V100"}


def stamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


def dir_size(p: Path) -> int:
    """Sum of file sizes under p, in bytes. Excludes ._* and .DS_Store."""
    total = 0
    for root, _, files in __import__("os").walk(p):
        for f in files:
            if f.startswith("._") or f == ".DS_Store":
                continue
            try:
                total += (Path(root) / f).stat().st_size
            except OSError:
                pass
    return total


def free_bytes(p: Path) -> int:
    """Free bytes on the filesystem containing p."""
    return shutil.disk_usage(p).free


def list_v3_paths(v3: Path) -> None:
    """Print V3 top-level and 2nd-level paths so user knows what to pull."""
    print(f"V3 master: {v3}\n")
    for top in sorted(v3.iterdir()):
        if not top.is_dir() or top.name in SKIP or top.name.startswith("."):
            continue
        children = sorted([
            c.name for c in top.iterdir()
            if c.is_dir() and c.name not in SKIP and not c.name.startswith(".")
        ])
        # Top-level summary
        size = human_bytes(dir_size(top))
        print(f"  {top.name}/    ({size}, {len(children)} subfolders)")
        # Show 2nd level for navigation
        for child in children[:30]:
            csize = human_bytes(dir_size(top / child))
            print(f"      {top.name}/{child}    ({csize})")
        if len(children) > 30:
            print(f"      ... and {len(children) - 30} more")
        print()


def pull_one(v3: Path, v1: Path, subpath: str, dry: bool) -> tuple[bool, str]:
    """Pull a single V3 subpath to V1. Returns (success, summary_line)."""
    src = v3 / subpath
    if not src.exists():
        return False, f"✗ {subpath} — does not exist on V3"
    if not src.is_dir():
        return False, f"✗ {subpath} — not a directory"

    dst = v1 / subpath

    # Pre-flight: size check (only count what would be transferred — approximation:
    # source size minus whatever is already at dst with same size). For simplicity
    # we use source size; rsync -u skips matched files anyway.
    src_size = dir_size(src)
    free = free_bytes(v1)
    # Allow up to 95% fill — never blow through the last 5%
    safe_free = int(free - (shutil.disk_usage(v1).total * 0.05))
    if src_size > safe_free and not dry:
        return False, (
            f"✗ {subpath} — would need ~{human_bytes(src_size)} but V1 has "
            f"~{human_bytes(safe_free)} safe-free (5% buffer). Free space "
            f"on V1 first, or pull a smaller subfolder."
        )

    dst.parent.mkdir(parents=True, exist_ok=True)

    cmd = ["rsync", "-au", "--inplace", "--itemize-changes", "--stats",
           "--exclude=.DS_Store", "--exclude=._*"]
    if dry:
        cmd.insert(1, "--dry-run")
    cmd += [f"{src}/", f"{dst}/"]

    try:
        r = subprocess.run(cmd, capture_output=True, text=True,
                           errors='replace', timeout=10800)
    except subprocess.TimeoutExpired:
        return False, f"✗ {subpath} — rsync timed out"
    if r.returncode != 0:
        return False, f"✗ {subpath} — rsync exit {r.returncode}: {r.stderr.strip()[:200]}"

    files = bytes_xferred = "?"
    for line in r.stdout.splitlines():
        if "Number of regular files transferred:" in line:
            files = line.split(":")[-1].strip()
        elif "Total transferred file size:" in line:
            bytes_xferred = line.split(":")[-1].strip()
    tag = "(DRY)" if dry else ""
    return True, f"✓ {subpath}  files={files}  bytes={bytes_xferred} {tag}"


def main():
    args = [a for a in sys.argv[1:] if a not in ("--foreground",)]
    dry = "--dry" in args
    if dry:
        args.remove("--dry")
    want_list = "--list" in args
    if want_list:
        args.remove("--list")

    try:
        v3 = get_root("v3")
        v1 = get_root("v1")
    except (RuntimeError, FileNotFoundError) as e:
        print(f"Drive not available: {e}", file=sys.stderr)
        print(
            "  Edit ~/.config/pyaar-sync/drives.json or set PYAAR_V1_ROOT / "
            "PYAAR_V3_ROOT env vars.",
            file=sys.stderr,
        )
        return 2

    if want_list:
        list_v3_paths(v3)
        return 0

    if not args:
        print(__doc__)
        print(f"V3 master: {v3}")
        print(f"V1 subset: {v1}")
        print(f"V1 free space: {human_bytes(free_bytes(v1))}\n")
        print("Run `pull --list` to see available V3 paths.")
        return 0

    if not shutil.which("rsync"):
        print("ERROR: rsync not in PATH", file=sys.stderr)
        return 1

    print(f"[{stamp()}] V3→V1 selective pull {'(DRY)' if dry else ''}")
    print(f"  V3 (master): {v3}")
    print(f"  V1 (subset): {v1}")
    print(f"  V1 free:     {human_bytes(free_bytes(v1))}\n")

    failures = []
    for subpath in args:
        ok, msg = pull_one(v3, v1, subpath, dry)
        print(f"  {msg}")
        if not ok:
            failures.append(subpath)

    print(f"\n[{stamp()}] done. failed={failures if failures else 'none'}")
    print(f"  V1 free after: {human_bytes(free_bytes(v1))}")
    return 0 if not failures else 1


if __name__ == "__main__":
    sys.exit(main())
