export interface TVVideo {
  videoId: string;
  title: string;
  durationSeconds: number;
}

export interface TVChannel {
  id: string;
  name: string;
  number: number;
  color?: string;
  videos: TVVideo[];
}

export interface TVChannelData {
  channels: TVChannel[];
}

export interface TVNowPlaying {
  channel: TVChannel;
  videoIndex: number;
  video: TVVideo;
  offsetSeconds: number;
  nextVideo: TVVideo;
  secondsUntilNext: number;
}
