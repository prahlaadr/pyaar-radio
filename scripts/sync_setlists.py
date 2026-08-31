#!/usr/bin/env python3
"""Drive scripts/setlist_sync_map.json: sync playlist->folder mappings.

Thin wrapper over sync_folder.py. Guards on the base drive actually being a
mount point so a launchd StartOnMount trigger can't create phantom folders on
the boot disk when the USB is absent.

Usage:
  sync_setlists.py [--auto-only] [--only <playlistId>] [--dry]

  --auto-only   only mappings with "autoMount": true (used by the on-mount job)
  --only ID     sync a single mapping by playlistId (e.g. the held Dub Crate run)
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MAP_PATH = HERE / "setlist_sync_map.json"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--auto-only", action="store_true")
    ap.add_argument("--only")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    cfg = json.load(open(MAP_PATH))
    base = Path(cfg["base"])
    # /Volumes/vision 1 must be a real mount, else bail (never write to boot disk).
    mount = Path("/Volumes") / base.parts[2] if base.parts[:2] == ("/", "Volumes") else base
    if not os.path.ismount(str(mount)) and not base.exists():
        print(f"base drive not mounted ({mount}); nothing to do")
        return

    picks = cfg["mappings"]
    if args.only:
        picks = [m for m in picks if m["playlistId"] == args.only]
    elif args.auto_only:
        picks = [m for m in picks if m.get("autoMount")]

    if not picks:
        print("no mappings selected")
        return

    rc = 0
    for m in picks:
        target = base / m["folder"]
        print(f"\n===== {m['title']} -> {m['folder']} =====")
        cmd = [sys.executable, str(HERE / "sync_folder.py"), m["playlistId"], str(target)]
        if args.dry:
            cmd.append("--dry")
        rc |= subprocess.run(cmd).returncode
    sys.exit(1 if rc else 0)


if __name__ == "__main__":
    main()
