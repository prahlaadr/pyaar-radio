import { NextRequest, NextResponse } from "next/server";

const INNERTUBE_KEY = "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) {
    return NextResponse.json({ error: "Missing q param" }, { status: 400 });
  }

  try {
    const res = await fetch(
      `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: {
            client: {
              clientName: "WEB",
              clientVersion: "2.20240101.00.00",
            },
          },
          query: q,
        }),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ error: "YouTube search failed" }, { status: 502 });
    }

    const data = await res.json();

    // Navigate the nested response to find video results
    const sections =
      data?.contents?.twoColumnSearchResultsRenderer?.primaryContents
        ?.sectionListRenderer?.contents || [];

    for (const section of sections) {
      const items = section?.itemSectionRenderer?.contents || [];
      for (const item of items) {
        const vid = item?.videoRenderer;
        if (vid?.videoId) {
          return NextResponse.json({ videoId: vid.videoId });
        }
      }
    }

    return NextResponse.json({ videoId: null });
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
