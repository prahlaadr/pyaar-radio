"use client";

import { useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from "react";
import { ensureYTAPI } from "@/lib/youtube-api";
import type { YTEvent, YTPlayer } from "@/lib/youtube-api";

export interface TvPlayerHandle {
  playVideo: (videoId: string, startSeconds: number) => void;
}

interface Props {
  onEnded?: () => void;
  onSkip?: () => void;
  channelName?: string;
  videoTitle?: string;
}

export const TvPlayer = forwardRef<TvPlayerHandle, Props>(function TvPlayer(
  { onEnded, onSkip, channelName, videoTitle },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;
  const playerReady = useRef(false);

  const onStateChange = useCallback((e: YTEvent) => {
    if (e.data === window.YT.PlayerState.ENDED) {
      onEndedRef.current?.();
    }
  }, []);

  const onError = useCallback(() => {
    onEndedRef.current?.();
  }, []);

  // Initialize player once (no video)
  useEffect(() => {
    ensureYTAPI(() => {
      if (!containerRef.current || playerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: "100%",
        width: "100%",
        playerVars: {
          autoplay: 1,
          controls: 1,
          modestbranding: 1,
          playsinline: 1,
          rel: 0,
          origin: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onStateChange,
          onError,
          onReady: () => { playerReady.current = true; },
        },
      });
    });

    return () => {
      try { playerRef.current?.destroy(); } catch {}
      playerRef.current = null;
      playerReady.current = false;
    };
  }, [onStateChange, onError]);

  // Expose playVideo to parent via ref
  useImperativeHandle(ref, () => ({
    playVideo: (videoId: string, startSeconds: number) => {
      const p = playerRef.current;
      if (!p) return;
      p.loadVideoById(videoId, startSeconds);
      // Backup seek in case startSeconds is ignored
      if (startSeconds > 0) {
        const doSeek = (retries: number) => {
          if (retries <= 0) return;
          setTimeout(() => {
            try {
              const state = p.getPlayerState?.();
              if (state === window.YT.PlayerState.PLAYING || state === window.YT.PlayerState.BUFFERING) {
                p.seekTo(startSeconds, true);
              } else {
                doSeek(retries - 1);
              }
            } catch {}
          }, 500);
        };
        doSeek(6);
      }
    },
  }));

  return (
    <div className="w-full">
      {channelName && (
        <div className="px-4 py-2 bg-[#111] border-b border-[#222] flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-wider text-red-500 font-semibold shrink-0">{channelName}</span>
          {videoTitle && (
            <>
              <span className="text-[#888] shrink-0">/</span>
              <span className="text-[10px] uppercase tracking-wider text-[#888] truncate flex-1">{videoTitle}</span>
            </>
          )}
          {onSkip && (
            <button
              onClick={onSkip}
              className="px-2 py-0.5 text-[10px] uppercase tracking-wider bg-[#1a1a1a] text-[#999] hover:text-white transition-colors shrink-0"
              title="Skip to next video"
            >
              Skip &raquo;
            </button>
          )}
        </div>
      )}
      <div className="w-full aspect-video bg-background">
        <div ref={containerRef} className="w-full h-full" />
      </div>
    </div>
  );
});
