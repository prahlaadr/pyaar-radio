#!/bin/bash
# Fired by com.pyaar.setlist-automount on disk mount. Re-syncs the autoMount:true
# mappings in setlist_sync_map.json when the DJ drive is plugged in. launchd's
# minimal PATH can't find yt-dlp/ffmpeg, so prepend Homebrew. Bails fast (mount
# guard in sync_setlists.py) if the drive is absent. Uses the repo venv python so
# the private-playlist fallback (ytmusicapi) works headlessly.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
cd "$HOME/Projects/01-web-apps/pyaar-radio" || exit 0
PY="$HOME/Projects/01-web-apps/pyaar-radio/.venv/bin/python"
[ -x "$PY" ] || PY=/opt/homebrew/bin/python3
echo "===== $(date) automount fire =====" >> /tmp/pyaar-setlist-automount.log
"$PY" scripts/sync_setlists.py --auto-only >> /tmp/pyaar-setlist-automount.log 2>&1
