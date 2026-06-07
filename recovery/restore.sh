#!/bin/bash
# Pyaar drive + automation recovery.
#
# Rebuilds everything that lives OUTSIDE this repo: the drive-path config, the
# LaunchAgents, and the canonical folder skeleton on the drive. Then (optionally)
# re-runs the syncs to repopulate re-downloadable content.
#
# WHAT THIS CANNOT DO: recover rare/unique files (Soulseek FLAC, lucida Qobuz
# rips, NTS Tamil rips, no-YouTube-source tracks). Those exist only on the drive
# and must be re-sourced manually — see RECOVERY.md.
#
# Usage:
#   recovery/restore.sh                 # config + agents + folder skeleton
#   recovery/restore.sh --resync        # also run the syncs to repopulate
#   recovery/restore.sh --drive "/Volumes/NEWNAME/DJ"   # skeleton target override
#   recovery/restore.sh --dry           # print the plan, change nothing
#
# Idempotent — safe to re-run.

set -euo pipefail

# Repo root = parent of this script's dir. PYAAR_CORE is the separate crate repo.
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RECOVERY="$REPO/recovery"
PYAAR_CORE_DEFAULT="$HOME/Projects/03-music-audio/pyaar-core"
PYAAR_CORE="${PYAAR_CORE:-$PYAAR_CORE_DEFAULT}"
LA_DIR="$HOME/Library/LaunchAgents"
CFG_DIR="$HOME/.config/pyaar-sync"

DRY=0
RESYNC=0
DRIVE_OVERRIDE=""
while [ $# -gt 0 ]; do
    case "$1" in
        --dry) DRY=1 ;;
        --resync) RESYNC=1 ;;
        --drive) DRIVE_OVERRIDE="$2"; shift ;;
        *) echo "unknown arg: $1"; exit 2 ;;
    esac
    shift
done

run() { echo "  + $*"; [ "$DRY" = 1 ] || eval "$@"; }
say() { echo; echo "==> $*"; }

# ---------------------------------------------------------------------------
say "1. Install drive config → $CFG_DIR/drives.json"
run "mkdir -p '$CFG_DIR'"
run "cp '$RECOVERY/config/drives.json' '$CFG_DIR/drives.json'"
echo "  ! VERIFY the v1_root / v3_root paths in that file match your mounted drive names."

# ---------------------------------------------------------------------------
say "2. Install + load LaunchAgents (paths rewritten for this machine)"
run "mkdir -p '$LA_DIR'"
for src in "$RECOVERY"/launchagents/*.plist; do
    name="$(basename "$src")"
    dest="$LA_DIR/$name"
    # Substitute placeholders with this machine's real paths.
    if [ "$DRY" = 1 ]; then
        echo "  + render $name → $dest (sub __REPO__=$REPO, __PYAAR_CORE__=$PYAAR_CORE)"
    else
        sed -e "s|__REPO__|$REPO|g" -e "s|__PYAAR_CORE__|$PYAAR_CORE|g" "$src" > "$dest"
        echo "  + rendered $name → $dest"
    fi
    label="${name%.plist}"
    run "launchctl unload '$dest' 2>/dev/null || true"
    run "launchctl load '$dest'"
done
echo "  note: com.pyaar-crate.daily needs the separate pyaar-core repo at: $PYAAR_CORE"

# ---------------------------------------------------------------------------
say "3. Create canonical folder skeleton on the drive"
# Target drive: --drive override, else v1_root from the just-installed config.
if [ -n "$DRIVE_OVERRIDE" ]; then
    DRIVE="$DRIVE_OVERRIDE"
else
    DRIVE="$(python3 -c "import json,os;print(json.load(open(os.path.expanduser('$CFG_DIR/drives.json')))['v1_root'])" 2>/dev/null || echo "")"
fi
if [ -z "$DRIVE" ]; then
    echo "  ! no target drive resolved — pass --drive '/Volumes/.../DJ'. Skipping skeleton."
elif [ ! -d "$(dirname "$DRIVE")" ] && [ "$DRY" = 0 ]; then
    echo "  ! drive parent not mounted ($DRIVE) — plug the drive in, then re-run. Skipping skeleton."
else
    echo "  target: $DRIVE"
    while IFS= read -r sub; do
        [ -z "$sub" ] && continue
        run "mkdir -p '$DRIVE/$sub'"
    done < "$RECOVERY/structure.txt"
fi

# ---------------------------------------------------------------------------
if [ "$RESYNC" = 1 ]; then
    say "4. Repopulate re-downloadable content (this is slow)"
    if [ -x "$REPO/.venv/bin/python" ]; then PY="$REPO/.venv/bin/python"; else PY="python3"; fi
    run "cd '$REPO' && '$PY' sync_usb.py --flat"          # Monthlys
    echo "  note: producers — run 'scripts/sync_producer.py \"<name>\" --download' per producer."
    echo "  note: setlists  — re-run /sync-setlist per setlist CSV."
else
    say "4. Repopulate — SKIPPED (re-run with --resync, or run syncs manually)"
fi

say "Done. Next: re-source rare/unique files manually — see recovery/RECOVERY.md"
