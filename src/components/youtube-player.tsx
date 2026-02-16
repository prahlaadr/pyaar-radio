"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Track } from "@/lib/types";

declare global {
  interface Window {
    YT: {
      Player: new (
        el: string | HTMLElement,
        config: {
          height: string;
          width: string;
          videoId?: string;
          playerVars?: Record<string, number | string>;
          events?: Record<string, (e: YTEvent) => void>;
        }
      ) => YTPlayer;
      PlayerState: { PLAYING: number; PAUSED: number; ENDED: number; BUFFERING: number };
    };
    onYouTubeIframeAPIReady: () => void;
  }
}

interface YTEvent {
  data: number;
  target: YTPlayer;
}

interface YTPlayer {
  loadVideoById: (videoId: string) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  destroy: () => void;
  getPlayerState: () => number;
  getCurrentTime: () => number;
  getDuration: () => number;
}

interface Props {
  track: Track | null;
  onClose: () => void;
}

let apiLoaded = false;
let apiReady = false;
const readyCallbacks: (() => void)[] = [];

function ensureAPI(cb: () => void) {
  if (apiReady) {
    cb();
    return;
  }
  readyCallbacks.push(cb);
  if (!apiLoaded) {
    apiLoaded = true;
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      apiReady = true;
      for (const fn of readyCallbacks) fn();
      readyCallbacks.length = 0;
    };
  }
}

// In-memory cache: "track - artist" → videoId
const searchCache = new Map<string, string>();

async function searchVideoId(trackName: string, artistName: string): Promise<string | null> {
  const artist = artistName.split(";")[0].trim();
  const q = `${trackName} ${artist}`;
  const cacheKey = q.toLowerCase();

  if (searchCache.has(cacheKey)) {
    return searchCache.get(cacheKey)!;
  }

  try {
    const res = await fetch(`/api/search-yt?q=${encodeURIComponent(q)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.videoId) {
      searchCache.set(cacheKey, data.videoId);
      return data.videoId;
    }
    return null;
  } catch {
    return null;
  }
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function YouTubePlayer({ track, onClose }: Props) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentVideoId = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const startTracking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      try {
        const t = p.getCurrentTime();
        const d = p.getDuration();
        setCurrentTime(t);
        if (d > 0) setDuration(d);
      } catch {}
    }, 500);
  }, []);

  const stopTracking = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const onStateChange = useCallback((e: YTEvent) => {
    const state = e.data;
    setPlaying(
      state === window.YT.PlayerState.PLAYING ||
      state === window.YT.PlayerState.BUFFERING
    );
    if (state === window.YT.PlayerState.PLAYING) {
      startTracking();
    } else if (
      state === window.YT.PlayerState.PAUSED ||
      state === window.YT.PlayerState.ENDED
    ) {
      stopTracking();
    }
  }, [startTracking, stopTracking]);

  const playVideoId = useCallback((vid: string) => {
    // Same video — just resume
    if (vid === currentVideoId.current && playerRef.current) {
      playerRef.current.playVideo();
      return;
    }

    currentVideoId.current = vid;
    setCurrentTime(0);
    setDuration(0);
    setPlaying(true);
    setError(null);

    // Player already exists — load new video
    if (playerRef.current) {
      playerRef.current.loadVideoById(vid);
      return;
    }

    // Create player
    ensureAPI(() => {
      if (!containerRef.current) return;
      playerRef.current = new window.YT.Player(containerRef.current, {
        height: "200",
        width: "200",
        videoId: vid,
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          playsinline: 1,
          origin: window.location.origin,
        },
        events: {
          onStateChange: onStateChange,
        },
      });
    });
  }, [onStateChange]);

  const playTrack = useCallback(async (t: Track) => {
    setError(null);

    // If track already has a videoId, use it directly
    if (t.videoId) {
      playVideoId(t.videoId);
      return;
    }

    // Search for video via Piped API
    setSearching(true);
    const vid = await searchVideoId(t.trackName, t.artistNames);
    setSearching(false);

    if (vid) {
      playVideoId(vid);
    } else {
      setError("Not found");
      setPlaying(false);
    }
  }, [playVideoId]);

  useEffect(() => {
    if (!track) return;
    playTrack(track);
  }, [track, playTrack]);

  useEffect(() => {
    return () => {
      stopTracking();
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [stopTracking]);

  const handleClose = () => {
    stopTracking();
    playerRef.current?.pauseVideo();
    currentVideoId.current = null;
    setError(null);
    setSearching(false);
    onClose();
  };

  if (!track) return null;

  const handlePlayPause = () => {
    const p = playerRef.current;
    if (!p) return;
    if (playing) {
      p.pauseVideo();
    } else {
      p.playVideo();
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const p = playerRef.current;
    if (!p || duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = fraction * duration;
    p.seekTo(seekTime, true);
    setCurrentTime(seekTime);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-[#222] z-40">
      {/* Progress bar */}
      <div
        className="h-1 bg-[#111] cursor-pointer group"
        onClick={handleSeek}
      >
        <div
          className="h-full bg-red-600 group-hover:bg-red-500 transition-colors relative"
          style={{ width: `${progress}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      <div className="h-9 flex items-center px-5 gap-3">
        {searching ? (
          <div className="w-4 flex justify-center shrink-0">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          </div>
        ) : error ? (
          <span className="text-[10px] text-[#555] uppercase tracking-wider shrink-0">{error}</span>
        ) : (
          <button
            onClick={handlePlayPause}
            className="text-white hover:text-red-500 transition-colors text-xs w-4 text-center shrink-0"
          >
            {playing ? "\u275A\u275A" : "\u25B6"}
          </button>
        )}
        <span className="text-[10px] text-[#555] tabular-nums font-mono w-[70px] shrink-0">
          {formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : "—:——"}
        </span>
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs text-[#ccc] truncate">{track.trackName}</span>
          <span className="text-[10px] text-[#444]">&mdash;</span>
          <span className="text-[10px] text-[#666] truncate">{track.artistNames.split(";")[0]}</span>
        </div>
        <button
          onClick={handleClose}
          className="text-[#444] hover:text-white transition-colors text-xs shrink-0"
        >
          &times;
        </button>
      </div>

      {/* YouTube iframe — offscreen but large enough for YT to allow playback */}
      <div
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          width: "200px",
          height: "200px",
          overflow: "hidden",
          pointerEvents: "none",
        }}
      >
        <div ref={containerRef} />
      </div>
    </div>
  );
}
