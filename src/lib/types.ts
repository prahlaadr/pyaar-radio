export interface Artist {
  artist: string;
  aliases: string[];
  channel: "Rave" | "Rap" | "Soul";
  samay: "Day" | "Night" | "Day/Night";
  desi: "Desi" | "Non-Desi";
  vibes: string[];
  bpmLow: number;
  bpmHigh: number;
}

export interface Track {
  trackName: string;
  artistNames: string;
  albumName: string;
  genres: string[];
  tempo: number;
  duration: string;
  key: number;
  popularity: number;
  videoId: string;
  soundcloudId: string;
  bandcampId: string;
  likedPosition?: number | null;
  releaseDate?: string;
}

export const CHAPTER_TYPES = ["intro", "buildup", "cruise", "peak", "comedown", "closer"] as const;
export type ChapterType = typeof CHAPTER_TYPES[number];

export interface SetlistChapter {
  id: string;
  type: ChapterType;
  startIndex: number; // index in the setlist tracks array
  seedTrackIds: string[]; // IDs of tracks that anchor this chapter
}

export interface SetlistTrack extends Track {
  id: string;
  position: number;
}

export interface Setlist {
  id: string;
  name: string;
  tracks: SetlistTrack[];
}

export interface SavedSetlists {
  active: string | null;
  setlists: Record<string, { name: string; tracks: SetlistTrack[]; chapters?: SetlistChapter[] }>;
}

export interface SetlistManifestEntry {
  id: string;
  name: string;
  file: string;
  trackCount: number;
}

export interface PlaylistIndexEntry {
  playlistId: string;
  title: string;
  trackCount: number;
}

export interface PlaylistData {
  playlistId: string;
  title: string;
  trackCount: number;
  syncedAt: string;
  tracks: { title: string; artist: string; album: string; videoId: string; duration: string }[];
}

export interface ArtistFilters {
  channels: string[];
  samay: string | null;
  desi: string | null;
  vibes: string[];
  tags: string[];
  bpmMin: number;
  bpmMax: number;
  halfTime: boolean;
  search: string;
}
