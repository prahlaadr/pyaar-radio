"use client";

import { useEffect, useRef, useCallback } from "react";
import { ensureYTAPI } from "@/lib/youtube-api";
import type { YTEvent, YTPlayer } from "@/lib/youtube-api";

interface Props {
  videoId: string | null;
  offsetSeconds?: number;
  onEnded?: () => void;
  channelName?: string;
  videoTitle?: string;
}

export function TvPlayer({ videoId, offsetSeconds = 0, onEnded, channelName, videoTitle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const currentVideoRef = useRef<string | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const onStateChange = useCallback((e: YTEvent) => {
    if (e.data === window.YT.PlayerState.ENDED) {
      onEndedRef.current?.();
    }
  }, []);

  const onError = useCallback(() => {
    // Skip broken videos — advance to next
    onEndedRef.current?.();
  }, []);

  useEffect(() => {
    if (!videoId) return;
    if (videoId === currentVideoRef.current && playerRef.current) {
      // Same video, just seek
      playerRef.current.seekTo(offsetSeconds, true);
      return;
    }

    currentVideoRef.current = videoId;

    if (playerRef.current) {
      playerRef.current.loadVideoById(videoId, offsetSeconds);
      return;
    }

    ensureYTAPI(() => {
      if (!containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: "100%",
        width: "100%",
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          start: Math.floor(offsetSeconds),
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onStateChange,
          onError,
        },
      });
    });
  }, [videoId, offsetSeconds, onStateChange, onError]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      try { playerRef.current?.destroy(); } catch {}
      playerRef.current = null;
      currentVideoRef.current = null;
    };
  }, []);

  if (!videoId) {
    return (
      <div className="w-full aspect-video bg-[#111] flex items-center justify-center">
        <div className="text-center">
          <p className="text-[#666] text-sm uppercase tracking-wider">Select a channel</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full">
      {/* Video title bar */}
      {channelName && (
        <div className="px-4 py-2 bg-[#111] border-b border-[#222] flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-red-500 font-semibold">{channelName}</span>
          {videoTitle && (
            <>
              <span className="text-[#333]">/</span>
              <span className="text-[10px] uppercase tracking-wider text-[#888] truncate">{videoTitle}</span>
            </>
          )}
        </div>
      )}
      <div className="w-full aspect-video bg-black">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
}
