"use client";

import { useEffect, useState } from "react";
import type { TVChannel } from "@/lib/tv-types";
import { getNowPlaying, formatTimeRemaining, getProgress } from "@/lib/tv-schedule";

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
      {/* Active indicator */}
      {isActive && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[3px]"
          style={{ backgroundColor: channelColor }}
        />
      )}

      <div className="flex items-center gap-3">
        {/* Channel number */}
        <span className={`font-mono text-xs w-6 text-right shrink-0 ${
          isActive ? "text-white" : "text-[#555]"
        }`}>
          {channel.number}
        </span>

        {/* Channel name */}
        <span className={`text-xs uppercase tracking-wider font-semibold shrink-0 min-w-[100px] ${
          isActive ? "text-white" : "text-[#999] group-hover:text-white"
        }`}>
          {channel.name}
        </span>

        {/* Now playing title */}
        <span className="text-[10px] text-[#666] truncate flex-1 uppercase tracking-wider">
          {nowPlaying.video.title}
        </span>

        {/* Time remaining */}
        <span className={`font-mono text-[10px] shrink-0 ${
          isActive ? "text-[#888]" : "text-[#444]"
        }`}>
          {formatTimeRemaining(nowPlaying.secondsUntilNext)}
        </span>
      </div>

      {/* Progress bar */}
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
  return (
    <div className="flex flex-col h-full">
      {/* Guide header */}
      <div className="px-4 py-2 border-b border-[#222] bg-[#0a0a0a]">
        <span className="text-[10px] uppercase tracking-widest text-[#555]">
          {channels.length} channel{channels.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto">
        {channels.map((channel) => (
          <ChannelRow
            key={channel.id}
            channel={channel}
            isActive={channel.id === activeChannelId}
            onSelect={() => onSelectChannel(channel)}
          />
        ))}
      </div>
    </div>
  );
}
