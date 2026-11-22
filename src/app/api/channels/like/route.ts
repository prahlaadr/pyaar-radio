import { NextRequest, NextResponse } from "next/server";
import { existsSync } from "fs";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { dispatchWorkflow } from "@/lib/github-dispatch";

const exec = promisify(execFile);
const VENV_PYTHON = join(process.cwd(), ".venv", "bin", "python");
const BROWSER_AUTH = join(process.cwd(), "browser.json");

// Like a song on YT Music (add to Liked). Two paths, same as radar:
//  - Local (browser.json present): write directly via the venv Python.
//  - Deployed (no browser.json): dispatch channels-like.yml, which likes it from
//    the cloud using the YTMUSIC_BROWSER_AUTH secret (needs GITHUB_DISPATCH_TOKEN).
export async function POST(req: NextRequest) {
  try {
    const { videoId } = await req.json();
    if (typeof videoId !== "string" || !/^[A-Za-z0-9_-]{8,24}$/.test(videoId)) {
      return NextResponse.json({ error: "Invalid videoId" }, { status: 400 });
    }

    if (existsSync(BROWSER_AUTH)) {
      try {
        await exec(VENV_PYTHON, [
          "-c",
          `
from ytmusicapi import YTMusic
YTMusic("browser.json").rate_song("${videoId}", "LIKE")
print("liked")
`,
        ], { cwd: process.cwd(), timeout: 15000 });
        return NextResponse.json({ ok: true, videoId, via: "local" });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: `like failed: ${msg}` }, { status: 500 });
      }
    }

    try {
      await dispatchWorkflow("channels-like.yml", { videoId });
      return NextResponse.json({ ok: true, videoId, via: "dispatch" });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: `dispatch failed: ${msg}` }, { status: 500 });
    }
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
