// The __laad energy spine — 6 pillars, ordered stillest → most kinetic.
// Crowdlaad + Lucidlaad are context-dependent wildcards (sit outside the energy line).
export const PILLARS_V2 = [
  { name: "Soullaad",  color: "#9B72CF", bg: "#2D1F3D", desc: "Ambient → groove, jazz, R&B, lovers rock" },
  { name: "Hypelaad",  color: "#E2C044", bg: "#3D3520", desc: "House, UKG, electronica, brewery → club" },
  { name: "Perclaad",  color: "#C4835A", bg: "#3D2B1F", desc: "Afrobeats, baile, footwork, amapiano, global percussive" },
  { name: "Rowdylaad", color: "#E05252", bg: "#3D1F1F", desc: "Bass, dubstep, DnB, jungle, breakbeat, rave" },
  { name: "Crowdlaad", color: "#5AAFB0", bg: "#1F3535", desc: "Trivia, pop, disco, classic hits, crowd-pleasers" },
  { name: "Lucidlaad", color: "#E08A52", bg: "#3D2D1F", desc: "Underground rap, ATL, grimy hip-hop" },
] as const;

export type PillarName = typeof PILLARS_V2[number]["name"];
export const PILLAR_NAMES = PILLARS_V2.map((p) => p.name) as PillarName[];
export const PILLAR_COLOR: Record<string, string> = Object.fromEntries(
  PILLARS_V2.map((p) => [p.name, p.color])
);

// Within-pillar sub-buckets (only some pillars use zones).
export type Zone = "ambient" | "beats" | "soul" | "dub" | "dnb" | "leftfield" | "rave" | "support" | "";

export interface Artist {
  artist: string;
  aliases: string[];
  channel: "Rave" | "Rap" | "Soul" | "";
  samay: "Day" | "Night" | "Day/Night";
  desi: "Desi" | "Non-Desi";
  vibes: string[];
  bpmLow: number;
  bpmHigh: number;
  pillars: string[]; // now the __laad 6-pillar names (pillar_v2)
  zone?: Zone;
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
  firstLikedAt?: string | null;
  energy?: number | null;
  danceability?: number | null;
  valence?: number | null;
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
  pillars: string[];
  bpmMin: number;
  bpmMax: number;
  halfTime: boolean;
  search: string;
}
