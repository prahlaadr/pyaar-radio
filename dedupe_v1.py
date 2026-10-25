#!/usr/bin/env python3
"""One-time V1 format de-dupe: when the same song exists on V1 in multiple
formats in the same folder (e.g. Track.mp3 + Track.flac), keep the .mp3 and
remove the others. V1 ONLY, never touches V3 masters. Walks the 4 canonical
roots (Crates, In Focus, PYAAR.Radio, Setlists) recursively.

    dedupe_v1.py            # dry preview
    dedupe_v1.py --apply    # delete the non-mp3 duplicates
"""
import json
import sys
from pathlib import Path

cfg = json.loads((Path.home() / ".config/pyaar-sync/drives.json").read_text())
V1 = Path(cfg["v1_root"])
AUDIO = {".mp3", ".m4a", ".flac", ".wav", ".opus", ".aac", ".aiff"}
ROOTS = ("Crates", "In Focus", "PYAAR.Radio", "Setlists")
APPLY = "--apply" in sys.argv

removed = kept = 0
for root in ROOTS:
    base = V1 / root
    if not base.is_dir():
        continue
    dirs = [base] + [p for p in base.rglob("*") if p.is_dir()]
    for folder in dirs:
        groups = {}  # lower stem -> list[Path]
        for f in folder.iterdir():
            if f.is_file() and not f.name.startswith("._") and f.suffix.lower() in AUDIO:
                groups.setdefault(f.stem.lower(), []).append(f)
        for stem, files in groups.items():
            exts = {f.suffix.lower() for f in files}
            if len(exts) < 2 or ".mp3" not in exts:
                continue  # only resolve mixed-format groups that contain an mp3
            for f in files:
                if f.suffix.lower() == ".mp3":
                    kept += 1
                    continue
                print(f"  {'DEL' if APPLY else 'would delete'}: {f.relative_to(V1)}")
                removed += 1
                if APPLY:
                    f.unlink()
                    sidecar = f.with_name("._" + f.name)
                    if sidecar.exists():
                        sidecar.unlink()

print(f"\n{'Removed' if APPLY else 'Would remove'} {removed} non-mp3 dupe(s); kept {kept} mp3(s).")
