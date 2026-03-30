# Pyaar.TV — Requirements & Documentation

## Overview

A Channel Surfer-inspired TV guide built into Pyaar Radio at `/tv`. Simulates live TV channels using curated YouTube video playlists. Users browse a channel guide, tune in, and watch content "live" — joining mid-stream based on wall-clock time. Skip button allows advancing to next video in the playlist.

## Inspiration

[channelsurfer.tv](https://channelsurfer.tv/) — turns YouTube into a retro cable TV guide with 47+ channels. Pyaar.TV matches Pyaar Radio's dark UI (not retro CRT), uses deterministic modulo-based scheduling (no server needed), and adds a skip button for manual advancement.

## Current State

- **60 channels, ~630 videos** with real YouTube video IDs and exact durations
- All video data sourced programmatically via `yt-dlp`
- Auto-refreshed weekly via GitHub Actions (`sync-tv-channels.yml`)
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

Channel list is defined in `scripts/build-tv-channels.py` and auto-refreshed weekly.
Video counts vary as content is pulled fresh from YouTube.

| Category | Channels | Source type |
|----------|----------|-------------|
| Music Performance | DJ Sets, Live Performances, Boiler Room, Tiny Desk, COLORS, Like a Version, Coke Studio | Personalized (artist cross-ref) |
| Indian Classical | Ilaiyaraaja, Ramana Balachandran, Carnatic, Amrutha Venkatesh | Composite (MadRasana + Ranjani-Gayatri + Mystica) |
| Radio | Radio (Lot Radio + NTS + Dekmantel + Lucid Monday + STEEZYASFUCK + aprtment life + Forgotten) | Composite |
| Music by Decade | Music 80s, 90s, 2000s, 2010s, 2020s | Curated (hand-picked iconic videos) |
| Music Docs/Reviews | Music Docs (Polyphonic + Trash Theory + Charles Cornell + Dallas Taylor + Tape Notes + Nerdstalgic + Scene It + Vox Earworm), theneedledrop | Composite |
| Beat Making | Beat Making (You Suck at Producing + Jon Makes Beats + Kambo Beatz + VER sounds + dynmk) | Composite |
| Comedy/Talk | Hot Ones, Nardwuar, Kill Tony, RDCworld1, Team Coco, QI, Graham Norton, SNL, Adam Friedland Show, Nimesh Patel, Louis C.K., videogamedunkey, Almost Friday TV, CrackerMilk | Standard |
| Explainers | Explainers (Kurzgesagt + Vox + Wendover + CGP Grey + Vsauce + Big Think + David Shapiro), Defunctland | Composite |
| Popular Science | Popular Science (Veritasium + SciShow + CrashCourse) | Composite |
| Tech | Tech (Fireship + MKBHD + The Studio + Theo t3.gg + KRAZAM) | Composite |
| Entertainment | Jeopardy, Tom & Jerry, BTS, Top Gear, Channel 5, Good Mythical Morning, SpongeBob | Standard |
| Sports | NBA (J.D. + Ringer NBA + NBA Recap + TNT Sports + highlights) | Composite |
| Home/Design | Home & Design (AD + Dear Modern + MoMA) | Composite |
| Business/News | Business & News (Bloomberg + WSJ + Modern MBA + Good Work) | Composite |
| Long-form | Lex Fridman, Hasan Minhaj, JRE Clips, Lenny's Podcast | Standard |
| Cooking | Hebbar's Kitchen, Tamil Cooking, Sanjana Feasts, Doobydobap | Standard |
| Medical | Mehlman Medical | Standard |
| Watches | Vookum | Standard |
| Nature | Nature India (Roundglass Sustain + Nat Geo India + 4K docs) | Composite |
| Music (other) | On The Radar, Doug DeMuro, Van Neistat | Standard |

### Channel pipeline types

| Type | How it works | Example |
|------|-------------|---------|
| **Standard** | Pulls latest N videos from one YouTube channel | `@KillTony/videos` → 5 latest |
| **Composite** | Merges videos from multiple YouTube channels/searches | Radio = Lot Radio + NTS + Dekmantel + ... |
| **Personalized** | Searches each artist in `artists.csv` against a platform, validates artist in title | Boiler Room = your 294 artists × "boiler room DJ set" |
| **Curated** | Hand-picked search queries for specific iconic videos | Music 80s = Thriller, Take On Me, ... |

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
.github/workflows/sync-tv-channels.yml — Weekly auto-refresh (Sundays 7 AM EST)
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
