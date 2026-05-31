#!/usr/bin/env python3
"""Mirror V1 → V3 (strict per-folder mirror).

Strategy:
  - For each top-level folder in V1: rsync -au --delete to V3 — V3 strictly
    mirrors V1 for shared folders, so reorganizations/deletions on V1
    propagate to V3.
  - V3-only top-level folders (e.g. Daytimers, Under the Bridge) are
    untouched — never deleted, never modified.
  - Bails immediately if either drive isn't mounted (the LaunchAgent
    fires on every disk mount; most fires are no-ops).

Triggered by ~/Library/LaunchAgents/com.pyaar.sync-v1-v3.plist (StartOnMount).
Log: /tmp/pyaar-sync-v1-v3.log
Manual run: python3 sync_v1_v3.py --foreground
Dry run:    python3 sync_v1_v3.py --foreground --dry
"""
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

V1 = Path("/Volumes/vision 1/DJ")
V3 = Path("/Volumes/vision 3.0/music/RAAMI RADIO")
LOG = Path("/tmp/pyaar-sync-v1-v3.log")

# Top-level folders to never touch on V3 (Engine Library is V1-only DJ DB)
SKIP = {"Engine Library", ".Trashes", ".Spotlight-V100", ".fseventsd"}


def stamp():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def main():
    dry = "--dry" in sys.argv
    if not V1.exists() or not V3.exists():
        return 0  # silent no-op when either drive missing
    if not shutil.which("rsync"):
        print(f"[{stamp()}] ERROR: rsync not in PATH")
        return 1

    print(f"\n[{stamp()}] V1 + V3 both mounted — per-folder mirror {'(DRY)' if dry else ''}")

    folders = sorted([f.name for f in V1.iterdir()
                      if f.is_dir() and f.name not in SKIP and not f.name.startswith(".")])
    print(f"  V1 top-level folders to mirror: {len(folders)}")

    # Move-aware orphan cleanup: any V3 top-level folder NOT in V1's top-level —
    # check if a same-named folder exists anywhere else on V1 (e.g. /Setlists/X).
    # If so, the user moved it on V1 → V3's top-level copy is a duplicate → delete.
    # If not, it's a genuine V3-only folder → preserve.
    v3_top = {d.name for d in V3.iterdir() if d.is_dir() and d.name not in SKIP and not d.name.startswith(".")}
    v3_only = sorted(v3_top - set(folders))
    if v3_only:
        # Build a name → True index of every folder under V1 (recursive)
        v1_folder_names = set()
        try:
            for root, dirs, _ in __import__("os").walk(V1):
                for d in dirs:
                    v1_folder_names.add(d)
        except Exception:
            pass

        preserved, orphans = [], []
        for name in v3_only:
            if name in v1_folder_names:
                orphans.append(name)
            else:
                preserved.append(name)
        if orphans:
            print(f"  V3-only orphans (moved on V1, deleting from V3): {orphans}")
            if not dry:
                import shutil as _sh
                for name in orphans:
                    try:
                        _sh.rmtree(V3 / name)
                    except Exception as e:
                        print(f"    ! failed to rm {name}: {e}")
            else:
                print(f"    (DRY — would delete)")
        if preserved:
            print(f"  V3-only preserved (no V1 equivalent): {preserved}")

    total_files = total_bytes = 0
    failed = []
    for folder in folders:
        src = V1 / folder
        dst = V3 / folder
        # --inplace bypasses temp filename creation — important for files with
        # long multi-byte (Korean/CJK) filenames that overflow macOS 255-byte limit
        # when rsync prepends `.` and appends `.XXXXXX` to the basename.
        # --itemize-changes logs every add/delete/update so we have a recoverable
        # paper trail of what was synced (vs the legacy --delete black-box).
        cmd = ["rsync", "-au", "--delete", "--inplace", "--itemize-changes",
               "--stats",
               "--exclude=.DS_Store", "--exclude=._*"]
        if dry:
            cmd.insert(1, "--dry-run")
        cmd += [f"{src}/", f"{dst}/"]
        try:
            r = subprocess.run(cmd, capture_output=True, text=True,
                               errors='replace', timeout=10800)
        except subprocess.TimeoutExpired:
            print(f"  [{stamp()}] TIMEOUT: {folder}")
            failed.append(folder)
            continue
        if r.returncode != 0:
            print(f"  [{stamp()}] ✗ {folder} (rsync exit {r.returncode}): {r.stderr.strip()[:200]}")
            failed.append(folder)
            continue
        # Brief per-folder stats
        new_files = bytes_xferred = "?"
        for line in r.stdout.splitlines():
            if "Number of regular files transferred:" in line:
                new_files = line.split(":")[-1].strip()
            elif "Total transferred file size:" in line:
                bytes_xferred = line.split(":")[-1].strip()
        print(f"  ✓ {folder:<20} files={new_files:<12} bytes={bytes_xferred}")

    print(f"[{stamp()}] done. failed={failed if failed else 'none'}")
    return 0 if not failed else 1


if __name__ == "__main__":
    if "--foreground" in sys.argv:
        sys.exit(main())
    # LaunchAgent invocation — redirect stdout to log
    with open(LOG, "a") as f:
        sys.stdout = f
        sys.stderr = f
        sys.exit(main())
