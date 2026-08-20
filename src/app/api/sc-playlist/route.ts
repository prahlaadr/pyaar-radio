import { NextRequest, NextResponse } from "next/server";

// SoundCloud's api-v2 blocks cross-origin fetches, so the browser can't list a
// playlist's tracks directly. This route proxies that server-side (same client_id
// scrape as /api/search-sc). Returns the playlist's tracks in order (capped).

let cachedClientId: string | null = null;
let clientIdFetchedAt = 0;
const CLIENT_ID_TTL = 1000 * 60 * 60;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

async function getClientId(): Promise<string | null> {
  if (cachedClientId && Date.now() - clientIdFetchedAt < CLIENT_ID_TTL) return cachedClientId;
  try {
    const html = await fetch("https://soundcloud.com", { headers: { "User-Agent": UA } }).then((r) => r.text());
    const scriptUrls = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map((m) => m[1]);
    for (const url of scriptUrls.reverse().slice(0, 5)) {
      const js = await fetch(url).then((r) => r.text());
      const match = js.match(/client_id:"([a-zA-Z0-9]{32})"/);
      if (match) { cachedClientId = match[1]; clientIdFetchedAt = Date.now(); return cachedClientId; }
    }
  } catch {}
  return null;
}

interface RawTrack {
  id: number; title?: string; artwork_url?: string; permalink_url?: string;
  duration?: number; genre?: string; streamable?: boolean; user?: { username?: string };
}

function compact(t: RawTrack) {
  return {
    id: t.id, title: t.title || "", user: t.user?.username || "", artwork: t.artwork_url || null,
    permalink: t.permalink_url || "", duration: t.duration || 0, genre: t.genre || "", streamable: !!t.streamable,
  };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id param" }, { status: 400 });

  const clientId = await getClientId();
  if (!clientId) return NextResponse.json({ error: "No SC client_id" }, { status: 503 });

  const scGet = async (url: string) => {
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) cachedClientId = null;
      throw new Error(`SC ${r.status}`);
    }
    return r.json();
  };

  try {
    const detail = await scGet(`https://api-v2.soundcloud.com/playlists/${id}?client_id=${clientId}`);
    const raw: RawTrack[] = (detail.tracks || []).slice(0, 100);
    const hydrated: RawTrack[] = raw.filter((t) => t.title);
    const missing = raw.filter((t) => !t.title).map((t) => t.id);
    for (let i = 0; i < missing.length; i += 50) {
      const ids = missing.slice(i, i + 50).join(",");
      const got = await scGet(`https://api-v2.soundcloud.com/tracks?ids=${ids}&client_id=${clientId}`);
      hydrated.push(...(got || []));
    }
    const order = new Map(raw.map((t, i) => [t.id, i]));
    hydrated.sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
    return NextResponse.json({ tracks: hydrated.map(compact) });
  } catch {
    return NextResponse.json({ error: "Failed to load playlist" }, { status: 502 });
  }
}
