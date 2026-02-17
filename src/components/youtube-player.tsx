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
  setVolume: (volume: number) => void;
  getVolume: () => number;
}

interface Props {
  track: Track | null;
  onClose: () => void;
  radioMode?: boolean;
  onToggleRadio?: () => void;
  onEnded?: () => void;
  onShuffle?: () => void;
  onAddToSetlist?: (track: Track) => void;
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

const VOLUME_KEY = "pyaar-volume";

function getStoredVolume(): number {
  try {
    const v = localStorage.getItem(VOLUME_KEY);
    if (v !== null) return Number(v);
  } catch {}
  return 80;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function openYouTubeSearch(trackName: string, artistName: string) {
  const artist = artistName.split(";")[0].trim();
  const q = encodeURIComponent(`${trackName} ${artist}`);
  // Try YouTube app deep link first, fall back to web
  const appUrl = `youtube://www.youtube.com/results?search_query=${q}`;
  const webUrl = `https://www.youtube.com/results?search_query=${q}`;
  const w = window.open(appUrl, "_self");
  // If app URL didn't work (desktop or no app), open web after short delay
  setTimeout(() => {
    if (!w || w.closed) window.open(webUrl, "_blank");
  }, 500);
}

export function YouTubePlayer({ track, onClose, radioMode, onToggleRadio, onEnded, onShuffle, onAddToSetlist }: Props) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentVideoId = useRef<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState(false);
  const [volume, setVolume] = useState(80);
  const volumeInitRef = useRef(false);

  // Load stored volume on mount
  useEffect(() => {
    if (!volumeInitRef.current) {
      volumeInitRef.current = true;
      setVolume(getStoredVolume());
    }
  }, []);

  const handleVolumeChange = useCallback((newVolume: number) => {
    setVolume(newVolume);
    try { localStorage.setItem(VOLUME_KEY, String(newVolume)); } catch {}
    try { playerRef.current?.setVolume(newVolume); } catch {}
  }, []);

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
      try { e.target.setVolume(getStoredVolume()); } catch {}
    } else if (state === window.YT.PlayerState.ENDED) {
      stopTracking();
      onEndedRef.current?.();
    } else if (state === window.YT.PlayerState.PAUSED) {
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
        height: "36",
        width: "48",
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

    // Search for video via YouTube innertube API
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

      <div className="h-9 flex items-center px-3 md:px-5 gap-2 md:gap-3">
        {/* YouTube thumbnail — visible, small, in the player bar */}
        <div className="w-12 h-9 shrink-0 overflow-hidden rounded-sm bg-[#111] relative">
          <div ref={containerRef} className="absolute inset-0" />
        </div>

        {searching ? (
          <div className="w-4 flex justify-center shrink-0">
            <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
          </div>
        ) : error ? (
          <button
            onClick={() => openYouTubeSearch(track.trackName, track.artistNames)}
            className="text-[10px] text-red-500 hover:text-red-400 uppercase tracking-wider shrink-0 underline"
            title="Search in YouTube app"
          >
            Open YT
          </button>
        ) : (
          <button
            onClick={handlePlayPause}
            className="text-white hover:text-red-500 transition-colors text-xs w-4 text-center shrink-0"
          >
            {playing ? "\u275A\u275A" : "\u25B6"}
          </button>
        )}
        <span className="text-[10px] text-[#555] tabular-nums font-mono hidden sm:inline w-[70px] shrink-0">
          {formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : "—:——"}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
          className="hidden sm:block w-16 h-1 accent-red-600 shrink-0 cursor-pointer"
          title={`Volume: ${volume}%`}
        />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs text-[#ccc] truncate">{track.trackName}</span>
          <span className="text-[10px] text-[#444] hidden sm:inline">&mdash;</span>
          <span className="text-[10px] text-[#666] truncate hidden sm:inline">{track.artistNames.split(";")[0]}</span>
        </div>
        {onAddToSetlist && track && (
          <button
            onClick={() => {
              onAddToSetlist(track);
              setJustAdded(true);
              setTimeout(() => setJustAdded(false), 1000);
            }}
            className="text-[#666] hover:text-red-500 transition-colors text-sm font-bold shrink-0"
            title="Add to setlist"
          >
            {justAdded ? "\u2713" : "+"}
          </button>
        )}
        {onShuffle && (
          <button
            onClick={onShuffle}
            className="text-[#666] hover:text-white transition-colors text-[10px] shrink-0"
            title="Shuffle — play random track"
          >
            &#8645;
          </button>
        )}
        {onToggleRadio && (
          <button
            onClick={onToggleRadio}
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 transition-colors shrink-0 ${
              radioMode
                ? "bg-red-600 text-white"
                : "text-[#666] hover:text-white"
            }`}
            title={radioMode ? "Radio mode on — auto-plays next" : "Radio mode off"}
          >
            Radio
          </button>
        )}
        <button
          onClick={handleClose}
          className="text-[#444] hover:text-white transition-colors text-xs shrink-0"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
