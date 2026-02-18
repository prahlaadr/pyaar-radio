import { NextRequest, NextResponse } from "next/server";

let cachedClientId: string | null = null;
let clientIdFetchedAt = 0;
const CLIENT_ID_TTL = 1000 * 60 * 60; // 1 hour

async function getClientId(): Promise<string | null> {
  if (cachedClientId && Date.now() - clientIdFetchedAt < CLIENT_ID_TTL) {
    return cachedClientId;
  }

  try {
    // Fetch SoundCloud homepage to find JS bundle URLs
    const html = await fetch("https://soundcloud.com", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    }).then((r) => r.text());

    // Find cross-origin script URLs
    const scriptUrls = [...html.matchAll(/src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)]
      .map((m) => m[1]);

    // Check the last few scripts (client_id is usually in one of the later bundles)
    for (const url of scriptUrls.reverse().slice(0, 5)) {
      const js = await fetch(url).then((r) => r.text());
      const match = js.match(/client_id:"([a-zA-Z0-9]{32})"/);
      if (match) {
        cachedClientId = match[1];
        clientIdFetchedAt = Date.now();
        return cachedClientId;
      }
    }
  } catch {}

  return null;
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) {
    return NextResponse.json({ error: "Missing q param" }, { status: 400 });
  }

  const clientId = await getClientId();
  if (!clientId) {
    return NextResponse.json({ error: "Could not obtain SC client_id" }, { status: 503 });
  }

  try {
    const params = new URLSearchParams({
      q,
      client_id: clientId,
      limit: "5",
      offset: "0",
    });

    const res = await fetch(
      `https://api-v2.soundcloud.com/search/tracks?${params}`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
      }
    );

    if (!res.ok) {
      // client_id may have expired, clear cache
      if (res.status === 401 || res.status === 403) {
        cachedClientId = null;
      }
      return NextResponse.json({ error: "SC search failed" }, { status: 502 });
    }

    const data = await res.json();
    const tracks = data?.collection || [];

    if (tracks.length === 0) {
      return NextResponse.json({ soundcloudId: null });
    }

    // Return the first track's ID
    const track = tracks[0];
    return NextResponse.json({
      soundcloudId: String(track.id),
      title: track.title,
      artist: track.user?.username || "",
    });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
