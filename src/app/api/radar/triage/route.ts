import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile } from "fs/promises";
import { join } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const exec = promisify(execFile);
const ALERTS_PATH = join(process.cwd(), "public", "data", "radar-alerts.json");
const VENV_PYTHON = join(process.cwd(), ".venv", "bin", "python");

export async function POST(req: NextRequest) {
  try {
    const { id, status } = await req.json();
    if (!id || !["saved", "dismissed"].includes(status)) {
      return NextResponse.json({ error: "Invalid id or status" }, { status: 400 });
    }

    const raw = await readFile(ALERTS_PATH, "utf-8");
    const data = JSON.parse(raw);

    const alert = data.alerts.find((a: { id: number }) => a.id === id);
    if (!alert) {
      return NextResponse.json({ error: "Alert not found" }, { status: 404 });
    }

    // Save to YT Music library via Python
    if (status === "saved" && alert.browseId) {
      try {
        await exec(VENV_PYTHON, [
          "-c",
          `
from ytmusicapi import YTMusic
from pathlib import Path
auth = Path("browser.json")
if not auth.exists():
    raise SystemExit("No browser.json")
yt = YTMusic(str(auth))
album = yt.get_album("${alert.browseId}")
pid = album.get("audioPlaylistId")
if pid:
    yt.rate_playlist(pid, "LIKE")
    print("saved")
else:
    raise SystemExit("No playlist ID")
`,
        ], { cwd: process.cwd(), timeout: 15000 });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return NextResponse.json({ error: `YT Music save failed: ${msg}` }, { status: 500 });
      }
    }

    // Update JSON
    alert.status = status;
    if (status === "dismissed") {
      data.alerts = data.alerts.filter((a: { id: number }) => a.id !== id);
    }
    data.updatedAt = new Date().toISOString();
    await writeFile(ALERTS_PATH, JSON.stringify(data, null, 1), "utf-8");

    return NextResponse.json({ ok: true, id, status });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
