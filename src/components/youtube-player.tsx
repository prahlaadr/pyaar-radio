"use client";

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import type { Track } from "@/lib/types";

export interface YouTubePlayerHandle {
  toggle: () => void;
}

interface SCWidget {
  bind: (event: string, cb: (data?: Record<string, number>) => void) => void;
  unbind: (event: string) => void;
  play: () => void;
  pause: () => void;
  seekTo: (ms: number) => void;
  setVolume: (vol: number) => void;
  getDuration: (cb: (ms: number) => void) => void;
  getPosition: (cb: (ms: number) => void) => void;
  isPaused: (cb: (paused: boolean) => void) => void;
}

interface SCWidgetAPI {
  (iframe: HTMLIFrameElement): SCWidget;
  Events: {
    PLAY: string;
    PAUSE: string;
    FINISH: string;
    PLAY_PROGRESS: string;
    READY: string;
  };
}

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
    SC: { Widget: SCWidgetAPI };
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

let scApiLoaded = false;
let scApiReady = false;
const scReadyCallbacks: (() => void)[] = [];

function ensureSCAPI(cb: () => void) {
  if (scApiReady) {
    cb();
    return;
  }
  scReadyCallbacks.push(cb);
  if (!scApiLoaded) {
    scApiLoaded = true;
    const tag = document.createElement("script");
    tag.src = "https://w.soundcloud.com/player/api.js";
    tag.onload = () => {
      scApiReady = true;
      for (const fn of scReadyCallbacks) fn();
      scReadyCallbacks.length = 0;
    };
    document.head.appendChild(tag);
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

export const YouTubePlayer = forwardRef<YouTubePlayerHandle, Props>(function YouTubePlayer({ track, onClose, radioMode, onToggleRadio, onEnded, onShuffle, onAddToSetlist }, ref) {
  const playerRef = useRef<YTPlayer | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scIframeRef = useRef<HTMLIFrameElement>(null);
  const scWidgetRef = useRef<SCWidget | null>(null);
  const activeSource = useRef<"youtube" | "soundcloud" | null>(null);
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

  useImperativeHandle(ref, () => ({
    toggle: () => {
      if (activeSource.current === "soundcloud") {
        const w = scWidgetRef.current;
        if (!w) return;
        if (playing) w.pause();
        else w.play();
      } else {
        const p = playerRef.current;
        if (!p) return;
        if (playing) p.pauseVideo();
        else p.playVideo();
      }
    },
  }), [playing]);

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
    if (activeSource.current === "soundcloud") {
      try { scWidgetRef.current?.setVolume(newVolume / 100); } catch {}
    } else {
      try { playerRef.current?.setVolume(newVolume); } catch {}
    }
  }, []);

  const startTracking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    // SC tracks time via PLAY_PROGRESS events — no polling needed
    if (activeSource.current === "soundcloud") return;
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

  const stopSoundCloud = useCallback(() => {
    try { scWidgetRef.current?.pause(); } catch {}
    if (scIframeRef.current) scIframeRef.current.src = "";
    scWidgetRef.current = null;
  }, []);

  const playSoundCloud = useCallback((scId: string) => {
    // Pause YouTube if active
    try { playerRef.current?.pauseVideo(); } catch {}
    activeSource.current = "soundcloud";
    currentVideoId.current = null;
    setCurrentTime(0);
    setDuration(0);
    setPlaying(true);
    setError(null);

    ensureSCAPI(() => {
      if (!scIframeRef.current) return;
      const url = `https://w.soundcloud.com/player/?url=https%3A%2F%2Fapi.soundcloud.com%2Ftracks%2F${scId}&auto_play=true&show_artwork=false&color=ff0000`;
      scIframeRef.current.src = url;

      const widget = window.SC.Widget(scIframeRef.current);
      scWidgetRef.current = widget;

      widget.bind(window.SC.Widget.Events.READY, () => {
        widget.setVolume(getStoredVolume() / 100);
        widget.getDuration((ms) => setDuration(ms / 1000));
      });
      widget.bind(window.SC.Widget.Events.PLAY, () => setPlaying(true));
      widget.bind(window.SC.Widget.Events.PAUSE, () => setPlaying(false));
      widget.bind(window.SC.Widget.Events.FINISH, () => {
        stopTracking();
        onEndedRef.current?.();
      });
      widget.bind(window.SC.Widget.Events.PLAY_PROGRESS, (data) => {
        if (data?.currentPosition != null) {
          setCurrentTime(data.currentPosition / 1000);
        }
      });
    });

    startTracking();
  }, [startTracking, stopTracking]);

  const playTrack = useCallback(async (t: Track) => {
    setError(null);

    // If track already has a videoId, use it directly
    if (t.videoId) {
      stopSoundCloud();
      activeSource.current = "youtube";
      playVideoId(t.videoId);
      return;
    }

    // Search for video via YouTube innertube API
    setSearching(true);
    const vid = await searchVideoId(t.trackName, t.artistNames);
    setSearching(false);

    if (vid) {
      stopSoundCloud();
      activeSource.current = "youtube";
      playVideoId(vid);
    } else if (t.soundcloudId) {
      // Fallback to SoundCloud
      playSoundCloud(t.soundcloudId);
    } else {
      setError("Not found");
      setPlaying(false);
    }
  }, [playVideoId, playSoundCloud, stopSoundCloud]);

  useEffect(() => {
    if (!track) return;
    playTrack(track);
  }, [track, playTrack]);

  useEffect(() => {
    return () => {
      stopTracking();
      playerRef.current?.destroy();
      playerRef.current = null;
      stopSoundCloud();
    };
  }, [stopTracking, stopSoundCloud]);

  const handleClose = () => {
    stopTracking();
    playerRef.current?.pauseVideo();
    stopSoundCloud();
    activeSource.current = null;
    currentVideoId.current = null;
    setError(null);
    setSearching(false);
    onClose();
  };

  if (!track) return null;

  const handlePlayPause = () => {
    if (activeSource.current === "soundcloud") {
      const w = scWidgetRef.current;
      if (!w) return;
      if (playing) w.pause();
      else w.play();
    } else {
      const p = playerRef.current;
      if (!p) return;
      if (playing) p.pauseVideo();
      else p.playVideo();
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (duration <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const seekTime = fraction * duration;
    if (activeSource.current === "soundcloud") {
      scWidgetRef.current?.seekTo(seekTime * 1000);
    } else {
      playerRef.current?.seekTo(seekTime, true);
    }
    setCurrentTime(seekTime);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[#0a0a0a] border-t border-[#222] z-40">
      {/* Progress bar — taller touch target on mobile */}
      <div
        className="h-2 md:h-1 bg-[#111] cursor-pointer group"
        onClick={handleSeek}
      >
        <div
          className="h-full bg-red-600 group-hover:bg-red-500 transition-colors relative"
          style={{ width: `${progress}%` }}
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </div>

      {/* Hidden YouTube iframe container — shared between layouts */}
      <div className="absolute top-0 left-0 w-12 h-10 overflow-hidden opacity-0 pointer-events-none">
        <div ref={containerRef} className="w-full h-full" />
      </div>
      {/* Hidden SoundCloud widget iframe */}
      <iframe
        ref={scIframeRef}
        id="sc-widget"
        src=""
        className="absolute top-0 left-0 w-12 h-10 overflow-hidden opacity-0 pointer-events-none"
        allow="autoplay"
      />

      {/* === Desktop: single row === */}
      <div className="hidden md:flex items-center px-5 py-1.5 gap-3">
        {/* Thumbnail placeholder */}
        <div className="w-12 h-9 shrink-0 overflow-hidden rounded-sm bg-[#111]" />
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
            className="text-white hover:text-red-500 transition-colors text-sm w-5 text-center shrink-0"
          >
            {playing ? "\u275A\u275A" : "\u25B6"}
          </button>
        )}
        <span className="text-[10px] text-[#555] tabular-nums font-mono w-[70px] shrink-0">
          {formatTime(currentTime)} / {duration > 0 ? formatTime(duration) : "—:——"}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={volume}
          onChange={(e) => handleVolumeChange(Number(e.target.value))}
          className="w-16 h-1 accent-red-600 shrink-0 cursor-pointer"
          title={`Volume: ${volume}%`}
        />
        <div className="flex-1 min-w-0 flex items-center gap-2">
          <span className="text-xs text-[#ccc] truncate">{track.trackName}</span>
          <span className="text-[10px] text-[#444]">&mdash;</span>
          <span className="text-[10px] text-[#666] truncate">{track.artistNames.split(";")[0]}</span>
        </div>
        {onAddToSetlist && track && (
          <button
            onClick={() => { onAddToSetlist(track); setJustAdded(true); setTimeout(() => setJustAdded(false), 1000); }}
            className="text-[#666] hover:text-red-500 transition-colors text-sm font-bold shrink-0"
            title="Add to setlist"
          >
            {justAdded ? "\u2713" : "+"}
          </button>
        )}
        {onShuffle && (
          <button onClick={onShuffle} className="text-[#666] hover:text-white transition-colors text-[10px] shrink-0" title="Shuffle">
            &#8645;
          </button>
        )}
        {onToggleRadio && (
          <button
            onClick={onToggleRadio}
            className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 transition-colors shrink-0 ${
              radioMode ? "bg-red-600 text-white" : "text-[#666] hover:text-white"
            }`}
          >
            Radio
          </button>
        )}
        <button onClick={handleClose} className="text-[#444] hover:text-white transition-colors text-xs shrink-0">&times;</button>
      </div>

      {/* === Mobile: two rows — song info top, controls bottom === */}
      <div className="md:hidden">
        {/* Row 1: thumbnail + song info */}
        <div className="flex items-center px-3 pt-2 pb-1 gap-3">
          <div className="w-10 h-10 shrink-0 overflow-hidden rounded-sm bg-[#111]" />
          <div className="flex-1 min-w-0">
            <div className="text-sm text-[#ccc] truncate">{track.trackName}</div>
            <div className="text-xs text-[#666] truncate">{track.artistNames.split(";")[0]}</div>
          </div>
        </div>

        {/* Row 2: controls */}
        <div className="flex items-center justify-between px-3 pb-2 pt-1">
          {/* Left: play/pause + shuffle */}
          <div className="flex items-center gap-1">
            {searching ? (
              <div className="w-11 h-11 flex items-center justify-center">
                <div className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
              </div>
            ) : error ? (
              <button
                onClick={() => openYouTubeSearch(track.trackName, track.artistNames)}
                className="text-xs text-red-500 hover:text-red-400 uppercase tracking-wider underline h-11 flex items-center px-2"
              >
                Open YT
              </button>
            ) : (
              <button
                onClick={handlePlayPause}
                className="text-white hover:text-red-500 transition-colors text-lg w-11 h-11 flex items-center justify-center"
              >
                {playing ? "\u275A\u275A" : "\u25B6"}
              </button>
            )}
            {onShuffle && (
              <button
                onClick={onShuffle}
                className="text-[#666] hover:text-white transition-colors text-lg w-11 h-11 flex items-center justify-center"
                title="Shuffle"
              >
                &#8645;
              </button>
            )}
          </div>

          {/* Center: radio */}
          {onToggleRadio && (
            <button
              onClick={onToggleRadio}
              className={`text-xs uppercase tracking-wider px-4 py-2 transition-colors rounded-sm ${
                radioMode ? "bg-red-600 text-white" : "bg-[#111] text-[#888] hover:text-white"
              }`}
            >
              Radio
            </button>
          )}

          {/* Right: add + close */}
          <div className="flex items-center gap-1">
            {onAddToSetlist && track && (
              <button
                onClick={() => { onAddToSetlist(track); setJustAdded(true); setTimeout(() => setJustAdded(false), 1000); }}
                className="text-[#666] hover:text-red-500 transition-colors text-xl font-bold w-11 h-11 flex items-center justify-center"
                title="Add to setlist"
              >
                {justAdded ? "\u2713" : "+"}
              </button>
            )}
            <button
              onClick={handleClose}
              className="text-[#444] hover:text-white transition-colors text-xl w-11 h-11 flex items-center justify-center"
            >
              &times;
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
