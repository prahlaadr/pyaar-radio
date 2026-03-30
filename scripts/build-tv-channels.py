#!/usr/bin/env python3
"""Build channels.json for pyaar.tv using yt-dlp.

Run manually: python3 scripts/build-tv-channels.py
Run via CI:   triggered by GitHub Actions weekly

Music channels (Boiler Room, Tiny Desk, COLORS, Like a Version, KEXP, Coke Studio)
are personalized by cross-referencing against artists.csv.
Results are validated to ensure the artist name actually appears in the video title.

Priority playlists are checked first — videos from these playlists are slotted
into matching channels before searching YouTube.
"""

import json
import csv
import subprocess
import sys
import random
import re
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "public" / "data" / "tv" / "channels.json"
ARTISTS_CSV = ROOT / "public" / "data" / "artists.csv"

# Priority playlists — videos from these are matched into channels first
PRIORITY_PLAYLISTS = [
    "https://youtube.com/playlist?list=PLwAEV90m3Ui5cZWAvkHFOq-wcxVH7zaGs",
    "https://youtube.com/playlist?list=PLdI65Nm_pp9s0GLdfAO-UF_-iz2MOfIMh",
]

# Keywords to match priority playlist videos to channels
CHANNEL_KEYWORDS = {
    "tiny-desk": ["tiny desk"],
    "colors": ["colors show", "a colors"],
    "like-a-version": ["like a version"],
    "boiler-room": ["boiler room"],
    "live-performances": ["kexp", "live session", "live at", "full performance", "audiotree"],
    "coke-studio": ["coke studio"],
    "hebbars-kitchen": ["hebbars kitchen", "hebbar"],
    "tamil-cooking": ["home cooking tamil", "tamil cooking"],
}


def load_artists() -> list[dict]:
    """Load artist names and aliases from artists.csv."""
    artists = []
    with open(ARTISTS_CSV) as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("artist", "").strip().strip('"')
            if not name or name == "artist":
                continue
            aliases = []
            raw_aliases = row.get("aliases", "").strip().strip('"')
            if raw_aliases:
                aliases = [a.strip().lstrip("~") for a in raw_aliases.split("|") if a.strip()]
            artists.append({"name": name, "aliases": aliases})
    return artists


def artist_in_title(artist: dict, title: str) -> bool:
    """Check if an artist name or any alias appears in a video title."""
    title_lower = title.lower()
    # Check primary name
    name_lower = artist["name"].lower()
    if len(name_lower) > 2 and name_lower in title_lower:
        return True
    # Check aliases
    for alias in artist["aliases"]:
        alias_lower = alias.lower()
        if len(alias_lower) > 2 and alias_lower in title_lower:
            return True
    return False


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
        print(f"      ⚠ Error: {e}", file=sys.stderr)
        return []


def fetch_priority_videos() -> list[dict]:
    """Fetch all videos from priority playlists."""
    all_videos = []
    for url in PRIORITY_PLAYLISTS:
        print(f"  Fetching priority playlist: {url[:60]}...")
        videos = fetch_videos(url, 200)
        print(f"    ✓ {len(videos)} videos")
        all_videos.extend(videos)
    return all_videos


def match_priority_to_channel(priority_videos: list[dict], channel_id: str) -> list[dict]:
    """Find priority playlist videos that match a channel by keywords."""
    keywords = CHANNEL_KEYWORDS.get(channel_id, [])
    if not keywords:
        return []
    matched = []
    for v in priority_videos:
        title_lower = v["title"].lower()
        if any(kw in title_lower for kw in keywords):
            matched.append(v)
    return matched


def fetch_artist_videos(
    artists: list[dict],
    platform_query: str,
    max_per_artist: int = 1,
    min_duration: int = 0,
    max_total: int = 20,
    priority_videos: list[dict] | None = None,
    channel_id: str = "",
) -> list[dict]:
    """Search for each artist on a platform, validate results, collect best matches."""
    seen_ids = set()
    videos = []

    # First: add priority playlist matches
    if priority_videos and channel_id:
        priority_matches = match_priority_to_channel(priority_videos, channel_id)
        for v in priority_matches:
            if v["videoId"] not in seen_ids and v["durationSeconds"] >= min_duration:
                seen_ids.add(v["videoId"])
                videos.append(v)
                if len(videos) >= max_total:
                    return videos
        if priority_matches:
            print(f"       + {len([v for v in priority_matches if v['videoId'] in seen_ids])} from priority playlists")

    # Then: search each artist, validate title contains artist name
    shuffled = artists.copy()
    random.shuffle(shuffled)

    for artist in shuffled:
        if len(videos) >= max_total:
            break
        query = f"ytsearch{max_per_artist}:{artist['name']} {platform_query}"
        results = fetch_videos(query, max_per_artist)
        for v in results:
            if v["videoId"] in seen_ids:
                continue
            if v["durationSeconds"] < min_duration:
                continue
            # Validate: artist name or alias must appear in the title
            if not artist_in_title(artist, v["title"]):
                continue
            seen_ids.add(v["videoId"])
            videos.append(v)

    return videos


# Standard channels: (id, name, number, color, yt_source, max_videos)
STANDARD_CHANNELS = [
    # Music (non-personalized)
    ("dj-sets", "DJ Sets", 1, "#ef4444", "ytsearch8:DJ set full Cercle HÖR Berlin Rinse FM", 8),
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

    # Music Curation (non-personalized)
    ("madrasana", "MadRasana", 21, "#b91c1c", "https://www.youtube.com/@MadRasana/videos", 8),

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
    ("sanjana-feasts", "Sanjana Feasts", 52, "#f97316", "https://youtube.com/playlist?list=PLdI65Nm_pp9s0GLdfAO-UF_-iz2MOfIMh", 15),
]

# Personalized channels: (id, name, number, color, platform_query, min_duration, max_total)
PERSONALIZED_CHANNELS = [
    ("live-performances", "Live Performances", 2, "#f59e0b", "KEXP full performance live", 300, 15),
    ("tiny-desk", "Tiny Desk", 17, "#f43f5e", "tiny desk concert", 600, 15),
    ("colors", "COLORS", 18, "#fb923c", "COLORS show", 120, 15),
    ("like-a-version", "Like a Version", 19, "#facc15", "like a version triple j", 120, 12),
    ("boiler-room", "Boiler Room", 20, "#171717", "boiler room DJ set", 1800, 15),
    ("coke-studio", "Coke Studio", 22, "#e11d48", "coke studio", 180, 12),
]


def main():
    print("Loading artists from artists.csv...")
    artists = load_artists()
    print(f"  {len(artists)} artists loaded\n")

    print("=== Priority Playlists ===")
    priority_videos = fetch_priority_videos()
    print(f"  Total: {len(priority_videos)} priority videos\n")

    channels = []
    total_videos = 0
    failed = []

    # Build standard channels
    print("=== Standard Channels ===")
    for ch_id, name, number, color, source, max_vids in STANDARD_CHANNELS:
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

    # Build personalized channels (cross-reference artists.csv + priority playlists)
    print("\n=== Personalized Channels (artist cross-reference) ===")
    for ch_id, name, number, color, platform_query, min_dur, max_total in PERSONALIZED_CHANNELS:
        print(f"  [{number:>2}] {name} — searching {len(artists)} artists for '{platform_query}'...")
        videos = fetch_artist_videos(
            artists, platform_query,
            max_per_artist=1, min_duration=min_dur, max_total=max_total,
            priority_videos=priority_videos, channel_id=ch_id,
        )
        if not videos:
            print(f"       ⚠ No videos found")
            failed.append(name)
        else:
            print(f"       ✓ {len(videos)} verified videos from your artists")
            total_videos += len(videos)

        channels.append({
            "id": ch_id,
            "name": name,
            "number": number,
            "color": color,
            "videos": videos,
        })

    # Sort by channel number
    channels.sort(key=lambda c: c["number"])

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
