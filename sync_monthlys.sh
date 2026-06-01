#!/bin/bash
# Monthly archive sync wrapper — called by com.pyaar.sync-monthlys LaunchAgent.
#
# Chain: YT Music monthly playlists → V3 PYAAR.Radio/Monthlys/ (master archive).
# V1 is NOT in this chain — pull specific months to V1 via `pull` when needed
# for a set. Path resolution via ~/.config/pyaar-sync/drives.json. Silently
# no-ops if V3 isn't mounted.
#
# Steps (when V3 is mounted):
#   1. git pull        — catch GitHub Action commits from sync_playlists.py daily cron
#   2. sync_playlists  — catch playlists added in the last <24h not yet in GH
#   3. sync_usb --flat — download tracks for every monthly playlist to V3 Monthlys

set -u

REPO="/Users/prahlaad/Documents/Projects/01-web-apps/pyaar-radio"
PY="$REPO/.venv/bin/python"
LOG="/tmp/pyaar-sync-monthlys.log"

# Resolve V3 root via drives helper. Bail silently if not configured/mounted.
V3="$("$PY" -c "
import sys; sys.path.insert(0, '$REPO')
from pyaar_drives import get_root_optional
p = get_root_optional('v3')
print(p) if p else sys.exit(1)
" 2>/dev/null)" || exit 0

ts() { date "+%Y-%m-%d %H:%M:%S"; }

{
    echo
    echo "============================================================"
    echo "[$(ts)] V3 mounted ($V3) — Monthlys sync chain start"

    cd "$REPO" || { echo "FATAL: cannot cd to $REPO"; exit 1; }

    # 1. Pull latest from GitHub (sync_playlists.py daily cron commits land here)
    echo "[$(ts)] git pull"
    git pull --rebase --autostash 2>&1 | tail -5 || echo "  (git pull failed — continuing with local state)"

    # 2. Locally re-sync playlists (catches anything created since the last GH Action run)
    echo "[$(ts)] sync_playlists.py (incremental)"
    if [ -f "$REPO/browser.json" ]; then
        "$PY" sync_playlists.py 2>&1 | tail -5 || echo "  (sync_playlists failed — continuing with current local data)"
    else
        echo "  (browser.json missing — skipping playlist sync)"
    fi

    # 3. Download to V3 PYAAR.Radio/Monthlys (flat layout). sync_usb.py picks
    #    up the V3 default target from drives.json when --usb isn't passed.
    echo "[$(ts)] sync_usb.py → V3 PYAAR.Radio/Monthlys (flat layout)"
    "$PY" sync_usb.py --flat

    echo "[$(ts)] done"
} >> "$LOG" 2>&1
