"use client";

import { useEffect, useState, useMemo } from "react";
import type { TVChannel } from "@/lib/tv-types";
import { getNowPlaying, formatTimeRemaining, getProgress } from "@/lib/tv-schedule";

// Channel → category mapping
const CHANNEL_CATEGORIES: Record<string, string> = {
  // Music Performance
  "dj-sets": "Music",
  "live-performances": "Music",
  "tiny-desk": "Music",
  "colors": "Music",
  "like-a-version": "Music",
  "boiler-room": "Music",
  "coke-studio": "Music",
  "on-the-radar": "Music",
  "radio": "Music",
  "music-docs": "Music",
  "needledrop": "Music",
  "beat-making": "Music",
  "cs-lofi-ambient": "Music",
  "cs-lofi-car": "Music",
  "cs-party": "Music",
  "saregama": "Music",

  // Music by Decade
  "music-80s": "Decades",
  "music-90s": "Decades",
  "music-2000s": "Decades",
  "music-2010s": "Decades",
  "music-2020s": "Decades",
  "cs-retro-music": "Decades",

  // Indian Classical
  "ilaiyaraaja": "Indian Classical",
  "ramana-balachandran": "Indian Classical",
  "carnatic": "Indian Classical",
  "amrutha-venkatesh": "Indian Classical",
  "madrasana": "Indian Classical",

  // Comedy / Talk
  "hot-ones": "Comedy & Talk",
  "nardwuar": "Comedy & Talk",
  "kill-tony": "Comedy & Talk",
  "rdcworld": "Comedy & Talk",
  "team-coco": "Comedy & Talk",
  "qi": "Comedy & Talk",
  "graham-norton": "Comedy & Talk",
  "snl": "Comedy & Talk",
  "adam-friedland": "Comedy & Talk",
  "nimesh-patel": "Comedy & Talk",
  "louis-ck": "Comedy & Talk",
  "videogamedunkey": "Comedy & Talk",
  "almost-friday": "Comedy & Talk",
  "crackermilk": "Comedy & Talk",
  "good-mythical-morning": "Comedy & Talk",

  // Long-form / Podcasts
  "lex-fridman": "Podcasts",
  "hasan-minhaj": "Podcasts",
  "joe-rogan": "Podcasts",
  "lennys-podcast": "Podcasts",

  // Explainers / Science / Docs
  "explainers": "Learn",
  "popular-science": "Learn",
  "cs-space": "Learn",
  "cs-history": "Learn",
  "cs-geopolitics": "Learn",
  "sapolsky": "Learn",
  "defunctland": "Learn",
  "cs-city-infrastructure": "Learn",

  // Tech
  "tech": "Tech",
  "cs-code-dev": "Tech",
  "cs-retro-tech": "Tech",

  // Entertainment
  "jeopardy": "Entertainment",
  "tom-and-jerry": "Entertainment",
  "bts": "Entertainment",
  "top-gear": "Entertainment",
  "all-gas-no-brakes": "Entertainment",
  "spongebob": "Entertainment",
  "shark-tank": "Entertainment",
  "one-piece": "Entertainment",
  "cs-gaming": "Entertainment",
  "cs-movie-trailers": "Entertainment",
  "cs-movies-tv": "Entertainment",
  "cs-adult-animation": "Entertainment",
  "cs-anime": "Entertainment",
  "cs-mystery": "Entertainment",
  "cs-crime": "Entertainment",

  // Home / Design / Art
  "home-design": "Design & Art",
  "ludwig": "Entertainment",
  "cs-art": "Design & Art",

  // Business / News
  "business-news": "Business",
  "beckers-healthcare": "Business",
  "vookum": "Business",

  // Sports
  "nba": "Sports",
  "cs-travel": "Sports & Travel",

  // Cooking
  "hebbars-kitchen": "Cooking",
  "tamil-cooking": "Cooking",
  "sanjana-feasts": "Cooking",
  "doobydobap": "Cooking",

  // Nature / Wellness
  "nature-india": "Nature",
  "zelda-study": "Chill",

  // Medical
  "mehlman-medical": "Medical",

  // Other
  "doug-demuro": "Cars",
};

const CATEGORY_ORDER = [
  "Music", "Decades", "Indian Classical", "Comedy & Talk", "Podcasts",
  "Learn", "Tech", "Entertainment", "Design & Art", "Business",
  "Sports", "Sports & Travel", "Cooking", "Nature", "Chill", "Medical", "Cars",
];

interface Props {
  channels: TVChannel[];
  activeChannelId: string | null;
  onSelectChannel: (channel: TVChannel) => void;
}

function ChannelRow({ channel, isActive, onSelect }: { channel: TVChannel; isActive: boolean; onSelect: () => void }) {
  const [nowPlaying, setNowPlaying] = useState(() => getNowPlaying(channel));

  useEffect(() => {
    const interval = setInterval(() => {
      setNowPlaying(getNowPlaying(channel));
    }, 1000);
    return () => clearInterval(interval);
  }, [channel]);

  if (!nowPlaying) return null;

  const progress = getProgress(nowPlaying);
  const channelColor = channel.color || "#ef4444";

  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 border-b border-[#222] transition-colors relative overflow-hidden group ${
        isActive
          ? "bg-[#1a1a1a]"
          : "bg-[#0a0a0a] hover:bg-[#111]"
      }`}
    >
      {isActive && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ backgroundColor: channelColor }}
        />
      )}

      <div className="flex items-center gap-3">
        <span className={`font-mono text-xs w-6 text-right shrink-0 ${
          isActive ? "text-white" : "text-[#555]"
        }`}>
          {channel.number}
        </span>

        <span className={`text-xs uppercase tracking-wider font-semibold shrink-0 min-w-[100px] ${
          isActive ? "text-white" : "text-[#999] group-hover:text-white"
        }`}>
          {channel.name}
        </span>

        <span className="text-[10px] text-[#666] truncate flex-1 uppercase tracking-wider hidden sm:block">
          {nowPlaying.video.title}
        </span>

        <span className={`font-mono text-[10px] shrink-0 ${
          isActive ? "text-[#888]" : "text-[#444]"
        }`}>
          {formatTimeRemaining(nowPlaying.secondsUntilNext)}
        </span>
      </div>

      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#111]">
        <div
          className="h-full transition-all duration-1000 ease-linear"
          style={{
            width: `${progress * 100}%`,
            backgroundColor: isActive ? channelColor : "#333",
          }}
        />
      </div>
    </button>
  );
}

export function TvGuide({ channels, activeChannelId, onSelectChannel }: Props) {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  // Group channels by category
  const grouped = useMemo(() => {
    const groups: Record<string, TVChannel[]> = {};
    for (const ch of channels) {
      const cat = CHANNEL_CATEGORIES[ch.id] || "Other";
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(ch);
    }
    return groups;
  }, [channels]);

  // Available categories (only ones that have channels)
  const categories = useMemo(() => {
    const available = CATEGORY_ORDER.filter((c) => grouped[c]?.length);
    const extra = Object.keys(grouped).filter((c) => !CATEGORY_ORDER.includes(c));
    return [...available, ...extra];
  }, [grouped]);

  // Filter channels
  const filteredChannels = useMemo(() => {
    let list = channels;
    if (activeCategory) {
      list = grouped[activeCategory] || [];
    }
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (ch) =>
          ch.name.toLowerCase().includes(q) ||
          ch.id.toLowerCase().includes(q) ||
          (CHANNEL_CATEGORIES[ch.id] || "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [channels, grouped, activeCategory, search]);

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-3 py-2 border-b border-[#222] bg-[#0a0a0a]">
        <input
          type="text"
          placeholder="SEARCH CHANNELS..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 bg-[#111] border border-[#333] text-xs uppercase tracking-wider placeholder-[#555] focus:outline-none focus:border-red-500 transition-colors"
        />
      </div>

      {/* Category pills */}
      <div className="px-3 py-2 border-b border-[#222] bg-[#0a0a0a] flex gap-1 flex-wrap">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
            !activeCategory
              ? "bg-red-600 text-white"
              : "bg-[#111] text-[#666] hover:text-white"
          }`}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
            className={`px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors ${
              activeCategory === cat
                ? "bg-red-600 text-white"
                : "bg-[#111] text-[#666] hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Count */}
      <div className="px-4 py-1 border-b border-[#222] bg-[#0a0a0a]">
        <span className="text-[10px] uppercase tracking-widest text-[#555]">
          {filteredChannels.length} channel{filteredChannels.length !== 1 ? "s" : ""}
          {activeCategory ? ` in ${activeCategory}` : ""}
        </span>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto">
        {activeCategory || search ? (
          // Flat list when filtering
          filteredChannels.map((channel) => (
            <ChannelRow
              key={channel.id}
              channel={channel}
              isActive={channel.id === activeChannelId}
              onSelect={() => onSelectChannel(channel)}
            />
          ))
        ) : (
          // Grouped list when browsing all
          categories.map((cat) => {
            const catChannels = grouped[cat];
            if (!catChannels?.length) return null;
            return (
              <div key={cat}>
                <div className="px-4 py-1.5 bg-[#080808] border-b border-[#222] sticky top-0 z-10">
                  <span className="text-[10px] uppercase tracking-widest text-[#444] font-semibold">
                    {cat}
                  </span>
                </div>
                {catChannels.map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    isActive={channel.id === activeChannelId}
                    onSelect={() => onSelectChannel(channel)}
                  />
                ))}
              </div>
            );
          })
        )}
        {filteredChannels.length === 0 && (
          <div className="flex-1 flex items-center justify-center py-8">
            <p className="text-[#444] text-xs uppercase tracking-widest">No channels found</p>
          </div>
        )}
      </div>
    </div>
  );
}
