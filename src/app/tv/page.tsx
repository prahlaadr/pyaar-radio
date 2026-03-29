"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import type { TVChannel, TVChannelData } from "@/lib/tv-types";
import { getNowPlaying } from "@/lib/tv-schedule";
import { TvPlayer } from "@/components/tv-player";
import { TvGuide } from "@/components/tv-guide";

export default function TvPage() {
  const [channels, setChannels] = useState<TVChannel[]>([]);
  const [currentChannel, setCurrentChannel] = useState<TVChannel | null>(null);
  const [videoId, setVideoId] = useState<string | null>(null);
  const [offsetSeconds, setOffsetSeconds] = useState(0);
  const [videoTitle, setVideoTitle] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [guideOpen, setGuideOpen] = useState(false);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load channels
  useEffect(() => {
    fetch("/data/tv/channels.json")
      .then((r) => r.json())
      .then((data: TVChannelData) => {
        setChannels(data.channels);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Tune into a channel
  const tuneIn = useCallback((channel: TVChannel) => {
    const np = getNowPlaying(channel);
    if (!np) return;

    setCurrentChannel(channel);
    setVideoId(np.video.videoId);
    setOffsetSeconds(np.offsetSeconds);
    setVideoTitle(np.video.title);
    setGuideOpen(false);

    // Set timer to auto-advance
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => {
      advanceToNext(channel);
    }, np.secondsUntilNext * 1000);
  }, []);

  // Advance to next video in channel
  const advanceToNext = useCallback((channel: TVChannel) => {
    const np = getNowPlaying(channel);
    if (!np) return;

    setVideoId(np.video.videoId);
    setOffsetSeconds(np.offsetSeconds);
    setVideoTitle(np.video.title);

    // Set timer for next advance
    if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    advanceTimerRef.current = setTimeout(() => {
      advanceToNext(channel);
    }, np.secondsUntilNext * 1000);
  }, []);

  // Handle video ended (YouTube fires this)
  const handleEnded = useCallback(() => {
    if (!currentChannel) return;
    advanceToNext(currentChannel);
  }, [currentChannel, advanceToNext]);

  // Cleanup timer
  useEffect(() => {
    return () => {
      if (advanceTimerRef.current) clearTimeout(advanceTimerRef.current);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!channels.length) return;
      const currentIdx = currentChannel
        ? channels.findIndex((c) => c.id === currentChannel.id)
        : -1;

      if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        const prev = currentIdx > 0 ? currentIdx - 1 : channels.length - 1;
        tuneIn(channels[prev]);
      } else if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        const next = currentIdx < channels.length - 1 ? currentIdx + 1 : 0;
        tuneIn(channels[next]);
      } else if (e.key === "g") {
        setGuideOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [channels, currentChannel, tuneIn]);

  if (loading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <p className="text-[#666] text-xs uppercase tracking-widest animate-pulse">Loading channels...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Header */}
      <header className="px-4 py-3 border-b border-[#222] flex items-center justify-between shrink-0">
        <h1 className="text-sm font-bold uppercase tracking-[0.2em] text-white">
          Pyaar<span className="text-red-500">.tv</span>
        </h1>
        <div className="flex items-center gap-2">
          {/* Mobile guide toggle */}
          <button
            onClick={() => setGuideOpen(!guideOpen)}
            className="md:hidden px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] text-[#888] hover:text-white transition-colors"
          >
            {guideOpen ? "Player" : "Guide"}
          </button>
          <Link
            href="/"
            className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#111] text-[#888] hover:text-white transition-colors"
          >
            Radio
          </Link>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Player — hidden on mobile when guide is open */}
        <div className={`md:flex-1 md:min-w-0 ${guideOpen ? "hidden md:block" : ""}`}>
          <TvPlayer
            videoId={videoId}
            offsetSeconds={offsetSeconds}
            onEnded={handleEnded}
            channelName={currentChannel?.name}
            videoTitle={videoTitle}
          />

          {/* Keyboard hints — desktop only */}
          {!currentChannel && (
            <div className="hidden md:flex px-4 py-6 justify-center">
              <div className="text-center space-y-2">
                <p className="text-[#555] text-[10px] uppercase tracking-widest">Select a channel to start watching</p>
                <div className="flex gap-4 justify-center text-[10px] text-[#444] uppercase tracking-wider">
                  <span><kbd className="text-[#666] bg-[#111] px-1.5 py-0.5 rounded">j</kbd> / <kbd className="text-[#666] bg-[#111] px-1.5 py-0.5 rounded">k</kbd> navigate</span>
                  <span><kbd className="text-[#666] bg-[#111] px-1.5 py-0.5 rounded">g</kbd> toggle guide</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Guide sidebar — always visible on desktop, toggled on mobile */}
        <div className={`md:w-[380px] md:border-l border-[#222] md:flex flex-col ${
          guideOpen ? "flex flex-1" : "hidden md:flex"
        }`}>
          <TvGuide
            channels={channels}
            activeChannelId={currentChannel?.id ?? null}
            onSelectChannel={tuneIn}
          />
        </div>
      </div>
    </div>
  );
}
