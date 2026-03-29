import type { TVChannel, TVNowPlaying } from "./tv-types";

export function getTotalDuration(channel: TVChannel): number {
  return channel.videos.reduce((sum, v) => sum + v.durationSeconds, 0);
}

export function getNowPlaying(channel: TVChannel): TVNowPlaying | null {
  if (channel.videos.length === 0) return null;

  const totalDuration = getTotalDuration(channel);
  if (totalDuration <= 0) return null;

  const now = Math.floor(Date.now() / 1000);
  let position = now % totalDuration;

  for (let i = 0; i < channel.videos.length; i++) {
    const video = channel.videos[i];
    if (position < video.durationSeconds) {
      const nextIndex = (i + 1) % channel.videos.length;
      return {
        channel,
        videoIndex: i,
        video,
        offsetSeconds: position,
        nextVideo: channel.videos[nextIndex],
        secondsUntilNext: video.durationSeconds - position,
      };
    }
    position -= video.durationSeconds;
  }

  // Should never reach here, but fallback to first video
  return {
    channel,
    videoIndex: 0,
    video: channel.videos[0],
    offsetSeconds: 0,
    nextVideo: channel.videos[1 % channel.videos.length],
    secondsUntilNext: channel.videos[0].durationSeconds,
  };
}

export function formatTimeRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function getProgress(nowPlaying: TVNowPlaying): number {
  return nowPlaying.offsetSeconds / nowPlaying.video.durationSeconds;
}
