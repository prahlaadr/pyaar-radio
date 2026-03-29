# Pyaar.TV — Requirements

## Overview

A Channel Surfer-inspired TV guide built into Pyaar Radio at `/tv`. Simulates live TV channels using curated YouTube video playlists. Users browse a channel guide, tune in, and watch content "live" — joining mid-stream based on wall-clock time.

## Inspiration

[channelsurfer.tv](https://channelsurfer.tv/) — turns YouTube into a retro cable TV guide. Built with Next.js + PartyKit. 40+ channels, 175 YouTube sources, join-mid-stream playback, daily schedule generation via GitHub Actions.

**Key difference:** Pyaar.TV matches Pyaar Radio's dark UI (not retro CRT), and uses deterministic modulo-based scheduling (no server/PartyKit needed).

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
- No rewind/skip — you watch what's "on"

### 3. Full-Size Video Player
- Large visible YouTube embed (not the audio-only bottom bar from radio)
- YouTube native controls (play/pause/seek/fullscreen)
- Auto-advances to next video in channel when current ends

### 4. Channel Switching
- Click a channel in the guide to tune in
- Video loads at correct mid-stream offset
- Keyboard shortcuts: up/down arrows to browse, enter to tune in

## Initial Channels

| # | ID | Name | Content Type |
|---|-----|------|-------------|
| 1 | dj-sets | DJ Sets | Boiler Room, NTS mixes, festival sets |
| 2 | live-performances | Live Performances | Concert recordings, Tiny Desk, KEXP sessions |
| 3 | music-docs | Music Docs | Music/artist documentaries |
| 4 | ilaiyaraaja | Ilaiyaraaja | Tamil film songs, concerts, interviews |
| 5 | ramana-balachandran | Ramana Balachandran | Carnatic violin performances |
| 6 | carnatic | Carnatic | Various carnatic artists' performances |
| 7 | nts-radio | NTS Radio | NTS Radio music video selections |
| 8 | jeopardy | Jeopardy | Full Jeopardy episodes |
| 9 | tom-and-jerry | Tom & Jerry | Classic Tom and Jerry episodes |
| 10 | bts | BTS | BTS music videos and performances |
| 11 | top-gear | Top Gear | Top Gear episodes and specials |
| 12 | all-gas-no-brakes | All Gas No Brakes | AGNB/Channel 5 street interviews |

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

### Separate page at `/tv`
- Own component tree, not a section mode in the existing `page.tsx`
- Shares `layout.tsx` for fonts (Rajdhani) and theme
- Own state model (channels, schedule) — no overlap with radio state

### Scheduling algorithm
- Deterministic: `position = Math.floor(Date.now() / 1000) % totalChannelDuration`
- Walk through video list, accumulate durations to find current video + offset
- Returns: current video, seek offset, next video, seconds until next

### Component structure
```
src/app/tv/page.tsx           — Page orchestrator
src/components/tv-player.tsx  — Full-size YouTube embed
src/components/tv-guide.tsx   — Channel guide grid
src/lib/tv-types.ts           — TypeScript interfaces
src/lib/tv-schedule.ts        — Scheduling algorithm
src/lib/youtube-api.ts        — Shared YouTube IFrame API loader
public/data/tv/channels.json  — Channel data
```

## UI Design

Matches Pyaar Radio aesthetic:
- **Background:** `#000000`
- **Surfaces:** `#111111`
- **Borders:** `#222222`
- **Text:** White, with `#888` for secondary, `#666` for muted
- **Accent:** `#ef4444` (red) or per-channel color
- **Font:** Rajdhani, uppercase, wide tracking
- **Scrollbar:** 4px dark custom scrollbar

### Desktop Layout
- Split: player (~60% left) + guide (~40% right)
- Header: "PYAAR.TV" branding + "Radio" link back

### Mobile Layout
- Full-width player
- Collapsible guide overlay at bottom

## Navigation

- Radio header gets a "TV" link → `/tv`
- TV header gets a "Radio" link → `/`

## Future Considerations

- Channel categories/grouping
- User-submitted channels
- Favorites/recently watched
- Schedule variety (different content by day of week)
- Channel previews on hover
- Picture-in-picture support
