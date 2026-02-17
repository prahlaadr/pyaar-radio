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
  setlists: Record<string, { name: string; tracks: SetlistTrack[] }>;
}

export interface SetlistManifestEntry {
  id: string;
  name: string;
  file: string;
  trackCount: number;
}

export interface ArtistFilters {
  channels: string[];
  samay: string | null;
  desi: string | null;
  vibes: string[];
  tags: string[];
  bpmMin: number;
  bpmMax: number;
  search: string;
}
