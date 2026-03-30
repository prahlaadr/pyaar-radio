#!/bin/bash
# Build channels.json for pyaar.tv using yt-dlp
# Usage: ./scripts/build-tv-channels.sh

set -e

OUT="/Users/prahlaad/Documents/Projects/01-web-apps/pyaar-radio/public/data/tv/channels.json"
TEMP_DIR=$(mktemp -d)

# Channel definitions: id|name|number|color|youtube_source|max_videos|filter(optional)
# youtube_source can be a channel URL, playlist URL, or search query
CHANNELS=(
  "dj-sets|DJ Sets|1|#ef4444|https://www.youtube.com/@boaboroom/videos|8"
  "live-performances|Live Performances|2|#f59e0b|https://www.youtube.com/playlist?list=PL1B627337ED6F55F0|8"
  "music-docs|Music Docs|3|#8b5cf6|https://www.youtube.com/@Polyphonic/videos|6"
  "ilaiyaraaja|Ilaiyaraaja|4|#dc2626|https://www.youtube.com/results?search_query=ilaiyaraaja+full+songs+concert&sp=EgIYAg%253D%253D|6"
  "ramana-balachandran|Ramana Balachandran|5|#f97316|https://www.youtube.com/results?search_query=ramana+balachandran+carnatic+violin&sp=EgIYAg%253D%253D|6"
  "carnatic|Carnatic|6|#eab308|https://www.youtube.com/@MadRasana/videos|8"
  "nts-radio|NTS Radio|7|#06b6d4|https://www.youtube.com/@TheLotRadio/videos|6"
  "jeopardy|Jeopardy|8|#3b82f6|https://www.youtube.com/results?search_query=jeopardy+full+episode&sp=EgIYAg%253D%253D|6"
  "tom-and-jerry|Tom & Jerry|9|#a855f7|https://www.youtube.com/results?search_query=tom+and+jerry+classic+compilation&sp=EgIYAg%253D%253D|5"
  "bts|BTS|10|#ec4899|https://www.youtube.com/@BANGTANTV/videos|10"
  "top-gear|Top Gear|11|#22c55e|https://www.youtube.com/results?search_query=top+gear+special+full+episode&sp=EgIYAg%253D%253D|5"
  "all-gas-no-brakes|Channel 5|12|#14b8a6|https://www.youtube.com/@Channel5YouTube/videos|8"
  "good-mythical-morning|Good Mythical Morning|13|#84cc16|https://www.youtube.com/@GoodMythicalMorning/videos|8"
  "tiny-desk|Tiny Desk|14|#f43f5e|https://www.youtube.com/playlist?list=PL1B627337ED6F55F0|10"
  "colors|COLORS|15|#fb923c|https://www.youtube.com/@COLORSxSTUDIOS/videos|10"
  "like-a-version|Like a Version|16|#facc15|https://www.youtube.com/playlist?list=PLpavMae94dCnJMAjr_3VR2VGOeNHtBV6W|8"
  "boiler-room|Boiler Room|17|#171717|https://www.youtube.com/@boilerroom/videos|8"
  "madrasana|MadRasana|18|#b91c1c|https://www.youtube.com/@MadRasana/videos|8"
  "coke-studio|Coke Studio|19|#e11d48|https://www.youtube.com/playlist?list=PLJYnOIuV3C4HGtPLj-9CsEjodxN_gk1aM|8"
  "lot-radio|The Lot Radio|20|#737373|https://www.youtube.com/@TheLotRadio/videos|5"
  "hot-ones|Hot Ones|21|#ea580c|https://www.youtube.com/playlist?list=PLAzrgbu8gEMIIK3r4Se1dOZWSrGRCMBkv|8"
  "nardwuar|Nardwuar|22|#e879f9|https://www.youtube.com/@nardwuar/videos|8"
  "kill-tony|Kill Tony|23|#991b1b|https://www.youtube.com/@KillTony/videos|5"
  "rdcworld|RDCworld1|24|#0ea5e9|https://www.youtube.com/@RDCworld1/videos|8"
  "team-coco|Team Coco|25|#f97316|https://www.youtube.com/@TeamCoco/videos|6"
  "qi|QI|26|#2563eb|https://www.youtube.com/@TheQIElves/videos|8"
  "graham-norton|Graham Norton|27|#7c3aed|https://www.youtube.com/@OfficialGrahamNorton/videos|6"
  "snl|SNL|28|#f5f5f4|https://www.youtube.com/@SaturdayNightLive/videos|8"
  "kurzgesagt|Kurzgesagt|29|#38bdf8|https://www.youtube.com/@kurzgesagt/videos|8"
  "vox|Vox|30|#fbbf24|https://www.youtube.com/@Vox/videos|8"
  "defunctland|Defunctland|31|#065f46|https://www.youtube.com/@Defunctland/videos|6"
  "johnny-harris|Johnny Harris|32|#1d4ed8|https://www.youtube.com/@johnnyharris/videos|6"
  "fireship|Fireship|33|#f97316|https://www.youtube.com/@Fireship/videos|10"
  "mkbhd|MKBHD|34|#dc2626|https://www.youtube.com/@mkbhd/videos|6"
  "doug-demuro|Doug DeMuro|35|#16a34a|https://www.youtube.com/@DougDeMuro/videos|6"
  "architectural-digest|Architectural Digest|36|#a3a3a3|https://www.youtube.com/@Archdigest/videos|6"
  "spongebob|SpongeBob|37|#facc15|https://www.youtube.com/results?search_query=spongebob+full+episodes+compilation&sp=EgIYAg%253D%253D|4"
  "nba|NBA Highlights|38|#1d4ed8|https://www.youtube.com/results?search_query=nba+highlights+2025+full+game&sp=EgIYAg%253D%253D|6"
  "needledrop|theneedledrop|39|#a3e635|https://www.youtube.com/@theneedledrop/videos|8"
)

echo "Fetching video data for ${#CHANNELS[@]} channels..."

# Start JSON
echo '{ "channels": [' > "$OUT.tmp"

FIRST=true
for entry in "${CHANNELS[@]}"; do
  IFS='|' read -r id name number color source max_videos <<< "$entry"

  echo "  [$number] $name ($id) — fetching $max_videos videos..."

  # Fetch videos with yt-dlp
  VIDEOS=$(yt-dlp --flat-playlist \
    --print "%(id)s\t%(title)s\t%(duration)s" \
    "$source" \
    --playlist-end "$max_videos" \
    2>/dev/null || echo "")

  if [ -z "$VIDEOS" ]; then
    echo "    ⚠ No videos found, skipping"
    continue
  fi

  # Add comma separator between channels
  if [ "$FIRST" = true ]; then
    FIRST=false
  else
    echo ',' >> "$OUT.tmp"
  fi

  # Build channel JSON
  cat >> "$OUT.tmp" << CHAN_START
    {
      "id": "$id",
      "name": $(python3 -c "import json; print(json.dumps('$name'))"),
      "number": $number,
      "color": "$color",
      "videos": [
CHAN_START

  VIDEO_FIRST=true
  while IFS=$'\t' read -r vid_id vid_title vid_duration; do
    # Skip if no video ID or duration
    [ -z "$vid_id" ] && continue
    [ -z "$vid_duration" ] && continue
    # Convert duration to integer
    dur_int=$(python3 -c "print(int(float('${vid_duration}')))" 2>/dev/null || echo "0")
    [ "$dur_int" = "0" ] && continue

    # Escape title for JSON
    safe_title=$(python3 -c "import json; print(json.dumps('''${vid_title}'''))" 2>/dev/null || echo "\"$vid_title\"")

    if [ "$VIDEO_FIRST" = true ]; then
      VIDEO_FIRST=false
    else
      echo ',' >> "$OUT.tmp"
    fi

    printf '        { "videoId": "%s", "title": %s, "durationSeconds": %d }' \
      "$vid_id" "$safe_title" "$dur_int" >> "$OUT.tmp"

  done <<< "$VIDEOS"

  echo '' >> "$OUT.tmp"
  printf '      ]\n    }' >> "$OUT.tmp"

  VIDEO_COUNT=$(echo "$VIDEOS" | grep -c . || echo 0)
  echo "    ✓ $VIDEO_COUNT videos"
done

echo '' >> "$OUT.tmp"
echo '  ]' >> "$OUT.tmp"
echo '}' >> "$OUT.tmp"

# Validate JSON
if python3 -c "import json; json.load(open('$OUT.tmp'))" 2>/dev/null; then
  # Pretty-print
  python3 -c "import json; data=json.load(open('$OUT.tmp')); json.dump(data, open('$OUT', 'w'), indent=2)"
  rm "$OUT.tmp"

  TOTAL_CHANNELS=$(python3 -c "import json; print(len(json.load(open('$OUT'))['channels']))")
  TOTAL_VIDEOS=$(python3 -c "import json; print(sum(len(c['videos']) for c in json.load(open('$OUT'))['channels']))")
  echo ""
  echo "✓ Done! $TOTAL_CHANNELS channels, $TOTAL_VIDEOS videos"
  echo "  Written to: $OUT"
else
  echo "✗ JSON validation failed"
  cat "$OUT.tmp"
  rm "$OUT.tmp"
  exit 1
fi
