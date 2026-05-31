#!/bin/bash
# V1/Monthlys auto-sync wrapper — called by com.pyaar.sync-v1-monthlys LaunchAgent.
#
# Chain:
#   1. git pull        — catch GitHub Action commits from sync_playlists.py daily cron
#   2. sync_playlists  — catch playlists added in the last <24h not yet in GH
#   3. sync_usb --flat — download tracks for every monthly playlist to V1
#
# Silently no-ops if V1 isn't mounted.

set -u

V1="/Volumes/vision 1/DJ/Monthlys"
REPO="/Users/prahlaad/Documents/Projects/01-web-apps/pyaar-radio"
PY="$REPO/.venv/bin/python"
LOG="/tmp/pyaar-sync-v1-monthlys.log"

# Bail silently if V1 isn't mounted (LaunchAgent fires on every disk mount)
if [ ! -d "$V1" ]; then
    exit 0
fi

ts() { date "+%Y-%m-%d %H:%M:%S"; }

{
    echo
    echo "============================================================"
    echo "[$(ts)] V1 mounted — full chain start"

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

    # 3. Download to V1/Monthlys
    echo "[$(ts)] sync_usb.py → V1/Monthlys (flat layout)"
    "$PY" sync_usb.py --usb "$V1" --flat

    echo "[$(ts)] done"
} >> "$LOG" 2>&1
