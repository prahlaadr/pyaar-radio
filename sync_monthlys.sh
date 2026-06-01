#!/bin/bash
# Monthly archive sync wrapper — called by com.pyaar.sync-monthlys LaunchAgent.
#
# Chain: YT Music monthly playlists → V3 PYAAR.Radio/Monthlys/ (master). If V3
# isn't plugged in, sync_usb.py falls back to V1 staging (later promoted via
# `uplift`). Path resolution via ~/.config/pyaar-sync/drives.json — no
# hardcoded drive paths. Silently no-ops if neither drive is mounted.
#
# Steps (when at least one drive is mounted):
#   1. git pull                   — catch GH-Action commits from daily cron
#   2. sync_monthly_playlists.py  — discover + fetch only "Month YY" playlists
#                                   (much faster than walking all 244 playlists)
#   3. sync_usb --flat            — download tracks to V3 (or V1 fallback)

set -u

REPO="/Users/prahlaad/Documents/Projects/01-web-apps/pyaar-radio"
PY="$REPO/.venv/bin/python"
LOG="/tmp/pyaar-sync-monthlys.log"

# Resolve write target via drives helper. Prefers V3; falls back to V1.
# Bail silently if neither drive is configured/mounted.
TARGET="$("$PY" -c "
import sys; sys.path.insert(0, '$REPO')
from pyaar_drives import get_write_root
try:
    root, role = get_write_root()
    print(f'{role}\t{root}')
except RuntimeError:
    sys.exit(1)
" 2>/dev/null)" || exit 0
ROLE="${TARGET%%	*}"
ROOT="${TARGET#*	}"

ts() { date "+%Y-%m-%d %H:%M:%S"; }

{
    echo
    echo "============================================================"
    echo "[$(ts)] target=$ROLE ($ROOT) — Monthlys sync chain start"
    if [ "$ROLE" = "v1" ]; then
        echo "[$(ts)] ⚠️  V3 not mounted — staging on V1. Run \`uplift\` after V3 reconnects."
    fi

    cd "$REPO" || { echo "FATAL: cannot cd to $REPO"; exit 1; }

    # 1. Pull latest from GitHub (sync_playlists.py daily cron commits land here)
    echo "[$(ts)] git pull"
    git pull --rebase --autostash 2>&1 | tail -5 || echo "  (git pull failed — continuing with local state)"

    # 2. Targeted monthly playlist sync (only walks Month-YY playlists, not all 244)
    echo "[$(ts)] sync_monthly_playlists.py (incremental, monthly-only)"
    if [ -f "$REPO/browser.json" ]; then
        "$PY" sync_monthly_playlists.py 2>&1 | tail -10 || echo "  (sync failed — continuing with current local data)"
    else
        echo "  (browser.json missing — skipping playlist sync)"
    fi

    # 3. Download tracks. sync_usb.py picks up V3 (or V1 fallback) as default target.
    echo "[$(ts)] sync_usb.py → $ROOT/PYAAR.Radio/Monthlys (flat layout)"
    "$PY" sync_usb.py --flat

    echo "[$(ts)] done"
} >> "$LOG" 2>&1
