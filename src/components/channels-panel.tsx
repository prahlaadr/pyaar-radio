"use client";

import { useEffect, useState, useCallback } from "react";
import type { Track } from "@/lib/types";
import { fetchPlaylist } from "@/lib/playlists";

interface Channel {
  id: string; playlistId: string; name: string;
  blurb?: string; kind?: string; synced?: boolean; source?: string;
}
interface PlTrack { title: string; artist: string; album: string; videoId: string; duration: string }

// A channel playlist track -> a player Track (plays via its YouTube videoId).
function plToTrack(t: PlTrack): Track {
  return {
    trackName: t.title, artistNames: t.artist, albumName: t.album, genres: [],
    tempo: 0, duration: t.duration || "", key: 0, popularity: 0,
    videoId: t.videoId, soundcloudId: "", bandcampId: "",
  };
}

// Channels: browse the synced-source (and your own) playlists to explore songs and
// add them to Liked. Distinct from Setlists (which arranges a set). Channel list
// comes from /data/channels.json; a channel's tracks from the already-synced
// /playlists/<id>.json. ♥ likes the song on YT Music via /api/channels/like
// (localhost: direct; deployed curate is a follow-up).
export function ChannelsPanel({ onPlay }: { onPlay: (t: Track) => void }) {
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Channel | null>(null);
  const [tracks, setTracks] = useState<PlTrack[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState("");
  const [liked, setLiked] = useState<Record<string, "pending" | "done" | "error">>({});

  useEffect(() => {
    fetch("/data/channels.json")
      .then((r) => { if (!r.ok) throw new Error("channels.json not found"); return r.json(); })
      .then((d) => setChannels(d.channels || []))
      .catch((e) => setError(e.message));
  }, []);

  const open = useCallback(async (ch: Channel) => {
    setActive(ch); setTracks(null); setLoading(true); setQ("");
    try {
      const data = await fetchPlaylist(ch.playlistId);
      setTracks(data.tracks || []);
    } catch {
      setTracks([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const like = useCallback(async (videoId: string) => {
    if (!videoId || liked[videoId] === "pending" || liked[videoId] === "done") return;
    setLiked((s) => ({ ...s, [videoId]: "pending" }));
    try {
      const r = await fetch("/api/channels/like", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      setLiked((s) => ({ ...s, [videoId]: r.ok ? "done" : "error" }));
    } catch {
      setLiked((s) => ({ ...s, [videoId]: "error" }));
    }
  }, [liked]);

  if (error) return <div className="flex-1 flex items-center justify-center text-[#888] text-sm">Channels: {error}</div>;
  if (!channels) return <div className="flex-1 flex items-center justify-center text-[#888] text-sm">Loading channels…</div>;

  // ---- a channel's track list ----
  if (active) {
    const needle = q.trim().toLowerCase();
    const shown = (tracks || []).filter((t) =>
      !needle || t.title.toLowerCase().includes(needle) || t.artist.toLowerCase().includes(needle));
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="px-5 pt-4 pb-3 flex items-center gap-3 border-b border-[#222] sticky top-0 bg-background z-10">
          <button onClick={() => { setActive(null); setTracks(null); }}
            className="text-[10px] text-[#888] hover:text-white uppercase tracking-wider shrink-0">← Channels</button>
          <div className="text-sm text-white truncate">{active.name}</div>
          {active.blurb && <div className="text-[10px] text-[#888] truncate hidden md:block">{active.blurb}</div>}
          <div className="text-[10px] text-[#555] shrink-0 ml-auto tabular-nums">{tracks ? `${tracks.length}` : ""}</div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter…"
            className="w-40 bg-[#111] border border-[#222] px-3 py-1 text-xs text-white placeholder-[#666] focus:outline-none focus:border-[#444] shrink-0" />
        </div>
        {loading ? (
          <div className="text-[#888] text-xs py-8 text-center">Loading tracks…</div>
        ) : shown.length === 0 ? (
          <div className="text-[#888] text-xs py-8 text-center">No tracks.</div>
        ) : (
          <div className="divide-y divide-[#141414]">
            {shown.map((t, i) => {
              const st = liked[t.videoId];
              return (
                <div key={t.videoId + i} className="group flex items-center gap-3 px-5 py-2 hover:bg-[#0d0d0d]">
                  <button onClick={() => onPlay(plToTrack(t))}
                    className="text-[#555] group-hover:text-white shrink-0 w-4 text-sm transition-colors" title="Play">▶</button>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-white truncate">{t.title}</div>
                    <div className="text-[10px] text-[#888] truncate">{t.artist}</div>
                  </div>
                  <span className="text-[10px] text-[#555] shrink-0 tabular-nums">{t.duration}</span>
                  <button onClick={() => like(t.videoId)} title={st === "error" ? "Like failed (needs local browser.json)" : "Add to Liked"}
                    className={`shrink-0 text-sm transition-colors ${
                      st === "done" ? "text-red-600" : st === "error" ? "text-yellow-500"
                      : st === "pending" ? "text-[#888] animate-pulse" : "text-[#3a3a3a] hover:text-red-600"
                    }`}>
                    {st === "error" ? "!" : "♥"}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ---- the channel grid ----
  return (
    <div className="flex-1 overflow-y-auto p-5">
      <div className="text-[10px] uppercase tracking-wider text-[#555] mb-3">
        Explore songs in each channel · ♥ adds to Liked
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {channels.map((ch) => (
          <button key={ch.id} onClick={() => open(ch)}
            className="text-left p-4 bg-[#0d0d0d] border border-[#1c1c1c] hover:border-[#444] transition-colors">
            <div className="text-sm text-white">
              {ch.name}
              {ch.kind && <span className="text-[9px] uppercase tracking-wider text-[#555] ml-1.5">{ch.kind}</span>}
            </div>
            {ch.blurb && <div className="text-[11px] text-[#888] mt-1 leading-snug">{ch.blurb}</div>}
            <div className="text-[9px] uppercase tracking-wider text-[#444] mt-2">{ch.synced ? "● synced" : "manual"}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
