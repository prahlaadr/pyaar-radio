#!/usr/bin/env python3
"""Build channels.json for pyaar.tv using yt-dlp.

Run manually: python3 scripts/build-tv-channels.py
Run via CI:   triggered by GitHub Actions weekly
"""

import json
import subprocess
import sys
from pathlib import Path

OUT = Path(__file__).parent.parent / "public" / "data" / "tv" / "channels.json"

# (id, name, number, color, yt_source, max_videos)
CHANNELS = [
    # Music Performance
    ("dj-sets", "DJ Sets", 1, "#ef4444", "ytsearch8:DJ set full Cercle HÖR Berlin Rinse FM", 8),
    ("live-performances", "Live Performances", 2, "#f59e0b", "ytsearch8:KEXP live session full performance Audiotree", 8),
    ("music-docs", "Music Docs", 3, "#8b5cf6", "https://www.youtube.com/@Polyphonic/videos", 6),

    # Indian Classical & Film
    ("ilaiyaraaja", "Ilaiyaraaja", 4, "#dc2626", "ytsearch8:ilaiyaraaja full songs concert film", 8),
    ("ramana-balachandran", "Ramana Balachandran", 5, "#f97316", "ytsearch6:ramana balachandran carnatic violin", 6),
    ("carnatic", "Carnatic", 6, "#eab308", "ytsearch8:carnatic concert full Ranjani Gayatri sabha", 8),
    ("amrutha-venkatesh", "Amrutha Venkatesh", 7, "#f59e0b", "ytsearch20:amrutha venkatesh carnatic", 20),

    # Radio
    ("nts-radio", "NTS Radio", 8, "#06b6d4", "ytsearch6:NTS radio live session mix", 6),
    ("lot-radio", "The Lot Radio", 9, "#737373", "https://www.youtube.com/@TheLotRadio/videos", 5),

    # Entertainment
    ("jeopardy", "Jeopardy", 10, "#3b82f6", "ytsearch6:jeopardy full episode compilation", 6),
    ("tom-and-jerry", "Tom & Jerry", 11, "#a855f7", "ytsearch5:tom and jerry classic compilation full", 5),
    ("bts", "BTS", 12, "#ec4899", "ytsearch10:BTS official music video", 10),
    ("top-gear", "Top Gear", 13, "#22c55e", "ytsearch5:top gear special full episode Bolivia Vietnam", 5),
    ("all-gas-no-brakes", "Channel 5", 14, "#14b8a6", "https://www.youtube.com/@Channel5YouTube/videos", 8),
    ("good-mythical-morning", "Good Mythical Morning", 15, "#84cc16", "https://www.youtube.com/@GoodMythicalMorning/videos", 8),
    ("spongebob", "SpongeBob", 16, "#facc15", "ytsearch4:spongebob full episodes compilation marathon", 4),

    # Music Curation
    ("tiny-desk", "Tiny Desk", 17, "#f43f5e", "https://www.youtube.com/@nprmusic/videos", 10),
    ("colors", "COLORS", 18, "#fb923c", "https://www.youtube.com/@COLORSxSTUDIOS/videos", 10),
    ("like-a-version", "Like a Version", 19, "#facc15", "ytsearch8:triple j like a version best", 8),
    ("boiler-room", "Boiler Room", 20, "#171717", "ytsearch15:boiler room DJ set full", 15),
    ("madrasana", "MadRasana", 21, "#b91c1c", "https://www.youtube.com/@MadRasana/videos", 8),
    ("coke-studio", "Coke Studio", 22, "#e11d48", "ytsearch8:coke studio season 14 15 best", 8),

    # Comedy / Talk
    ("hot-ones", "Hot Ones", 23, "#ea580c", "https://www.youtube.com/@FirstWeFeast/videos", 8),
    ("nardwuar", "Nardwuar", 24, "#e879f9", "https://www.youtube.com/@nardwuar/videos", 8),
    ("kill-tony", "Kill Tony", 25, "#991b1b", "https://www.youtube.com/@KillTony/videos", 5),
    ("rdcworld", "RDCworld1", 26, "#0ea5e9", "https://www.youtube.com/@RDCworld1/videos", 8),
    ("team-coco", "Team Coco", 27, "#f97316", "https://www.youtube.com/@TeamCoco/videos", 6),
    ("qi", "QI", 28, "#2563eb", "https://www.youtube.com/@TheQIElves/videos", 8),
    ("graham-norton", "Graham Norton", 29, "#7c3aed", "https://www.youtube.com/@OfficialGrahamNorton/videos", 6),
    ("snl", "SNL", 30, "#f5f5f4", "https://www.youtube.com/@SaturdayNightLive/videos", 8),
    ("adam-friedland", "Adam Friedland Show", 31, "#a78bfa", "https://www.youtube.com/@TheAdamFriedlandShow/videos", 10),

    # Explainers / Docs
    ("kurzgesagt", "Kurzgesagt", 32, "#38bdf8", "https://www.youtube.com/@kurzgesagt/videos", 8),
    ("vox", "Vox", 33, "#fbbf24", "https://www.youtube.com/@Vox/videos", 8),
    ("defunctland", "Defunctland", 34, "#065f46", "https://www.youtube.com/@Defunctland/videos", 6),
    ("johnny-harris", "Johnny Harris", 35, "#1d4ed8", "https://www.youtube.com/@johnnyharris/videos", 6),
    ("popular-science", "Popular Science", 36, "#06b6d4", "https://www.youtube.com/@veritasium/videos", 10),

    # Tech
    ("fireship", "Fireship", 37, "#f97316", "https://www.youtube.com/@Fireship/videos", 10),
    ("mkbhd", "MKBHD", 38, "#dc2626", "https://www.youtube.com/@mkbhd/videos", 6),

    # Cars / Home
    ("doug-demuro", "Doug DeMuro", 39, "#16a34a", "https://www.youtube.com/@DougDeMuro/videos", 6),
    ("architectural-digest", "Architectural Digest", 40, "#a3a3a3", "https://www.youtube.com/@Archdigest/videos", 6),

    # Sports
    ("nba", "NBA Highlights", 41, "#1d4ed8", "ytsearch6:nba highlights 2025 full game best plays", 6),

    # Music Reviews
    ("needledrop", "theneedledrop", 42, "#a3e635", "https://www.youtube.com/@theneedledrop/videos", 8),

    # Medical
    ("mehlman-medical", "Mehlman Medical", 43, "#0d9488", "https://www.youtube.com/@Mehlmanmedical/videos", 10),

    # Music by Decade
    ("music-80s", "Music 80s", 44, "#f472b6", "ytsearch10:80s music hits official video Michael Jackson Prince Madonna", 10),
    ("music-90s", "Music 90s", 45, "#c084fc", "ytsearch10:90s music hits official video TLC Nirvana Tupac Notorious BIG", 10),
    ("music-2000s", "Music 2000s", 46, "#60a5fa", "ytsearch10:2000s music hits official video Outkast Kanye West Beyonce Usher", 10),
    ("music-2010s", "Music 2010s", 47, "#34d399", "ytsearch10:2010s music hits official video Kendrick Lamar Frank Ocean Drake", 10),
    ("music-2020s", "Music 2020s", 48, "#fbbf24", "ytsearch10:2020s music hits official video Tyler Creator SZA Doja Cat", 10),

    # Podcasts
    ("lennys-podcast", "Lenny's Podcast", 49, "#8b5cf6", "https://www.youtube.com/@LennysPodcast/videos", 10),

    # Cooking
    ("hebbars-kitchen", "Hebbar's Kitchen", 50, "#fb923c", "ytsearch15:hebbars kitchen recipe", 15),
    ("tamil-cooking", "Tamil Cooking", 51, "#ef4444", "https://www.youtube.com/@HomeCookingTamil/videos", 15),
]


def fetch_videos(source: str, max_videos: int) -> list[dict]:
    """Fetch videos from a YouTube source using yt-dlp."""
    try:
        result = subprocess.run(
            [
                "yt-dlp", "--flat-playlist",
                "--print", "%(id)s\t%(title)s\t%(duration)s",
                "--playlist-end", str(max_videos),
                source,
            ],
            capture_output=True, text=True, timeout=120,
        )
        videos = []
        for line in result.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            vid_id, title, duration_str = parts[0], parts[1], parts[2]
            try:
                duration = int(float(duration_str))
            except (ValueError, TypeError):
                continue
            if duration <= 0 or not vid_id:
                continue
            videos.append({
                "videoId": vid_id,
                "title": title,
                "durationSeconds": duration,
            })
        return videos
    except subprocess.TimeoutExpired:
        return []
    except Exception as e:
        print(f"    ⚠ Error: {e}", file=sys.stderr)
        return []


def main():
    channels = []
    total_videos = 0
    failed = []

    for ch_id, name, number, color, source, max_vids in CHANNELS:
        print(f"  [{number:>2}] {name} — fetching {max_vids} videos...")
        videos = fetch_videos(source, max_vids)
        if not videos:
            print(f"       ⚠ No videos found")
            failed.append(name)
        else:
            print(f"       ✓ {len(videos)} videos")
            total_videos += len(videos)

        channels.append({
            "id": ch_id,
            "name": name,
            "number": number,
            "color": color,
            "videos": videos,
        })

    data = {"channels": channels}

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

    print(f"\n✓ Done! {len(channels)} channels, {total_videos} videos")
    print(f"  Written to: {OUT}")
    if failed:
        print(f"  ⚠ Failed channels: {', '.join(failed)}")


if __name__ == "__main__":
    main()
