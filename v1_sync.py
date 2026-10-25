#!/usr/bin/env python3
"""On-mount persistent V1 sync (additive, never deletes).

Keeps a defined set of folders current on V1 whenever BOTH V1 and V3 are
mounted. Fires on every volume mount via launchd, so it is a silent no-op
unless both drives are present (can't pull from an absent master, and we
don't want to run on every random USB/DMG).

Persistent V1 set:
  - PYAAR.Radio/Monthlys             → CURRENT YEAR ONLY (full archive stays on V3)
  - Crates/Intros, Interludes, Loops, Waves → two-way (pull + uplift)

Uses `pull` (sync_v1_v3.py: V3→V1 rsync -au, additive) and `uplift`
(uplift_to_v3.py: V1→V3 additive, stem-dedup). Both carry the mp3-preferred
format-dupe guard, so a track that's .mp3 on V1 + .flac/.m4a on V3 is never
duplicated. Never deletes. One-time de-dupe of pre-existing pairs is a
separate op (dedupe_v1.py).

NOT persistent (deliberate): Crates/Soundcloud Rips/liked songs is a one-time
snapshot, not re-pushed here.
"""
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).parent
PULL = HERE / "sync_v1_v3.py"
UPLIFT = HERE / "uplift_to_v3.py"
DRIVES = Path.home() / ".config" / "pyaar-sync" / "drives.json"

MONTHLYS = "PYAAR.Radio/Monthlys"
INTROS = "Crates/Intros, Interludes, Loops, Waves"


def log(msg):
    print(f"[{datetime.now():%Y-%m-%d %H:%M:%S}] {msg}", flush=True)


def main():
    cfg = json.loads(DRIVES.read_text())
    v1, v3 = Path(cfg["v1_root"]), Path(cfg["v3_root"])

    if not (v1.exists() and v3.exists()):
        return  # silent no-op: both drives must be mounted

    log("v1-sync start (both drives mounted)")

    # 1) Monthlys, current year only. Matches flat "YYYY-NN (Month)" folders;
    #    skips the legacy bare-year container and all prior years. Additive.
    year = datetime.now().year
    months_root = v3 / MONTHLYS
    current = sorted(
        p.name for p in months_root.iterdir()
        if p.is_dir() and p.name.startswith(f"{year}-")
    ) if months_root.exists() else []
    if current:
        log(f"Monthlys ({year}): pulling {len(current)} month folder(s)")
        subprocess.run([sys.executable, str(PULL), *[f"{MONTHLYS}/{n}" for n in current]])
    else:
        log(f"Monthlys: no {year} folders on V3 yet")

    # 2) Intros crate: two-way additive (pull then uplift).
    log("Intros crate: pull V3→V1")
    subprocess.run([sys.executable, str(PULL), INTROS])
    log("Intros crate: uplift V1→V3")
    subprocess.run([sys.executable, str(UPLIFT), INTROS])

    log("v1-sync done")


if __name__ == "__main__":
    main()
