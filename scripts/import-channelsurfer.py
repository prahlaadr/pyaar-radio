#!/usr/bin/env python3
"""Import Channel Surfer's actual video titles into pyaar.tv channels.

Reads scraped CS video titles from /tmp/channelsurfer-videos.json,
searches YouTube for each via yt-dlp, and merges into channels.json.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
OUT = ROOT / "public" / "data" / "tv" / "channels.json"
CS_DATA = Path("/tmp/channelsurfer-videos.json")

# Map CS channel names → pyaar.tv channel IDs
CS_TO_PYAAR = {
    "City & Infrastructure": "cs-city-infrastructure",
    "Code & Dev": "cs-code-dev",
    "Crime & Investigations": "cs-crime",
    "Gaming": "cs-gaming",
    "Geopolitics": "cs-geopolitics",
    "History": "cs-history",
    "Lofi / Synthwave / Ambient": "cs-lofi-ambient",
    "Lofi Car": "cs-lofi-car",
    "Movie Trailers": "cs-movie-trailers",
    "Movies & TV": "cs-movies-tv",
    "Retro (50s/60s/70s)": "cs-retro-music",
    "Retro Tech": "cs-retro-tech",
    "Space": "cs-space",
    "Travel": "cs-travel",
    "Mystery": "cs-mystery",
    "Adult Animation": "cs-adult-animation",
    "Anime": "cs-anime",
    "Art": "cs-art",
    "Party": "cs-party",
    # Also enrich existing pyaar channels with CS content
    "Comedy": "comedy-mix",  # will merge into existing comedy channels
    "Cooking": "cooking-mix",
    "Explainers": "explainers",
    "Popular Science": "popular-science",
    "Music": "dj-sets",
    "Music 2020s": "music-2020s",
    "Music 2010 - 20": "music-2010s",
    "Music 2000s": "music-2000s",
    "Music 90s": "music-90s",
    "Music 80s": "music-80s",
    "Nature 4K": "nature-india",
    "Pop Culture": "music-docs",
    "Sports": "nba",
}


def search_video(title: str) -> dict | None:
    """Search YouTube for a specific video title."""
    try:
        r = subprocess.run(
            ["yt-dlp", "--flat-playlist", "--print", "%(id)s\t%(title)s\t%(duration)s",
             f"ytsearch1:{title}", "--playlist-end", "1"],
            capture_output=True, text=True, timeout=30,
        )
        for line in r.stdout.strip().split("\n"):
            if not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 3:
                continue
            try:
                dur = int(float(parts[2]))
            except:
                continue
            if dur > 0:
                return {"videoId": parts[0], "title": parts[1], "durationSeconds": dur}
    except:
        pass
    return None


def main():
    with open(CS_DATA) as f:
        cs_data = json.load(f)

    with open(OUT) as f:
        pyaar_data = json.load(f)

    # Build lookup by channel ID
    channel_map = {ch["id"]: ch for ch in pyaar_data["channels"]}

    # Track existing video IDs to avoid duplicates
    existing_ids = set()
    for ch in pyaar_data["channels"]:
        for v in ch["videos"]:
            existing_ids.add(v["videoId"])

    total_added = 0

    for cs_name, cs_info in cs_data.items():
        pyaar_id = CS_TO_PYAAR.get(cs_name)
        if not pyaar_id:
            continue

        # Skip channels that map to composite names (comedy-mix, cooking-mix)
        if pyaar_id not in channel_map:
            continue

        channel = channel_map[pyaar_id]
        titles = cs_info["videos"][:15]  # Max 15 from CS per channel

        print(f"\n  [{cs_name}] → {channel['name']} — searching {len(titles)} CS videos...")

        added = 0
        for title in titles:
            if len(channel["videos"]) >= 40:  # Cap at 40 per channel
                break
            video = search_video(title)
            if video and video["videoId"] not in existing_ids:
                existing_ids.add(video["videoId"])
                channel["videos"].append(video)
                added += 1

        if added:
            print(f"       ✓ +{added} CS videos (now {len(channel['videos'])} total)")
            total_added += added
        else:
            print(f"       — no new videos")

    with open(OUT, "w") as f:
        json.dump(pyaar_data, f, indent=2, ensure_ascii=False)

    total_videos = sum(len(ch["videos"]) for ch in pyaar_data["channels"])
    print(f"\n✓ Done! Added {total_added} Channel Surfer videos")
    print(f"  Total: {len(pyaar_data['channels'])} channels, {total_videos} videos")


if __name__ == "__main__":
    main()
