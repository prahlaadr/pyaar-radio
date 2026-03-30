import type { PlaylistIndexEntry, PlaylistData } from "./types";

let cachedIndex: PlaylistIndexEntry[] | null = null;

export async function fetchPlaylistIndex(): Promise<PlaylistIndexEntry[]> {
  if (cachedIndex) return cachedIndex;
  const res = await fetch("/playlists/_index.json");
  const data = await res.json();
  cachedIndex = data.playlists as PlaylistIndexEntry[];
  return cachedIndex;
}

export async function fetchPlaylist(playlistId: string): Promise<PlaylistData> {
  const res = await fetch(`/playlists/${playlistId}.json`);
  return res.json();
}
