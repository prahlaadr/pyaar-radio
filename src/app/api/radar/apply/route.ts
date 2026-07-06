import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { dispatchWorkflow, putFile } from "@/lib/github-dispatch";

export const runtime = "nodejs";

interface SaveItem {
  artist: string;
  title: string;
  year?: string;
  source?: string;
  browseId?: string;
}

// POST /api/radar/apply — commit the picks to triage-runs/ and dispatch
// triage-apply.yml, which saves the albums to YT Music in the cloud.
// Body: { save: SaveItem[] } (the exportPicks payload).
export async function POST(req: Request) {
  const pw = process.env.SITE_PASSWORD;
  if (pw) {
    const c = await cookies();
    if (c.get("pyaar-auth")?.value !== pw) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    const payload = await req.json();
    const save: SaveItem[] = Array.isArray(payload?.save) ? payload.save : [];
    if (!save.length) {
      return NextResponse.json({ error: "No albums queued to save." }, { status: 400 });
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19); // YYYY-MM-DDTHH-MM-SS
    const path = `triage-runs/web-${stamp}.json`;
    const file = {
      exportedAt: new Date().toISOString(),
      source: "deployed /radar Apply",
      counts: { save: save.length },
      save,
    };

    await putFile(path, JSON.stringify(file, null, 2), `radar: web triage picks (${save.length} albums)`);
    await dispatchWorkflow("triage-apply.yml", {
      triage_path: path,
      mode: "apply",
      run_sync: "true",
    });

    return NextResponse.json({
      ok: true,
      path,
      count: save.length,
      message: `Saving ${save.length} album${save.length === 1 ? "" : "s"} to YT Music in the cloud…`,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
