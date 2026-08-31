#!/bin/bash
# Fired by com.pyaar.setlist-automount on disk mount. Re-syncs the autoMount:true
# mappings in setlist_sync_map.json (currently the Mood Ring folder) when the DJ
# drive is plugged in. launchd's minimal PATH can't find yt-dlp/ffmpeg, so prepend
# Homebrew. Bails fast (mount guard in sync_setlists.py) if the drive is absent.
export PATH="/opt/homebrew/bin:/usr/bin:/bin:$PATH"
cd "$HOME/Projects/01-web-apps/pyaar-radio" || exit 0
echo "===== $(date) automount fire =====" >> /tmp/pyaar-setlist-automount.log
/opt/homebrew/bin/python3 scripts/sync_setlists.py --auto-only >> /tmp/pyaar-setlist-automount.log 2>&1
