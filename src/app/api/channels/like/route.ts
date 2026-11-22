import { NextRequest, NextResponse } from "next/server";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const VENV_PYTHON = join(process.cwd(), ".venv", "bin", "python");

// Like a song on YT Music (add to Liked). Mirrors the radar triage write path:
// shells out to the venv Python + browser.json, so it works when running locally.
// On the deployed site there is no browser.json; curate-from-cloud is a follow-up
// (dispatch a workflow, like radar/apply).
export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{8,24}$/.test(videoId)) {
      return NextResponse.json({ error: "Invalid videoId" }, { status: 400 });
    }
    try {
      await exec(VENV_PYTHON, [
        "-c",
        `
from ytmusicapi import YTMusic
from pathlib import Path
if not Path("browser.json").exists():
    raise SystemExit("No browser.json (deployed curate is a follow-up)")
YTMusic("browser.json").rate_song("${videoId}", "LIKE")
print("liked")
`,
      ], { cwd: process.cwd(), timeout: 15000 });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `like failed: ${msg}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, videoId });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
