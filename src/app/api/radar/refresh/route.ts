import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { dispatchWorkflow } from "@/lib/github-dispatch";

export const runtime = "nodejs";

// POST /api/radar/refresh — kick off the cloud radar scan (scan → reconcile →
// verify → commit). The heavy Python + YT auth runs in GitHub Actions, not here.
export async function POST() {
  const pw = process.env.SITE_PASSWORD;
  if (pw) {
    const c = await cookies();
    if (c.get("pyaar-auth")?.value !== pw) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }
  try {
    await dispatchWorkflow("radar-scan.yml");
    return NextResponse.json({
      ok: true,
      message: "Scan started. It runs in the cloud (~15 min) — reload this page after to see fresh releases.",
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
