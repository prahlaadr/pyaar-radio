# Pyaar.TV — Requirements & Documentation

## Overview

A Channel Surfer-inspired TV guide built into Pyaar Radio at `/tv`. Simulates live TV channels using curated YouTube video playlists. Users browse a channel guide, tune in, and watch content "live" — joining mid-stream based on wall-clock time. Skip button allows advancing to next video in the playlist.

## Inspiration

[channelsurfer.tv](https://channelsurfer.tv/) — turns YouTube into a retro cable TV guide with 47+ channels. Pyaar.TV matches Pyaar Radio's dark UI (not retro CRT), uses deterministic modulo-based scheduling (no server needed), and adds a skip button for manual advancement.

## Current State

- **51 channels, 426 videos** with real YouTube video IDs and exact durations
- All video data sourced programmatically via `yt-dlp`
- Live at `pyaar-radio.vercel.app/tv`

## Core Features

### 1. TV Guide
- Channel list showing all available channels
- Each row displays: channel number, name, currently playing video title, time remaining
- Active channel highlighted with accent color
- Progress bar per channel showing position in current video

### 2. "Live" Playback
- Channels loop their video playlist infinitely
- Position computed from wall-clock time: `position = now % totalPlaylistDuration`
- All users see the same content at the same wall-clock second
- Tuning into a channel joins the video mid-stream at the calculated offset

### 3. Skip Button
- "Skip >>" button in the video title bar
- Advances to next video in the channel's playlist from the start
- Sequential advancement (not schedule-based) for free browsing

### 4. Full-Size Video Player
- Large visible YouTube embed with native controls
- Auto-advances to next video when current ends

### 5. Keyboard Navigation
- `j` / `Arrow Down` — next channel
- `k` / `Arrow Up` — previous channel
- `g` — toggle guide visibility

## Channels (51)

| # | ID | Name | Videos |
|---|-----|------|--------|
| 1 | dj-sets | DJ Sets | 8 |
| 2 | live-performances | Live Performances | 8 |
| 3 | music-docs | Music Docs | 6 |
| 4 | ilaiyaraaja | Ilaiyaraaja | 8 |
| 5 | ramana-balachandran | Ramana Balachandran | 6 |
| 6 | carnatic | Carnatic | 8 |
| 7 | amrutha-venkatesh | Amrutha Venkatesh | 20 |
| 8 | nts-radio | NTS Radio | 6 |
| 9 | jeopardy | Jeopardy | 6 |
| 10 | tom-and-jerry | Tom & Jerry | 4 |
| 11 | bts | BTS | 10 |
| 12 | top-gear | Top Gear | 5 |
| 13 | all-gas-no-brakes | Channel 5 | 8 |
| 14 | good-mythical-morning | Good Mythical Morning | 8 |
| 15 | tiny-desk | Tiny Desk | 10 |
| 16 | colors | COLORS | 10 |
| 17 | like-a-version | Like a Version | 8 |
| 18 | boiler-room | Boiler Room | 15 |
| 19 | madrasana | MadRasana | 8 |
| 20 | coke-studio | Coke Studio | 8 |
| 21 | lot-radio | The Lot Radio | 5 |
| 22 | hot-ones | Hot Ones | 8 |
| 23 | nardwuar | Nardwuar | 8 |
| 24 | kill-tony | Kill Tony | 5 |
| 25 | rdcworld | RDCworld1 | 8 |
| 26 | team-coco | Team Coco | 6 |
| 27 | qi | QI | 8 |
| 28 | graham-norton | Graham Norton | 6 |
| 29 | snl | SNL | 8 |
| 30 | kurzgesagt | Kurzgesagt | 8 |
| 31 | vox | Vox | 8 |
| 32 | defunctland | Defunctland | 6 |
| 33 | johnny-harris | Johnny Harris | 6 |
| 34 | fireship | Fireship | 10 |
| 35 | mkbhd | MKBHD | 6 |
| 36 | doug-demuro | Doug DeMuro | 6 |
| 37 | architectural-digest | Architectural Digest | 6 |
| 38 | spongebob | SpongeBob | 4 |
| 39 | nba | NBA Highlights | 6 |
| 40 | needledrop | theneedledrop | 8 |
| 41 | mehlman-medical | Mehlman Medical | 10 |
| 42 | music-80s | Music 80s | 10 |
| 43 | music-90s | Music 90s | 10 |
| 44 | music-2000s | Music 2000s | 10 |
| 45 | music-2010s | Music 2010s | 10 |
| 46 | music-2020s | Music 2020s | 10 |
| 47 | popular-science | Popular Science | 10 |
| 48 | lennys-podcast | Lenny's Podcast | 10 |
| 49 | hebbars-kitchen | Hebbar's Kitchen | 15 |
| 50 | tamil-cooking | Tamil Cooking | 15 |
| 51 | adam-friedland | Adam Friedland Show | 10 |

## Data Model

### Channel JSON (`public/data/tv/channels.json`)

```json
{
  "channels": [
    {
      "id": "dj-sets",
      "name": "DJ Sets",
      "number": 1,
      "color": "#ef4444",
      "videos": [
        {
          "videoId": "youtube-video-id",
          "title": "Boiler Room: Four Tet",
          "durationSeconds": 3600
        }
      ]
    }
  ]
}
```

- `id`: URL-safe slug
- `name`: Display name
- `number`: Channel number (for guide display + keyboard nav)
- `color`: Hex accent color (default: red `#ef4444`)
- `videos`: Ordered playlist. `durationSeconds` must be accurate for scheduling.

## Architecture

### Section mode within page.tsx
- TV is a section mode (`sectionMode === "tv"`) like Tamil, Downtempo, Ambient
- `/tv` route re-exports Home component, detected via pathname
- TV button in header bar next to "PYAAR RADIO" logo
- Filter panel hides when TV mode is active (TV has its own inline UI)

### Scheduling algorithm (`src/lib/tv-schedule.ts`)
- Deterministic: `position = Math.floor(Date.now() / 1000) % totalChannelDuration`
- Walk through video list, accumulate durations to find current video + offset
- Returns: current video, seek offset, next video, seconds until next
- All users see the same content at the same wall-clock second

### Component structure
```
src/app/tv/page.tsx           — Re-exports Home (section routing)
src/components/tv-player.tsx  — Full-size YouTube embed with skip button
src/components/tv-guide.tsx   — Channel guide with live progress bars
src/lib/tv-types.ts           — TypeScript interfaces
src/lib/tv-schedule.ts        — Scheduling algorithm
src/lib/youtube-api.ts        — Shared YouTube IFrame API loader
public/data/tv/channels.json  — Channel data (51 channels, 426 videos)
scripts/build-tv-channels.py  — yt-dlp script to populate channel data
```

### Shared code
- `youtube-api.ts` — extracted `ensureYTAPI()` singleton shared between the radio player (`youtube-player.tsx`) and the TV player (`tv-player.tsx`)

## UI Design

Matches Pyaar Radio aesthetic:
- **Background:** `#000000`
- **Surfaces:** `#111111`
- **Borders:** `#222222`
- **Text:** White, with `#888` for secondary, `#666` for muted
- **Accent:** Per-channel color, default `#ef4444` (red)
- **Font:** Rajdhani, uppercase, wide tracking

### Layout
- **Desktop:** Player (~60% left) + guide (~40% right, 340px sidebar)
- **Mobile:** Full-width player with collapsible guide overlay

### Guide Row
- Channel number (monospace, muted)
- Channel name (uppercase, tracking-wider)
- Now playing video title (truncated, secondary text)
- Time remaining (monospace, right-aligned)
- Progress bar at bottom of row
- Active channel: left border accent color

## Adding New Channels

### Programmatic (recommended)
Add to `scripts/build-tv-channels.py` and re-run:
```bash
python3 scripts/build-tv-channels.py
```

### Quick add via Python one-liner
```bash
python3 -c "
import json, subprocess
r = subprocess.run(['yt-dlp', '--flat-playlist', '--print', '%(id)s\t%(title)s\t%(duration)s',
    'https://www.youtube.com/@ChannelHandle/videos', '--playlist-end', '10'],
    capture_output=True, text=True, timeout=60)
videos = []
for line in r.stdout.strip().split('\n'):
    parts = line.split('\t')
    if len(parts) == 3:
        try: videos.append({'videoId': parts[0], 'title': parts[1], 'durationSeconds': int(float(parts[2]))})
        except: pass
with open('public/data/tv/channels.json') as f: data = json.load(f)
max_num = max(c['number'] for c in data['channels'])
data['channels'].append({'id': 'channel-id', 'name': 'Channel Name', 'number': max_num + 1, 'color': '#ef4444', 'videos': videos})
with open('public/data/tv/channels.json', 'w') as f: json.dump(data, f, indent=2, ensure_ascii=False)
"
```

## Future Considerations

- Channel categories/grouping
- User-submitted channels
- Favorites/recently watched
- Schedule variety (different content by day of week)
- Channel previews on hover
- Picture-in-picture support
- Import channels from YouTube subscriptions
- Sync with Channel Surfer's channel list
